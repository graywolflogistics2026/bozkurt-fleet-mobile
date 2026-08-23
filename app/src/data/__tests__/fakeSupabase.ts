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

  // Minimal fake of apply_business_balance_delta() (docs/SCHEMA.sql,
  // PENDING_SQL.md §37) — the only RPC this codebase calls today. Mirrors
  // the real function's atomic-increment semantics against the in-memory
  // `profiles` table.
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
