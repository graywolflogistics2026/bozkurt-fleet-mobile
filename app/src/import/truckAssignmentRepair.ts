// TRUCK ASSIGNMENT REPAIR FLOW (MULTI-TRUCK MODEL, owner decision) —
// requirement 3's "repair flow for EXISTING null-truck rows: a screen
// listing them with bulk assign." Scoped to the 4 tables that are
// operationally tied to one physical truck (settlements, fuel,
// maintenance, tolls) — `deductions` is deliberately NOT included here:
// most deductions are legitimately fleet-level (insurance, accounting
// fees, permits, ...) by design, so a bare "truck_id is null" scan would
// flag hundreds of correctly-fleet-level rows as if they were broken. A
// deduction that genuinely IS truck-specific is assigned from the
// Deductions edit sheet itself, on the user's own initiative, not swept
// into a "these are all missing something" repair list.
export type UnassignedRowKind = 'settlement' | 'fuel' | 'maintenance' | 'toll';

export type UnassignedRow = {
  kind: UnassignedRowKind;
  id: string;
  date: string | null;
  label: string;
  amount: number | null;
};

type SettlementLike = { id: string; truck_id: string | null; week_ending: string | null; gross: number | null; carrier?: string | null };
type FuelLike = { id: string; truck_id: string | null; purchase_date: string | null; location: string | null; amount: number | null };
type MaintenanceLike = { id: string; truck_id: string | null; service_date: string | null; description: string | null; cost: number | null };
type TollLike = { id: string; truck_id: string | null; toll_date: string | null; plaza: string | null; amount: number | null };

export function findUnassignedRows(
  settlements: SettlementLike[],
  fuel: FuelLike[],
  maintenance: MaintenanceLike[],
  tolls: TollLike[]
): UnassignedRow[] {
  const rows: UnassignedRow[] = [
    ...settlements
      .filter((s) => !s.truck_id)
      .map((s) => ({ kind: 'settlement' as const, id: s.id, date: s.week_ending, label: s.carrier ?? '', amount: s.gross })),
    ...fuel
      .filter((f) => !f.truck_id)
      .map((f) => ({ kind: 'fuel' as const, id: f.id, date: f.purchase_date, label: f.location ?? '', amount: f.amount })),
    ...maintenance
      .filter((m) => !m.truck_id)
      .map((m) => ({ kind: 'maintenance' as const, id: m.id, date: m.service_date, label: m.description ?? '', amount: m.cost })),
    ...tolls
      .filter((t) => !t.truck_id)
      .map((t) => ({ kind: 'toll' as const, id: t.id, date: t.toll_date, label: t.plaza ?? '', amount: t.amount })),
  ];
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// The Supabase table each kind's row lives in — the ONE place a screen
// needs to look up which `useUpdateX()` mutation to call for a given row.
export const UNASSIGNED_ROW_TABLE: Record<UnassignedRowKind, 'settlements' | 'fuel_purchases' | 'maintenance_records' | 'tolls'> = {
  settlement: 'settlements',
  fuel: 'fuel_purchases',
  maintenance: 'maintenance_records',
  toll: 'tolls',
};
