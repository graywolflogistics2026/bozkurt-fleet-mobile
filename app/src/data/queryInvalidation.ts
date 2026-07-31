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
// Drivers screen, and Compliance Tracker until they force-quit the app.
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
  'trucks',
  'equipment',
  'drivers',
  'driver_payments',
  'household_income',
  'household_members',
  'compliance_items',
  'maintenance_intervals',
  'truck_health_config',
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
const AFFECTED_AGGREGATES = [
  'fleet-stats',
  'driver-stats',
  'capital-account-summary',
  'tax_config',
  'tax_year_data',
  'dashboard-layout',
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
