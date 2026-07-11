import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements, useDeleteSettlement } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useReimbursements } from '@/src/data/reimbursements';
import { useLoads } from '@/src/data/loads';
import { useDocuments } from '@/src/data/documents';
import { useFleetStats } from '@/src/data/dashboardStats';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import {
  Screen,
  ScreenTitle,
  Card,
  MutedText,
  TappableCard,
  ModalSheet,
  SheetTitle,
  SecondaryButton,
} from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Settlement } from '@/src/types/db';
import type { ExtractedRevenueItem } from '@/src/import/types';

function extractRevenueItems(parsedJson: Record<string, unknown> | null | undefined): ExtractedRevenueItem[] {
  const settlement = parsedJson?.settlement;
  if (!settlement || typeof settlement !== 'object') return [];
  const items = (settlement as Record<string, unknown>).revenueItems;
  return Array.isArray(items) ? (items as ExtractedRevenueItem[]) : [];
}

export default function Settlements() {
  const { t } = useTranslation();
  const { money, number, date } = useFormatters();
  const settlementsQuery = useSettlements();
  const deleteSettlement = useDeleteSettlement();
  const dedQuery = useDeductions();
  const reimbQuery = useReimbursements();
  const loadsQuery = useLoads();
  const documentsQuery = useDocuments();
  const fleetStats = useFleetStats(null);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Settlement | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = settlementsQuery.data ?? [];
    return [...list].sort((a, b) => b.week_ending.localeCompare(a.week_ending));
  }, [settlementsQuery.data]);

  const chargebacks = useMemo(() => {
    if (!selected) return [];
    return (dedQuery.data ?? []).filter((d) => d.settlement_id === selected.id && d.source === 'settlement');
  }, [dedQuery.data, selected]);

  const settlementReimbursements = useMemo(() => {
    if (!selected) return [];
    return (reimbQuery.data ?? []).filter((r) => r.settlement_id === selected.id);
  }, [reimbQuery.data, selected]);

  const settlementLoads = useMemo(() => {
    if (!selected) return [];
    return (loadsQuery.data ?? []).filter((l) => l.settlement_id === selected.id);
  }, [loadsQuery.data, selected]);

  const revenueItems = useMemo(() => {
    if (!selected?.document_id) return [];
    const doc = (documentsQuery.data ?? []).find((d) => d.id === selected.document_id);
    return extractRevenueItems(doc?.parsed_json);
  }, [documentsQuery.data, selected]);

  const chargebackTotal = useMemo(() => chargebacks.reduce((sum, x) => sum + Number(x.amount ?? 0), 0), [chargebacks]);
  const reimbTotal = useMemo(
    () => settlementReimbursements.reduce((sum, x) => sum + Number(x.amount ?? 0), 0),
    [settlementReimbursements]
  );

  function handleDelete(x: Settlement) {
    Alert.alert(t('settlementsScreen.deleteConfirmTitle'), t('settlementsScreen.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            // loads/fuel_purchases/reimbursements/deductions with this
            // settlement_id cascade-delete server-side (CLAUDE.md invariant #5).
            await deleteSettlement.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
            setSelected(null);
          } catch (err) {
            Alert.alert(t('settlementsScreen.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
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
        <ScreenTitle>{t('settlementsScreen.title')}</ScreenTitle>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.grossTotal')}</MutedText>
              <Text style={styles.statValue}>{money(fleetStats.data?.grossRevenue ?? 0)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.netTotal')}</MutedText>
              <Text style={styles.statValue}>{money(fleetStats.data?.netRevenue ?? 0)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('settlementsScreen.count')}</MutedText>
              <Text style={styles.statValue}>{number(fleetStats.data?.settlementCount ?? 0)}</Text>
            </View>
          </View>
        </Card>

        {settlementsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <MutedText>{t('settlementsScreen.empty')}</MutedText>
          </Card>
        ) : (
          rows.map((x) => (
            <TappableCard key={x.id} onPress={() => setSelected(x)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View>
                  <Text style={styles.desc}>{t('settlementsScreen.weekOf', { date: date(x.week_ending) })}</Text>
                  <MutedText>{number(x.miles ?? 0)} mi</MutedText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>{money(x.net)}</Text>
                  <MutedText>{t('settlementsScreen.grossLabel', { amount: money(x.gross) })}</MutedText>
                </View>
              </View>
            </TappableCard>
          ))
        )}
      </ScrollView>

      <ModalSheet visible={!!selected} onClose={() => setSelected(null)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          {selected && (
            <>
              <SheetTitle>{t('settlementsScreen.weekOf', { date: date(selected.week_ending) })}</SheetTitle>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <View>
                  <MutedText>{t('settlementsScreen.grossLabelShort')}</MutedText>
                  <Text style={styles.detailAmount}>{money(selected.gross)}</Text>
                </View>
                <View>
                  <MutedText>{t('settlementsScreen.netLabelShort')}</MutedText>
                  <Text style={styles.detailAmount}>{money(selected.net)}</Text>
                </View>
                <View>
                  <MutedText>{t('settlementsScreen.milesLabelShort')}</MutedText>
                  <Text style={styles.detailAmount}>{number(selected.miles ?? 0)}</Text>
                </View>
              </View>

              {revenueItems.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t('settlementsScreen.incomeLines')}</Text>
                  {revenueItems.map((item, i) => (
                    <View key={i} style={styles.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailDesc}>{item.desc ?? item.order ?? '—'}</Text>
                        {item.incomeType && <MutedText>{item.incomeType.replace(/_/g, ' ')}</MutedText>}
                      </View>
                      <Text style={styles.detailDesc}>{money(item.amount ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={styles.sectionTitle}>
                {t('settlementsScreen.chargebacks')} · {money(chargebackTotal)}
              </Text>
              {chargebacks.length === 0 ? (
                <MutedText>{t('settlementsScreen.noChargebacks')}</MutedText>
              ) : (
                chargebacks.map((d) => (
                  <View key={d.id} style={styles.detailRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailDesc}>{d.description ?? d.category ?? '—'}</Text>
                      {d.category && <MutedText>{d.category}</MutedText>}
                    </View>
                    <Text style={styles.detailDesc}>{money(d.amount)}</Text>
                  </View>
                ))
              )}

              {settlementReimbursements.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>
                    {t('settlementsScreen.reimbursements')} · {money(reimbTotal)}
                  </Text>
                  {settlementReimbursements.map((r) => (
                    <View key={r.id} style={styles.detailRow}>
                      <Text style={styles.detailDesc}>{r.description ?? '—'}</Text>
                      <Text style={styles.detailDesc}>{money(r.amount ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              {settlementLoads.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t('settlementsScreen.loads')}</Text>
                  {settlementLoads.map((l) => (
                    <View key={l.id} style={styles.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailDesc}>
                          {l.origin ?? '—'} → {l.destination ?? '—'}
                        </Text>
                        <MutedText>{number(l.loaded_miles ?? 0)} mi</MutedText>
                      </View>
                      <Text style={styles.detailDesc}>{money(l.revenue ?? 0)}</Text>
                    </View>
                  ))}
                </>
              )}

              <View style={styles.reimportNote}>
                <Text style={{ color: colors.muted, fontSize: typography.size.xs }}>
                  {t('settlementsScreen.reimportNote')}
                </Text>
              </View>

              <SecondaryButton title={`🗑 ${t('common.delete')}`} onPress={() => handleDelete(selected)} />
              <SecondaryButton title={t('common.cancel')} onPress={() => setSelected(null)} />
            </>
          )}
        </ScrollView>
      </ModalSheet>
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
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: 2,
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
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailDesc: {
    color: colors.text,
    fontSize: typography.size.sm,
  },
  detailAmount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  reimportNote: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: 'rgba(148,163,184,0.12)',
  },
};
