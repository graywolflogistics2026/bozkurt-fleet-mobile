import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { calcCpm, type CpmResult } from '@/src/stats/cpm';
import { calcPerDiemDays } from '@/src/tax/perDiem';

export type FleetStats = {
  grossRevenue: number;
  netRevenue: number;
  totalDeductions: number; // ALL deductions (withheld + out-of-pocket) — legacy rDash()'s `ded`
  outOfPocketDeductions: number; // source != 'settlement' AND tax_deductible != false — feeds the tax engine's net profit
  totalMiles: number;
  settlementCount: number;
  avgNetPerWeek: number; // legacy "Avg Net/Week" dashboard card — direct-deposit average
  perDiemDays: number;
  cpm: CpmResult;
};

type SettlementStatsRow = { week_ending: string; gross: number | null; net: number | null; miles: number | null; per_diem_days: number | null };
type DeductionStatsRow = { amount: number | null; source: string | null; tax_deductible: boolean | null };

// Pure aggregation, no I/O — extracted (pre-launch hardening, owner
// decision 2026-08-02, independent code review item — second tier) so
// fetchFleetStats()/fetchDriverStats() below can share it against
// ALREADY-FETCHED rows instead of each issuing its own redundant
// `deductions` query. Deductions are always user-wide, never truck- or
// driver-scoped (the `deductions` table has no truck_id/driver_id column
// for out-of-pocket rows), so the exact same deduction rows were being
// refetched once per truck AND once per driver on the Dashboard's Fleet
// Overview / driver breakdown (N+M redundant full-table fetches for an
// N-truck, M-driver account) — the caller can now fetch deductions ONCE
// and pass the same array into every call.
function computeFleetStats(settlements: SettlementStatsRow[], deductions: DeductionStatsRow[]): FleetStats {
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const netRevenue = settlements.reduce((sum, s) => sum + Number(s.net ?? 0), 0);
  const totalMiles = settlements.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);
  const settlementCount = settlements.length;

  const totalDeductions = deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const outOfPocketDeductions = deductions
    .filter((d) => d.source !== 'settlement' && d.tax_deductible !== false)
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return {
    grossRevenue,
    netRevenue,
    totalDeductions,
    outOfPocketDeductions,
    totalMiles,
    settlementCount,
    avgNetPerWeek: settlementCount > 0 ? netRevenue / settlementCount : 0,
    // Deterministic (CLAUDE.md invariant #9): 7 × distinct settlement
    // weeks. Never derived from AI-extracted load dates.
    perDiemDays: calcPerDiemDays(settlements),
    cpm: calcCpm(grossRevenue, totalDeductions, totalMiles),
  };
}

async function fetchUserDeductions(userId: string): Promise<DeductionStatsRow[]> {
  const { data, error } = await supabase.from('deductions').select('amount, source, tax_deductible').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

// Fleet scalability (owner decision 2026-07-03, PROMPTS.md Session 5): the
// SAME function computes truck-scoped stats (truckId set) and fleet-wide
// stats (truckId null) — no separate "fleet" code path to keep in sync.
// Deductions are always user-wide, never truck-scoped: the `deductions`
// table (docs/SCHEMA.sql) has no truck_id column at all — legacy has no
// concept of per-truck expenses either (DB.ded is one flat list), so a
// truck-scoped call still nets against the full shared expense total,
// matching legacy's single-truck behavior exactly when there's only 1 truck.
// `deductions` (optional): pass an already-fetched user-wide array (e.g.
// dedQuery.data from useDeductions()) to skip the internal fetch entirely
// — the caller ranking multiple trucks/drivers should always do this.
export async function fetchFleetStats(userId: string, truckId: string | null, deductions?: DeductionStatsRow[]): Promise<FleetStats> {
  let settlementsQuery = supabase.from('settlements').select('week_ending, gross, net, miles, per_diem_days').eq('user_id', userId);
  if (truckId) settlementsQuery = settlementsQuery.eq('truck_id', truckId);
  const { data: settlements, error: settError } = await settlementsQuery;
  if (settError) throw settError;

  const dedRows = deductions ?? (await fetchUserDeductions(userId));
  return computeFleetStats(settlements ?? [], dedRows);
}

export function useFleetStats(truckId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<FleetStats>({
    queryKey: ['fleet-stats', userId, truckId],
    queryFn: () => fetchFleetStats(userId as string, truckId),
    enabled: !!userId,
  });
}

// Per-driver dashboard breakdown (PROMPTS.md Session 9a item 7, owner
// decision 2026-07-09 — multi-truck fleet + drivers + payroll auto-
// routing): the exact same driver_id-scoped query variant as
// fetchFleetStats()'s truck_id one, not a new calculation engine. Deductions
// stay user-wide for the same reason fetchFleetStats() keeps them
// truck-wide — the deductions table has no driver_id column for
// out-of-pocket rows either (driver_id on deductions is withheld-only,
// docs/PENDING_SQL.md §14), so this is a revenue/net-focused breakdown, same
// scope as Fleet Overview's per-truck ranking.
// `deductions` (optional): same pre-fetched-array shortcut as
// fetchFleetStats() above — the Dashboard's per-driver breakdown loop
// always passes the already-fetched useDeductions() array so an N-driver
// account issues one deductions query total, not N.
export async function fetchDriverStats(userId: string, driverId: string, deductions?: DeductionStatsRow[]): Promise<FleetStats> {
  const { data: settlements, error: settError } = await supabase
    .from('settlements')
    .select('week_ending, gross, net, miles, per_diem_days')
    .eq('user_id', userId)
    .eq('driver_id', driverId);
  if (settError) throw settError;

  const dedRows = deductions ?? (await fetchUserDeductions(userId));
  return computeFleetStats(settlements ?? [], dedRows);
}
