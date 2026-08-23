import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList, useInsertTruck, useUpdateTruck } from '@/src/data/trucks';
import { useLoanRows, useInsertLoanRow } from '@/src/data/loans';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { AssetFinancingFields, emptyAssetFinancing, type AssetFinancingValue } from '@/src/components/AssetFinancingFields';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { LoanInsert, Truck } from '@/src/types/db';

type FormState = {
  unit_number: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  engine: string;
  current_odometer: string;
  // ASSET PURCHASE & FINANCING (owner decision 2026-07-30) — the tractor's
  // own purchase/financing, and the trailer's own (independent), even
  // though both live in this one truck row.
  financing: AssetFinancingValue;
  trailer_unit_number: string;
  trailerFinancing: AssetFinancingValue;
  // TRUCK COST BASIS (owner decision 2026-08-05, FULL PARITY follow-up
  // item C.1) — feeds the Scorecard CPM "Why?" breakdown's fixed truck
  // payment. See app/src/stats/truckCostBasis.ts.
  costBasisOwnershipMode: 'paid' | 'loan' | 'lease' | '';
  costBasisLoanMonthlyPayment: string;
  costBasisPaidSpreadMonths: string;
  costBasisWarrantyCost: string;
  costBasisWarrantyTermMonths: string;
};

function emptyForm(): FormState {
  return {
    unit_number: '',
    vin: '',
    year: '',
    make: '',
    model: '',
    engine: '',
    current_odometer: '',
    financing: emptyAssetFinancing(),
    trailer_unit_number: '',
    trailerFinancing: emptyAssetFinancing(),
    costBasisOwnershipMode: '',
    costBasisLoanMonthlyPayment: '',
    costBasisPaidSpreadMonths: '',
    costBasisWarrantyCost: '',
    costBasisWarrantyTermMonths: '',
  };
}

function truckToForm(t: Truck): FormState {
  return {
    unit_number: t.unit_number ?? '',
    vin: t.vin ?? '',
    year: t.year != null ? String(t.year) : '',
    make: t.make ?? '',
    model: t.model ?? '',
    engine: t.engine ?? '',
    current_odometer: t.current_odometer != null ? String(t.current_odometer) : '',
    financing: {
      purchase_price: t.purchase_price != null ? String(t.purchase_price) : '',
      purchase_date: t.purchase_date ?? '',
      financing: t.financing ?? '',
      loan_id: t.loan_id,
    },
    trailer_unit_number: t.trailer_unit_number ?? '',
    trailerFinancing: {
      purchase_price: t.trailer_purchase_price != null ? String(t.trailer_purchase_price) : '',
      purchase_date: t.trailer_purchase_date ?? '',
      financing: t.trailer_financing ?? '',
      loan_id: t.trailer_loan_id,
    },
    costBasisOwnershipMode: t.cost_basis_ownership_mode ?? '',
    costBasisLoanMonthlyPayment: t.cost_basis_loan_monthly_payment != null ? String(t.cost_basis_loan_monthly_payment) : '',
    costBasisPaidSpreadMonths: t.cost_basis_paid_spread_months != null ? String(t.cost_basis_paid_spread_months) : '',
    costBasisWarrantyCost: t.cost_basis_warranty_cost != null ? String(t.cost_basis_warranty_cost) : '',
    costBasisWarrantyTermMonths: t.cost_basis_warranty_term_months != null ? String(t.cost_basis_warranty_term_months) : '',
  };
}

export default function Trucks() {
  const { t } = useTranslation();
  const { number } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { refreshTrucks } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const insertTruck = useInsertTruck();
  const updateTruck = useUpdateTruck();
  const loansQuery = useLoanRows();
  const insertLoan = useInsertLoanRow();
  const loans = loansQuery.data ?? [];

  const [showRetired, setShowRetired] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<Truck | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const trucks = trucksQuery.data ?? [];
  const visible = useMemo(() => trucks.filter((tr) => (showRetired ? true : tr.is_active)), [trucks, showRetired]);

  function formToValues(form: FormState) {
    return {
      unit_number: form.unit_number || null,
      vin: form.vin || null,
      year: form.year ? Number(form.year) || null : null,
      make: form.make || null,
      model: form.model || null,
      engine: form.engine || null,
      current_odometer: form.current_odometer ? Number(form.current_odometer) || null : null,
      purchase_price: form.financing.purchase_price ? Number(form.financing.purchase_price) || null : null,
      purchase_date: form.financing.purchase_date || null,
      financing: form.financing.financing || null,
      loan_id: form.financing.financing === 'loan' ? form.financing.loan_id : null,
      trailer_unit_number: form.trailer_unit_number || null,
      trailer_purchase_price: form.trailerFinancing.purchase_price ? Number(form.trailerFinancing.purchase_price) || null : null,
      trailer_purchase_date: form.trailerFinancing.purchase_date || null,
      trailer_financing: form.trailerFinancing.financing || null,
      trailer_loan_id: form.trailerFinancing.financing === 'loan' ? form.trailerFinancing.loan_id : null,
      cost_basis_ownership_mode: form.costBasisOwnershipMode || null,
      cost_basis_loan_monthly_payment: form.costBasisLoanMonthlyPayment ? Number(form.costBasisLoanMonthlyPayment) || null : null,
      cost_basis_paid_spread_months: form.costBasisPaidSpreadMonths ? Number(form.costBasisPaidSpreadMonths) || null : null,
      cost_basis_warranty_cost: form.costBasisWarrantyCost ? Number(form.costBasisWarrantyCost) || null : null,
      cost_basis_warranty_term_months: form.costBasisWarrantyTermMonths ? Number(form.costBasisWarrantyTermMonths) || null : null,
    };
  }

  async function createLoan(fields: Omit<LoanInsert, 'user_id'>) {
    if (!userId) throw new Error('Not signed in');
    return insertLoan.mutateAsync({ user_id: userId, ...fields });
  }

  async function handleAdd() {
    if (!userId) return;
    if (!addForm.unit_number.trim()) {
      Alert.alert(t('trucks.enterUnitTitle'));
      return;
    }
    setSaving(true);
    try {
      // Creating a truck seeds its maintenance_intervals via the DB
      // trigger (CLAUDE.md invariant #4) — same path as the legacy-backup
      // importer's ensureTruck() and the import-preview "+ New Truck"
      // inline-create.
      await insertTruck.mutateAsync({ user_id: userId, ...formToValues(addForm) });
      await refreshTrucks();
      await invalidateFinancialData(queryClient);
      setAddForm(emptyForm());
      setShowAddForm(false);
    } catch (err) {
      Alert.alert(t('trucks.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(tr: Truck) {
    setEditing(tr);
    setEditForm(truckToForm(tr));
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await updateTruck.mutateAsync({ id: editing.id, values: formToValues(editForm) });
      await refreshTrucks();
      // ONE REFRESH PATH (owner decision 2026-08-05, FULL PARITY follow-up
      // item A) — a truck's cost basis (purchase_price/financing/loan_id)
      // feeds the CPM "Why?" breakdown and depreciation election; refreshTrucks()
      // above only refetches ActiveTruckContext's own narrower state, it
      // never touches react-query's cache for Scorecard/CEO Mode/Profit
      // Analysis's own already-fetched 'trucks'/'loans' queries.
      await invalidateFinancialData(queryClient);
      setEditing(null);
    } catch (err) {
      Alert.alert(t('trucks.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function handleRetire(tr: Truck) {
    Alert.alert(t('trucks.retireConfirmTitle'), t('trucks.retireConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trucks.retire'),
        style: 'destructive',
        onPress: async () => {
          try {
            // Never delete — a retired truck keeps every settlement/fuel/
            // maintenance record it ever had (CLAUDE.md invariant #7).
            await updateTruck.mutateAsync({ id: tr.id, values: { is_active: false } });
            await refreshTrucks();
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('trucks.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
          }
        },
      },
    ]);
  }

  async function handleReactivate(tr: Truck) {
    await updateTruck.mutateAsync({ id: tr.id, values: { is_active: true } });
    await refreshTrucks();
    await invalidateFinancialData(queryClient);
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void) {
    return (
      <>
        <MutedText>{t('trucks.unitLabel')}</MutedText>
        <Field value={form.unit_number} onChangeText={(v) => setForm({ ...form, unit_number: v })} />
        <MutedText>{t('trucks.vinLabel')}</MutedText>
        <Field value={form.vin} onChangeText={(v) => setForm({ ...form, vin: v })} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <MutedText>{t('trucks.yearLabel')}</MutedText>
            <Field keyboardType="numeric" value={form.year} onChangeText={(v) => setForm({ ...form, year: v })} />
          </View>
          <View style={{ flex: 2 }}>
            <MutedText>{t('trucks.makeLabel')}</MutedText>
            <Field value={form.make} onChangeText={(v) => setForm({ ...form, make: v })} />
          </View>
        </View>
        <MutedText>{t('trucks.modelLabel')}</MutedText>
        <Field value={form.model} onChangeText={(v) => setForm({ ...form, model: v })} />
        <MutedText>{t('trucks.engineLabel')}</MutedText>
        <Field value={form.engine} onChangeText={(v) => setForm({ ...form, engine: v })} />
        <MutedText>{t('trucks.odometerLabel')}</MutedText>
        <Field keyboardType="numeric" value={form.current_odometer} onChangeText={(v) => setForm({ ...form, current_odometer: v })} />

        <Text style={styles.sectionTitle}>{t('trucks.purchaseFinancingTitle')}</Text>
        <AssetFinancingFields
          value={form.financing}
          onChange={(financing) => setForm({ ...form, financing })}
          loans={loans}
          onCreateLoan={createLoan}
        />

        <Text style={styles.sectionTitle}>{t('trucks.trailerSectionTitle')}</Text>
        <MutedText>{t('trucks.trailerUnitLabel')}</MutedText>
        <Field value={form.trailer_unit_number} onChangeText={(v) => setForm({ ...form, trailer_unit_number: v })} />
        <AssetFinancingFields
          value={form.trailerFinancing}
          onChange={(trailerFinancing) => setForm({ ...form, trailerFinancing })}
          loans={loans}
          onCreateLoan={createLoan}
        />

        <Text style={styles.sectionTitle}>{t('trucks.costBasisTitle')}</Text>
        <MutedText>{t('trucks.costBasisNote')}</MutedText>
        <MutedText>{t('trucks.costBasisOwnershipModeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.xs }}>
          {(['paid', 'loan', 'lease'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setForm({ ...form, costBasisOwnershipMode: option })}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: form.costBasisOwnershipMode === option ? colors.accent : colors.border,
                backgroundColor: form.costBasisOwnershipMode === option ? colors.accent : colors.card2,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>{t(`trucks.ownershipMode.${option}`)}</Text>
            </Pressable>
          ))}
        </View>
        {form.costBasisOwnershipMode === 'loan' && (
          <>
            <MutedText>{t('trucks.costBasisLoanMonthlyPaymentLabel')}</MutedText>
            <Field
              keyboardType="numeric"
              value={form.costBasisLoanMonthlyPayment}
              onChangeText={(v) => setForm({ ...form, costBasisLoanMonthlyPayment: v })}
              placeholder="0"
            />
          </>
        )}
        {form.costBasisOwnershipMode === 'paid' && (
          <>
            <MutedText>{t('trucks.costBasisPaidSpreadMonthsLabel')}</MutedText>
            <Field
              keyboardType="numeric"
              value={form.costBasisPaidSpreadMonths}
              onChangeText={(v) => setForm({ ...form, costBasisPaidSpreadMonths: v })}
              placeholder="60"
            />
          </>
        )}
        {form.costBasisOwnershipMode === 'lease' && <MutedText>{t('trucks.costBasisLeaseNote')}</MutedText>}
        <MutedText>{t('trucks.costBasisWarrantyCostLabel')}</MutedText>
        <Field
          keyboardType="numeric"
          value={form.costBasisWarrantyCost}
          onChangeText={(v) => setForm({ ...form, costBasisWarrantyCost: v })}
          placeholder="0"
        />
        <MutedText>{t('trucks.costBasisWarrantyTermMonthsLabel')}</MutedText>
        <Field
          keyboardType="numeric"
          value={form.costBasisWarrantyTermMonths}
          onChangeText={(v) => setForm({ ...form, costBasisWarrantyTermMonths: v })}
          placeholder="0"
        />
      </>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('trucks.title')}</ScreenTitle>

        {trucksQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <MutedText>{t('trucks.empty')}</MutedText>
          </Card>
        ) : (
          <Card>
            {visible.map((tr, i) => (
              <Pressable
                key={tr.id}
                onPress={() => openEdit(tr)}
                style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      {t('common.unit', { unit: tr.unit_number ?? tr.id })}
                      {!tr.is_active ? ` ${t('trucks.retiredTag')}` : ''}
                    </Text>
                    <MutedText>
                      {[tr.year, tr.make, tr.model].filter(Boolean).join(' ') || '—'}
                    </MutedText>
                    {tr.current_odometer != null && <MutedText>{number(tr.current_odometer)} {t('truckHealth.milesUnit')}</MutedText>}
                  </View>
                  {tr.is_active ? (
                    <SecondaryButton title={t('trucks.retire')} onPress={() => handleRetire(tr)} />
                  ) : (
                    <SecondaryButton title={t('trucks.reactivate')} onPress={() => handleReactivate(tr)} />
                  )}
                </View>
              </Pressable>
            ))}
          </Card>
        )}

        <Pressable onPress={() => setShowRetired((v) => !v)} style={{ marginBottom: spacing.sm }}>
          <MutedText>{showRetired ? t('trucks.hideRetired') : t('trucks.showRetired')}</MutedText>
        </Pressable>

        <PrimaryButton title={t('trucks.addTruck')} onPress={() => setShowAddForm(true)} />
      </ScrollView>

      <ModalSheet visible={showAddForm} onClose={() => setShowAddForm(false)}>
        <SheetTitle>{t('trucks.addTruck')}</SheetTitle>
        {renderForm(addForm, setAddForm)}
        <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <SheetTitle>{t('trucks.editTruck')}</SheetTitle>
        {renderForm(editForm, setEditForm)}
        <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
};
