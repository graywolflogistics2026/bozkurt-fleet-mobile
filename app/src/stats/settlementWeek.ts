import { computeKpis, type KpiInputs, type KpiResult } from '@/src/stats/kpi';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';
import { settlementDeposit, type SettlementStatement, type WeekDeposit } from '@/src/import/settlementStatement';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import { onePerStatementWeek } from '@/src/stats/heldByCarrier';

// "Profit from this week" on the settlement detail header (owner decision
// 2026-10-13, B3): computeKpis() for that settlement's own week and truck,
// with THIS settlement only — another settlement's linked rows never leak
// in (a fleet can settle two trucks the same week) — plus the owner's own
// manual rows dated that week.
export function computeSettlementWeekKpi(
  settlement: KpiInputs['settlements'][number] & { week_ending: string },
  inputs: Omit<KpiInputs, 'settlements' | 'window' | 'truckScope'>
): KpiResult {
  const own = <R extends { settlement_id?: string | null }>(rows: R[]) =>
    rows.filter((r) => !r.settlement_id || r.settlement_id === settlement.id);
  return computeKpis({
    ...inputs,
    settlements: [settlement],
    deductions: own(inputs.deductions as Array<(typeof inputs.deductions)[number] & { settlement_id?: string | null }>),
    fuelPurchases: own(inputs.fuelPurchases),
    maintenanceRecords: own(inputs.maintenanceRecords as Array<(typeof inputs.maintenanceRecords)[number] & { settlement_id?: string | null }>),
    tolls: own(inputs.tolls as Array<(typeof inputs.tolls)[number] & { settlement_id?: string | null }>),
    reimbursements: own(inputs.reimbursements),
    truckScope: settlement.truck_id,
    window: { startIso: weekStartFromEnding(settlement.week_ending), endIso: settlement.week_ending },
  });
}

// BANK DEPOSIT add-on, item 6 — informational only, never a warning:
// Σ of the Prime weeks' read deposits (one per statement) from Jan 1 of
// the snapshot's year through Prime's own as-of week, to set beside
// Prime's printed YTD SETTLEMENT TO OPERATOR (B5, 2026-10-29).
export function primeDepositsYtd(
  settlements: { carrier: string | null; week_ending: string; net: number | null; statement?: SettlementStatement | null }[],
  asOfWeekEnding: string
): { total: number; weeks: number; perWeek: WeekDeposit[] } {
  const yearStart = `${asOfWeekEnding.slice(0, 4)}-01-01`;
  const inYtd = onePerStatementWeek(settlements.filter((s) => isPrimeCarrier(s.carrier) && s.week_ending >= yearStart && s.week_ending <= asOfWeekEnding));
  const perWeek = inYtd.map(settlementDeposit);
  return { total: perWeek.reduce((sum, d) => sum + d.deposited, 0), weeks: inYtd.length, perWeek };
}
