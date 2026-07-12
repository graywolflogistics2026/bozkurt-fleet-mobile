import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useDeductions } from '@/src/data/deductions';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildAssetRegister, activeWarranties, type AssetRow } from '@/src/stats/assetRegister';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

function AssetCard({ x }: { x: AssetRow }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const d = x.deduction;
  return (
    <View style={[styles.row, x.needsReview && styles.needsReviewRow]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.needsReview ? '⚠️ ' : ''}
          {d.description ?? '—'}
        </Text>
        <MutedText>
          {d.ded_date ? date(d.ded_date) : '—'} · {d.category ?? '—'}
        </MutedText>
        {x.warrantyStatus !== 'none' && x.warrantyExpires && (
          <Text style={{ color: x.warrantyStatus === 'active' ? colors.green : colors.muted, fontSize: typography.size.xs, marginTop: 2 }}>
            {x.warrantyStatus === 'active'
              ? t('assetRegister.warrantyActiveUntil', { date: date(x.warrantyExpires) })
              : t('assetRegister.warrantyExpired', { date: date(x.warrantyExpires) })}
          </Text>
        )}
      </View>
      <Text style={styles.amount}>{money(d.amount)}</Text>
    </View>
  );
}

export default function AssetRegister() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const dedQuery = useDeductions();
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

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const assets = useMemo(() => buildAssetRegister(dedQuery.data ?? [], todayIso), [dedQuery.data, todayIso]);
  const active = useMemo(() => activeWarranties(assets), [assets]);
  const totalValue = useMemo(() => assets.reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0), [assets]);

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('assetRegister.title')}</ScreenTitle>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.totalAssets')}</MutedText>
              <Text style={styles.statValue}>{assets.length}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.totalValue')}</MutedText>
              <Text style={styles.statValue}>{money(totalValue, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.activeWarranties')}</MutedText>
              <Text style={styles.statValue}>{active.length}</Text>
            </View>
          </View>
        </Card>

        {active.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('assetRegister.activeWarrantiesTitle')}</Text>
            <Card>
              {active.map((x, i) => (
                <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                  <AssetCard x={x} />
                </View>
              ))}
            </Card>
          </>
        )}

        <Text style={styles.sectionTitle}>{t('assetRegister.allAssetsTitle')}</Text>
        <Card>
          {dedQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : assets.length === 0 ? (
            <MutedText>{t('assetRegister.empty')}</MutedText>
          ) : (
            assets.map((x, i) => (
              <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                <AssetCard x={x} />
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
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    paddingVertical: spacing.sm,
  },
  needsReviewRow: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
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
