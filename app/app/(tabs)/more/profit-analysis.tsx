import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useBenchmarks } from '@/src/data/benchmarks';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildProfitAnalysis, compareToBenchmark, type RangeStatus } from '@/src/stats/profitAnalysis';
import { buildWeeklyTrend } from '@/src/stats/cashFlowTrend';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, PrimaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import i18n from '@/src/i18n';

function statusColor(status: RangeStatus) {
  if (status === 'above_range') return colors.red;
  if (status === 'below_range') return colors.green;
  return colors.text;
}

export default function ProfitAnalysis() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const settlementsQuery = useSettlements();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
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

  const loading = settlementsQuery.isLoading || fuelQuery.isLoading || maintenanceQuery.isLoading;

  const rollup30d = useMemo(
    () => buildProfitAnalysis(settlementsQuery.data ?? [], fuelQuery.data ?? [], maintenanceQuery.data ?? [], 30),
    [settlementsQuery.data, fuelQuery.data, maintenanceQuery.data]
  );

  const weeklyTrend = useMemo(() => buildWeeklyTrend(settlementsQuery.data ?? []), [settlementsQuery.data]);
  const recentWeeks = weeklyTrend.slice(-8);

  // benchmarks table may not exist yet (docs/PENDING_SQL.md §25 not run) —
  // useBenchmarks() then resolves to an error, treated the same as "no
  // benchmark data" rather than a scary error banner.
  const benchmarks = benchmarksQuery.isError ? [] : (benchmarksQuery.data ?? []);
  const fuelBenchmark = benchmarks.find((b) => b.metric === 'fuel_pct_of_revenue') ?? null;
  const maintenanceBenchmark = benchmarks.find((b) => b.metric === 'maintenance_cost_per_mile') ?? null;
  const fuelStatus = compareToBenchmark(rollup30d.fuelPctOfRevenue, fuelBenchmark);
  const maintenanceStatus = compareToBenchmark(rollup30d.maintenanceCostPerMile, maintenanceBenchmark);

  async function handleAskAi() {
    setAiLoading(true);
    setAiError(null);
    setAiAnswer(null);
    try {
      const prompt =
        `Here is my trailing-30-day operating snapshot: revenue ${money(rollup30d.revenue)}, ` +
        `fuel expense ${money(rollup30d.fuelExpense)} (${rollup30d.fuelPctOfRevenue != null ? (rollup30d.fuelPctOfRevenue * 100).toFixed(1) + '%' : 'n/a'} of revenue), ` +
        `maintenance expense ${money(rollup30d.maintenanceExpense)} (${rollup30d.maintenanceCostPerMile != null ? money(rollup30d.maintenanceCostPerMile, { maximumFractionDigits: 3 }) + '/mi' : 'n/a'}), ` +
        `net income ${money(rollup30d.netIncome)} over ${number(rollup30d.totalMiles)} miles.` +
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

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('profitAnalysis.last30Days')}</Text>
            <Card>
              <View style={styles.statRow}>
                <View style={styles.statCell}>
                  <MutedText>{t('profitAnalysis.revenue')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{money(rollup30d.revenue)}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{t('profitAnalysis.netIncome')}</MutedText>
                  <Text style={[styles.statValue, { color: rollup30d.netIncome >= 0 ? colors.green : colors.red }]}>
                    {money(rollup30d.netIncome)}
                  </Text>
                </View>
              </View>
            </Card>

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
                  {rollup30d.fuelPctOfRevenue != null ? `${(rollup30d.fuelPctOfRevenue * 100).toFixed(1)}%` : '—'}
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
                  {rollup30d.maintenanceCostPerMile != null ? `${money(rollup30d.maintenanceCostPerMile, { maximumFractionDigits: 3 })}/mi` : '—'}
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
