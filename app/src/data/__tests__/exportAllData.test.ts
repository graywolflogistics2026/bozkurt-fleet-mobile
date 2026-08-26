let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { EXPORT_TABLES, fetchAllUserData } from '@/src/data/exportAllData';

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
    // Mirrors supabase/functions/delete-account/index.ts's real
    // TABLES_IN_DELETION_ORDER as of this pass — corrected here to include
    // category_learning_rules and account_credits, which the OLD version
    // of this mirror had silently drifted from the real array (a stale
    // regression guard is exactly the kind of gap this test exists to
    // catch, so it's fixed alongside the P1 export-completeness fix
    // rather than left quietly wrong). ai_credit_purchases is correctly
    // NOT in delete-account's own list — it has no explicit delete step,
    // relying instead on its own `user_id ... on delete cascade` FK to
    // auth.users (same established pattern as ai_usage_log) — so it's not
    // expected here even though it IS in EXPORT_TABLES.
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
      'category_learning_rules',
      'compliance_items',
      'misc_income',
      'documents',
      'tax_config',
      'account_credits',
      'profiles',
    ];
    for (const table of TABLES_IN_DELETION_ORDER) {
      expect((EXPORT_TABLES as readonly string[])).toContain(table);
    }
  });

  it('includes equipment specifically (the exact reported gap)', () => {
    expect((EXPORT_TABLES as readonly string[])).toContain('equipment');
  });

  // EXPORT ALL MY DATA omits account_credits/ai_credit_purchases/referrals
  // (P1 fix, FULL SYSTEM AUDIT) — the exact reported gap.
  it('includes account_credits and ai_credit_purchases (both fit the standard user_id loop)', () => {
    expect((EXPORT_TABLES as readonly string[])).toContain('account_credits');
    expect((EXPORT_TABLES as readonly string[])).toContain('ai_credit_purchases');
  });

  it('has no duplicate table names', () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});

describe('fetchAllUserData — referrals bespoke query (P1 fix)', () => {
  const USER_ID = 'user-1';

  beforeEach(() => {
    mockClient = createFakeSupabase({
      profiles: [{ id: 'p1', user_id: USER_ID }],
      referrals: [
        // This user is the REFERRER.
        { id: 'r1', referrer_id: USER_ID, referred_user_id: 'other-user', status: 'qualified' },
        // This user is the REFERRED person (someone else referred them).
        { id: 'r2', referrer_id: 'other-user-2', referred_user_id: USER_ID, status: 'pending' },
        // Neither — must never appear in this user's export.
        { id: 'r3', referrer_id: 'someone-else', referred_user_id: 'someone-else-2', status: 'qualified' },
      ],
    });
  });

  it('includes referrals in BOTH directions (referrer and referred) but never a row belonging to someone else', async () => {
    const result = await fetchAllUserData(USER_ID);
    const ids = (result.referrals as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual(['r1', 'r2']);
  });

  it('every table in EXPORT_TABLES is present in the result alongside referrals', async () => {
    const result = await fetchAllUserData(USER_ID);
    for (const table of EXPORT_TABLES) {
      expect(result[table]).toBeDefined();
    }
    expect(result.referrals).toBeDefined();
  });
});
