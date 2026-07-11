import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList, useUpdateTruck } from '@/src/data/trucks';
import { useMaintenanceRecords, useInsertMaintenanceRecord, useUpdateMaintenanceRecord, useDeleteMaintenanceRecord } from '@/src/data/maintenanceRecords';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { MAINTENANCE_TYPES, MAINTENANCE_TYPE_ICON, type MaintenanceType } from '@/src/truck/categories';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { MaintenanceRecord } from '@/src/types/db';

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
  date: string;
  odometer: string;
  hours: string;
  type: MaintenanceType;
  vendor: string;
  invoice: string;
  description: string;
  total: string;
  covered: string;
};

function emptyForm(): FormState {
  return {
    date: new Date().toISOString().slice(0, 10),
    odometer: '',
    hours: '',
    type: 'general',
    vendor: '',
    invoice: '',
    description: '',
    total: '',
    covered: '',
  };
}

export default function Maintenance() {
  const { t } = useTranslation();
  const { money, date, number } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { activeTruckId } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const truck = useMemo(() => trucksQuery.data?.find((tr) => tr.id === activeTruckId) ?? null, [trucksQuery.data, activeTruckId]);

  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const insertRecord = useInsertMaintenanceRecord();
  const updateRecord = useUpdateMaintenanceRecord();
  const deleteRecord = useDeleteMaintenanceRecord();
  const updateTruck = useUpdateTruck();

  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRecord | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());

  const rows = useMemo(
    () => [...(recordsQuery.data ?? [])].sort((a, b) => new Date(b.service_date ?? 0).getTime() - new Date(a.service_date ?? 0).getTime()),
    [recordsQuery.data]
  );
  const totals = useMemo(() => {
    const total = rows.reduce((a, x) => a + (x.cost ?? 0), 0);
    return { total };
  }, [rows]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }

  // Bumps the truck's tracked current_odometer/apu_hours when a manually
  // entered record reports a HIGHER reading — CLAUDE.md/owner ask:
  // "latest odometer from any source drives all next-due math", same as
  // ai-import's mapExtraction.ts and legacy applyMaintToHealth().
  async function bumpTruckReading(odometer: number, hours: number, type: MaintenanceType) {
    if (!truck) return;
    const values: { current_odometer?: number; apu_hours?: number } = {};
    if (odometer > (truck.current_odometer ?? 0)) values.current_odometer = odometer;
    if (type === 'apu' && hours > (truck.apu_hours ?? 0)) values.apu_hours = hours;
    if (Object.keys(values).length > 0) await updateTruck.mutateAsync({ id: truck.id, values });
  }

  // Mirrors app/src/import/mapExtraction.ts mapMaintenance() — a non-zero
  // warranty-covered amount creates a linked reimbursement row, same as
  // the ai-import path, so manual entry and AI-import behave identically.
  async function createWarrantyReimbursement(desc: string, invoice: string, covered: number, recDate: string) {
    if (!userId || covered <= 0) return;
    await supabase.from('reimbursements').insert({
      user_id: userId,
      reimb_date: recDate,
      description: `Warranty — ${desc}`,
      reference: invoice || null,
      amount: covered,
    });
  }

  async function handleAdd() {
    if (!userId || !activeTruckId) return;
    const odometer = Number(addForm.odometer) || 0;
    const hours = Number(addForm.hours) || 0;
    const total = Number(addForm.total) || 0;
    const covered = Number(addForm.covered) || 0;
    if (total <= 0) {
      Alert.alert(t('maintenance.enterTotalTitle'));
      return;
    }
    setSaving(true);
    try {
      await insertRecord.mutateAsync({
        user_id: userId,
        truck_id: activeTruckId,
        service_date: addForm.date || new Date().toISOString().slice(0, 10),
        service_type: addForm.type,
        description: addForm.description || null,
        odometer: odometer || null,
        engine_hours: addForm.type === 'apu' ? hours || null : null,
        cost: total,
        vendor: addForm.vendor || null,
        invoice_number: addForm.invoice || null,
      });
      await bumpTruckReading(odometer, hours, addForm.type);
      await createWarrantyReimbursement(addForm.description || t(`maintenance.types.${addForm.type}`), addForm.invoice, covered, addForm.date);
      await invalidateFinancialData(queryClient);
      setAddForm(emptyForm());
      setShowAddForm(false);
    } catch (err) {
      Alert.alert(t('maintenance.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(rec: MaintenanceRecord) {
    setEditing(rec);
    setEditForm({
      date: rec.service_date ?? new Date().toISOString().slice(0, 10),
      odometer: rec.odometer != null ? String(rec.odometer) : '',
      hours: rec.engine_hours != null ? String(rec.engine_hours) : '',
      type: (rec.service_type as MaintenanceType) ?? 'general',
      vendor: rec.vendor ?? '',
      invoice: rec.invoice_number ?? '',
      description: rec.description ?? '',
      total: String(rec.cost ?? 0),
      covered: '',
    });
  }

  async function handleSaveEdit() {
    if (!editing) return;
    const odometer = Number(editForm.odometer) || 0;
    const hours = Number(editForm.hours) || 0;
    const total = Number(editForm.total) || 0;
    const covered = Number(editForm.covered) || 0;
    setSaving(true);
    try {
      await updateRecord.mutateAsync({
        id: editing.id,
        values: {
          service_date: editForm.date || null,
          service_type: editForm.type,
          description: editForm.description || null,
          odometer: odometer || null,
          engine_hours: editForm.type === 'apu' ? hours || null : null,
          cost: total,
          vendor: editForm.vendor || null,
          invoice_number: editForm.invoice || null,
        },
      });
      await bumpTruckReading(odometer, hours, editForm.type);
      await createWarrantyReimbursement(editForm.description || t(`maintenance.types.${editForm.type}`), editForm.invoice, covered, editForm.date);
      await invalidateFinancialData(queryClient);
      setEditing(null);
    } catch (err) {
      Alert.alert(t('maintenance.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(rec: MaintenanceRecord) {
    Alert.alert(t('maintenance.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            // truck_health.ts recomputes remaining-life from whatever
            // maintenance_records remain the next time the Truck Health
            // screen mounts/refetches — no separate "rebuild" step needed,
            // since it's a pure recompute over the current record set
            // rather than a derived/cached value (CLAUDE.md invariant #5:
            // deleting recomputes from remaining records).
            await deleteRecord.mutateAsync(rec.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('maintenance.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
          }
        },
      },
    ]);
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void) {
    return (
      <>
        <MutedText>{t('maintenance.dateLabel')}</MutedText>
        <Field value={form.date} onChangeText={(v) => setForm({ ...form, date: v })} placeholder="YYYY-MM-DD" />

        <MutedText>{t('maintenance.typeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {MAINTENANCE_TYPES.map((type) => (
            <Pill
              key={type}
              label={`${MAINTENANCE_TYPE_ICON[type]} ${t(`maintenance.types.${type}`)}`}
              selected={form.type === type}
              onPress={() => setForm({ ...form, type })}
            />
          ))}
        </View>

        <MutedText>{t('maintenance.odometerLabel')}</MutedText>
        <Field keyboardType="numeric" value={form.odometer} onChangeText={(v) => setForm({ ...form, odometer: v })} placeholder="0" />

        {form.type === 'apu' && (
          <>
            <MutedText>{t('maintenance.hoursLabel')}</MutedText>
            <Field keyboardType="numeric" value={form.hours} onChangeText={(v) => setForm({ ...form, hours: v })} placeholder="0" />
          </>
        )}

        <MutedText>{t('maintenance.vendorLabel')}</MutedText>
        <Field value={form.vendor} onChangeText={(v) => setForm({ ...form, vendor: v })} />

        <MutedText>{t('maintenance.invoiceLabel')}</MutedText>
        <Field value={form.invoice} onChangeText={(v) => setForm({ ...form, invoice: v })} />

        <MutedText>{t('maintenance.descriptionLabel')}</MutedText>
        <Field value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} />

        <MutedText>{t('maintenance.totalLabel')}</MutedText>
        <Field keyboardType="numeric" value={form.total} onChangeText={(v) => setForm({ ...form, total: v })} placeholder="0.00" />

        <MutedText>{t('maintenance.coveredLabel')}</MutedText>
        <Field keyboardType="numeric" value={form.covered} onChangeText={(v) => setForm({ ...form, covered: v })} placeholder="0.00" />
      </>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <ScreenTitle>{t('maintenance.title')}</ScreenTitle>

        <Card>
          <MutedText>{t('maintenance.totalSpent')}</MutedText>
          <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700' }}>{money(totals.total)}</Text>
        </Card>

        {recordsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <MutedText>{t('maintenance.empty')}</MutedText>
          </Card>
        ) : (
          <Card>
            {rows.map((rec, i) => (
              <Pressable
                key={rec.id}
                onPress={() => openEdit(rec)}
                style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      {MAINTENANCE_TYPE_ICON[(rec.service_type as MaintenanceType) ?? 'general']} {t(`maintenance.types.${rec.service_type ?? 'general'}`)}
                    </Text>
                    <MutedText>
                      {rec.service_date ? date(rec.service_date) : '—'} · {rec.odometer ? `${number(rec.odometer)} ${t('truckHealth.milesUnit')}` : '—'}
                    </MutedText>
                    {rec.description ? <MutedText>{rec.description}</MutedText> : null}
                    {rec.invoice_number ? <MutedText>{t('maintenance.invoiceLabel')}: {rec.invoice_number}</MutedText> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{money(rec.cost ?? 0)}</Text>
                    <Pressable onPress={() => handleDelete(rec)} hitSlop={8} style={{ marginTop: spacing.xs }}>
                      <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            ))}
          </Card>
        )}

        <PrimaryButton title={t('maintenance.addRecord')} onPress={() => setShowAddForm(true)} />
      </ScrollView>

      <ModalSheet visible={showAddForm} onClose={() => setShowAddForm(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('maintenance.addRecord')}</SheetTitle>
          {renderForm(addForm, setAddForm)}
          <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('maintenance.editRecord')}</SheetTitle>
          {renderForm(editForm, setEditForm)}
          <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        </ScrollView>
      </ModalSheet>
    </Screen>
  );
}
