export type DriverMatchResult = {
  driverId: string | null;
  needsPicker: boolean;
};

// Payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION):
// settlements/loads/fuel_purchases/withheld deductions get tagged with
// driver_id the same way truck_id already works (see truckMatch.ts) — but
// unlike a truck, a driver is an OPTIONAL entity: an account with zero
// driver rows, or a settlement with no driverName extracted at all, is
// left with driver_id null and no picker forced. A picker only surfaces
// when a name WAS extracted but doesn't cleanly resolve to exactly one
// existing driver (case-insensitive, trimmed match) — that's the only
// case genuinely worth asking the user about.
export function resolveDriverMatch(
  extractedName: string | undefined,
  drivers: Array<{ id: string; name: string }>
): DriverMatchResult {
  if (drivers.length === 0) return { driverId: null, needsPicker: false };

  const normalized = (extractedName ?? '').trim().toLowerCase();
  if (!normalized) return { driverId: null, needsPicker: false };

  const matches = drivers.filter((d) => d.name.trim().toLowerCase() === normalized);
  if (matches.length === 1) return { driverId: matches[0].id, needsPicker: false };

  return { driverId: null, needsPicker: true };
}
