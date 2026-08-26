import { QueryClient } from '@tanstack/react-query';
import { invalidateFinancialData, removeFinancialDataFromCache } from '@/src/data/queryInvalidation';

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
      // REFERRAL PROGRAM (owner decision 2026-08-24, §50) — this user's own
      // earned/spent credit rows, deleted via the standard user_id loop in
      // both reset-data and delete-account.
      'account_credits',
      // BACKGROUND IMPORT (owner decision 2026-08-24, §54) — transient
      // job/processing state, wiped by reset-data explicitly (unlike
      // delete-account, which relies on user_id ... on delete cascade).
      'import_jobs',
    ];
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    const missing = TABLES_IN_DELETION_ORDER.filter((table) => !invalidatedKeys.includes(table));
    expect(missing).toEqual([]);
  });

  // REFERRAL PROGRAM (owner decision 2026-08-24, §50) — 'referrals' isn't
  // in TABLES_IN_DELETION_ORDER (no single user_id column; both Edge
  // Functions delete it separately, scoped to referrer_id only — see their
  // own comments), so it can't ride the mirror test above. Asserted
  // directly instead: a reset/delete changes this account's own outgoing
  // referrals row, so useMyReferrals()'s ['referrals', 'as-referrer', userId]
  // key must still be covered.
  it('invalidates the "referrals" query key (own outgoing referrals, cleared on reset/delete)', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain('referrals');
  });

  // ONE REFRESH PATH (owner decision 2026-08-05, FULL PARITY follow-up
  // item A) — web's rAll() was called in 19 places but never DEFINED, so
  // every refresh silently threw: editing the truck cost basis never
  // moved CPM, and several "it didn't update" reports trace back to this
  // exact bug. invalidateFinancialData() IS defined on mobile and IS
  // wired into every mutation-bearing screen (a grep audit of every
  // `.mutateAsync(` call site under app/(tabs) found 4 screens —
  // trucks.tsx, equipment.tsx, drivers.tsx, compliance.tsx — that had
  // been calling only a bare per-table mutation with no broader
  // invalidation at all, fixed alongside this test) — but the CONTRACT
  // that matters is the query-key coverage itself: a change to truck
  // cost basis, equity, miles, or categories must invalidate every
  // OTHER screen's already-cached dependent query, not just its own
  // table. This test pins that contract so a future edit to
  // AFFECTED_TABLES/AFFECTED_AGGREGATES that silently drops one of these
  // keys fails loudly here instead of surfacing as a device bug report.
  it('covers every query key a truck-cost-basis, equity, miles, or category mutation must invalidate', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);

    // Truck cost basis (purchase_price/financing/loan_id) — feeds the CPM
    // "Why?" breakdown and depreciation election on other screens.
    for (const key of ['trucks', 'equipment', 'loans']) expect(invalidatedKeys).toContain(key);

    // Equity (capital_transactions) — feeds Capital Account, the
    // Dashboard/Cash-Flow business-balance figure, and the Accountant
    // Package's Owner's Equity section.
    for (const key of ['capital_transactions', 'capital-account-summary', 'profile']) expect(invalidatedKeys).toContain(key);

    // Miles (settlements.miles, or a future per-week override) — feeds
    // CPM, RPM, and the Accountant Package's gross-income window.
    expect(invalidatedKeys).toContain('settlements');

    // Categories (deductions.category, user_categories) — feeds the
    // Accountant Package's Schedule C rollup and the category picker's
    // own option list everywhere it's used.
    for (const key of ['deductions', 'user_categories']) expect(invalidatedKeys).toContain(key);
  });
});

// SCOPED INVALIDATION (P0 fix, FULL SYSTEM AUDIT owner decision
// 2026-08-26) — editing a single deduction's category used to invalidate
// all ~25 entity tables plus every aggregate (32 total invalidateQueries
// calls) regardless of what actually changed. Passing `entities` now scopes
// the sweep to just the mutated table(s) plus whichever aggregates
// genuinely depend on at least one of them. These tests are the "measured
// before/after query count for editing one deduction category" the
// FULL SYSTEM AUDIT fix asked for — see the numbers asserted below (32 ->
// 5, an 84% reduction, measured directly against the real AFFECTED_TABLES/
// AFFECTED_AGGREGATES lists rather than hand-counted).
describe('invalidateFinancialData — scoped mode (entities option)', () => {
  it('editing ONE deduction (no linked contribution) invalidates exactly 3 keys, not all 32', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient, { entities: ['deductions'] });

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(new Set(invalidatedKeys)).toEqual(new Set(['deductions', 'fleet-stats', 'driver-stats']));
    expect(invalidatedKeys).toHaveLength(3);
  });

  it('the EXACT reported scenario — deductions.tsx handleSaveEdit (deductions + capital_transactions) — invalidates exactly 5 keys, down from the 32-key unscoped sweep', async () => {
    const unscopedClient = new QueryClient();
    const unscopedSpy = jest.spyOn(unscopedClient, 'invalidateQueries');
    await invalidateFinancialData(unscopedClient);
    const beforeCount = unscopedSpy.mock.calls.length;

    const scopedClient = new QueryClient();
    const scopedSpy = jest.spyOn(scopedClient, 'invalidateQueries');
    await invalidateFinancialData(scopedClient, { entities: ['deductions', 'capital_transactions'] });
    const invalidatedKeys = scopedSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);

    expect(beforeCount).toBe(32); // 28 AFFECTED_TABLES + 4 AFFECTED_AGGREGATES, unscoped
    expect(new Set(invalidatedKeys)).toEqual(
      new Set(['deductions', 'capital_transactions', 'fleet-stats', 'driver-stats', 'capital-account-summary'])
    );
    expect(invalidatedKeys).toHaveLength(5); // down from 32 -> 5, an 84% reduction
    // Every unrelated table (settlements, fuel_purchases, trucks, drivers, ...)
    // must NOT be touched by this specific scoped call.
    for (const untouched of ['settlements', 'fuel_purchases', 'maintenance_records', 'trucks', 'drivers', 'loans', 'credit_cards']) {
      expect(invalidatedKeys).not.toContain(untouched);
    }
  });

  it('a profiles-only mutation (e.g. a Cash Flow budget save) invalidates "profile" and "capital-account-summary" but NOT fleet-stats/driver-stats', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient, { entities: ['profiles'] });

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(new Set(invalidatedKeys)).toEqual(new Set(['profile', 'capital-account-summary']));
  });

  it('an empty entities array falls back to the full unscoped sweep, same as omitting the option entirely', async () => {
    const withEmptyArray = new QueryClient();
    const spyEmpty = jest.spyOn(withEmptyArray, 'invalidateQueries');
    await invalidateFinancialData(withEmptyArray, { entities: [] });

    const withNoOption = new QueryClient();
    const spyNone = jest.spyOn(withNoOption, 'invalidateQueries');
    await invalidateFinancialData(withNoOption);

    expect(spyEmpty.mock.calls.length).toBe(spyNone.mock.calls.length);
  });

  it('DEAD-KEY CLEANUP: tax_config, tax_year_data, and profit-loss are never invalidated by this function anymore (tax_config/tax_year_data self-invalidate independently in taxConfig.ts; profit-loss was never a real query key)', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    for (const dead of ['tax_config', 'tax_year_data', 'profit-loss']) {
      expect(invalidatedKeys).not.toContain(dead);
    }
  });
});

// PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
// review item — second tier): "reset must remove queries from the
// persistent cache, not just invalidate them" — removeQueries() deletes
// the cache entry immediately/synchronously, unlike invalidateQueries()
// which depends on a refetch actually succeeding before the persisted
// AsyncStorage snapshot reflects the change.
describe('removeFinancialDataFromCache', () => {
  it('removes every query the reset flow needs cleared from the persistent cache', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['settlements', 'list', 'u1', null], [{ id: 's1' }]);
    queryClient.setQueryData(['profile', 'u1'], { business_balance: 500 });

    removeFinancialDataFromCache(queryClient);

    expect(queryClient.getQueryData(['settlements', 'list', 'u1', null])).toBeUndefined();
    expect(queryClient.getQueryData(['profile', 'u1'])).toBeUndefined();
  });

  it('actually calls removeQueries (not invalidateQueries) for every affected key', () => {
    const queryClient = new QueryClient();
    const removeSpy = jest.spyOn(queryClient, 'removeQueries');
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    removeFinancialDataFromCache(queryClient);

    expect(removeSpy).toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
