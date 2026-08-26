// MULTI-TRUCK MODEL (owner decision) — `loads` has no `truck_id` column of
// its own (it's attributed via `settlement_id` -> `settlements.truck_id`),
// so it can't use the same simple `useEntityList({truck_id: ...})` filter
// every other truck-taggable table uses (app/src/stats/fleetScope.ts). This
// is the ONE shared client-side filter the Loads screen uses instead — a
// load with no settlement_id (a manually-entered load, or a legacy row) is
// treated as unassigned, same as a null-truck_id row elsewhere, and is
// excluded from a specific-truck scope (never guessed into a truck it
// isn't attributed to) while still included under "All Trucks."
export function filterLoadsByTruckScope<L extends { settlement_id: string | null }>(
  loads: L[],
  settlements: { id: string; truck_id: string | null }[],
  activeTruckId: string | null
): L[] {
  if (activeTruckId === null) return loads;
  const settlementTruckId = new Map(settlements.map((s) => [s.id, s.truck_id]));
  return loads.filter((l) => l.settlement_id != null && settlementTruckId.get(l.settlement_id) === activeTruckId);
}
