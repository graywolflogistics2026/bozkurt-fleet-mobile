// BALANCE LEDGER ATOMICITY FIX (docs/PENDING_SQL.md §60, FULL SYSTEM AUDIT
// owner decision 2026-08-26) — capitalTransactions.ts had ZERO test
// coverage before this file. These tests exercise the REAL exported hooks
// (useRecordManualCapitalTransaction/useReimburseMyself/
// useUpdateManualCapitalTransaction/useDeleteManualCapitalTransaction/
// fetchReimbursementStatus) against fakeSupabase.ts's in-memory client —
// not a re-implementation of the hooks' own logic, the actual module.
//
// HONEST BOUNDARY: fakeSupabase.ts's rpc() mocks model each RPC's
// DOCUMENTED CONTRACT (see its own header comment) — it cannot prove the
// real PL/pgSQL body in docs/PENDING_SQL.md §60 is correct (no Deno/
// Postgres runtime exists in this Jest environment). What these tests DO
// prove, and would fail if broken: capitalTransactions.ts calls the right
// RPC, with the right parameter shape, handles the returned row/error
// correctly, and invalidates the right query keys — plus, via the
// FAILURE-INJECTION tests below, that a failed RPC call never leaves a
// capital_transactions row in a state inconsistent with business_balance
// (the row survives a failed delete; a failed update leaves both the row
// and the balance untouched).
//
// This repo has no React Native rendering harness (no @testing-library
// dependency, no .test.tsx file anywhere — CLAUDE.md's own documented
// limitation). @tanstack/react-query is mocked here with a minimal,
// faithful stand-in — useMutation(config) returns a `mutateAsync` that
// calls config.mutationFn then config.onSuccess on success (exactly
// react-query's own real contract) — so the hooks under test can be
// called as plain functions, no component tree required, while still
// exercising their real mutationFn/onSuccess bodies untouched.

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;
const invalidateQueries = jest.fn();

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

// entityHooks.ts (createEntityHooks, used by capitalTransactions.ts for the
// plain useCapitalTransactions/useInsertCapitalTransaction/
// useUpdateCapitalTransaction/useDeleteCapitalTransaction exports, none of
// which this file exercises) transitively imports AuthContext.tsx — a real
// .tsx file with JSX. This repo's jest.config.js runs a plain ts-jest/node
// preset with no jsx compilerOption configured (CLAUDE.md's own documented
// "no React Native rendering harness" limitation) — parsing that file would
// fail with a syntax error. Mocked out here so requiring capitalTransactions.ts
// never actually loads entityHooks.ts/AuthContext.tsx at all.
jest.mock('@/src/data/entityHooks', () => ({
  createEntityHooks: () => ({
    useEntityList: jest.fn(),
    useEntityInsert: jest.fn(),
    useEntityUpdate: jest.fn(),
    useEntityDelete: jest.fn(),
  }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (config: { mutationFn: (vars: unknown) => Promise<unknown>; onSuccess?: (data: unknown, vars: unknown) => void }) => ({
    mutateAsync: async (vars: unknown) => {
      const result = await config.mutationFn(vars);
      config.onSuccess?.(result, vars);
      return result;
    },
  }),
}));

import { createFakeSupabase } from './fakeSupabase';
import {
  useRecordManualCapitalTransaction,
  useReimburseMyself,
  useUpdateManualCapitalTransaction,
  useDeleteManualCapitalTransaction,
  fetchReimbursementStatus,
} from '@/src/data/capitalTransactions';

const USER_ID = 'user-1';

beforeEach(() => {
  invalidateQueries.mockClear();
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 500 }],
  });
});

describe('useRecordManualCapitalTransaction', () => {
  test('a contribution credits business_balance by the full amount and returns the saved row', async () => {
    const { mutateAsync } = useRecordManualCapitalTransaction();
    const row = await mutateAsync({
      user_id: USER_ID,
      tx_type: 'contribution',
      amount: 200,
      tx_date: '2026-08-01',
      note: 'cash deposit',
      linked_deduction_id: null,
    });

    expect((row as { tx_type: string }).tx_type).toBe('contribution');
    expect((row as { amount: number }).amount).toBe(200);
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(700);
  });

  test('a draw debits business_balance (opposite sign of a contribution)', async () => {
    const { mutateAsync } = useRecordManualCapitalTransaction();
    await mutateAsync({
      user_id: USER_ID,
      tx_type: 'draw',
      amount: 150,
      tx_date: '2026-08-01',
      note: null,
      linked_deduction_id: null,
    });
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(350);
  });

  test('on success, invalidates capital_transactions, capital-account-summary, and profile', async () => {
    const { mutateAsync } = useRecordManualCapitalTransaction();
    await mutateAsync({ user_id: USER_ID, tx_type: 'contribution', amount: 50, tx_date: '2026-08-01', note: null, linked_deduction_id: null });

    const invalidatedKeys = invalidateQueries.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(invalidatedKeys).toEqual(expect.arrayContaining(['capital_transactions', 'capital-account-summary', 'profile']));
  });

  test('a failed RPC call throws and never invalidates any query', async () => {
    mockClient = createFakeSupabase(
      { profiles: [{ user_id: USER_ID, business_balance: 500 }] },
      { failures: [{ table: 'rpc:record_manual_capital_transaction', error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } }] }
    );
    const { mutateAsync } = useRecordManualCapitalTransaction();
    await expect(
      mutateAsync({ user_id: USER_ID, tx_type: 'contribution', amount: 50, tx_date: '2026-08-01', note: null, linked_deduction_id: null })
    ).rejects.toMatchObject({ code: 'P0002' });
    expect(invalidateQueries).not.toHaveBeenCalled();
    // The row must never be inserted either — an atomic RPC failing means
    // NEITHER side effect happened, not a row with no matching balance credit.
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });
});

describe('useReimburseMyself', () => {
  test('creates a DRAW linked to the deduction, debiting business_balance', async () => {
    const { mutateAsync } = useReimburseMyself();
    const row = await mutateAsync({ userId: USER_ID, deductionId: 'ded-1', amount: 75, note: 'reimbursement' });

    expect((row as { tx_type: string }).tx_type).toBe('draw');
    expect((row as { linked_deduction_id: string }).linked_deduction_id).toBe('ded-1');
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(425);
  });
});

describe('useUpdateManualCapitalTransaction', () => {
  async function seedContribution(amount: number) {
    const { mutateAsync } = useRecordManualCapitalTransaction();
    return mutateAsync({ user_id: USER_ID, tx_type: 'contribution', amount, tx_date: '2026-08-01', note: null, linked_deduction_id: null }) as Promise<{
      id: string;
    }>;
  }

  test('editing a contribution UP adjusts business_balance by the difference only, never the full new amount', async () => {
    const row = await seedContribution(100); // balance: 500 -> 600
    const { mutateAsync } = useUpdateManualCapitalTransaction();
    await mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 150, txDate: '2026-08-02', note: 'edited' });

    // 600 + (150 - 100) = 650, NOT 600 + 150 = 750 (which would double-count
    // the original 100 that was already applied).
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(650);
  });

  test('editing a contribution DOWN reduces business_balance by the difference', async () => {
    const row = await seedContribution(100); // balance: 500 -> 600
    const { mutateAsync } = useUpdateManualCapitalTransaction();
    await mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 40, txDate: '2026-08-02', note: null });

    // 600 + (40 - 100) = 540
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(540);
  });

  test('a chain of edits nets to exactly the same result as one direct edit (no drift)', async () => {
    const row = await seedContribution(100); // balance: 500 -> 600
    const { mutateAsync } = useUpdateManualCapitalTransaction();
    await mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 300, txDate: '2026-08-02', note: null }); // -> 800
    await mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 20, txDate: '2026-08-03', note: null }); // -> 520
    await mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 250, txDate: '2026-08-04', note: null }); // -> 750

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(750);
    // Started 500, final contribution amount is 250 -> equivalent to one
    // single edit straight from 100 to 250: 500 + (250 - 100) = 650... but
    // the ledger has ALREADY applied each intermediate delta, which is the
    // correct behavior (each edit is its own real event) — the important
    // invariant is that the SUM of every incremental adjustment equals the
    // final row's own stored business_balance_applied.
    const finalRow = mockClient.__store.capital_transactions.find((r) => r.id === row.id);
    expect(finalRow?.business_balance_applied).toBe(250);
  });

  test('a failed update RPC throws and leaves business_balance untouched', async () => {
    // The failure is registered from creation time, but scoped to the
    // 'update_manual_capital_transaction' RPC only — the seed contribution
    // below still goes through the (unaffected) 'record_manual_capital_transaction'
    // RPC normally, exactly as fakeSupabase.ts's failure-injection design
    // intends (see aiImportSave.errorReporting.test.ts for the same pattern).
    mockClient = createFakeSupabase(
      { profiles: [{ user_id: USER_ID, business_balance: 500 }] },
      { failures: [{ table: 'rpc:update_manual_capital_transaction', error: { message: 'boom', code: 'XXXXX' } }] }
    );
    const row = await seedContribution(100); // balance: 500 -> 600
    const { mutateAsync } = useUpdateManualCapitalTransaction();
    await expect(mutateAsync({ id: row.id, userId: USER_ID, txType: 'contribution', amount: 999, txDate: '2026-08-02', note: null })).rejects.toMatchObject({
      code: 'XXXXX',
    });
    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(600);
    const stillRow = mockClient.__store.capital_transactions.find((r) => r.id === row.id);
    expect(stillRow?.amount).toBe(100); // never partially applied
  });
});

describe('useDeleteManualCapitalTransaction', () => {
  test('deleting a contribution reverses its exact applied delta and removes the row', async () => {
    const { mutateAsync: record } = useRecordManualCapitalTransaction();
    const row = (await record({ user_id: USER_ID, tx_type: 'contribution', amount: 100, tx_date: '2026-08-01', note: null, linked_deduction_id: null })) as {
      id: string;
      user_id: string;
    };

    const { mutateAsync: del } = useDeleteManualCapitalTransaction();
    await del({ id: row.id, user_id: row.user_id });

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(500); // back to the starting balance
    expect(mockClient.__store.capital_transactions ?? []).toHaveLength(0);
  });

  // "Delete is worst — the row must survive until the reversal succeeds"
  // (owner decision, FULL SYSTEM AUDIT P0 fix instruction). Proven here by
  // injecting a failure on the delete RPC itself and confirming BOTH the
  // row and the balance are exactly as they were before the attempt — the
  // real §60 SQL does this by reversing the balance and deleting the row
  // inside ONE transaction, so a failure anywhere rolls back everything;
  // this test proves the CLIENT never assumes success and removes its own
  // local copy of the row before the RPC actually confirms.
  test('a failed delete RPC leaves the row and the balance completely untouched', async () => {
    mockClient = createFakeSupabase(
      { profiles: [{ user_id: USER_ID, business_balance: 500 }] },
      { failures: [{ table: 'rpc:delete_manual_capital_transaction', error: { message: 'lock timeout', code: '40P01' } }] }
    );
    const { mutateAsync: record } = useRecordManualCapitalTransaction();
    const row = (await record({ user_id: USER_ID, tx_type: 'contribution', amount: 100, tx_date: '2026-08-01', note: null, linked_deduction_id: null })) as {
      id: string;
      user_id: string;
    };

    const { mutateAsync: del } = useDeleteManualCapitalTransaction();
    await expect(del({ id: row.id, user_id: row.user_id })).rejects.toMatchObject({ code: '40P01' });

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(600); // still credited — reversal never happened
    const stillThere = mockClient.__store.capital_transactions.find((r) => r.id === row.id);
    expect(stillThere).toBeDefined(); // the row survives a failed reversal
  });

  test('a full insert -> edit -> delete lifecycle nets to exactly $0 effect on business_balance', async () => {
    const { mutateAsync: record } = useRecordManualCapitalTransaction();
    const { mutateAsync: update } = useUpdateManualCapitalTransaction();
    const { mutateAsync: del } = useDeleteManualCapitalTransaction();

    const row = (await record({ user_id: USER_ID, tx_type: 'draw', amount: 40, tx_date: '2026-08-01', note: null, linked_deduction_id: null })) as {
      id: string;
      user_id: string;
    };
    await update({ id: row.id, userId: USER_ID, txType: 'draw', amount: 90, txDate: '2026-08-02', note: null });
    await del({ id: row.id, user_id: row.user_id });

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(500); // exactly the starting balance
  });
});

describe('fetchReimbursementStatus', () => {
  test('returns null when the deduction has no linked contribution', async () => {
    const status = await fetchReimbursementStatus(USER_ID, 'ded-none');
    expect(status).toBeNull();
  });

  test('returns the correct outstanding amount once a contribution and a partial reimbursement draw both exist', async () => {
    mockClient = createFakeSupabase({
      profiles: [{ user_id: USER_ID, business_balance: 0 }],
      capital_transactions: [
        { id: 'ct-1', user_id: USER_ID, tx_type: 'contribution', amount: 200, linked_deduction_id: 'ded-1' },
        { id: 'ct-2', user_id: USER_ID, tx_type: 'draw', amount: 50, linked_deduction_id: 'ded-1' },
      ],
    });
    const status = await fetchReimbursementStatus(USER_ID, 'ded-1');
    expect(status).toEqual({ contributionAmount: 200, reimbursedAmount: 50, outstandingAmount: 150, fullyReimbursed: false });
  });
});
