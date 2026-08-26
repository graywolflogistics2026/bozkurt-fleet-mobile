import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useSettlements } from '@/src/data/settlements';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useDeductions } from '@/src/data/deductions';
import { useLoads } from '@/src/data/loads';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import i18n from '@/src/i18n';
import { calcMiles, resolveMilesTotal } from '@/src/stats/miles';
import { calcCanonicalCpm, carrierWithholdsLoanPayment } from '@/src/stats/cpm';
import { calcTruckCostBasisWeekly } from '@/src/stats/truckCostBasis';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { shouldGenerateWeeklyReview, buildWeeklyReviewPrompt } from '@/src/stats/weeklyReview';
import { calcGoalProgress, calcGoalStreak, suggestGoalAdjustment } from '@/src/stats/goalProgress';
import { buildPeriodicCoachNudgeCandidates, type CoachNudgeCandidate, type CoachNudgeTopic } from '@/src/alerts/periodicCoachNudges';
import { selectNudgesToShow, recordNudgesShown, ONE_MONTH_MS, type NudgeState } from '@/src/alerts/nudgeFrequency';

// AI COACH — PROACTIVE, PERIODIC COACHING (owner decision 2026-08-24, NEXT
// PASS item E). Reuses the SAME profiles.nudge_state column D3 already
// established (disjoint CoachNudgeTopic keys, so it can never collide with
// D's missing-data nudges) with a longer, monthly cooldown per topic
// (ONE_MONTH_MS — "never repeat the same one within a month").
//
// DELIVERY SCOPE DECISION: item E4 says delivery is "phrased through
// ai-advisor... cached so it costs one call per week per user at most."
// That single-call-per-week cap is spent entirely on the weekly settlement
// review (item E1) — a genuinely nuanced 2-3 sentence composition that
// benefits from the model. The periodic nudges (item E2) are short,
// single-fact observations already fully specified by real numbers (same
// shape as item D2's missing-data nudges), so they're delivered as plain
// i18n templates instead of a second AI call — this is what keeps the
// total AI usage at the spec's own explicit "one call per week" ceiling
// rather than doubling it.
export function useProactiveCoach() {
  const { session } = useAuth();
  const { activeTruck } = useActiveTruck();
  const settlementsQuery = useSettlements();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const deductionsQuery = useDeductions();
  const loadsQuery = useLoads();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const taxQuery = useTaxEstimate();
  // CPM FORMULA DIVERGENCE (P1 fix, FULL SYSTEM AUDIT) — fleet-wide stats,
  // needed to compute the SAME canonical CPM figure Scorecard shows (see
  // the latestCpm computation below for the full reasoning).
  const fleetStatsQuery = useFleetStats(null);

  const isLoading =
    settlementsQuery.isLoading || fuelQuery.isLoading || deductionsQuery.isLoading || profileQuery.isLoading || taxQuery.isLoading;

  const sortedSettlements = useMemo(
    () => [...(settlementsQuery.data ?? [])].sort((a, b) => a.week_ending.localeCompare(b.week_ending)),
    [settlementsQuery.data]
  );
  const latestSettlement = sortedSettlements[sortedSettlements.length - 1] ?? null;
  // The 4 settlement weeks immediately before the latest one — same
  // trailing-4-week convention as cashFlowForecast.ts's own trailing
  // averages elsewhere in this app.
  const trailingSettlements = sortedSettlements.slice(-5, -1);

  const weeklyTrend = useMemo(
    () =>
      buildWeeklyTrueProfitTrend(
        settlementsQuery.data ?? [],
        deductionsQuery.data ?? [],
        fuelQuery.data ?? [],
        maintenanceQuery.data ?? [],
        tollsQuery.data ?? []
      ),
    [settlementsQuery.data, deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]
  );

  function rpmFor(s: { gross: number; miles: number } | null): number | null {
    return s && s.miles > 0 ? s.gross / s.miles : null;
  }
  const latestRpm = rpmFor(latestSettlement);
  const trailingRpms = trailingSettlements.map(rpmFor).filter((n): n is number => n != null);
  const trailingAvgRpm = trailingRpms.length > 0 ? trailingRpms.reduce((a, b) => a + b, 0) / trailingRpms.length : null;

  function deadheadFor(s: { id: string; week_ending: string; truck_id: string | null; miles: number } | null): number | null {
    if (!s) return null;
    const loadsForWeek = (loadsQuery.data ?? []).filter((l) => l.settlement_id === s.id);
    return calcMiles([s], loadsForWeek).deadheadPct;
  }
  const latestDeadheadPct = deadheadFor(latestSettlement);
  const trailingDeadheadValues = trailingSettlements.map(deadheadFor).filter((n): n is number => n != null);
  const trailingAvgDeadheadPct =
    trailingDeadheadValues.length > 0 ? trailingDeadheadValues.reduce((a, b) => a + b, 0) / trailingDeadheadValues.length : null;

  function fuelPctFor(s: { id: string; gross: number } | null): number | null {
    if (!s || s.gross <= 0) return null;
    const fuelCost = (fuelQuery.data ?? [])
      .filter((f) => f.settlement_id === s.id)
      .reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);
    return fuelCost > 0 ? fuelCost / s.gross : null;
  }
  const latestFuelPct = fuelPctFor(latestSettlement);
  const trailingFuelPcts = trailingSettlements.map(fuelPctFor).filter((n): n is number => n != null);
  const trailingAvgFuelPct = trailingFuelPcts.length > 0 ? trailingFuelPcts.reduce((a, b) => a + b, 0) / trailingFuelPcts.length : null;

  const latestWeekTrend = weeklyTrend.find((w) => w.weekEnding === latestSettlement?.week_ending) ?? null;

  // CPM FORMULA DIVERGENCE (P1 fix, FULL SYSTEM AUDIT) — this used to be a
  // THIRD, ad-hoc approximation, (thisWeek.gross - thisWeek.trueProfitNet) /
  // thisWeek.miles — neither the legacy calcCpm() nor Scorecard's own
  // calcCanonicalCpm(). Compared directly against calcCanonicalCpm() and
  // found two real, opposite-direction divergences: (1) a week containing
  // a major one-off repair/vehicle purchase spiked the ad-hoc figure
  // artificially high (true-profit's own weekly net DOES subtract that
  // one-off dollar-for-dollar in the week it happened), which
  // calcCanonicalCpm() deliberately excludes from the per-mile figure for
  // exactly this reason — a real false-positive "CPM above RPM" nudge
  // risk; (2) the ad-hoc formula never added the truck's own fixed cost
  // basis (loan/lease payment, warranty) unless it happened to already be
  // a settlement-withheld deduction row, so it could UNDER-count CPM for
  // an owner with a real, non-withheld loan payment — a false-negative
  // risk in the other direction. Fixed by computing the SAME
  // calcCanonicalCpm() figure Scorecard shows, over the SAME account-wide
  // scope (not a single week — Scorecard's own CPM is already an
  // all-account aggregate, so a per-week canonical figure would be a NEW,
  // unproven calculation this codebase has never needed before; reusing
  // the identical inputs/scope Scorecard already validates is the lower-
  // risk "unify on the canonical one" reading) — this is now the literal
  // SAME number a user would see by tapping through to Scorecard, never a
  // second figure that could disagree with it. Compared against
  // trailingAvgRpm (falling back to latestRpm only when there isn't yet
  // enough history for a trailing average) rather than latestRpm alone,
  // since pairing an account-wide cost figure against a single week's
  // revenue rate would just trade one apples-to-oranges comparison for
  // another — a trailing average is the more honest "typical" pairing.
  const carrierWithholdsLoan = useMemo(() => carrierWithholdsLoanPayment(deductionsQuery.data ?? []), [deductionsQuery.data]);
  const truckCostBasis = useMemo(
    () => (activeTruck ? calcTruckCostBasisWeekly(activeTruck, carrierWithholdsLoan) : null),
    [activeTruck, carrierWithholdsLoan]
  );
  const truckFixedCostTotal = useMemo(
    () => (truckCostBasis ? truckCostBasis.weeklyFixedTotal * (fleetStatsQuery.data?.settlementCount ?? 0) : 0),
    [truckCostBasis, fleetStatsQuery.data]
  );
  const canonicalMilesTotal = fleetStatsQuery.data
    ? resolveMilesTotal({ totalMiles: fleetStatsQuery.data.totalMiles }, activeTruck?.manual_total_miles_override).totalMiles
    : null;
  const latestCpm = useMemo(() => {
    if (!fleetStatsQuery.data || !canonicalMilesTotal) return null;
    return calcCanonicalCpm(
      fleetStatsQuery.data.grossRevenue,
      canonicalMilesTotal,
      deductionsQuery.data ?? [],
      fuelQuery.data ?? [],
      maintenanceQuery.data ?? [],
      tollsQuery.data ?? [],
      truckFixedCostTotal
    ).costPerMile;
  }, [fleetStatsQuery.data, canonicalMilesTotal, deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data, truckFixedCostTotal]);
  const cpmComparisonRpm = trailingAvgRpm ?? latestRpm;

  const quarterlyDeadline = taxQuery.data ? nextQuarterlyDeadline(taxQuery.data.taxYearData.quarterly_deadlines) : null;

  // ---- WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 3) ----
  const weeklyGoal = profileQuery.data?.weekly_goal ?? null;
  const latestWeekLoads = latestSettlement ? (loadsQuery.data ?? []).filter((l) => l.settlement_id === latestSettlement.id) : [];
  const avgRevenuePerLoad =
    latestWeekLoads.length > 0 ? latestWeekLoads.reduce((sum, l) => sum + Number(l.revenue ?? 0), 0) / latestWeekLoads.length : null;
  const goalProgress = calcGoalProgress(weeklyGoal, latestWeekTrend?.net ?? null, latestRpm, avgRevenuePerLoad);
  const goalStreak = calcGoalStreak(
    weeklyTrend.map((w) => ({ weekEnding: w.weekEnding, net: w.net })),
    weeklyGoal
  );
  const goalAdjustmentSuggestion = suggestGoalAdjustment(goalStreak);
  // "the RPM needed versus what they're getting" (PART 3 item 2) — if this
  // week fell short, what RPM would the SAME miles driven have needed to
  // average to close the gap: actual RPM + (gap $ / miles driven).
  const goalNeededRpm =
    goalProgress && !goalProgress.metGoal && latestSettlement && latestSettlement.miles > 0 && latestRpm != null
      ? latestRpm + goalProgress.gapDollars / latestSettlement.miles
      : null;
  // "which cost category explains a shortfall" — the single largest
  // out-of-pocket/withheld deduction category dated this settlement week.
  const goalTopCostCategory = useMemo(() => {
    if (!latestSettlement) return null;
    const byCategory = new Map<string, number>();
    for (const d of deductionsQuery.data ?? []) {
      if (d.ded_date !== latestSettlement.week_ending) continue;
      const cat = d.category ?? 'Other';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(d.amount ?? 0));
    }
    let top: { category: string; amount: number } | null = null;
    for (const [category, amount] of byCategory) {
      if (!top || amount > top.amount) top = { category, amount };
    }
    return top;
  }, [deductionsQuery.data, latestSettlement]);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const hasOutOfPocketThisMonth = (deductionsQuery.data ?? []).some((d) => d.source !== 'settlement' && d.ded_date && d.ded_date >= monthStart);
  const monthLabel = now.toLocaleDateString(i18n.language, { month: 'long' });

  // ---- E2: periodic coach nudges (template-based, monthly cooldown) ----
  const coachNudgeCandidates = useMemo<CoachNudgeCandidate[]>(
    () =>
      buildPeriodicCoachNudgeCandidates({
        deductions: deductionsQuery.data ?? [],
        quarterlyDeadlineDaysUntil: quarterlyDeadline?.daysUntil ?? null,
        hasOutOfPocketThisMonth,
        monthLabel,
        thisWeekFuelPct: latestFuelPct,
        trailingAvgFuelPct,
        thisWeekDeadheadPct: latestDeadheadPct,
        trailingAvgDeadheadPct,
        cpm: latestCpm,
        rpm: cpmComparisonRpm,
        now,
        goalStreak: weeklyGoal != null ? goalStreak : undefined,
        goalNeededRpm: weeklyGoal != null ? goalNeededRpm : undefined,
        goalShortByDollars: goalProgress ? goalProgress.gapDollars : undefined,
        goalTopCostCategory: goalTopCostCategory?.category ?? null,
        goalTopCostCategoryAmount: goalTopCostCategory?.amount ?? 0,
        goalAdjustmentSuggestion,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      deductionsQuery.data,
      quarterlyDeadline?.daysUntil,
      hasOutOfPocketThisMonth,
      monthLabel,
      latestFuelPct,
      trailingAvgFuelPct,
      latestDeadheadPct,
      trailingAvgDeadheadPct,
      latestCpm,
      cpmComparisonRpm,
      weeklyGoal,
      goalStreak,
      goalNeededRpm,
      goalProgress,
      goalTopCostCategory,
      goalAdjustmentSuggestion,
    ]
  );

  const coachNudgeState: NudgeState<CoachNudgeTopic> = (profileQuery.data?.nudge_state as NudgeState<CoachNudgeTopic>) ?? {};
  const accountCreatedAt = session?.user?.created_at ?? null;
  // Only ONE periodic coach nudge at a time (it's a rotating voice inside
  // the AI Coach block, not a checklist) — the frequency engine's own
  // per-day cap of 2 would otherwise allow two; slice(0,1) keeps this
  // surface deliberately quieter than the Alerts screen's own D-family list.
  const visibleCoachNudges = useMemo(
    () => selectNudgesToShow(coachNudgeCandidates, coachNudgeState, accountCreatedAt, now, ONE_MONTH_MS).slice(0, 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coachNudgeCandidates, coachNudgeState, accountCreatedAt]
  );
  const periodicNudge: CoachNudgeCandidate | null = visibleCoachNudges[0] ?? null;

  const recordedCoachKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (visibleCoachNudges.length === 0 || !profileQuery.data) return;
    const key = visibleCoachNudges
      .map((n) => n.topic)
      .sort()
      .join(',');
    if (recordedCoachKeyRef.current === key) return;
    recordedCoachKeyRef.current = key;
    const nextState = recordNudgesShown(coachNudgeState, visibleCoachNudges.map((n) => n.topic), now);
    // NUDGE/WEEKLY-REVIEW WRITES ARE FIRE-AND-FORGET (P1 fix, FULL SYSTEM
    // AUDIT) — same bug/fix as useAlertsData()'s own recordNudgesShown
    // effect: without onError, a failed write silently disabled the
    // monthly frequency cap (the ref was already set, so this session
    // never retries, and the DB never actually reflects "shown").
    updateProfile.mutate(
      { nudge_state: nextState },
      {
        onError: (err) => {
          console.error('[useProactiveCoach] failed to record coach nudge shown — frequency capping may be affected:', err);
          recordedCoachKeyRef.current = null;
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCoachNudges, profileQuery.data]);

  // ---- E1: weekly settlement review (ai-advisor, cached) ----
  const [generating, setGenerating] = useState(false);
  const cachedReview = profileQuery.data?.ai_weekly_review ?? null;
  const cachedWeekEnding = profileQuery.data?.ai_weekly_review_week_ending ?? null;
  const cachedGeneratedAt = profileQuery.data?.ai_weekly_review_generated_at ?? null;
  const needsWeeklyReview = shouldGenerateWeeklyReview(cachedWeekEnding, cachedGeneratedAt, latestSettlement?.week_ending ?? null, now);

  const generatingKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!needsWeeklyReview || !latestSettlement || !latestWeekTrend || generating) return;
    if (generatingKeyRef.current === latestSettlement.week_ending) return;
    generatingKeyRef.current = latestSettlement.week_ending;

    const ytdYear = new Date(`${latestSettlement.week_ending}T00:00:00`).getFullYear();
    const ytdTrend = weeklyTrend.filter((w) => new Date(`${w.weekEnding}T00:00:00`).getFullYear() === ytdYear);
    const ytdProfitAfter = ytdTrend.reduce((sum, w) => sum + w.net, 0);
    const ytdProfitBefore = ytdProfitAfter - latestWeekTrend.net;

    const biggestChargebacks = (deductionsQuery.data ?? [])
      .filter((d) => d.source === 'settlement' && d.ded_date === latestSettlement.week_ending)
      .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
      .slice(0, 3)
      .map((d) => ({ description: d.description ?? d.category ?? 'Chargeback', amount: Number(d.amount ?? 0) }));

    const prompt = buildWeeklyReviewPrompt({
      weekEnding: latestSettlement.week_ending,
      gross: latestSettlement.gross,
      net: latestWeekTrend.net,
      rpm: latestRpm,
      trailingAvgRpm,
      deadheadPct: latestDeadheadPct,
      fuelPctOfRevenue: latestFuelPct,
      biggestChargebacks,
      perDiemDays: latestSettlement.per_diem_days,
      ytdProfitBefore,
      ytdProfitAfter,
      goalProgress: weeklyGoal != null && goalProgress ? { weeklyGoal, ...goalProgress } : null,
    });

    setGenerating(true);
    callAiAdvisor([{ role: 'user', content: prompt }], i18n.language)
      .then((result) => {
        // NUDGE/WEEKLY-REVIEW WRITES ARE FIRE-AND-FORGET (P1 fix, FULL
        // SYSTEM AUDIT) — `generatingKeyRef` was set BEFORE this call even
        // started, so a failed AI call or a failed cache write used to
        // silently mean this settlement week's review was NEVER retried
        // for the rest of this session (a fresh app launch was the only
        // way to try again) — with no error visible anywhere. Both
        // failure paths now log and reset the ref so a later render can
        // retry.
        if (result.error || !result.data) {
          console.error('[useProactiveCoach] weekly review generation failed:', result.error);
          generatingKeyRef.current = null;
          return;
        }
        updateProfile.mutate(
          {
            ai_weekly_review: result.data,
            ai_weekly_review_generated_at: new Date().toISOString(),
            ai_weekly_review_week_ending: latestSettlement.week_ending,
          },
          {
            onError: (err) => {
              console.error('[useProactiveCoach] failed to cache the generated weekly review:', err);
              generatingKeyRef.current = null;
            },
          }
        );
      })
      .catch((err) => {
        console.error('[useProactiveCoach] weekly review generation threw:', err);
        generatingKeyRef.current = null;
      })
      .finally(() => setGenerating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWeeklyReview, latestSettlement, latestWeekTrend]);

  return {
    isLoading,
    weeklyReview: cachedReview,
    weeklyReviewGenerating: generating,
    periodicNudge,
    weeklyGoal,
    goalProgress,
    weeklyTrend,
  };
}
