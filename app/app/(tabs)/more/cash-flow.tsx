import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildWeeklyTrend, rankLoadsByRpm, type RankedLoad } from '@/src/stats/cashFlowTrend';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

const CHART_HEIGHT = 120;

// Hand-rolled bar trend (no chart library installed — react-native-svg /
// victory-native were both considered but not added; this keeps the weekly
// trend dependency-free while still giving gross-vs-net at a glance).
function WeeklyTrendChart({ points }: { points: ReturnType<typeof buildWeeklyTrend> }) {
  const { money } = useFormatters();
  const maxGross = Math.max(1, ...points.map((p) => p.gross));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 4 }}>
        {points.map((p) => (
          <View key={p.weekEnding} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ width: '100%', height: CHART_HEIGHT, justifyContent: 'flex-end' }}>
              <View
                style={{
                  width: '100%',
                  height: Math.max(2, (p.gross / maxGross) * CHART_HEIGHT),
                  backgroundColor: 'rgba(79,124,255,0.35)',
                  borderRadius: 2,
                  position: 'absolute',
                  bottom: 0,
                }}
              />
              <View
                style={{
                  width: '100%',
                  height: Math.max(2, (Math.max(0, p.net) / maxGross) * CHART_HEIGHT),
                  backgroundColor: p.net >= 0 ? colors.green : colors.red,
                  borderRadius: 2,
                }}
              />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <MutedText>{points[0]?.weekEnding}</MutedText>
        <MutedText>{points[points.length - 1]?.weekEnding}</MutedText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'rgba(79,124,255,0.35)' }} />
          <MutedText>{`Gross · ${money(Math.max(...points.map((p) => p.gross)))} max`}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.green }} />
          <MutedText>Net</MutedText>
        </View>
      </View>
    </View>
  );
}

function LaneRow({ l, good }: { l: RankedLoad; good: boolean }) {
  const { money, number } = useFormatters();
  return (
    <View style={styles.laneRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.laneDesc} numberOfLines={1}>
          {l.origin ?? '?'} → {l.destination ?? '?'}
        </Text>
        <MutedText>
          {l.order_number ?? '—'} · {number(l.loaded_miles)} mi · {money(l.revenue)}
        </MutedText>
      </View>
      <Text style={{ color: good ? colors.green : colors.red, fontWeight: '700', fontSize: typography.size.md }}>
        {money(l.rpm, { maximumFractionDigits: 2 })}/mi
      </Text>
    </View>
  );
}

export default function CashFlow() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const settlementsQuery = useSettlements();
  const loadsQuery = useLoads();
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

  const loading = settlementsQuery.isLoading || loadsQuery.isLoading;
  const trend = useMemo(() => buildWeeklyTrend(settlementsQuery.data ?? []), [settlementsQuery.data]);
  const lanes = useMemo(() => rankLoadsByRpm(loadsQuery.data ?? []), [loadsQuery.data]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('cashFlowScreen.title')}</ScreenTitle>

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : trend.length === 0 ? (
          <Card>
            <MutedText>{t('cashFlowScreen.empty')}</MutedText>
          </Card>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('cashFlowScreen.weeklyTrendTitle')}</Text>
            <Card>
              <WeeklyTrendChart points={trend} />
            </Card>

            <Text style={styles.sectionTitle}>{t('cashFlowScreen.lanesTitle')}</Text>
            {lanes.avgRpm != null ? (
              <MutedText>{t('cashFlowScreen.avgRpm', { rate: money(lanes.avgRpm, { maximumFractionDigits: 2 }) })}</MutedText>
            ) : (
              <MutedText>{t('cashFlowScreen.noLoadData')}</MutedText>
            )}

            {lanes.best.length > 0 && (
              <>
                <Text style={styles.laneSectionTitle}>🏆 {t('cashFlowScreen.bestLanes')}</Text>
                <Card>
                  {lanes.best.map((l, i) => (
                    <View key={l.id} style={i > 0 ? styles.rowBorder : undefined}>
                      <LaneRow l={l} good />
                    </View>
                  ))}
                </Card>

                <Text style={[styles.laneSectionTitle, { color: colors.red }]}>⚠️ {t('cashFlowScreen.worstLanes')}</Text>
                <Card>
                  {lanes.worst.map((l, i) => (
                    <View key={l.id} style={i > 0 ? styles.rowBorder : undefined}>
                      <LaneRow l={l} good={false} />
                    </View>
                  ))}
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
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  laneSectionTitle: {
    color: colors.green,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  laneRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  laneDesc: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '600' as const,
  },
};
