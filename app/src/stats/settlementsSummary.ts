import type { Settlement } from '@/src/types/db';

// SETTLEMENTS TOTALS BAR (spec item, "the same period tabs... a totals
// bar — Gross · Net Pay · Miles — with average RPM as a caption") — every
// figure is a plain sum over whatever settlements the caller has already
// period-filtered (periodFilter.ts's filterByPeriod), the exact same
// gross/net summation dashboardStats.ts's fleet-wide FleetStats already
// uses (`grossRevenue = sum(gross)`, `netRevenue = sum(net)`) — just
// applied to a filtered subset instead of the whole account, never a
// second formula for what "gross"/"net" means.
export type SettlementsTotalsBar = {
  gross: number;
  net: number;
  miles: number;
  count: number;
  // null when there are no miles to divide by — never a fabricated $0/mi
  // or a divide-by-zero NaN.
  avgRpm: number | null;
};

export function buildSettlementsTotalsBar(settlements: Settlement[]): SettlementsTotalsBar {
  const gross = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const net = settlements.reduce((sum, s) => sum + Number(s.net ?? 0), 0);
  const miles = settlements.reduce((sum, s) => sum + Number(s.miles ?? 0), 0);
  return {
    gross,
    net,
    miles,
    count: settlements.length,
    avgRpm: miles > 0 ? gross / miles : null,
  };
}
