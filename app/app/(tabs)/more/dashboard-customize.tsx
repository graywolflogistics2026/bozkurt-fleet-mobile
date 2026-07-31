import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useDashboardLayout, useUpdateDashboardLayout } from '@/src/data/dashboardLayout';
import {
  CARD_LABEL_KEYS,
  SECTION_IDS,
  SECTION_LABEL_KEYS,
  mergeDashboardLayout,
  type DashboardCardConfig,
  type SectionId,
} from '@/src/stats/dashboardLayout';
import { loadDragModule, resolveDragRenderMode, type DragModule } from '@/src/dashboard/dragModuleLoader';
import { ScreenErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// CRASH-ON-MOUNT FIX (owner decision 2026-07-30, decisive device evidence:
// a white flash then the screen closes — a throw during module
// evaluation/initial render, before first paint). The previous pass's
// arrows-baseline fix was real but downstream of the actual bug: this
// file used to `import DraggableFlatList, { ScaleDecorator } from
// 'react-native-draggable-flatlist'` STATICALLY at module scope, so if
// that native module (built on reanimated + gesture-handler) fails to
// link/initialize in a release build, evaluating THIS FILE throws before
// React ever renders anything — no error boundary placed anywhere in this
// file's tree could ever have caught that, because the tree never gets
// built. Only a `import type` (below) survives now at the top level —
// TypeScript erases type-only imports completely, so there is genuinely
// ZERO runtime reference to the drag module unless/until
// src/dashboard/dragModuleLoader.ts's loadDragModule() is explicitly
// called, lazily, inside a useEffect (see below) — never during the
// synchronous render pass, always wrapped so a failure resolves to
// `null` instead of throwing.
//
// Investigated and ruled out per the requested hunt order:
//  (b) hook order / conditional render — every hook below is called
//      unconditionally at the top of the component; no early return
//      before a hook, no hook inside a condition/loop.
//  (c) dashboard_layout JSON.parse — profiles.dashboard_layout is a
//      `jsonb` column (docs/SCHEMA.sql), so PostgREST already returns it
//      as a parsed JS value; this codebase has never called
//      `JSON.parse` on it anywhere. mergeDashboardLayout() only checks
//      `Array.isArray(stored)` — a string/null/corrupt value simply
//      isn't an array, so it silently falls through to the full default
//      layout without ever attempting to parse it (see the hardening
//      tests in src/stats/__tests__/dashboardLayout.test.ts covering
//      null/''/'{}'/corrupt-string/post-reset explicitly).
//  (d) navigation params / wide-screen layout wrapper — app/(tabs)/
//      _layout.tsx's WideSidebar swap is generic to every route in the
//      tab tree (hides the bottom tab bar above the 768px breakpoint);
//      it does nothing route-specific to dashboard-customize that would
//      explain a crash unique to this one screen.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

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

// Belt-and-suspenders for render-phase errors thrown by the DraggableFlatList
// tree AFTER a successful lazy load (e.g. a gesture-handler/reanimated
// version mismatch that doesn't crash on import but does throw on render) —
// distinct from, and layered on top of, dragModuleLoader.ts's own
// try/catch around the import itself.
class DragListErrorBoundary extends Component<{ onError: (message: string) => void; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('[DashboardCustomize] DraggableFlatList threw — falling back to arrows-only mode.', error);
    this.props.onError(message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// Section picker (Dashboard sections addition, owner decision
// 2026-07-13) — lets a card be moved within/between the 4 collapsible
// titled sections (OVERVIEW/MONEY/ON THE ROAD/TAXES) or cleared to "no
// section" (rendered unsectioned, below all 4).
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

export default function DashboardCustomizeScreen() {
  const { t } = useTranslation();
  return (
    <ScreenErrorBoundary screenName="Customize Dashboard" title={t('dashboardCustomize.screenCrashed', { screenName: t('dashboardCustomize.title') })}>
      <DashboardCustomize />
    </ScreenErrorBoundary>
  );
}

function DashboardCustomize() {
  const { t } = useTranslation();
  const layoutQuery = useDashboardLayout();
  const updateLayout = useUpdateDashboardLayout();
  const [draft, setDraft] = useState<DashboardCardConfig[] | null>(null);
  const [saving, setSaving] = useState(false);
  // Baseline is arrows-only until (and unless) a lazy load of the drag
  // module succeeds — see the useEffect below. Never true synchronously
  // during the first render; dragModule starts null, which
  // resolveDragRenderMode() alone already resolves to 'arrows-only'.
  const [dragUnavailable, setDragUnavailable] = useState(isExpoGo);
  const [dragModule, setDragModule] = useState<DragModule | null>(null);

  // Lazy module load (the actual crash-on-mount fix) — runs once, AFTER
  // the first successful render, never blocking or risking it. Expo Go
  // never even attempts (no matching native build there, same reasoning
  // as before). Any failure — module not found, native init throwing,
  // an unexpected export shape — resolves to `null` inside
  // loadDragModule() itself; nothing here can throw.
  useEffect(() => {
    if (isExpoGo) return;
    const loaded = loadDragModule();
    if (loaded) {
      setDragModule(loaded);
    } else {
      setDragUnavailable(true);
      setLastError('react-native-draggable-flatlist failed to load (native module unavailable)');
    }
  }, []);

  // On-screen diagnostics (owner directive, device feedback round 4,
  // 2026-07-30 — "stop guessing"): triple-tap the screen title to reveal a
  // small panel reporting rendering mode/card count/layout size/last
  // caught error, so a device report can include hard numbers instead of
  // "it's still broken." Temporary instrumentation, not a permanent UI
  // feature — kept deliberately plain (no design polish).
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTitleTap() {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 600);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setShowDiagnostics((v) => !v);
    }
  }

  useEffect(() => {
    if (layoutQuery.data && !draft) setDraft(layoutQuery.data.layout);
  }, [layoutQuery.data, draft]);

  // Silent-failure fix (owner directive, device feedback round 4): if the
  // profiles fetch itself errors (network blip, RLS edge case, a malformed
  // row), the screen used to be stuck on "Loading…" forever — isLoading
  // goes false but draft never gets set, so the loading card's `!draft`
  // condition stayed true with nothing beneath it. Falling back to the
  // pure default merge (same shape a brand-new profile gets) means the
  // screen is ALWAYS usable even when the fetch itself failed; the user
  // can still reorder/hide/save (a subsequent save re-fetches and
  // reconciles normally), and the diagnostics panel surfaces the real
  // error message for a device report.
  useEffect(() => {
    if (layoutQuery.isError && !draft) {
      setDraft(mergeDashboardLayout(null));
      setLastError(layoutQuery.error instanceof Error ? layoutQuery.error.message : String(layoutQuery.error));
    }
  }, [layoutQuery.isError, layoutQuery.error, draft]);

  const rows = draft ?? [];
  const renderMode = resolveDragRenderMode({ isExpoGo, dragUnavailable, dragModule });

  useEffect(() => {
    console.log('[DashboardCustomize] rendering mode:', renderMode, isExpoGo ? '(Expo Go detected)' : '');
  }, [renderMode]);

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

  function rowProps(item: DashboardCardConfig, index: number) {
    return {
      row: item,
      defaultLabel: t(CARD_LABEL_KEYS[item.id as keyof typeof CARD_LABEL_KEYS] ?? item.id),
      isFirst: index === 0,
      isLast: index === rows.length - 1,
      onToggleVisible: () => updateRowById(item.id, { visible: !item.visible }),
      onLabelChange: (label: string) => updateRowById(item.id, { label: label || null }),
      onSectionChange: (section: SectionId | null) => updateRowById(item.id, { section }),
      onMoveUp: () => setDraft((current) => (current ? moveBy(current, index, -1) : current)),
      onMoveDown: () => setDraft((current) => (current ? moveBy(current, index, 1) : current)),
      onMoveToTop: () => setDraft((current) => (current ? moveToEdge(current, index, true) : current)),
      onMoveToBottom: () => setDraft((current) => (current ? moveToEdge(current, index, false) : current)),
    };
  }

  function renderDraggableItem({ item, getIndex, drag, isActive }: RenderItemParams<DashboardCardConfig>) {
    const index = getIndex() ?? rows.findIndex((r) => r.id === item.id);
    const ScaleDecorator = dragModule!.ScaleDecorator;
    return (
      <ScaleDecorator>
        <CardEditorRow {...rowProps(item, index)} drag={drag} isActive={isActive} />
      </ScaleDecorator>
    );
  }

  function renderPlainItem({ item, index }: { item: DashboardCardConfig; index: number }) {
    return <CardEditorRow {...rowProps(item, index)} />;
  }

  const listHeader = (
    <View>
      <Pressable onPress={handleTitleTap}>
        <ScreenTitle>{t('dashboardCustomize.title')}</ScreenTitle>
      </Pressable>
      <MutedText>{t('dashboardCustomize.subtitle')}</MutedText>
      <MutedText style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}>
        {renderMode === 'arrows-only' ? t('dashboardCustomize.arrowHint') : t('dashboardCustomize.dragHint')}
      </MutedText>
      {showDiagnostics && (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
            {t('dashboardCustomize.diagnosticsTitle')}
          </Text>
          <MutedText>{t('dashboardCustomize.diagnosticsMode', { mode: renderMode })}</MutedText>
          <MutedText>{t('dashboardCustomize.diagnosticsCards', { count: rows.length })}</MutedText>
          <MutedText>
            {t('dashboardCustomize.diagnosticsLayoutLength', { length: draft ? JSON.stringify(draft).length : 'null' })}
          </MutedText>
          <MutedText>
            {t('dashboardCustomize.diagnosticsQueryStatus', {
              status: layoutQuery.isLoading ? 'loading' : layoutQuery.isError ? 'error' : 'success',
            })}
          </MutedText>
          <MutedText>{t('dashboardCustomize.diagnosticsLastError', { error: lastError ?? t('dashboardCustomize.diagnosticsNone') })}</MutedText>
        </Card>
      )}
      {layoutQuery.isLoading && !draft && (
        <Card>
          <MutedText>{t('common.loading')}</MutedText>
        </Card>
      )}
      {layoutQuery.isError && (
        <Card>
          <MutedText style={{ color: colors.orange }}>{t('dashboardCustomize.loadErrorFallback')}</MutedText>
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

  if (renderMode === 'arrows-only' || !dragModule) {
    return (
      <Screen>
        <FlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={renderPlainItem}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      </Screen>
    );
  }

  const DraggableFlatList = dragModule.DraggableFlatList;

  return (
    <Screen>
      <DragListErrorBoundary
        onError={(message) => {
          setLastError(message);
          setDragUnavailable(true);
        }}
      >
        <DraggableFlatList
          style={{ flex: 1 }}
          data={rows}
          keyExtractor={(row: DashboardCardConfig) => row.id}
          renderItem={renderDraggableItem}
          onDragBegin={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          }}
          onDragEnd={({ data }: { data: DashboardCardConfig[] }) => {
            // React error boundaries only catch render-path errors — a
            // gesture-handler/reanimated failure surfacing inside this
            // callback (event-handler code, not render) would NOT be
            // caught by DragListErrorBoundary above. This try/catch is
            // the belt-and-suspenders safety net for that gap (device
            // feedback round 4): any failure here still permanently
            // downgrades to the guaranteed-safe arrows-only FlatList
            // instead of leaving the screen in a broken drag state.
            try {
              setDraft(data);
            } catch (err) {
              setLastError(err instanceof Error ? err.message : String(err));
              setDragUnavailable(true);
            }
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      </DragListErrorBoundary>
    </Screen>
  );
}

// The one card-editor row for BOTH interaction models. Arrows/top-bottom/
// pills/label/visibility are the unconditional baseline — every prop for
// them is required, never optional, so this component has no "degraded"
// render path. `drag`/`isActive` are the only optional pieces: passed only
// when rendered inside a successfully-mounted DraggableFlatList, wiring an
// ADDITIONAL long-press-to-drag affordance on the ☰ handle without ever
// replacing the arrows.
function CardEditorRow({
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
  drag,
  isActive,
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
  drag?: () => void;
  isActive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.card, isActive && styles.cardActive]}>
      <View style={styles.arrowColumn}>
        <Pressable onPress={onMoveUp} disabled={isFirst} hitSlop={4} style={[styles.arrowButton, isFirst && styles.arrowButtonDisabled]}>
          <Text style={[styles.arrowGlyph, isFirst && styles.arrowGlyphDisabled]}>▲</Text>
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={isLast} hitSlop={4} style={[styles.arrowButton, isLast && styles.arrowButtonDisabled]}>
          <Text style={[styles.arrowGlyph, isLast && styles.arrowGlyphDisabled]}>▼</Text>
        </Pressable>
      </View>

      {drag && (
        <Pressable onLongPress={drag} disabled={isActive} delayLongPress={200} style={styles.grabHandle} hitSlop={4}>
          <Text style={styles.grabHandleGlyph}>☰</Text>
        </Pressable>
      )}

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
