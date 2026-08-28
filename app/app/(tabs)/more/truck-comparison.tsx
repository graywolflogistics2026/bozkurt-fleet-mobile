import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTrucksList } from '@/src/data/trucks';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { useDeductions } from '@/src/data/deductions';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useDriverPayments } from '@/src/data/driverPayments';
import { useDrivers } from '@/src/data/drivers';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { buildTruckComparison, type TruckComparisonRow } from '@/src/stats/truckComparison';
import { PERIOD_OPTIONS, filterByPeriod, type PeriodOption } from '@/src/stats/periodFilter';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, TappableCard } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// PER-TRUCK PROFITABILITY (MULTI-TRUCK MODEL, owner decision) —
// requirement 4: "the real reason someone runs three trucks... the
// screen that answers 'which truck should I keep?'" Reads through the
// SAME data every other financial screen already fetches (no truck_id
// filter on any query here — this screen needs EVERY row, since its own
// job is to split them BY truck itself, via buildTruckComparison()).

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

function StatCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ minWidth: 92, marginEnd: spacing.md, marginBottom: spacing.xs }}>
      <MutedText style={{ fontSize: typography.size.xs }}>{label}</MutedText>
      <Text style={{ color: valueColor ?? colors.text, fontWeight: '700' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function TruckRowCard({
  row,
  rank,
  isBest,
  isWorst,
  hasDriverData,
  onPress,
}: {
  row: TruckComparisonRow;
  rank: number;
  isBest: boolean;
  isWorst: boolean;
  hasDriverData: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const moneyR = (n: number) => money(n, { maximumFractionDigits: 0 });

  return (
    <TappableCard
      onPress={onPress}
      style={
        isBest
          ? { borderColor: colors.green, borderWidth: 2 }
          : isWorst
            ? { borderColor: colors.red, borderWidth: 2 }
            : undefined
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: typography.size.lg, flex: 1 }}>
          #{rank} · {t('common.unit', { unit: row.unitNumber })}
        </Text>
        {isBest && (
          <Text style={{ color: colors.green, fontWeight: '700', fontSize: typography.size.xs }}>🏆 {t('truckComparison.best')}</Text>
        )}
        {isWorst && (
          <Text style={{ color: colors.red, fontWeight: '700', fontSize: typography.size.xs }}>⚠️ {t('truckComparison.worst')}</Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <StatCell label={t('truckComparison.revenue')} value={moneyR(row.grossRevenue)} valueColor={colors.green} />
        <StatCell label={t('truckComparison.expenses')} value={moneyR(row.totalExpenses)} valueColor={colors.red} />
        <StatCell
          label={t('truckComparison.netProfit')}
          value={moneyR(row.netProfit)}
          valueColor={row.netProfit >= 0 ? colors.green : colors.red}
        />
        <StatCell label={t('scorecard.revenuePerMile')} value={row.revenuePerMile != null ? money(row.revenuePerMile, { maximumFractionDigits: 2 }) : '—'} />
        <StatCell label={t('scorecard.costPerMile')} value={row.costPerMile != null ? money(row.costPerMile, { maximumFractionDigits: 2 }) : '—'} />
        <StatCell
          label={t('scorecard.whyPpm')}
          value={row.profitPerMile != null ? money(row.profitPerMile, { maximumFractionDigits: 2 }) : '—'}
          valueColor={row.profitPerMile != null ? (row.profitPerMile >= 0 ? colors.green : colors.red) : undefined}
        />
        <StatCell label={t('truckComparison.miles')} value={number(row.totalMiles)} />
        <StatCell label={t('truckComparison.deadheadPct')} value={row.deadheadPct != null ? `${(row.deadheadPct * 100).toFixed(1)}%` : '—'} />
      </View>

      {/* Cost allocation transparency (requirement 6): explicit, never
          blended silently into "expenses" without a caption. */}
      {row.allocatedExpenses > 0 && (
        <MutedText style={{ marginTop: spacing.xs }}>
          {t('truckComparison.allocatedCaption', { direct: moneyR(row.directExpenses), allocated: moneyR(row.allocatedExpenses) })}
        </MutedText>
      )}

      {/* Driver dimension (requirement 5). */}
      {hasDriverData && row.driverPay > 0 && (
        <View style={{ marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
          <MutedText>{t('truckComparison.driverPay', { amount: moneyR(row.driverPay) })}</MutedText>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {t('truckComparison.netAfterDriverPay', { amount: moneyR(row.netAfterDriverPay) })}
          </Text>
        </View>
      )}
    </TappableCard>
  );
}

export default function TruckComparison() {
  const { t } = useTranslation();
  const router = useRouter();
  const { money, date } = useFormatters();
  const { setActiveTruckId } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const settlementsQuery = useSettlements();
  const loadsQuery = useLoads();
  const dedQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const driverPaymentsQuery = useDriverPayments();
  const driversQuery = useDrivers();
  const [period, setPeriod] = useState<PeriodOption>('thisMonth');

  const result = useMemo(() => {
    const settlements = filterByPeriod(settlementsQuery.data ?? [], (s) => s.week_ending, period);
    const deductions = filterByPeriod(dedQuery.data ?? [], (d) => d.ded_date, period);
    const fuel = filterByPeriod(fuelQuery.data ?? [], (f) => f.purchase_date, period);
    const maintenance = filterByPeriod(maintenanceQuery.data ?? [], (m) => m.service_date, period);
    const tolls = filterByPeriod(tollsQuery.data ?? [], (tl) => tl.toll_date, period);
    return buildTruckComparison(
      trucksQuery.data ?? [],
      settlements,
      loadsQuery.data ?? [],
      deductions,
      fuel,
      maintenance,
      tolls,
      driverPaymentsQuery.data ?? [],
      driversQuery.data ?? []
    );
  }, [
    trucksQuery.data,
    settlementsQuery.data,
    loadsQuery.data,
    dedQuery.data,
    fuelQuery.data,
    maintenanceQuery.data,
    tollsQuery.data,
    driverPaymentsQuery.data,
    driversQuery.data,
    period,
  ]);

  const hasDriverData = (driverPaymentsQuery.data ?? []).length > 0;
  const isLoading = trucksQuery.isLoading || settlementsQuery.isLoading;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('truckComparison.title')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('truckComparison.subtitle')}</MutedText>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PERIOD_OPTIONS.map((p) => (
            <Pill key={p} label={t(`period.${p}`)} selected={period === p} onPress={() => setPeriod(p)} />
          ))}
        </View>

        {isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : result.rows.length === 0 ? (
          <Card>
            <MutedText>{t('truckComparison.empty')}</MutedText>
          </Card>
        ) : (
          result.rows.map((row, i) => (
            <TruckRowCard
              key={row.truckId}
              row={row}
              rank={i + 1}
              isBest={result.rows.length > 1 && row.truckId === result.bestTruckId}
              isWorst={result.rows.length > 1 && row.truckId === result.worstTruckId}
              hasDriverData={hasDriverData}
              onPress={() => {
                if (row.truckId) setActiveTruckId(row.truckId);
                router.push('/(tabs)/more/scorecard');
              }}
            />
          ))
        )}

        {/* UNASSIGNED (requirement 7 — a null-truck row never disappears)
            — nudges toward Settlements (where every row's own truck field
            is already editable inline, per the MULTI-TRUCK MODEL work)
            rather than silently losing this revenue from the comparison.
            SIMPLIFICATION PASS (owner decision) — the dedicated bulk
            "Fix Truck Assignments" screen this used to link to was
            removed; ordinary per-row truck reassignment on each list
            screen's own edit sheet already covers the same need. */}
        {result.unassignedRow && (
          <TappableCard onPress={() => router.push('/(tabs)/more/settlements')} style={{ borderColor: colors.orange, borderWidth: 1 }}>
            <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
              ⚠️ {t('truckComparison.unassignedTitle')}
            </Text>
            <MutedText style={{ marginBottom: spacing.xs }}>
              {t('truckComparison.unassignedBody', { count: result.unassignedRow.settlementCount, amount: money(result.unassignedRow.grossRevenue, { maximumFractionDigits: 0 }) })}
            </MutedText>
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('truckComparison.unassignedFixLink')}</Text>
          </TappableCard>
        )}

        {result.rows.length > 0 && (
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('truckComparison.fleetTotalsTitle')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <StatCell label={t('truckComparison.revenue')} value={money(result.fleetTotals.grossRevenue, { maximumFractionDigits: 0 })} />
              <StatCell label={t('truckComparison.expenses')} value={money(result.fleetTotals.totalExpenses, { maximumFractionDigits: 0 })} />
              <StatCell
                label={t('truckComparison.netProfit')}
                value={money(result.fleetTotals.netProfit, { maximumFractionDigits: 0 })}
                valueColor={result.fleetTotals.netProfit >= 0 ? colors.green : colors.red}
              />
            </View>
          </Card>
        )}

        <MutedText style={{ marginTop: spacing.sm }}>{t('truckComparison.allocationNote')}</MutedText>
      </ScrollView>
    </Screen>
  );
}
