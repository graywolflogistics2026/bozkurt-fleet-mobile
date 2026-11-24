import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useDrivers, useInsertDriver } from '@/src/data/drivers';
import {
  REMOVE_DRIVER_VALUES,
  RESTORE_DRIVER_VALUES,
  deleteDriverWithoutHistory,
  driverHistoryTotal,
  fetchDriverHistory,
  updateRowTolerant,
} from '@/src/data/fleetEdit';
import { useDriverPayments, useInsertDriverPayment } from '@/src/data/driverPayments';
import { useTaxYearData } from '@/src/data/taxYearData';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { calcTrueCostOfEmployee, calcW2EmployerTaxes } from '@/src/tax/driverPayroll';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { CompensationType, Driver, DriverPayment } from '@/src/types/db';
import { compareDateOnly, todayDateOnly } from '@/src/lib/dateOnly';
import { numOrNull } from '@/src/lib/number';
import { useSettlements } from '@/src/data/settlements';
import { carrierDisplayName, carrierPayrollSummary, needsDriverName, type PayrollTotals } from '@/src/import/carrierPayroll';

const COMPENSATION_TYPES: CompensationType[] = ['w2_employee', '1099_contractor', 'team_split', 'trainee'];
const PAY_TYPES = ['per_mile', 'percent', 'flat'] as const;

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : colors.card2,
        marginEnd: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

type FormState = {
  name: string;
  phone: string;
  license: string;
  compensation_type: CompensationType;
  pay_type: (typeof PAY_TYPES)[number] | null;
  pay_rate: string;
  default_truck_id: string | null;
};

function emptyForm(): FormState {
  return { name: '', phone: '', license: '', compensation_type: 'w2_employee', pay_type: null, pay_rate: '', default_truck_id: null };
}

function driverToForm(d: Driver): FormState {
  return {
    name: d.name,
    phone: d.phone ?? '',
    license: d.license ?? '',
    compensation_type: d.compensation_type,
    pay_type: d.pay_type,
    pay_rate: d.pay_rate != null ? String(d.pay_rate) : '',
    default_truck_id: d.default_truck_id,
  };
}

function DriverPaymentsSheet({ driver, employerFicaRate, onClose }: { driver: Driver; employerFicaRate: number | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const { money, date: fmtDate } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const paymentsQuery = useDriverPayments({ driver_id: driver.id });
  const insertPayment = useInsertDriverPayment();

  const [payDate, setPayDate] = useState(todayDateOnly());
  const [grossPay, setGrossPay] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const payments = useMemo(
    () => [...(paymentsQuery.data ?? [])].sort((a, b) => compareDateOnly(b.date, a.date)),
    [paymentsQuery.data]
  );

  async function handleAdd() {
    if (!userId) return;
    const gross = numOrNull(grossPay) || 0;
    if (gross <= 0) {
      Alert.alert(t('drivers.enterAmountTitle'));
      return;
    }
    setSaving(true);
    try {
      const employerTaxes = driver.compensation_type === 'w2_employee' ? calcW2EmployerTaxes(gross, employerFicaRate) : 0;
      await insertPayment.mutateAsync({
        user_id: userId,
        driver_id: driver.id,
        date: payDate,
        gross_pay: gross,
        employer_taxes: employerTaxes,
        notes: notes || null,
      });
      // ONE REFRESH PATH (owner decision 2026-08-05, FULL PARITY follow-up
      // item A) — driver_payments feeds sumDeductibleDriverPayroll() in the
      // tax engine (CLAUDE.md invariant #7), which Tax Estimator reads.
      await invalidateFinancialData(queryClient, { entities: ['driver_payments'] });
      setGrossPay('');
      setNotes('');
    } catch (err) {
      Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalSheet visible onClose={onClose}>
      <SheetTitle>{t('drivers.paymentsTitle', { name: driver.name })}</SheetTitle>

        {payments.length === 0 ? (
          <MutedText>{t('drivers.paymentsEmpty')}</MutedText>
        ) : (
          <View style={{ marginBottom: spacing.md }}>
            {payments.map((p) => (
              <View key={p.id} style={{ paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <MutedText>{fmtDate(p.date)}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{money(p.gross_pay)}</Text>
                </View>
                {driver.compensation_type === 'w2_employee' && p.employer_taxes > 0 && (
                  <MutedText>{t('drivers.trueCostOfEmployee', { amount: money(calcTrueCostOfEmployee(p.gross_pay, p.employer_taxes)) })}</MutedText>
                )}
                {p.notes ? <MutedText>{p.notes}</MutedText> : null}
              </View>
            ))}
          </View>
        )}

        <MutedText>{t('drivers.paymentDateLabel')}</MutedText>
        <Field value={payDate} onChangeText={setPayDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('drivers.paymentAmountLabel')}</MutedText>
        <Field keyboardType="numeric" value={grossPay} onChangeText={setGrossPay} placeholder="0.00" />
        <MutedText>{t('drivers.paymentNotesLabel')}</MutedText>
        <Field value={notes} onChangeText={setNotes} />
        {driver.compensation_type === 'w2_employee' && (
          <MutedText>{t('drivers.employerTaxesNote', { pct: employerFicaRate ? `${(employerFicaRate * 100).toFixed(2)}%` : '—' })}</MutedText>
        )}

      <PrimaryButton title={t('drivers.recordPayment')} onPress={handleAdd} loading={saving} />
      <SecondaryButton title={t('common.cancel')} onPress={onClose} />
    </ModalSheet>
  );
}

// CARRIER PAYROLL DRIVER (owner 2026-11-13, §88): a driver Prime pays
// through its payroll (the WAGE EXPENSE section of the settlement). Made
// automatically by the import; this card is attribution only — the wages
// are already in the week's expenses. No manual payments, no app FICA.
// WHO IS CODE? (owner 2026-11-24): the stored name is still the payroll
// code, so a clearly visible accent button opens the name form (same
// saveName as before, no data logic change). Lives in the driver's LIST
// row (the only thing besides the name kept there); renders nothing once
// the driver has a real name.
function WhoIsCodeButton({ driver }: { driver: Driver }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameFormOpen, setNameFormOpen] = useState(false);
  const askName = needsDriverName(driver);

  async function saveName() {
    if (!name.trim()) {
      Alert.alert(t('drivers.enterNameTitle'));
      return;
    }
    setSaving(true);
    try {
      await updateRowTolerant('drivers', driver.id, { name: name.trim() });
      await invalidateFinancialData(queryClient, { entities: ['drivers'] });
      setName('');
    } catch (err) {
      Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  if (!askName) return null;
  return (
    <View>
      {!nameFormOpen && (
        <Pressable
          onPress={() => setNameFormOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: spacing.sm,
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radii.md,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: '#ffffff', fontWeight: '700' }}>✍️ {t('drivers.carrierPayroll.whoIs', { code: driver.carrier_driver_code ?? '' })}</Text>
        </Pressable>
      )}
      {nameFormOpen && (
        <View style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('drivers.carrierPayroll.whoIs', { code: driver.carrier_driver_code ?? '' })}</Text>
          <MutedText>{t('drivers.carrierPayroll.whoIsBody', { code: driver.carrier_driver_code ?? '' })}</MutedText>
          <Field value={name} onChangeText={setName} placeholder={t('drivers.carrierPayroll.namePlaceholder')} />
          <PrimaryButton title={t('common.save')} onPress={saveName} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setNameFormOpen(false)} />
        </View>
      )}
    </View>
  );
}

// CARRIER PAYROLL DRIVER (owner 2026-11-13, §88): read-only summary, shown
// in the driver detail sheet (owner 2026-11-24).
function CarrierPayrollCard({ driver, payments, teamBySettlement }: { driver: Driver; payments: DriverPayment[]; teamBySettlement: Map<string, boolean> }) {
  const { t } = useTranslation();
  const { money, date: fmtDate } = useFormatters();
  const summary = useMemo(() => carrierPayrollSummary(payments, driver.id, todayDateOnly()), [payments, driver.id]);
  const team = summary.latest?.settlementId ? teamBySettlement.get(summary.latest.settlementId) === true : false;

  const row = (label: string, value: number) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <MutedText>{label}</MutedText>
      <Text style={{ color: colors.text }}>{money(value)}</Text>
    </View>
  );
  const block = (title: string, totals: PayrollTotals) => (
    <View style={{ marginTop: spacing.xs }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{title}</Text>
      {row(t('drivers.carrierPayroll.wages'), totals.wages)}
      {row(t('drivers.carrierPayroll.employerTaxes'), totals.employerTaxes)}
      {row(t('drivers.carrierPayroll.workComp'), totals.workComp)}
      {row(t('drivers.carrierPayroll.total'), totals.total)}
    </View>
  );

  return (
    <View>
      <MutedText>
        {[
          t('drivers.carrierPayroll.code', { code: driver.carrier_driver_code ?? '' }),
          t('drivers.carrierPayroll.viaCarrier', { carrier: carrierDisplayName(driver.carrier) }),
          team ? t('drivers.carrierPayroll.team') : t('drivers.carrierPayroll.solo'),
        ].join(' · ')}
      </MutedText>
      {summary.latest && block(t('drivers.carrierPayroll.latestWeek', { date: fmtDate(summary.latest.date) }), summary.latest)}
      {block(t('drivers.carrierPayroll.ytd'), summary.ytd)}
      <MutedText style={{ marginTop: spacing.xs }}>{t('drivers.carrierPayroll.paidWeeks', { count: summary.paidWeeks })}</MutedText>
      <MutedText>{t('drivers.carrierPayroll.note')}</MutedText>
    </View>
  );
}

// DRIVER DETAIL (owner 2026-11-24, option a): READ-ONLY sheet opened by
// tapping a driver's name. Uses only data this screen already loads (the
// driver row, every driver_payments row, the trucks list, settlements for
// the team flag). No new query, no calculation: the payments line is the
// count and the newest row as stored; carrier-payroll drivers reuse the
// existing CarrierPayrollCard summary. Editing stays on the Edit button.
function DriverDetailSheet({
  driver,
  payments,
  truckLabel,
  teamBySettlement,
  onEdit,
  onPayments,
  onRemoveOrRestore,
  onClose,
}: {
  driver: Driver;
  payments: DriverPayment[];
  truckLabel: string | null;
  teamBySettlement: Map<string, boolean>;
  onEdit: () => void;
  onPayments: () => void;
  onRemoveOrRestore: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { money, number, date: fmtDate } = useFormatters();
  const own = useMemo(
    () => payments.filter((p) => p.driver_id === driver.id).sort((a, b) => compareDateOnly(b.date, a.date)),
    [payments, driver.id]
  );
  const line = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <MutedText style={{ flex: 1, marginEnd: spacing.sm }}>{label}</MutedText>
      <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
  return (
    <ModalSheet visible onClose={onClose}>
      <SheetTitle>
        {driver.name}
        {!driver.active ? ` ${t('drivers.formerTag')}` : ''}
      </SheetTitle>
      {line(t('drivers.compensationTypeLabel'), t(`drivers.compensationTypes.${driver.compensation_type}`))}
      {!driver.paid_via_carrier_payroll && line(t('drivers.payTypeLabel'), driver.pay_type ? t(`drivers.payTypes.${driver.pay_type}`) : '—')}
      {!driver.paid_via_carrier_payroll && line(t('drivers.payRateLabel'), driver.pay_rate != null ? number(driver.pay_rate) : '—')}
      {line(t('drivers.defaultTruckLabel'), truckLabel ?? t('drivers.detailNoTruck'))}
      {driver.paid_via_carrier_payroll ? (
        <View style={{ marginTop: spacing.sm }}>
          <CarrierPayrollCard driver={driver} payments={payments} teamBySettlement={teamBySettlement} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('drivers.payments')}</Text>
          {own.length === 0 ? (
            <MutedText>{t('drivers.paymentsEmpty')}</MutedText>
          ) : (
            <>
              <MutedText>{t('drivers.detailPaymentsCount', { count: own.length })}</MutedText>
              <MutedText>{t('drivers.detailLastPayment', { date: fmtDate(own[0].date), amount: money(own[0].gross_pay) })}</MutedText>
            </>
          )}
        </View>
      )}
      {/* Row buttons moved here (owner 2026-11-24): same handlers. */}
      {!driver.paid_via_carrier_payroll && <SecondaryButton title={t('drivers.payments')} onPress={onPayments} />}
      <PrimaryButton title={t('drivers.edit')} onPress={onEdit} />
      <SecondaryButton title={driver.active ? t('drivers.remove') : t('drivers.restore')} onPress={onRemoveOrRestore} />
      <SecondaryButton title={t('common.close')} onPress={onClose} />
    </ModalSheet>
  );
}

export default function Drivers() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { trucks } = useActiveTruck();
  const driversQuery = useDrivers();
  const allPaymentsQuery = useDriverPayments();
  const settlementsQuery = useSettlements();
  const teamBySettlement = useMemo(
    () => new Map((settlementsQuery.data ?? []).map((s) => [s.id, s.team_week === true])),
    [settlementsQuery.data]
  );
  const insertDriver = useInsertDriver();
  const taxYearDataQuery = useTaxYearData();
  const employerFicaRate = taxYearDataQuery.data?.data.se_tax.employer_fica;

  const [showInactive, setShowInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<Driver | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [paymentsFor, setPaymentsFor] = useState<Driver | null>(null);
  const [detailFor, setDetailFor] = useState<Driver | null>(null);
  const [saving, setSaving] = useState(false);

  const drivers = driversQuery.data ?? [];
  const visible = useMemo(() => drivers.filter((d) => (showInactive ? true : d.active)), [drivers, showInactive]);

  function formToValues(form: FormState) {
    return {
      name: form.name.trim(),
      phone: form.phone || null,
      license: form.license || null,
      compensation_type: form.compensation_type,
      pay_type: form.pay_type,
      pay_rate: form.pay_rate ? numOrNull(form.pay_rate) || null : null,
      default_truck_id: form.default_truck_id,
    };
  }

  async function handleAdd() {
    if (!userId) return;
    if (!addForm.name.trim()) {
      Alert.alert(t('drivers.enterNameTitle'));
      return;
    }
    setSaving(true);
    try {
      await insertDriver.mutateAsync({ user_id: userId, ...formToValues(addForm) });
      await invalidateFinancialData(queryClient, { entities: ['drivers'] });
      setAddForm(emptyForm());
      setShowAddForm(false);
    } catch (err) {
      Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(d: Driver) {
    setEditing(d);
    setEditForm(driverToForm(d));
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await updateRowTolerant('drivers', editing.id, formToValues(editForm));
      await invalidateFinancialData(queryClient, { entities: ['drivers'] });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function showError(err: unknown) {
    Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
  }

  // REMOVE = former driver (batch A item 2, 2026-10-30): every settlement,
  // load, fuel row, deduction and payment that names the driver stays; the
  // driver leaves the pickers and the assigned truck. Restore brings them
  // back. This used to be a Deactivate toggle with no try/catch, so a
  // failed write was silent.
  function handleRemove(d: Driver) {
    Alert.alert(t('drivers.removeConfirmTitle', { name: d.name }), t('drivers.removeConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('drivers.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await updateRowTolerant('drivers', d.id, { ...REMOVE_DRIVER_VALUES });
            await invalidateFinancialData(queryClient, { entities: ['drivers'] });
            setEditing(null);
          } catch (err) {
            showError(err);
          }
        },
      },
    ]);
  }

  async function handleRestore(d: Driver) {
    try {
      await updateRowTolerant('drivers', d.id, { ...RESTORE_DRIVER_VALUES });
      await invalidateFinancialData(queryClient, { entities: ['drivers'] });
      setEditing(null);
    } catch (err) {
      showError(err);
    }
  }

  // A permanent delete only for a driver with no history at all; with
  // history (settlements, payments, ...) Remove is the only choice, so no
  // payroll record is ever cascade-deleted.
  async function handleDelete(d: Driver) {
    try {
      const history = await fetchDriverHistory(d.id);
      const total = driverHistoryTotal(history);
      if (total > 0) {
        Alert.alert(t('drivers.hasHistoryTitle'), t('drivers.hasHistoryBody', { count: total }));
        return;
      }
      Alert.alert(t('drivers.deleteConfirmTitle', { name: d.name }), t('drivers.deleteConfirmBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('drivers.deletePermanently'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDriverWithoutHistory(d.id);
              await invalidateFinancialData(queryClient, { entities: ['drivers'] });
              setEditing(null);
            } catch (err) {
              showError(err);
            }
          },
        },
      ]);
    } catch (err) {
      showError(err);
    }
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void, carrierPayroll = false) {
    return (
      <>
        <MutedText>{t('drivers.nameLabel')}</MutedText>
        <Field value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <MutedText>{t('drivers.phoneLabel')}</MutedText>
        <Field value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
        <MutedText>{t('drivers.licenseLabel')}</MutedText>
        <Field value={form.license} onChangeText={(v) => setForm({ ...form, license: v })} />

        {!carrierPayroll && (
          <>
        <MutedText>{t('drivers.compensationTypeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {COMPENSATION_TYPES.map((ct) => (
            <Pill key={ct} label={t(`drivers.compensationTypes.${ct}`)} selected={form.compensation_type === ct} onPress={() => setForm({ ...form, compensation_type: ct })} />
          ))}
        </View>

        <MutedText>{t('drivers.payTypeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PAY_TYPES.map((pt) => (
            <Pill key={pt} label={t(`drivers.payTypes.${pt}`)} selected={form.pay_type === pt} onPress={() => setForm({ ...form, pay_type: pt })} />
          ))}
        </View>
        <MutedText>{t('drivers.payRateLabel')}</MutedText>
        <Field keyboardType="numeric" value={form.pay_rate} onChangeText={(v) => setForm({ ...form, pay_rate: v })} placeholder="0.00" />
          </>
        )}

        {trucks.length > 0 && (
          <>
            <MutedText>{t('drivers.defaultTruckLabel')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {trucks.map((tr) => (
                <Pill
                  key={tr.id}
                  label={t('common.unit', { unit: tr.unit_number ?? tr.id })}
                  selected={form.default_truck_id === tr.id}
                  onPress={() => setForm({ ...form, default_truck_id: form.default_truck_id === tr.id ? null : tr.id })}
                />
              ))}
            </View>
          </>
        )}
      </>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('drivers.title')}</ScreenTitle>

        {driversQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <MutedText>{t('drivers.empty')}</MutedText>
          </Card>
        ) : (
          <Card>
            {visible.map((d, i) => (
              <View key={d.id} style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Pressable onPress={() => setDetailFor(d)} accessibilityRole="button" hitSlop={4}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18 }}>
                    {d.name}
                    {!d.active ? ` ${t('drivers.formerTag')}` : ''}
                    <Text style={{ color: colors.accent }}> ›</Text>
                  </Text>
                </Pressable>
                {/* LIST = NAME ONLY (owner 2026-11-24, tester feedback):
                    everything else is in the detail sheet. Exception: a
                    driver still named by payroll code keeps "Who is CODE?". */}
                {d.paid_via_carrier_payroll && <WhoIsCodeButton driver={d} />}
              </View>
            ))}
          </Card>
        )}

        <Pressable onPress={() => setShowInactive((v) => !v)} style={{ marginBottom: spacing.sm }}>
          <MutedText>{showInactive ? t('drivers.hideInactive') : t('drivers.showInactive')}</MutedText>
        </Pressable>

        <PrimaryButton title={t('drivers.addDriver')} onPress={() => setShowAddForm(true)} />
      </ScrollView>

      <ModalSheet visible={showAddForm} onClose={() => setShowAddForm(false)}>
        <SheetTitle>{t('drivers.addDriver')}</SheetTitle>
        {renderForm(addForm, setAddForm)}
        <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <SheetTitle>{t('drivers.editDriver')}</SheetTitle>
        {renderForm(editForm, setEditForm, !!editing?.paid_via_carrier_payroll)}
        <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        {editing && (
          <View style={{ marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
            <MutedText style={{ marginBottom: spacing.xs }}>{editing.active ? t('drivers.removeExplain') : t('drivers.restoreExplain')}</MutedText>
            <SecondaryButton
              title={editing.active ? t('drivers.remove') : t('drivers.restore')}
              onPress={() => (editing.active ? handleRemove(editing) : handleRestore(editing))}
            />
            <MutedText style={{ marginTop: spacing.md, marginBottom: spacing.xs, color: colors.red }}>{t('drivers.deleteExplain')}</MutedText>
            <SecondaryButton title={`🗑️ ${t('drivers.deletePermanently')}`} onPress={() => handleDelete(editing)} />
          </View>
        )}
      </ModalSheet>

      {detailFor && (
        <DriverDetailSheet
          driver={detailFor}
          payments={allPaymentsQuery.data ?? []}
          truckLabel={
            detailFor.default_truck_id
              ? t('common.unit', { unit: trucks.find((tr) => tr.id === detailFor.default_truck_id)?.unit_number ?? detailFor.default_truck_id })
              : null
          }
          teamBySettlement={teamBySettlement}
          onEdit={() => {
            const d = detailFor;
            setDetailFor(null);
            openEdit(d);
          }}
          onPayments={() => {
            const d = detailFor;
            setDetailFor(null);
            setPaymentsFor(d);
          }}
          onRemoveOrRestore={() => {
            // Close first: the same handleRemove/handleRestore (and the
            // existing confirmation) then run exactly as from the row.
            const d = detailFor;
            setDetailFor(null);
            if (d.active) handleRemove(d);
            else handleRestore(d);
          }}
          onClose={() => setDetailFor(null)}
        />
      )}
      {paymentsFor && <DriverPaymentsSheet driver={paymentsFor} employerFicaRate={employerFicaRate} onClose={() => setPaymentsFor(null)} />}
    </Screen>
  );
}
