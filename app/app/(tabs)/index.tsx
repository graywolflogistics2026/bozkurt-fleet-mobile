import { useMemo, useState, useCallback } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useLoads } from '@/src/data/loads';
import { useDeductions, useDeleteDeduction } from '@/src/data/deductions';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { useSettlements } from '@/src/data/settlements';
import {
  buildWeeklyRevenueExpenseTrend,
  weekStartFromEnding,
  rankLoadsByRpm,
  type WeeklyRevenueExpensePoint,
  type RankedLoad,
} from '@/src/stats/cashFlowTrend';
import { calcScorecard } from '@/src/stats/scorecard';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { buildTruckComparison } from '@/src/stats/truckComparison';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { resolveHeroPeriodDateWindow, filterRowsByDateWindow, calcHeroRevenueExpenseTrio } from '@/src/stats/heroPeriodWindow';
import { FleetScopeSelectorStrip } from '@/src/components/FleetScopeSelectorStrip';
import { filterLoadsByTruckScope } from '@/src/stats/loadsScope';
import { type WeekOverWeekChange } from '@/src/stats/heroStats';
import { calcHeroPeriod, HERO_PERIODS, type HeroPeriod } from '@/src/stats/heroPeriod';
import { buildExpenseTotalExplainer } from '@/src/stats/expenseTotalExplainer';
import { buildPolylinePoints, buildAreaPoints } from '@/src/stats/chartHelpers';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useAiCoachSummary, type AiCoachSummary } from '@/src/data/aiCoachSummary';
import { RECOMMENDATION_ICON, recommendationText, recommendationRoute } from '@/src/stats/aiRecommendations';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import { useProactiveCoach } from '@/src/data/proactiveCoach';
import { coachNudgeText } from '@/src/alerts/periodicCoachNudges';
import { useAlertsData } from '@/src/data/alerts';
import { NUDGE_ICON, NUDGE_ROUTE, unlockNudgeText } from '@/src/alerts/unlockNudgePresentation';
import { ServiceStatusBanner } from '@/src/components/ServiceStatusBanner';
import { useReferralSyncOnce } from '@/src/data/referral';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, SecondaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { useAnimatedNumber } from '@/src/components/AnimatedNumber';
import { useFormatters } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';

// DASHBOARD SIMPLIFICATION (owner decision 2026-08-02): Home is now a
// FIXED, non-customizable layout — the Customize Dashboard feature
// (drag-to-reorder, show/hide, per-card rename, invariant #17) has been
// retired entirely (CLAUDE.md, PROMPTS.md backlog) in favor of one
// well-designed layout every user sees, in this exact order:
//   a) Hero profit card (period tabs + area chart)
//   b) Revenue / Expenses / Net Profit trio with % deltas
//   b2) Per-Mile trio (owner decision 2026-08-24, device report) —
//      Revenue/Mile, Cost/Mile (CPM), Profit/Mile, directly under (b),
//      see PerMileTile/the canonicalCpm block below. Same canonical
//      calcCanonicalCpm() figures Scorecard's own KPI card and "Why?"
//      breakdown use (src/stats/cpm.ts) — never a second CPM formula.
//   c) Business Balance slim card
//   d) AI Coach section — the full briefing rendered inline (owner
//      decision 2026-08-24), not just a teaser link, see AiCoachSection
//      below
//   e) Recent Loads, then Best/Worst Lanes
//   f) Tax strip (owner decision 2026-08-24, NEXT PASS item C) — Weekly
//      Tax Reserve / Next Quarterly Payment / Estimated Yearly Tax, the
//      LAST content block, ahead of only the Sign Out button, see
//      HomeTaxStrip below
// Everything else that used to live on Home (Fleet Health Score gauge,
// the rotating AI Insight card, the Capital Account strip, the needs-
// review counter chip, the 4 collapsible Overview/Money/On-the-Road/
// Taxes sections and every card inside them, S-corp/1099/tax banners,
// fleet & driver overview) is REMOVED from Home — those underlying
// screens (Capital Account, Tax Estimator, Truck Health, Profit
// Analysis, ...) remain fully reachable from the Menu, only the Home
// summary cards are gone. profiles.dashboard_layout/
// dashboard_sections_collapsed stay as harmless, unused DB columns (no
// migration needed) — nothing in the app reads or writes them anymore.

function greetingKey(hour: number): string {
  if (hour < 12) return 'dashboard.greeting.morning';
  if (hour < 18) return 'dashboard.greeting.afternoon';
  return 'dashboard.greeting.evening';
}

// Session 9e-B1: greeting moved out of the Hero Card into the page body,
// below the top bar (hamburger/wordmark/bell, see _layout.tsx) — time-of-
// day aware, same three-way split the old in-hero greeting used.
function DashboardGreeting({ name }: { name: string }) {
  const { t } = useTranslation();
  const hour = new Date().getHours();
  return (
    <View style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700' }}>
        {t(greetingKey(hour), { name })}
      </Text>
      <MutedText>{t('dashboard.greeting.subtitle')}</MutedText>
    </View>
  );
}

function formattedDelta(amount: number, moneyFmt: (n: number, opts?: Intl.NumberFormatOptions) => string): string {
  const abs = moneyFmt(Math.abs(amount), { maximumFractionDigits: 0 });
  return amount < 0 ? `-${abs}` : `+${abs}`;
}

// Hero Card's "vs last week" line (Session 9e-B2: dollar delta, not a %,
// per the "TODAY'S PROFIT" mockup) — pct==null on the underlying change
// means there's no prior week yet (first-ever settlement), which reads as
// "New" rather than a misleading $0.
function HeroChange({
  change,
  deltaAmount,
  goodDirection,
  isWeekPeriod = true,
}: {
  change: WeekOverWeekChange;
  deltaAmount: number | null;
  goodDirection: 'up' | 'down';
  isWeekPeriod?: boolean;
}) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  if (change.pct == null || deltaAmount == null) {
    return <Text style={styles.heroChange}>{t('dashboard.hero.newThisWeek')}</Text>;
  }
  const isGood = change.direction === goodDirection;
  const color = change.direction === 'flat' ? 'rgba(240,240,245,0.65)' : isGood ? colors.green : colors.red;
  return (
    <Text style={[styles.heroChange, { color }]}>
      {t(isWeekPeriod ? 'dashboard.hero.vsLastWeekAmount' : 'dashboard.hero.vsPreviousPeriodAmount', {
        delta: formattedDelta(deltaAmount, moneyFmt),
      })}
    </Text>
  );
}

// Filled area chart under the Hero Card's big profit number (Session
// 9e-B2) — adapted from the earlier RevenueTrendChart's Polyline-only
// line-drawing (buildPolylinePoints) by also drawing a translucent-green
// Polygon under the same points. Weekly net-profit points (this app's
// settlements are weekly, CLAUDE.md invariant #7-adjacent) rather than
// fabricated daily granularity.
function HeroAreaChart({ points }: { points: WeeklyRevenueExpensePoint[] }) {
  const [width, setWidth] = useState(0);
  const height = 64;
  const values = points.map((p) => p.revenue - p.expenses);
  const polylinePoints = buildPolylinePoints(values, width, height);
  const areaPoints = width > 0 && values.length >= 2 ? buildAreaPoints(polylinePoints, width, height) : '';

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height, marginTop: spacing.lg }}>
      {values.length >= 2 && width > 0 && (
        <Svg width={width} height={height}>
          <Polygon points={areaPoints} fill="rgba(34,197,94,0.18)" stroke="none" />
          <Polyline points={polylinePoints} fill="none" stroke={colors.green} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

// UX MEGA-PASS item G (owner decision 2026-07-31): period tabs above the
// eyebrow — This Week/Last Week/1M/3M/6M/Yearly — driving the number,
// delta, and chart all together via src/stats/heroPeriod.ts's
// calcHeroPeriod(). thisWeek/lastWeek keep the "vs last week" $-delta
// copy (a real week-to-week comparison); every other period uses the
// generic "vs previous period" copy since the comparison is a rolling
// window, not literally a week.
function HeroPeriodTabs({ period, onChange }: { period: HeroPeriod; onChange: (p: HeroPeriod) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
      {HERO_PERIODS.map((p) => {
        const selected = p === period;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: radii.sm,
              borderWidth: 1,
              borderColor: selected ? 'rgba(240,240,245,0.9)' : 'rgba(240,240,245,0.25)',
              backgroundColor: selected ? 'rgba(240,240,245,0.15)' : 'transparent',
              marginEnd: spacing.xs,
              marginBottom: spacing.xs,
            }}
          >
            <Text style={{ color: 'rgba(240,240,245,0.9)', fontSize: typography.size.xs, fontWeight: '700' }}>
              {t(`dashboard.hero.periodTabs.${p}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function profitScoreColor(score: number): string {
  if (score >= 75) return colors.green;
  if (score >= 60) return colors.orange;
  return colors.red;
}

// Dashboard Hero Card (Session 9d item 1, restyled Session 9e-B2 toward
// the "TODAY'S PROFIT" mockup — owner + design-advisor vision "from list
// to cockpit"). Singularly about this week's PROFIT. Reuses
// calcScorecard() (src/stats/scorecard.ts, legacy rScore() port) for the
// Profit Score bar rather than inventing a second business-health formula.
function HeroCard({
  period,
  onPeriodChange,
  weekNetProfit,
  netProfitChange,
  netProfitDeltaAmount,
  chartPoints,
  profitScore,
  onPress,
}: {
  period: HeroPeriod;
  onPeriodChange: (p: HeroPeriod) => void;
  weekNetProfit: number;
  netProfitChange: WeekOverWeekChange;
  netProfitDeltaAmount: number | null;
  chartPoints: WeeklyRevenueExpensePoint[];
  profitScore: number | null;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const animatedNetProfit = useAnimatedNumber(weekNetProfit);
  const isWeekPeriod = period === 'thisWeek' || period === 'lastWeek';

  return (
    <View>
      <HeroPeriodTabs period={period} onChange={onPeriodChange} />
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
        <LinearGradient colors={['#0f1a3d', colors.bg]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
          <Text style={styles.heroEyebrow}>{t(`dashboard.hero.eyebrowByPeriod.${period}`)}</Text>
          <Text style={[styles.heroBigValue, weekNetProfit < 0 && { color: colors.red }]}>{money(animatedNetProfit)}</Text>
          <HeroChange change={netProfitChange} deltaAmount={netProfitDeltaAmount} goodDirection="up" isWeekPeriod={isWeekPeriod} />
        {profitScore != null && (
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <Text style={styles.heroScoreLabel}>{t('dashboard.hero.profitScore')}</Text>
              <Text style={styles.heroScoreLabel}>{profitScore}/100</Text>
            </View>
            <View style={styles.heroScoreTrack}>
              <View style={[styles.heroScoreFill, { width: `${profitScore}%`, backgroundColor: profitScoreColor(profitScore) }]} />
            </View>
          </View>
        )}
          <HeroAreaChart points={chartPoints} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// Session 9e-B3: Revenue/Expenses/Net trio — a tiny vs-last-week % delta
// per tile, reusing WeekOverWeekChange (pct + direction) directly.
function OverviewTile({
  label,
  value,
  valueColor,
  change,
  goodDirection,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  change: WeekOverWeekChange;
  goodDirection: 'up' | 'down';
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const isGood = change.direction === goodDirection;
  const deltaColor = change.pct == null || change.direction === 'flat' ? colors.muted : isGood ? colors.green : colors.red;
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '—';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.compactTile, pressed && { opacity: 0.85 }]}>
      <Text style={{ color: colors.muted, fontSize: typography.size.xs }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: valueColor ?? colors.text, fontWeight: '700', fontSize: typography.size.md }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: deltaColor, fontSize: 10, marginTop: 2, fontWeight: '700' }} numberOfLines={1}>
        {change.pct == null ? t('dashboard.hero.newThisWeek') : `${arrow} ${Math.abs(change.pct).toFixed(1)}%`}
      </Text>
    </Pressable>
  );
}

// Session 9e-B4: a slim Business Balance row.
function CashBalanceSlimCard({ balance, onPress }: { balance: number; onPress: () => void }) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const color = balance > 10000 ? colors.green : balance > 3000 ? colors.orange : colors.red;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.slimCard, pressed && { opacity: 0.85 }]}>
      <Text style={{ color: colors.muted, fontSize: typography.size.sm }}>💰 {t('dashboard.businessBalance')}</Text>
      <Text style={{ color, fontWeight: '700', fontSize: typography.size.lg }}>{money(balance)}</Text>
      {/* NEGATIVE SETTLEMENTS (owner decision 2026-08-02): a losing week
          is real money owed back to the carrier — the balance itself can
          now go negative (never clamped to 0), so this makes what a
          negative number MEANS explicit rather than reading as an
          unusually small positive figure. */}
      {balance < 0 && <Text style={{ color: colors.red, fontSize: typography.size.xs }}>{t('dashboard.businessBalanceOwed')}</Text>}
    </Pressable>
  );
}

// DASHBOARD LAYOUT PER SCOPE (owner decision, MULTI-TRUCK MODEL) — "All
// Trucks" mode only: each truck's net profit + profit/mile for the
// current settlement week, ranked, the weakest truck highlighted in red
// (never green — a below-average truck isn't "bad," but it shouldn't
// read as equally healthy either). Tapping a row switches the global
// scope to that truck, same affordance as Scorecard's own breakdown.
function PerTruckThisWeekCard({
  result,
  onSelectTruck,
}: {
  result: ReturnType<typeof buildTruckComparison>;
  onSelectTruck: (truckId: string) => void;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  if (result.rows.length === 0) return null;
  const worstId = result.rows.length > 1 ? result.worstTruckId : null;

  return (
    <>
      <ScreenTitle>{t('dashboard.perTruckThisWeek.title')}</ScreenTitle>
      <Card>
        {result.rows.map((row, i) => (
          <Pressable
            key={row.truckId}
            onPress={() => row.truckId && onSelectTruck(row.truckId)}
            style={[
              { paddingVertical: spacing.sm },
              i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
              row.truckId === worstId && { backgroundColor: 'rgba(239,68,68,0.08)' },
            ]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {t('common.unit', { unit: row.unitNumber })}
                {row.truckId === worstId ? ` ⚠️` : ''}
              </Text>
              <Text style={{ color: row.netProfit >= 0 ? colors.green : colors.red, fontWeight: '700' }}>
                {money(row.netProfit, { maximumFractionDigits: 0 })}
              </Text>
            </View>
            <MutedText>
              {row.profitPerMile != null ? `${money(row.profitPerMile, { maximumFractionDigits: 2 })}/mi` : '—'}
            </MutedText>
          </Pressable>
        ))}
        {result.unassignedRow && (
          <MutedText style={{ marginTop: spacing.xs }}>
            ⚠️ {t('truckComparison.unassignedBody', { count: result.unassignedRow.settlementCount, amount: money(result.unassignedRow.grossRevenue, { maximumFractionDigits: 0 }) })}
          </MutedText>
        )}
      </Card>
    </>
  );
}

// AI COACH FULLY VISIBLE ON HOME (owner decision 2026-08-24, device
// testing item 2) — replaces the old shallow "AI Coach" teaser card
// (which just linked to ceo-mode.tsx with a one-sentence subtitle). Now
// renders the actual briefing inline: a greeting line, the profit-
// opportunity headline with its dollar figure, and all three
// recommendation rows (icon + amount, each tappable through to its own
// relevant screen) — no truncation, no "see more" gate. Reuses the exact
// same recommendation data/copy/routing ceo-mode.tsx's own Card already
// used — both screens now read from the shared useAiCoachSummary() hook
// and the shared RECOMMENDATION_ICON/recommendationText/
// recommendationRoute helpers (src/stats/aiRecommendations.ts), so the
// two can never disagree. The dedicated AI Coach screen (ceo-mode.tsx)
// stays reachable via the "Open full AI Coach" link below for the
// detail/goal-tracking/chat view.
function AiCoachSection({
  coach,
  proactive,
  name,
  topUnlockNudge,
}: {
  coach: AiCoachSummary;
  proactive: ReturnType<typeof useProactiveCoach>;
  name: string;
  topUnlockNudge: ReturnType<typeof useAlertsData>['nudges'][number] | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { money } = useFormatters();
  const moneyRounded = (n: number) => money(n, { maximumFractionDigits: 0 });
  const hour = new Date().getHours();
  // SELF-TEST AUDIT (owner decision, MULTI-TRUCK MODEL) — useAiCoachSummary()/
  // useProactiveCoach() are deliberately fleet-wide always (see those
  // files' own header comments — the weekly review/recommendations/
  // nudges are composed from account-wide settlement data, not re-derived
  // per truck, to avoid multiplying the AI-advisor call budget this app's
  // own cost-control invariant caps at one call per week). Found by this
  // audit: that was previously undocumented ON SCREEN — a user viewing a
  // specific truck's now-correctly-scoped Hero Card/per-mile trio right
  // above this card could see a dollar figure here (e.g. "this week's
  // revenue was $X" in the weekly review text) that silently disagreed,
  // with nothing explaining why. Same "fleet-wide, and the screen must
  // say so" treatment as Tax Estimator/Capital Account/Cash Flow —
  // shown only when a SPECIFIC truck is actually selected on a
  // multi-truck account (matching the Business Balance/Tax Strip cards
  // right above it), since "All Trucks" scope has no such ambiguity to
  // clear up.
  const { isAllTrucks, trucks } = useActiveTruck();

  return (
    <>
      <ScreenTitle>{t('ceoMode.title')}</ScreenTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: typography.size.sm, marginBottom: spacing.sm }}>
          🧑‍✈️ {t(greetingKey(hour), { name })}
        </Text>
        {!isAllTrucks && trucks.length > 1 && <MutedText style={{ marginBottom: spacing.sm }}>{t('fleetScope.fleetWideAlways')}</MutedText>}

        {/* AI COACH — PROACTIVE WEEKLY REVIEW (owner decision 2026-08-24,
            NEXT PASS item E1) — composed from real settlement numbers,
            cached at most once per week per user (src/data/
            proactiveCoach.ts). Shown ahead of the recommendation list since
            it's the more time-relevant, "just happened" content.
            AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE fix (owner decision,
            item 4): `proactive.weeklyReview` is ALREADY null whenever the
            cached AI text isn't verified to match the current locale (see
            useProactiveCoach()'s own weeklyReviewUsable check) — this
            screen's only job is to never leave that gap silently empty:
            fall back to `weeklyReviewFallback`, the deterministic,
            always-correctly-localized template built from the exact same
            real numbers, while a fresh AI generation is pending (or
            genuinely unavailable). */}
        {proactive.weeklyReviewGenerating && (
          <MutedText style={{ marginBottom: spacing.sm }}>{t('ceoMode.weeklyReviewGenerating')}</MutedText>
        )}
        {!!proactive.weeklyReview && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('ceoMode.weeklyReviewTitle')}</Text>
            <Text style={{ color: colors.text, lineHeight: 20 }}>{proactive.weeklyReview}</Text>
          </View>
        )}
        {!proactive.weeklyReview && !!proactive.weeklyReviewFallback && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('ceoMode.weeklyReviewTitle')}</Text>
            <Text style={{ color: colors.text, lineHeight: 20 }}>{proactive.weeklyReviewFallback}</Text>
          </View>
        )}

        {coach.recommendations.length === 0 ? (
          <MutedText>{t('ceoMode.homeAllCaughtUp')}</MutedText>
        ) : (
          <>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.sm }}>
              {coach.recommendationsTotalImpact > 0
                ? t('ceoMode.recommendations.headerTitle', { amount: moneyRounded(coach.recommendationsTotalImpact) })
                : t('ceoMode.recommendations.headerTitleZero')}
            </Text>
            {coach.recommendations.map((rec) => (
              <TappableCard key={rec.type} onPress={() => router.push(recommendationRoute(rec))}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ fontSize: 20 }}>{RECOMMENDATION_ICON[rec.type]}</Text>
                  <Text style={{ color: colors.text, flex: 1 }}>{recommendationText(rec, t, moneyRounded)}</Text>
                </View>
              </TappableCard>
            ))}
          </>
        )}

        {/* AI COACH — PERIODIC NUDGE (owner decision 2026-08-24, NEXT PASS
            item E2) — at most one at a time, rotated with a per-topic
            monthly cooldown (src/alerts/nudgeFrequency.ts). */}
        {proactive.periodicNudge && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm }}>
            <Text style={{ fontSize: 16 }}>💡</Text>
            <Text style={{ color: colors.text, flex: 1 }}>{coachNudgeText(proactive.periodicNudge, t)}</Text>
          </View>
        )}

        {/* "UNLOCK" NUDGES (owner decision 2026-08-24, FIVE ADDITIONS pass
            PART 1) — a one-line teaser for the single top-priority missing
            field, tapping straight through to where it's entered. The full,
            richer card (icon/benefit/amount/time-estimate/silence) lives on
            the Alerts screen; this is deliberately just the headline. */}
        {topUnlockNudge && (
          <Pressable
            onPress={() => router.push(NUDGE_ROUTE[topUnlockNudge.topic] as Href)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm }}
          >
            <Text style={{ fontSize: 16 }}>{NUDGE_ICON[topUnlockNudge.topic]}</Text>
            <Text style={{ color: colors.text, flex: 1 }}>{unlockNudgeText(topUnlockNudge, t, moneyRounded)}</Text>
          </Pressable>
        )}

        <Pressable onPress={() => router.push('/(tabs)/more/ceo-mode')} hitSlop={8} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.accent, fontWeight: '600', fontSize: typography.size.sm }}>{t('ceoMode.homeOpenFull')}</Text>
        </Pressable>

        <LegalFootnote />
      </Card>
    </>
  );
}

// One lane row inside the Best/Worst Lanes card — mirrors Cash Flow's own
// LaneRow (app/(tabs)/more/cash-flow.tsx) so the "good/bad" presentation
// reads identically wherever a user sees it.
function HomeLaneRow({ load, good }: { load: RankedLoad; good: boolean }) {
  const { money, number } = useFormatters();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
      <View style={{ flex: 1, marginEnd: spacing.sm }}>
        <Text style={{ color: colors.text }} numberOfLines={1}>
          {load.origin ?? '—'} → {load.destination ?? '—'}
        </Text>
        <MutedText numberOfLines={1}>
          {load.order_number ?? '—'} · {number(load.loaded_miles)} mi · {money(load.revenue)}
        </MutedText>
      </View>
      <Text style={{ color: good ? colors.green : colors.red, fontWeight: '700', flexShrink: 0 }}>
        {money(load.rpm, { maximumFractionDigits: 2 })}/mi
      </Text>
    </View>
  );
}

// DASHBOARD SIMPLIFICATION (owner decision 2026-08-02): Best/Worst Lanes,
// new to Home — reuses src/stats/cashFlowTrend.ts's rankLoadsByRpm()
// (already powering Cash Flow's own "Best & Worst Lanes" section) rather
// than a second ranking implementation. Capped at 3 each (vs Cash Flow's
// full 5) to keep this a Home teaser, not a duplicate of the full screen;
// tapping through goes to Cash Flow for the complete ranked list. Reuses
// the existing `cashFlowScreen.lanesTitle`/`bestLanes`/`worstLanes` i18n
// strings rather than adding new dashboard-scoped ones — same text, same
// meaning, no new 7-locale translation needed.
function BestWorstLanesCard({
  lanes,
  onPress,
}: {
  lanes: { best: RankedLoad[]; worst: RankedLoad[]; avgRpm: number | null };
  onPress: () => void;
}) {
  const { t } = useTranslation();
  if (lanes.best.length === 0) return null;

  return (
    <TappableCard onPress={onPress}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.sm }}>{t('cashFlowScreen.lanesTitle')}</Text>
      <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.sm, marginBottom: spacing.xs }}>
        🏆 {t('cashFlowScreen.bestLanes')}
      </Text>
      {lanes.best.map((l) => (
        <HomeLaneRow key={l.id} load={l} good />
      ))}
      <Text style={{ color: colors.red, fontWeight: '700', fontSize: typography.size.sm, marginTop: spacing.sm, marginBottom: spacing.xs }}>
        ⚠️ {t('cashFlowScreen.worstLanes')}
      </Text>
      {lanes.worst.map((l) => (
        <HomeLaneRow key={l.id} load={l} good={false} />
      ))}
    </TappableCard>
  );
}

// SHARED COMPACT TILE (owner decision 2026-08-24) — three-across, small-
// text, tappable tile, originally built for the Tax Strip (TAX STRIP
// comment below) and now shared with the Per-Mile trio too, so both rows
// look and behave identically. `valueColor` is the one addition the
// Per-Mile trio needed (Profit/Mile is green/red by sign) — optional and
// defaults to the Tax Strip's plain `colors.text`, so that call site is
// unaffected.
function CompactStatTile({
  label,
  value,
  valueColor,
  subtext,
  subtextColor,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  subtext?: string;
  subtextColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.compactTile, pressed && { opacity: 0.85 }]}>
      <Text style={{ color: colors.muted, fontSize: typography.size.xs }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: valueColor ?? colors.text, fontWeight: '700', fontSize: typography.size.md }} numberOfLines={1}>
        {value}
      </Text>
      {!!subtext && (
        <Text style={{ color: subtextColor ?? colors.muted, fontSize: 10, marginTop: 2, fontWeight: '700' }} numberOfLines={1}>
          {subtext}
        </Text>
      )}
    </Pressable>
  );
}

function HomeTaxStrip({ taxQuery }: { taxQuery: ReturnType<typeof useTaxEstimate> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { money } = useFormatters();
  // MULTI-TRUCK MODEL (owner decision) — same "fleet-wide" label rule as
  // the Business Balance card above: shown only when a single truck is
  // currently selected, so this fleet-level figure is never mistaken for
  // that one truck's own tax picture.
  const { isAllTrucks, trucks } = useActiveTruck();
  const moneyRounded = (n: number) => money(n, { maximumFractionDigits: 0 });
  const goToTax = () => router.push('/(tabs)/more/tax-estimator');

  if (taxQuery.isLoading) {
    return (
      <>
        <ScreenTitle>{t('dashboard.taxStrip.title')}</ScreenTitle>
        <TappableCard onPress={goToTax}>
          <MutedText>{t('common.loading')}</MutedText>
        </TappableCard>
      </>
    );
  }
  // tax_config/tax_year_data not resolvable yet (e.g. a brand-new account
  // before onboarding writes tax_config) — nothing to show, never a $0
  // guess (CLAUDE.md invariant #6).
  if (!taxQuery.data) return null;

  const { estimate, taxYearData } = taxQuery.data;
  const deadline = nextQuarterlyDeadline(taxYearData.quarterly_deadlines);
  const deadlineSubtext = !deadline
    ? undefined
    : deadline.isPast
      ? t('taxEstimator.deadlinePast')
      : deadline.daysUntil === 0
        ? t('taxEstimator.deadlineToday')
        : t('taxEstimator.deadlineInDays', { count: deadline.daysUntil });
  const deadlineColor = deadline?.isPast || deadline?.urgency === 'urgent' ? colors.red : deadline?.urgency === 'warn' ? colors.orange : colors.muted;

  return (
    <>
      <ScreenTitle>{t('dashboard.taxStrip.title')}</ScreenTitle>
      {!isAllTrucks && trucks.length > 1 && <MutedText style={{ marginBottom: spacing.xs }}>{t('fleetScope.fleetWideAlways')}</MutedText>}
      <View style={styles.compactRow}>
        <CompactStatTile label={t('dashboard.taxStrip.weeklyReserve')} value={moneyRounded(estimate.weeklyTaxReserve)} onPress={goToTax} />
        <CompactStatTile
          label={t('dashboard.taxStrip.nextQuarterly')}
          value={moneyRounded(estimate.quarterlyPayment)}
          subtext={deadlineSubtext}
          subtextColor={deadlineColor}
          onPress={goToTax}
        />
        <CompactStatTile label={t('dashboard.taxStrip.yearlyEstimate')} value={moneyRounded(estimate.totalTax)} onPress={goToTax} />
      </View>
      <LegalFootnote />
    </>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const money2 = (n: number) => moneyFmt(n, { maximumFractionDigits: 2 });
  const { session, profile, signOut } = useAuth();
  const { activeTruck, isAllTrucks, trucks, setActiveTruckId } = useActiveTruck();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = useState(false);
  // EXPENSE TOTAL EXPLAINER (owner decision 2026-08-05, FULL PARITY
  // follow-up item D) — tapping the "Expenses" tile opens this instead of
  // just navigating to Deductions.
  const [expenseExplainerOpen, setExpenseExplainerOpen] = useState(false);
  const [deletingExpenseRowId, setDeletingExpenseRowId] = useState<string | null>(null);
  const deleteDeduction = useDeleteDeduction();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const capitalQuery = useCapitalAccountSummary();
  const aiCoach = useAiCoachSummary();
  const proactiveCoach = useProactiveCoach();
  // "UNLOCK" NUDGES (owner decision 2026-08-24, FIVE ADDITIONS pass PART 1)
  // — the SAME frequency-capped nudge list the Alerts screen shows, reused
  // here for a one-line teaser inside the AI Coach block (react-query
  // dedupes this against Alerts' own call by query key, no double-fetch).
  const alertsData = useAlertsData();
  const topUnlockNudge = alertsData.nudges[0] ?? null;
  const taxQuery = useTaxEstimate();
  // REFERRAL PROGRAM (owner decision 2026-08-24) — opportunistic, once-
  // per-session qualification check so a referral can resolve during
  // normal app use, not only when the user specifically opens the
  // "Invite & earn" screen (src/data/referral.ts's own header comment).
  useReferralSyncOnce();
  const loadsQuery = useLoads();
  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();

  // SELF-TEST FIX (owner decision, MULTI-TRUCK MODEL re-audit) — the
  // DASHBOARD LAYOUT PER SCOPE spec's own "Single truck: every money card
  // and per-mile figure is that truck only" was never actually wired —
  // every weekly-trend figure below (Hero Card, Revenue/Expenses/Net
  // trio, Recent Loads, Best/Worst Lanes) kept reading the FULL,
  // unfiltered account regardless of which truck was selected. These are
  // this truck's own DIRECT rows only (no fleet-level allocation folded
  // in — that treatment is reserved for the per-mile CPM figure below,
  // which explicitly needs it per requirement 6; a weekly revenue/expense
  // TREND is a directional chart, not a per-mile cost figure, so it stays
  // simpler). "All Trucks" scope (activeTruck null) passes every row
  // through unchanged, exactly as before.
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
  // `loads` has no truck_id of its own — src/stats/loadsScope.ts's shared
  // settlement-join filter (same one Loads' own list screen uses).
  const scopedLoads = useMemo(
    () => filterLoadsByTruckScope(loadsQuery.data ?? [], settlementsQuery.data ?? [], activeTruck?.id ?? null),
    [loadsQuery.data, settlementsQuery.data, activeTruck]
  );

  // KPI CONSISTENCY (owner decision) — DELETED a competing implementation
  // here: `useFleetStats(activeTruck?.id ?? null)` (a `statsQuery`/`stats`
  // pair) used to be declared on this screen but, per a repo-wide grep,
  // had zero remaining consumers — every real KPI figure on Home had
  // already been migrated to `periodScopedCpm`/`heroPeriodTrio` (both
  // ultimately backed by src/stats/kpi.ts's computeKpis(), the one
  // canonical KPI function) by an earlier pass, leaving this query as
  // dead weight that both wasted a network round-trip and was a live
  // landmine — a future edit reaching for "stats" here would have
  // silently resurrected the exact all-time/unscoped-vs-scoped mismatch
  // this whole KPI CONSISTENCY pass exists to eliminate.
  const capital = capitalQuery.data;

  // Zone 1 hero chart data — the FULL (unsliced) weekly trend, so 1M/3M/
  // 6M/yearly can window arbitrarily far back, not just a fixed recent
  // slice. TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): every
  // "profit" figure on this screen (the Hero Card, the Net Profit tile)
  // sources from the single canonical src/stats/trueProfit.ts, which
  // excludes a Meal already covered by per diem or an Advance Repayment —
  // neither of which is a real expense reduction. Expenses/Revenue stay on
  // the SEPARATE, deliberately broader `buildWeeklyRevenueExpenseTrend()`
  // (ALL deductions unconditionally, matching the "Total Deductions" card
  // elsewhere — CLAUDE.md's own TRUE-PROFIT CONSISTENCY entry: "only Net
  // Profit needed the exclusion").
  const fullWeeklyRevenueExpenseTrend = useMemo(
    () => buildWeeklyRevenueExpenseTrend(scopedSettlements, scopedDeductions),
    [scopedSettlements, scopedDeductions]
  );
  const revenueExpenseTrend = useMemo(() => fullWeeklyRevenueExpenseTrend.slice(-8), [fullWeeklyRevenueExpenseTrend]);
  const fullWeeklyTrueProfitTrend = useMemo(
    () => buildWeeklyTrueProfitTrend(scopedSettlements, scopedDeductions, scopedFuel, scopedMaintenance, scopedTolls),
    [scopedSettlements, scopedDeductions, scopedFuel, scopedMaintenance, scopedTolls]
  );
  const fullWeeklyTrueProfitAsRevenueExpense = useMemo(
    () => fullWeeklyTrueProfitTrend.map((p) => ({ weekEnding: p.weekEnding, revenue: p.gross, expenses: p.gross - p.net })),
    [fullWeeklyTrueProfitTrend]
  );

  // CPM/PPM BROKEN AGAIN pass (owner decision) — `heroPeriod`/`now`/
  // `heroWindow` are declared ONCE, here, right after the weekly trends
  // they window — every period-scoped figure on this screen (the Hero
  // Card, the Revenue/Expenses/Net Profit trio below it, the per-mile
  // trio, the profit-score bar) reads from this SAME state, so none of
  // them can ever land on a different window from each other.
  const [heroPeriod, setHeroPeriod] = useState<HeroPeriod>('thisWeek');
  const now = useMemo(() => new Date(), [heroPeriod]);
  const heroWindow = useMemo(
    () => resolveHeroPeriodDateWindow(heroPeriod, fullWeeklyTrueProfitTrend.map((p) => p.weekEnding), now),
    [heroPeriod, fullWeeklyTrueProfitTrend, now]
  );
  const heroPeriodResult = useMemo(
    () => calcHeroPeriod(fullWeeklyTrueProfitAsRevenueExpense, heroPeriod, now),
    [fullWeeklyTrueProfitAsRevenueExpense, heroPeriod, now]
  );
  // ITEM 0 (owner decision, CPM/PPM BROKEN AGAIN follow-up) — the
  // Revenue/Expenses/Net Profit trio used to be a FIXED "this week vs
  // last week" comparison regardless of `heroPeriod`, while the Hero Card
  // right above it and the per-mile trio right below it both already
  // followed the selected tab — exactly the "rows on the same screen
  // describe different windows" bug class this whole pass exists to
  // catch. `calcHeroRevenueExpenseTrio()` sums RAW settlement/deduction
  // rows directly by `heroWindow` (and its own equivalent previous
  // window for the delta) — never re-derived from the settlement-week-
  // bucketed trend — which is what guarantees this Expenses figure always
  // equals the Expense Total Explainer modal's own row sum below (both
  // filter the identical `scopedDeductions` by the identical `heroWindow`).
  // Net Profit itself reuses `heroPeriodResult.netProfit`/`.change`
  // directly (not a second, independently-computed figure) — it's the
  // SAME true-profit number the Hero Card's own headline already shows,
  // so the two can never disagree.
  const heroPeriodTrio = useMemo(
    () => calcHeroRevenueExpenseTrio(scopedSettlements, scopedDeductions, heroPeriod, fullWeeklyTrueProfitTrend.map((p) => p.weekEnding), now),
    [scopedSettlements, scopedDeductions, heroPeriod, fullWeeklyTrueProfitTrend, now]
  );
  // Both truck-scoped (scopedFuel/scopedDeductions, from the earlier
  // MULTI-TRUCK MODEL pass) AND period-scoped (via heroWindow) — the SAME
  // two-axis filtering the per-mile trio's own buildPeriodScopedCpm()
  // applies, so the profit-score bar's inputs (and, below, the Expense
  // Total Explainer's own rows) can never drift onto a different window
  // than the big numbers sitting right above them.
  const periodFuel = useMemo(() => filterRowsByDateWindow(scopedFuel, (f) => f.purchase_date, heroWindow), [scopedFuel, heroWindow]);
  const periodDeductionsAll = useMemo(
    () => filterRowsByDateWindow(scopedDeductions, (d) => d.ded_date, heroWindow),
    [scopedDeductions, heroWindow]
  );
  const fuelCost = useMemo(
    () => periodFuel.reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [periodFuel]
  );

  const heroFirstName =
    profile?.owner_name?.trim().split(/\s+/)[0] || session?.user?.email?.split('@')[0] || t('dashboard.hero.fallbackName');
  // `thisWeekPoint`/`thisWeekExpenseRows` stay pinned to the LATEST
  // settlement week specifically (never `heroWindow`) — they only feed the
  // "All Trucks" PER TRUCK THIS WEEK card below, a deliberately separate,
  // always-this-week feature (its own header comment), not the trio.
  const thisWeekPoint = revenueExpenseTrend[revenueExpenseTrend.length - 1];

  // EXPENSE TOTAL EXPLAINER — now reads `periodDeductionsAll` (the SAME
  // period+truck-scoped rows the profit-score bar above uses) instead of
  // a hardcoded "this week" window, so tapping the Expenses tile always
  // opens a breakdown for the exact period that tile's own number just
  // showed — the same "two figures, same card, must never disagree"
  // property this whole pass exists to enforce, now extended to the
  // tile-to-modal relationship too.
  const expenseExplainer = useMemo(() => buildExpenseTotalExplainer(periodDeductionsAll), [periodDeductionsAll]);

  const thisWeekExpenseRows = useMemo(() => {
    if (!thisWeekPoint) return [];
    const start = weekStartFromEnding(thisWeekPoint.weekEnding);
    return scopedDeductions.filter((d) => d.ded_date && d.ded_date >= start && d.ded_date <= thisWeekPoint.weekEnding);
  }, [scopedDeductions, thisWeekPoint]);

  // DASHBOARD LAYOUT PER SCOPE (owner decision, MULTI-TRUCK MODEL) — "All
  // Trucks" mode: a PER TRUCK THIS WEEK card, ranked, tapping a row
  // switches the global scope to that truck. Reuses buildTruckComparison()
  // (the same function the full comparison + Scorecard breakdown use),
  // deliberately fed THIS WEEK's own rows always (not `heroWindow`) — a
  // separate, always-this-week feature, unrelated to the period tabs.
  const perTruckThisWeek = useMemo(() => {
    if (!isAllTrucks || !thisWeekPoint) return null;
    const start = weekStartFromEnding(thisWeekPoint.weekEnding);
    const inWeek = (d: string | null) => !!d && d >= start && d <= thisWeekPoint.weekEnding;
    return buildTruckComparison(
      trucks,
      (settlementsQuery.data ?? []).filter((s) => s.week_ending === thisWeekPoint.weekEnding),
      loadsQuery.data ?? [],
      thisWeekExpenseRows,
      (fuelQuery.data ?? []).filter((f) => inWeek(f.purchase_date)),
      (maintenanceQuery.data ?? []).filter((m) => inWeek(m.service_date)),
      (tollsQuery.data ?? []).filter((tl) => inWeek(tl.toll_date))
    );
  }, [isAllTrucks, thisWeekPoint, trucks, settlementsQuery.data, loadsQuery.data, thisWeekExpenseRows, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]);

  function handleDeleteExpenseRow(id: string) {
    Alert.alert(t('deductions.deleteConfirmTitle'), t('deductions.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setDeletingExpenseRowId(id);
          try {
            // Linked capital_transactions row cascades automatically
            // (docs/SCHEMA.sql: linked_deduction_id ... on delete cascade —
            // CLAUDE.md invariant #5), same as Deductions' own delete. Row
            // is looked up from `periodDeductionsAll` now, matching the
            // rows the Expense Total Explainer modal actually renders.
            const row = periodDeductionsAll.find((d) => d.id === id);
            await deleteDeduction.mutateAsync(id);
            if (row?.document_id) await cleanupOrphanedDocument(row.document_id);
            await invalidateFinancialData(queryClient, {
              entities: row?.document_id ? ['deductions', 'capital_transactions', 'documents'] : ['deductions', 'capital_transactions'],
            });
          } catch (err) {
            Alert.alert(t('deductions.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
          } finally {
            setDeletingExpenseRowId(null);
          }
        },
      },
    ]);
  }

  // PER-MILE TRIO — CPM/PPM BROKEN AGAIN, ROOT CAUSE FIX (owner decision,
  // device report: "implausible values, doesn't change when I switch the
  // hero card's period tabs"). ROOT CAUSE (confirmed by trace, reported
  // before this fix): this trio used to be computed from
  // truckComparisonResult/stats — BOTH always ALL-TIME, completely
  // independent of `heroPeriod` — so it never moved when the Hero Card's
  // own period tabs changed, and an all-time blended average could look
  // wildly implausible next to whatever single-period number the Hero
  // Card above it was showing. `buildPeriodScopedCpm()` (src/stats/
  // periodScopedCpm.ts) is the ONE shared resolver every period-aware CPM
  // consumer now uses — it resolves `heroPeriod` to a concrete date
  // window (the SAME window src/stats/heroPeriod.ts's own
  // calcHeroPeriod() uses for "this week"/"last week", since both read
  // from the identical ascending week_ending list) and filters EVERY
  // input row (settlements/loads/deductions/fuel/maintenance/tolls)
  // through that SAME window before computing anything — so numerator
  // (costs/revenue) and denominator (miles) can never drift onto
  // different date ranges from each other, and a truck's fixed cost is
  // naturally pro-rated to however many settlement weeks actually fall
  // in the window (1 for "This Week," ~4 for "1M," ...) rather than a
  // flat all-time lump sum. Scorecard's own CPM stays deliberately
  // all-time/unwindowed (it has no period tabs) — this is Home-specific.
  const periodScopedCpm = useMemo(
    () =>
      buildPeriodScopedCpm(
        heroPeriod,
        fullWeeklyTrueProfitTrend.map((p) => p.weekEnding),
        trucks,
        settlementsQuery.data ?? [],
        loadsQuery.data ?? [],
        dedQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? [],
        activeTruck?.id ?? null,
        activeTruck?.manual_total_miles_override,
        now
      ),
    [
      heroPeriod,
      fullWeeklyTrueProfitTrend,
      trucks,
      settlementsQuery.data,
      loadsQuery.data,
      dedQuery.data,
      fuelQuery.data,
      maintenanceQuery.data,
      tollsQuery.data,
      activeTruck,
      now,
    ]
  );
  const canonicalCpm = periodScopedCpm.cpm;
  // SELF-TEST AUDIT (owner decision, CPM/PPM BROKEN AGAIN pass, item 4) —
  // see heroWindow's own comment above for the "two figures, different
  // windows" bug this closes: the profit-score bar's grossRevenue/
  // totalMiles now come from this SAME periodScopedCpm computation (its
  // scoped-truck row, or the fleet aggregate in "All Trucks" scope) —
  // never a second, independently-resolved figure.
  const profitScore = useMemo(() => {
    if (!heroWindow) return null;
    const grossRevenue = periodScopedCpm.scopedRow ? periodScopedCpm.scopedRow.grossRevenue : periodScopedCpm.comparison.fleetTotals.grossRevenue;
    const totalMiles = periodScopedCpm.scopedRow ? periodScopedCpm.scopedRow.totalMiles : periodScopedCpm.comparison.fleetTotals.totalMiles;
    // Legacy calcScorecard() convention (CLAUDE.md's own established
    // exemption): ALL deductions unconditionally, never the canonical
    // CPM engine's own Meals/Advance Repayment/Escrow exclusions — kept
    // deliberately verbatim, only its INPUTS are now period-scoped.
    const totalDeductions = periodDeductionsAll.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    return calcScorecard(grossRevenue, totalDeductions, totalMiles, fuelCost)?.score ?? null;
  }, [heroWindow, periodScopedCpm, periodDeductionsAll, fuelCost]);
  // SANITY GUARD (requirement 3): distinguishes "no settlements at all in
  // this window" (window itself is null — e.g. "This Week" before any
  // settlement has ever been imported) from "settlements exist in this
  // window but have no recorded miles" (window resolved, but totalMiles
  // is 0) — both must say so plainly instead of showing a number, but are
  // genuinely different situations worth naming differently.
  const perMileNoWindow = !periodScopedCpm.window;
  const perMileMilesMissing = !perMileNoWindow && canonicalCpm != null && canonicalCpm.revenuePerMile == null;
  const [cpmWhyOpen, setCpmWhyOpen] = useState(false);

  const recentLoads = useMemo(() => {
    return [...scopedLoads].sort((a, b) => new Date(b.load_date ?? 0).getTime() - new Date(a.load_date ?? 0).getTime()).slice(0, 4);
  }, [scopedLoads]);

  // Best/Worst Lanes (item e) — capped at 3 each for a Home teaser, see
  // BestWorstLanesCard's own comment.
  const lanes = useMemo(() => rankLoadsByRpm(scopedLoads, 3), [scopedLoads]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <DashboardGreeting name={heroFirstName} />
        {/* MULTI-TRUCK MODEL — SELECTOR PLACEMENT (owner decision): the
            ONE interactive scope control in the app — a dedicated,
            full-width chip strip between the header and the rest of the
            dashboard. Hidden entirely for a 0/1-truck account (no
            clutter for a solo operator); appears the moment a 2nd truck
            exists. Every other screen shows the read-only FleetScopeLabel
            instead — same context, never a second interactive control. */}
        <FleetScopeSelectorStrip />

        <ServiceStatusBanner />

        <HeroCard
          period={heroPeriod}
          onPeriodChange={setHeroPeriod}
          weekNetProfit={heroPeriodResult.netProfit}
          netProfitChange={heroPeriodResult.change}
          netProfitDeltaAmount={heroPeriodResult.deltaAmount}
          chartPoints={heroPeriodResult.chartPoints}
          profitScore={profitScore}
          onPress={() => router.push('/(tabs)/more/cash-flow')}
        />

        {/* ITEM 0 (owner decision, CPM/PPM BROKEN AGAIN follow-up): this
            trio now describes the SAME `heroPeriod` window as the Hero
            Card above it and the per-mile trio below it — Revenue/
            Expenses via `heroPeriodTrio` (its own delta vs. the equivalent
            PRECEDING window, same convention as calcHeroPeriod()'s own
            delta), Net Profit reusing `heroPeriodResult` directly so it
            can never show a different figure than the Hero Card's own
            headline number for the same period. */}
        <View style={styles.compactRow}>
          <OverviewTile
            label={t('dashboard.hero.revenue')}
            value={money(heroPeriodTrio.revenue)}
            valueColor={colors.green}
            change={heroPeriodTrio.revenueChange}
            goodDirection="up"
            onPress={() => router.push('/(tabs)/more/cash-flow')}
          />
          <OverviewTile
            label={t('dashboard.overview.expenses')}
            value={money(heroPeriodTrio.expenses)}
            valueColor={colors.red}
            change={heroPeriodTrio.expensesChange}
            goodDirection="down"
            onPress={() => setExpenseExplainerOpen(true)}
          />
          <OverviewTile
            label={t('dashboard.hero.netProfit')}
            value={money(heroPeriodResult.netProfit)}
            valueColor={heroPeriodResult.netProfit < 0 ? colors.red : colors.green}
            change={heroPeriodResult.change}
            goodDirection="up"
            onPress={() => router.push('/(tabs)/more/cash-flow')}
          />
        </View>

        {/* PER-MILE TRIO — CPM/PPM BROKEN AGAIN fix (owner decision):
            Revenue/Mile, Cost/Mile (CPM), Profit/Mile, always for the SAME
            period the Hero Card's own tabs above have selected (see
            periodScopedCpm's own header comment). All three now open a
            HOME-LOCAL "Why?" breakdown reflecting that identical period —
            Scorecard's own breakdown is deliberately all-time/unwindowed
            (it has no period tabs), so routing there would silently show
            a different window than the one just tapped. */}
        <View style={styles.compactRow}>
          <CompactStatTile
            label={t('scorecard.revenuePerMile')}
            value={canonicalCpm?.revenuePerMile != null ? money2(canonicalCpm.revenuePerMile) : '—'}
            onPress={() => setCpmWhyOpen(true)}
          />
          <CompactStatTile
            label={t('scorecard.costPerMile')}
            value={canonicalCpm?.costPerMile != null ? money2(canonicalCpm.costPerMile) : '—'}
            onPress={() => setCpmWhyOpen(true)}
          />
          <CompactStatTile
            label={t('scorecard.whyPpm')}
            value={canonicalCpm?.profitPerMile != null ? money2(canonicalCpm.profitPerMile) : '—'}
            valueColor={canonicalCpm?.profitPerMile != null ? (canonicalCpm.profitPerMile >= 0 ? colors.green : colors.red) : undefined}
            onPress={() => setCpmWhyOpen(true)}
          />
        </View>
        {/* SANITY GUARDS (requirement 3) — "no data at all in this window"
            (e.g. "This Week" before any settlement has ever been
            imported) and "settlements exist but have no recorded miles"
            are genuinely different situations, named differently rather
            than folded into one ambiguous message. */}
        {perMileNoWindow && (
          <MutedText style={{ color: colors.orange, fontWeight: '700', marginTop: -spacing.xs, marginBottom: spacing.sm }} numberOfLines={2}>
            ⚠️ {t('dashboard.perMileTrio.noDataForPeriod')}
          </MutedText>
        )}
        {perMileMilesMissing && (
          <MutedText style={{ color: colors.orange, fontWeight: '700', marginTop: -spacing.xs, marginBottom: spacing.sm }} numberOfLines={2}>
            ⚠️ {t('scorecard.milesMissingWarning')}
          </MutedText>
        )}
        {/* CPM/MILES WARNING (spec: "warn when CPM > $4"), same threshold
            Scorecard's own breakdown uses, now correctly evaluated
            against the CURRENT period's own cost/mile figure. */}
        {canonicalCpm?.costPerMile != null && canonicalCpm.costPerMile > 4 && (
          <Pressable onPress={() => setCpmWhyOpen(true)}>
            <MutedText style={{ color: colors.red, fontWeight: '700', marginTop: -spacing.xs, marginBottom: spacing.sm }} numberOfLines={2}>
              ⚠️ {t('scorecard.cpmTooHighWarning', { cpm: money2(canonicalCpm.costPerMile) })}
            </MutedText>
          </Pressable>
        )}

        {/* DASHBOARD LAYOUT PER SCOPE (owner decision, MULTI-TRUCK MODEL) —
            "All Trucks" mode only. */}
        {perTruckThisWeek && (
          <PerTruckThisWeekCard result={perTruckThisWeek} onSelectTruck={setActiveTruckId} />
        )}

        <CashBalanceSlimCard balance={capital?.businessBalance ?? 0} onPress={() => router.push('/(tabs)/more/cash-flow')} />
        {/* Fleet-level card (requirement 2's 1st category) — carries a
            small "fleet-wide" label ONLY when a single truck is currently
            selected, so it's never mistaken for that one truck's own
            balance (a multi-truck account viewing "All Trucks" already
            has no such ambiguity to clear up). */}
        {!isAllTrucks && trucks.length > 1 && (
          <MutedText style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>{t('fleetScope.fleetWideAlways')}</MutedText>
        )}

        {aiCoach.isLoading ? (
          <>
            <ScreenTitle>{t('ceoMode.title')}</ScreenTitle>
            <TappableCard onPress={() => router.push('/(tabs)/more/ceo-mode')}>
              <MutedText>{t('common.loading')}</MutedText>
            </TappableCard>
          </>
        ) : (
          <AiCoachSection coach={aiCoach} proactive={proactiveCoach} name={heroFirstName} topUnlockNudge={topUnlockNudge} />
        )}

        <ScreenTitle>{t('dashboard.recentLoadsTitle')}</ScreenTitle>
        <TappableCard onPress={() => router.push('/(tabs)/more/loads')}>
          {recentLoads.length === 0 ? (
            <MutedText>{t('dashboard.noLoadsYet')}</MutedText>
          ) : (
            recentLoads.map((l) => (
              <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                <MutedText style={{ flex: 1, marginEnd: spacing.sm }} numberOfLines={1}>
                  {l.order_number ?? '—'} · {l.origin ?? '—'} → {l.destination ?? '—'}
                </MutedText>
                <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 0 }}>{money(l.revenue)}</Text>
              </View>
            ))
          )}
        </TappableCard>

        <BestWorstLanesCard lanes={lanes} onPress={() => router.push('/(tabs)/more/cash-flow')} />

        <HomeTaxStrip taxQuery={taxQuery} />

        <SecondaryButton title={t('common.signOut')} onPress={signOut} />
      </ScrollView>

      {/* EXPENSE TOTAL EXPLAINER (owner decision 2026-08-05, FULL PARITY
          follow-up item D). */}
      <ModalSheet visible={expenseExplainerOpen} onClose={() => setExpenseExplainerOpen(false)}>
        <SheetTitle>{t(`dashboard.expenseExplainer.titleByPeriod.${heroPeriod}`)}</SheetTitle>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <MutedText>{t('dashboard.expenseExplainer.total')}</MutedText>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{money(expenseExplainer.total)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
          <MutedText>{t('dashboard.expenseExplainer.fixed')}</MutedText>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{money(expenseExplainer.fixedTotal)}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs, marginBottom: spacing.sm }}>
          <MutedText>{t('dashboard.expenseExplainer.variable')}</MutedText>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{money(expenseExplainer.variableTotal)}</Text>
        </View>

        {expenseExplainer.excludedVehiclePurchaseTotal > 0 && (
          <MutedText style={{ marginBottom: spacing.sm }}>
            {t('dashboard.expenseExplainer.excludedVehiclePurchase', { amount: money(expenseExplainer.excludedVehiclePurchaseTotal) })}
          </MutedText>
        )}

        {expenseExplainer.largestRows.length === 0 ? (
          <MutedText>{t('dashboard.expenseExplainer.empty')}</MutedText>
        ) : (
          <>
            <Text style={styles.expenseExplainerSectionTitle}>{t('dashboard.expenseExplainer.largestRowsTitle')}</Text>
            {expenseExplainer.largestRows.map((row, i) => (
              <View
                key={row.id}
                style={[
                  { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                ]}
              >
                <View style={{ flex: 1, marginEnd: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    {row.description}
                  </Text>
                  {row.isPossibleDepreciableAsset && (
                    <MutedText style={{ color: colors.orange, fontSize: typography.size.xs }}>
                      {t('dashboard.expenseExplainer.possibleDepreciableAsset')}
                    </MutedText>
                  )}
                </View>
                <Text style={{ color: colors.text, fontWeight: '700', marginEnd: spacing.sm }}>{money(row.amount)}</Text>
                <Pressable onPress={() => handleDeleteExpenseRow(row.id)} hitSlop={8} disabled={deletingExpenseRowId === row.id}>
                  <Text style={{ color: colors.red, fontWeight: '700' }}>
                    {deletingExpenseRowId === row.id ? '…' : '🗑️'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        )}

        <SecondaryButton title={t('common.close')} onPress={() => setExpenseExplainerOpen(false)} />
      </ModalSheet>

      {/* CPM/PPM BROKEN AGAIN fix (owner decision) — a HOME-LOCAL "Why?"
          breakdown for the per-mile trio, reflecting the exact same
          heroPeriod window the trio itself is currently showing (never
          Scorecard's own deliberately all-time breakdown, which would
          silently disagree once a period other than "This Week" is
          active). */}
      <ModalSheet visible={cpmWhyOpen} onClose={() => setCpmWhyOpen(false)}>
        <SheetTitle>{t('scorecard.whyTitle')}</SheetTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>
          {t(`dashboard.hero.periodTabs.${heroPeriod}`)}
          {periodScopedCpm.window ? ` · ${periodScopedCpm.window.startIso} – ${periodScopedCpm.window.endIso}` : ''}
        </MutedText>
        {perMileNoWindow ? (
          <MutedText>{t('dashboard.perMileTrio.noDataForPeriod')}</MutedText>
        ) : !canonicalCpm ? (
          <MutedText>{t('common.loading')}</MutedText>
        ) : (
          <>
            {perMileMilesMissing && (
              <MutedText style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.sm }}>
                ⚠️ {t('scorecard.milesMissingWarning')}
              </MutedText>
            )}
            {canonicalCpm.buckets.map((b, i) => (
              <View key={b.category} style={[styles.whyRow, i > 0 && styles.whyRowBorder]}>
                <MutedText>{b.category}</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(b.amount)}</Text>
              </View>
            ))}
            <View style={[styles.whyRow, styles.whyRowBorder]}>
              <MutedText style={{ fontWeight: '700' }}>{t('scorecard.whyFixedTotal')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{money(canonicalCpm.fixedTotal)}</Text>
            </View>
            <View style={[styles.whyRow, styles.whyRowBorder]}>
              <MutedText style={{ fontWeight: '700' }}>{t('scorecard.whyVariableTotal')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{money(canonicalCpm.variableTotal)}</Text>
            </View>
            {canonicalCpm.excludedOneOffs.length > 0 && (
              <>
                <Text style={[styles.whySectionTitle, { marginTop: spacing.sm }]}>{t('scorecard.whyExcludedOneOffsTitle')}</Text>
                <MutedText>{t('scorecard.whyExcludedOneOffsNote')}</MutedText>
                {canonicalCpm.excludedOneOffs.map((item, i) => (
                  <View key={`${item.description}-${i}`} style={[styles.whyRow, i > 0 && styles.whyRowBorder]}>
                    <MutedText style={{ flex: 1 }}>{item.description}</MutedText>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{money(item.amount)}</Text>
                  </View>
                ))}
              </>
            )}
            {canonicalCpm.excludedTotal > 0 && (
              <View style={[styles.whyRow, styles.whyRowBorder]}>
                <MutedText>{t('scorecard.cpmExcludedTotal')}</MutedText>
                <MutedText>{money(canonicalCpm.excludedTotal)}</MutedText>
              </View>
            )}
          </>
        )}
        <SecondaryButton title={t('common.close')} onPress={() => setCpmWhyOpen(false)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  compactRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  whyRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  whyRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  whySectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  expenseExplainerSectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  slimCard: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  compactTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  hero: {
    borderRadius: radii.lg,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroEyebrow: {
    color: 'rgba(240,240,245,0.65)',
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  heroBigValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '800' as const,
    marginTop: spacing.xs,
  },
  heroChange: {
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    marginTop: spacing.xs,
  },
  heroScoreLabel: {
    color: 'rgba(240,240,245,0.65)',
    fontSize: typography.size.xs,
    fontWeight: '600' as const,
  },
  heroScoreTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(240,240,245,0.12)',
    overflow: 'hidden' as const,
  },
  heroScoreFill: {
    height: 8,
    borderRadius: 4,
  },
};
