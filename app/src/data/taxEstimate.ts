import { useMemo } from 'react';
import { useTaxYearData } from '@/src/data/taxYearData';
import { useTaxConfig } from '@/src/data/taxConfig';
import { useFleetStats } from '@/src/data/dashboardStats';
import { useDrivers } from '@/src/data/drivers';
import { useDriverPayments } from '@/src/data/driverPayments';
import { calcTaxEstimate } from '@/src/tax/calcTaxEstimate';
import { calcPerDiemDeduction } from '@/src/tax/perDiem';
import { calcContractLaborYtd, sumDeductibleDriverPayroll, type ContractLaborYtd } from '@/src/tax/driverPayroll';
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
};

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

  const isLoading = taxYearDataQuery.isLoading || taxConfigQuery.isLoading || fleetStatsQuery.isLoading;
  const error = taxYearDataQuery.error ?? taxConfigQuery.error ?? fleetStatsQuery.error ?? null;

  const data = useMemo<TaxEstimateBundle | null>(() => {
    if (!taxYearDataQuery.data || !taxConfigQuery.data || !fleetStatsQuery.data) return null;
    const { data: taxYearData, isFallback, resolvedYear, requestedYear } = taxYearDataQuery.data;
    const taxConfig = taxConfigQuery.data;
    const stats = fleetStatsQuery.data;
    const drivers = driversQuery.data ?? [];
    const driverPayments = driverPaymentsQuery.data ?? [];

    const perDiemDeduction = calcPerDiemDeduction(stats.perDiemDays, taxYearData.per_diem);
    // Driver compensation types (owner decision 2026-07-10): what the owner
    // paid drivers (1099 Contract Labor, W-2 wages + employer taxes,
    // team_split/trainee shares) reduces net profit the same way any other
    // out-of-pocket business expense does.
    const driverPayrollExpense = sumDeductibleDriverPayroll(driverPayments);
    const netProfit = stats.netRevenue - stats.outOfPocketDeductions - perDiemDeduction - driverPayrollExpense;

    const estimate = calcTaxEstimate({
      taxYearData,
      filingStatus: taxConfig.filing_status,
      state: taxConfig.state,
      includeStateTax: taxConfig.include_state_tax,
      entityType: taxConfig.entity_type,
      scorpSalary: taxConfig.scorp_salary,
      scorpPayrollTaxHandled: taxConfig.scorp_payroll_tax_handled,
      ownershipPct: taxConfig.ownership_pct ?? undefined,
      netProfit,
    });

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
    };
  }, [taxYearDataQuery.data, taxConfigQuery.data, fleetStatsQuery.data, driversQuery.data, driverPaymentsQuery.data]);

  return { data, isLoading, error };
}
