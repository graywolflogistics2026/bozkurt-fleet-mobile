import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList, useInsertTruck, useUpdateTruck } from '@/src/data/trucks';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Truck } from '@/src/types/db';

type FormState = {
  unit_number: string;
  vin: string;
  year: string;
  make: string;
  model: string;
  engine: string;
  current_odometer: string;
};

function emptyForm(): FormState {
  return { unit_number: '', vin: '', year: '', make: '', model: '', engine: '', current_odometer: '' };
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
  };
}

export default function Trucks() {
  const { t } = useTranslation();
  const { number } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { refreshTrucks } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const insertTruck = useInsertTruck();
  const updateTruck = useUpdateTruck();

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
    };
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
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('trucks.addTruck')}</SheetTitle>
          {renderForm(addForm, setAddForm)}
          <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('trucks.editTruck')}</SheetTitle>
          {renderForm(editForm, setEditForm)}
          <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        </ScrollView>
      </ModalSheet>
    </Screen>
  );
}
