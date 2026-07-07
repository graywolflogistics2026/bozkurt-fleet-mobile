import type { QueryClient } from '@tanstack/react-query';

// Every entity-hook list query is keyed [table, 'list', userId, filters]
// (src/data/entityHooks.ts) — invalidating by the bare table-name prefix
// also matches every filtered variant, since react-query does prefix
// matching on query keys, not exact-array equality.
const AFFECTED_TABLES = [
  'settlements',
  'deductions',
  'fuel_purchases',
  'maintenance_records',
  'capital_transactions',
  'loads',
  'documents',
];

// Derived/aggregate query keys that read from the tables above but aren't
// plain entity-hook lists (dashboardStats.ts, capitalAccount.ts,
// taxConfig.ts) — an import can move profiles.business_balance and add
// capital_transactions rows, both of which feed these.
const AFFECTED_AGGREGATES = ['fleet-stats', 'capital-account-summary', 'tax_config', 'tax_year_data'];

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
