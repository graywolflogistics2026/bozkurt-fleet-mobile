import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useCategoryOptions, useInsertUserCategory } from '@/src/data/userCategories';
import { applyScheduleCDefault, CANONICAL_CATEGORIES, DEFAULT_SCHEDULE_C_BUCKET } from '@/src/import/category';
import { ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

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

// The ONE category picker UI (PROMPTS.md Session 9a item 9, CLAUDE.md
// invariant #19) — wires app/src/data/userCategories.ts's
// useCategoryOptions()/applyScheduleCDefault() into every category-heavy
// screen (deduction edit, manual add, import preview) instead of each
// hand-rolling its own pill list + "+ New category" flow. Canonical +
// active custom categories render together as one merged pill list (never
// two separate un-mergeable lists); the inline "+ New category" sheet asks
// for a Schedule C bucket for expense categories only (tax safety rail —
// defaults to "Misc" if the user doesn't pick one, enforced again by a DB
// check constraint, not just this UI).
export function CategoryPicker({
  kind,
  value,
  onChange,
}: {
  kind: 'income' | 'expense';
  value: string;
  onChange: (category: string) => void;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const options = useCategoryOptions(kind);
  const insertCategory = useInsertUserCategory();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBucket, setNewBucket] = useState<string>(DEFAULT_SCHEDULE_C_BUCKET);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setNewName('');
    setNewBucket(DEFAULT_SCHEDULE_C_BUCKET);
    setCreating(true);
  }

  async function handleCreate() {
    if (!userId || !newName.trim()) return;
    setSaving(true);
    try {
      const values = applyScheduleCDefault({
        user_id: userId,
        name: newName.trim(),
        kind,
        schedule_c_bucket: kind === 'expense' ? newBucket : null,
      });
      const created = await insertCategory.mutateAsync(values);
      onChange(created.name);
      setCreating(false);
    } catch (err) {
      Alert.alert(t('categoryPicker.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map((c) => (
          <Pill key={c} label={c} selected={value === c} onPress={() => onChange(c)} />
        ))}
        <Pressable
          onPress={openCreate}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: radii.sm,
            borderWidth: 1,
            borderColor: colors.accent,
            borderStyle: 'dashed',
            marginEnd: spacing.xs,
            marginBottom: spacing.xs,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
            + {t('categoryPicker.newCategory')}
          </Text>
        </Pressable>
      </View>

      <ModalSheet visible={creating} onClose={() => setCreating(false)}>
        <SheetTitle>{t('categoryPicker.newCategoryTitle')}</SheetTitle>
        <MutedText>{t('categoryPicker.nameLabel')}</MutedText>
        <Field value={newName} onChangeText={setNewName} placeholder={t('categoryPicker.namePlaceholder')} />

        {kind === 'expense' && (
          <>
            <MutedText>{t('categoryPicker.bucketLabel')}</MutedText>
            <MutedText style={{ marginBottom: spacing.xs }}>{t('categoryPicker.bucketNote')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {CANONICAL_CATEGORIES.map((b) => (
                <Pill key={b} label={b} selected={newBucket === b} onPress={() => setNewBucket(b)} />
              ))}
            </View>
          </>
        )}

        <PrimaryButton title={t('common.create')} onPress={handleCreate} loading={saving} disabled={!newName.trim()} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setCreating(false)} />
      </ModalSheet>
    </>
  );
}
