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
// plain entity-hook lists (dashboardStats.ts, capitalAccount.ts) — an
// import can move profiles.business_balance and add capital_transactions
// rows, both of which feed these.
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
//
// UNBOUNDED QUERIES / SCOPED INVALIDATION FIX (P0, FULL SYSTEM AUDIT owner
// decision 2026-08-26) removed two more DEAD entries, confirmed by reading
// every actual fetch site (not guessed): 'profit-loss' was never a real
// query key anywhere in the app — operating-pnl.tsx computes buildProfitLoss()
// via a plain useMemo over useSettlements()/useDeductions(), which
// self-invalidate on their own — invalidating this key was always a no-op.
// 'tax_config'/'tax_year_data' are genuinely independent: they hold the
// user's own tax profile settings and the server-published bracket tables
// (CLAUDE.md invariant #6), NEVER derived from settlements/deductions/fuel/
// etc. — taxConfig.ts's own useUpdateTaxConfig() already invalidates both
// keys directly in its own onSuccess, and nothing else in this app writes
// to either table as a side effect of anything else, so including them in
// every other mutation's sweep was pure waste.
const AFFECTED_AGGREGATES = ['fleet-stats', 'driver-stats', 'capital-account-summary', 'profile'] as const;

// Which AGGREGATE keys must be invalidated when a given ENTITY TABLE
// changes — built by directly reading each aggregate's own fetch function
// (src/data/dashboardStats.ts's fetchFleetStats()/fetchDriverStats() only
// ever query settlements/deductions/loads; src/data/capitalAccount.ts's
// summary only ever queries capital_transactions/profiles), cross-checked
// against docs/DATA_FLOW.md's mutation matrix — not guessed. 'profiles' is
// not itself a table in AFFECTED_TABLES (there's no useEntityList-style
// list query for a single profiles row) but is a valid trigger key here —
// any caller that mutates profiles.* directly (a settlement's balance
// credit, a manual capital-transaction's balance delta, a Cash Flow budget
// save) passes 'profiles' as one of its `entities` to pick up 'profile'/
// 'capital-account-summary' correctly.
const AGGREGATE_DEPENDENCIES: Record<(typeof AFFECTED_AGGREGATES)[number], readonly string[]> = {
  'fleet-stats': ['settlements', 'deductions', 'loads'],
  'driver-stats': ['settlements', 'deductions', 'loads'],
  'capital-account-summary': ['capital_transactions', 'profiles'],
  profile: ['profiles'],
};

// A bare queryClient.invalidateQueries() call only eagerly refetches
// queries with an ACTIVE observer (refetchType defaults to 'active') — a
// tab screen that's mounted-but-detached (react-native-screens can detach
// inactive tab screens) or hasn't been visited yet this session is left
// merely marked stale, so it silently shows old data until something else
// happens to remount/refocus it. refetchType 'all' forces every matching
// query to refetch right now regardless of observer state, which is what
// "the Dashboard must reflect new data immediately" actually requires.
//
// SCOPED INVALIDATION (P0 fix, FULL SYSTEM AUDIT owner decision
// 2026-08-26): editing a single deduction's category used to invalidate
// all ~25 entity tables plus every aggregate — 32 separate
// invalidateQueries calls for a mutation that touched exactly ONE table.
// Passing `entities` (the specific table(s) this mutation actually wrote
// to) now scopes the sweep to just those tables plus whichever aggregates
// docs/DATA_FLOW.md documents as depending on at least one of them —
// AGGREGATE_DEPENDENCIES above is the one place that mapping lives, kept
// in sync with each aggregate's own real fetch function rather than
// re-implemented ad hoc per call site. Omitting `entities` (or passing an
// empty array) keeps the ORIGINAL full, unconditional sweep — the correct,
// deliberate choice for a genuinely multi-entity mutation (settlement
// import, legacy-backup import, Reset All Data, a manual "refresh
// everything" pull-to-refresh) where enumerating every touched table is
// either impossible to know in advance or not worth the complexity, since
// nearly everything changed anyway.
export async function invalidateFinancialData(queryClient: QueryClient, options?: { entities?: readonly string[] }): Promise<void> {
  const entities = options?.entities;
  if (!entities || entities.length === 0) {
    await Promise.all(
      [...AFFECTED_TABLES, ...AFFECTED_AGGREGATES].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key], refetchType: 'all' })
      )
    );
    return;
  }

  const keys = new Set<string>();
  for (const entity of entities) {
    if ((AFFECTED_TABLES as readonly string[]).includes(entity)) keys.add(entity);
  }
  for (const aggregate of AFFECTED_AGGREGATES) {
    if (AGGREGATE_DEPENDENCIES[aggregate].some((dep) => entities.includes(dep))) keys.add(aggregate);
  }
  await Promise.all(Array.from(keys).map((key) => queryClient.invalidateQueries({ queryKey: [key], refetchType: 'all' })));
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
