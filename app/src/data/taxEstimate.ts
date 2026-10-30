import { useMemo } from 'react';
import { useTaxYearData } from '@/src/data/taxYearData';
import { useTaxConfig } from '@/src/data/taxConfig';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useDrivers } from '@/src/data/drivers';
import { useDriverPayments } from '@/src/data/driverPayments';
import { useHouseholdIncome } from '@/src/data/householdIncome';
import { useTrucksList } from '@/src/data/trucks';
import { calcTaxEstimate } from '@/src/tax/calcTaxEstimate';
import { calcPerDiemDeduction } from '@/src/tax/perDiem';
import { sumHouseholdIncome } from '@/src/tax/household';
import { calcContractLaborYtd, sumDeductibleDriverPayroll, type ContractLaborYtd } from '@/src/tax/driverPayroll';
import { sumFleetVehicleTax, vehicleDeductionExceedsIncome } from '@/src/tax/vehiclePurchase';
import type { TaxConfig, TaxYearData } from '@/src/types/db';
import type { TaxEstimateResult } from '@/src/tax/types';

export type TaxEstimateBundle = {
  estimate: TaxEstimateResult;
  isFallback: boolean;
  resolvedYear: number;
  requestedYear: number;
  taxYearData: TaxYearData;
  taxConfig: TaxConfig;
  perDiemDays: number;
  perDiemDeduction: number;
  driverPayrollExpense: number;
  contractLaborYtd: ContractLaborYtd[];
  householdIncome: number;
  // DEPRECIATION ELECTION (owner decision 2026-08-05, FULL PARITY
  // follow-up item E) — src/tax/depreciation.ts's sumFleetDepreciation().
  // netProfitBeforeDepreciation lets the breakdown show depreciation as
  // its own visible line: before -> - depreciation -> estimate.netProfit.
  depreciationTotal: number;
  depreciationRequiresCpaNote: boolean;
  netProfitBeforeDepreciation: number;
  // VEHICLE PURCHASE (batch B, 2026-10-30, src/tax/vehiclePurchase.ts):
  // the part of depreciationTotal from a truck's "deduct in the purchase
  // year" choice; the same estimate without that purchase deduction (Home's
  // weekly reserve shows both, never lowered silently); warnings.
  vehiclePurchaseDeduction: number;
  vehicleDeductionMissingDate: boolean;
  vehicleDeductionExceedsIncome: boolean;
  estimateWithoutVehicleDeduction: TaxEstimateResult;
};

// The same calcTaxEstimate() call the bundle makes, for another net profit
// (the Trucks screen's "effect on your estimate" preview). Not a second
// formula — the one engine with one input changed.
export function estimateForNetProfit(
  bundle: Pick<TaxEstimateBundle, 'taxYearData' | 'taxConfig' | 'householdIncome'>,
  netProfit: number
): TaxEstimateResult {
  const taxConfig = bundle.taxConfig;
  return calcTaxEstimate({
    taxYearData: bundle.taxYearData,
    filingStatus: taxConfig.filing_status,
    state: taxConfig.state,
    includeStateTax: taxConfig.include_state_tax,
    entityType: taxConfig.entity_type,
    scorpSalary: taxConfig.scorp_salary,
    scorpPayrollTaxHandled: taxConfig.scorp_payroll_tax_handled,
    ownershipPct: taxConfig.ownership_pct ?? undefined,
    netProfit,
    spouseIncome: bundle.householdIncome,
    sepContribution: taxConfig.sep_contribution,
    healthInsurancePremiums: taxConfig.health_insurance_premiums,
  });
}

// Combines Session 4's tax_year_data hook + tax_config + fleet-wide stats
// into the full estimate. Tax filing is per-person, not per-truck (unlike
// the Dashboard's other stat cards, which follow the active-truck context
// per CLAUDE.md invariant #7) — this always computes against ALL of the
// user's trucks (truckId=null), regardless of which truck is active in the
// UI.
export function useTaxEstimate() {
  const taxYearDataQuery = useTaxYearData();
  const taxConfigQuery = useTaxConfig();
  const fleetStatsQuery = useFleetStats(null);
  const driversQuery = useDrivers();
  const driverPaymentsQuery = useDriverPayments();
  const householdIncomeQuery = useHouseholdIncome();
  const trucksQuery = useTrucksList();

  const isLoading = taxYearDataQuery.isLoading || taxConfigQuery.isLoading || fleetStatsQuery.isLoading;
  const error = taxYearDataQuery.error ?? taxConfigQuery.error ?? fleetStatsQuery.error ?? null;

  const data = useMemo<TaxEstimateBundle | null>(() => {
    if (!taxYearDataQuery.data || !taxConfigQuery.data || !fleetStatsQuery.data) return null;
    const { data: taxYearData, isFallback, resolvedYear, requestedYear } = taxYearDataQuery.data;
    const taxConfig = taxConfigQuery.data;
    const stats = fleetStatsQuery.data;
    const drivers = driversQuery.data ?? [];
    const driverPayments = driverPaymentsQuery.data ?? [];
    const householdIncome = sumHouseholdIncome(householdIncomeQuery.data ?? [], resolvedYear);

    const perDiemDeduction = calcPerDiemDeduction(stats.perDiemDays, taxYearData.per_diem);
    // Driver compensation types (owner decision 2026-07-10): what the owner
    // paid drivers (1099 Contract Labor, W-2 wages + employer taxes,
    // team_split/trainee shares) reduces net profit the same way any other
    // out-of-pocket business expense does.
    const driverPayrollExpense = sumDeductibleDriverPayroll(driverPayments);
    // Identical to the old sumFleetDepreciation() for every truck without a
    // saved purchase_tax_treatment (vehiclePurchase.test.ts proves it).
    const vehicleTax = sumFleetVehicleTax(trucksQuery.data ?? [], resolvedYear);
    const depreciationTotal = vehicleTax.total;
    const depreciationRequiresCpaNote = vehicleTax.anyRequiresCpaNote;
    const netProfitBeforeDepreciation = stats.netRevenue - stats.outOfPocketDeductions - perDiemDeduction - driverPayrollExpense;
    const netProfit = netProfitBeforeDepreciation - depreciationTotal;

    const estimate = estimateForNetProfit({ taxYearData, taxConfig, householdIncome }, netProfit);
    // Only the owner's purchase-year deduction is taken back out; an older
    // depreciation election keeps applying exactly as before.
    const estimateWithoutVehicleDeduction =
      vehicleTax.purchaseDeductionTotal === 0
        ? estimate
        : estimateForNetProfit({ taxYearData, taxConfig, householdIncome }, netProfit + vehicleTax.purchaseDeductionTotal);

    const contractLaborYtd = calcContractLaborYtd(driverPayments, drivers, resolvedYear, taxYearData.nec_1099);

    return {
      estimate,
      isFallback,
      resolvedYear,
      requestedYear,
      taxYearData,
      taxConfig,
      perDiemDays: stats.perDiemDays,
      perDiemDeduction,
      driverPayrollExpense,
      contractLaborYtd,
      householdIncome,
      depreciationTotal,
      depreciationRequiresCpaNote,
      netProfitBeforeDepreciation,
      vehiclePurchaseDeduction: vehicleTax.purchaseDeductionTotal,
      vehicleDeductionMissingDate: vehicleTax.anyMissingDateOrPrice,
      vehicleDeductionExceedsIncome: vehicleDeductionExceedsIncome(vehicleTax.purchaseDeductionTotal, netProfitBeforeDepreciation),
      estimateWithoutVehicleDeduction,
    };
  }, [
    taxYearDataQuery.data,
    taxConfigQuery.data,
    fleetStatsQuery.data,
    driversQuery.data,
    driverPaymentsQuery.data,
    householdIncomeQuery.data,
    trucksQuery.data,
  ]);

  return { data, isLoading, error };
}
