import { useMemo, useState, useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useSettlements, useUpdateSettlement } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useUpdateTruck, useTrucksList } from '@/src/data/trucks';
import { useLoads } from '@/src/data/loads';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { calcScorecard, type ScorecardGrade } from '@/src/stats/scorecard';
import { calcCanonicalCpm, carrierWithholdsLoanPayment } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly } from '@/src/stats/truckCostBasis';
import { resolveMilesTotal } from '@/src/stats/miles';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { buildTruckComparison } from '@/src/stats/truckComparison';
import { useFormatters } from '@/src/i18n/format';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
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
  const { activeTruck, isAllTrucks, setActiveTruckId, refreshTrucks } = useActiveTruck();
  const router = useRouter();
  const updateTruck = useUpdateTruck();
  const updateSettlement = useUpdateSettlement();
  // MULTI-TRUCK MODEL (owner decision) — requirement 2: "when All Trucks
  // is selected show the fleet average AND a per-truck breakdown, never a
  // single blended number." This screen's own KPI card already IS the
  // fleet average (useFleetStats(null), unconditional) — the only thing
  // missing was the breakdown alongside it. Reuses the same
  // buildTruckComparison() the full comparison screen uses, fed the exact
  // same full/unfiltered settlements/deductions/fuel/maintenance/tolls
  // this screen already fetches for its own fleet-wide CPM.
  const trucksQuery = useTrucksList();
  const loadsQuery = useLoads();
  const truckBreakdown = useMemo(() => {
    if (!isAllTrucks) return null;
    return buildTruckComparison(
      trucksQuery.data ?? [],
      settlementsQuery.data ?? [],
      loadsQuery.data ?? [],
      dedQuery.data ?? [],
      fuelQuery.data ?? [],
      maintenanceQuery.data ?? [],
      tollsQuery.data ?? []
    );
  }, [isAllTrucks, trucksQuery.data, settlementsQuery.data, loadsQuery.data, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]);

  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const companyName = profile?.company_name?.trim() || null;

  // CPM "Why?" breakdown (owner decision 2026-08-05, FULL PARITY
  // follow-up item C.4) — the KPI card stays clean; the full per-bucket/
  // fixed-vs-variable/excluded-one-offs/settlements-missing-miles detail
  // lives behind this one action. Deep-linkable via ?openWhy=true (owner
  // decision 2026-08-24) — Home's own CPM tile pushes here with the param
  // already set so tapping it lands straight in the breakdown, same
  // "?filter=needsReview" pattern Alerts' own deep link into Deductions
  // already uses (app/(tabs)/deductions.tsx).
  const { openWhy } = useLocalSearchParams<{ openWhy?: string }>();
  const [whyOpen, setWhyOpen] = useState(openWhy === 'true');
  const [missingMilesDrafts, setMissingMilesDrafts] = useState<Record<string, string>>({});
  const [savingMissingMilesId, setSavingMissingMilesId] = useState<string | null>(null);

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
      await invalidateFinancialData(queryClient, { entities: ['trucks'] });
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
      await invalidateFinancialData(queryClient, { entities: ['trucks'] });
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleSaveMissingMiles(settlementId: string) {
    const draft = missingMilesDrafts[settlementId];
    const miles = Math.max(0, Number(draft) || 0);
    setSavingMissingMilesId(settlementId);
    try {
      await updateSettlement.mutateAsync({ id: settlementId, values: { miles } });
      await invalidateFinancialData(queryClient, { entities: ['settlements'] });
    } finally {
      setSavingMissingMilesId(null);
    }
  }

  // "settlements with revenue but no miles" (spec item C.4) — surfaced in
  // the Why? breakdown with an inline miles input, same fix as
  // Settlements' own inline editing (item B.3) but reachable right from
  // the CPM breakdown that's actually affected by the gap.
  const settlementsMissingMiles = useMemo(
    () => (settlementsQuery.data ?? []).filter((s) => !s.miles && Number(s.gross ?? 0) > 0),
    [settlementsQuery.data]
  );

  const fuelCost = useMemo(
    () => (fuelQuery.data ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [fuelQuery.data]
  );

  const scorecard = useMemo(() => {
    if (!statsQuery.data) return null;
    return calcScorecard(statsQuery.data.grossRevenue, statsQuery.data.totalDeductions, statsQuery.data.totalMiles, fuelCost);
  }, [statsQuery.data, fuelCost]);

  // TRUCK COST BASIS (owner decision 2026-08-05, FULL PARITY follow-up
  // item C.1-2) — the active truck's OWN declared ownership cost
  // (paid/loan/lease + extended warranty), NEVER a synthetic estimate
  // summed from every Loan Center row on the account (the approach that
  // produced $8.48/mi on web). See src/stats/truckCostBasis.ts for the
  // full rule set.
  const carrierWithholdsLoan = useMemo(() => carrierWithholdsLoanPayment(dedQuery.data ?? []), [dedQuery.data]);

  const truckCostBasis = useMemo(() => {
    if (!activeTruck) return null;
    return calcTruckCostBasisWeekly(activeTruck, carrierWithholdsLoan);
  }, [activeTruck, carrierWithholdsLoan]);

  const truckFixedCostTotal = useMemo(() => {
    if (!truckCostBasis) return 0;
    return truckCostBasis.weeklyFixedTotal * (statsQuery.data?.settlementCount ?? 0);
  }, [truckCostBasis, statsQuery.data]);

  // FULL PARITY pass (owner decision 2026-08-05, spec item C.4) —
  // Cost/Mile now reads the canonical, per-bucket CPM engine
  // (src/stats/cpm.ts calcCanonicalCpm(), sharing calcTrueProfit()'s own
  // Meals/Advance Repayment/Escrow exclusions and fuel/maintenance/tolls
  // inclusion) instead of the legacy calcCpm()'s raw "ALL deductions"
  // total, which counted non-expenses as if they were real operating
  // costs. The truck cost basis is only added when NO settlement-withheld
  // 'Truck/Trailer Payments' row already exists — see
  // calcCanonicalCpm()'s own header comment for why.
  const canonicalCpm = useMemo(() => {
    if (!statsQuery.data || !milesSource) return null;
    return calcCanonicalCpm(
      statsQuery.data.grossRevenue,
      milesSource.totalMiles,
      dedQuery.data ?? [],
      fuelQuery.data ?? [],
      maintenanceQuery.data ?? [],
      tollsQuery.data ?? [],
      truckFixedCostTotal
    );
  }, [statsQuery.data, milesSource, dedQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, truckFixedCostTotal]);

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
            <FleetScopeLabel />
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

            {/* MULTI-TRUCK MODEL (owner decision) — requirement 2's "fleet
                average AND a per-truck breakdown" — the KPI card above is
                the fleet average; this is the breakdown, ranked, tapping a
                row switches the global scope to that truck. */}
            {truckBreakdown && truckBreakdown.rows.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('scorecard.perTruckBreakdownTitle')}</Text>
                <Card>
                  {truckBreakdown.rows.map((row, i) => (
                    <Pressable
                      key={row.truckId}
                      onPress={() => row.truckId && setActiveTruckId(row.truckId)}
                      style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{t('common.unit', { unit: row.unitNumber })}</Text>
                        <Text style={{ color: row.netProfit >= 0 ? colors.green : colors.red, fontWeight: '700' }}>
                          {money(row.netProfit, { maximumFractionDigits: 0 })}
                        </Text>
                      </View>
                      <MutedText>
                        {row.profitPerMile != null ? `${money(row.profitPerMile, { maximumFractionDigits: 2 })}/mi` : '—'}
                      </MutedText>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => router.push('/(tabs)/more/truck-comparison' as any)} hitSlop={8} style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>{t('scorecard.seeFullComparison')}</Text>
                  </Pressable>
                </Card>
              </>
            )}

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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <MutedText>{t('scorecard.costPerMile')}</MutedText>
                    <Pressable onPress={() => setWhyOpen(true)} hitSlop={8}>
                      <Text style={{ color: colors.accent, fontWeight: '700', fontSize: typography.size.xs }}>
                        {t('scorecard.whyLink')}
                      </Text>
                    </Pressable>
                  </View>
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

            {/* FIXED vs VARIABLE (spec item C.3) — "variable adds cash
                today, total covers everything." */}
            {canonicalCpm && canonicalCpm.costPerMile != null && (
              <MutedText style={{ marginTop: spacing.xs }}>
                {t('scorecard.fixedVariableSummary', {
                  variable: money(canonicalCpm.variableCostPerMile ?? 0, { maximumFractionDigits: 2 }),
                  total: money(canonicalCpm.costPerMile, { maximumFractionDigits: 2 }),
                })}
              </MutedText>
            )}

            {/* CPM/MILES WARNINGS (spec item C.4: "warn when CPM > $4 or
                miles missing"). */}
            {canonicalCpm && canonicalCpm.costPerMile != null && canonicalCpm.costPerMile > 4 && (
              <MutedText style={{ color: colors.red, marginTop: spacing.xs, fontWeight: '700' }}>
                ⚠️ {t('scorecard.cpmTooHighWarning', { cpm: money(canonicalCpm.costPerMile, { maximumFractionDigits: 2 }) })}
              </MutedText>
            )}
            {statsQuery.data && statsQuery.data.totalMiles <= 0 && (
              <MutedText style={{ color: colors.orange, marginTop: spacing.xs, fontWeight: '700' }}>
                ⚠️ {t('scorecard.milesMissingWarning')}
              </MutedText>
            )}

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

      {/* CPM "Why?" full breakdown (spec item C.4) — everything the clean
          KPI card intentionally leaves out. */}
      <ModalSheet visible={whyOpen} onClose={() => setWhyOpen(false)}>
        <SheetTitle>{t('scorecard.whyTitle')}</SheetTitle>
        {statsQuery.data && (
          <>
            <Text style={styles.whySectionTitle}>{t('scorecard.whyMilesTitle')}</Text>
            <View style={styles.row}>
              <MutedText>{t('scorecard.whyTotalMiles')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{number(statsQuery.data.totalMiles)}</Text>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <MutedText>{t('scorecard.whyLoadedMiles')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{number(statsQuery.data.loadedMiles)}</Text>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <MutedText>{t('scorecard.whyEmptyMiles')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{number(statsQuery.data.emptyMiles)}</Text>
            </View>
            {statsQuery.data.deadheadPct != null && (
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('scorecard.whyDeadheadPct')}</MutedText>
                <Text style={{ color: colors.text, fontWeight: '600' }}>
                  {number(statsQuery.data.deadheadPct * 100, { maximumFractionDigits: 1 })}%
                </Text>
              </View>
            )}
          </>
        )}

        {canonicalCpm && (
          <>
            {canonicalCpm.revenuePerMile != null && (
              <>
                <Text style={styles.whySectionTitle}>{t('scorecard.whyRpmPpmTitle')}</Text>
                <View style={styles.row}>
                  <MutedText>{t('scorecard.whyRpm')}</MutedText>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    {money(canonicalCpm.revenuePerMile, { maximumFractionDigits: 2 })}
                  </Text>
                </View>
                <View style={[styles.row, styles.rowBorder]}>
                  <MutedText>{t('scorecard.whyPpm')}</MutedText>
                  <Text style={{ color: canonicalCpm.profitPerMile != null && canonicalCpm.profitPerMile >= 0 ? colors.green : colors.red, fontWeight: '600' }}>
                    {canonicalCpm.profitPerMile != null ? money(canonicalCpm.profitPerMile, { maximumFractionDigits: 2 }) : '—'}
                  </Text>
                </View>
              </>
            )}

            <Text style={styles.whySectionTitle}>{t('scorecard.whyBucketsTitle')}</Text>
            {canonicalCpm.buckets.map((b, i) => (
              <View key={b.category} style={[styles.row, i > 0 && styles.rowBorder]}>
                <MutedText>
                  {b.category} · {t(`scorecard.cpmType.${b.type}`)}
                </MutedText>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{money(b.amount)}</Text>
                  {statsQuery.data && statsQuery.data.totalMiles > 0 && (
                    <MutedText style={{ fontSize: typography.size.xs }}>
                      {money(b.amount / statsQuery.data.totalMiles, { maximumFractionDigits: 2 })}/mi
                    </MutedText>
                  )}
                </View>
              </View>
            ))}
            <View style={[styles.row, styles.rowBorder]}>
              <MutedText style={{ fontWeight: '700' }}>{t('scorecard.whyFixedTotal')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{money(canonicalCpm.fixedTotal)}</Text>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <MutedText style={{ fontWeight: '700' }}>{t('scorecard.whyVariableTotal')}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{money(canonicalCpm.variableTotal)}</Text>
            </View>

            {truckCostBasis && (
              <>
                <Text style={styles.whySectionTitle}>{t('scorecard.whyFixedSpreadTitle')}</Text>
                {!truckCostBasis.isConfigured ? (
                  <MutedText>{t('scorecard.whyFixedSpreadNotSet')}</MutedText>
                ) : (
                  <>
                    <View style={styles.row}>
                      <MutedText>{t('scorecard.whyOwnershipMode')}</MutedText>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        {t(`scorecard.ownershipMode.${activeTruck?.cost_basis_ownership_mode ?? 'paid'}`)}
                      </Text>
                    </View>
                    <View style={[styles.row, styles.rowBorder]}>
                      <MutedText>{t('scorecard.whyWeeklyTruckPayment')}</MutedText>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{money(truckCostBasis.weeklyTruckPayment)}</Text>
                    </View>
                    {truckCostBasis.weeklyWarranty > 0 && (
                      <View style={[styles.row, styles.rowBorder]}>
                        <MutedText>{t('scorecard.whyWeeklyWarranty')}</MutedText>
                        <Text style={{ color: colors.text, fontWeight: '600' }}>{money(truckCostBasis.weeklyWarranty)}</Text>
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            {canonicalCpm.excludedOneOffs.length > 0 && (
              <>
                <Text style={styles.whySectionTitle}>{t('scorecard.whyExcludedOneOffsTitle')}</Text>
                <MutedText>{t('scorecard.whyExcludedOneOffsNote')}</MutedText>
                {canonicalCpm.excludedOneOffs.map((item, i) => (
                  <View key={`${item.description}-${i}`} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <MutedText style={{ flex: 1 }}>{item.description}</MutedText>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{money(item.amount)}</Text>
                  </View>
                ))}
              </>
            )}

            {canonicalCpm.excludedTotal > 0 && (
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('scorecard.cpmExcludedTotal')}</MutedText>
                <MutedText>{money(canonicalCpm.excludedTotal)}</MutedText>
              </View>
            )}
          </>
        )}

        {settlementsMissingMiles.length > 0 && (
          <>
            <Text style={styles.whySectionTitle}>{t('scorecard.whyMissingMilesTitle')}</Text>
            {settlementsMissingMiles.map((s) => (
              <View key={s.id} style={[styles.row, styles.rowBorder, { alignItems: 'center' }]}>
                <MutedText style={{ flex: 1 }}>{s.week_ending}</MutedText>
                <View style={{ width: 90 }}>
                  <Field
                    keyboardType="numeric"
                    value={missingMilesDrafts[s.id] ?? ''}
                    onChangeText={(v) => setMissingMilesDrafts((prev) => ({ ...prev, [s.id]: v }))}
                    placeholder="0"
                  />
                </View>
                <SecondaryButton
                  title={t('common.save')}
                  onPress={() => handleSaveMissingMiles(s.id)}
                  loading={savingMissingMilesId === s.id}
                  disabled={!missingMilesDrafts[s.id]}
                />
              </View>
            ))}
          </>
        )}

        <SecondaryButton title={t('common.close')} onPress={() => setWhyOpen(false)} />
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
  whySectionTitle: {
    color: colors.text,
    fontSize: typography.size.sm,
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
