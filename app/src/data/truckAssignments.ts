import { supabase } from '@/src/lib/supabase';
import { UNASSIGNED_ROW_TABLE, type UnassignedRow } from '@/src/import/truckAssignmentRepair';

// TRUCK ASSIGNMENTS — CONFIRMED-DATA-LOSS AUDIT (owner decision, device
// report: "using this screen deletes rows instead of assigning them to a
// truck"). Full audit before writing anything: traced every call this
// screen's own handlers make. `app/(tabs)/more/truck-assignments.tsx`'s
// per-row (`openRowPicker`) and bulk (`handleBulkAssign`) paths BOTH
// exclusively called `useUpdateSettlement`/`useUpdateFuelPurchase`/
// `useUpdateMaintenanceRecord`/`useUpdateToll` — every one of those is
// `createEntityHooks(<table>).useEntityUpdate` (src/data/entityHooks.ts),
// which issues `supabase.from(table).update(values).eq('id', id)`. There
// is NO `.delete()` call reachable from anywhere in this screen's code —
// confirmed by reading entityHooks.ts's useEntityUpdate/useEntityDelete
// side by side (they are genuinely different code paths) and by this
// file's own git history: only ONE commit (08cdc2c) has ever touched
// truck-assignments.tsx or truckAssignmentRepair.ts — there is no prior
// "buggy" version this could have regressed from.
//
// This function is a REFACTOR, not a bug fix for a delete-instead-of-
// update defect (none was found) — it extracts the screen's previously
// inline, unexported, untestable per-row/bulk logic into one exported,
// directly-testable function, and fixes one REAL gap found while
// auditing: the old inline `handleBulkAssign()` wrapped its whole for-loop
// in a single try/catch, so ONE row's update failure (e.g. a genuine
// settlements_user_week_truck_uidx collision — two different unassigned
// settlements for the same week_ending both being bulk-assigned to the
// same truck in one batch) aborted the ENTIRE batch, silently leaving
// every row AFTER the failing one still unassigned with no per-row
// report of what happened. This function never aborts on one row's
// failure — every row is attempted, successes and failures are both
// collected and returned, mirroring this codebase's own established
// insertBatchResilient() convention (aiImportSave.ts) for exactly this
// class of "one bad row must never take down the whole batch" problem.
//
// Every operation here is `update({truck_id})` scoped by the row's own
// id — never any other column, never a delete, for any of the 4 tables
// this screen touches (settlements/fuel_purchases/maintenance_records/
// tolls).
export type TruckAssignmentFailure = { row: UnassignedRow; message: string };
export type TruckAssignmentResult = {
  succeeded: UnassignedRow[];
  failed: TruckAssignmentFailure[];
};

export async function assignRowsToTruck(rows: UnassignedRow[], truckId: string): Promise<TruckAssignmentResult> {
  const succeeded: UnassignedRow[] = [];
  const failed: TruckAssignmentFailure[] = [];
  for (const row of rows) {
    const table = UNASSIGNED_ROW_TABLE[row.kind];
    const { error } = await supabase.from(table).update({ truck_id: truckId }).eq('id', row.id);
    if (error) failed.push({ row, message: error.message ?? 'Unknown error' });
    else succeeded.push(row);
  }
  return { succeeded, failed };
}
