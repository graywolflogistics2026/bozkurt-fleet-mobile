import { supabase } from '@/src/lib/supabase';
import { missingColumnIn } from '@/src/data/fleetEdit';

// PROFIT EXPLAINER "possible duplicate: keep" (batch D item 8, §83). The
// write checks that a row actually changed and turns "column does not
// exist" into one clear error until §83 has run.

export class DuplicateKeepNotInstalledError extends Error {
  constructor() {
    super('Needs the database update PENDING_SQL §83');
    this.name = 'DuplicateKeepNotInstalledError';
  }
}

export type KeepableTable = 'deductions' | 'fuel_purchases' | 'maintenance_records' | 'tolls';

export async function keepPossibleDuplicate(table: KeepableTable, id: string, nowIso: string = new Date().toISOString()): Promise<void> {
  const { data, error } = await supabase.from(table).update({ duplicate_kept_at: nowIso }).eq('id', id).select('id');
  if (error) {
    if (missingColumnIn(error, ['duplicate_kept_at']) || error.code === '42703') throw new DuplicateKeepNotInstalledError();
    throw error;
  }
  if (!data || data.length === 0) throw new Error('Expense not found');
}
