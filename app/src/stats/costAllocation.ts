// MULTI-TRUCK MODEL (owner decision) — requirement 6: a fleet-level cost
// (a deduction/toll with no truck_id — insurance billed for the whole
// fleet, accounting fees, permits, ...) has no direct, correct way to be
// "this truck's cost." For PER-TRUCK CPM purposes only (never for P&L/
// tax/true-profit, which stay unsplit — see CLAUDE.md invariant #6's
// "no per-truck tax math" spirit), it's allocated to a truck by that
// truck's share of TOTAL FLEET MILES for the period. This is an
// ALLOCATION, not a direct cost — every caller (app/src/stats/
// truckComparison.ts) must label it as such in the UI rather than
// blending it silently into a truck's own direct expenses.
export function allocateByMiles(fleetLevelPoolAmount: number, truckMiles: number, fleetTotalMiles: number): number {
  if (fleetTotalMiles <= 0 || truckMiles <= 0 || fleetLevelPoolAmount <= 0) return 0;
  return fleetLevelPoolAmount * (truckMiles / fleetTotalMiles);
}
