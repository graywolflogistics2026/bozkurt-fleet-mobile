import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { useFormatters } from '@/src/i18n/format';
import { useShareCapture } from '@/src/components/shareCard/useShareCapture';
import { useShareMessages } from '@/src/components/shareCard/useShareMessages';
import { ShareDestinationsRow } from '@/src/components/shareCard/ShareDestinationsRow';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { BrandWordmark } from '@/src/components/BrandWordmark';
import { colors, radii, spacing, typography } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';

type MetricKey = 'revenue' | 'profit' | 'mpg';
const METRICS: MetricKey[] = ['revenue', 'profit', 'mpg'];

// Share Weekly Profit v1 (PROMPTS.md Session 9a item 10, owner decision
// 2026-07-10 — AI feature package, PRODUCT DECISION): the user picks which
// metrics go on the card (never forced to share all three, for privacy) —
// reads the selected settlement + active truck's fleet_mpg, the same
// data other screens already show, no new backend/calculation engine.
//
// UX MEGA-PASS item F (owner decision 2026-07-31, device evidence): (1)
// the destinations row, capture, and share/clipboard logic were extracted
// into src/components/shareCard/ so the AI Coach briefing and Scorecard
// screens can reuse the identical pipeline; (2) WhatsApp/SMS/Copy Image
// added to that shared destination list; (3) the metric-toggle row's
// visible card previously wasn't guaranteed to re-render on every toggle
// on every device/RN-renderer combination — the ViewShot's child View now
// carries an explicit `key` derived from the exact inputs that determine
// its content (included metrics + selected week), which forces React to
// fully re-mount that subtree on any change rather than relying on a
// third-party native view wrapper's own diffing; (4) a week picker lets
// any past settlement be shared, not just the latest.
export default function ShareProfit() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const { profile } = useAuth();
  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const { activeTruck } = useActiveTruck();
  const { shotRef, sharing, shareTo } = useShareCapture();
  const messages = useShareMessages();
  const [included, setIncluded] = useState<Record<MetricKey, boolean>>({ revenue: true, profit: true, mpg: false });
  const [selectedWeekEnding, setSelectedWeekEnding] = useState<string | null>(null);

  // SELF-TEST AUDIT (owner decision, MULTI-TRUCK MODEL) — this screen
  // used to read settlementsQuery.data completely unfiltered, so its own
  // week picker and "selected" settlement never honored the global scope
  // selector at all — a real gap directly contradicting "every screen
  // states/follows its scope," found by re-auditing the 3 screens flagged
  // as unreviewed in the prior pass. Also a genuine PRE-EXISTING
  // correctness bug this fix resolves as a side effect: the Revenue
  // metric (`selected.gross`) read exactly ONE settlement row's own
  // gross, while the Profit metric already AGGREGATED every settlement
  // sharing that week_ending (a routine case for a 2+-truck fleet, where
  // every truck settles the same week) — the two metrics could disagree
  // about which trucks' numbers they even included. Both now aggregate
  // consistently over the SAME scoped settlement set: every one of this
  // truck's own settlements for the selected week (specific-truck scope),
  // or every settlement across the whole fleet for that week ("All
  // Trucks" scope) — never a single arbitrary row.
  const scopedSettlements = useMemo(
    () => (activeTruck ? (settlementsQuery.data ?? []).filter((s) => s.truck_id === activeTruck.id) : (settlementsQuery.data ?? [])),
    [settlementsQuery.data, activeTruck]
  );
  const scopedDeductions = useMemo(
    () => (activeTruck ? (dedQuery.data ?? []).filter((d) => d.truck_id === activeTruck.id) : (dedQuery.data ?? [])),
    [dedQuery.data, activeTruck]
  );
  const scopedFuel = useMemo(
    () => (activeTruck ? (fuelQuery.data ?? []).filter((f) => f.truck_id === activeTruck.id) : (fuelQuery.data ?? [])),
    [fuelQuery.data, activeTruck]
  );
  const scopedMaintenance = useMemo(
    () => (activeTruck ? (maintenanceQuery.data ?? []).filter((m) => m.truck_id === activeTruck.id) : (maintenanceQuery.data ?? [])),
    [maintenanceQuery.data, activeTruck]
  );
  const scopedTolls = useMemo(
    () => (activeTruck ? (tollsQuery.data ?? []).filter((tl) => tl.truck_id === activeTruck.id) : (tollsQuery.data ?? [])),
    [tollsQuery.data, activeTruck]
  );

  const weekEndings = useMemo(() => {
    const set = new Set(scopedSettlements.map((s) => s.week_ending).filter((w): w is string => !!w));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [scopedSettlements]);
  const selectedWeek = selectedWeekEnding && weekEndings.includes(selectedWeekEnding) ? selectedWeekEnding : (weekEndings[0] ?? null);
  const weekSettlements = useMemo(
    () => (selectedWeek ? scopedSettlements.filter((s) => s.week_ending === selectedWeek) : []),
    [scopedSettlements, selectedWeek]
  );
  const selected = selectedWeek ? { week_ending: selectedWeek, gross: weekSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0) } : null;

  // TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): the "Profit"
  // metric is the same canonical src/stats/trueProfit.ts weekly figure
  // Home/Scorecard/CEO Mode/Profit Analysis all use, now fed the SAME
  // scoped settlement/deduction/fuel/maintenance/tolls set as the
  // Revenue metric above (so the two can never again disagree about
  // which trucks' data they cover).
  const trueProfitByWeek = useMemo(
    () => buildWeeklyTrueProfitTrend(scopedSettlements, scopedDeductions, scopedFuel, scopedMaintenance, scopedTolls),
    [scopedSettlements, scopedDeductions, scopedFuel, scopedMaintenance, scopedTolls]
  );
  const selectedTrueProfit = selected ? (trueProfitByWeek.find((p) => p.weekEnding === selected.week_ending)?.net ?? 0) : 0;

  // BRAND VISIBILITY guarantee (owner decision 2026-07-30): the app
  // wordmark is rendered unconditionally at the bottom of the share card
  // (see the ViewShot tree below) regardless of whether the user has set a
  // company name — every share advertises the app. company_name, when set,
  // is a SEPARATE line above it; it never replaces the wordmark the way
  // the old single `companyLabel` fallback used to.
  const companyName = profile?.company_name?.trim() || null;
  const weekSummary = selected ? t('shareProfit.weekOf', { date: selected.week_ending }) : '';
  // Caption auto-copied to the clipboard alongside the image (owner
  // decision 2026-07-30) so paste-flows carry the brand name in text too.
  const caption = selected ? t('shareProfit.captionTemplate', { weekSummary, brand: BRAND_NAME }) : '';

  function toggle(key: MetricKey) {
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const noneSelected = !included.revenue && !included.profit && !included.mpg;
  const cardKey = `${selected?.week_ending ?? 'none'}-${included.revenue}-${included.profit}-${included.mpg}`;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('shareProfit.title')}</ScreenTitle>
        <FleetScopeLabel />
        <MutedText>{t('shareProfit.subtitle')}</MutedText>

        {!selected ? (
          <Card>
            <MutedText>{t('shareProfit.noSettlements')}</MutedText>
          </Card>
        ) : (
          <>
            {weekEndings.length > 1 && (
              <View style={{ marginTop: spacing.sm }}>
                <MutedText>{t('shareProfit.weekPickerLabel')}</MutedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
                  {weekEndings.map((weekEnding) => {
                    const isSelected = weekEnding === selected.week_ending;
                    return (
                      <Pressable
                        key={weekEnding}
                        onPress={() => setSelectedWeekEnding(weekEnding)}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: radii.sm,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.accent : colors.border,
                          backgroundColor: isSelected ? colors.accent : colors.card2,
                          marginEnd: spacing.xs,
                        }}
                      >
                        <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{weekEnding}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <Card>
              {METRICS.map((key) => (
                <Pressable key={key} onPress={() => toggle(key)} style={styles.metricRow}>
                  <Text style={{ color: colors.text, fontSize: typography.size.md }}>{t(`shareProfit.metrics.${key}`)}</Text>
                  <Text style={{ color: included[key] ? colors.accent : colors.muted, fontSize: typography.size.md, fontWeight: '700' }}>
                    {included[key] ? '☑' : '☐'}
                  </Text>
                </Pressable>
              ))}
            </Card>

            <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
              <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
                <View key={cardKey} style={styles.shareCard}>
                  {companyName && <Text style={styles.shareCompanyName}>{companyName}</Text>}
                  <Text style={styles.shareWeek}>{t('shareProfit.weekOf', { date: selected.week_ending })}</Text>
                  {included.revenue && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.revenue')}</Text>
                      <Text style={[styles.shareMetricValue, { color: colors.green }]}>{money(selected.gross)}</Text>
                    </View>
                  )}
                  {included.profit && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.profit')}</Text>
                      <Text style={[styles.shareMetricValue, { color: colors.green }]}>{money(selectedTrueProfit)}</Text>
                    </View>
                  )}
                  {included.mpg && activeTruck?.fleet_mpg != null && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.mpg')}</Text>
                      <Text style={styles.shareMetricValue}>{number(activeTruck.fleet_mpg, { maximumFractionDigits: 1 })}</Text>
                    </View>
                  )}
                  {/* BRAND VISIBILITY guarantee (owner decision 2026-07-30):
                      unconditional — renders regardless of metric
                      selection or company_name, so every share advertises
                      the app. colors.text against the card's dark
                      background keeps contrast good in the captured PNG. */}
                  <View style={styles.shareBrandFooter}>
                    <BrandWordmark fontSize={16} />
                  </View>
                </View>
              </ViewShot>
            </View>

            <MutedText style={{ marginBottom: spacing.xs }}>{t('shareProfit.shareTo')}</MutedText>
            <ShareDestinationsRow
              disabled={sharing || noneSelected}
              onShare={(dest) => shareTo(dest, caption, messages)}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  metricRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  shareCard: {
    width: 320,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center' as const,
  },
  shareCompanyName: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  shareWeek: {
    color: colors.muted,
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  shareMetric: {
    alignItems: 'center' as const,
    marginBottom: spacing.sm,
  },
  shareMetricLabel: {
    color: colors.muted,
    fontSize: typography.size.sm,
  },
  shareMetricValue: {
    color: colors.text,
    fontSize: typography.size.xl,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  shareBrandFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%' as const,
    alignItems: 'center' as const,
  },
};
