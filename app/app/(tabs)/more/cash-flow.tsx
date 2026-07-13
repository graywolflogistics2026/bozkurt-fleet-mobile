import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useLoads } from '@/src/data/loads';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildWeeklyTrend, rankLoadsByRpm, type RankedLoad } from '@/src/stats/cashFlowTrend';
import { calcCashFlowForecast, type CashFlowBudgetInputs } from '@/src/stats/cashFlowForecast';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, Field, PrimaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

const CHART_HEIGHT = 120;

// Legacy calcCF()'s own form placeholders (legacy/index.html:474-480) —
// shown as Field placeholders, never silently written to the DB as if the
// user had entered them (src/stats/cashFlowForecast.ts applies the same
// defaults independently when a stored value is null).
const BUDGET_PLACEHOLDERS = { truckPayment: '1145', fuelWeekly: '1800', otherWeekly: '500', taxReservePct: '25' };

type BudgetFormState = {
  bankBalance: string;
  weeklyRevenue: string;
  truckPayment: string;
  fuelWeekly: string;
  insuranceMonthly: string;
  otherWeekly: string;
  taxReservePct: string;
};

function toBudgetInputs(form: BudgetFormState): CashFlowBudgetInputs {
  return {
    bankBalance: form.bankBalance ? Number(form.bankBalance) : null,
    weeklyRevenue: form.weeklyRevenue ? Number(form.weeklyRevenue) : null,
    truckPayment: form.truckPayment ? Number(form.truckPayment) : null,
    fuelWeekly: form.fuelWeekly ? Number(form.fuelWeekly) : null,
    insuranceMonthly: form.insuranceMonthly ? Number(form.insuranceMonthly) : null,
    otherWeekly: form.otherWeekly ? Number(form.otherWeekly) : null,
    taxReservePct: form.taxReservePct ? Number(form.taxReservePct) : null,
  };
}

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
    insuranceMonthly: '',
    otherWeekly: '',
    taxReservePct: '',
  });

  // One-time hydration from the stored budget (profiles.cf_* columns,
  // docs/PENDING_SQL.md §29) once it loads — same pattern as tax-
  // estimator.tsx/dashboard-customize.tsx's draft-state hydration.
  useEffect(() => {
    if (budgetHydrated || !profileQuery.data) return;
    const p = profileQuery.data;
    setBudget({
      bankBalance: p.cf_bank_balance != null ? String(p.cf_bank_balance) : '',
      weeklyRevenue: p.cf_weekly_revenue != null ? String(p.cf_weekly_revenue) : '',
      truckPayment: p.cf_truck_payment != null ? String(p.cf_truck_payment) : '',
      fuelWeekly: p.cf_fuel_weekly != null ? String(p.cf_fuel_weekly) : '',
      insuranceMonthly: p.cf_insurance_monthly != null ? String(p.cf_insurance_monthly) : '',
      otherWeekly: p.cf_other_weekly != null ? String(p.cf_other_weekly) : '',
      taxReservePct: p.cf_tax_reserve_pct != null ? String(p.cf_tax_reserve_pct) : '',
    });
    setBudgetHydrated(true);
  }, [budgetHydrated, profileQuery.data]);

  const forecast = useMemo(() => calcCashFlowForecast(toBudgetInputs(budget)), [budget]);

  async function handleSaveBudget() {
    setSaving(true);
    try {
      const values = toBudgetInputs(budget);
      await updateProfile.mutateAsync({
        cf_bank_balance: values.bankBalance,
        cf_weekly_revenue: values.weeklyRevenue,
        cf_truck_payment: values.truckPayment,
        cf_fuel_weekly: values.fuelWeekly,
        cf_insurance_monthly: values.insuranceMonthly,
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
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.weeklyRevenueLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.weeklyRevenue} onChangeText={(v) => setBudget((f) => ({ ...f, weeklyRevenue: v }))} placeholder="6800" />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.truckPaymentLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.truckPayment} onChangeText={(v) => setBudget((f) => ({ ...f, truckPayment: v }))} placeholder={BUDGET_PLACEHOLDERS.truckPayment} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.fuelWeeklyLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.fuelWeekly} onChangeText={(v) => setBudget((f) => ({ ...f, fuelWeekly: v }))} placeholder={BUDGET_PLACEHOLDERS.fuelWeekly} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.insuranceMonthlyLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.insuranceMonthly} onChangeText={(v) => setBudget((f) => ({ ...f, insuranceMonthly: v }))} placeholder="0" />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.otherWeeklyLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.otherWeekly} onChangeText={(v) => setBudget((f) => ({ ...f, otherWeekly: v }))} placeholder={BUDGET_PLACEHOLDERS.otherWeekly} />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <MutedText>{t('cashFlowScreen.taxReservePctLabel')}</MutedText>
              <Field keyboardType="numeric" value={budget.taxReservePct} onChangeText={(v) => setBudget((f) => ({ ...f, taxReservePct: v }))} placeholder={BUDGET_PLACEHOLDERS.taxReservePct} />
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
              <Text style={{ color: colors.red }}>-{money((Number(budget.truckPayment) || 1145) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.fuelWeeklyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((Number(budget.fuelWeekly) || 1800) * 4.33)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.insuranceMonthlyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money(Number(budget.insuranceMonthly) || 0)}</Text>
            </View>
            <View style={styles.forecastRow}>
              <MutedText>{t('cashFlowScreen.otherWeeklyLabel')}</MutedText>
              <Text style={{ color: colors.red }}>-{money((Number(budget.otherWeekly) || 500) * 4.33)}</Text>
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

        <Text style={styles.sectionTitle}>{t('cashFlowScreen.timelineTitle')}</Text>
        <Card>
          {forecast.weeks.map((w, i) => (
            <View key={w.week} style={[styles.timelineRow, i > 0 && styles.rowBorder]}>
              <Text style={{ color: colors.text, flex: 1 }}>{t('cashFlowScreen.weekN', { n: w.week })}</Text>
              <Text style={{ color: colors.green, flex: 1, textAlign: 'right' }}>+{money(w.revenue)}</Text>
              <Text style={{ color: colors.red, flex: 1, textAlign: 'right' }}>-{money(w.expenses)}</Text>
              <Text style={{ color: w.net >= 0 ? colors.green : colors.red, flex: 1, textAlign: 'right' }}>{money(w.net)}</Text>
              <Text style={{ color: w.balance >= 0 ? colors.accent : colors.red, flex: 1, textAlign: 'right', fontWeight: '700' }}>
                {money(w.balance)}
              </Text>
            </View>
          ))}
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
