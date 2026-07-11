import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLoads, useDeleteLoad } from '@/src/data/loads';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Load } from '@/src/types/db';

function rpm(load: Load): number | null {
  const miles = Number(load.loaded_miles ?? 0);
  if (miles <= 0) return null;
  return Number(load.revenue ?? 0) / miles;
}

function LoadRow({ x, onDelete }: { x: Load; onDelete: () => void }) {
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
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.revenue ?? 0)}</Text>
        <MutedText>{r !== null ? `${money(r, { maximumFractionDigits: 2 })}/mi` : '—'}</MutedText>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Loads() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const loadsQuery = useLoads();
  const deleteLoad = useDeleteLoad();
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

  const rows = useMemo(() => {
    const list = loadsQuery.data ?? [];
    return [...list].sort((a, b) => (b.load_date ?? '').localeCompare(a.load_date ?? ''));
  }, [loadsQuery.data]);

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
            await invalidateFinancialData(queryClient);
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
        </Card>

        <Card>
          {loadsQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('loads.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <LoadRow x={x} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
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
  amount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginStart: spacing.sm,
  },
};
