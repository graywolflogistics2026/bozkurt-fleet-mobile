import type { QueryClient } from '@tanstack/react-query';

// Every entity-hook list query is keyed [table, 'list', userId, filters]
// (src/data/entityHooks.ts) — invalidating by the bare table-name prefix
// also matches every filtered variant, since react-query does prefix
// matching on query keys, not exact-array equality.
//
// DATA-FLOW AUDIT FIX (owner decision 2026-07-30, mega-pass part A): this
// list must cover EVERY table `supabase/functions/reset-data/index.ts`'s
// TABLES_IN_DELETION_ORDER wipes — Reset All Data calls
// invalidateFinancialData() as its one client-side cache-refresh step
// (app/(tabs)/more/settings.tsx), so any wiped table missing here shows
// STALE (pre-reset) data until something else happens to refetch it. This
// audit found 8 tables silently missing (trucks, drivers, driver_payments,
// household_income, household_members, compliance_items,
// maintenance_intervals, truck_health_config) — none of them are wired to
// any OTHER invalidation path, so a user resetting their account kept
// seeing their old truck, driver, and compliance data on Truck Health, the
// Drivers screen, and Documents & Renewals until they force-quit the app.
// These two files can't share a literal (Deno Edge Function vs React
// Native) — src/data/__tests__/queryInvalidation.test.ts asserts this list
// against a mirrored copy of TABLES_IN_DELETION_ORDER as a regression
// guard; update both together.
const AFFECTED_TABLES = [
  'settlements',
  'deductions',
  'fuel_purchases',
  'maintenance_records',
  'capital_transactions',
  'loads',
  'documents',
  'reimbursements',
  'tolls',
  'loans',
  'credit_cards',
  'bank_statements',
  'bank_transactions',
  'misc_income',
  'user_categories',
  'category_learning_rules',
  'trucks',
  'equipment',
  'drivers',
  'driver_payments',
  'household_income',
  'household_members',
  'compliance_items',
  'maintenance_intervals',
  'truck_health_config',
  // REFERRAL PROGRAM (owner decision 2026-08-24, docs/PENDING_SQL.md §50)
  // — 'account_credits' is in both Edge Functions' TABLES_IN_DELETION_ORDER
  // (the user's own earned/spent credit rows, deleted via the standard
  // user_id loop) so it's included here for the same reason every other
  // entry in this list is. 'referrals' is NOT in either
  // TABLES_IN_DELETION_ORDER (it has no single user_id column — both
  // functions delete it separately, scoped to referrer_id only) but a
  // reset/delete still changes rows this account can see (its own
  // outgoing referrals), so it's listed here too — the Referral screen's
  // useMyReferrals() key (['referrals', 'as-referrer', userId]) is still
  // matched by react-query's prefix invalidation on the bare 'referrals'
  // key below.
  'account_credits',
  'referrals',
  // BACKGROUND IMPORT (owner decision 2026-08-24, docs/PENDING_SQL.md §54)
  // — Reset All Data wipes import_jobs (reset-data's own
  // TABLES_IN_DELETION_ORDER); this key is what useImportJobs() reads
  // from, so a stale cached job list would otherwise survive a reset.
  'import_jobs',
];

// Derived/aggregate query keys that read from the tables above but aren't
// plain entity-hook lists (dashboardStats.ts, capitalAccount.ts,
// taxConfig.ts) — an import can move profiles.business_balance and add
// capital_transactions rows, both of which feed these.
//
// 'profile' (useProfile(), src/data/profile.ts — the FULL profiles row,
// distinct from AuthContext's own narrower fetch) was missing here until
// 2026-07-30's tablet-testing fix: Reset All Data correctly nulled
// weekly_goal/cf_* server-side, but the Cash Flow forecast screen and
// CEO Mode kept showing the stale cached values because nothing ever
// invalidated this query key — reset-data (and any future flow that
// changes profiles columns outside useUpdateProfile's own mutation,
// which already invalidates it) needs this listed explicitly.
//
// 'dashboard-layout' was removed here (DASHBOARD SIMPLIFICATION, owner
// decision 2026-08-02) — the Customize Dashboard feature that owned that
// query key (useDashboardLayout(), src/data/dashboardLayout.ts) was
// deleted entirely along with its screen; nothing reads that key anymore.
const AFFECTED_AGGREGATES = [
  'fleet-stats',
  'driver-stats',
  'capital-account-summary',
  'tax_config',
  'tax_year_data',
  'profit-loss',
  'profile',
];

// A bare queryClient.invalidateQueries() call only eagerly refetches
// queries with an ACTIVE observer (refetchType defaults to 'active') — a
// tab screen that's mounted-but-detached (react-native-screens can detach
// inactive tab screens) or hasn't been visited yet this session is left
// merely marked stale, so it silently shows old data until something else
// happens to remount/refocus it. refetchType 'all' forces every matching
// query to refetch right now regardless of observer state, which is what
// "the Dashboard must reflect new data immediately" actually requires.
export async function invalidateFinancialData(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    [...AFFECTED_TABLES, ...AFFECTED_AGGREGATES].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key], refetchType: 'all' })
    )
  );
}

// PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
// review item — second tier): Reset All Data used to call ONLY
// invalidateFinancialData() above — which marks these queries stale and
// (with refetchType 'all') eagerly refetches them, but never removes the
// PERSISTED AsyncStorage snapshot (src/lib/queryClient.ts) those queries
// were saved under. If the refetch didn't finish before the app was
// backgrounded/closed (a slow network right after Reset is a realistic
// case for a trucker), the persister's next save cycle could still write
// — or simply never overwrite — the pre-reset data, so a cold relaunch
// could show STALE pre-reset numbers again until each screen happened to
// refetch on its own. queryClient.removeQueries() deletes these entries
// from the in-memory cache immediately and unconditionally (not
// dependent on a network round-trip succeeding), which is what actually
// guarantees the persisted snapshot can never resurrect them. Call this
// BEFORE invalidateFinancialData() so the two never race.
export function removeFinancialDataFromCache(queryClient: QueryClient): void {
  for (const key of [...AFFECTED_TABLES, ...AFFECTED_AGGREGATES]) {
    queryClient.removeQueries({ queryKey: [key] });
  }
}
