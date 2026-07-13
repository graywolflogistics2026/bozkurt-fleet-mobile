import { supabase } from '@/src/lib/supabase';

// Full-account JSON export (Settings, Session 9b parity-gap decision #1
// — owner decision 2026-07-12): mirrors legacy's own exportData()
// (a full localStorage-backed JSON dump), reimplemented as one row per
// user-owned table. Excludes nothing — every table this app writes user
// data into is listed here. Does NOT bundle the actual files in Supabase
// Storage (documents/backups buckets) — same scope as legacy's own
// export, which only ever dumped its local JSON state, never the PDFs
// that lived in Google Drive separately.
//
// Order doesn't matter here (unlike supabase/functions/delete-account's
// TABLES_IN_DELETION_ORDER, which is FK-constrained) — this is a set of
// independent read-only SELECTs, not a deletion sequence.
export const EXPORT_TABLES = [
  'profiles',
  'tax_config',
  'trucks',
  'drivers',
  'settlements',
  'loads',
  'fuel_purchases',
  'deductions',
  'capital_transactions',
  'maintenance_records',
  'maintenance_intervals',
  'truck_health_config',
  'tolls',
  'reimbursements',
  'loans',
  'credit_cards',
  'bank_statements',
  'bank_transactions',
  'documents',
  'driver_payments',
  'household_members',
  'household_income',
  'user_categories',
  'compliance_items',
  'misc_income',
] as const;

export type AllUserData = Record<(typeof EXPORT_TABLES)[number], unknown[]>;

export async function fetchAllUserData(userId: string): Promise<AllUserData> {
  const results = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
      if (error) throw new Error(`Failed exporting ${table}: ${error.message}`);
      return [table, data ?? []] as const;
    })
  );
  return Object.fromEntries(results) as AllUserData;
}
