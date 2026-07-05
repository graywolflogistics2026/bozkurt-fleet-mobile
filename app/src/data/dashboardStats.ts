import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { calcCpm, type CpmResult } from '@/src/stats/cpm';
import { calcPerDiemDays } from '@/src/tax/perDiem';

export type FleetStats = {
  grossRevenue: number;
  netRevenue: number;
  totalDeductions: number; // ALL deductions (withheld + out-of-pocket) — legacy rDash()'s `ded`
  outOfPocketDeductions: number; // source != 'settlement' — feeds the tax engine's net profit
  totalMiles: number;
  settlementCount: number;
  perDiemDays: number;
  cpm: CpmResult;
};

// Fleet scalability (owner decision 2026-07-03, PROMPTS.md Session 5): the
// SAME function computes truck-scoped stats (truckId set) and fleet-wide
// stats (truckId null) — no separate "fleet" code path to keep in sync.
// Deductions are always user-wide, never truck-scoped: the `deductions`
// table (docs/SCHEMA.sql) has no truck_id column at all — legacy has no
// concept of per-truck expenses either (DB.ded is one flat list), so a
// truck-scoped call still nets against the full shared expense total,
// matching legacy's single-truck behavior exactly when there's only 1 truck.
export async function fetchFleetStats(userId: string, truckId: string | null): Promise<FleetStats> {
  let settlementsQuery = supabase.from('settlements').select('gross, net, miles').eq('user_id', userId);
  if (truckId) settlementsQuery = settlementsQuery.eq('truck_id', truckId);
  const { data: settlements, error: settError } = await settlementsQuery;
  if (settError) throw settError;

  const { data: deductions, error: dedError } = await supabase
    .from('deductions')
    .select('amount, source')
    .eq('user_id', userId);
  if (dedError) throw dedError;

  const rows = settlements ?? [];
  const grossRevenue = rows.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const netRevenue = rows.reduce((sum, s) => sum + Number(s.net ?? 0), 0);
  const totalMiles = rows.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);
  const settlementCount = rows.length;

  const dedRows = deductions ?? [];
  const totalDeductions = dedRows.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const outOfPocketDeductions = dedRows
    .filter((d) => d.source !== 'settlement')
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return {
    grossRevenue,
    netRevenue,
    totalDeductions,
    outOfPocketDeductions,
    totalMiles,
    settlementCount,
    perDiemDays: calcPerDiemDays(settlementCount),
    cpm: calcCpm(grossRevenue, totalDeductions, totalMiles),
  };
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
