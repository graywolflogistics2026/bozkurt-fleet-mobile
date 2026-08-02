jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));

import { EXPORT_TABLES } from '@/src/data/exportAllData';

// PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code review
// finding): `equipment` (PENDING_SQL.md §36) was added to delete-account's
// and reset-data's TABLES_IN_DELETION_ORDER but never to EXPORT_TABLES, so
// a "Export All My Data" download silently omitted every equipment row.
// The Deno Edge Function and this React Native module can't share a
// literal (same reason queryInvalidation.test.ts mirrors
// TABLES_IN_DELETION_ORDER instead of importing it), so this mirrors
// delete-account's own list as of 2026-08-02 and asserts every user-owned
// table it deletes also has a matching row in EXPORT_TABLES — keep both
// lists in sync by hand. tax_year_data is deliberately excluded: it is
// NOT user-scoped (CLAUDE.md invariant #6), so it belongs in neither list.
describe('EXPORT_TABLES', () => {
  it('includes every user-owned table delete-account deletes (TABLES_IN_DELETION_ORDER mirror)', () => {
    const TABLES_IN_DELETION_ORDER = [
      'bank_transactions',
      'bank_statements',
      'credit_cards',
      'loans',
      'tolls',
      'reimbursements',
      'capital_transactions',
      'deductions',
      'loads',
      'fuel_purchases',
      'maintenance_records',
      'settlements',
      'maintenance_intervals',
      'truck_health_config',
      'trucks',
      'equipment',
      'driver_payments',
      'household_income',
      'household_members',
      'user_categories',
      'compliance_items',
      'misc_income',
      'documents',
      'tax_config',
      'profiles',
    ];
    for (const table of TABLES_IN_DELETION_ORDER) {
      expect((EXPORT_TABLES as readonly string[])).toContain(table);
    }
  });

  it('includes equipment specifically (the exact reported gap)', () => {
    expect((EXPORT_TABLES as readonly string[])).toContain('equipment');
  });

  it('has no duplicate table names', () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});
