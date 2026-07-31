import { QueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';

// 2026-07-30 tablet-testing fix: Reset All Data correctly nulled
// weekly_goal/cf_* on profiles server-side, but the Cash Flow forecast
// screen and CEO Mode kept showing stale cached values because 'profile'
// (useProfile(), src/data/profile.ts) was never in this invalidation
// list — only AuthContext's own narrower profile fetch got refreshed.
describe('invalidateFinancialData', () => {
  it('invalidates the "profile" query key (the full profiles row useProfile() reads)', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain('profile');
    expect(invalidatedKeys).toContain('dashboard-layout');
  });

  it('always forces an eager refetch (refetchType "all"), not just marking queries stale', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    expect(spy.mock.calls.every((call) => (call[0] as { refetchType?: string }).refetchType === 'all')).toBe(true);
  });

  // DATA-FLOW AUDIT (owner decision 2026-07-30, mega-pass part A): Reset
  // All Data (supabase/functions/reset-data/index.ts) wipes every table in
  // TABLES_IN_DELETION_ORDER and calls invalidateFinancialData() as its
  // only client-side cache refresh — any wiped table missing from this
  // invalidation list shows STALE data after a reset. The Deno Edge
  // Function and this React Native module can't share a literal, so this
  // mirrors TABLES_IN_DELETION_ORDER as of 2026-07-30 and asserts every
  // one of them gets invalidated — keep both lists in sync by hand.
  it('invalidates every table Reset All Data wipes (TABLES_IN_DELETION_ORDER mirror)', async () => {
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
      'drivers',
      'driver_payments',
      'household_income',
      'household_members',
      'user_categories',
      'compliance_items',
      'misc_income',
      'documents',
    ];
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    const missing = TABLES_IN_DELETION_ORDER.filter((table) => !invalidatedKeys.includes(table));
    expect(missing).toEqual([]);
  });
});
