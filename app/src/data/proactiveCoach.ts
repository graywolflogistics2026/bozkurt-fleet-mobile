import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useSettlements } from '@/src/data/settlements';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useDeductions } from '@/src/data/deductions';
import { useLoads } from '@/src/data/loads';
import { useTrucksList } from '@/src/data/trucks';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { callAiAdvisor } from '@/src/data/aiAdvisorCall';
import i18n from '@/src/i18n';
import { calcMiles } from '@/src/stats/miles';
import { computeKpis } from '@/src/stats/kpi';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import {
  shouldGenerateWeeklyReview,
  buildWeeklyReviewPrompt,
  buildWeeklyReviewFallbackText,
  computeWeeklyReviewFingerprint,
  isCachedReviewUsable,
  looksLikeExpectedScript,
  type WeeklyReviewInputs,
} from '@/src/stats/weeklyReview';
import { useFormatters } from '@/src/i18n/format';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const pct = (n: number) => number(n, { style: 'percent', maximumFractionDigits: 1 });
  const settlementsQuery = useSettlements();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const deductionsQuery = useDeductions();
  const loadsQuery = useLoads();
  const trucksQuery = useTrucksList();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const taxQuery = useTaxEstimate();

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

  // KPI CONSISTENCY (owner decision) — this used to be its OWN, THIRD
  // ad-hoc calcCanonicalCpm() call (a "CPM FORMULA DIVERGENCE" fix from an
  // earlier pass) — a real, separate implementation from Scorecard's own,
  // with its own subtle divergence (one truck's cost basis × the WHOLE
  // FLEET's settlement count, rather than every truck's own basis × its
  // own count). Replaced with ONE call to src/stats/kpi.ts's
  // computeKpis() — the SAME canonical function Scorecard/Home read from
  // — window: null (all-time, matching this figure's own established
  // "account-wide aggregate" reasoning) and truckScope: null (fleet-wide,
  // matching AI Coach's own deliberate always-fleet-wide design, CLAUDE.md's
  // "MULTI-TRUCK MODEL — AUDIT OF 3 PREVIOUSLY-UNREVIEWED SCREENS" entry).
  // This is now the literal SAME number a user would see on Scorecard in
  // "All Trucks" scope, never a second figure that could disagree with it
  // — and it gets the maintenance-one-off CPM-inflation fix automatically,
  // for free, by sharing the same underlying calcCanonicalCpm() call.
  // Compared against trailingAvgRpm (falling back to latestRpm only when
  // there isn't yet enough history) rather than latestRpm alone, since
  // pairing an account-wide cost figure against a single week's revenue
  // rate would just trade one apples-to-oranges comparison for another —
  // a trailing average is the more honest "typical" pairing.
  const latestKpi = useMemo(
    () =>
      computeKpis({
        trucks: trucksQuery.data ?? [],
        settlements: settlementsQuery.data ?? [],
        loads: loadsQuery.data ?? [],
        deductions: deductionsQuery.data ?? [],
        fuelPurchases: fuelQuery.data ?? [],
        maintenanceRecords: maintenanceQuery.data ?? [],
        tolls: tollsQuery.data ?? [],
        truckScope: null,
        window: null,
      }),
    [trucksQuery.data, settlementsQuery.data, loadsQuery.data, deductionsQuery.data, fuelQuery.data, maintenanceQuery.data, tollsQuery.data]
  );
  const latestCpm = latestKpi.cpm;
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
  // AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
  // (owner decision, docs/PENDING_SQL.md §65): the cache now also tracks
  // WHICH LOCALE it was generated in (ai_weekly_review_locale) — a
  // mismatch against the current locale forces regeneration (item 5)
  // AND, critically, the possibly-wrong-language cached text is never
  // shown while that regeneration is pending (see weeklyReviewUsable
  // below) — item 4's fallback requirement.
  const [generating, setGenerating] = useState(false);
  const cachedReview = profileQuery.data?.ai_weekly_review ?? null;
  const cachedWeekEnding = profileQuery.data?.ai_weekly_review_week_ending ?? null;
  const cachedGeneratedAt = profileQuery.data?.ai_weekly_review_generated_at ?? null;
  const cachedReviewLocale = profileQuery.data?.ai_weekly_review_locale ?? null;
  const cachedReviewFingerprint = profileQuery.data?.ai_weekly_review_fingerprint ?? null;

  // Same real-number inputs buildWeeklyReviewPrompt() sends to the model,
  // pulled out of the generation effect below so the ALWAYS-CORRECT
  // client-side fallback text can be composed from them too, regardless
  // of whether a fresh AI generation is running/pending/cached.
  const weeklyReviewInputs = useMemo<WeeklyReviewInputs | null>(() => {
    if (!latestSettlement || !latestWeekTrend) return null;
    const ytdYear = new Date(`${latestSettlement.week_ending}T00:00:00`).getFullYear();
    const ytdTrend = weeklyTrend.filter((w) => new Date(`${w.weekEnding}T00:00:00`).getFullYear() === ytdYear);
    const ytdProfitAfter = ytdTrend.reduce((sum, w) => sum + w.net, 0);
    const ytdProfitBefore = ytdProfitAfter - latestWeekTrend.net;
    // KPI CONSISTENCY (owner decision, device report: "AI Coach says 'YTD
    // net $4,543.27, after just one settlement' while Scorecard shows 6
    // settlements") — the REAL settlement row count for the same calendar
    // year the YTD figure covers, from the SAME sortedSettlements array
    // Scorecard's own weekly trend is built from (fleet-wide, matching
    // this hook's own established always-fleet-wide design) — never a
    // week count (a week can hold 2+ settlements in a multi-truck fleet).
    const settlementCountYtd = sortedSettlements.filter(
      (s) => new Date(`${s.week_ending}T00:00:00`).getFullYear() === ytdYear
    ).length;
    const biggestChargebacks = (deductionsQuery.data ?? [])
      .filter((d) => d.source === 'settlement' && d.ded_date === latestSettlement.week_ending)
      .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
      .slice(0, 3)
      .map((d) => ({ description: d.description ?? d.category ?? 'Chargeback', amount: Number(d.amount ?? 0) }));
    return {
      weekEnding: latestSettlement.week_ending,
      // KPI CONSISTENCY (owner decision) — this used to be
      // `latestSettlement.gross`, ONE settlement row's own gross, while
      // `net` right below it was already `latestWeekTrend.net` —
      // buildWeeklyTrueProfitTrend()'s AGGREGATE across every settlement
      // sharing that same week_ending. In a multi-truck fleet where 2+
      // trucks settle the same week, that mixed a single truck's revenue
      // with the WHOLE FLEET's expenses in the same weekly review — gross
      // and net now both come from the identical aggregated
      // `latestWeekTrend` point, so they can never describe two different
      // truck sets.
      gross: latestWeekTrend.gross,
      net: latestWeekTrend.net,
      rpm: latestRpm,
      trailingAvgRpm,
      // AI COACH — WEEKLY REVIEW COVERAGE (owner decision) — the SAME
      // account-wide canonical CPM figure computeKpis() already produces
      // for `latestKpi`/`latestCpm` above (Scorecard/Home's own per-mile
      // trio), never a second CPM formula — this is what actually makes
      // "cost per mile" one of the numbers the weekly review cites.
      cpm: latestCpm,
      deadheadPct: latestDeadheadPct,
      fuelPctOfRevenue: latestFuelPct,
      biggestChargebacks,
      perDiemDays: latestSettlement.per_diem_days,
      ytdProfitBefore,
      ytdProfitAfter,
      settlementCountYtd,
      goalProgress: weeklyGoal != null && goalProgress ? { weeklyGoal, ...goalProgress } : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestSettlement, latestWeekTrend, weeklyTrend, sortedSettlements, deductionsQuery.data, latestRpm, trailingAvgRpm, latestCpm, latestDeadheadPct, latestFuelPct, weeklyGoal, goalProgress]);

  const weeklyReviewFallback = useMemo(
    () => (weeklyReviewInputs ? buildWeeklyReviewFallbackText(weeklyReviewInputs, t, money, pct) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weeklyReviewInputs, i18n.language]
  );

  // AI COACH — FIX STALE CACHE (owner decision, docs/PENDING_SQL.md §68):
  // a digest of every figure the current week's review actually quotes —
  // null whenever there's nothing to review at all (every settlement was
  // deleted, or none exist yet). Any settlement/deduction/fuel/
  // maintenance/toll insert, update, or delete, any truck delete, or a
  // Reset All Data all flow through the SAME react-query invalidation
  // this hook's own settlementsQuery/dedQuery/etc. already depend on —
  // this fingerprint recomputes fresh from whatever that refetch returns,
  // with no separate wiring needed per mutation type.
  const currentFingerprint = weeklyReviewInputs ? computeWeeklyReviewFingerprint(weeklyReviewInputs) : null;
  const needsWeeklyReview = shouldGenerateWeeklyReview(
    cachedWeekEnding,
    cachedGeneratedAt,
    cachedReviewLocale,
    cachedReviewFingerprint,
    latestSettlement?.week_ending ?? null,
    i18n.language,
    currentFingerprint,
    now
  );
  // A cached review only counts as trustworthy when (a) its own tagged
  // locale matches the CURRENT one (isCachedReviewUsable — catches a
  // stale cache left over from before a language switch), (b) its own
  // tagged fingerprint matches the CURRENT real figures
  // (isCachedReviewUsable — catches a stale cache left over from a
  // settlement/truck delete, edit, or a Reset All Data; `currentFingerprint
  // === null`, meaning nothing to review right now, can never match any
  // cached fingerprint, which is the actual fix for "I deleted every
  // settlement and the coach kept quoting the old numbers"), AND (c), for
  // the two script-checkable locales, it actually contains real text in
  // that script (looksLikeExpectedScript — catches a currently-deployed
  // ai-advisor that ignored the requested locale entirely, e.g. while a
  // redeploy is blocked). Anything else falls through to the
  // deterministic, always-correct template below instead of ever
  // rendering possibly-wrong-language or possibly-stale server text.
  const weeklyReviewUsable =
    isCachedReviewUsable(cachedReview, cachedReviewLocale, i18n.language, cachedReviewFingerprint, currentFingerprint) &&
    looksLikeExpectedScript(cachedReview ?? '', i18n.language);

  const generatingKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!needsWeeklyReview || !latestSettlement || !weeklyReviewInputs || generating) return;
    // Key includes the locale AND the data fingerprint — a language
    // switch, or any change to the underlying figures (a settlement/
    // deduction/fuel/maintenance/toll edit that doesn't change
    // week_ending, a re-import, ...), must be able to trigger a fresh
    // attempt even for the SAME settlement week this session already
    // tried (and possibly already succeeded for, under the old
    // locale/data).
    const key = `${latestSettlement.week_ending}:${i18n.language}:${currentFingerprint ?? ''}`;
    if (generatingKeyRef.current === key) return;
    generatingKeyRef.current = key;

    const prompt = buildWeeklyReviewPrompt(weeklyReviewInputs);
    const requestedLocale = i18n.language;
    // Captured BEFORE the async call, same reasoning as requestedLocale
    // above — the account's data could keep changing while this call is
    // in flight, but the response being generated is for THIS snapshot,
    // not whatever the figures happen to be by the time it resolves.
    const requestedFingerprint = currentFingerprint;

    setGenerating(true);
    callAiAdvisor([{ role: 'user', content: prompt }], requestedLocale)
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
            // Tag with the locale that was ACTUALLY REQUESTED (never
            // re-read from i18n.language after the fact — the user could
            // have switched languages again while this call was in
            // flight, and the response was generated for the ORIGINAL
            // request, not whatever the language happens to be now).
            ai_weekly_review_locale: requestedLocale,
            // AI COACH — FIX STALE CACHE (owner decision, docs/PENDING_SQL.md
            // §68) — tag with the fingerprint of the figures this review
            // was ACTUALLY generated from, same "captured before the call,
            // never re-derived after" reasoning as the locale above.
            ai_weekly_review_fingerprint: requestedFingerprint,
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
  }, [needsWeeklyReview, latestSettlement, weeklyReviewInputs, i18n.language, currentFingerprint]);

  return {
    isLoading,
    weeklyReview: weeklyReviewUsable ? cachedReview : null,
    // Always available (once real settlement data exists) — a plain
    // i18n-template summary of the exact same real numbers, guaranteed
    // correctly localized regardless of ai-advisor's own deploy/locale
    // state. The UI shows this whenever `weeklyReview` above is null.
    weeklyReviewFallback,
    // AI COACH — FIX STALE CACHE (owner decision) — true once loading has
    // settled and there is genuinely no settlement to review (never
    // imported one, or every one was deleted). The screen's own job is to
    // never leave this gap silently blank: show
    // "Nothing to review yet — import a settlement and I'll break down
    // your week" instead, rather than nothing at all.
    weeklyReviewEmpty: !isLoading && !weeklyReviewInputs,
    weeklyReviewGenerating: generating,
    periodicNudge,
    weeklyGoal,
    goalProgress,
    weeklyTrend,
  };
}
