import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polyline } from 'react-native-svg';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFleetStats, fetchFleetStats, fetchDriverStats } from '@/src/data/dashboardStats';
import { useDrivers } from '@/src/data/drivers';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useTrucksList } from '@/src/data/trucks';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useLoads } from '@/src/data/loads';
import { useDeductions } from '@/src/data/deductions';
import { useSettlements } from '@/src/data/settlements';
import { useUserCategories } from '@/src/data/userCategories';
import { useBenchmarks } from '@/src/data/benchmarks';
import { buildProfitLoss } from '@/src/stats/profitLoss';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildInsightCandidates, selectDailyInsight, type Insight } from '@/src/stats/aiInsights';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { calcTruckHealth, type HealthOverrides } from '@/src/truck/health';
import { calcComplianceStatus } from '@/src/compliance/status';
import { useDashboardLayout, useUpdateSectionsCollapsed, type SectionsCollapsed } from '@/src/data/dashboardLayout';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { nextQuarterlyDeadline, type QuarterlyDeadlineStatus } from '@/src/tax/quarterly';
import { calcScorpSavingsPreview } from '@/src/tax/scorpSavings';
import { ppmColor } from '@/src/stats/cpm';
import { calcScorecard } from '@/src/stats/scorecard';
import { buildWeeklyTrend, buildWeeklyRevenueExpenseTrend, type WeeklyRevenueExpensePoint } from '@/src/stats/cashFlowTrend';
import { buildWeeklyCpmTrend, calcCpmTrends, type MetricTrend } from '@/src/stats/cpmTrend';
import { calcWeekOverWeekChange, type WeekOverWeekChange } from '@/src/stats/heroStats';
import { calcFleetHealthScore, type ChipStatus } from '@/src/stats/fleetHealthScore';
import { filterTrendByRange, TREND_RANGES, type TrendRange } from '@/src/stats/trendRange';
import { calcTaxProgressColor, calcTaxProgressPct } from '@/src/stats/taxProgress';
import {
  CARD_LABEL_KEYS,
  SECTION_IDS,
  SECTION_LABEL_KEYS,
  type DashboardCardId,
  type DashboardCardConfig,
  type SectionId,
} from '@/src/stats/dashboardLayout';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, SecondaryButton, Field, ModalSheet, SheetTitle } from '@/src/components/ui';
import { useAnimatedNumber } from '@/src/components/AnimatedNumber';
import { CircularGauge } from '@/src/components/CircularGauge';
import { DonutChart, type DonutSlice } from '@/src/components/DonutChart';
import { useFormatters } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';

const FILING_STATUS_LABEL: Record<string, string> = { single: 'Single', mfj: 'MFJ', hoh: 'HOH' };

// "@$64/day (80% of $80)" — the 80% and $80 are both derived from
// tax_year_data.per_diem (docs/PENDING_SQL.md §10), never hardcoded
// (CLAUDE.md invariant #6). Degrades to just "@$64/day" until that
// migration has run and full_daily_rate exists on the live row.
function perDiemCaption(
  perDiem: { daily_rate: number; full_daily_rate?: number } | undefined,
  t: TFunction
): string | null {
  if (!perDiem) return null;
  if (!perDiem.full_daily_rate) return t('dashboard.perDiemCaptionSimple', { rate: perDiem.daily_rate });
  const pct = Math.round((perDiem.daily_rate / perDiem.full_daily_rate) * 100);
  return t('dashboard.perDiemCaptionFull', { rate: perDiem.daily_rate, pct, fullRate: perDiem.full_daily_rate });
}

function urgencyColor(urgency: QuarterlyDeadlineStatus['urgency']) {
  if (urgency === 'urgent') return colors.red;
  if (urgency === 'warn') return colors.orange;
  return colors.muted;
}

const CHART_HEIGHT = 110;

// Revenue-vs-Expenses trend (Dashboard Zone 1 hero, device feedback round
// 2 — weekly, superseding the earlier monthly version; see
// src/stats/cashFlowTrend.ts's buildWeeklyRevenueExpenseTrend()). Hand-
// rolled overlay bars, same dependency-free approach as Cash Flow's weekly
// trend chart (no chart library installed).
function RevenueExpenseChart({ points }: { points: WeeklyRevenueExpensePoint[] }) {
  const { t } = useTranslation();
  const { money: moneyFmt, date } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const max = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.expenses)));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 4 }}>
        {points.map((p) => (
          <View key={p.weekEnding} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ width: '100%', height: CHART_HEIGHT, justifyContent: 'flex-end' }}>
              <View
                style={{
                  width: '100%',
                  height: Math.max(2, (p.revenue / max) * CHART_HEIGHT),
                  backgroundColor: 'rgba(34,197,94,0.35)',
                  borderRadius: 2,
                  position: 'absolute',
                  bottom: 0,
                }}
              />
              <View
                style={{
                  width: '100%',
                  height: Math.max(2, (p.expenses / max) * CHART_HEIGHT),
                  backgroundColor: colors.red,
                  borderRadius: 2,
                }}
              />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <MutedText>{points[0] ? date(points[0].weekEnding) : ''}</MutedText>
        <MutedText>{points.length > 1 ? date(points[points.length - 1].weekEnding) : ''}</MutedText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'rgba(34,197,94,0.35)' }} />
          <MutedText>
            {t('dashboard.chartRevenueLegend', { amount: money(Math.max(...points.map((p) => p.revenue))) })}
          </MutedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.red }} />
          <MutedText>{t('dashboard.chartExpensesLegend')}</MutedText>
        </View>
      </View>
    </View>
  );
}

function buildPolylinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0 || width <= 0) return '';
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
}

// Revenue Trend line chart (Session 9d item 3) — "Apple Stocks style":
// plain green react-native-svg Polyline, no chart library, with 7D/30D/
// 90D/YTD range toggles (src/stats/trendRange.ts). Measures its own width
// via onLayout since it lives inside a full-width Card whose exact pixel
// width depends on the device.
function RevenueTrendChart({ weeklyRevenue }: { weeklyRevenue: WeeklyRevenueExpensePoint[] }) {
  const { t } = useTranslation();
  const { money: moneyFmt, date } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const [range, setRange] = useState<TrendRange>('30D');
  const [width, setWidth] = useState(0);
  const height = 90;

  const filtered = useMemo(() => filterTrendByRange(weeklyRevenue, range), [weeklyRevenue, range]);
  const values = filtered.map((p) => p.revenue);
  const polylinePoints = buildPolylinePoints(values, width, height);

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        {TREND_RANGES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            style={[styles.rangePill, range === r && styles.rangePillActive]}
          >
            <Text style={[styles.rangePillText, range === r && styles.rangePillTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {filtered.length < 2 ? (
          <MutedText>{t('dashboard.revenueTrendChart.notEnoughData')}</MutedText>
        ) : (
          <Svg width={width} height={height}>
            <Polyline points={polylinePoints} fill="none" stroke={colors.green} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      {filtered.length >= 2 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
          <MutedText>{date(filtered[0].weekEnding)}</MutedText>
          <MutedText>{money(Math.max(...values))} {t('dashboard.revenueTrendChart.maxSuffix')}</MutedText>
          <MutedText>{date(filtered[filtered.length - 1].weekEnding)}</MutedText>
        </View>
      )}
    </View>
  );
}

// Tiny hand-rolled sparkline (device feedback round 2: "where sensible add
// tiny sparklines to cards") — last bar full-opacity, older bars dimmed,
// bar color reflects sign (a net-loss week reads red even mid-sparkline).
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 20, gap: 2, marginTop: spacing.xs }}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(2, (Math.abs(v) / max) * 20),
            backgroundColor: v >= 0 ? colors.green : colors.red,
            borderRadius: 1,
            opacity: i === values.length - 1 ? 1 : 0.45,
          }}
        />
      ))}
    </View>
  );
}

// Zone 4's per-mile trend arrows (device feedback round 2) — purely
// reports current-vs-prior-4-week-average direction; "up" is colored
// green for revenue/profit-per-mile but red for cost-per-mile, which is
// why the caller passes goodDirection rather than this component guessing.
function TrendArrow({ trend, goodDirection }: { trend: MetricTrend; goodDirection: 'up' | 'down' }) {
  if (trend.direction === 'flat') return null;
  const isGood = trend.direction === goodDirection;
  return (
    <Text style={{ color: isGood ? colors.green : colors.red, fontSize: 11, fontWeight: '700', marginStart: 3 }}>
      {trend.direction === 'up' ? '▲' : '▼'}
    </Text>
  );
}

function StatValue({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View>
      <MutedText>{label}</MutedText>
      <Text style={{ color: valueColor ?? colors.text, fontSize: typography.size.xl, fontWeight: '700', marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

// Zone 4/5's compact trio tiles (device feedback round 2) — smaller and
// side-by-side, unlike the full-width TappableCard every other Dashboard
// stat uses; deliberately has no chevron (three of them in a row would be
// visually noisy) but is still tappable.
function CompactTile({
  label,
  value,
  valueColor,
  caption,
  captionColor,
  trend,
  goodDirection,
  onPress,
}: {
  label: string;
  value: string;
  valueColor?: string;
  caption?: string;
  captionColor?: string;
  trend?: MetricTrend;
  goodDirection?: 'up' | 'down';
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.compactTile, pressed && { opacity: 0.85 }]}>
      <Text style={{ color: colors.muted, fontSize: typography.size.xs }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: valueColor ?? colors.text, fontWeight: '700', fontSize: typography.size.md }} numberOfLines={1}>
          {value}
        </Text>
        {trend && goodDirection && <TrendArrow trend={trend} goodDirection={goodDirection} />}
      </View>
      {caption ? (
        <Text style={{ color: captionColor ?? colors.muted, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

function profitScoreColor(score: number): string {
  if (score >= 75) return colors.green;
  if (score >= 60) return colors.orange;
  return colors.red;
}

function greetingKey(hour: number): string {
  if (hour < 12) return 'dashboard.hero.greetingMorning';
  if (hour < 18) return 'dashboard.hero.greetingAfternoon';
  return 'dashboard.hero.greetingEvening';
}

// Hero Card's "vs last week" line (Session 9d item 1) — pct==null means
// there's no prior week yet (first-ever settlement), which reads as "New"
// rather than a misleading 0%/blank.
function HeroChange({ change, goodDirection }: { change: WeekOverWeekChange; goodDirection: 'up' | 'down' }) {
  const { t } = useTranslation();
  if (change.pct == null) {
    return <Text style={styles.heroChange}>{t('dashboard.hero.newThisWeek')}</Text>;
  }
  const isGood = change.direction === goodDirection;
  const color = change.direction === 'flat' ? 'rgba(232,234,246,0.65)' : isGood ? colors.green : colors.red;
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '—';
  return (
    <Text style={[styles.heroChange, { color }]}>
      {arrow} {Math.abs(change.pct).toFixed(1)}% {t('dashboard.hero.vsLastWeek')}
    </Text>
  );
}

// Dashboard 2.0 Hero Card (Session 9d item 1, owner + design-advisor
// vision — "from list to cockpit"): the one thing a user sees first,
// answering "how much did I make, am I on pace" in 5 seconds. Reuses
// calcScorecard() (src/stats/scorecard.ts, legacy rScore() port) for the
// Profit Score bar rather than inventing a second business-health
// formula — same all-time revenue/mile + fuel/mile + net/mile composite
// the Scorecard screen already shows, just presented as a bar here.
function HeroCard({
  name,
  weekRevenue,
  weekNetProfit,
  revenueChange,
  netProfitChange,
  profitScore,
  onPress,
}: {
  name: string;
  weekRevenue: number;
  weekNetProfit: number;
  revenueChange: WeekOverWeekChange;
  netProfitChange: WeekOverWeekChange;
  profitScore: number | null;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const animatedRevenue = useAnimatedNumber(weekRevenue);
  const animatedNetProfit = useAnimatedNumber(weekNetProfit);
  const hour = new Date().getHours();

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
      <LinearGradient colors={['#1b2650', '#0f1117']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
        <Text style={styles.heroGreeting}>{t(greetingKey(hour), { name })}</Text>
        <Text style={styles.heroSubtitle}>{t('dashboard.hero.thisWeek')}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
          <View>
            <Text style={styles.heroLabel}>{t('dashboard.hero.revenue')}</Text>
            <Text style={styles.heroValue}>{money(animatedRevenue)}</Text>
            <HeroChange change={revenueChange} goodDirection="up" />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.heroLabel}>{t('dashboard.hero.netProfit')}</Text>
            <Text style={[styles.heroValue, weekNetProfit < 0 && { color: colors.red }]}>{money(animatedNetProfit)}</Text>
            <HeroChange change={netProfitChange} goodDirection="up" />
          </View>
        </View>
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
      </LinearGradient>
    </Pressable>
  );
}

function chipColor(status: ChipStatus): string {
  if (status === 'green') return colors.green;
  if (status === 'amber') return colors.orange;
  return colors.red;
}

function StatusChip({ label, status }: { label: string; status: ChipStatus }) {
  return (
    <View style={styles.statusChip}>
      <View style={[styles.statusChipDot, { backgroundColor: chipColor(status) }]} />
      <Text style={styles.statusChipLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Fleet Health Score card (Session 9d item 2) — circular gauge (react-
// native-svg, no chart library) + 4 status chips explaining the score's
// composition, tap opens a methodology info sheet. Scoped to the active
// truck, same "n=1 is just the default presentation" convention every
// other truck-specific Dashboard stat already follows (CLAUDE.md
// invariant #7) — CEO Mode's maintenanceAlertCount uses the identical
// active-truck scoping for the same reason.
function FleetHealthCard({
  score,
  chips,
  onInfoPress,
}: {
  score: number;
  chips: { truck: ChipStatus; maintenance: ChipStatus; taxes: ChipStatus; cashFlow: ChipStatus };
  onInfoPress: () => void;
}) {
  const { t } = useTranslation();
  const gaugeColor = score >= 75 ? colors.green : score >= 60 ? colors.orange : colors.red;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }}>{t('dashboard.fleetHealth.title')}</Text>
        <Pressable onPress={onInfoPress} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: typography.size.md }}>ⓘ</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
          <CircularGauge score={score} color={gaugeColor} />
          <View style={{ position: 'absolute', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800' }}>{score}</Text>
            <MutedText>/100</MutedText>
          </View>
        </View>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <StatusChip label={t('dashboard.fleetHealth.chipTruck')} status={chips.truck} />
          <StatusChip label={t('dashboard.fleetHealth.chipMaintenance')} status={chips.maintenance} />
          <StatusChip label={t('dashboard.fleetHealth.chipTaxes')} status={chips.taxes} />
          <StatusChip label={t('dashboard.fleetHealth.chipCashFlow')} status={chips.cashFlow} />
        </View>
      </View>
    </Card>
  );
}

// Money Breakdown donut card (Session 9d item 4) — expense categories as
// % of revenue + a Profit slice, reusing buildProfitLoss()'s
// expensesByBucket (same Schedule C bucket rollup Operating P&L already
// shows) rather than a second category-grouping function. Capped at the
// top 3 buckets + an "Other" fold-in (dataviz anti-pattern: never a
// generated hue per category) — Profit only appears when netIncome > 0,
// since expenses + profit summing to exactly revenue is what makes "% of
// revenue" a meaningful donut in the first place. Tapping any slice/row
// goes to Deductions, same destination the existing Total Deductions
// card already uses.
function MoneyBreakdownCard({ slices, onPress }: { slices: DonutSlice[]; onPress: () => void }) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md, marginBottom: spacing.md }}>
        {t('dashboard.moneyBreakdown.title')}
      </Text>
      {total <= 0 ? (
        <MutedText>{t('dashboard.moneyBreakdown.empty')}</MutedText>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Pressable onPress={onPress}>
            <DonutChart slices={slices} />
          </Pressable>
          <View style={{ flex: 1, gap: spacing.xs }}>
            {slices.map((s) => (
              <Pressable key={s.label} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                <Text style={{ color: colors.text, fontSize: typography.size.xs, flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
                <Text style={{ color: colors.muted, fontSize: typography.size.xs }}>{Math.round((s.value / total) * 100)}%</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <MutedText style={{ marginTop: spacing.sm }}>{t('dashboard.moneyBreakdown.totalCaption', { amount: money(total) })}</MutedText>
    </Card>
  );
}

// Tax Progress bar (Session 9d item 5) — fill = reserved business_balance
// ÷ the full-year Federal+SE estimated tax; color reflects days until the
// next quarterly deadline (src/stats/taxProgress.ts), not the fill ratio
// itself — a fully-reserved user still sees the bar go red in the final
// week before a deadline, which is the point (a reminder to actually pay).
function TaxProgressCard({
  reserved,
  target,
  daysUntil,
  onPress,
}: {
  reserved: number;
  target: number;
  daysUntil: number | null;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const pct = calcTaxProgressPct(reserved, target);
  const barColor = chipColor(calcTaxProgressColor(daysUntil));

  return (
    <TappableCard onPress={onPress}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('dashboard.taxProgress.title')}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <MutedText>{t('dashboard.taxProgress.reservedOfTarget', { reserved: money(reserved), target: money(target) })}</MutedText>
        <Text style={{ color: barColor, fontWeight: '700' }}>{pct}%</Text>
      </View>
      <View style={styles.heroScoreTrack}>
        <View style={[styles.heroScoreFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
    </TappableCard>
  );
}

// AI Insights rotating card (Session 9d item 6) — one sentence, deterministic
// day-of-year rotation through whichever insights are actually applicable
// (src/stats/aiInsights.ts). Phrased via this app's own i18n strings rather
// than an ai-advisor round-trip on every dashboard load (that would add
// network latency/cost to a purely informational card render) — still
// locale-aware across all 7 supported languages, just via t() instead of
// a server call.
function AiInsightsCard({ insight, onViewDetails }: { insight: Insight; onViewDetails: (type: Insight['type']) => void }) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });

  let sentence: string;
  if (insight.type === 'fuelBenchmark') {
    sentence = t('dashboard.aiInsights.fuelBenchmark', {
      pct: insight.pctPointsAboveRange.toFixed(1),
      amount: money(insight.estMonthlyDelta),
    });
  } else if (insight.type === 'needsReview') {
    sentence = t('dashboard.aiInsights.needsReview', { count: insight.count, amount: money(insight.estValue) });
  } else if (insight.type === 'cpmTarget') {
    sentence = t('dashboard.aiInsights.cpmTarget', {
      rate: moneyFmt(insight.targetRate, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  } else {
    sentence = t('dashboard.aiInsights.paceProjection', { amount: money(insight.projectedNet) });
  }

  return (
    <TappableCard onPress={() => onViewDetails(insight.type)}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('dashboard.aiInsights.title')}</Text>
      <Text style={{ color: colors.text }}>{sentence}</Text>
      {insight.type === 'fuelBenchmark' && (
        <MutedText style={{ marginTop: spacing.xs }}>{t('dashboard.aiInsights.industryReferenceNote')}</MutedText>
      )}
    </TappableCard>
  );
}

// Collapsible titled section (Dashboard sections addition, owner
// decision 2026-07-13) — mirrors the sidebar/menu-sheet grouping
// language (OVERVIEW/MONEY/ON THE ROAD/TAXES). Renders nothing but the
// header when collapsed; children unmount entirely rather than just
// being hidden, so a collapsed section costs nothing to render.
function DashboardSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Pressable
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingVertical: spacing.xs,
        }}
      >
        <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: typography.size.md }}>{collapsed ? '▸' : '▾'}</Text>
      </Pressable>
      {!collapsed && <View>{children}</View>}
    </View>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { money: moneyFmt, number } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const { session, profile, signOut } = useAuth();
  const { trucks, activeTruck, loading: trucksLoading } = useActiveTruck();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reasonableSalaryInput, setReasonableSalaryInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // Local-first collapse toggling (Dashboard sections addition) — flips
  // instantly in the UI while the mutation persists in the background,
  // rather than waiting a round-trip for every tap to visually register.
  const [localSectionsCollapsed, setLocalSectionsCollapsed] = useState<SectionsCollapsed | null>(null);

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
  const taxQuery = useTaxEstimate();
  const loadsQuery = useLoads();
  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const layoutQuery = useDashboardLayout();
  const updateSectionsCollapsed = useUpdateSectionsCollapsed();
  const driversQuery = useDrivers({ active: true });
  const drivers = driversQuery.data ?? [];
  const fuelQuery = useFuelPurchases();
  const complianceQuery = useComplianceItems();
  const userCategoriesQuery = useUserCategories();
  const benchmarksQuery = useBenchmarks();
  const activeTruckId = activeTruck?.id ?? null;
  const trucksListQuery = useTrucksList();
  const maintRecordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const maintIntervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  const [healthInfoOpen, setHealthInfoOpen] = useState(false);

  const sectionsCollapsed = localSectionsCollapsed ?? layoutQuery.data?.sectionsCollapsed ?? {};
  function toggleSection(id: SectionId) {
    const next = { ...sectionsCollapsed, [id]: !sectionsCollapsed[id] };
    setLocalSectionsCollapsed(next);
    updateSectionsCollapsed.mutate(next);
  }

  // Fleet scalability (owner decision 2026-07-03): the per-truck ranking
  // below re-uses the SAME fetchFleetStats() function the single-truck
  // cards above call — parameterized by truck_id, no separate fleet code
  // path. Only fetched at all once there's a second truck to rank.
  const fleetQueries = useQueries({
    queries:
      trucks.length > 1
        ? trucks.map((truck) => ({
            queryKey: ['fleet-stats', userId, truck.id],
            queryFn: () => fetchFleetStats(userId as string, truck.id),
            enabled: !!userId,
          }))
        : [],
  });

  // Per-driver dashboard breakdown (PROMPTS.md Session 9a item 7): same
  // useQueries-per-entity pattern as Fleet Overview above, gated on 2+
  // active drivers (an account with 0-1 drivers never sees it — the same
  // n≤1 shortcut fleet-scalability uses everywhere else, CLAUDE.md
  // invariant #7).
  const driverQueries = useQueries({
    queries:
      drivers.length > 1
        ? drivers.map((driver) => ({
            queryKey: ['driver-stats', userId, driver.id],
            queryFn: () => fetchDriverStats(userId as string, driver.id),
            enabled: !!userId,
          }))
        : [],
  });

  const stats = statsQuery.data;
  const capital = capitalQuery.data;
  const tax = taxQuery.data;
  const deadline = tax ? nextQuarterlyDeadline(tax.taxYearData.quarterly_deadlines) : null;

  // Zone 1 hero chart — last 8 completed weeks (matching Scorecard/Cash
  // Flow's established "last 8 weeks" trend convention elsewhere in the
  // app) so the chart stays legible regardless of how much settlement
  // history exists.
  const fullWeeklyRevenueExpenseTrend = useMemo(
    () => buildWeeklyRevenueExpenseTrend(settlementsQuery.data ?? [], dedQuery.data ?? []),
    [settlementsQuery.data, dedQuery.data]
  );
  const revenueExpenseTrend = useMemo(() => fullWeeklyRevenueExpenseTrend.slice(-8), [fullWeeklyRevenueExpenseTrend]);

  // Zone 2's Net to Owner sparkline.
  const weeklyNetTrend = useMemo(() => buildWeeklyTrend(settlementsQuery.data ?? []), [settlementsQuery.data]);
  const netSparkValues = useMemo(() => weeklyNetTrend.slice(-8).map((p) => p.net), [weeklyNetTrend]);

  // Zone 4's per-mile trend arrows — current week vs. the prior 4-week
  // average (src/stats/cpmTrend.ts).
  const weeklyCpmTrend = useMemo(
    () => buildWeeklyCpmTrend(settlementsQuery.data ?? [], dedQuery.data ?? []),
    [settlementsQuery.data, dedQuery.data]
  );
  const cpmTrends = useMemo(() => calcCpmTrends(weeklyCpmTrend), [weeklyCpmTrend]);

  // Hero Card (Session 9d item 1) — this week vs. last week, both read
  // straight off revenueExpenseTrend's last two points rather than a
  // separate fetch. "Net Profit" here = revenue - ALL deductions for the
  // week, same definition the Overview chart right below it already uses.
  const heroFirstName =
    profile?.owner_name?.trim().split(/\s+/)[0] || session?.user?.email?.split('@')[0] || t('dashboard.hero.fallbackName');
  const thisWeekPoint = revenueExpenseTrend[revenueExpenseTrend.length - 1];
  const lastWeekPoint = revenueExpenseTrend[revenueExpenseTrend.length - 2];
  const heroWeekRevenue = thisWeekPoint?.revenue ?? 0;
  const heroWeekNetProfit = thisWeekPoint ? thisWeekPoint.revenue - thisWeekPoint.expenses : 0;
  const heroRevenueChange = calcWeekOverWeekChange(heroWeekRevenue, lastWeekPoint?.revenue);
  const heroNetProfitChange = calcWeekOverWeekChange(
    heroWeekNetProfit,
    lastWeekPoint ? lastWeekPoint.revenue - lastWeekPoint.expenses : null
  );
  const fuelCost = useMemo(
    () => (fuelQuery.data ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [fuelQuery.data]
  );
  const profitScore = useMemo(() => {
    if (!stats) return null;
    return calcScorecard(stats.grossRevenue, stats.totalDeductions, stats.totalMiles, fuelCost)?.score ?? null;
  }, [stats, fuelCost]);

  // Fleet Health Score (Session 9d item 2) — 4 inputs, each also a status
  // chip: Truck Health interval statuses (maintenance), compliance item
  // urgencies (truck/legal), business_balance vs. the upcoming quarterly
  // payment (taxes), and this-week-vs-last-week net profit direction
  // (cash flow — reuses heroNetProfitChange rather than a second trend
  // calculation).
  const activeTruckRow = useMemo(
    () => trucksListQuery.data?.find((tr) => tr.id === activeTruckId) ?? null,
    [trucksListQuery.data, activeTruckId]
  );
  const truckHealthStatuses = useMemo(() => {
    if (!activeTruckRow || !maintIntervalsQuery.data) return [];
    const intervals = maintIntervalsQuery.data.map((iv) => ({
      category: iv.category,
      trackingMode: iv.tracking_mode,
      intervalMiles: iv.interval_miles,
      intervalHours: iv.interval_hours,
      bundledWithCategory: iv.bundled_with_category,
      enabled: iv.enabled,
    }));
    const records = (maintRecordsQuery.data ?? []).map((r) => ({
      serviceType: r.service_type,
      odometer: r.odometer,
      engineHours: r.engine_hours,
      serviceDate: r.service_date,
    }));
    const overrides = (healthConfigQuery.data?.overrides ?? {}) as HealthOverrides;
    return calcTruckHealth(
      intervals,
      records,
      activeTruckRow.current_odometer ?? 0,
      activeTruckRow.apu_hours ?? 0,
      overrides
    ).map((r) => r.status);
  }, [activeTruckRow, maintIntervalsQuery.data, maintRecordsQuery.data, healthConfigQuery.data]);

  const complianceUrgencies = useMemo(
    () => (complianceQuery.data ?? []).map((item) => calcComplianceStatus(item.due_date).urgency),
    [complianceQuery.data]
  );

  const taxReserveRatio =
    tax && tax.estimate.quarterlyPayment > 0 ? (capital?.businessBalance ?? 0) / tax.estimate.quarterlyPayment : null;

  const fleetHealth = useMemo(
    () =>
      calcFleetHealthScore({
        truckHealthStatuses,
        complianceUrgencies,
        taxReserveRatio,
        cashFlowDirection: heroNetProfitChange.direction,
      }),
    [truckHealthStatuses, complianceUrgencies, taxReserveRatio, heroNetProfitChange.direction]
  );

  // Money Breakdown donut (Session 9d item 4).
  const profitLoss = useMemo(
    () => buildProfitLoss(settlementsQuery.data ?? [], dedQuery.data ?? [], userCategoriesQuery.data ?? []),
    [settlementsQuery.data, dedQuery.data, userCategoriesQuery.data]
  );
  const moneyBreakdownSlices = useMemo<DonutSlice[]>(() => {
    const palette = [colors.red, colors.orange, colors.purple];
    const top = profitLoss.expensesByBucket.slice(0, 3);
    const otherTotal = profitLoss.expensesByBucket.slice(3).reduce((sum, b) => sum + b.amount, 0);
    const slices: DonutSlice[] = top.map((b, i) => ({ label: b.category, value: b.amount, color: palette[i] }));
    if (otherTotal > 0) slices.push({ label: t('dashboard.moneyBreakdown.other'), value: otherTotal, color: colors.muted });
    if (profitLoss.netIncome > 0) slices.push({ label: t('dashboard.moneyBreakdown.profit'), value: profitLoss.netIncome, color: colors.green });
    return slices;
  }, [profitLoss, t]);

  // AI Insights (Session 9d item 6) — needsReviewCount/estValue mirrors
  // CEO Mode's own "NEEDS REVIEW:" prefix count (CLAUDE.md invariant #14).
  const needsReviewDeductions = useMemo(
    () => (dedQuery.data ?? []).filter((d) => (d.description ?? '').startsWith('NEEDS REVIEW:')),
    [dedQuery.data]
  );
  const profitAnalysisRollup = useMemo(
    () => buildProfitAnalysis(settlementsQuery.data ?? [], fuelQuery.data ?? [], [], 30),
    [settlementsQuery.data, fuelQuery.data]
  );
  const fuelBenchmark = useMemo(
    () => (benchmarksQuery.data ?? []).find((b) => b.metric === 'fuel_pct_of_revenue') ?? null,
    [benchmarksQuery.data]
  );
  const insightCandidates = useMemo(
    () =>
      buildInsightCandidates({
        fuelPctOfRevenue: profitAnalysisRollup.fuelPctOfRevenue,
        fuelBenchmarkHigh: fuelBenchmark?.high ?? null,
        monthlyRevenue: profitAnalysisRollup.revenue,
        needsReviewCount: needsReviewDeductions.length,
        needsReviewEstValue: needsReviewDeductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
        costPerMile: stats?.cpm.costPerMile ?? null,
        avgNetPerWeek: stats?.avgNetPerWeek ?? 0,
      }),
    [profitAnalysisRollup, fuelBenchmark, needsReviewDeductions, stats]
  );
  const dailyInsight = useMemo(() => selectDailyInsight(insightCandidates), [insightCandidates]);
  function handleInsightViewDetails(type: Insight['type']) {
    if (type === 'fuelBenchmark') router.push('/(tabs)/more/profit-analysis');
    else if (type === 'needsReview') router.push('/(tabs)/deductions');
    else router.push('/(tabs)/more/cash-flow');
  }

  const recentLoads = useMemo(() => {
    return [...(loadsQuery.data ?? [])]
      .sort((a, b) => new Date(b.load_date ?? 0).getTime() - new Date(a.load_date ?? 0).getTime())
      .slice(0, 4);
  }, [loadsQuery.data]);

  const isScorp = tax?.taxConfig.entity_type === 'scorp';
  const scorpPreview = useMemo(() => {
    if (!tax || isScorp) return null;
    const netProfit = tax.estimate.netProfit;
    const defaultSalary = Math.round((netProfit * 0.4) / 1000) * 1000;
    const salary = reasonableSalaryInput === '' ? defaultSalary : Number(reasonableSalaryInput) || 0;
    return { salary, defaultSalary, ...calcScorpSavingsPreview(netProfit, salary, tax.taxYearData.se_tax) };
  }, [tax, isScorp, reasonableSalaryInput]);

  const fleetRanking = useMemo(() => {
    if (trucks.length <= 1) return [];
    return trucks
      .map((truck, i) => {
        const data = fleetQueries[i]?.data;
        const ppm = data?.cpm.profitPerMile ?? null;
        return { truck, stats: data, ppm };
      })
      .filter((r) => r.stats)
      .sort((a, b) => (b.ppm ?? -Infinity) - (a.ppm ?? -Infinity));
  }, [trucks, fleetQueries]);

  const driverRanking = useMemo(() => {
    if (drivers.length <= 1) return [];
    return drivers
      .map((driver, i) => ({ driver, stats: driverQueries[i]?.data }))
      .filter((r) => r.stats);
  }, [drivers, driverQueries]);

  const drawsLabel = isScorp ? t('dashboard.distributions') : t('dashboard.draws');

  // Customizable dashboard (CLAUDE.md invariant #17, PROMPTS.md Session 9a
  // item 8): every reorderable/hideable/renamable card's JSX lives in this
  // renderer map, keyed by the stable id from src/stats/dashboardLayout.ts.
  // The DEFAULT (never-customized) render path below calls these in their
  // fixed, grouped, section-headered order — identical output to before
  // this feature existed, zero behavior change for the common case. The
  // CUSTOMIZED path (dashboard-customize.tsx has been used at least once)
  // renders the same functions as one flat list in the user's chosen
  // order/visibility/labels — deliberately without the section headers,
  // since headers stop making sense once cards can move freely between
  // what used to be separate groups.
  const cardRenderers: Partial<Record<DashboardCardId, (label: string) => React.ReactNode>> = {
    totalRevenue: (label) => (
      <TappableCard key="totalRevenue" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? money(stats.grossRevenue) : '—'} valueColor={colors.green} />
        <MutedText>{t('dashboard.importToStart')}</MutedText>
      </TappableCard>
    ),
    totalDeductions: (label) => (
      <TappableCard key="totalDeductions" onPress={() => router.push('/(tabs)/deductions')}>
        <StatValue label={label} value={stats ? money(stats.totalDeductions) : '—'} valueColor={colors.red} />
      </TappableCard>
    ),
    netToOwner: (label) => (
      <TappableCard key="netToOwner" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats ? money(stats.netRevenue) : '—'}
          valueColor={stats && stats.netRevenue < 0 ? colors.red : colors.green}
        />
        <Sparkline values={netSparkValues} />
      </TappableCard>
    ),
    milesDriven: (label) => (
      <TappableCard key="milesDriven" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? number(stats.totalMiles) : '—'} />
      </TappableCard>
    ),
    ytdPerDiemDays: (label) => (
      <TappableCard key="ytdPerDiemDays" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={stats ? `${stats.perDiemDays}` : '—'} valueColor={colors.accent} />
        <MutedText>{t('dashboard.daysOnRoad')}</MutedText>
      </TappableCard>
    ),
    perDiemDeduction: (label) => (
      <TappableCard key="perDiemDeduction" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.perDiemDeduction) : '—'} valueColor={colors.green} />
        {perDiemCaption(tax?.taxYearData.per_diem, t) && <MutedText>{perDiemCaption(tax?.taxYearData.per_diem, t)}</MutedText>}
      </TappableCard>
    ),
    // Zone 3 (device feedback round 2) — days-on-road count + deduction $
    // merged into one compact card, same "several stats, one card" pattern
    // capitalAccountStrip already uses. ytdPerDiemDays/perDiemDeduction
    // stay registered above too (hidden by default, still individually
    // toggleable via Customize) rather than being removed.
    perDiemSummary: (label) => (
      <TappableCard key="perDiemSummary" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <MutedText>{t('dashboard.daysOnRoad')}</MutedText>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: typography.size.lg }}>
              {stats ? `${stats.perDiemDays}` : '—'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <MutedText>{t('dashboard.perDiemDeduction')}</MutedText>
            <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.lg }}>
              {tax ? money(tax.perDiemDeduction) : '—'}
            </Text>
          </View>
        </View>
        {perDiemCaption(tax?.taxYearData.per_diem, t) && <MutedText>{perDiemCaption(tax?.taxYearData.per_diem, t)}</MutedText>}
        {label !== t('dashboard.perDiemSummaryTitle') && <MutedText>{label}</MutedText>}
      </TappableCard>
    ),
    weeksInService: (label) => (
      <TappableCard key="weeksInService" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? `${stats.settlementCount}` : '—'} />
        <MutedText>{t('dashboard.settlementsImported')}</MutedText>
      </TappableCard>
    ),
    avgNetPerWeek: (label) => (
      <TappableCard key="avgNetPerWeek" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue label={label} value={stats ? money(stats.avgNetPerWeek) : '—'} />
        <MutedText>{t('dashboard.directDepositAvg')}</MutedText>
      </TappableCard>
    ),
    businessBalance: (label) => (
      <TappableCard key="businessBalance" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={money(capital?.businessBalance ?? 0)}
          valueColor={
            (capital?.businessBalance ?? 0) > 10000 ? colors.green : (capital?.businessBalance ?? 0) > 3000 ? colors.orange : colors.red
          }
        />
        <MutedText>{t('dashboard.checkingAccount')}</MutedText>
      </TappableCard>
    ),
    revenuePerMile: (label) => (
      <TappableCard key="revenuePerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.revenuePerMile != null ? moneyFmt(stats.cpm.revenuePerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={colors.green}
        />
        <MutedText>{t('dashboard.grossDividedByMiles')}</MutedText>
      </TappableCard>
    ),
    costPerMile: (label) => (
      <TappableCard key="costPerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.costPerMile != null ? moneyFmt(stats.cpm.costPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={colors.red}
        />
        <MutedText>{t('dashboard.allCostsDividedByMiles')}</MutedText>
      </TappableCard>
    ),
    profitPerMile: (label) => (
      <TappableCard key="profitPerMile" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        <StatValue
          label={label}
          value={stats?.cpm.profitPerMile != null ? moneyFmt(stats.cpm.profitPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueColor={stats?.cpm.profitPerMile != null ? colors[ppmColor(stats.cpm.profitPerMile)] : undefined}
        />
        <MutedText>{t('dashboard.acceptLoadsAboveCpm')}</MutedText>
      </TappableCard>
    ),
    revenueExpenseTrend: (label) =>
      revenueExpenseTrend.length === 0 ? null : (
        <TappableCard key="revenueExpenseTrend" onPress={() => router.push('/(tabs)/more/cash-flow')}>
          {label !== t('dashboard.revenueExpenseTrendTitle') && <MutedText style={{ marginBottom: spacing.xs }}>{label}</MutedText>}
          <RevenueExpenseChart points={revenueExpenseTrend} />
        </TappableCard>
      ),
    estTotalTax: (label) => (
      <TappableCard key="estTotalTax" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.totalTax) : '—'} valueColor={colors.red} />
        {tax && (
          <MutedText>
            {t('dashboard.filingStatusCaption', {
              filingStatus: FILING_STATUS_LABEL[tax.taxConfig.filing_status] ?? tax.taxConfig.filing_status,
            })}
          </MutedText>
        )}
      </TappableCard>
    ),
    quarterlyPayment: (label) => (
      <TappableCard key="quarterlyPayment" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.quarterlyPayment) : '—'} valueColor={colors.red} />
        {deadline ? (
          <Text style={{ color: urgencyColor(deadline.urgency), fontSize: typography.size.sm, marginTop: 2 }}>
            {t('dashboard.deadlineDueWithDate', {
              deadline: t('dashboard.deadlineDue', { label: deadline.label, count: deadline.daysUntil }),
              date: deadline.date,
            })}
          </Text>
        ) : (
          <MutedText>{t('dashboard.nextDueDate')}</MutedText>
        )}
      </TappableCard>
    ),
    weeklyTaxReserve: (label) => (
      <TappableCard key="weeklyTaxReserve" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax ? money(tax.estimate.weeklyTaxReserve) : '—'} />
        <Text style={{ color: colors.orange, fontSize: typography.size.sm, marginTop: 2 }}>{t('dashboard.setAsideWeekly')}</Text>
      </TappableCard>
    ),
    effectiveRate: (label) => (
      <TappableCard key="effectiveRate" onPress={() => router.push('/(tabs)/more/tax-estimator')}>
        <StatValue label={label} value={tax?.estimate.effectiveRate != null ? `${tax.estimate.effectiveRate.toFixed(1)}%` : '—'} />
        <MutedText>{t('dashboard.ofNetProfit')}</MutedText>
        {tax?.estimate.stateTax.label === 'estimate' && (
          <MutedText>{t('dashboard.stateTaxEstimateNote', { state: tax.taxConfig.state })}</MutedText>
        )}
      </TappableCard>
    ),
    // Registered as a real card (device feedback round 2) so it's still
    // reachable via Customize despite being hidden from the fresh default
    // layout — was previously an unconditional inline block, never
    // customizable at all. Gating (!isScorp && scorpPreview) is unchanged.
    scorpPreview: (label) =>
      !isScorp && scorpPreview ? (
        <Card key="scorpPreview">
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{label}</Text>
          <MutedText>{t('dashboard.scorpPreviewNote')}</MutedText>
          <Field
            keyboardType="numeric"
            placeholder={String(scorpPreview.defaultSalary)}
            value={reasonableSalaryInput}
            onChangeText={setReasonableSalaryInput}
            style={{ marginTop: spacing.xs, marginBottom: spacing.sm }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <MutedText>{t('dashboard.currentSeTax')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.currentSeTax)}</Text>
            </View>
            <View>
              <MutedText>{t('dashboard.seTaxAtSalary')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{money(scorpPreview.scorpSeTax)}</Text>
            </View>
            <View>
              <MutedText>{t('dashboard.potentialSavings')}</MutedText>
              <Text style={{ color: colors.green, fontWeight: '700' }}>{money(scorpPreview.savings)}</Text>
            </View>
          </View>
          <LegalFootnote />
        </Card>
      ) : null,
    capitalAccountStrip: (label) => (
      <TappableCard key="capitalAccountStrip" onPress={() => router.push('/(tabs)/more/capital-account')}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <MutedText>{t('dashboard.contributed')}</MutedText>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{capital ? money(capital.effectiveContribution) : '—'}</Text>
          </View>
          <View>
            <MutedText>{drawsLabel}</MutedText>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{capital ? money(capital.totalDraws) : '—'}</Text>
          </View>
          <View>
            <MutedText>{t('dashboard.taxFreeLeft')}</MutedText>
            <Text
              style={{
                fontWeight: '700',
                color: capital && capital.effectiveContribution - capital.totalDraws > 0 ? colors.green : colors.red,
              }}
            >
              {capital ? money(capital.taxFreeRemaining) : '—'}
            </Text>
          </View>
        </View>
        {capital && capital.contributionCount > 0 && (
          <MutedText>
            {t('dashboard.extraContribution', {
              count: capital.contributionCount,
              note: (capital.latestContributionNote ?? '').split(' — ')[0].slice(0, 45),
              date: capital.latestContributionDate,
            })}
          </MutedText>
        )}
        {label !== t('dashboard.capitalAccountTitle') && <MutedText>{label}</MutedText>}
      </TappableCard>
    ),
    recentLoads: (label) => (
      <TappableCard key="recentLoads" onPress={() => router.push('/(tabs)/more/cash-flow')}>
        {recentLoads.length === 0 ? (
          <MutedText>{t('dashboard.noLoadsYet')}</MutedText>
        ) : (
          <View>
            {label !== t('dashboard.recentLoadsTitle') && <MutedText style={{ marginBottom: spacing.xs }}>{label}</MutedText>}
            {recentLoads.map((l) => (
              <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                <MutedText>
                  {l.order_number ?? '—'} · {l.origin ?? '—'} → {l.destination ?? '—'}
                </MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(l.revenue)}</Text>
              </View>
            ))}
          </View>
        )}
      </TappableCard>
    ),
    truckCard: (label) =>
      activeTruck ? (
        <TappableCard key="truckCard" onPress={() => router.push('/(tabs)/truck-health')}>
          {label !== t('dashboard.truckCardLabel') && <MutedText>{label}</MutedText>}
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {activeTruck.year ?? ''} {activeTruck.make ?? ''} {activeTruck.model ?? ''}
          </Text>
          <MutedText>{t('dashboard.truckUnit', { unit: activeTruck.unit_number ?? '—' })}</MutedText>
        </TappableCard>
      ) : null,
    fleetOverview: (label) =>
      trucks.length > 1 ? (
        <Card key="fleetOverview">
          {label !== t('dashboard.fleetOverviewTitle') && (
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{label}</Text>
          )}
          {fleetRanking.map((r, i) => (
            <View key={r.truck.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <MutedText>
                {i === fleetRanking.length - 1 ? '⚠ ' : ''}
                {t('common.unit', { unit: r.truck.unit_number ?? r.truck.id })}
              </MutedText>
              <Text style={{ color: r.ppm != null ? colors[ppmColor(r.ppm)] : colors.text, fontWeight: '700' }}>
                {r.ppm != null ? `${moneyFmt(r.ppm, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mi` : '—'}
              </Text>
            </View>
          ))}
        </Card>
      ) : null,
    driverOverview: (label) =>
      drivers.length > 1 ? (
        <Card key="driverOverview">
          {label !== t('dashboard.driverOverviewTitle') && (
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{label}</Text>
          )}
          {driverRanking.map((r) => (
            <View key={r.driver.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
              <MutedText>{r.driver.name}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{r.stats ? money(r.stats.netRevenue) : '—'}</Text>
            </View>
          ))}
        </Card>
      ) : null,
  };

  function renderCard(id: DashboardCardId, overrideLabel: string | null) {
    const defaultLabel = t(CARD_LABEL_KEYS[id] ?? id);
    return cardRenderers[id]?.(overrideLabel || defaultLabel) ?? null;
  }

  const isCustomized = layoutQuery.data?.isCustomized ?? false;

  // Customized-path grouping (Dashboard sections addition): the flat,
  // user-ordered list gets split into the 4 collapsible sections (in
  // SECTION_IDS order) plus a trailing unsectioned group — preserving
  // each card's relative order within its own group, same as before.
  const groupedCustomized = useMemo(() => {
    if (!layoutQuery.data) return null;
    const visible = layoutQuery.data.layout.filter((row) => row.visible);
    const bySection = new Map<SectionId, DashboardCardConfig[]>();
    const unsectioned: DashboardCardConfig[] = [];
    for (const row of visible) {
      const section = row.section;
      if (section && (SECTION_IDS as readonly string[]).includes(section)) {
        if (!bySection.has(section)) bySection.set(section, []);
        bySection.get(section)!.push(row);
      } else {
        unsectioned.push(row);
      }
    }
    return { bySection, unsectioned };
  }, [layoutQuery.data]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('dashboard.title')}</ScreenTitle>
          <Pressable onPress={() => router.push('/(tabs)/more/dashboard-customize')} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
              {t('dashboard.customize')}
            </Text>
          </Pressable>
        </View>

        <HeroCard
          name={heroFirstName}
          weekRevenue={heroWeekRevenue}
          weekNetProfit={heroWeekNetProfit}
          revenueChange={heroRevenueChange}
          netProfitChange={heroNetProfitChange}
          profitScore={profitScore}
          onPress={() => router.push('/(tabs)/more/cash-flow')}
        />

        <FleetHealthCard score={fleetHealth.score} chips={fleetHealth.chips} onInfoPress={() => setHealthInfoOpen(true)} />

        {dailyInsight && <AiInsightsCard insight={dailyInsight} onViewDetails={handleInsightViewDetails} />}

        <ModalSheet visible={healthInfoOpen} onClose={() => setHealthInfoOpen(false)}>
          <SheetTitle>{t('dashboard.fleetHealth.infoTitle')}</SheetTitle>
          <MutedText style={{ marginBottom: spacing.sm }}>{t('dashboard.fleetHealth.infoBody')}</MutedText>
          <MutedText style={{ marginBottom: spacing.xs }}>• {t('dashboard.fleetHealth.infoTruck')}</MutedText>
          <MutedText style={{ marginBottom: spacing.xs }}>• {t('dashboard.fleetHealth.infoMaintenance')}</MutedText>
          <MutedText style={{ marginBottom: spacing.xs }}>• {t('dashboard.fleetHealth.infoTaxes')}</MutedText>
          <MutedText style={{ marginBottom: spacing.sm }}>• {t('dashboard.fleetHealth.infoCashFlow')}</MutedText>
          <LegalFootnote />
        </ModalSheet>

        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
          {profile?.company_name ? <MutedText>{profile.company_name}</MutedText> : null}
        </Card>

        {tax?.isFallback && !bannerDismissed && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <MutedText>
                {t('dashboard.yearFallbackBanner', { requestedYear: tax.requestedYear, resolvedYear: tax.resolvedYear })}
              </MutedText>
              <Pressable onPress={() => setBannerDismissed(true)} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: typography.size.md, marginStart: spacing.sm }}>✕</Text>
              </Pressable>
            </View>
          </Card>
        )}

        {trucksLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : trucks.length === 0 ? (
          <Card>
            <MutedText>{t('dashboard.noTrucks')}</MutedText>
          </Card>
        ) : isCustomized && layoutQuery.data && groupedCustomized ? (
          // Customized layout, grouped into the same 4 collapsible
          // sections by each card's own `section` (settable via
          // Customize), plus a trailing flat list of unsectioned cards —
          // individual full-width cards throughout (the compact trio/pair
          // treatment below is a DEFAULT-layout-only visual, same as
          // before Dashboard sections existed).
          <>
            {SECTION_IDS.map((sectionId) => {
              const rows = groupedCustomized.bySection.get(sectionId);
              if (!rows || rows.length === 0) return null;
              return (
                <DashboardSection
                  key={sectionId}
                  title={t(SECTION_LABEL_KEYS[sectionId])}
                  collapsed={!!sectionsCollapsed[sectionId]}
                  onToggle={() => toggleSection(sectionId)}
                >
                  {rows.map((row) => (
                    <View key={row.id}>{renderCard(row.id as DashboardCardId, row.label)}</View>
                  ))}
                </DashboardSection>
              );
            })}
            {groupedCustomized.unsectioned.map((row) => (
              <View key={row.id}>{renderCard(row.id as DashboardCardId, row.label)}</View>
            ))}
          </>
        ) : (
          // New zoned default layout (device feedback round 2, owner
          // decision 2026-07-13), organized into 4 collapsible titled
          // sections (Dashboard sections addition) mirroring the sidebar/
          // menu-sheet grouping language. Business Balance/Miles/Weeks in
          // Service/Avg Net-Week/Total Revenue/effectiveRate/S-Corp
          // preview are hidden from this default (DEFAULT_HIDDEN_CARD_IDS,
          // src/stats/dashboardLayout.ts) but remain fully available via
          // Customize.
          <>
            <DashboardSection
              title={t(SECTION_LABEL_KEYS.overview)}
              collapsed={!!sectionsCollapsed.overview}
              onToggle={() => toggleSection('overview')}
            >
              {renderCard('revenueExpenseTrend', null)}
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
                  {t('dashboard.revenueTrendChart.title')}
                </Text>
                <RevenueTrendChart weeklyRevenue={fullWeeklyRevenueExpenseTrend} />
              </Card>
            </DashboardSection>

            <DashboardSection
              title={t(SECTION_LABEL_KEYS.money)}
              collapsed={!!sectionsCollapsed.money}
              onToggle={() => toggleSection('money')}
            >
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>{renderCard('netToOwner', null)}</View>
                <View style={{ flex: 1 }}>{renderCard('totalDeductions', null)}</View>
              </View>
              <MoneyBreakdownCard slices={moneyBreakdownSlices} onPress={() => router.push('/(tabs)/deductions')} />
            </DashboardSection>

            <DashboardSection
              title={t(SECTION_LABEL_KEYS.onTheRoad)}
              collapsed={!!sectionsCollapsed.onTheRoad}
              onToggle={() => toggleSection('onTheRoad')}
            >
              {renderCard('perDiemSummary', null)}
              <View style={styles.compactRow}>
                <CompactTile
                  label={t('dashboard.revenuePerMile')}
                  value={stats?.cpm.revenuePerMile != null ? moneyFmt(stats.cpm.revenuePerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  valueColor={colors.green}
                  trend={cpmTrends.revenuePerMile}
                  goodDirection="up"
                  onPress={() => router.push('/(tabs)/more/cash-flow')}
                />
                <CompactTile
                  label={t('dashboard.costPerMile')}
                  value={stats?.cpm.costPerMile != null ? moneyFmt(stats.cpm.costPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  valueColor={colors.red}
                  trend={cpmTrends.costPerMile}
                  goodDirection="down"
                  onPress={() => router.push('/(tabs)/more/cash-flow')}
                />
                <CompactTile
                  label={t('dashboard.profitPerMile')}
                  value={stats?.cpm.profitPerMile != null ? moneyFmt(stats.cpm.profitPerMile, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  valueColor={stats?.cpm.profitPerMile != null ? colors[ppmColor(stats.cpm.profitPerMile)] : undefined}
                  trend={cpmTrends.profitPerMile}
                  goodDirection="up"
                  onPress={() => router.push('/(tabs)/more/cash-flow')}
                />
              </View>
            </DashboardSection>

            <DashboardSection
              title={t(SECTION_LABEL_KEYS.taxes)}
              collapsed={!!sectionsCollapsed.taxes}
              onToggle={() => toggleSection('taxes')}
            >
              <TaxProgressCard
                reserved={capital?.businessBalance ?? 0}
                target={tax?.estimate.totalTax ?? 0}
                daysUntil={deadline?.daysUntil ?? null}
                onPress={() => router.push('/(tabs)/more/tax-estimator')}
              />
              <View style={styles.compactRow}>
                <CompactTile
                  label={t('dashboard.estTotalTax')}
                  value={tax ? money(tax.estimate.totalTax) : '—'}
                  valueColor={colors.red}
                  onPress={() => router.push('/(tabs)/more/tax-estimator')}
                />
                <CompactTile
                  label={t('dashboard.quarterlyPayment')}
                  value={tax ? money(tax.estimate.quarterlyPayment) : '—'}
                  valueColor={colors.red}
                  caption={deadline ? t('dashboard.deadlineDue', { label: deadline.label, count: deadline.daysUntil }) : undefined}
                  captionColor={deadline ? urgencyColor(deadline.urgency) : undefined}
                  onPress={() => router.push('/(tabs)/more/tax-estimator')}
                />
                <CompactTile
                  label={t('dashboard.weeklyTaxReserve')}
                  value={tax ? money(tax.estimate.weeklyTaxReserve) : '—'}
                  valueColor={colors.orange}
                  onPress={() => router.push('/(tabs)/more/tax-estimator')}
                />
              </View>
            </DashboardSection>
          </>
        )}

        {/* CLAUDE.md invariant #8: every screen showing tax figures needs
            this disclaimer — rendered unconditionally here (not only inside
            the default-layout tax section above) so a customized layout
            that still shows tax cards never loses it. */}
        <LegalFootnote />

        {/* Driver compensation types (owner decision 2026-07-10): 1099
            contractors crossing the NEC filing threshold YTD. Informational
            banners, not part of the customizable card set. */}
        {tax && tax.contractLaborYtd.some((c) => c.needsNecReminder) && (
          <Card>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              {t('dashboard.necReminderTitle')}
            </Text>
            {tax.contractLaborYtd
              .filter((c) => c.needsNecReminder)
              .map((c) => (
                <MutedText key={c.driverId}>
                  {t('dashboard.necReminderBody', {
                    name: c.driverName,
                    amount: money(c.ytdTotal),
                    deadline: tax.taxYearData.nec_1099?.filing_deadline ?? t('common.dash'),
                  })}
                </MutedText>
              ))}
          </Card>
        )}

        {isScorp && (
          <Card>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              {t('dashboard.scorpPayrollTitle')}
            </Text>
            <MutedText>{t('dashboard.scorpPayrollNote')}</MutedText>
            <Text style={{ color: colors.text, marginTop: spacing.sm }}>
              {tax?.taxConfig.scorp_payroll_tax_handled ? '☑' : '☐'} {t('dashboard.payrollHandledByProvider')}
            </Text>
          </Card>
        )}

        {/* S-Corp preview (device feedback round 2): hidden from the fresh
            default layout (DEFAULT_HIDDEN_CARD_IDS, src/stats/
            dashboardLayout.ts) — the customized flat-list loop above
            already renders it if a user explicitly re-enabled it via
            Customize, so there is nothing to render here for the default
            (non-customized) path. */}

        {(!isCustomized || !layoutQuery.data) && (
          <>
            {/* Capital Account strip */}
            <ScreenTitle>{t('dashboard.capitalAccountTitle')}</ScreenTitle>
            {renderCard('capitalAccountStrip', null)}

            {/* Recent loads */}
            <ScreenTitle>{t('dashboard.recentLoadsTitle')}</ScreenTitle>
            {renderCard('recentLoads', null)}

            {/* Truck card */}
            {renderCard('truckCard', null)}

            {/* Fleet Overview — only renders with 2+ trucks (owner decision
                2026-07-03: 1→100 trucks, no separate code path). */}
            {trucks.length > 1 && (
              <>
                <ScreenTitle>{t('dashboard.fleetOverviewTitle')}</ScreenTitle>
                {renderCard('fleetOverview', null)}
              </>
            )}

            {drivers.length > 1 && (
              <>
                <ScreenTitle>{t('dashboard.driverOverviewTitle')}</ScreenTitle>
                {renderCard('driverOverview', null)}
              </>
            )}
          </>
        )}

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
  heroGreeting: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
  },
  heroSubtitle: {
    color: 'rgba(232,234,246,0.65)',
    fontSize: typography.size.sm,
    marginTop: 2,
  },
  heroLabel: {
    color: 'rgba(232,234,246,0.65)',
    fontSize: typography.size.xs,
  },
  heroValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800' as const,
    marginTop: 2,
  },
  heroChange: {
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    marginTop: spacing.xs,
  },
  heroScoreLabel: {
    color: 'rgba(232,234,246,0.65)',
    fontSize: typography.size.xs,
    fontWeight: '600' as const,
  },
  heroScoreTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(232,234,246,0.12)',
    overflow: 'hidden' as const,
  },
  heroScoreFill: {
    height: 8,
    borderRadius: 4,
  },
  statusChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
  },
  statusChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusChipLabel: {
    color: colors.text,
    fontSize: typography.size.sm,
    flexShrink: 1,
  },
  rangePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rangePillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rangePillText: {
    color: colors.muted,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
  },
  rangePillTextActive: {
    color: colors.text,
  },
};
