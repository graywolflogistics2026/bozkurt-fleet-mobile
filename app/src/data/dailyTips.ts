import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useFuelPurchases } from '@/src/data/fuelPurchases';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { useTolls } from '@/src/data/tolls';
import { useLoads } from '@/src/data/loads';
import { useReimbursements } from '@/src/data/reimbursements';
import { useMiscIncome } from '@/src/data/miscIncome';
import { useDocuments } from '@/src/data/documents';
import { useEquipment } from '@/src/data/equipment';
import { useTrucksList } from '@/src/data/trucks';
import { useDrivers } from '@/src/data/drivers';
import { useDriverPayments } from '@/src/data/driverPayments';
import { useLoanRows } from '@/src/data/loans';
import { useComplianceItems } from '@/src/data/complianceItems';
import { useCategoryLearningRules } from '@/src/data/categoryLearningRules';
import { useTaxConfig } from '@/src/data/taxConfig';
import { useTaxEstimate } from '@/src/data/taxEstimate';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useProfile, useUpdateProfile } from '@/src/data/profile';
import {
  buildDailyTipCandidates,
  selectDailyTip,
  selectDailyTipVariant,
  recordDailyTipShown,
  dismissDailyTip,
  findTodaysAnchorTip,
  type DailyTipTopic,
  type DailyTipCandidate,
} from '@/src/alerts/dailyTips';
import { findUnassignedRows } from '@/src/import/truckAssignmentRepair';
import { calcCurrentYearDepreciation } from '@/src/tax/depreciation';
import { calcPerDiemDays } from '@/src/tax/perDiem';
import { calcMiles } from '@/src/stats/miles';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import type { NudgeState } from '@/src/alerts/nudgeFrequency';

// A stable, shared empty-object reference — `profileQuery.data?.nudge_state
// ?? {}` would otherwise allocate a NEW `{}` on every render whenever
// nudge_state is genuinely empty, which would make every memo/effect that
// depends on it (the sticky-anchor reconstruction below) think the state
// had "changed" on every single render.
const EMPTY_NUDGE_STATE: NudgeState<DailyTipTopic> = {};

// DAILY TIPS — DATA WIRING (owner decision, Part 2 of the AI Coach daily-
// tips request). Composes real account data into src/alerts/dailyTips.ts's
// pure detectors, same "React hook that fetches, pure module that decides"
// split as useAlertsData()/useProactiveCoach(). Every figure passed to a
// detector is real and already computed elsewhere in this app (reusing
// the SAME canonical functions those other screens use — findUnassignedRows,
// calcCurrentYearDepreciation, calcPerDiemDays, calcMiles,
// nextQuarterlyDeadline — never a second, competing calculation), never
// fabricated for the tip's own sake.
export function useDailyTip() {
  const { session } = useAuth();
  const { activeTruck } = useActiveTruck();
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const fuelQuery = useFuelPurchases();
  const maintenanceQuery = useMaintenanceRecords();
  const tollsQuery = useTolls();
  const loadsQuery = useLoads();
  const reimbursementsQuery = useReimbursements();
  const miscIncomeQuery = useMiscIncome();
  const documentsQuery = useDocuments();
  const equipmentQuery = useEquipment();
  const trucksQuery = useTrucksList();
  const driversQuery = useDrivers();
  const driverPaymentsQuery = useDriverPayments();
  const loansQuery = useLoanRows();
  const complianceQuery = useComplianceItems();
  const categoryLearningRulesQuery = useCategoryLearningRules();
  const taxConfigQuery = useTaxConfig();
  const taxEstimateQuery = useTaxEstimate();
  const capitalAccountQuery = useCapitalAccountSummary();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();

  // BUG FIX — "flash and vanish" (owner decision): the daily tip used to
  // be selected the instant `settlements`/`deductions`/`profile` had
  // loaded, while every OTHER query this hook reads (documents, equipment,
  // trucks, drivers, loans, compliance, tax config/estimate, capital
  // account, ...) could still be mid-fetch — their `?? []`/`?? 0`/`?? null`
  // fallbacks are legitimate DEFAULT VALUES for a detector, not "no data
  // yet" placeholders, so a detector could easily fire (or fail to fire)
  // against those defaults, then flip the instant the real data arrived a
  // moment later. `queriesLoading` now waits for every one of them before
  // ever computing a candidate at all — see the selection effect below for
  // the second half of the fix (never re-deriving an ALREADY-shown tip
  // from a live recompute).
  const queriesLoading =
    settlementsQuery.isLoading ||
    deductionsQuery.isLoading ||
    fuelQuery.isLoading ||
    maintenanceQuery.isLoading ||
    tollsQuery.isLoading ||
    loadsQuery.isLoading ||
    reimbursementsQuery.isLoading ||
    miscIncomeQuery.isLoading ||
    documentsQuery.isLoading ||
    equipmentQuery.isLoading ||
    trucksQuery.isLoading ||
    driversQuery.isLoading ||
    driverPaymentsQuery.isLoading ||
    loansQuery.isLoading ||
    complianceQuery.isLoading ||
    categoryLearningRulesQuery.isLoading ||
    taxConfigQuery.isLoading ||
    taxEstimateQuery.isLoading ||
    capitalAccountQuery.isLoading ||
    profileQuery.isLoading;

  const now = new Date();
  const accountCreatedAt = session?.user?.created_at ?? null;
  const accountAgeDays = accountCreatedAt ? Math.floor((now.getTime() - new Date(accountCreatedAt).getTime()) / 86400000) : 0;

  const settlements = settlementsQuery.data ?? [];
  const deductions = deductionsQuery.data ?? [];
  const fuel = fuelQuery.data ?? [];
  const maintenance = maintenanceQuery.data ?? [];
  const tolls = tollsQuery.data ?? [];
  const loads = loadsQuery.data ?? [];
  const trucks = trucksQuery.data ?? [];

  const candidateInput = useMemo(() => {
    const totalRows = settlements.length + fuel.length + deductions.length + tolls.length;
    const settlementsMissingMilesCount = settlements.filter((s) => s.gross > 0 && (!s.miles || s.miles <= 0)).length;
    const miles = calcMiles(settlements, loads);
    const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const fuelCost = fuel.reduce((sum, f) => sum + Number(f.amount ?? 0) - Number(f.discount ?? 0), 0);
    const fuelPctOfRevenue = grossRevenue > 0 && fuelCost > 0 ? fuelCost / grossRevenue : null;
    const dueSoonOrOverdueMaintenanceCount = 0; // full calcTruckHealth wiring not needed for this evergreen "log your first record" tip
    const distinctWeeks = new Set(settlements.map((s) => s.week_ending)).size;

    const currentYear = now.getFullYear();
    const settlementsThisYear = settlements.filter((s) => new Date(`${s.week_ending}T00:00:00`).getFullYear() === currentYear);
    const perDiemDaysYtd = calcPerDiemDays(settlementsThisYear.map((s) => ({ week_ending: s.week_ending, per_diem_days: s.per_diem_days })));

    const trucksWithoutCostBasisCount = trucks.filter((t) => t.cost_basis_ownership_mode === null).length;
    const trucksWithoutDepreciationCount = trucks.filter((t) => t.cost_basis_ownership_mode !== 'lease' && t.depreciation_method === null).length;
    const currentTaxYear = now.getFullYear();
    const depreciationPreviewTotal = trucks.reduce((sum, t) => {
      if (t.cost_basis_ownership_mode === 'lease' || t.depreciation_method || !t.purchase_price) return sum;
      const yearPlacedInService = t.purchase_date ? new Date(t.purchase_date).getFullYear() : currentTaxYear;
      const preview = calcCurrentYearDepreciation(
        { purchasePrice: t.purchase_price, ownershipMode: 'paid', method: 'full', yearPlacedInService, spreadYears: null },
        'tractor',
        currentTaxYear
      );
      return sum + preview.currentYearDepreciation;
    }, 0);
    const anyTruckHasTrailer = trucks.some((t) => !!t.trailer_unit_number);
    const trucksWithPurchasePriceCount = trucks.filter((t) => !!t.purchase_price).length;

    const unassigned = findUnassignedRows(settlements, fuel, maintenance, tolls);

    const hasPositiveNetWeek = settlements.some((s) => Number(s.net ?? 0) > 0);

    const quarterlyDeadline = taxEstimateQuery.data ? nextQuarterlyDeadline(taxEstimateQuery.data.taxYearData.quarterly_deadlines) : null;

    const activeTruckId = activeTruck?.id ?? null;
    const activeTruckMaintenanceRecordsCount = activeTruckId ? maintenance.filter((m) => m.truck_id === activeTruckId).length : maintenance.length;

    const escrowDeductionsCount = deductions.filter((d) => d.category === 'Escrow & Deposits').length;
    const advanceRepaymentDeductionsCount = deductions.filter((d) => d.category === 'Advance Repayment').length;

    return {
      totalRows,
      documentsCount: documentsQuery.data?.length ?? 0,
      settlementsCount: settlements.length,
      loadsCount: loads.length,
      settlementsMissingMilesCount,
      reimbursementsCount: reimbursementsQuery.data?.length ?? 0,
      miscIncomeCount: miscIncomeQuery.data?.length ?? 0,
      fuelPctOfRevenue,
      dueSoonOrOverdueMaintenanceCount,
      maintenanceRecordsCount: maintenance.length,
      tollsCount: tolls.length,
      needsReviewCount: deductions.filter((d) => (d.description ?? '').startsWith('NEEDS REVIEW: ')).length,
      equipmentCount: equipmentQuery.data?.length ?? 0,
      trucksWithPurchasePriceCount,
      weeksOfHistory: distinctWeeks,
      quarterlyDeadlineDaysUntil: quarterlyDeadline?.daysUntil ?? null,
      accountAgeDays,
      hasTaxConfig: !!taxConfigQuery.data?.entity_type,
      weeklyTaxReserve: taxEstimateQuery.data?.estimate.weeklyTaxReserve ?? null,
      hasPositiveNetWeek,
      complianceItemsCount: complianceQuery.data?.length ?? 0,
      learningRulesCount: categoryLearningRulesQuery.data?.length ?? 0,
      trucksWithoutCostBasisCount,
      trucksWithoutDepreciationCount,
      depreciationPreviewTotal,
      trucksCount: trucks.length,
      anyTruckHasTrailer,
      unassignedRowsCount: unassigned.length,
      driversCount: driversQuery.data?.length ?? 0,
      driverPaymentsCount: driverPaymentsQuery.data?.length ?? 0,
      businessBalance: capitalAccountQuery.data?.businessBalance ?? 0,
      initialCapital: capitalAccountQuery.data?.effectiveContribution ?? 0,
      taxFreeRemaining: capitalAccountQuery.data?.taxFreeRemaining ?? null,
      activeTruckMaintenanceRecordsCount,
      distinctSettlementWeeks: distinctWeeks,
      settlementsWithMilesCount: settlements.filter((s) => (s.miles ?? 0) > 0).length,
      loansCount: loansQuery.data?.length ?? 0,
      deadheadPct: miles.deadheadPct,
      perDiemDaysYtd,
      escrowDeductionsCount,
      advanceRepaymentDeductionsCount,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settlements,
    deductions,
    fuel,
    maintenance,
    tolls,
    loads,
    trucks,
    documentsQuery.data,
    reimbursementsQuery.data,
    miscIncomeQuery.data,
    equipmentQuery.data,
    driversQuery.data,
    driverPaymentsQuery.data,
    loansQuery.data,
    complianceQuery.data,
    categoryLearningRulesQuery.data,
    taxConfigQuery.data,
    taxEstimateQuery.data,
    capitalAccountQuery.data,
    activeTruck,
    accountAgeDays,
  ]);

  const candidates = useMemo(() => buildDailyTipCandidates(candidateInput), [candidateInput]);

  const savedState: NudgeState<DailyTipTopic> = (profileQuery.data?.nudge_state as NudgeState<DailyTipTopic>) ?? EMPTY_NUDGE_STATE;

  // OPTIMISTIC OVERLAY — the full nudge_state as this session currently
  // understands it, once it's diverged from the server's own value (a
  // "show me another"/dismiss action was taken). Falls back to
  // `savedState` until that first local write happens, so a fresh mount
  // always starts from the real, server-confirmed value. Written directly
  // (never a React functional updater) precisely so two synchronous calls
  // in the same handler (e.g. dismiss(), which both silences the current
  // topic AND immediately records a replacement) can chain off of each
  // other's already-computed result instead of racing to read stale state
  // — see applyLocal()/recordAndDisplay() below.
  const [overlay, setOverlay] = useState<NudgeState<DailyTipTopic> | null>(null);
  const tipState = overlay ?? savedState;

  const [displayedTopic, setDisplayedTopic] = useState<DailyTipTopic | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const ready = !queriesLoading;

  // STICKY ANCHOR (the core of item 1's fix) — reconstructed directly from
  // persisted state, never from a live re-run of selectDailyTip(). See
  // findTodaysAnchorTip()'s own header comment in dailyTips.ts for exactly
  // why re-running selection on every recompute was what caused the
  // flash.
  const anchorTopic = useMemo(() => (ready ? findTodaysAnchorTip(tipState, now) : null), [ready, tipState]);

  function applyLocal(next: NudgeState<DailyTipTopic>) {
    setOverlay(next);
    updateProfile.mutate(
      { nudge_state: next },
      { onError: (err) => console.error('[useDailyTip] failed to persist tip state — rotation/no-repeat may drift:', err) }
    );
  }

  function recordAndDisplay(candidate: DailyTipCandidate, base: NudgeState<DailyTipTopic>) {
    const variant = selectDailyTipVariant(candidate.topic, base);
    applyLocal(recordDailyTipShown(base, candidate.topic, variant, new Date()));
    setDisplayedTopic(candidate.topic);
    setExhausted(false);
  }

  // Picks today's FIRST tip exactly once — as soon as everything's loaded
  // and no anchor exists yet for today. Re-derives `anchorTopic` (via its
  // own dependency) the moment this records one, so it naturally settles
  // and doesn't refire once a real anchor exists; `candidates` stays a
  // dependency so a still-empty day (nothing eligible yet, e.g. the
  // signup grace period) keeps retrying as real data arrives later in the
  // session, rather than giving up forever after one empty attempt.
  useEffect(() => {
    if (!ready) return;
    if (anchorTopic) {
      setDisplayedTopic(anchorTopic);
      setExhausted(false);
      return;
    }
    const fresh = selectDailyTip(candidates, tipState, accountCreatedAt, now);
    if (fresh) recordAndDisplay(fresh, tipState);
    else setDisplayedTopic(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, anchorTopic, candidates]);

  const displayedCandidate = useMemo(
    () => (displayedTopic ? candidates.find((c) => c.topic === displayedTopic) ?? null : null),
    [displayedTopic, candidates]
  );
  const variant = displayedTopic ? tipState[displayedTopic]?.variantIndex ?? 0 : 0;

  // ITEM 2 — "SHOW ME ANOTHER": advances to the next eligible topic
  // immediately, recording it with THIS SAME `recordDailyTipShown()`
  // mechanism (so the no-repeat/cooldown rule applies identically whether
  // a topic was shown as today's automatic pick or via this manual
  // advance) — never a separate budget or counter, so tomorrow's rotation
  // is affected only by the same 30-day-per-topic rule every other pick
  // already respects, never by how many were manually browsed today.
  function showAnother() {
    if (!ready) return;
    const next = selectDailyTip(candidates, tipState, accountCreatedAt, now);
    if (!next) {
      setExhausted(true);
      return;
    }
    recordAndDisplay(next, tipState);
  }

  // Dismissing silences the CURRENTLY DISPLAYED topic (permanently, same
  // as every other nudge family's silence semantics) and — matching the
  // pre-existing behavior this replaces — immediately offers a
  // replacement if one is eligible, rather than just going blank for the
  // rest of the day.
  function dismiss() {
    if (!displayedTopic) return;
    const afterDismiss = dismissDailyTip(tipState, displayedTopic, new Date());
    const next = selectDailyTip(candidates, afterDismiss, accountCreatedAt, now);
    if (next) {
      recordAndDisplay(next, afterDismiss);
    } else {
      applyLocal(afterDismiss);
      setDisplayedTopic(null);
      setExhausted(false);
    }
  }

  return {
    isLoading: queriesLoading,
    tip: displayedCandidate,
    variant,
    exhausted,
    showAnother,
    dismiss,
  };
}
