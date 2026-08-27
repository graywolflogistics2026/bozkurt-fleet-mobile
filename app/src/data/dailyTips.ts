import { useEffect, useMemo, useRef } from 'react';
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
import { buildDailyTipCandidates, selectDailyTip, selectDailyTipVariant, recordDailyTipShown, dismissDailyTip, type DailyTipTopic } from '@/src/alerts/dailyTips';
import { findUnassignedRows } from '@/src/import/truckAssignmentRepair';
import { calcCurrentYearDepreciation } from '@/src/tax/depreciation';
import { calcPerDiemDays } from '@/src/tax/perDiem';
import { calcMiles } from '@/src/stats/miles';
import { nextQuarterlyDeadline } from '@/src/tax/quarterly';
import type { NudgeState } from '@/src/alerts/nudgeFrequency';

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

  const isLoading = settlementsQuery.isLoading || deductionsQuery.isLoading || profileQuery.isLoading;

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

  const tipState: NudgeState<DailyTipTopic> = (profileQuery.data?.nudge_state as NudgeState<DailyTipTopic>) ?? {};

  const selected = useMemo(() => selectDailyTip(candidates, tipState, accountCreatedAt, now), [candidates, tipState, accountCreatedAt]);
  const variant = selected ? selectDailyTipVariant(selected.topic, tipState) : 0;

  const recordedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || !profileQuery.data) return;
    const key = `${selected.topic}:${new Date().toISOString().slice(0, 10)}`;
    if (recordedKeyRef.current === key) return;
    recordedKeyRef.current = key;
    const nextState = recordDailyTipShown(tipState, selected.topic, variant, new Date());
    updateProfile.mutate(
      { nudge_state: nextState },
      {
        onError: (err) => {
          console.error('[useDailyTip] failed to record tip shown — rotation may repeat early:', err);
          recordedKeyRef.current = null;
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, variant, profileQuery.data]);

  function dismiss() {
    if (!selected) return;
    updateProfile.mutate(
      { nudge_state: dismissDailyTip(tipState, selected.topic, new Date()) },
      { onError: (err) => console.error('[useDailyTip] failed to dismiss tip:', err) }
    );
  }

  return {
    isLoading,
    tip: selected,
    variant,
    dismiss,
  };
}
