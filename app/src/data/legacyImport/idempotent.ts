import { supabase } from '@/src/lib/supabase';

// Generic "safe to run twice" insert: fetches existing rows for this user,
// computes a natural key per row (caller-supplied, e.g. date+amount+desc),
// skips anything already present (either in the DB or duplicated within this
// same file), and bulk-inserts the rest. Returns a key->id map so callers can
// resolve cross-entity links (e.g. a deduction's new id) regardless of
// whether that row was just inserted or already existed.
export async function importIdempotent<Insert extends Record<string, unknown>>(opts: {
  table: string;
  userId: string;
  selectColumns: string; // must include 'id' plus every column keyOf() reads
  rows: Insert[];
  keyOf: (row: Record<string, unknown>) => string;
}): Promise<{ idByKey: Map<string, string>; inserted: number; skipped: number }> {
  const { data: existing, error } = await supabase
    .from(opts.table)
    .select(opts.selectColumns)
    .eq('user_id', opts.userId);
  if (error) throw error;

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

  let inserted = 0;
  if (toInsert.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase.from(opts.table).insert(toInsert).select();
    if (insertError) throw insertError;
    const insertedArr = (insertedRows ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of insertedArr) {
      idByKey.set(opts.keyOf(row), row.id as string);
    }
    inserted = insertedArr.length;
  }

  return { idByKey, inserted, skipped: opts.rows.length - toInsert.length };
}
