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

  return {
    from,
    storage: {
      from() {
        return { upload: async () => ({ data: {}, error: null }) };
      },
    },
    __store: store,
  };
}
