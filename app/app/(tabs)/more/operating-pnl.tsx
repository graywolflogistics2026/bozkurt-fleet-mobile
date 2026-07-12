import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useUserCategories } from '@/src/data/userCategories';
import { useDocuments } from '@/src/data/documents';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildProfitLoss } from '@/src/stats/profitLoss';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

type CarrierYtd = { carrier?: string; ytdRevenue?: number; ytdExpenses?: number; ytdNet?: number; weeksInService?: number };

export default function OperatingPnl() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const categoriesQuery = useUserCategories({ active: true });
  const documentsQuery = useDocuments();
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

  const loading = settlementsQuery.isLoading || deductionsQuery.isLoading;

  const rollup = useMemo(
    () => buildProfitLoss(settlementsQuery.data ?? [], deductionsQuery.data ?? [], categoriesQuery.data ?? []),
    [settlementsQuery.data, deductionsQuery.data, categoriesQuery.data]
  );

  // Carrier-YTD reference strip (legacy rOper(), "operating" sub-object —
  // legacy/index.html's settlement extraction prompt, ported verbatim to
  // supabase/functions/ai-import/index.ts): whatever YTD figures the
  // carrier itself prints on the most recent settlement PDF, shown purely
  // as a cross-check reference against this screen's own system-computed
  // totals above — never used in the math. Optional: many carriers don't
  // print this section, and documents.parsed_json is untyped jsonb, so this
  // reads defensively and renders nothing when absent ("like web when
  // available").
  const carrierYtd = useMemo((): CarrierYtd | null => {
    const settlements = settlementsQuery.data ?? [];
    const documents = documentsQuery.data ?? [];
    const latest = [...settlements].sort((a, b) => (b.week_ending ?? '').localeCompare(a.week_ending ?? ''))[0];
    if (!latest?.document_id) return null;
    const doc = documents.find((d) => d.id === latest.document_id);
    const parsed = doc?.parsed_json as { settlement?: { carrier?: string; operating?: CarrierYtd } } | null;
    const operating = parsed?.settlement?.operating;
    const carrier = parsed?.settlement?.carrier;
    if (!operating && !carrier) return null;
    const hasYtdFigures = operating && (operating.ytdRevenue || operating.ytdExpenses || operating.ytdNet || operating.weeksInService);
    if (!hasYtdFigures) return carrier ? { carrier } : null;
    return { carrier, ...operating };
  }, [settlementsQuery.data, documentsQuery.data]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('operatingPnl.title')}</ScreenTitle>

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.statRow}>
                <View style={styles.statCell}>
                  <MutedText>{t('operatingPnl.revenue')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{money(rollup.revenue)}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{t('operatingPnl.expenses')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.red }]}>{money(rollup.totalExpenses)}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{t('operatingPnl.netIncome')}</MutedText>
                  <Text style={[styles.statValue, { color: rollup.netIncome >= 0 ? colors.green : colors.red }]}>
                    {money(rollup.netIncome)}
                  </Text>
                </View>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>{t('operatingPnl.expenseBreakdownTitle')}</Text>
            <MutedText>{t('operatingPnl.expenseBreakdownSubtitle')}</MutedText>
            <Card>
              {rollup.expensesByBucket.length === 0 ? (
                <MutedText>{t('operatingPnl.empty')}</MutedText>
              ) : (
                <>
                  {rollup.expensesByBucket.map((c, i) => (
                    <View key={c.category} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {c.category}
                      </Text>
                      <Text style={styles.rowAmount}>{money(c.amount)}</Text>
                    </View>
                  ))}
                  <View style={[styles.row, styles.totalRow]}>
                    <Text style={styles.totalLabel}>{t('operatingPnl.total')}</Text>
                    <Text style={styles.totalAmount}>{money(rollup.totalExpenses)}</Text>
                  </View>
                </>
              )}
            </Card>

            {carrierYtd && (
              <>
                <Text style={styles.sectionTitle}>{t('operatingPnl.carrierYtdTitle')}</Text>
                <MutedText>{t('operatingPnl.carrierYtdSubtitle')}</MutedText>
                <Card>
                  {carrierYtd.carrier && (
                    <View style={styles.row}>
                      <MutedText>{t('operatingPnl.carrierName')}</MutedText>
                      <Text style={styles.rowAmount}>{carrierYtd.carrier}</Text>
                    </View>
                  )}
                  {carrierYtd.ytdRevenue != null && (
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('operatingPnl.ytdRevenue')}</MutedText>
                      <Text style={styles.rowAmount}>{money(carrierYtd.ytdRevenue)}</Text>
                    </View>
                  )}
                  {carrierYtd.ytdExpenses != null && (
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('operatingPnl.ytdExpenses')}</MutedText>
                      <Text style={styles.rowAmount}>{money(carrierYtd.ytdExpenses)}</Text>
                    </View>
                  )}
                  {carrierYtd.ytdNet != null && (
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('operatingPnl.ytdNet')}</MutedText>
                      <Text style={styles.rowAmount}>{money(carrierYtd.ytdNet)}</Text>
                    </View>
                  )}
                  {carrierYtd.weeksInService != null && (
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('operatingPnl.weeksInService')}</MutedText>
                      <Text style={styles.rowAmount}>{carrierYtd.weeksInService}</Text>
                    </View>
                  )}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
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
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
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
    flex: 1,
    color: colors.text,
    fontSize: typography.size.sm,
    marginEnd: spacing.sm,
  },
  rowAmount: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '600' as const,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
  },
  totalAmount: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
  },
};
