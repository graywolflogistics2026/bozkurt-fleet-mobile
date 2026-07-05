import { useMemo } from 'react';
import { useTaxYearData } from '@/src/data/taxYearData';
import { useTaxConfig } from '@/src/data/taxConfig';
import { useFleetStats } from '@/src/data/dashboardStats';
import { calcTaxEstimate } from '@/src/tax/calcTaxEstimate';
import { calcPerDiemDeduction } from '@/src/tax/perDiem';
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

  const isLoading = taxYearDataQuery.isLoading || taxConfigQuery.isLoading || fleetStatsQuery.isLoading;
  const error = taxYearDataQuery.error ?? taxConfigQuery.error ?? fleetStatsQuery.error ?? null;

  const data = useMemo<TaxEstimateBundle | null>(() => {
    if (!taxYearDataQuery.data || !taxConfigQuery.data || !fleetStatsQuery.data) return null;
    const { data: taxYearData, isFallback, resolvedYear, requestedYear } = taxYearDataQuery.data;
    const taxConfig = taxConfigQuery.data;
    const stats = fleetStatsQuery.data;

    const perDiemDeduction = calcPerDiemDeduction(stats.perDiemDays, taxYearData.per_diem);
    const netProfit = stats.netRevenue - stats.outOfPocketDeductions - perDiemDeduction;

    const estimate = calcTaxEstimate({
      taxYearData,
      filingStatus: taxConfig.filing_status,
      state: taxConfig.state,
      includeStateTax: taxConfig.include_state_tax,
      entityType: taxConfig.entity_type,
      scorpSalary: taxConfig.scorp_salary,
      netProfit,
    });

    return {
      estimate,
      isFallback,
      resolvedYear,
      requestedYear,
      taxYearData,
      taxConfig,
      perDiemDays: stats.perDiemDays,
      perDiemDeduction,
    };
  }, [taxYearDataQuery.data, taxConfigQuery.data, fleetStatsQuery.data]);

  return { data, isLoading, error };
}
