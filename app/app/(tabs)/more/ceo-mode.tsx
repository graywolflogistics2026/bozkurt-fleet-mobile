import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useDocuments } from '@/src/data/documents';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useTrucksList } from '@/src/data/trucks';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useMaintenanceIntervals } from '@/src/data/maintenanceIntervals';
import { useTruckHealthConfig } from '@/src/data/truckHealthConfig';
import { calcTruckHealth, type HealthOverrides } from '@/src/truck/health';
import { buildWeeklyTrend } from '@/src/stats/cashFlowTrend';
import { calcWeekOverWeekChange } from '@/src/stats/heroStats';
import { calcBusinessScore, type StarRating } from '@/src/stats/aiBusinessScore';
import { calcComplianceStatus } from '@/src/compliance/status';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, LegalFootnote, Field, PrimaryButton, ModalSheet, SheetTitle } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import i18n from '@/src/i18n';

function starString(rating: StarRating): string {
  return '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating);
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
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const documentsQuery = useDocuments();
  const complianceQuery = useComplianceItems();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const fuelQuery = useFuelPurchases();
  const taxQuery = useTaxEstimate();
  const { activeTruckId } = useActiveTruck();
  const trucksQuery = useTrucksList();
  const recordsQuery = useMaintenanceRecords(activeTruckId ? { truck_id: activeTruckId } : undefined);
  const intervalsQuery = useMaintenanceIntervals(activeTruckId);
  const healthConfigQuery = useTruckHealthConfig(activeTruckId);

  const [goalInput, setGoalInput] = useState('');
  const [goalSaving, setGoalSaving] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);

  const loadingData =
    settlementsQuery.isLoading || deductionsQuery.isLoading || documentsQuery.isLoading || complianceQuery.isLoading || profileQuery.isLoading;

  const weeklyTrend = useMemo(() => buildWeeklyTrend(settlementsQuery.data ?? []), [settlementsQuery.data]);
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
        <ScreenTitle>{t('ceoMode.title')}</ScreenTitle>
        <MutedText>{t('ceoMode.subtitle')}</MutedText>

        {loadingData ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
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
