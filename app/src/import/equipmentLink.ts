import { isEquipmentTypeCategory } from '@/src/import/category';

// EQUIPMENT AUTO-POPULATE FROM IMPORTS (owner decision, SIMPLIFICATION
// PASS, item 7, binding): a settlement or standalone purchase deduction
// line landing in a durable-goods category (EQUIPMENT_TYPE_CATEGORIES,
// category.ts) also gets a linked Equipment row — the SAME item still
// appears once in Deductions as the expense and once in Equipment as the
// tracked asset, linked by id, mirroring the exact pattern already
// established for personally-paid expenses <-> capital contributions
// (deductions.linked_deduction_id-style id-linking, applyContributionSync()'s
// spirit). Pure, tested module — the impure Supabase write itself lives in
// aiImportSave.ts, same "pure module decides, impure orchestration layer
// writes" split every other mapper in this directory already follows.
export type EquipmentSourceRow = {
  category: string | null | undefined;
  description: string | null | undefined;
  amount: number;
  ded_date: string | null | undefined;
  store: string | null | undefined;
};

export type EquipmentLinkInsert = {
  user_id: string;
  name: string;
  category: string;
  purchase_price: number;
  purchase_date: string | null;
  vendor: string | null;
  linked_deduction_id: string;
};

// Returns null (never inserts anything) when the row's own category isn't
// one of the durable-goods categories — the ONE gate every caller relies
// on, so "does this deduction get a linked Equipment row" is decided in
// exactly one place.
export function buildLinkedEquipmentInsert(row: EquipmentSourceRow, dedId: string, userId: string): EquipmentLinkInsert | null {
  if (!isEquipmentTypeCategory(row.category) || !row.category) return null;
  const description = (row.description ?? '').trim();
  return {
    user_id: userId,
    // A real description always wins; a genuinely blank one (rare — every
    // extraction path already tries hard to produce one) falls back to
    // the category name rather than an empty Equipment row title.
    name: description || row.category,
    category: row.category,
    purchase_price: row.amount,
    purchase_date: row.ded_date ?? null,
    vendor: row.store?.trim() || null,
    linked_deduction_id: dedId,
  };
}

// ONE-TIME BACKFILL (owner decision, SIMPLIFICATION PASS, item 7.4) —
// scans deductions already sitting in an equipment-type category from
// BEFORE this feature existed and finds which ones still need a linked
// Equipment row created. Pure decision logic — the actual Supabase fetch/
// insert lives in orphanCleanup.ts, same "pure module decides, impure
// layer writes" split as every other mapper in this directory.
export type BackfillDeductionRow = EquipmentSourceRow & { id: string };
export type ExistingEquipmentRow = {
  linked_deduction_id: string | null;
  name: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
};

function fuzzyKey(name: string | null, amount: number | null, date: string | null): string {
  return `${(name ?? '').trim().toLowerCase()}|${amount ?? ''}|${date ?? ''}`;
}

// Never creates a duplicate for a deduction that already has a linked
// Equipment row — checked TWO ways, defensively: (1) by
// linked_deduction_id, the normal case going forward; (2) by a fuzzy
// match on description+amount+date, in case an Equipment row was created
// some other way (manually, or by an earlier, less careful pass) before
// this feature's own id-linking existed.
export function findMissingEquipmentBackfill(deductions: BackfillDeductionRow[], existingEquipment: ExistingEquipmentRow[]): BackfillDeductionRow[] {
  const linkedDeductionIds = new Set(existingEquipment.map((e) => e.linked_deduction_id).filter((id): id is string => !!id));
  const fuzzyKeys = new Set(existingEquipment.map((e) => fuzzyKey(e.name, e.purchase_price, e.purchase_date)));
  return deductions.filter((d) => {
    if (!isEquipmentTypeCategory(d.category)) return false;
    if (linkedDeductionIds.has(d.id)) return false;
    if (fuzzyKeys.has(fuzzyKey(d.description ?? null, d.amount, d.ded_date ?? null))) return false;
    return true;
  });
}
