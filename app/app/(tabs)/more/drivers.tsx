import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useDrivers, useInsertDriver, useUpdateDriver } from '@/src/data/drivers';
import { useDriverPayments, useInsertDriverPayment } from '@/src/data/driverPayments';
import { useTaxYearData } from '@/src/data/taxYearData';
import { calcTrueCostOfEmployee, calcW2EmployerTaxes } from '@/src/tax/driverPayroll';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { CompensationType, Driver } from '@/src/types/db';

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
  const paymentsQuery = useDriverPayments({ driver_id: driver.id });
  const insertPayment = useInsertDriverPayment();

  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [grossPay, setGrossPay] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const payments = useMemo(
    () => [...(paymentsQuery.data ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [paymentsQuery.data]
  );

  async function handleAdd() {
    if (!userId) return;
    const gross = Number(grossPay) || 0;
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
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
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
      </ScrollView>
    </ModalSheet>
  );
}

export default function Drivers() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { trucks } = useActiveTruck();
  const driversQuery = useDrivers();
  const insertDriver = useInsertDriver();
  const updateDriver = useUpdateDriver();
  const taxYearDataQuery = useTaxYearData();
  const employerFicaRate = taxYearDataQuery.data?.data.se_tax.employer_fica;

  const [showInactive, setShowInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<Driver | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [paymentsFor, setPaymentsFor] = useState<Driver | null>(null);
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
      pay_rate: form.pay_rate ? Number(form.pay_rate) || null : null,
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
      await updateDriver.mutateAsync({ id: editing.id, values: formToValues(editForm) });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('drivers.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  // "active" toggle is the retire equivalent — no delete from the UI,
  // drivers can have settlement/payment history (PROMPTS.md Session 8).
  async function handleToggleActive(d: Driver) {
    await updateDriver.mutateAsync({ id: d.id, values: { active: !d.active } });
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void) {
    return (
      <>
        <MutedText>{t('drivers.nameLabel')}</MutedText>
        <Field value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
        <MutedText>{t('drivers.phoneLabel')}</MutedText>
        <Field value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
        <MutedText>{t('drivers.licenseLabel')}</MutedText>
        <Field value={form.license} onChangeText={(v) => setForm({ ...form, license: v })} />

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
                <Pressable onPress={() => openEdit(d)}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {d.name}
                    {!d.active ? ` ${t('drivers.inactiveTag')}` : ''}
                  </Text>
                  <MutedText>{t(`drivers.compensationTypes.${d.compensation_type}`)}</MutedText>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                  <SecondaryButton title={t('drivers.payments')} onPress={() => setPaymentsFor(d)} />
                  <SecondaryButton title={d.active ? t('drivers.deactivate') : t('drivers.reactivate')} onPress={() => handleToggleActive(d)} />
                </View>
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
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('drivers.addDriver')}</SheetTitle>
          {renderForm(addForm, setAddForm)}
          <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('drivers.editDriver')}</SheetTitle>
          {renderForm(editForm, setEditForm)}
          <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        </ScrollView>
      </ModalSheet>

      {paymentsFor && <DriverPaymentsSheet driver={paymentsFor} employerFicaRate={employerFicaRate} onClose={() => setPaymentsFor(null)} />}
    </Screen>
  );
}
