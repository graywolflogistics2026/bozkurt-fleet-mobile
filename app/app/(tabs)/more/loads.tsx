import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLoads, useDeleteLoad } from '@/src/data/loads';
import { useSettlements } from '@/src/data/settlements';
import { useDocuments } from '@/src/data/documents';
// VIEW ONLY (owner 2026-11-24): statement loads of weeks saved without line
// details. Never records, never counted (see src/stats/statementLoads.ts).
import { statementLoadCount, statementOnlyLoadWeeks, type StatementLoadWeek } from '@/src/stats/statementLoads';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { filterLoadsByTruckScope } from '@/src/stats/loadsScope';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { RowDeleteButton } from '@/src/components/RowDeleteButton';
import { colors, spacing, typography } from '@/src/theme';
import type { Load } from '@/src/types/db';

function rpm(load: Load): number | null {
  const miles = Number(load.loaded_miles ?? 0);
  if (miles <= 0) return null;
  return Number(load.revenue ?? 0) / miles;
}

function LoadRow({ x, weekEnding, onDelete }: { x: Load; weekEnding: string | null; onDelete: () => void }) {
  const { t } = useTranslation();
  const { money, number, date } = useFormatters();
  const r = rpm(x);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.origin ?? '—'} → {x.destination ?? '—'}
        </Text>
        <MutedText>
          {x.load_date ? date(x.load_date) : '—'}
          {x.order_number ? ` · #${x.order_number}` : ''} · {number(x.loaded_miles ?? 0)}
          {x.empty_miles ? ` (+${number(x.empty_miles)} empty)` : ''}
        </MutedText>
        {/* The settlement week this load was paid in (owner 2026-11-24). */}
        {weekEnding ? <MutedText>{t('loads.weekEnding', { date: date(weekEnding) })}</MutedText> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.revenue ?? 0)}</Text>
        <MutedText>{r !== null ? `${money(r, { maximumFractionDigits: 2 })}/mi` : '—'}</MutedText>
      </View>
      {/* DELETE MARK (owner 2026-11-24): top-right corner, shared component. */}
      <RowDeleteButton onPress={onDelete} />
    </View>
  );
}

// A week saved without line details: header + its printed loads, read
// only, tagged "From statement". Tapping opens that settlement week.
function StatementWeekBlock({ week, onOpen }: { week: StatementLoadWeek; onOpen: () => void }) {
  const { t } = useTranslation();
  const { money, number, date } = useFormatters();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={4}>
          <Text style={{ color: colors.orange, fontWeight: '700', fontSize: typography.size.sm }}>
            {t('loads.statementWeekHeader', { date: date(week.weekEnding), count: week.loads.length })}
          </Text>
        </Pressable>
        {week.loads.map((l) => (
          <Pressable key={l.key} onPress={onOpen} accessibilityRole="button" style={styles.statementItem}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.desc, { color: colors.muted }]} numberOfLines={1}>
                {l.origin ?? '—'} → {l.destination ?? '—'}
              </Text>
              <MutedText>
                {date(week.weekEnding)}
                {l.order ? ' · #' + l.order : ''} · {t('loads.statementMiles', { loaded: number(l.loadedMiles), empty: number(l.emptyMiles) })}
              </MutedText>
              <Text style={styles.fromStatementTag}>{t('loads.fromStatement')}</Text>
            </View>
            {l.revenueAsPrinted != null && (
              <MutedText style={{ marginStart: spacing.sm }}>{t('loads.asPrinted', { amount: money(l.revenueAsPrinted) })}</MutedText>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type LoadListRow = { kind: 'load'; load: Load } | { kind: 'statement'; week: StatementLoadWeek };

export default function Loads() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const loadsQuery = useLoads();
  // MULTI-TRUCK MODEL (owner decision) — requirement 2's "Lists follow
  // the selector" for a table with no truck_id of its own (see
  // src/stats/loadsScope.ts's own header comment).
  const settlementsQuery = useSettlements();
  const documentsQuery = useDocuments();
  const router = useRouter();
  const { activeTruckId } = useActiveTruck();
  const deleteLoad = useDeleteLoad();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient, { entities: ['loads'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const scoped = filterLoadsByTruckScope(loadsQuery.data ?? [], settlementsQuery.data ?? [], activeTruckId);
    return [...scoped].sort((a, b) => (b.load_date ?? '').localeCompare(a.load_date ?? ''));
  }, [loadsQuery.data, settlementsQuery.data, activeTruckId]);

  // Statement loads of weeks saved without line details (same truck rule
  // as real loads). Display only: never in the stats below.
  const statementWeeks = useMemo(
    () =>
      filterLoadsByTruckScope(
        statementOnlyLoadWeeks(settlementsQuery.data ?? [], documentsQuery.data ?? [], loadsQuery.data ?? []),
        settlementsQuery.data ?? [],
        activeTruckId
      ),
    [settlementsQuery.data, documentsQuery.data, loadsQuery.data, activeTruckId]
  );
  const listRows = useMemo(() => {
    const all: LoadListRow[] = [
      ...rows.map((load) => ({ kind: 'load' as const, load })),
      ...statementWeeks.map((week) => ({ kind: 'statement' as const, week })),
    ];
    const dateOf = (r: LoadListRow) => (r.kind === 'load' ? r.load.load_date : r.week.weekEnding) ?? '';
    return all.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  }, [rows, statementWeeks]);
  const openWeek = (settlementId: string) =>
    router.push({ pathname: '/(tabs)/more/settlements', params: { openId: settlementId } } as unknown as Href);

  const weekEndingBySettlement = useMemo(
    () => new Map((settlementsQuery.data ?? []).map((s) => [s.id, s.week_ending] as const)),
    [settlementsQuery.data]
  );

  const stats = useMemo(() => {
    const totalLoads = rows.length;
    const totalLoadedMiles = rows.reduce((sum, x) => sum + Number(x.loaded_miles ?? 0), 0);
    const totalRevenue = rows.reduce((sum, x) => sum + Number(x.revenue ?? 0), 0);
    return {
      totalLoads,
      totalLoadedMiles,
      revenuePerMile: totalLoadedMiles > 0 ? totalRevenue / totalLoadedMiles : 0,
    };
  }, [rows]);

  function handleDelete(x: Load) {
    Alert.alert(t('loads.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLoad.mutateAsync(x.id);
            await invalidateFinancialData(queryClient, { entities: ['loads'] });
          } catch (err) {
            Alert.alert(t('loads.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('loads.title')}</ScreenTitle>
        <FleetScopeLabel />

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('loads.totalLoads')}</MutedText>
              <Text style={styles.statValue}>{number(stats.totalLoads)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('loads.loadedMiles')}</MutedText>
              <Text style={styles.statValue}>{number(stats.totalLoadedMiles)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('loads.revenuePerMile')}</MutedText>
              <Text style={styles.statValue}>{money(stats.revenuePerMile, { maximumFractionDigits: 2 })}</Text>
            </View>
          </View>
          {statementWeeks.length > 0 && (
            <MutedText style={{ marginTop: spacing.xs }}>{t('loads.notCountedLine', { count: statementLoadCount(statementWeeks) })}</MutedText>
          )}
        </Card>

        <MonthGroupedList
          screenKey="loads"
          rows={listRows}
          getDate={(r) => (r.kind === 'load' ? r.load.load_date : r.week.weekEnding)}
          getAmount={(r) => (r.kind === 'load' ? (r.load.revenue ?? 0) : 0)}
          isCounted={(r) => r.kind === 'load'}
          loading={loadsQuery.isLoading}
          loadingLabel={t('common.loading')}
          emptyLabel={t('loads.empty')}
          renderRows={(monthRows) => (
            <Card>
              {monthRows.map((r, i) =>
                r.kind === 'load' ? (
                  <View key={r.load.id} style={i > 0 ? styles.rowBorder : undefined}>
                    <LoadRow
                      x={r.load}
                      weekEnding={r.load.settlement_id ? (weekEndingBySettlement.get(r.load.settlement_id) ?? null) : null}
                      onDelete={() => handleDelete(r.load)}
                    />
                  </View>
                ) : (
                  <View key={'statement-' + r.week.settlementId} style={i > 0 ? styles.rowBorder : undefined}>
                    <StatementWeekBlock week={r.week} onOpen={() => openWeek(r.week.settlementId)} />
                  </View>
                )
              )}
            </Card>
          )}
        />
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
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  desc: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '600' as const,
  },
  statementItem: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
    paddingStart: spacing.sm,
    borderStartWidth: 2,
    borderStartColor: colors.border,
  },
  fromStatementTag: {
    alignSelf: 'flex-start' as const,
    color: colors.orange,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: 4,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  amount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginStart: spacing.sm,
  },
};
