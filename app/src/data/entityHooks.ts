import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

type Filters = Record<string, string | number | boolean | null | undefined>;

// UNBOUNDED QUERIES FIX (P0, FULL SYSTEM AUDIT owner decision 2026-08-26)
// — every useEntityList() call used to fetch a table's ENTIRE row set for
// the user with no ORDER BY at all (whatever order Postgres happened to
// return), for every table, every time, forever — a multi-year account's
// Deductions/Settlements/Fuel screens would only get slower with more
// history, and rows rendered in an arbitrary, non-chronological order
// until a screen's own client-side sort fixed it up (most already did,
// but inconsistently). ORDER_COLUMN is the one place every table's natural
// "most recent first" column lives — verified against docs/SCHEMA.sql and
// docs/PENDING_SQL.md's own table definitions (app/src/types/db.ts), not
// guessed; a table with no natural transaction/event date (loans, credit
// cards, trucks, drivers, user categories, ...) falls back to created_at.
export const ORDER_COLUMN: Record<string, string> = {
  settlements: 'week_ending',
  deductions: 'ded_date',
  fuel_purchases: 'purchase_date',
  maintenance_records: 'service_date',
  loads: 'load_date',
  reimbursements: 'reimb_date',
  tolls: 'toll_date',
  capital_transactions: 'tx_date',
  driver_payments: 'date',
  misc_income: 'income_date',
  compliance_items: 'due_date',
  bank_statements: 'statement_month',
  bank_transactions: 'tx_date',
  equipment: 'purchase_date',
  // DEVICE REPORT FIX (owner decision) — "Documents screen is empty" was
  // NOT a truck-scope bug (documents.tsx applies no truck filter at all,
  // confirmed by reading it) — this table was simply missing from this
  // map, so every query fell back to DEFAULT_ORDER_COLUMN ('created_at'),
  // a column `documents` has never had (it uses `imported_at` instead —
  // docs/SCHEMA.sql). `.order('created_at', ...)` against a nonexistent
  // column is a real Postgres error on EVERY query, silently swallowed by
  // the screen (which only checks `.data`, never `.isError`) and rendered
  // as an empty list with no visible error. Auditing this same defect
  // class (a table missing from this map that doesn't actually have
  // `created_at`) found it independently affects TWO more live tables:
  // `loans` (Loan Center — reachable, in active use, equally broken) and
  // `credit_cards` (currently behind FEATURE_FLAGS.bankCreditCards, lower
  // real-world impact today, fixed anyway since it's the same bug).
  documents: 'imported_at',
  loans: 'id',
  credit_cards: 'id',
};
export const DEFAULT_ORDER_COLUMN = 'created_at';
const PAGE_SIZE = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

// MULTI-TRUCK MODEL — NULL-TRUCK EXCLUSION FIX (owner decision, device
// report: "Deductions screen is empty," "rows exist in the database but
// the list shows nothing"). A plain `.eq('truck_id', X)` — the ORIGINAL
// behavior for every filter key here — matches NOTHING for a row whose
// `truck_id` is NULL (SQL equality never matches NULL, regardless of the
// comparison value). That's correct for "All Trucks" scope (`value ===
// undefined`, skipped entirely below, so a null-truck row is already
// included via the unfiltered query) but WRONG the instant a SPECIFIC
// truck is scoped: `ActiveTruckContext`'s own n=1 shortcut means a
// SINGLE-TRUCK account's `activeTruckId` is ALWAYS a real truck id, NEVER
// "All Trucks" — there is no picker to ever reach that state (`showPicker:
// trucks.length > 1`). Every fleet-level row (insurance, permits,
// accounting fees — "most deductions stay fleet-level (null) by design,"
// CLAUDE.md's own §63 entry) was therefore PERMANENTLY invisible for the
// majority of real accounts (any single-truck one), with literally no way
// to ever see it — this is the actual root cause of "the screen is
// empty." Fixed by special-casing `truck_id` specifically: a real value
// filters to THAT truck's own rows **OR** any fleet-level (null) row —
// `truck_id IS NULL` is never "genuinely truck-specific" to some OTHER
// truck, so including it in every specific-truck's own view can never
// leak another truck's data, only ever restore a fleet-level row's
// visibility. Every OTHER filter key keeps its original plain `.eq()`
// behavior — this is deliberately narrow, not a general "any filter can
// mean OR NULL" mechanism.
function applyFilters(query: QueryBuilder, filters: Filters | undefined): QueryBuilder {
  if (!filters) return query;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (key === 'truck_id') {
      query = query.or(`truck_id.eq.${value},truck_id.is.null`);
      continue;
    }
    query = query.eq(key, value as string | number | boolean);
  }
  return query;
}

// Shared shape for every user-scoped table's list/insert/update/delete hooks
// (PROMPTS.md Session 4: "typed query/mutation hooks per entity"). All 7
// entities the session calls for (settlements, deductions, maintenance,
// capital_transactions, fuel, loads, documents) share identical CRUD
// semantics over Supabase + react-query, so this factory is instantiated
// once per table instead of hand-duplicating the same hook 7 times.
export function createEntityHooks<Row extends { id: string }, Insert extends object, Update extends object>(
  table: string
) {
  const orderColumn = ORDER_COLUMN[table] ?? DEFAULT_ORDER_COLUMN;

  function useEntityList(filters?: Filters) {
    const { session } = useAuth();
    const userId = session?.user.id;

    return useQuery({
      queryKey: [table, 'list', userId, filters ?? null],
      queryFn: async () => {
        let query = supabase
          .from(table)
          .select('*')
          .eq('user_id', userId as string)
          .order(orderColumn, { ascending: false, nullsFirst: false });
        query = applyFilters(query, filters);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as Row[];
      },
      enabled: !!userId,
    });
  }

  // UNBOUNDED QUERIES FIX, PAGINATED VARIANT — an OPT-IN companion to
  // useEntityList() above (which stays fully unchanged in row-set/shape,
  // still fetching everything: the aggregate consumers — dashboardStats.ts,
  // capitalAccount.ts, true-profit/CPM/tax-estimate calculations, and every
  // list screen's own totals-bar/chart, which all need the FULL period's
  // data client-side to sum correctly — must keep reading complete data,
  // never a silently-windowed subset). This is the real, tested,
  // ready-to-adopt mechanism the "default window: current year or most
  // recent N with infinite scroll" fix calls for — most-recent-N chosen
  // over a calendar-year cutoff (the spec's own "or") since a calendar-year
  // window would show an empty/near-empty screen in the first days of a
  // new year, which reads as broken rather than paginated. Adopting this
  // in a specific BROWSE-ONLY screen (one that doesn't compute a running
  // total/chart over its own full row set) is a follow-up, screen-by-screen
  // decision — flagged, not silently done, since retrofitting a totals-bar
  // screen to page correctly needs its own aggregate-math rework, out of
  // scope for this pass.
  function useEntityListPaged(filters?: Filters, pageSize: number = PAGE_SIZE) {
    const { session } = useAuth();
    const userId = session?.user.id;

    return useInfiniteQuery({
      queryKey: [table, 'list-paged', userId, filters ?? null, pageSize],
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        const from = pageParam * pageSize;
        const to = from + pageSize - 1;
        let query = supabase
          .from(table)
          .select('*')
          .eq('user_id', userId as string)
          .order(orderColumn, { ascending: false, nullsFirst: false })
          .range(from, to);
        query = applyFilters(query, filters);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as Row[];
      },
      getNextPageParam: (lastPage, allPages) => (lastPage.length < pageSize ? undefined : allPages.length),
      enabled: !!userId,
    });
  }

  function useEntityInsert() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (values: Insert) => {
        const { data, error } = await supabase.from(table).insert(values).select().single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  function useEntityUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, values }: { id: string; values: Update }) => {
        const { data, error } = await supabase.from(table).update(values).eq('id', id).select().single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  function useEntityDelete() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        return id;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  return { useEntityList, useEntityListPaged, useEntityInsert, useEntityUpdate, useEntityDelete };
}
