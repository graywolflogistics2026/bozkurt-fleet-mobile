// MULTI-TRUCK MODEL (owner decision) — `loads` has no `truck_id` column of
// its own (it's attributed via `settlement_id` -> `settlements.truck_id`),
// so it can't use the same simple `useEntityList({truck_id: ...})` filter
// every other truck-taggable table uses (app/src/stats/fleetScope.ts). This
// is the ONE shared client-side filter the Loads screen uses instead.
//
// NULL-TRUCK EXCLUSION FIX (owner decision, device report) — this
// function's ORIGINAL behavior excluded a load with no settlement_id at
// all, or whose settlement has no truck_id, from EVERY specific-truck
// scope, only ever showing it under "All Trucks" — the exact same bug
// class `entityHooks.ts`'s own applyFilters() fix addresses for every
// other truck-taggable table: a SINGLE-TRUCK account's `activeTruckId` is
// ALWAYS a real truck id (there is no "All Trucks" picker to reach for
// n=1 — ActiveTruckContext's own `showPicker: trucks.length > 1`), so an
// unassigned/fleet-level load was PERMANENTLY invisible for the majority
// of real accounts. Fixed the same way: a load attributed to NO truck
// (no settlement_id, or a settlement whose own truck_id is null) is never
// "genuinely truck-specific" to some OTHER truck, so it's included in
// EVERY specific-truck scope too, alongside that truck's own loads.
export function filterLoadsByTruckScope<L extends { settlement_id: string | null }>(
  loads: L[],
  settlements: { id: string; truck_id: string | null }[],
  activeTruckId: string | null
): L[] {
  if (activeTruckId === null) return loads;
  const settlementTruckId = new Map(settlements.map((s) => [s.id, s.truck_id]));
  return loads.filter((l) => {
    const truckId = l.settlement_id != null ? (settlementTruckId.get(l.settlement_id) ?? null) : null;
    return truckId == null || truckId === activeTruckId;
  });
}
