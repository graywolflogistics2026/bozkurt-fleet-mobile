import type { LoanAgreementAssetType } from '@/src/import/types';

// ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
// DECISION) — matches a loan_agreement extraction's assetName against the
// user's existing trucks/trailers/equipment so the new Loan Center row
// can be auto-linked (truck/trailer.loan_id or equipment.loan_id).
// Deliberately NEVER forces a picker (same "less aggressive than
// truck/driver match" spirit as driverMatch.ts's resolveDriverMatch()) —
// the loan is always created in Loan Center regardless of whether a match
// is found; linking is a bonus, not a blocking requirement, so this never
// adds a mandatory extra step to an already-multi-step import flow.
export type LoanAssetMatch =
  | { kind: 'truck'; truckId: string }
  | { kind: 'trailer'; truckId: string }
  | { kind: 'equipment'; equipmentId: string }
  | { kind: 'none' };

export type LoanMatchTruck = { id: string; unit_number: string | null; trailer_unit_number: string | null };
export type LoanMatchEquipment = { id: string; name: string };

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function resolveLoanAssetMatch(
  assetType: LoanAgreementAssetType | undefined,
  assetName: string | undefined,
  trucks: LoanMatchTruck[],
  equipment: LoanMatchEquipment[]
): LoanAssetMatch {
  const target = norm(assetName);
  if (!target) return { kind: 'none' };

  if (assetType === 'trailer') {
    const matches = trucks.filter((t) => norm(t.trailer_unit_number) === target);
    return matches.length === 1 ? { kind: 'trailer', truckId: matches[0].id } : { kind: 'none' };
  }

  if (assetType === 'equipment') {
    const matches = equipment.filter((e) => norm(e.name) === target);
    return matches.length === 1 ? { kind: 'equipment', equipmentId: matches[0].id } : { kind: 'none' };
  }

  // assetType 'truck', 'other', or unset — try the tractor (most common
  // case) first, then fall back to equipment in case the AI's assetType
  // guess was wrong but the name still cleanly matches one equipment row.
  const truckMatches = trucks.filter((t) => norm(t.unit_number) === target);
  if (truckMatches.length === 1) return { kind: 'truck', truckId: truckMatches[0].id };

  const equipMatches = equipment.filter((e) => norm(e.name) === target);
  if (equipMatches.length === 1) return { kind: 'equipment', equipmentId: equipMatches[0].id };

  return { kind: 'none' };
}
