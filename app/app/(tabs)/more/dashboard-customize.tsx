import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useDashboardLayout, useUpdateDashboardLayout } from '@/src/data/dashboardLayout';
import { CARD_LABEL_KEYS, type DashboardCardConfig } from '@/src/stats/dashboardLayout';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// Drag-and-drop reorder (owner decision — the previous up/down-arrow
// affordance was too small/tedious on device). react-native-draggable-
// flatlist (built on the reanimated + react-native-gesture-handler already
// verified SDK-54-compatible in this pass) replaces it: long-press
// anywhere on a card lifts it (ScaleDecorator gives the "subtle scale",
// onDragBegin fires a haptic via expo-haptics), drag to reorder, release
// to drop. The persisted shape (an ordered array) is unchanged — only the
// UI affordance for reordering it changed, so useDashboardLayout/
// useUpdateDashboardLayout and the default-layout/reset behavior below are
// untouched.
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

  function updateRowById(id: string, patch: Partial<DashboardCardConfig>) {
    setDraft((current) => {
      if (!current) return current;
      return current.map((row) => (row.id === id ? { ...row, ...patch } : row));
    });
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

  function renderItem({ item, drag, isActive }: RenderItemParams<DashboardCardConfig>) {
    return (
      <ScaleDecorator>
        <CardEditor
          row={item}
          drag={drag}
          isActive={isActive}
          defaultLabel={t(CARD_LABEL_KEYS[item.id as keyof typeof CARD_LABEL_KEYS] ?? item.id)}
          onToggleVisible={() => updateRowById(item.id, { visible: !item.visible })}
          onLabelChange={(label) => updateRowById(item.id, { label: label || null })}
        />
      </ScaleDecorator>
    );
  }

  return (
    <Screen>
      <DraggableFlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={renderItem}
        onDragBegin={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }}
        onDragEnd={({ data }) => setDraft(data)}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <ScreenTitle>{t('dashboardCustomize.title')}</ScreenTitle>
            <MutedText>{t('dashboardCustomize.subtitle')}</MutedText>
            <MutedText style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
              {t('dashboardCustomize.dragHint')}
            </MutedText>
            {(layoutQuery.isLoading || !draft) && (
              <Card>
                <MutedText>{t('common.loading')}</MutedText>
              </Card>
            )}
          </View>
        }
        ListFooterComponent={
          <View>
            <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSave} loading={saving} disabled={!draft} />
            <SecondaryButton title={t('dashboardCustomize.resetToDefault')} onPress={handleReset} />
          </View>
        }
      />
    </Screen>
  );
}

function CardEditor({
  row,
  drag,
  isActive,
  defaultLabel,
  onToggleVisible,
  onLabelChange,
}: {
  row: DashboardCardConfig;
  drag: () => void;
  isActive: boolean;
  defaultLabel: string;
  onToggleVisible: () => void;
  onLabelChange: (label: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable onLongPress={drag} disabled={isActive} delayLongPress={200}>
      <View style={[styles.card, isActive && styles.cardActive]}>
        <View style={styles.grabHandle}>
          <Text style={styles.grabHandleGlyph}>☰</Text>
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
    </Pressable>
  );
}

const styles = {
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.card2,
  },
  grabHandle: {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  grabHandleGlyph: {
    color: colors.muted,
    fontSize: 22,
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
