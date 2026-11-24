import { useMemo, useState } from 'react';
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

// The "+ New category" form (name + Schedule C bucket for expenses), shared
// by CategoryPicker's own sheet and CategoryPickerSheet below, so there is
// exactly one way to create a custom category (invariant #19).
function NewCategoryForm({ kind, onCreated, onCancel }: { kind: 'income' | 'expense'; onCreated: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const insertCategory = useInsertUserCategory();
  const [newName, setNewName] = useState('');
  const [newBucket, setNewBucket] = useState<string>(DEFAULT_SCHEDULE_C_BUCKET);
  const [saving, setSaving] = useState(false);

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
      onCreated(created.name);
    } catch (err) {
      Alert.alert(t('categoryPicker.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
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
      <SecondaryButton title={t('common.cancel')} onPress={onCancel} />
    </>
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
  const options = useCategoryOptions(kind);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map((c) => (
          <Pill key={c} label={c} selected={value === c} onPress={() => onChange(c)} />
        ))}
        <Pressable
          onPress={() => setCreating(true)}
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
        {creating && (
          <NewCategoryForm
            kind={kind}
            onCreated={(name) => {
              onChange(name);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </ModalSheet>
    </>
  );
}

// Search appears only when the list is long enough to need it.
const SEARCH_MIN_OPTIONS = 10;

// Pop-up version of the same picker (owner 2026-11-24, import Yes/No card):
// every category (canonical + the user's own) in one big scrollable list,
// the suggested one first and marked, a search field for long lists and
// "+ Create a category" at the bottom (same NewCategoryForm, shown inside
// this sheet so no modal opens on top of another). Tapping a row selects it
// and closes; closing without a tap changes nothing.
export function CategoryPickerSheet({
  visible,
  kind,
  value,
  suggested,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  kind: 'income' | 'expense';
  value: string;
  suggested: string | null;
  title: string;
  onSelect: (category: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const options = useCategoryOptions(kind);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const ordered = useMemo(() => {
    const rest = options.filter((c) => c !== suggested);
    return suggested ? [suggested, ...rest] : rest;
  }, [options, suggested]);
  const q = search.trim().toLowerCase();
  const shown = q ? ordered.filter((c) => c.toLowerCase().includes(q)) : ordered;

  function close() {
    setSearch('');
    setCreating(false);
    onClose();
  }
  function pick(category: string) {
    setSearch('');
    setCreating(false);
    onSelect(category);
  }

  return (
    <ModalSheet visible={visible} onClose={close}>
      {creating ? (
        <NewCategoryForm kind={kind} onCreated={pick} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <SheetTitle>{title}</SheetTitle>
          {ordered.length >= SEARCH_MIN_OPTIONS && (
            <Field value={search} onChangeText={setSearch} placeholder={t('categoryPicker.searchPlaceholder')} />
          )}
          {shown.map((c) => {
            const selected = c === value;
            return (
              <Pressable
                key={c}
                onPress={() => pick(c)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  marginBottom: spacing.xs,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accent : colors.card2,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ flex: 1, color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>{c}</Text>
                {c === suggested && (
                  <Text style={{ color: selected ? colors.text : colors.accent, fontSize: typography.size.xs, fontWeight: '700', marginStart: spacing.sm }}>
                    {t('categoryPicker.suggested')}
                  </Text>
                )}
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setCreating(true)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 52,
              justifyContent: 'center',
              paddingHorizontal: spacing.md,
              marginTop: spacing.xs,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: colors.accent,
              borderStyle: 'dashed',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>{t('categoryPicker.createCategory')}</Text>
          </Pressable>
        </>
      )}
    </ModalSheet>
  );
}
