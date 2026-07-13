import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useDashboardLayout, useUpdateDashboardLayout } from '@/src/data/dashboardLayout';
import { CARD_LABEL_KEYS, SECTION_IDS, SECTION_LABEL_KEYS, type DashboardCardConfig, type SectionId } from '@/src/stats/dashboardLayout';
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
//
// CRITICAL BUG FIX (device feedback round 2): react-native-draggable-
// flatlist's gesture-handler-backed list renders completely blank inside
// Expo Go (confirmed on-device, EN+TR) — Expo Go doesn't bundle a matching
// native reanimated/gesture-handler build for every JS version this repo
// pins. Detected via `Constants.appOwnership === 'expo'` (only truthy
// inside the Expo Go client, never in a dev-client/EAS build), gating a
// fallback plain FlatList with large (44pt+) up/down arrows plus move-to-
// top/bottom actions — functionally equivalent reordering, just without
// the drag gesture. Dev-client and EAS builds keep the drag-and-drop path
// since it works there.
const isExpoGo = Constants.appOwnership === 'expo';

function moveBy<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function moveToEdge<T>(list: T[], index: number, toStart: boolean): T[] {
  const target = toStart ? 0 : list.length - 1;
  if (index === target) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

// Section picker (Dashboard sections addition, owner decision
// 2026-07-13) — lets a card be moved within/between the 4 collapsible
// titled sections (OVERVIEW/MONEY/ON THE ROAD/TAXES) or cleared to "no
// section" (rendered unsectioned, below all 4). Shared by both
// CardEditor and FallbackCardEditor.
function SectionPills({ value, onChange }: { value: SectionId | null; onChange: (section: SectionId | null) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
      <Pressable
        onPress={() => onChange(null)}
        style={[styles.sectionPill, value === null ? styles.sectionPillOn : styles.sectionPillOff]}
      >
        <Text style={styles.sectionPillText}>{t('dashboardCustomize.noSection')}</Text>
      </Pressable>
      {SECTION_IDS.map((id) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          style={[styles.sectionPill, value === id ? styles.sectionPillOn : styles.sectionPillOff]}
        >
          <Text style={styles.sectionPillText}>{t(SECTION_LABEL_KEYS[id])}</Text>
        </Pressable>
      ))}
    </View>
  );
}

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
          onSectionChange={(section) => updateRowById(item.id, { section })}
        />
      </ScaleDecorator>
    );
  }

  function renderFallbackItem({ item, index }: { item: DashboardCardConfig; index: number }) {
    return (
      <FallbackCardEditor
        row={item}
        defaultLabel={t(CARD_LABEL_KEYS[item.id as keyof typeof CARD_LABEL_KEYS] ?? item.id)}
        isFirst={index === 0}
        isLast={index === rows.length - 1}
        onToggleVisible={() => updateRowById(item.id, { visible: !item.visible })}
        onLabelChange={(label) => updateRowById(item.id, { label: label || null })}
        onSectionChange={(section) => updateRowById(item.id, { section })}
        onMoveUp={() => setDraft((current) => (current ? moveBy(current, index, -1) : current))}
        onMoveDown={() => setDraft((current) => (current ? moveBy(current, index, 1) : current))}
        onMoveToTop={() => setDraft((current) => (current ? moveToEdge(current, index, true) : current))}
        onMoveToBottom={() => setDraft((current) => (current ? moveToEdge(current, index, false) : current))}
      />
    );
  }

  const listHeader = (
    <View>
      <ScreenTitle>{t('dashboardCustomize.title')}</ScreenTitle>
      <MutedText>{t('dashboardCustomize.subtitle')}</MutedText>
      <MutedText style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
        {isExpoGo ? t('dashboardCustomize.arrowHint') : t('dashboardCustomize.dragHint')}
      </MutedText>
      {(layoutQuery.isLoading || !draft) && (
        <Card>
          <MutedText>{t('common.loading')}</MutedText>
        </Card>
      )}
    </View>
  );

  const listFooter = (
    <View>
      <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSave} loading={saving} disabled={!draft} />
      <SecondaryButton title={t('dashboardCustomize.resetToDefault')} onPress={handleReset} />
    </View>
  );

  return (
    <Screen>
      {isExpoGo ? (
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={renderFallbackItem}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      ) : (
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
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      )}
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
  onSectionChange,
}: {
  row: DashboardCardConfig;
  drag: () => void;
  isActive: boolean;
  defaultLabel: string;
  onToggleVisible: () => void;
  onLabelChange: (label: string) => void;
  onSectionChange: (section: SectionId | null) => void;
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
          <SectionPills value={row.section} onChange={onSectionChange} />
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

// Expo Go fallback (no drag gesture available — see the isExpoGo comment
// above): large 44pt+ up/down arrow buttons plus "move to top/bottom" text
// actions. Functionally equivalent to drag-and-drop, just button-driven.
function FallbackCardEditor({
  row,
  defaultLabel,
  isFirst,
  isLast,
  onToggleVisible,
  onLabelChange,
  onSectionChange,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onMoveToBottom,
}: {
  row: DashboardCardConfig;
  defaultLabel: string;
  isFirst: boolean;
  isLast: boolean;
  onToggleVisible: () => void;
  onLabelChange: (label: string) => void;
  onSectionChange: (section: SectionId | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <View style={styles.arrowColumn}>
        <Pressable onPress={onMoveUp} disabled={isFirst} hitSlop={4} style={[styles.arrowButton, isFirst && styles.arrowButtonDisabled]}>
          <Text style={[styles.arrowGlyph, isFirst && styles.arrowGlyphDisabled]}>▲</Text>
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={isLast} hitSlop={4} style={[styles.arrowButton, isLast && styles.arrowButtonDisabled]}>
          <Text style={[styles.arrowGlyph, isLast && styles.arrowGlyphDisabled]}>▼</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, marginStart: spacing.sm }}>
        <MutedText>{defaultLabel}</MutedText>
        <Field
          value={row.label ?? ''}
          onChangeText={onLabelChange}
          placeholder={t('dashboardCustomize.labelPlaceholder', { defaultLabel })}
          style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}
        />
        <View style={{ flexDirection: 'row' }}>
          <Pressable onPress={onMoveToTop} disabled={isFirst} hitSlop={6}>
            <Text style={[styles.edgeActionText, isFirst && styles.arrowGlyphDisabled]}>{t('dashboardCustomize.moveToTop')}</Text>
          </Pressable>
          <Pressable onPress={onMoveToBottom} disabled={isLast} hitSlop={6} style={{ marginStart: spacing.md }}>
            <Text style={[styles.edgeActionText, isLast && styles.arrowGlyphDisabled]}>{t('dashboardCustomize.moveToBottom')}</Text>
          </Pressable>
        </View>
        <SectionPills value={row.section} onChange={onSectionChange} />
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
  arrowColumn: {
    alignItems: 'center' as const,
  },
  arrowButton: {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  arrowButtonDisabled: {
    opacity: 0.3,
  },
  arrowGlyph: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '700' as const,
  },
  arrowGlyphDisabled: {
    color: colors.muted,
  },
  edgeActionText: {
    color: colors.accent,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
  },
  sectionPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginEnd: spacing.xs,
    marginTop: spacing.xs,
  },
  sectionPillOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sectionPillOff: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  sectionPillText: {
    color: colors.text,
    fontSize: typography.size.xs,
    fontWeight: '600' as const,
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
