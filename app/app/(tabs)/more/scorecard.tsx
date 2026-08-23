import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useLoanRows } from '@/src/data/loans';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useUpdateTruck } from '@/src/data/trucks';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { calcScorecard, type ScorecardGrade } from '@/src/stats/scorecard';
import { calcCanonicalCpm, normalizeToWeeklyPayment } from '@/src/stats/cpm';
import { resolveMilesTotal } from '@/src/stats/miles';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { useFormatters } from '@/src/i18n/format';
import { ShareCardModal } from '@/src/components/shareCard/ShareCardModal';
import { BrandWordmark } from '@/src/components/BrandWordmark';
import { BRAND_NAME } from '@/src/brand';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

function gradeColor(grade: ScorecardGrade): string {
  if (grade === 'excellent' || grade === 'good') return colors.green;
  if (grade === 'average') return colors.orange;
  return colors.red;
}

function scoreColor(score: number): string {
  if (score >= 75) return colors.green;
  if (score >= 60) return colors.orange;
  return colors.red;
}

export default function Scorecard() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const statsQuery = useFleetStats(null);
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const settlementsQuery = useSettlements();
  const dedQuery = useDeductions();
  const loansQuery = useLoanRows();
  const { activeTruck, refreshTrucks } = useActiveTruck();
  const updateTruck = useUpdateTruck();

  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const companyName = profile?.company_name?.trim() || null;

  // MANUAL TOTAL OVERRIDE (owner decision 2026-08-05, FULL PARITY
  // follow-up item B.3) — a user-entered odometer/ELD total supersedes
  // the settlement/loads-derived total entirely for CPM/RPM. Lives on
  // the ACTIVE truck; for a multi-truck fleet this is a deliberate
  // simplification (an odometer reading is inherently per-truck, but
  // this screen's stats are fleet-wide) — acceptable for the common
  // single-truck (n=1) case CLAUDE.md invariant #7 treats as the default
  // presentation, flagged here rather than silently assumed correct for
  // every fleet size.
  const [overrideDraft, setOverrideDraft] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [editingOverride, setEditingOverride] = useState(false);
  const milesSource = statsQuery.data
    ? resolveMilesTotal({ totalMiles: statsQuery.data.totalMiles }, activeTruck?.manual_total_miles_override)
    : null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  function openOverrideEditor() {
    setOverrideDraft(activeTruck?.manual_total_miles_override != null ? String(activeTruck.manual_total_miles_override) : '');
    setEditingOverride(true);
  }

  async function handleSaveOverride() {
    if (!activeTruck) return;
    const value = Number(overrideDraft);
    setSavingOverride(true);
    try {
      await updateTruck.mutateAsync({
        id: activeTruck.id,
        values: { manual_total_miles_override: Number.isFinite(value) && value > 0 ? value : null },
      });
      await refreshTrucks();
      await invalidateFinancialData(queryClient);
      setEditingOverride(false);
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleUseSettlementsInstead() {
    if (!activeTruck) return;
    setSavingOverride(true);
    try {
      await updateTruck.mutateAsync({ id: activeTruck.id, values: { manual_total_miles_override: null } });
      await refreshTrucks();
      await invalidateFinancialData(queryClient);
    } finally {
      setSavingOverride(false);
    }
  }

  const fuelCost = useMemo(
    () => (fuelQuery.data ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [fuelQuery.data]
  );

  const scorecard = useMemo(() => {
    if (!statsQuery.data) return null;
    return calcScorecard(statsQuery.data.grossRevenue, statsQuery.data.totalDeductions, statsQuery.data.totalMiles, fuelCost);
  }, [statsQuery.data, fuelCost]);

  // FULL PARITY pass (owner decision 2026-08-05, spec item C.4) —
  // Cost/Mile now reads the canonical, per-bucket CPM engine
  // (src/stats/cpm.ts calcCanonicalCpm(), sharing calcTrueProfit()'s own
  // Meals/Advance Repayment/Escrow exclusions and fuel/maintenance/tolls
  // inclusion) instead of the legacy calcCpm()'s raw "ALL deductions"
  // total, which counted non-expenses as if they were real operating
  // costs. The estimated loan/lease payment is only added when NO
  // settlement-withheld 'Truck/Trailer Payments' row already exists —
  // see calcCanonicalCpm()'s own header comment for why.
  const loanPaymentEstimate = useMemo(() => {
    const weeklyTotal = (loansQuery.data ?? []).reduce(
      (sum, l) => sum + normalizeToWeeklyPayment(Number(l.payment ?? 0), l.frequency),
      0
    );
    return weeklyTotal * (statsQuery.data?.settlementCount ?? 0);
  }, [loansQuery.data, statsQuery.data]);

  const canonicalCpm = useMemo(() => {
    if (!statsQuery.data || !milesSource) return null;
    return calcCanonicalCpm(
      statsQuery.data.grossRevenue,
      milesSource.totalMiles,
      dedQuery.data ?? [],
      fuelQuery.data ?? [],
      maintenanceQuery.data ?? [],
      tollsQuery.data ?? [],
      loanPaymentEstimate
    );
  }, [statsQuery.data, milesSource, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, loanPaymentEstimate]);

  // TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): this used to be
  // buildWeeklyTrend()'s bare settlement `.net` (net PAY only, ignoring
  // out-of-pocket expenses entirely). Now the same canonical
  // src/stats/trueProfit.ts figure Home/CEO Mode/Share Weekly
  // Profit/Profit Analysis all use.
  const weeklyTrend = useMemo(
    () =>
      buildWeeklyTrueProfitTrend(
        settlementsQuery.data ?? [],
        dedQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? []
      ).slice(-8),
    [settlementsQuery.data, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]
  );

  const loading = statsQuery.isLoading || fuelQuery.isLoading || settlementsQuery.isLoading || dedQuery.isLoading;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <ScreenTitle>{t('scorecard.title')}</ScreenTitle>
            <MutedText>{t('scorecard.subtitle')}</MutedText>
          </View>
          {scorecard && (
            <Pressable onPress={() => setShareOpen(true)} hitSlop={8} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
                📤 {t('shareProfit.share')}
              </Text>
            </Pressable>
          )}
        </View>

        {loading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : !scorecard ? (
          <Card>
            <MutedText>{t('scorecard.empty')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
                <Text style={{ color: scoreColor(scorecard.score), fontSize: 48, fontWeight: '800' }}>{scorecard.score}</Text>
                <MutedText>{t('scorecard.outOf100')}</MutedText>
                <Text style={{ color: gradeColor(scorecard.grade), fontWeight: '700', fontSize: typography.size.lg, marginTop: spacing.xs }}>
                  {t(`scorecard.grades.${scorecard.grade}`)}
                </Text>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>{t('scorecard.kpiTitle')}</Text>
            <Card>
              <View style={styles.row}>
                <MutedText>{t('scorecard.revenuePerMile')}</MutedText>
                <Text style={{ color: scorecard.revenuePerMile >= 2.0 ? colors.green : colors.orange, fontWeight: '700' }}>
                  {money(scorecard.revenuePerMile, { maximumFractionDigits: 2 })}
                </Text>
              </View>
              {statsQuery.data && statsQuery.data.loadedMiles > 0 && (
                <View style={[styles.row, styles.rowBorder]}>
                  <MutedText>{t('scorecard.revenuePerLoadedMile')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {money(statsQuery.data.grossRevenue / statsQuery.data.loadedMiles, { maximumFractionDigits: 2 })}
                  </Text>
                </View>
              )}
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('scorecard.fuelPerMile')}</MutedText>
                <Text style={{ color: scorecard.fuelPerMile <= 0.65 ? colors.green : colors.red, fontWeight: '700' }}>
                  {money(scorecard.fuelPerMile, { maximumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('scorecard.netPerMile')}</MutedText>
                <Text style={{ color: scorecard.netPerMile >= 0.6 ? colors.green : colors.orange, fontWeight: '700' }}>
                  {money(scorecard.netPerMile, { maximumFractionDigits: 2 })}
                </Text>
              </View>
              {canonicalCpm && (
                <View style={[styles.row, styles.rowBorder]}>
                  <MutedText>{t('scorecard.costPerMile')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {canonicalCpm.costPerMile != null ? money(canonicalCpm.costPerMile, { maximumFractionDigits: 2 }) : '—'}
                  </Text>
                </View>
              )}
              {activeTruck?.fleet_mpg != null && (
                <View style={[styles.row, styles.rowBorder]}>
                  <MutedText>{t('scorecard.mpg')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{number(activeTruck.fleet_mpg, { maximumFractionDigits: 1 })}</Text>
                </View>
              )}
            </Card>

            {statsQuery.data && statsQuery.data.duplicateWeeksIgnored > 0 && (
              <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
                ⚠️ {t('scorecard.duplicateWeeksIgnored', { count: statsQuery.data.duplicateWeeksIgnored })}
              </MutedText>
            )}

            {/* MANUAL TOTAL OVERRIDE (owner decision 2026-08-05, FULL
                PARITY follow-up item B.3) — a banner naming which mile
                source is currently driving CPM/RPM, with a one-tap way
                back to the calculated figure. */}
            {activeTruck && milesSource && (
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <MutedText>
                      {milesSource.source === 'manual'
                        ? t('scorecard.milesSourceManual', { miles: number(milesSource.totalMiles) })
                        : t('scorecard.milesSourceSettlements', { miles: number(milesSource.totalMiles) })}
                    </MutedText>
                  </View>
                  {milesSource.source === 'manual' ? (
                    <SecondaryButton title={t('scorecard.useSettlementsInstead')} onPress={handleUseSettlementsInstead} loading={savingOverride} />
                  ) : (
                    <SecondaryButton title={t('scorecard.setManualTotal')} onPress={openOverrideEditor} />
                  )}
                </View>
              </Card>
            )}

            {canonicalCpm && canonicalCpm.buckets.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('scorecard.cpmBreakdownTitle')}</Text>
                <Card>
                  {canonicalCpm.buckets.map((b, i) => (
                    <View key={b.category} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <MutedText>{b.category}</MutedText>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{money(b.amount)}</Text>
                    </View>
                  ))}
                  {canonicalCpm.excludedTotal > 0 && (
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('scorecard.cpmExcludedTotal')}</MutedText>
                      <MutedText>{money(canonicalCpm.excludedTotal)}</MutedText>
                    </View>
                  )}
                </Card>
              </>
            )}

            {weeklyTrend.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('scorecard.trendTitle')}</Text>
                <Card>
                  {weeklyTrend.map((w, i) => {
                    const prev = weeklyTrend[i - 1];
                    const delta = prev ? w.net - prev.net : null;
                    return (
                      <View key={w.weekEnding} style={[styles.row, i > 0 && styles.rowBorder]}>
                        <MutedText>{w.weekEnding}</MutedText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                          {delta != null && (
                            <Text style={{ color: delta >= 0 ? colors.green : colors.red, fontSize: typography.size.xs }}>
                              {delta >= 0 ? '▲' : '▼'}
                            </Text>
                          )}
                          <Text style={{ color: w.net >= 0 ? colors.green : colors.red, fontWeight: '700' }}>{money(w.net)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </Card>
              </>
            )}
          </>
        )}
      </ScrollView>

      {scorecard && (
        <ShareCardModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          title={t('scorecard.title')}
          caption={t('shareProfit.captionTemplate', { weekSummary: t('scorecard.title'), brand: BRAND_NAME })}
          renderCard={() => (
            <View style={styles.shareCard}>
              {companyName && <Text style={styles.shareCompanyName}>{companyName}</Text>}
              <Text style={styles.shareCardTitle}>{t('scorecard.title')}</Text>
              <Text style={{ color: scoreColor(scorecard.score), fontSize: 48, fontWeight: '800' }}>{scorecard.score}</Text>
              <MutedText>{t('scorecard.outOf100')}</MutedText>
              <Text style={{ color: gradeColor(scorecard.grade), fontWeight: '700', fontSize: typography.size.lg, marginTop: spacing.xs }}>
                {t(`scorecard.grades.${scorecard.grade}`)}
              </Text>
              <View style={styles.shareKpiRow}>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('scorecard.revenuePerMile')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{money(scorecard.revenuePerMile, { maximumFractionDigits: 2 })}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('scorecard.netPerMile')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{money(scorecard.netPerMile, { maximumFractionDigits: 2 })}</Text>
                </View>
              </View>
              <View style={styles.shareBrandFooter}>
                <BrandWordmark fontSize={16} />
              </View>
            </View>
          )}
        />
      )}

      <ModalSheet visible={editingOverride} onClose={() => setEditingOverride(false)}>
        <SheetTitle>{t('scorecard.setManualTotalTitle')}</SheetTitle>
        <MutedText>{t('scorecard.setManualTotalNote')}</MutedText>
        <Field keyboardType="numeric" value={overrideDraft} onChangeText={setOverrideDraft} placeholder="0" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveOverride} loading={savingOverride} disabled={!overrideDraft} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setEditingOverride(false)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  shareCard: {
    width: 320,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center' as const,
  },
  shareCompanyName: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  shareCardTitle: {
    color: colors.muted,
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  shareKpiRow: {
    flexDirection: 'row' as const,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  shareBrandFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%' as const,
    alignItems: 'center' as const,
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
};
