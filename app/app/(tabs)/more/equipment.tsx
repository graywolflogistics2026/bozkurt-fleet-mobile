import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useEquipment, useInsertEquipment, useUpdateEquipment, useDeleteEquipment } from '@/src/data/equipment';
import { useLoanRows, useInsertLoanRow } from '@/src/data/loans';
import { AssetFinancingFields, emptyAssetFinancing, type AssetFinancingValue } from '@/src/components/AssetFinancingFields';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Equipment, LoanInsert } from '@/src/types/db';

// ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
// DECISION) — "unlimited other equipment" beyond trucks/trailers
// (generators, reefer units, tools financed on their own note). Same
// list/add/edit shape as trucks.tsx, minus the retire/reactivate concept
// (equipment is simply deleted, no history worth preserving the way a
// truck's settlements/fuel/maintenance are).
type FormState = {
  name: string;
  category: string;
  notes: string;
  financing: AssetFinancingValue;
};

function emptyForm(): FormState {
  return { name: '', category: '', notes: '', financing: emptyAssetFinancing() };
}

function equipmentToForm(e: Equipment): FormState {
  return {
    name: e.name,
    category: e.category ?? '',
    notes: e.notes ?? '',
    financing: {
      purchase_price: e.purchase_price != null ? String(e.purchase_price) : '',
      purchase_date: e.purchase_date ?? '',
      financing: e.financing ?? '',
      loan_id: e.loan_id,
    },
  };
}

export default function EquipmentScreen() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const equipmentQuery = useEquipment();
  const insertEquipment = useInsertEquipment();
  const updateEquipment = useUpdateEquipment();
  const deleteEquipment = useDeleteEquipment();
  const loansQuery = useLoanRows();
  const insertLoan = useInsertLoanRow();
  const loans = loansQuery.data ?? [];

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const rows = equipmentQuery.data ?? [];

  function formToValues(form: FormState) {
    return {
      name: form.name.trim(),
      category: form.category || null,
      notes: form.notes || null,
      purchase_price: form.financing.purchase_price ? Number(form.financing.purchase_price) || null : null,
      purchase_date: form.financing.purchase_date || null,
      financing: form.financing.financing || null,
      loan_id: form.financing.financing === 'loan' ? form.financing.loan_id : null,
    };
  }

  async function createLoan(fields: Omit<LoanInsert, 'user_id'>) {
    if (!userId) throw new Error('Not signed in');
    return insertLoan.mutateAsync({ user_id: userId, ...fields });
  }

  async function handleAdd() {
    if (!userId) return;
    if (!addForm.name.trim()) {
      Alert.alert(t('equipmentScreen.enterNameTitle'));
      return;
    }
    setSaving(true);
    try {
      await insertEquipment.mutateAsync({ user_id: userId, ...formToValues(addForm) });
      setAddForm(emptyForm());
      setShowAddForm(false);
    } catch (err) {
      Alert.alert(t('equipmentScreen.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(e: Equipment) {
    setEditing(e);
    setEditForm(equipmentToForm(e));
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await updateEquipment.mutateAsync({ id: editing.id, values: formToValues(editForm) });
      setEditing(null);
    } catch (err) {
      Alert.alert(t('equipmentScreen.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(e: Equipment) {
    Alert.alert(t('equipmentScreen.deleteConfirmTitle'), t('equipmentScreen.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEquipment.mutateAsync(e.id);
            setEditing(null);
          } catch (err) {
            Alert.alert(t('equipmentScreen.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
          }
        },
      },
    ]);
  }

  function renderForm(form: FormState, setForm: (f: FormState) => void) {
    return (
      <>
        <MutedText>{t('equipmentScreen.nameLabel')}</MutedText>
        <Field value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder={t('equipmentScreen.namePlaceholder')} />
        <MutedText>{t('equipmentScreen.categoryLabel')}</MutedText>
        <Field value={form.category} onChangeText={(v) => setForm({ ...form, category: v })} placeholder={t('equipmentScreen.categoryPlaceholder')} />
        <AssetFinancingFields
          value={form.financing}
          onChange={(financing) => setForm({ ...form, financing })}
          loans={loans}
          onCreateLoan={createLoan}
        />
        <MutedText>{t('equipmentScreen.notesLabel')}</MutedText>
        <Field value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} />
      </>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('equipmentScreen.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('equipmentScreen.subtitle')}</MutedText>

        {equipmentQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <MutedText>{t('equipmentScreen.empty')}</MutedText>
          </Card>
        ) : (
          <Card>
            {rows.map((e, i) => (
              <Pressable
                key={e.id}
                onPress={() => openEdit(e)}
                style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{e.name}</Text>
                    <MutedText>{e.category || '—'}</MutedText>
                  </View>
                  {e.purchase_price != null && <Text style={{ color: colors.text, fontWeight: '700' }}>{money(e.purchase_price)}</Text>}
                </View>
              </Pressable>
            ))}
          </Card>
        )}

        <PrimaryButton title={t('equipmentScreen.addEquipment')} onPress={() => setShowAddForm(true)} />
      </ScrollView>

      <ModalSheet visible={showAddForm} onClose={() => setShowAddForm(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('equipmentScreen.addEquipment')}</SheetTitle>
          {renderForm(addForm, setAddForm)}
          <PrimaryButton title={t('common.save')} onPress={handleAdd} loading={saving} />
          <SecondaryButton title={t('common.cancel')} onPress={() => setShowAddForm(false)} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={() => setEditing(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <SheetTitle>{t('equipmentScreen.editEquipment')}</SheetTitle>
          {editing && renderForm(editForm, setEditForm)}
          <PrimaryButton title={t('common.save')} onPress={handleSaveEdit} loading={saving} />
          {editing && <SecondaryButton title={`🗑 ${t('common.delete')}`} onPress={() => handleDelete(editing)} />}
          <SecondaryButton title={t('common.cancel')} onPress={() => setEditing(null)} />
        </ScrollView>
      </ModalSheet>
    </Screen>
  );
}
