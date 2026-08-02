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

export function createFakeSupabase(seed: FakeSupabaseStore = {}) {
  const store: FakeSupabaseStore = {};
  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((r) => ({ ...r }));
  let idCounter = 1;

  function from(table: string) {
    if (!store[table]) store[table] = [];
    const filters: Array<(row: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' | null = null;
    let payload: Row | Row[] | null = null;

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

    const builder: PromiseLike<{ data: Row[]; error: null }> & {
      select: (cols?: string) => typeof builder;
      insert: (rows: Row | Row[]) => typeof builder;
      update: (patch: Row) => typeof builder;
      delete: () => typeof builder;
      eq: (col: string, val: unknown) => typeof builder;
      is: (col: string, val: null) => typeof builder;
      in: (col: string, vals: unknown[]) => typeof builder;
      maybeSingle: () => Promise<{ data: Row | null; error: null }>;
      single: () => Promise<{ data: Row | null; error: null }>;
    } = {
      select(_cols?: string) {
        if (!mode) mode = 'select';
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
        const rows = execute();
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const rows = execute();
        return { data: rows[0] ?? null, error: null };
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve({ data: execute(), error: null }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  // Minimal fake of apply_business_balance_delta() (docs/SCHEMA.sql,
  // PENDING_SQL.md §37) — the only RPC this codebase calls today. Mirrors
  // the real function's atomic-increment semantics against the in-memory
  // `profiles` table.
  async function rpc(fnName: string, params: Record<string, unknown>) {
    if (fnName === 'apply_business_balance_delta') {
      const { p_user_id, p_delta } = params as { p_user_id: string; p_delta: number };
      const profile = (store.profiles ?? []).find((p) => p.user_id === p_user_id);
      if (!profile) return { data: null, error: { message: 'profile not found' } };
      const newBalance = Number(profile.business_balance ?? 0) + Number(p_delta);
      profile.business_balance = newBalance;
      return { data: newBalance, error: null };
    }
    return { data: null, error: { message: `fakeSupabase: unknown RPC "${fnName}"` } };
  }

  return {
    from,
    rpc,
    storage: {
      from() {
        return { upload: async () => ({ data: {}, error: null }) };
      },
    },
    __store: store,
  };
}
