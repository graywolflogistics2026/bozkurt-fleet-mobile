import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useDashboardLayout, useUpdateDashboardLayout } from '@/src/data/dashboardLayout';
import { CARD_LABEL_KEYS, type DashboardCardConfig } from '@/src/stats/dashboardLayout';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// Reorder affordance is up/down buttons rather than touch-drag: no
// drag-and-drop library is installed in this project yet (would need
// react-native-gesture-handler on top of the reanimated already present),
// and this keeps reordering fully accessible/RTL-safe without adding an
// unverified native dependency in this pass. Swap for a real drag list
// later if desired — the persisted shape (ordered array) doesn't change.
export default function DashboardCustomize() {
  const { t } = useTranslation();
  const layoutQuery = useDashboardLayout();
  const updateLayout = useUpdateDashboardLayout();
  const [draft, setDraft] = useState<DashboardCardConfig[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (layoutQuery.data && !draft) setDraft(layoutQuery.data.layout);
  }, [layoutQuery.data, draft]);

  const rows = draft ?? [];

  function updateRow(index: number, patch: Partial<DashboardCardConfig>) {
    setDraft((current) => {
      if (!current) return current;
      const copy = [...current];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  }

  function moveRow(index: number, direction: -1 | 1) {
    setDraft((current) => (current ? move(current, index, index + direction) : current));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await updateLayout.mutateAsync(draft);
      Alert.alert(t('dashboardCustomize.savedTitle'));
    } catch (err) {
      Alert.alert(t('dashboardCustomize.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await updateLayout.mutateAsync(null);
      setDraft(null);
      layoutQuery.refetch();
    } catch (err) {
      Alert.alert(t('dashboardCustomize.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('dashboardCustomize.title')}</ScreenTitle>
        <MutedText>{t('dashboardCustomize.subtitle')}</MutedText>

        {layoutQuery.isLoading || !draft ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <Card>
            {rows.map((row, i) => (
              <CardEditor
                key={row.id}
                row={row}
                index={i}
                total={rows.length}
                defaultLabel={t(CARD_LABEL_KEYS[row.id as keyof typeof CARD_LABEL_KEYS] ?? row.id)}
                onToggleVisible={() => updateRow(i, { visible: !row.visible })}
                onLabelChange={(label) => updateRow(i, { label: label || null })}
                onMoveUp={() => moveRow(i, -1)}
                onMoveDown={() => moveRow(i, 1)}
              />
            ))}
          </Card>
        )}

        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSave} loading={saving} disabled={!draft} />
        <SecondaryButton title={t('dashboardCustomize.resetToDefault')} onPress={handleReset} />
      </ScrollView>
    </Screen>
  );
}

function CardEditor({
  row,
  index,
  total,
  defaultLabel,
  onToggleVisible,
  onLabelChange,
  onMoveUp,
  onMoveDown,
}: {
  row: DashboardCardConfig;
  index: number;
  total: number;
  defaultLabel: string;
  onToggleVisible: () => void;
  onLabelChange: (label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.cardRow, index > 0 && styles.rowBorder]}>
      <View style={styles.reorderButtons}>
        <Pressable onPress={onMoveUp} disabled={index === 0} hitSlop={8}>
          <Text style={[styles.reorderArrow, index === 0 && styles.reorderArrowDisabled]}>▲</Text>
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={index === total - 1} hitSlop={8}>
          <Text style={[styles.reorderArrow, index === total - 1 && styles.reorderArrowDisabled]}>▼</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, marginStart: spacing.sm }}>
        <MutedText>{defaultLabel}</MutedText>
        <Field
          value={row.label ?? ''}
          onChangeText={onLabelChange}
          placeholder={t('dashboardCustomize.labelPlaceholder', { defaultLabel })}
          style={{ marginTop: spacing.xs, marginBottom: 0 }}
        />
      </View>

      <Pressable
        onPress={onToggleVisible}
        hitSlop={8}
        style={[styles.visibilityPill, row.visible ? styles.visibilityOn : styles.visibilityOff]}
      >
        <Text style={{ color: colors.text, fontSize: typography.size.xs, fontWeight: '700' }}>
          {row.visible ? t('dashboardCustomize.visible') : t('dashboardCustomize.hidden')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = {
  cardRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reorderButtons: {
    alignItems: 'center' as const,
  },
  reorderArrow: {
    color: colors.accent,
    fontSize: typography.size.sm,
    paddingVertical: 2,
  },
  reorderArrowDisabled: {
    color: colors.border,
  },
  visibilityPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    marginStart: spacing.sm,
  },
  visibilityOn: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  visibilityOff: {
    backgroundColor: 'rgba(139,147,167,0.15)',
  },
};
