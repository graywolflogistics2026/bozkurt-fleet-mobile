// MULTI-TRUCK MODEL (owner decision) — requirement 1: "No screen may
// silently apply its own filter." This is the ONE shared translation from
// the global scope selector's value (ActiveTruckContext's `activeTruckId`
// — null means "All Trucks" whenever trucks.length > 1, see that file's
// own header comment) to the `truck_id` filter every list screen's
// `useEntityList()` call passes — `undefined` skips the filter entirely
// (createEntityHooks's own `if (value === undefined) continue`), matching
// "All Trucks" exactly; a truck id filters to just that truck. Every list
// screen (settlements/loads/fuel/maintenance/tolls/deductions) must
// build its filters through this function, never a screen-local
// `scope === 'all' ? undefined : scope` inline — that's exactly the kind
// of screen-by-screen divergence requirement 1 forbids.
export function truckIdFilterFor(activeTruckId: string | null): string | undefined {
  return activeTruckId ?? undefined;
}
