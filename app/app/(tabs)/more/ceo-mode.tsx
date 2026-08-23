import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useDocuments } from '@/src/data/documents';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useBenchmarks } from '@/src/data/benchmarks';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { calcTruckHealth, type HealthOverrides } from '@/src/truck/health';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { calcWeekOverWeekChange } from '@/src/stats/heroStats';
import { calcBusinessScore, type StarRating } from '@/src/stats/aiBusinessScore';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import {
  buildRecommendationCandidates,
  selectTopRecommendations,
  sumRecommendationImpact,
  type Recommendation,
} from '@/src/stats/aiRecommendations';
import { calcComplianceStatus } from '@/src/compliance/status';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, TappableCard, MutedText, LegalFootnote, Field, PrimaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { BrandWordmark } from '@/src/components/BrandWordmark';
import { ShareCardModal } from '@/src/components/shareCard/ShareCardModal';
import { colors, radii, spacing, typography } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';
import i18n from '@/src/i18n';

const RECOMMENDATION_ICON: Record<Recommendation['type'], string> = {
  fuelEfficiency: '⛽',
  needsReview: '🧾',
  taxReserveShortfall: '💰',
  maintenanceCatchUp: '🔧',
  complianceCatchUp: '📋',
};

function starString(rating: StarRating): string {
  return '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating);
}

// Session 9e-B7: per-recommendation-type copy, mirrors the Dashboard AI
// Insights card's per-insight-type sentence builder (index.tsx's
// AiInsightsCard) — same "compose from real computed numbers, never a
// generic placeholder" spirit.
function recommendationText(
  rec: Recommendation,
  t: (key: string, opts?: Record<string, unknown>) => string,
  money: (n: number) => string
): string {
  switch (rec.type) {
    case 'fuelEfficiency':
      return t('ceoMode.recommendations.fuelEfficiency', {
        amount: money(rec.estMonthlyImpact ?? 0),
        pct: (rec.detail.pctPointsAboveRange ?? 0).toFixed(1),
      });
    case 'needsReview':
      return t('ceoMode.recommendations.needsReview', { count: rec.detail.count, amount: money(rec.estMonthlyImpact ?? 0) });
    case 'taxReserveShortfall':
      return t('ceoMode.recommendations.taxReserveShortfall', { amount: money(rec.estMonthlyImpact ?? 0) });
    case 'maintenanceCatchUp':
      return t('ceoMode.recommendations.maintenanceCatchUp', { count: rec.detail.count });
    case 'complianceCatchUp':
      return t('ceoMode.recommendations.complianceCatchUp', { count: rec.detail.count });
  }
}

function recommendationRoute(rec: Recommendation): '/(tabs)/more/profit-analysis' | '/(tabs)/deductions' | '/(tabs)/more/tax-estimator' | '/(tabs)/truck-health' | '/(tabs)/more/compliance' {
  switch (rec.type) {
    case 'fuelEfficiency':
      return '/(tabs)/more/profit-analysis';
    case 'needsReview':
      return '/(tabs)/deductions';
    case 'taxReserveShortfall':
      return '/(tabs)/more/tax-estimator';
    case 'maintenanceCatchUp':
      return '/(tabs)/truck-health';
    case 'complianceCatchUp':
      return '/(tabs)/more/compliance';
  }
}

// CEO Mode — Daily/Weekly Briefing v1 (PROMPTS.md Session 9b item 10,
// CLAUDE.md invariant #22 — composed ONLY from this account's own data,
// no live external feeds). Follows the exact same pattern Profit
// Analysis (Session 9a) already established: build a rich, data-filled
// prompt client-side, send it as one 'user' message to the generic
// ai-advisor Edge Function (no server-side changes needed), render the
// reply with the standard disclaimer footer.
export default function CeoMode() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const moneyRounded = (n: number) => money(n, { maximumFractionDigits: 0 });
  const router = useRouter();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const documentsQuery = useDocuments();
  const complianceQuery = useComplianceItems();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const fuelQuery = useFuelPurchases();
  const taxQuery = useTaxEstimate();
  const benchmarksQuery = useBenchmarks();
  const { activeTruckId } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const intervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);
  // Fleet-wide (not truck-scoped like recordsQuery above, which is only
  // for Truck Health) — matches Home's/Scorecard's/Profit Analysis' own
  // unscoped true-profit inputs so this screen's "This Week Profit"
  // figure can never disagree with theirs for a multi-truck fleet.
  const allMaintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();

  const [goalInput, setGoalInput] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);

  const loadingData =
    settlementsQuery.isLoading || deductionsQuery.isLoading || documentsQuery.isLoading || complianceQuery.isLoading || profileQuery.isLoading;

  // TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31): this used to be
  // buildWeeklyTrend()'s bare settlement `.net` (net PAY only) — fed
  // straight into the AI Coach briefing prompt, the Share card, the
  // thisWeekProfit dashboard tile, and Goal Progress, all silently
  // ignoring out-of-pocket expenses. Now the same canonical
  // src/stats/trueProfit.ts figure every other "profit" surface uses.
  const weeklyTrend = useMemo(
    () =>
      buildWeeklyTrueProfitTrend(
        settlementsQuery.data ?? [],
        deductionsQuery.data ?? [],
        fuelQuery.data ?? [],
        allMaintenanceQuery.data ?? [],
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, deductionsQuery.data, fuelQuery.data, allMaintenanceQuery.data, tollsQuery.data]
  );
  const latestWeek = weeklyTrend[weeklyTrend.length - 1] ?? null;

  const weeklyGoal = profileQuery.data?.weekly_goal ?? null;
  const goalProgressPct = weeklyGoal && weeklyGoal > 0 && latestWeek ? (latestWeek.net / weeklyGoal) * 100 : null;

  // NEEDS-REVIEW count (CLAUDE.md invariant #14): deduction descriptions
  // get prefixed "NEEDS REVIEW: " for low-confidence/docType:'other'
  // extractions — counting that prefix directly is simpler and just as
  // accurate as re-deriving confidence, since the prefix IS the flag.
  const needsReviewCount = useMemo(
    () => (deductionsQuery.data ?? []).filter((d) => (d.description ?? '').startsWith('NEEDS REVIEW:')).length,
    [deductionsQuery.data]
  );
  const needsReviewEstValue = useMemo(
    () =>
      (deductionsQuery.data ?? [])
        .filter((d) => (d.description ?? '').startsWith('NEEDS REVIEW:'))
        .reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
    [deductionsQuery.data]
  );

  // Tax opportunity hint: archived documents that never resolved past the
  // generic 'other' docType (CLAUDE.md invariant #14) — the same
  // population needs-review deductions come from, but this also counts
  // documents that were archived without becoming a deduction at all.
  const unresolvedOtherDocs = useMemo(() => (documentsQuery.data ?? []).filter((d) => d.doc_type === 'other').length, [documentsQuery.data]);

  const complianceDueSoonCount = useMemo(
    () => (complianceQuery.data ?? []).filter((item) => calcComplianceStatus(item.due_date).urgency !== 'ok').length,
    [complianceQuery.data]
  );

  // Maintenance orange/red count, scoped to the active truck — same
  // truck-scoping convention as every other Dashboard stat (CLAUDE.md
  // invariant #7: a single-truck account is just the n=1 presentation of
  // the same fleet-wide logic; a fleet-wide CEO briefing still reads
  // through whichever truck is currently active, same as the Dashboard).
  const truck = useMemo(() => trucksQuery.data?.find((tr) => tr.id === activeTruckId) ?? null, [trucksQuery.data, activeTruckId]);
  const truckHealthResults = useMemo(() => {
    if (!truck || !intervalsQuery.data) return [];
    const intervals = intervalsQuery.data.map((iv) => ({
      category: iv.category,
      trackingMode: iv.tracking_mode,
      intervalMiles: iv.interval_miles,
      intervalHours: iv.interval_hours,
      bundledWithCategory: iv.bundled_with_category,
      enabled: iv.enabled,
    }));
    const records = (recordsQuery.data ?? []).map((r) => ({
      serviceType: r.service_type,
      odometer: r.odometer,
      engineHours: r.engine_hours,
      serviceDate: r.service_date,
    }));
    const overrides = (healthConfigQuery.data?.overrides ?? {}) as HealthOverrides;
    return calcTruckHealth(intervals, records, truck.current_odometer ?? 0, truck.apu_hours ?? 0, overrides);
  }, [truck, intervalsQuery.data, recordsQuery.data, healthConfigQuery.data]);
  const maintenanceAlertCount = useMemo(
    () => truckHealthResults.filter((r) => r.status === 'due_soon' || r.status === 'overdue').length,
    [truckHealthResults]
  );

  // AI Business Score (Session 9d item 14) — fuelPerMile mirrors
  // scorecard.ts's own fuelCost/totalMiles definition; taxReserveRatio
  // mirrors the Dashboard Fleet Health Score's business_balance vs.
  // upcoming quarterlyPayment; cashFlowDirection is this week vs. last
  // week net, the same calcWeekOverWeekChange the Dashboard Hero Card uses.
  const totalMiles = useMemo(
    () => (settlementsQuery.data ?? []).reduce((sum, s) => sum + Number(s.miles ?? 0), 0),
    [settlementsQuery.data]
  );
  const fuelCost = useMemo(
    () => (fuelQuery.data ?? []).reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0),
    [fuelQuery.data]
  );
  const previousWeek = weeklyTrend[weeklyTrend.length - 2] ?? null;
  const businessScore = useMemo(
    () =>
      calcBusinessScore({
        fuelPerMile: totalMiles > 0 ? fuelCost / totalMiles : null,
        taxReserveRatio:
          taxQuery.data && taxQuery.data.estimate.quarterlyPayment > 0
            ? (profileQuery.data?.business_balance ?? 0) / taxQuery.data.estimate.quarterlyPayment
            : null,
        truckHealthStatuses: truckHealthResults.map((r) => r.status),
        cashFlowDirection: calcWeekOverWeekChange(latestWeek?.net ?? 0, previousWeek?.net).direction,
      }),
    [totalMiles, fuelCost, taxQuery.data, profileQuery.data, truckHealthResults, latestWeek, previousWeek]
  );

  // AI Coach's top 3 recommendations (Session 9e-B7) — profitAnalysisRollup
  // mirrors the Dashboard's own 30-day fuelPctOfRevenue/monthlyRevenue
  // wiring (index.tsx), fuelBenchmark reads the same published benchmarks
  // row (CLAUDE.md invariant #22), taxReserveShortfall is a real computed
  // dollar gap (quarterlyPayment - business_balance), never a fabricated
  // estimate (src/stats/aiRecommendations.ts).
  const profitAnalysisRollup = useMemo(
    () =>
      buildProfitAnalysis(
        settlementsQuery.data ?? [],
        fuelQuery.data ?? [],
        allMaintenanceQuery.data ?? [],
        deductionsQuery.data ?? [],
        30,
        new Date(),
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, fuelQuery.data, allMaintenanceQuery.data, deductionsQuery.data, tollsQuery.data]
  );
  const fuelBenchmark = useMemo(
    () => (benchmarksQuery.data ?? []).find((b) => b.metric === 'fuel_pct_of_revenue') ?? null,
    [benchmarksQuery.data]
  );
  const taxReserveShortfall =
    taxQuery.data && taxQuery.data.estimate.quarterlyPayment > 0
      ? Math.max(0, taxQuery.data.estimate.quarterlyPayment - (profileQuery.data?.business_balance ?? 0))
      : null;
  const recommendations = useMemo(() => {
    const candidates = buildRecommendationCandidates({
      fuelPctOfRevenue: profitAnalysisRollup.fuelPctOfRevenue,
      fuelBenchmarkHigh: fuelBenchmark?.high ?? null,
      monthlyRevenue: profitAnalysisRollup.revenue,
      needsReviewCount,
      needsReviewEstValue,
      taxReserveShortfall,
      maintenanceAlertCount,
      complianceDueSoonCount,
    });
    return selectTopRecommendations(candidates, 3);
  }, [profitAnalysisRollup, fuelBenchmark, needsReviewCount, needsReviewEstValue, taxReserveShortfall, maintenanceAlertCount, complianceDueSoonCount]);
  const recommendationsTotalImpact = useMemo(() => sumRecommendationImpact(recommendations), [recommendations]);

  async function handleSaveGoal() {
    const value = Number(goalInput);
    if (!value || value <= 0) return;
    setGoalSaving(true);
    try {
      await updateProfile.mutateAsync({ weekly_goal: value });
    } catch (err) {
      Alert.alert(t('ceoMode.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setGoalSaving(false);
    }
  }

  async function handleGetBriefing() {
    setLoading(true);
    setError(null);
    setBriefing(null);
    try {
      const parts = [
        'Give me my weekly business briefing as a friendly, encouraging CEO coach would.',
        latestWeek ? `This week's revenue: ${money(latestWeek.gross)}, profit: ${money(latestWeek.net)}.` : 'No settlements recorded yet this week.',
        goalProgressPct != null ? `Weekly profit goal: ${money(weeklyGoal ?? 0)} — currently at ${goalProgressPct.toFixed(0)}% of goal.` : '',
        needsReviewCount > 0 ? `${needsReviewCount} receipt(s) flagged NEEDS REVIEW and waiting on a decision.` : 'No receipts waiting on review.',
        maintenanceAlertCount > 0 ? `${maintenanceAlertCount} maintenance item(s) due soon or overdue on the active truck.` : 'No maintenance items due soon.',
        complianceDueSoonCount > 0 ? `${complianceDueSoonCount} compliance item(s) (DOT/IRP/insurance/etc.) due soon or overdue.` : 'No compliance items due soon.',
        unresolvedOtherDocs > 0 ? `${unresolvedOtherDocs} imported document(s) never got sorted into a real category — possible missed deductions.` : '',
        'Give 2-4 short, specific, encouraging observations and next actions. Keep it upbeat but honest.',
      ].filter(Boolean);
      const result = await callAiAdvisor([{ role: 'user', content: parts.join(' ') }], i18n.language);
      if (result.error) {
        setError(result.error.message || t('ceoMode.briefingFailed'));
      } else {
        setBriefing(result.data ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ceoMode.briefingFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* BRAND REFRESH (owner decision 2026-07-30): AI Coach is the one
            screen the "Your AI Business Coach" tagline is most directly
            about — the logo+name+tagline header block appears here too,
            not just the app-wide top bar/sidebar. */}
        <View style={{ marginBottom: spacing.md }}>
          <BrandWordmark fontSize={16} showTagline />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <ScreenTitle>{t('ceoMode.title')}</ScreenTitle>
            <MutedText>{t('ceoMode.subtitle')}</MutedText>
          </View>
          {!loadingData && (
            <Pressable onPress={() => setShareOpen(true)} hitSlop={8} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.accent, fontSize: typography.size.sm, fontWeight: '700' }}>
                📤 {t('shareProfit.share')}
              </Text>
            </Pressable>
          )}
        </View>

        {loadingData ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {recommendations.length > 0 && (
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.xs }}>
                  {recommendationsTotalImpact > 0
                    ? t('ceoMode.recommendations.headerTitle', { amount: moneyRounded(recommendationsTotalImpact) })
                    : t('ceoMode.recommendations.headerTitleZero')}
                </Text>
                <MutedText style={{ marginBottom: spacing.sm }}>{t('ceoMode.recommendations.subtitle')}</MutedText>
                {recommendations.map((rec) => (
                  <TappableCard key={rec.type} onPress={() => router.push(recommendationRoute(rec))}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text style={{ fontSize: 20 }}>{RECOMMENDATION_ICON[rec.type]}</Text>
                      <Text style={{ color: colors.text, flex: 1 }}>{recommendationText(rec, t, moneyRounded)}</Text>
                    </View>
                  </TappableCard>
                ))}
              </Card>
            )}

            <Card>
              <View style={styles.statRow}>
                <View style={styles.statCell}>
                  <MutedText>{t('ceoMode.thisWeekRevenue')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{latestWeek ? money(latestWeek.gross) : '—'}</Text>
                </View>
                <View style={styles.statCell}>
                  <MutedText>{t('ceoMode.thisWeekProfit')}</MutedText>
                  <Text style={[styles.statValue, { color: colors.green }]}>{latestWeek ? money(latestWeek.net) : '—'}</Text>
                </View>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>{t('ceoMode.businessScoreTitle')}</Text>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ color: colors.text, fontSize: 32, fontWeight: '800' }}>{businessScore.score}</Text>
                <Pressable onPress={() => setScoreInfoOpen(true)} hitSlop={8}>
                  <Text style={{ color: colors.muted, fontSize: typography.size.md }}>ⓘ</Text>
                </Pressable>
              </View>
              <View style={[styles.row]}>
                <MutedText>{t('ceoMode.starFuelEfficiency')}</MutedText>
                <Text style={{ color: colors.orange }}>{starString(businessScore.stars.fuelEfficiency)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('ceoMode.starTaxOptimization')}</MutedText>
                <Text style={{ color: colors.orange }}>{starString(businessScore.stars.taxOptimization)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('ceoMode.starMaintenance')}</MutedText>
                <Text style={{ color: colors.orange }}>{starString(businessScore.stars.maintenance)}</Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <MutedText>{t('ceoMode.starCashFlow')}</MutedText>
                <Text style={{ color: colors.orange }}>{starString(businessScore.stars.cashFlow)}</Text>
              </View>
            </Card>

            <ModalSheet visible={scoreInfoOpen} onClose={() => setScoreInfoOpen(false)}>
              <SheetTitle>{t('ceoMode.scoreInfoTitle')}</SheetTitle>
              <MutedText style={{ marginBottom: spacing.sm }}>{t('ceoMode.scoreInfoBody')}</MutedText>
              <MutedText style={{ marginBottom: spacing.xs }}>• {t('ceoMode.scoreInfoFuel')}</MutedText>
              <MutedText style={{ marginBottom: spacing.xs }}>• {t('ceoMode.scoreInfoTax')}</MutedText>
              <MutedText style={{ marginBottom: spacing.xs }}>• {t('ceoMode.scoreInfoMaintenance')}</MutedText>
              <MutedText style={{ marginBottom: spacing.sm }}>• {t('ceoMode.scoreInfoCashFlow')}</MutedText>
              <LegalFootnote />
            </ModalSheet>

            {weeklyGoal == null ? (
              // First-open goal prompt (device feedback round 2, owner
              // decision 2026-07-13): a null weekly_goal blocks the
              // briefing itself, not just its progress-% line — friendlier,
              // more prominent copy than the old inline "no goal set" note,
              // and the briefing section below doesn't render at all until
              // a goal is saved.
              <>
                <Text style={styles.sectionTitle}>{t('ceoMode.goalPromptTitle')}</Text>
                <Card>
                  <MutedText>{t('ceoMode.goalPromptBody')}</MutedText>
                  <Field
                    keyboardType="numeric"
                    value={goalInput}
                    onChangeText={setGoalInput}
                    placeholder={t('ceoMode.goalPlaceholder')}
                    style={{ marginTop: spacing.sm }}
                  />
                  <PrimaryButton title={t('ceoMode.saveGoal')} onPress={handleSaveGoal} loading={goalSaving} disabled={!goalInput} />
                </Card>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>{t('ceoMode.weeklyGoalTitle')}</Text>
                <Card>
                  <MutedText>{t('ceoMode.currentGoal', { amount: money(weeklyGoal) })}</MutedText>
                  {goalProgressPct != null && (
                    <Text style={{ color: goalProgressPct >= 100 ? colors.green : colors.text, fontWeight: '700', fontSize: typography.size.lg, marginTop: 2 }}>
                      {goalProgressPct.toFixed(0)}% {t('ceoMode.ofGoal')}
                    </Text>
                  )}
                  <Field keyboardType="numeric" value={goalInput} onChangeText={setGoalInput} placeholder={t('ceoMode.goalPlaceholder')} />
                  <PrimaryButton title={t('ceoMode.saveGoal')} onPress={handleSaveGoal} loading={goalSaving} disabled={!goalInput} />
                </Card>

                <Text style={styles.sectionTitle}>{t('ceoMode.statusTitle')}</Text>
                <Card>
                  <View style={styles.row}>
                    <MutedText>{t('ceoMode.needsReview')}</MutedText>
                    <Text style={{ color: needsReviewCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>{number(needsReviewCount)}</Text>
                  </View>
                  <View style={[styles.row, styles.rowBorder]}>
                    <MutedText>{t('ceoMode.maintenanceDue')}</MutedText>
                    <Text style={{ color: maintenanceAlertCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>{number(maintenanceAlertCount)}</Text>
                  </View>
                  <View style={[styles.row, styles.rowBorder]}>
                    <MutedText>{t('ceoMode.complianceDue')}</MutedText>
                    <Text style={{ color: complianceDueSoonCount > 0 ? colors.orange : colors.text, fontWeight: '700' }}>{number(complianceDueSoonCount)}</Text>
                  </View>
                </Card>

                <Text style={styles.sectionTitle}>{t('ceoMode.briefingTitle')}</Text>
                <Card>
                  <PrimaryButton title={`🐺 ${t('ceoMode.getBriefing')}`} onPress={handleGetBriefing} loading={loading} />
                  {briefing && (
                    <>
                      <Text style={{ color: colors.text, marginTop: spacing.sm, lineHeight: 20 }}>{briefing}</Text>
                      <MutedText style={{ marginTop: spacing.xs }}>{t('profitAnalysis.aiFooter')}</MutedText>
                    </>
                  )}
                  {error && <MutedText style={{ color: colors.red, marginTop: spacing.sm }}>{error}</MutedText>}
                </Card>
              </>
            )}
            <LegalFootnote />
          </>
        )}
      </ScrollView>

      {!loadingData && (
        <ShareCardModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          title={t('ceoMode.title')}
          caption={t('shareProfit.captionTemplate', { weekSummary: t('ceoMode.businessScoreTitle'), brand: BRAND_NAME })}
          renderCard={() => (
            <View style={shareStyles.shareCard}>
              {profileQuery.data?.company_name?.trim() && (
                <Text style={shareStyles.shareCompanyName}>{profileQuery.data.company_name.trim()}</Text>
              )}
              <Text style={shareStyles.shareCardTitle}>{t('ceoMode.businessScoreTitle')}</Text>
              <Text style={{ color: colors.text, fontSize: 48, fontWeight: '800' }}>{businessScore.score}</Text>
              <View style={shareStyles.shareKpiRow}>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('ceoMode.thisWeekRevenue')}</MutedText>
                  <Text style={{ color: colors.green, fontWeight: '700' }}>{latestWeek ? money(latestWeek.gross) : '—'}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <MutedText>{t('ceoMode.thisWeekProfit')}</MutedText>
                  <Text style={{ color: colors.green, fontWeight: '700' }}>{latestWeek ? money(latestWeek.net) : '—'}</Text>
                </View>
              </View>
              <View style={shareStyles.shareBrandFooter}>
                <BrandWordmark fontSize={16} />
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const shareStyles = {
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
};

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  statRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
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
