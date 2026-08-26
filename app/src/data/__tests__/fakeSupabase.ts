// Minimal in-memory fake of the subset of the supabase-js query builder
// aiImportSave.ts actually uses (select/insert/update/delete + eq/is/
// maybeSingle/single, plus a no-op storage.upload). Not a general-purpose
// Supabase mock — just enough surface to let aiImportSave.ts's settlement
// save/replace logic run against real in-memory tables in a test, so the
// settlement-week-coexistence bug (CLAUDE.md invariant #10) can be proven
// with actual code paths instead of hand-waving about what the code
// "should" do.

type Row = Record<string, unknown>;

export type FakeSupabaseStore = Record<string, Row[]>;

export type FakeSupabaseError = { message: string; code?: string; hint?: string; details?: string };

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02): error-injection
// support so tests can prove a specific write step's failure is surfaced
// (step-tagged, not silently swallowed) instead of only ever exercising
// the all-succeeds happy path. `count` limits how many times the failure
// fires (default: every matching call, i.e. Infinity) — set to 1 to
// simulate "failed once, would succeed on retry."
export type FakeSupabaseFailure = {
  table: string;
  mode?: 'select' | 'insert' | 'update' | 'delete';
  error: FakeSupabaseError;
  count?: number;
};

export function createFakeSupabase(seed: FakeSupabaseStore = {}, options: { failures?: FakeSupabaseFailure[] } = {}) {
  const store: FakeSupabaseStore = {};
  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((r) => ({ ...r }));
  let idCounter = 1;
  const failures = (options.failures ?? []).map((f) => ({ ...f, remaining: f.count ?? Infinity }));

  function takeFailure(table: string, mode: string): FakeSupabaseError | null {
    const match = failures.find((f) => f.table === table && (f.mode == null || f.mode === mode) && f.remaining > 0);
    if (!match) return null;
    match.remaining -= 1;
    return match.error;
  }

  function from(table: string) {
    if (!store[table]) store[table] = [];
    const filters: Array<(row: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' | null = null;
    let payload: Row | Row[] | null = null;
    let wantsCount = false;

    function execute(): Row[] {
      const tableRows = store[table];
      if (mode === 'insert') {
        const rowsToInsert = Array.isArray(payload) ? payload : [payload as Row];
        const inserted = rowsToInsert.map((r) => ({ id: r.id ?? `${table}-${idCounter++}`, ...r }));
        store[table] = [...tableRows, ...inserted];
        return inserted;
      }
      if (mode === 'update') {
        const matched = tableRows.filter((row) => filters.every((f) => f(row)));
        matched.forEach((row) => Object.assign(row, payload));
        return matched;
      }
      if (mode === 'delete') {
        const remaining: Row[] = [];
        const deleted: Row[] = [];
        for (const row of tableRows) {
          if (filters.every((f) => f(row))) deleted.push(row);
          else remaining.push(row);
        }
        store[table] = remaining;
        return deleted;
      }
      return tableRows.filter((row) => filters.every((f) => f(row)));
    }

    const builder: PromiseLike<{ data: Row[] | null; error: FakeSupabaseError | null; count?: number }> & {
      select: (cols?: string, options?: { count?: 'exact'; head?: boolean }) => typeof builder;
      insert: (rows: Row | Row[]) => typeof builder;
      update: (patch: Row) => typeof builder;
      delete: () => typeof builder;
      eq: (col: string, val: unknown) => typeof builder;
      is: (col: string, val: null) => typeof builder;
      in: (col: string, vals: unknown[]) => typeof builder;
      maybeSingle: () => Promise<{ data: Row | null; error: FakeSupabaseError | null }>;
      single: () => Promise<{ data: Row | null; error: FakeSupabaseError | null }>;
    } = {
      select(_cols?: string, options?: { count?: 'exact'; head?: boolean }) {
        if (!mode) mode = 'select';
        if (options?.count) wantsCount = true;
        return builder;
      },
      insert(rows: Row | Row[]) {
        mode = 'insert';
        payload = rows;
        return builder;
      },
      update(patch: Row) {
        mode = 'update';
        payload = patch;
        return builder;
      },
      delete() {
        mode = 'delete';
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      is(col: string, val: null) {
        filters.push((row) => (row[col] ?? null) === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        const set = new Set(vals);
        filters.push((row) => set.has(row[col]));
        return builder;
      },
      async maybeSingle() {
        const injected = takeFailure(table, mode ?? 'select');
        if (injected) return { data: null, error: injected };
        const rows = execute();
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const injected = takeFailure(table, mode ?? 'select');
        if (injected) return { data: null, error: injected };
        const rows = execute();
        return { data: rows[0] ?? null, error: null };
      },
      then(onfulfilled, onrejected) {
        const injected = takeFailure(table, mode ?? 'select');
        const rows = injected ? null : execute();
        const result = injected
          ? { data: null, error: injected, ...(wantsCount ? { count: 0 } : {}) }
          : { data: rows, error: null, ...(wantsCount ? { count: (rows as Row[]).length } : {}) };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  // Fakes of every RPC this codebase calls. IMPORTANT BOUNDARY (BALANCE
  // LEDGER ATOMICITY FIX, docs/PENDING_SQL.md §60, FULL SYSTEM AUDIT owner
  // decision 2026-08-26): these mirror each RPC's DOCUMENTED CONTRACT (what
  // it returns, what it mutates, when it errors) as a single JS function
  // call — they do NOT, and cannot, prove the real PL/pgSQL function BODY
  // is correct (no Deno/Postgres runtime exists in this repo — the same
  // limitation this codebase has flagged at every prior SQL-touching pass).
  // What tests built on this fake DO prove: the CLIENT correctly calls the
  // right RPC with the right params and correctly handles its result/error
  // — a real, if narrower, category of bug (wrong RPC name, wrong param
  // shape, swallowed error) distinct from "is the SQL itself right," which
  // is verified separately, by hand, against the live database schema.
  async function rpc(fnName: string, params: Record<string, unknown>) {
    const injected = takeFailure(`rpc:${fnName}`, 'select');
    if (injected) return { data: null, error: injected };

    if (fnName === 'apply_business_balance_delta') {
      const { p_user_id, p_delta } = params as { p_user_id: string; p_delta: number };
      const profile = (store.profiles ?? []).find((p) => p.user_id === p_user_id);
      // §38 (owner decision 2026-08-02): the real RPC now raises when it
      // updates zero rows instead of silently returning NULL — mirrored
      // here so a test can prove the client surfaces this as a real error.
      if (!profile) return { data: null, error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } };
      const newBalance = Number(profile.business_balance ?? 0) + Number(p_delta);
      profile.business_balance = newBalance;
      return { data: newBalance, error: null };
    }

    // §60 — insert a manual capital_transactions row AND apply its delta
    // to profiles.business_balance as one call (the real function does
    // both inside one Postgres transaction; this fake does both inside
    // one JS function call, which is as close as a non-transactional
    // in-memory store can get to modeling "atomic").
    if (fnName === 'record_manual_capital_transaction') {
      const p = params as {
        p_user_id: string;
        p_tx_type: 'contribution' | 'draw';
        p_amount: number;
        p_tx_date: string;
        p_note: string | null;
        p_linked_deduction_id: string | null;
      };
      const delta = p.p_tx_type === 'contribution' ? Number(p.p_amount) : -Number(p.p_amount);
      if (delta !== 0) {
        const profile = (store.profiles ?? []).find((pr) => pr.user_id === p.p_user_id);
        if (!profile) return { data: null, error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } };
        profile.business_balance = Number(profile.business_balance ?? 0) + delta;
      }
      const row: Row = {
        id: `capital_transactions-${idCounter++}`,
        user_id: p.p_user_id,
        tx_type: p.p_tx_type,
        amount: p.p_amount,
        tx_date: p.p_tx_date,
        note: p.p_note ?? null,
        linked_deduction_id: p.p_linked_deduction_id ?? null,
        business_balance_applied: delta,
      };
      store.capital_transactions = [...(store.capital_transactions ?? []), row];
      return { data: row, error: null };
    }

    // §60 — reads the row's CURRENT business_balance_applied (never a
    // client-passed value), adjusts by the DIFFERENCE only.
    if (fnName === 'update_manual_capital_transaction') {
      const p = params as {
        p_id: string;
        p_user_id: string;
        p_tx_type: 'contribution' | 'draw';
        p_amount: number;
        p_tx_date: string;
        p_note: string | null;
      };
      const row = (store.capital_transactions ?? []).find((r) => r.id === p.p_id && r.user_id === p.p_user_id);
      if (!row) return { data: null, error: { message: 'No capital_transactions row matched.', code: 'P0002' } };
      const previousDelta = Number(row.business_balance_applied ?? 0);
      const newDelta = p.p_tx_type === 'contribution' ? Number(p.p_amount) : -Number(p.p_amount);
      const adjustment = newDelta - previousDelta;
      if (adjustment !== 0) {
        const profile = (store.profiles ?? []).find((pr) => pr.user_id === p.p_user_id);
        if (!profile) return { data: null, error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } };
        profile.business_balance = Number(profile.business_balance ?? 0) + adjustment;
      }
      row.amount = p.p_amount;
      row.tx_date = p.p_tx_date;
      row.note = p.p_note ?? null;
      row.business_balance_applied = newDelta;
      return { data: row, error: null };
    }

    // §60 — reverses the balance FIRST, only then removes the row (the
    // real function does this inside one transaction, so a failed
    // reversal there means the row is never deleted; this fake models the
    // end state of a SUCCESSFUL call — failure injection via `failures`
    // above is what tests use to prove the row survives a failed call).
    if (fnName === 'delete_manual_capital_transaction') {
      const p = params as { p_id: string; p_user_id: string };
      const row = (store.capital_transactions ?? []).find((r) => r.id === p.p_id && r.user_id === p.p_user_id);
      if (!row) return { data: null, error: { message: 'No capital_transactions row matched.', code: 'P0002' } };
      const delta = Number(row.business_balance_applied ?? 0);
      if (delta !== 0) {
        const profile = (store.profiles ?? []).find((pr) => pr.user_id === p.p_user_id);
        if (!profile) return { data: null, error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } };
        profile.business_balance = Number(profile.business_balance ?? 0) - delta;
      }
      store.capital_transactions = (store.capital_transactions ?? []).filter((r) => r.id !== p.p_id);
      return { data: null, error: null };
    }

    // §60 — settlement import path: reads the settlement's CURRENT
    // business_balance_credit (never a client-passed "previousCredit"),
    // updates both it and the balance together.
    if (fnName === 'apply_settlement_business_balance_credit') {
      const p = params as { p_settlement_id: string; p_user_id: string; p_new_credit: number };
      const sett = (store.settlements ?? []).find((r) => r.id === p.p_settlement_id && r.user_id === p.p_user_id);
      if (!sett) return { data: null, error: { message: 'No settlement row matched.', code: 'P0002' } };
      const previousCredit = Number(sett.business_balance_credit ?? 0);
      const delta = Number(p.p_new_credit) - previousCredit;
      sett.business_balance_credit = p.p_new_credit;
      if (delta !== 0) {
        const profile = (store.profiles ?? []).find((pr) => pr.user_id === p.p_user_id);
        if (!profile) return { data: null, error: { message: 'No profile row matched — update affected 0 rows.', code: 'P0002' } };
        profile.business_balance = Number(profile.business_balance ?? 0) + delta;
      }
      return { data: delta, error: null };
    }

    return { data: null, error: { message: `fakeSupabase: unknown RPC "${fnName}"` } };
  }

  const removedStoragePaths: string[] = [];

  return {
    from,
    rpc,
    storage: {
      from() {
        return {
          upload: async () => ({ data: {}, error: null }),
          // CASCADE DELETE (owner decision 2026-08-05, FULL PARITY pass
          // item F.1) — deductionMutations.ts's cleanupOrphanedDocument()
          // calls this to remove the underlying Storage object once no
          // row references its documents record anymore. Tracked in
          // __removedStoragePaths so a test can assert exactly which
          // paths got removed without needing a real Storage backend.
          remove: async (paths: string[]) => {
            removedStoragePaths.push(...paths);
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
        };
      },
    },
    __store: store,
    __removedStoragePaths: removedStoragePaths,
  };
}
