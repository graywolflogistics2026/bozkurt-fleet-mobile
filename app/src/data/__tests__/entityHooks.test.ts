// UNBOUNDED QUERIES FIX (P0, FULL SYSTEM AUDIT owner decision 2026-08-26)
// — before this fix, every useEntityList() call fetched a table's ENTIRE
// row set for the user with NO ORDER BY at all, for every table, forever.
// These tests exercise the REAL entityHooks.ts module (not a
// reimplementation) against a query-builder SPY that records the exact
// method-call sequence (select/eq/order/range) Supabase would receive —
// proving the actual ordering/pagination logic these hooks build, not just
// that a hand-written assertion about it would pass.
//
// entityHooks.ts imports useAuth from AuthContext.tsx (a real .tsx file
// with JSX) — this repo's jest.config.js runs plain ts-jest/node with no
// jsx compilerOption (CLAUDE.md's own documented "no React Native
// rendering harness" limitation), so requiring AuthContext.tsx directly
// would fail to parse. Mocked out here, same pattern as
// capitalTransactions.test.ts's own entityHooks mock one level up.
jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } } }),
}));

// react-query's real useQuery/useInfiniteQuery need a QueryClientProvider
// (a React render tree) to run — mocked with a minimal, faithful stand-in
// so the hooks under test can be called as plain functions while still
// running their REAL queryFn/getNextPageParam bodies untouched.
jest.mock('@tanstack/react-query', () => ({
  useQuery: (config: { queryFn: () => Promise<unknown>; queryKey: unknown[] }) => ({ __config: config }),
  useInfiniteQuery: (config: unknown) => ({ __config: config }),
  useMutation: (config: unknown) => ({ __config: config }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

type QuerySpyCall = { method: string; args: unknown[] };

function makeQuerySpy(rows: unknown[] = []) {
  const calls: QuerySpyCall[] = [];
  const methods = ['select', 'eq', 'order', 'range'] as const;
  const builder: Record<string, unknown> = {};
  for (const method of methods) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  // Supabase's real query builder is a thenable — `await query` resolves
  // it without an explicit `.then()`/execute() call, which is exactly how
  // entityHooks.ts consumes it (`const { data, error } = await query;`).
  (builder as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return { builder, calls };
}

let fromSpy: jest.Mock;
let currentBuilder: ReturnType<typeof makeQuerySpy>['builder'];
let currentCalls: QuerySpyCall[];

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return { from: (...args: unknown[]) => fromSpy(...args) };
  },
}));

import { createEntityHooks, ORDER_COLUMN, DEFAULT_ORDER_COLUMN } from '@/src/data/entityHooks';

function setSpyRows(rows: unknown[] = []) {
  const spy = makeQuerySpy(rows);
  currentBuilder = spy.builder;
  currentCalls = spy.calls;
  fromSpy = jest.fn(() => currentBuilder);
}

type FakeUseQueryResult<T> = { __config: { queryFn: () => Promise<T> } };
type FakeUseInfiniteQueryResult<T> = {
  __config: { queryFn: (ctx: { pageParam: number }) => Promise<T>; getNextPageParam: (lastPage: T, allPages: T[]) => number | undefined };
};

describe('entityHooks ORDER_COLUMN map', () => {
  it('every table this app actually reads dates from has its real column, not created_at', () => {
    expect(ORDER_COLUMN).toMatchObject({
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
    });
  });

  it('a table with no natural event date falls back to created_at', () => {
    expect(DEFAULT_ORDER_COLUMN).toBe('created_at');
  });
});

describe('useEntityList — real ordering', () => {
  it('orders deductions by ded_date descending, nulls last, with no range/pagination', async () => {
    setSpyRows([{ id: 'd1' }]);
    const hooks = createEntityHooks<{ id: string }, object, object>('deductions');
    const result = hooks.useEntityList() as unknown as FakeUseQueryResult<{ id: string }[]>;
    await result.__config.queryFn();

    expect(fromSpy).toHaveBeenCalledWith('deductions');
    const orderCall = currentCalls.find((c) => c.method === 'order');
    expect(orderCall?.args).toEqual(['ded_date', { ascending: false, nullsFirst: false }]);
    expect(currentCalls.some((c) => c.method === 'range')).toBe(false);
  });

  it('orders a table with no natural date column by created_at', async () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('trucks');
    const result = hooks.useEntityList() as unknown as FakeUseQueryResult<{ id: string }[]>;
    await result.__config.queryFn();

    const orderCall = currentCalls.find((c) => c.method === 'order');
    expect(orderCall?.args[0]).toBe('created_at');
  });

  it('still applies eq() filters alongside the new ordering', async () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('maintenance_records');
    const result = hooks.useEntityList({ truck_id: 'truck-1' }) as unknown as FakeUseQueryResult<{ id: string }[]>;
    await result.__config.queryFn();

    const eqCalls = currentCalls.filter((c) => c.method === 'eq');
    expect(eqCalls.some((c) => c.args[0] === 'truck_id' && c.args[1] === 'truck-1')).toBe(true);
  });
});

describe('useEntityListPaged — real pagination', () => {
  it('the first page requests range(0, pageSize - 1)', async () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('settlements');
    const result = hooks.useEntityListPaged() as unknown as FakeUseInfiniteQueryResult<{ id: string }[]>;
    await result.__config.queryFn({ pageParam: 0 });

    const rangeCall = currentCalls.find((c) => c.method === 'range');
    expect(rangeCall?.args).toEqual([0, 49]); // default PAGE_SIZE = 50
    const orderCall = currentCalls.find((c) => c.method === 'order');
    expect(orderCall?.args[0]).toBe('week_ending');
  });

  it('page 2 requests the next window, respecting a custom page size', async () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('settlements');
    const result = hooks.useEntityListPaged(undefined, 20) as unknown as FakeUseInfiniteQueryResult<{ id: string }[]>;
    await result.__config.queryFn({ pageParam: 2 });

    const rangeCall = currentCalls.find((c) => c.method === 'range');
    expect(rangeCall?.args).toEqual([40, 59]); // page 2 * pageSize 20 = offset 40
  });

  it('getNextPageParam returns undefined once a page comes back shorter than pageSize (end of data)', () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('settlements');
    const result = hooks.useEntityListPaged(undefined, 50) as unknown as FakeUseInfiniteQueryResult<{ id: string }[]>;

    const fullPage = Array.from({ length: 50 }, (_, i) => ({ id: String(i) }));
    const partialPage = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));

    expect(result.__config.getNextPageParam(fullPage, [fullPage])).toBe(1);
    expect(result.__config.getNextPageParam(partialPage, [fullPage, partialPage])).toBeUndefined();
  });

  it('a genuinely empty final page also stops pagination', () => {
    setSpyRows([]);
    const hooks = createEntityHooks<{ id: string }, object, object>('settlements');
    const result = hooks.useEntityListPaged(undefined, 50) as unknown as FakeUseInfiniteQueryResult<{ id: string }[]>;

    expect(result.__config.getNextPageParam([], [[]])).toBeUndefined();
  });
});
