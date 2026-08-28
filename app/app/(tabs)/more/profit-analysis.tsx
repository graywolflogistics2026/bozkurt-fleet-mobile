import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useDeductions } from '@/src/data/deductions';
import { useBenchmarks } from '@/src/data/benchmarks';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildProfitAnalysis, compareToBenchmark, type RangeStatus } from '@/src/stats/profitAnalysis';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { PERIOD_OPTIONS, periodStartIso, type PeriodOption } from '@/src/stats/periodFilter';
import { useSessionState } from '@/src/lib/useSessionState';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, PrimaryButton } from '@/src/components/ui';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { colors, radii, spacing, typography } from '@/src/theme';
import i18n from '@/src/i18n';

function statusColor(status: RangeStatus) {
  if (status === 'above_range') return colors.red;
  if (status === 'below_range') return colors.green;
  return colors.text;
}

// Same local Pill pattern this app already repeats per-screen (Deductions,
// Settlements, Cash Flow, ...) rather than one heavy shared component.
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

// A plain-English (never localized — same convention every other
// data-filled AI prompt in this app already follows, CLAUDE.md invariant
// #16: the PROMPT stays English content, only the model's OWN reply is
// instructed to use the user's locale) description of the selected
// period, for the "Ask AI" prompt text only.
function periodPromptPhrase(period: PeriodOption): string {
  if (period === 'thisMonth') return 'this month';
  if (period === '3M') return 'the trailing 90 days';
  if (period === 'ytd') return 'year to date';
  return 'all time';
}

export default function ProfitAnalysis() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const settlementsQuery = useSettlements();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const dedQuery = useDeductions();
  const benchmarksQuery = useBenchmarks();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const loading = settlementsQuery.isLoading || fuelQuery.isLoading || maintenanceQuery.isLoading || dedQuery.isLoading;

  // "GHOST VALUE" pass (owner decision 2026-08-28) — this used to be a
  // hardcoded rolling-30-day window (buildProfitAnalysis(..., 30, ...)),
  // which is what produced a net-income figure that silently disagreed
  // with the Deductions screen's own default "All Time" total — not a
  // bug in either number, just an invisible scope mismatch. Now the SAME
  // period selector (This Month/3M/YTD/All) Deductions/Settlements
  // already use, defaulting to 'all' so the two screens agree by
  // default without the user having to know to change anything.
  const [period, setPeriod] = useSessionState<PeriodOption>('profitAnalysis-period', 'all');
  const periodSuffix = period === 'ytd' ? ` ${new Date().getFullYear()}` : period === 'all' ? ` ${t('deductions.allTimeSuffix')}` : '';

  const rollup = useMemo(
    () =>
      buildProfitAnalysis(
        settlementsQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        dedQuery.data ?? [],
        periodStartIso(period),
        new Date(),
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, fuelQuery.data, maintenanceQuery.data, dedQuery.data, tollsQuery.data, period]
  );

  // TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): this used to be
  // buildWeeklyTrend()'s bare settlement `.net` — now the same canonical
  // src/stats/trueProfit.ts figure Home/Scorecard/CEO Mode/Share Weekly
  // Profit all use.
  const weeklyTrend = useMemo(
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
  const recentWeeks = weeklyTrend.slice(-8);

  // benchmarks table may not exist yet (docs/PENDING_SQL.md §25 not run) —
  // useBenchmarks() then resolves to an error, treated the same as "no
  // benchmark data" rather than a scary error banner.
  const benchmarks = benchmarksQuery.isError ? [] : (benchmarksQuery.data ?? []);
  const fuelBenchmark = benchmarks.find((b) => b.metric === 'fuel_pct_of_revenue') ?? null;
  const maintenanceBenchmark = benchmarks.find((b) => b.metric === 'maintenance_cost_per_mile') ?? null;
  const fuelStatus = compareToBenchmark(rollup.fuelPctOfRevenue, fuelBenchmark);
  const maintenanceStatus = compareToBenchmark(rollup.maintenanceCostPerMile, maintenanceBenchmark);

  async function handleAskAi() {
    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);
    try {
      const prompt =
        `Here is my operating snapshot for ${periodPromptPhrase(period)}: revenue ${money(rollup.revenue)}, ` +
        `fuel expense ${money(rollup.fuelExpense)} (${rollup.fuelPctOfRevenue != null ? (rollup.fuelPctOfRevenue * 100).toFixed(1) + '%' : 'n/a'} of revenue), ` +
        `maintenance expense ${money(rollup.maintenanceExpense)} (${rollup.maintenanceCostPerMile != null ? money(rollup.maintenanceCostPerMile, { maximumFractionDigits: 3 }) + '/mi' : 'n/a'}), ` +
        `net income ${money(rollup.netIncome)} over ${number(rollup.totalMiles)} miles.` +
        (fuelBenchmark ? ` Industry reference range for fuel is ${(fuelBenchmark.low * 100).toFixed(0)}-${(fuelBenchmark.high * 100).toFixed(0)}% of revenue.` : '') +
        (maintenanceBenchmark ? ` Industry reference range for maintenance is $${maintenanceBenchmark.low}-$${maintenanceBenchmark.high}/mile.` : '') +
        ' Give me 2-3 specific, actionable observations about my cost structure.';
      const result = await callAiAdvisor([{ role: 'user', content: prompt }], i18n.language);
      if (result.error) {
        setAiError(result.error.message || t('profitAnalysis.aiFailed'));
      } else {
        setAiAnswer(result.data ?? null);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t('profitAnalysis.aiFailed'));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('profitAnalysis.title')}</ScreenTitle>
        <FleetScopeLabel variant="fleetOnly" />

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('profitAnalysis.summaryTitle')}</Text>
            <Card>
              <View style={styles.statRow}>
                <View style={styles.statCell}>
                  <MutedText>{`${t('profitAnalysis.revenue')}${periodSuffix}`}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{money(rollup.revenue)}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{`${t('profitAnalysis.netIncome')}${periodSuffix}`}</MutedText>
                  <Text style={[styles.statValue, { color: rollup.netIncome >= 0 ? colors.green : colors.red }]}>
                    {money(rollup.netIncome)}
                  </Text>
                </View>
              </View>
            </Card>

            {/* PERIOD SELECTOR (owner decision, "ghost value" pass) — the
                SAME This Month/3M/YTD/All pills Deductions/Settlements
                already use, defaulting to 'all' so this screen's Revenue/
                Net Income agree with Deductions' own "All Time" default
                without the user having to change anything. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
              {PERIOD_OPTIONS.map((p) => (
                <Pill key={p} label={t(`deductions.period.${p}`)} selected={period === p} onPress={() => setPeriod(p)} />
              ))}
            </View>

            {/* RECONCILIATION BREAKDOWN (owner decision, device report:
                "Total Expenses should relate to Total Deductions plus/
                minus whatever other canonical inputs apply") — makes the
                arithmetic behind Net Income visible instead of implicit,
                for whichever period is currently selected. */}
            <Text style={styles.sectionTitle}>{t('profitAnalysis.expensesBreakdownTitle')}</Text>
            <Card>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('profitAnalysis.deductionsGrossLabel')}</Text>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(rollup.deductionsGrossTotal)}</Text>
              </View>
              {rollup.deductionsExcludedTotal > 0 && (
                <MutedText style={{ marginBottom: spacing.xs }}>
                  {t('profitAnalysis.deductionsExcludedNote', { amount: money(rollup.deductionsExcludedTotal) })}
                </MutedText>
              )}
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>{t('profitAnalysis.fuelLine')}</Text>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(rollup.canonicalFuelExpense)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>{t('profitAnalysis.maintenanceLine')}</Text>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(rollup.maintenanceExpense)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>{t('profitAnalysis.tollsLine')}</Text>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{money(rollup.tollsExpense)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={[styles.rowLabel, { fontWeight: '700' }]}>{t('profitAnalysis.totalExpensesLine')}</Text>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }}>
                  {money(rollup.totalExpenses)}
                </Text>
              </View>
            </Card>
            <MutedText>{t('profitAnalysis.reconciliationNote')}</MutedText>

            <Text style={styles.sectionTitle}>{t('profitAnalysis.ratiosTitle')}</Text>
            <MutedText>{t('profitAnalysis.ratiosSubtitle')}</MutedText>
            <Card>
              <View style={[styles.row]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{t('profitAnalysis.fuelPctOfRevenue')}</Text>
                  {fuelBenchmark ? (
                    <MutedText>
                      {t('profitAnalysis.industryRange', {
                        low: `${(fuelBenchmark.low * 100).toFixed(0)}%`,
                        high: `${(fuelBenchmark.high * 100).toFixed(0)}%`,
                      })}
                    </MutedText>
                  ) : (
                    <MutedText>{t('profitAnalysis.noBenchmarkYet')}</MutedText>
                  )}
                </View>
                <Text style={{ color: statusColor(fuelStatus), fontWeight: '700', fontSize: typography.size.md }}>
                  {rollup.fuelPctOfRevenue != null ? `${(rollup.fuelPctOfRevenue * 100).toFixed(1)}%` : '—'}
                </Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{t('profitAnalysis.maintenanceCostPerMile')}</Text>
                  {maintenanceBenchmark ? (
                    <MutedText>
                      {t('profitAnalysis.industryRangeUsd', { low: money(maintenanceBenchmark.low, { maximumFractionDigits: 2 }), high: money(maintenanceBenchmark.high, { maximumFractionDigits: 2 }) })}
                    </MutedText>
                  ) : (
                    <MutedText>{t('profitAnalysis.noBenchmarkYet')}</MutedText>
                  )}
                </View>
                <Text style={{ color: statusColor(maintenanceStatus), fontWeight: '700', fontSize: typography.size.md }}>
                  {rollup.maintenanceCostPerMile != null ? `${money(rollup.maintenanceCostPerMile, { maximumFractionDigits: 3 })}/mi` : '—'}
                </Text>
              </View>
            </Card>
            {(fuelBenchmark || maintenanceBenchmark) && <MutedText>{t('profitAnalysis.industryReferenceNote')}</MutedText>}

            {recentWeeks.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('profitAnalysis.weeklyTitle')}</Text>
                <Card>
                  {recentWeeks.map((w, i) => (
                    <View key={w.weekEnding} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <MutedText>{w.weekEnding}</MutedText>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{money(w.net)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            )}

            <Text style={styles.sectionTitle}>{t('profitAnalysis.aiInsightsTitle')}</Text>
            <Card>
              <PrimaryButton title={t('profitAnalysis.askAi')} onPress={handleAskAi} loading={aiLoading} />
              {aiAnswer && (
                <>
                  <Text style={{ color: colors.text, marginTop: spacing.sm, lineHeight: 20 }}>{aiAnswer}</Text>
                  <MutedText style={{ marginTop: spacing.xs }}>{t('profitAnalysis.aiFooter')}</MutedText>
                </>
              )}
              {aiError && <MutedText style={{ color: colors.red, marginTop: spacing.sm }}>{aiError}</MutedText>}
            </Card>
            <LegalFootnote />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  statRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '600' as const,
  },
};
