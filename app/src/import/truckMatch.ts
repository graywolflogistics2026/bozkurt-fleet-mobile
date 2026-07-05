export type TruckMatchResult = {
  truckId: string | null;
  needsPicker: boolean;
};

// PROMPTS.md Session 6 (fleet scalability, owner decision 2026-07-03):
// settlements/fuel_purchases/maintenance_records created by an import must
// be tagged with truck_id. With exactly 1 truck, skip matching entirely and
// tag it automatically (same n=1 shortcut as the active-truck context).
// With 2+ trucks, match the AI-extracted unit number against
// trucks.unit_number; exactly one match tags silently, zero or multiple
// matches surface a picker — never guess, never leave truck_id null.
export function resolveTruckMatch(
  extractedUnit: string | undefined,
  trucks: Array<{ id: string; unit_number: string | null }>
): TruckMatchResult {
  if (trucks.length === 0) return { truckId: null, needsPicker: false };
  if (trucks.length === 1) return { truckId: trucks[0].id, needsPicker: false };

  const normalized = (extractedUnit ?? '').trim();
  if (normalized) {
    const matches = trucks.filter((t) => (t.unit_number ?? '').trim() === normalized);
    if (matches.length === 1) return { truckId: matches[0].id, needsPicker: false };
  }

  return { truckId: null, needsPicker: true };
}
