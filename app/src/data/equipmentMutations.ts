import { supabase } from '@/src/lib/supabase';

// EQUIPMENT AUTO-POPULATE — BIDIRECTIONAL DELETE (owner decision,
// SIMPLIFICATION PASS, item 7.4): deleting the DEDUCTION side already
// cascades to remove its linked Equipment row automatically at the DB
// level (equipment.linked_deduction_id on delete cascade,
// docs/PENDING_SQL.md §73). There is no equivalent FK for the REVERSE
// direction — a deduction row has nothing pointing at equipment for a
// cascade to hang off of — so deleting an Equipment row that has a
// linked_deduction_id ALSO explicitly deletes that deduction, here, in
// one testable function `app/(tabs)/more/equipment.tsx`'s own delete
// handler calls (rather than inlining the two-step sequence in the
// screen, which this repo's own "no RN rendering harness" limitation
// would leave completely untested).
//
// The Equipment row's own delete always happens FIRST and is never
// undone if the linked-deduction delete then fails — the Equipment row
// deletion is the primary action the user asked for; a failure to also
// remove the linked deduction is reported back (never thrown) so the
// caller can surface it without pretending the whole action failed.
export async function deleteEquipmentWithLinkedDeduction(
  equipmentId: string,
  linkedDeductionId: string | null
): Promise<{ linkedDeductionDeleteFailed: boolean }> {
  const { error } = await supabase.from('equipment').delete().eq('id', equipmentId);
  if (error) throw error;
  if (!linkedDeductionId) return { linkedDeductionDeleteFailed: false };
  const { error: dedError } = await supabase.from('deductions').delete().eq('id', linkedDeductionId);
  return { linkedDeductionDeleteFailed: !!dedError };
}
