import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useTolls, useInsertToll, useDeleteToll } from '@/src/data/tolls';
import { useDeductions } from '@/src/data/deductions';
import { useSettlements } from '@/src/data/settlements';
import { buildTollsSummary, type TollEntry } from '@/src/stats/tollsSummary';
import { PERIOD_OPTIONS, type PeriodOption } from '@/src/stats/periodFilter';
import { carrierDisplayName } from '@/src/import/carrierPayroll';
import { useSessionState } from '@/src/lib/useSessionState';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { truckIdFilterFor } from '@/src/stats/fleetScope';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { RowDeleteButton } from '@/src/components/RowDeleteButton';
import { colors, radii, spacing, typography } from '@/src/theme';
import { todayDateOnly } from '@/src/lib/dateOnly';
import { numOrNull } from '@/src/lib/number';

const NETWORKS = ['ezpass', 'drivewyze', 'other'] as const;
type Network = (typeof NETWORKS)[number];

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

function TollEntryRow({ x, onDelete }: { x: TollEntry; onDelete: (() => void) | null }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const origin = x.withheld
    ? x.carrier
      ? t('tolls.withheldBy', { carrier: carrierDisplayName(x.carrier) })
      : t('tolls.withheldBySettlement')
    : t('tolls.paidByMe');
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.description}
        </Text>
        <MutedText>
          {x.date ? date(x.date) : '—'} · {x.kind === 'scales' ? t('tolls.scales') : t('tolls.tollsAndFees')} · {origin}
        </MutedText>
        {x.breakdown.length > 0 && (
          <View style={{ marginTop: spacing.xs, paddingStart: spacing.sm, borderStartWidth: 2, borderStartColor: colors.border }}>
            <MutedText>{t('tolls.breakdownTitle')}</MutedText>
            {x.breakdown.map((b) => (
              <MutedText key={b.id}>
                {b.date ? date(b.date) : '—'} · {b.label} · {money(b.amount)}
              </MutedText>
            ))}
          </View>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.amount)}</Text>
      </View>
      {/* Delete mark: top-right corner, 44 dp (owner 2026-11-24). */}
      {onDelete && <RowDeleteButton onPress={onDelete} />}
    </View>
  );
}

export default function Tolls() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  // MULTI-TRUCK MODEL (owner decision) — requirement 2's "Lists follow
  // the selector."
  const { activeTruckId } = useActiveTruck();
  const tollsQuery = useTolls({ truck_id: truckIdFilterFor(activeTruckId) });
  const deductionsQuery = useDeductions({ truck_id: truckIdFilterFor(activeTruckId) });
  // Week ending + carrier lookup only (never a filter).
  const settlementsQuery = useSettlements();
  const [period, setPeriod] = useSessionState<PeriodOption>('tolls-period', 'all');
  const insertToll = useInsertToll();
  const deleteToll = useDeleteToll();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [network, setNetwork] = useState<Network>('ezpass');
  const [plaza, setPlaza] = useState('');
  const [amount, setAmount] = useState('');
  const [tollDate, setTollDate] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient, { entities: ['tolls', 'deductions', 'settlements'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // TOLLS & FEES (owner 2026-11-13): src/stats/tollsSummary.ts decides
  // the rows, the two subtotals and the period. Screen-only.
  const summary = useMemo(
    () =>
      buildTollsSummary({
        deductions: deductionsQuery.data ?? [],
        tolls: tollsQuery.data ?? [],
        settlements: settlementsQuery.data ?? [],
        period,
      }),
    [deductionsQuery.data, tollsQuery.data, settlementsQuery.data, period]
  );

  function openAdd() {
    setNetwork('ezpass');
    setPlaza('');
    setAmount('');
    setTollDate(todayDateOnly());
    setAdding(true);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amt = numOrNull(amount) || 0;
    setSaving(true);
    try {
      await insertToll.mutateAsync({
        user_id: userId,
        // See fuel.tsx's own identical comment — silently attaches to the
        // currently-scoped truck, left fleet-level only in All-Trucks mode.
        truck_id: activeTruckId,
        network,
        plaza: plaza || null,
        amount: amt,
        toll_date: tollDate || null,
        source: 'manual',
      });
      await invalidateFinancialData(queryClient, { entities: ['tolls'] });
      setAdding(false);
    } catch (err) {
      Alert.alert(t('tolls.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: TollEntry) {
    Alert.alert(t('tolls.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteToll.mutateAsync(x.id);
            await invalidateFinancialData(queryClient, { entities: ['tolls'] });
          } catch (err) {
            Alert.alert(t('tolls.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('tolls.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('tolls.add')}
            </Text>
          </Pressable>
        </View>
        <FleetScopeLabel />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          {PERIOD_OPTIONS.map((p) => (
            <Pill key={p} label={t(`tolls.period.${p}`)} selected={period === p} onPress={() => setPeriod(p)} />
          ))}
        </View>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.tollsAndFees')}</MutedText>
              <Text style={styles.statValue}>{money(summary.tolls)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.scales')}</MutedText>
              <Text style={styles.statValue}>{money(summary.scales)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.total')}</MutedText>
              <Text style={styles.statValue}>{money(summary.total)}</Text>
            </View>
          </View>
        </Card>

        <MonthGroupedList
          screenKey="tolls"
          rows={summary.entries}
          getDate={(x) => x.date}
          getAmount={(x) => x.amount}
          loading={tollsQuery.isLoading || deductionsQuery.isLoading}
          loadingLabel={t('common.loading')}
          emptyLabel={t('tolls.empty')}
          renderRows={(monthRows) => (
            <Card>
              {monthRows.map((x, i) => (
                <View key={x.key} style={i > 0 ? styles.rowBorder : undefined}>
                  {/* Deduction lines are edited on Deductions; only tolls-table rows delete here. */}
                  <TollEntryRow x={x} onDelete={x.table === 'tolls' ? () => handleDelete(x) : null} />
                </View>
              ))}
            </Card>
          )}
        />
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('tolls.addTitle')}</SheetTitle>
        <MutedText>{t('tolls.networkLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {NETWORKS.map((n) => (
            <Pill key={n} label={t(`tolls.networks.${n}`)} selected={network === n} onPress={() => setNetwork(n)} />
          ))}
        </View>
        <MutedText>{t('tolls.plazaLabel')}</MutedText>
        <Field value={plaza} onChangeText={setPlaza} placeholder={t('tolls.plazaPlaceholder')} />
        <MutedText>{t('tolls.dateLabel')}</MutedText>
        <Field value={tollDate} onChangeText={setTollDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('tolls.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="0.00" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
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
