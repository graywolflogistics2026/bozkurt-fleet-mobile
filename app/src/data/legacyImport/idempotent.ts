import { supabase } from '@/src/lib/supabase';

export type ImportOutcome = {
  idByKey: Map<string, string>;
  inserted: number;
  skipped: number;
  failed: number;
  firstError: string | null;
};

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

// Generic "safe to run twice" insert: fetches existing rows for this user,
// computes a natural key per row (caller-supplied, e.g. date+amount+desc),
// skips anything already present (either in the DB or duplicated within this
// same file), and inserts the rest. Returns a key->id map so callers can
// resolve cross-entity links (e.g. a deduction's new id) regardless of
// whether that row was just inserted or already existed.
//
// A single malformed row must never sink an entire entity's import (this is
// exactly what happened when settlements/deductions "succeeded" with almost
// nothing imported — a bulk insert() throws on ANY constraint violation in
// the batch, discarding every other valid row with it). We try the fast bulk
// path first; if it throws, we fall back to inserting row-by-row so the
// valid rows still land and we can report a precise failed count + the
// first error message instead of silently losing the whole batch.
export async function importIdempotent<Insert extends Record<string, unknown>>(opts: {
  table: string;
  userId: string;
  selectColumns: string; // must include 'id' plus every column keyOf() reads
  rows: Insert[];
  keyOf: (row: Record<string, unknown>) => string;
}): Promise<ImportOutcome> {
  const { data: existing, error } = await supabase
    .from(opts.table)
    .select(opts.selectColumns)
    .eq('user_id', opts.userId);
  if (error) {
    return { idByKey: new Map(), inserted: 0, skipped: 0, failed: opts.rows.length, firstError: errorMessage(error) };
  }

  const idByKey = new Map<string, string>();
  const existingRows = (existing ?? []) as unknown as Array<Record<string, unknown>>;
  for (const row of existingRows) {
    idByKey.set(opts.keyOf(row), row.id as string);
  }

  const seenThisBatch = new Set<string>();
  const toInsert: Array<Record<string, unknown>> = [];
  for (const row of opts.rows) {
    const key = opts.keyOf(row);
    if (idByKey.has(key) || seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);
    toInsert.push(row);
  }
  const skipped = opts.rows.length - toInsert.length;

  if (toInsert.length === 0) {
    return { idByKey, inserted: 0, skipped, failed: 0, firstError: null };
  }

  const { data: insertedRows, error: insertError } = await supabase.from(opts.table).insert(toInsert).select();
  if (!insertError) {
    const insertedArr = (insertedRows ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of insertedArr) {
      idByKey.set(opts.keyOf(row), row.id as string);
    }
    return { idByKey, inserted: insertedArr.length, skipped, failed: 0, firstError: null };
  }

  // Bulk insert failed — isolate the bad row(s) by inserting one at a time.
  let inserted = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const row of toInsert) {
    const { data: singleRow, error: rowError } = await supabase.from(opts.table).insert(row).select().single();
    if (rowError || !singleRow) {
      failed++;
      if (!firstError) firstError = errorMessage(rowError ?? new Error('insert returned no row'));
      continue;
    }
    const typedRow = singleRow as unknown as Record<string, unknown>;
    idByKey.set(opts.keyOf(typedRow), typedRow.id as string);
    inserted++;
  }

  return { idByKey, inserted, skipped, failed, firstError };
}
