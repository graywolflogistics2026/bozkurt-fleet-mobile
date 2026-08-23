import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useLoads } from '@/src/data/loads';
import { useDeductions } from '@/src/data/deductions';
import { useSettlements } from '@/src/data/settlements';
import { buildWeeklyRevenueExpenseTrend, rankLoadsByRpm, type WeeklyRevenueExpensePoint, type RankedLoad } from '@/src/stats/cashFlowTrend';
import { calcScorecard } from '@/src/stats/scorecard';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { calcWeekOverWeekChange, type WeekOverWeekChange } from '@/src/stats/heroStats';
import { calcHeroPeriod, HERO_PERIODS, type HeroPeriod } from '@/src/stats/heroPeriod';
import { buildPolylinePoints, buildAreaPoints } from '@/src/stats/chartHelpers';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { Screen, ScreenTitle, TappableCard, MutedText, SecondaryButton } from '@/src/components/ui';
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
//   c) Business Balance slim card
//   d) AI Coach card (fixed entry point into the ceo-mode briefing screen
//      — no rotating insight logic anymore, see AiCoachCard below)
//   e) Recent Loads, then Best/Worst Lanes
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

// DASHBOARD SIMPLIFICATION (owner decision 2026-08-02): fixed entry point
// into the AI Coach briefing (ceo-mode.tsx) — replaces the old rotating
// AI Insight card. Same visual container/treatment (icon + bold title +
// one sentence, tappable) as the retired AiInsightsCard, but the content
// no longer rotates through candidate insight types; it always reads as
// an invitation into the Coach. Reuses the existing `ceoMode.title`/
// `ceoMode.subtitle` i18n strings ("AI Coach" / "Your weekly business
// briefing, composed from your own data.") rather than adding new keys —
// they already say exactly this, in all 7 supported locales.
function AiCoachCard({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <TappableCard onPress={onPress}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>🧑‍✈️ {t('ceoMode.title')}</Text>
      <Text style={{ color: colors.text }}>{t('ceoMode.subtitle')}</Text>
    </TappableCard>
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

export default function Dashboard() {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const { session, profile, signOut } = useAuth();
  const { activeTruck } = useActiveTruck();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const statsQuery = useFleetStats(activeTruck?.id ?? null);
  const capitalQuery = useCapitalAccountSummary();
  const loadsQuery = useLoads();
  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();

  const stats = statsQuery.data;
  const capital = capitalQuery.data;

  // Zone 1 hero chart data — last 8 completed weeks (matching Scorecard/
  // Cash Flow's established "last 8 weeks" trend convention elsewhere in
  // the app) so the Revenue/Expenses trio stays legible regardless of how
  // much settlement history exists.
  const fullWeeklyRevenueExpenseTrend = useMemo(
    () => buildWeeklyRevenueExpenseTrend(settlementsQuery.data ?? [], dedQuery.data ?? []),
    [settlementsQuery.data, dedQuery.data]
  );
  const revenueExpenseTrend = useMemo(() => fullWeeklyRevenueExpenseTrend.slice(-8), [fullWeeklyRevenueExpenseTrend]);

  // TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): every "profit"
  // figure on this screen (the Hero Card, the Net Profit tile) sources
  // from the single canonical src/stats/trueProfit.ts, which excludes a
  // Meal already covered by per diem or an Advance Repayment — neither
  // of which is a real expense reduction.
  const fullWeeklyTrueProfitTrend = useMemo(
    () =>
      buildWeeklyTrueProfitTrend(
        settlementsQuery.data ?? [],
        dedQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]
  );

  const heroFirstName =
    profile?.owner_name?.trim().split(/\s+/)[0] || session?.user?.email?.split('@')[0] || t('dashboard.hero.fallbackName');
  const thisWeekPoint = revenueExpenseTrend[revenueExpenseTrend.length - 1];
  const lastWeekPoint = revenueExpenseTrend[revenueExpenseTrend.length - 2];
  const heroWeekRevenue = thisWeekPoint?.revenue ?? 0;
  const heroWeekExpenses = thisWeekPoint?.expenses ?? 0;
  const trueProfitTrend8 = fullWeeklyTrueProfitTrend.slice(-8);
  const thisWeekTrueProfitPoint = trueProfitTrend8[trueProfitTrend8.length - 1];
  const lastWeekTrueProfitPoint = trueProfitTrend8[trueProfitTrend8.length - 2];
  const heroWeekNetProfit = thisWeekTrueProfitPoint?.net ?? 0;
  const lastWeekNetProfit = lastWeekTrueProfitPoint ? lastWeekTrueProfitPoint.net : null;
  const heroRevenueChange = calcWeekOverWeekChange(heroWeekRevenue, lastWeekPoint?.revenue);
  const heroExpensesChange = calcWeekOverWeekChange(heroWeekExpenses, lastWeekPoint?.expenses);
  const heroNetProfitChange = calcWeekOverWeekChange(heroWeekNetProfit, lastWeekNetProfit);
  // UX MEGA-PASS item G(1): period tabs drive the Hero Card's number/
  // delta/chart together via calcHeroPeriod() — reads the FULL (unsliced)
  // weekly trend so 1M/3M/6M/yearly can window arbitrarily far back, not
  // just the last 8 weeks revenueExpenseTrend is capped to.
  const fullWeeklyTrueProfitAsRevenueExpense = useMemo(
    () => fullWeeklyTrueProfitTrend.map((p) => ({ weekEnding: p.weekEnding, revenue: p.gross, expenses: p.gross - p.net })),
    [fullWeeklyTrueProfitTrend]
  );
  const [heroPeriod, setHeroPeriod] = useState<HeroPeriod>('thisWeek');
  const heroPeriodResult = useMemo(
    () => calcHeroPeriod(fullWeeklyTrueProfitAsRevenueExpense, heroPeriod),
    [fullWeeklyTrueProfitAsRevenueExpense, heroPeriod]
  );
  const fuelCost = useMemo(
    () => (fuelQuery.data ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [fuelQuery.data]
  );
  const profitScore = useMemo(() => {
    if (!stats) return null;
    return calcScorecard(stats.grossRevenue, stats.totalDeductions, stats.totalMiles, fuelCost)?.score ?? null;
  }, [stats, fuelCost]);

  const recentLoads = useMemo(() => {
    return [...(loadsQuery.data ?? [])]
      .sort((a, b) => new Date(b.load_date ?? 0).getTime() - new Date(a.load_date ?? 0).getTime())
      .slice(0, 4);
  }, [loadsQuery.data]);

  // Best/Worst Lanes (item e) — capped at 3 each for a Home teaser, see
  // BestWorstLanesCard's own comment.
  const lanes = useMemo(() => rankLoadsByRpm(loadsQuery.data ?? [], 3), [loadsQuery.data]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <DashboardGreeting name={heroFirstName} />

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

        <View style={styles.compactRow}>
          <OverviewTile
            label={t('dashboard.hero.revenue')}
            value={money(heroWeekRevenue)}
            valueColor={colors.green}
            change={heroRevenueChange}
            goodDirection="up"
            onPress={() => router.push('/(tabs)/more/cash-flow')}
          />
          <OverviewTile
            label={t('dashboard.overview.expenses')}
            value={money(heroWeekExpenses)}
            valueColor={colors.red}
            change={heroExpensesChange}
            goodDirection="down"
            onPress={() => router.push('/(tabs)/deductions')}
          />
          <OverviewTile
            label={t('dashboard.hero.netProfit')}
            value={money(heroWeekNetProfit)}
            valueColor={heroWeekNetProfit < 0 ? colors.red : colors.green}
            change={heroNetProfitChange}
            goodDirection="up"
            onPress={() => router.push('/(tabs)/more/cash-flow')}
          />
        </View>

        <CashBalanceSlimCard balance={capital?.businessBalance ?? 0} onPress={() => router.push('/(tabs)/more/cash-flow')} />

        <AiCoachCard onPress={() => router.push('/(tabs)/more/ceo-mode')} />

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

        <SecondaryButton title={t('common.signOut')} onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}

const styles = {
  compactRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
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
