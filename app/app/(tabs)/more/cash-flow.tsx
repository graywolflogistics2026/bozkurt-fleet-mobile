import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useDeductions } from '@/src/data/deductions';
import { useTolls } from '@/src/data/tolls';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildWeeklyTrend, rankLoadsByRpm, type RankedLoad } from '@/src/stats/cashFlowTrend';
import {
  calcCashFlowForecast,
  trailingWeeklyRevenueAverage,
  trailingWeeklyFuelAverage,
  trailingWeeklyOtherExpenseAverage,
  trailingWeeklyInsuranceAverage,
  trailingWeeklyTruckPaymentAverage,
  mergeForecastInputsWithAverages,
  type CashFlowBudgetInputs,
} from '@/src/stats/cashFlowForecast';
import { buildPolylinePoints, buildAreaPoints } from '@/src/stats/chartHelpers';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

const CHART_HEIGHT = 120;

// Clean-product fix (owner decision 2026-07-30): every budget input
// defaults to empty/0 for a fresh or reset profile — no legacy owner-
// specific dollar amounts pre-filled here or baked into the math
// (src/stats/cashFlowForecast.ts). The tax reserve % is the ONE field
// allowed to show 25 as a labeled SUGGESTION (taxReservePctSuggestion
// i18n copy below the field) — it is never applied unless the user
// actually enters it.
const TAX_RESERVE_SUGGESTED_PCT = '25';

type BudgetFormState = {
  bankBalance: string;
  weeklyRevenue: string;
  truckPayment: string;
  fuelWeekly: string;
  insuranceWeekly: string;
  otherWeekly: string;
  taxReservePct: string;
};

function toBudgetInputs(form: BudgetFormState): CashFlowBudgetInputs {
  return {
    bankBalance: form.bankBalance ? Number(form.bankBalance) : null,
    weeklyRevenue: form.weeklyRevenue ? Number(form.weeklyRevenue) : null,
    truckPayment: form.truckPayment ? Number(form.truckPayment) : null,
    fuelWeekly: form.fuelWeekly ? Number(form.fuelWeekly) : null,
    insuranceWeekly: form.insuranceWeekly ? Number(form.insuranceWeekly) : null,
    otherWeekly: form.otherWeekly ? Number(form.otherWeekly) : null,
    taxReservePct: form.taxReservePct ? Number(form.taxReservePct) : null,
  };
}

// Thin-line "Apple Stocks style" trend chart (owner decision 2026-07-30:
// "consistent chart language app-wide") — replaces the old thick-bar
// gross/net chart with the same buildPolylinePoints/Svg/Polyline/Polygon
// primitives the Dashboard hero card uses (app/(tabs)/index.tsx's
// HeroAreaChart/RevenueTrendChart, extracted to src/stats/chartHelpers.ts
// so both screens draw from one tested implementation). Gross is a plain
// thin accent-blue line (no fill, matches RevenueTrendChart); Net gets a
// thin line WITH a subtle fill underneath (matches HeroAreaChart),
// colored green/red by its most recent value's sign — both series share
// one Y domain so they're visually comparable on the same chart.
function WeeklyTrendChart({ points }: { points: ReturnType<typeof buildWeeklyTrend> }) {
  const { money } = useFormatters();
  const [width, setWidth] = useState(0);
  const height = CHART_HEIGHT;

  const grossValues = points.map((p) => p.gross);
  const netValues = points.map((p) => p.net);
  const domain: [number, number] = [
    Math.min(0, ...grossValues, ...netValues),
    Math.max(0, ...grossValues, ...netValues),
  ];
  const grossLine = buildPolylinePoints(grossValues, width, height, domain);
  const netLine = buildPolylinePoints(netValues, width, height, domain);
  const netArea = width > 0 && netValues.length >= 2 ? buildAreaPoints(netLine, width, height) : '';
  const netIsPositive = (netValues[netValues.length - 1] ?? 0) >= 0;
  const netColor = netIsPositive ? colors.green : colors.red;
  const netFill = netIsPositive ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';

  return (
    <View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {points.length >= 2 && width > 0 && (
          <Svg width={width} height={height}>
            <Polygon points={netArea} fill={netFill} stroke="none" />
            <Polyline points={grossLine} fill="none" stroke={colors.accent} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <Polyline points={netLine} fill="none" stroke={netColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <MutedText>{points[0]?.weekEnding}</MutedText>
        <MutedText>{points[points.length - 1]?.weekEnding}</MutedText>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 2, backgroundColor: colors.accent }} />
          <MutedText>{`Gross · ${money(Math.max(0, ...grossValues))} max`}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 2, backgroundColor: netColor }} />
          <MutedText>Net</MutedText>
        </View>
      </View>
    </View>
  );
}

// AUTO-FILL FIELD (owner decision 2026-08-04, Cash Flow auto-fill fix):
// shared by every forecast input that has real settlement data behind
// it (Weekly Revenue, Fuel, Insurance, Truck Payment, Other) — an empty
// field shows the trailing-4-week-average as a caption ("avg of last 4
// weeks: $X"); once the user types a manual value, the caption is
// replaced by a "↺ Reset to average" action that clears the field
// (letting the computed average take back over) rather than making the
// user manually select-all-and-delete. Extracted once so all 5 fields
// behave identically instead of five hand-rolled copies drifting apart.
function AutoFillField({
  label,
  value,
  onChangeText,
  average,
  onReset,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  average: number;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <View style={{ flex: 1, minWidth: 140 }}>
      <MutedText>{label}</MutedText>
      <Field keyboardType="numeric" value={value} onChangeText={onChangeText} placeholder="0" />
      {value ? (
        <Pressable onPress={onReset} hitSlop={8}>
          <Text style={{ color: colors.accent, fontSize: typography.size.xs }}>
            {t('cashFlowScreen.resetToAverage', { amount: money(average) })}
          </Text>
        </Pressable>
      ) : (
        <MutedText>{t('cashFlowScreen.weeklyRevenueFromSettlements', { amount: money(average) })}</MutedText>
      )}
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
  const fuelQuery = useFuelPurchases();
  const deductionsQuery = useDeductions();
  const tollsQuery = useTolls();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [budgetHydrated, setBudgetHydrated] = useState(false);
  const [budget, setBudget] = useState<BudgetFormState>({
    bankBalance: '',
    weeklyRevenue: '',
    truckPayment: '',
    fuelWeekly: '',
    insuranceWeekly: '',
    otherWeekly: '',
    taxReservePct: '',
  });

  // One-time hydration from the stored budget (profiles.cf_* columns,
  // docs/PENDING_SQL.md §29/§39) once it loads — same pattern as tax-
  // estimator.tsx's draft-state hydration.
  useEffect(() => {
    if (budgetHydrated || !profileQuery.data) return;
    const p = profileQuery.data;
    setBudget({
      bankBalance: p.cf_bank_balance != null ? String(p.cf_bank_balance) : '',
      weeklyRevenue: p.cf_weekly_revenue != null ? String(p.cf_weekly_revenue) : '',
      truckPayment: p.cf_truck_payment != null ? String(p.cf_truck_payment) : '',
      fuelWeekly: p.cf_fuel_weekly != null ? String(p.cf_fuel_weekly) : '',
      // docs/PENDING_SQL.md §39 (owner decision 2026-08-04): reads the new
      // WEEKLY column — cf_insurance_monthly (§29) is deprecated, left
      // unread here on purpose so an already-saved monthly figure is
      // never silently misread as weekly.
      insuranceWeekly: p.cf_insurance_weekly != null ? String(p.cf_insurance_weekly) : '',
      otherWeekly: p.cf_other_weekly != null ? String(p.cf_other_weekly) : '',
      taxReservePct: p.cf_tax_reserve_pct != null ? String(p.cf_tax_reserve_pct) : '',
    });
    setBudgetHydrated(true);
  }, [budgetHydrated, profileQuery.data]);

  // DATA-FLOW AUDIT FIX (owner decision 2026-07-30 — known symptom: Cash
  // Flow revenue stayed $0 after a settlement import): when the user
  // hasn't entered their own Weekly Revenue budget number, the forecast
  // uses the trailing 4-week average of their ACTUAL settlement gross
  // revenue instead of silently treating it as $0 — labeled "from your
  // settlements" so it's never mistaken for a manually-entered figure.
  // This is display-only: the SAVED budget value (handleSaveBudget below)
  // still persists `null` when the field is empty, so this recomputes
  // live from the latest imports every time rather than freezing a stale
  // number the moment it's first shown.
  const trailingAvgRevenue = useMemo(
    () => trailingWeeklyRevenueAverage(settlementsQuery.data ?? []),
    [settlementsQuery.data]
  );
  // CRITICAL BUG FIX (device feedback 2026-07-31, item 3: "settlement-
  // derived expenses must feed the forecast/actuals, not just revenue"):
  // same trailing-average fallback pattern as Weekly Revenue above, now
  // also for Fuel Weekly and Other Weekly — a manual entry still always
  // wins, this only fills the gap while the field is empty.
  const trailingAvgFuel = useMemo(
    () => trailingWeeklyFuelAverage(fuelQuery.data ?? []),
    [fuelQuery.data]
  );
  const trailingAvgOther = useMemo(
    () => trailingWeeklyOtherExpenseAverage(deductionsQuery.data ?? [], tollsQuery.data ?? []),
    [deductionsQuery.data, tollsQuery.data]
  );
  // CASH FLOW AUTO-FILL FIX (owner decision 2026-08-04, device report: a
  // real carrier settlement withholds FOUR separate insurance charges
  // EVERY WEEK, plus a truck/trailer payment chargeback) — same trailing-
  // average fallback pattern, now for Insurance and Truck Payment too.
  const trailingAvgInsurance = useMemo(
    () => trailingWeeklyInsuranceAverage(deductionsQuery.data ?? []),
    [deductionsQuery.data]
  );
  const trailingAvgTruckPayment = useMemo(
    () => trailingWeeklyTruckPaymentAverage(deductionsQuery.data ?? []),
    [deductionsQuery.data]
  );
  const forecastInputs = useMemo(
    () =>
      mergeForecastInputsWithAverages(toBudgetInputs(budget), {
        weeklyRevenue: trailingAvgRevenue,
        fuelWeekly: trailingAvgFuel,
        insuranceWeekly: trailingAvgInsurance,
        truckPayment: trailingAvgTruckPayment,
        otherWeekly: trailingAvgOther,
      }),
    [budget, trailingAvgRevenue, trailingAvgFuel, trailingAvgInsurance, trailingAvgTruckPayment, trailingAvgOther]
  );
  const forecast = useMemo(() => calcCashFlowForecast(forecastInputs), [forecastInputs]);

  async function handleSaveBudget() {
    setSaving(true);
    try {
      const values = toBudgetInputs(budget);
      await updateProfile.mutateAsync({
        cf_bank_balance: values.bankBalance,
        cf_weekly_revenue: values.weeklyRevenue,
        cf_truck_payment: values.truckPayment,
        cf_fuel_weekly: values.fuelWeekly,
        cf_insurance_weekly: values.insuranceWeekly,
        cf_other_weekly: values.otherWeekly,
        cf_tax_reserve_pct: values.taxReservePct,
      });
    } finally {
      setSaving(false);
    }
  }

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

        {/* 30-day manual-budget forecast — legacy calcCF(), FEATURE_INVENTORY.md
            §1 row 13. Independent of imported settlement/load data (a brand
            new account can still plan a forecast from manual numbers). */}
        <Text style={styles.sectionTitle}>{t('cashFlowScreen.forecastTitle')}</Text>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.bankBalanceLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.bankBalance} onChangeText={(v) => setBudget((f) => ({ ...f, bankBalance: v }))} placeholder="0" />
            </View>
            <AutoFillField
              label={t('cashFlowScreen.weeklyRevenueLabel')}
              value={budget.weeklyRevenue}
              onChangeText={(v) => setBudget((f) => ({ ...f, weeklyRevenue: v }))}
              average={trailingAvgRevenue}
              onReset={() => setBudget((f) => ({ ...f, weeklyRevenue: '' }))}
            />
            <AutoFillField
              label={t('cashFlowScreen.truckPaymentLabel')}
              value={budget.truckPayment}
              onChangeText={(v) => setBudget((f) => ({ ...f, truckPayment: v }))}
              average={trailingAvgTruckPayment}
              onReset={() => setBudget((f) => ({ ...f, truckPayment: '' }))}
            />
            <AutoFillField
              label={t('cashFlowScreen.fuelWeeklyLabel')}
              value={budget.fuelWeekly}
              onChangeText={(v) => setBudget((f) => ({ ...f, fuelWeekly: v }))}
              average={trailingAvgFuel}
              onReset={() => setBudget((f) => ({ ...f, fuelWeekly: '' }))}
            />
            <AutoFillField
              label={t('cashFlowScreen.insuranceWeeklyLabel')}
              value={budget.insuranceWeekly}
              onChangeText={(v) => setBudget((f) => ({ ...f, insuranceWeekly: v }))}
              average={trailingAvgInsurance}
              onReset={() => setBudget((f) => ({ ...f, insuranceWeekly: '' }))}
            />
            <AutoFillField
              label={t('cashFlowScreen.otherWeeklyLabel')}
              value={budget.otherWeekly}
              onChangeText={(v) => setBudget((f) => ({ ...f, otherWeekly: v }))}
              average={trailingAvgOther}
              onReset={() => setBudget((f) => ({ ...f, otherWeekly: '' }))}
            />
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.taxReservePctLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.taxReservePct} onChangeText={(v) => setBudget((f) => ({ ...f, taxReservePct: v }))} placeholder="0" />
              <MutedText>{t('cashFlowScreen.taxReservePctSuggestion', { pct: TAX_RESERVE_SUGGESTED_PCT })}</MutedText>
            </View>
          </View>
          <PrimaryButton title={`💾 ${t('cashFlowScreen.saveBudget')}`} onPress={handleSaveBudget} loading={saving} />
        </Card>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('cashFlowScreen.bankLabel')}</MutedText>
              <Text style={styles.statValue}>{money(forecast.bankBalance)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('cashFlowScreen.revenue30dLabel')}</MutedText>
              <Text style={styles.statValue}>{money(forecast.revenue30d)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('cashFlowScreen.netBalance30dLabel')}</MutedText>
              <Text style={[styles.statValue, { color: forecast.netBalance30d >= 0 ? colors.green : colors.red }]}>
                {money(forecast.netBalance30d)}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.md, gap: 4 }}>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.bankLabel')}</MutedText>
              <Text style={{ color: colors.text }}>{money(forecast.bankBalance)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.revenue30dLabel')}</MutedText>
              <Text style={{ color: colors.green }}>+{money(forecast.revenue30d)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.truckPaymentLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((forecastInputs.truckPayment || 0) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.fuelWeeklyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((forecastInputs.fuelWeekly || 0) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.insuranceWeeklyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((forecastInputs.insuranceWeekly || 0) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.otherWeeklyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((forecastInputs.otherWeekly || 0) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.taxReserveLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money(forecast.weeklyTaxReserve * 4.33)}</Text>
            </View>
            <View style={[styles.forecastRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: spacing.xs }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{t('cashFlowScreen.net30dLabel')}</Text>
              <Text style={{ color: forecast.netBalance30d >= 0 ? colors.green : colors.red, fontWeight: '700' }}>
                {money(forecast.netBalance30d)}
              </Text>
            </View>
          </View>

          <View style={styles.taxReserveBox}>
            <MutedText>{t('cashFlowScreen.weeklyTaxReserveLabel')}</MutedText>
            <Text style={{ color: colors.orange, fontSize: typography.size.lg, fontWeight: '700' }}>
              {t('cashFlowScreen.perWeek', { amount: money(forecast.weeklyTaxReserve) })}
            </Text>
          </View>
        </Card>

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
  forecastRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 2,
  },
  taxReserveBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 7,
    backgroundColor: colors.card2,
  },
  timelineRow: {
    flexDirection: 'row' as const,
    paddingVertical: spacing.sm,
  },
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
