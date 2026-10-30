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

// DELETE A TRUCK (owner decision, docs/PENDING_SQL.md §64) — a MINIMAL,
// explicit mirror of every `on delete cascade` foreign key this app's own
// schema documents (docs/SCHEMA.sql + PENDING_SQL.md's own §-by-§ history),
// so a test can prove "deleting the PARENT row also removes every CHILD
// row the real FK graph is documented to cascade" using real code paths —
// same honest-boundary spirit as every other fake in this file: this
// proves the CLIENT-VISIBLE deletion shape matches what the schema is
// documented to do, not that the real Postgres FK constraints are wired
// exactly this way (no live Postgres in this environment to verify that
// against). Deliberately NOT a general FK-introspection engine — just the
// specific, finite list of cascades this app's own delete flows rely on.
const CASCADE_RULES: Array<{ table: string; column: string; parent: string }> = [
  // docs/PENDING_SQL.md §64 (DELETE A TRUCK) — previously RESTRICT.
  { table: 'settlements', column: 'truck_id', parent: 'trucks' },
  { table: 'fuel_purchases', column: 'truck_id', parent: 'trucks' },
  { table: 'maintenance_records', column: 'truck_id', parent: 'trucks' },
  { table: 'deductions', column: 'truck_id', parent: 'trucks' },
  { table: 'tolls', column: 'truck_id', parent: 'trucks' },
  { table: 'maintenance_intervals', column: 'truck_id', parent: 'trucks' },
  { table: 'truck_health_config', column: 'truck_id', parent: 'trucks' },
  // docs/SCHEMA.sql — a settlement's own direct children (on delete
  // cascade). SETTLEMENT DELETE ORPHANS (owner decision, docs/PENDING_SQL.md
  // §70) added maintenance_records/tolls to this list — previously only
  // `loads` was modeled here (this fake was originally built for the
  // truck-cascade test alone), which meant a DIRECT settlement delete
  // test could never have caught the real bug this pass fixes: these two
  // tables' own cascades genuinely were never exercised by any existing
  // test before now.
  { table: 'loads', column: 'settlement_id', parent: 'settlements' },
  { table: 'fuel_purchases', column: 'settlement_id', parent: 'settlements' },
  { table: 'reimbursements', column: 'settlement_id', parent: 'settlements' },
  { table: 'deductions', column: 'settlement_id', parent: 'settlements' },
  { table: 'maintenance_records', column: 'settlement_id', parent: 'settlements' },
  { table: 'tolls', column: 'settlement_id', parent: 'settlements' },
  { table: 'capital_transactions', column: 'linked_deduction_id', parent: 'deductions' },
  // EQUIPMENT AUTO-POPULATE FROM IMPORTS (owner decision, SIMPLIFICATION
  // PASS, item 7, docs/PENDING_SQL.md §73) — mirrors capital_transactions'
  // own linked_deduction_id cascade exactly: deleting a deduction removes
  // its linked Equipment row automatically. The REVERSE direction
  // (deleting Equipment removes its linked deduction) has no FK to model
  // here — it's handled explicitly in app code (equipment.tsx's own
  // delete handler), not a cascade at all.
  { table: 'equipment', column: 'linked_deduction_id', parent: 'deductions' },
];

// SETTLEMENT DELETE ORPHANS (owner decision, docs/PENDING_SQL.md §70) —
// `on delete set null` foreign keys: the CHILD ROW SURVIVES, only its own
// FK column clears. Deliberately a SEPARATE list/mechanism from
// CASCADE_RULES above (a truck's own `driver_payments`/`loans` are real,
// standing financial records that must never be deleted just because one
// settlement or truck that happened to touch them was) — `loans.
// settlement_id` is the one this pass actually exercises in tests;
// `driver_payments.settlement_id` (already `on delete set null` in the
// real schema, docs/SCHEMA.sql) is included too for completeness even
// though no test in this pass specifically needs it yet.
const SET_NULL_RULES: Array<{ table: string; column: string; parent: string }> = [
  { table: 'loans', column: 'settlement_id', parent: 'settlements' },
  { table: 'driver_payments', column: 'settlement_id', parent: 'settlements' },
  // Batch A item 2 (2026-10-30): the two `on delete set null` FKs to trucks
  // (docs/SCHEMA.sql drivers.default_truck_id; PENDING_SQL §55b
  // compliance_items.truck_id).
  { table: 'drivers', column: 'default_truck_id', parent: 'trucks' },
  { table: 'compliance_items', column: 'truck_id', parent: 'trucks' },
];

// Tables whose rows the §80 'all' mode deletes because the document is
// attached to them (pending_80.sql, same order).
const DOC_ATTACHED_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['deductions', 'document_id'],
  ['maintenance_records', 'document_id'],
  ['prime_driver_expenses', 'document_id'],
  ['misc_income', 'document_id'],
  ['household_income', 'document_id'],
  ['compliance_items', 'source_document_id'],
  ['bank_statements', 'document_id'],
  ['import_jobs', 'document_id'],
];

export function createFakeSupabase(seed: FakeSupabaseStore = {}, options: { failures?: FakeSupabaseFailure[]; authUserId?: string } = {}) {
  const store: FakeSupabaseStore = {};
  for (const [table, rows] of Object.entries(seed)) store[table] = rows.map((r) => ({ ...r }));
  let idCounter = 1;
  const failures = (options.failures ?? []).map((f) => ({ ...f, remaining: f.count ?? Infinity }));

  // Recursively removes every row in a CASCADE_RULES child table whose FK
  // column matches one of the just-deleted parent rows' own ids — then
  // cascades AGAIN from whatever it just deleted (so trucks -> settlements
  // -> loads, and trucks -> deductions -> capital_transactions, both
  // multi-hop chains, resolve correctly in one call).
  function cascadeDelete(parentTable: string, deletedParentRows: Row[]) {
    if (deletedParentRows.length === 0) return;
    const parentIds = new Set(deletedParentRows.map((r) => r.id));
    for (const rule of CASCADE_RULES) {
      if (rule.parent !== parentTable) continue;
      const childRows = store[rule.table] ?? [];
      const toDelete = childRows.filter((row) => parentIds.has(row[rule.column]));
      if (toDelete.length === 0) continue;
      const toDeleteIds = new Set(toDelete.map((r) => r.id));
      store[rule.table] = childRows.filter((row) => !toDeleteIds.has(row.id));
      // The AFTER DELETE trigger fires for EVERY settlements row removed,
      // including one cascaded here from a truck delete — never only a
      // direct client-issued delete (this is the entire reason §70 chose
      // a trigger over a client-side two-step in the first place).
      if (rule.table === 'settlements') reverseSettlementBalanceCredits(toDelete);
      cascadeDelete(rule.table, toDelete);
    }
    // `on delete set null` — the row survives, only its own FK clears.
    for (const rule of SET_NULL_RULES) {
      if (rule.parent !== parentTable) continue;
      for (const row of store[rule.table] ?? []) {
        if (parentIds.has(row[rule.column])) row[rule.column] = null;
      }
    }
  }

  // SETTLEMENT DELETE ORPHANS (owner decision, docs/PENDING_SQL.md §70) —
  // mirrors the real `reverse_settlement_business_balance_credit()`
  // AFTER DELETE trigger: for every settlement row actually removed
  // (whether by a direct client delete OR cascaded from a truck delete
  // via CASCADE_RULES above), subtract its own business_balance_credit
  // from the matching profiles row. Same honest-boundary spirit as every
  // other fake in this file — proves the CLIENT-VISIBLE end state matches
  // what the trigger is documented to do, not that live Postgres actually
  // has it wired this way (no Postgres runtime in this environment to
  // verify that against).
  function reverseSettlementBalanceCredits(deletedSettlements: Row[]) {
    for (const sett of deletedSettlements) {
      const credit = Number(sett.business_balance_credit ?? 0);
      if (credit === 0) continue;
      const profile = (store.profiles ?? []).find((pr) => pr.user_id === sett.user_id);
      if (profile) profile.business_balance = Number(profile.business_balance ?? 0) - credit;
    }
  }

  function takeFailure(table: string, mode: string): FakeSupabaseError | null {
    const match = failures.find((f) => f.table === table && (f.mode == null || f.mode === mode) && f.remaining > 0);
    if (!match) return null;
    match.remaining -= 1;
    return match.error;
  }

  // Mirror of pending_80.sql document_linked_rows(): every row a document
  // delete touches, with its kind (derived | attached | kept).
  function documentLinkedRows(docId: string, uid: string) {
    const out: Array<{ tbl: string; row_id: unknown; amount: unknown; kind: string }> = [];
    const mine = (t: string) => (store[t] ?? []).filter((r) => r.user_id === uid);
    const sett = new Set(mine('settlements').filter((s) => s.document_id === docId).map((s) => s.id));
    const ded = new Map<unknown, string>();
    for (const s of mine('settlements')) if (sett.has(s.id)) out.push({ tbl: 'settlements', row_id: s.id, amount: s.gross, kind: 'derived' });
    for (const [t, amt] of [['loads', 'revenue'], ['fuel_purchases', 'amount'], ['reimbursements', 'amount'], ['tolls', 'amount']] as const)
      for (const r of mine(t)) if (sett.has(r.settlement_id)) out.push({ tbl: t, row_id: r.id, amount: r[amt], kind: 'derived' });
    for (const d of mine('deductions'))
      if (sett.has(d.settlement_id) || d.document_id === docId) {
        const kind = sett.has(d.settlement_id) ? 'derived' : 'attached';
        ded.set(d.id, kind);
        out.push({ tbl: 'deductions', row_id: d.id, amount: d.amount, kind });
      }
    for (const m of mine('maintenance_records'))
      if (sett.has(m.settlement_id) || m.document_id === docId)
        out.push({ tbl: 'maintenance_records', row_id: m.id, amount: m.cost, kind: sett.has(m.settlement_id) ? 'derived' : 'attached' });
    for (const c of mine('capital_transactions'))
      if (ded.has(c.linked_deduction_id)) out.push({ tbl: 'capital_transactions', row_id: c.id, amount: c.amount, kind: ded.get(c.linked_deduction_id)! });
    for (const e of mine('equipment'))
      if (ded.has(e.linked_deduction_id)) out.push({ tbl: 'equipment', row_id: e.id, amount: e.purchase_price, kind: ded.get(e.linked_deduction_id)! });
    for (const p of mine('driver_payments')) if (sett.has(p.settlement_id)) out.push({ tbl: 'driver_payments', row_id: p.id, amount: p.gross_pay, kind: 'derived' });
    for (const j of mine('import_jobs')) if (j.document_id === docId) out.push({ tbl: 'import_jobs', row_id: j.id, amount: null, kind: 'derived' });
    for (const [t, column] of DOC_ATTACHED_TABLES) {
      if (t === 'deductions' || t === 'maintenance_records' || t === 'import_jobs') continue;
      for (const r of mine(t)) if (r[column] === docId) out.push({ tbl: t, row_id: r.id, amount: r.amount ?? r.annual_amount ?? null, kind: 'attached' });
    }
    for (const l of mine('loans')) if (sett.has(l.settlement_id)) out.push({ tbl: 'loans', row_id: l.id, amount: l.balance, kind: 'kept' });
    return out;
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
        // A DIRECT delete on settlements (not one reached via cascade,
        // which is handled inside cascadeDelete() itself) — same trigger,
        // same effect, regardless of which path removed the row.
        if (table === 'settlements') reverseSettlementBalanceCredits(deleted);
        cascadeDelete(table, deleted);
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
      // EXPORT ALL MY DATA (P1 fix, FULL SYSTEM AUDIT) — referrals has no
      // single user_id column, so fetchAllUserData() queries it via
      // .or('referrer_id.eq.X,referred_user_id.eq.X'). Minimal parser:
      // comma-separated `column.eq.value` clauses, ORed together — the
      // only shape this codebase's real Supabase calls actually use.
      or: (clause: string) => typeof builder;
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
      or(clause: string) {
        const clauses = clause.split(',').map((c) => {
          const [col, op, val] = c.split('.');
          if (op !== 'eq') throw new Error(`fakeSupabase: .or() only supports "eq" clauses, got "${op}" in "${c}"`);
          return { col, val };
        });
        filters.push((row) => clauses.some(({ col, val }) => String(row[col] ?? '') === val));
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

    // §62 — deduction edit + contribution sync, atomically. Mirrors the
    // real function's contract: the deduction row write and the linked
    // capital_transactions create/update/remove happen as one call — this
    // fake, like every other one in this file, cannot prove the real SQL
    // transaction rolls back correctly on a mid-function error (no
    // Postgres runtime here), but DOES prove the client never sees a
    // partial result: on an injected failure (via the generic prefix
    // check at the top of this function), NEITHER write below ever runs.
    if (fnName === 'update_deduction_with_contribution_sync') {
      const p = params as {
        p_deduction_id: string;
        p_user_id: string;
        p_category: string;
        p_payment_method: string;
        p_amount: number;
        p_tax_deductible: boolean;
        p_sync_action: 'noop' | 'create' | 'update' | 'remove';
        p_contribution_id: string | null;
        p_contribution_amount: number | null;
        p_contribution_note: string | null;
        p_contribution_date: string | null;
      };
      const row = (store.deductions ?? []).find((r) => r.id === p.p_deduction_id && r.user_id === p.p_user_id);
      if (!row) return { data: null, error: { message: 'No deduction row matched.', code: 'P0002' } };
      row.category = p.p_category;
      row.payment_method = p.p_payment_method;
      row.amount = p.p_amount;
      row.tax_deductible = p.p_tax_deductible;

      if (p.p_sync_action === 'create') {
        const newRow: Row = {
          id: `capital_transactions-${idCounter++}`,
          user_id: p.p_user_id,
          tx_type: 'contribution',
          amount: p.p_contribution_amount,
          tx_date: p.p_contribution_date,
          note: p.p_contribution_note,
          linked_deduction_id: p.p_deduction_id,
        };
        store.capital_transactions = [...(store.capital_transactions ?? []), newRow];
      } else if (p.p_sync_action === 'update') {
        const tx = (store.capital_transactions ?? []).find((r) => r.id === p.p_contribution_id && r.user_id === p.p_user_id);
        if (tx) {
          tx.amount = p.p_contribution_amount;
          tx.note = p.p_contribution_note;
          tx.tx_date = p.p_contribution_date;
        }
      } else if (p.p_sync_action === 'remove') {
        store.capital_transactions = (store.capital_transactions ?? []).filter((r) => r.id !== p.p_contribution_id);
      }

      return { data: row, error: null };
    }

    if (fnName === 'insert_deduction_with_contribution_sync') {
      const p = params as {
        p_user_id: string;
        p_description: string | null;
        p_category: string;
        p_payment_method: string;
        p_amount: number;
        p_ded_date: string | null;
        p_source: string;
        p_tax_deductible: boolean;
        p_create_contribution: boolean;
        p_contribution_note: string | null;
      };
      const row: Row = {
        id: `deductions-${idCounter++}`,
        user_id: p.p_user_id,
        description: p.p_description,
        category: p.p_category,
        payment_method: p.p_payment_method,
        amount: p.p_amount,
        ded_date: p.p_ded_date,
        source: p.p_source,
        tax_deductible: p.p_tax_deductible,
      };
      store.deductions = [...(store.deductions ?? []), row];

      if (p.p_create_contribution) {
        const contribution: Row = {
          id: `capital_transactions-${idCounter++}`,
          user_id: p.p_user_id,
          tx_type: 'contribution',
          amount: p.p_amount,
          tx_date: p.p_ded_date,
          note: p.p_contribution_note,
          linked_deduction_id: row.id,
        };
        store.capital_transactions = [...(store.capital_transactions ?? []), contribution];
      }

      return { data: row, error: null };
    }

    // §80 (batch A item 7, 2026-10-30) — preview_document_delete /
    // delete_document_cascade, mirroring pending_80.sql's contract:
    // auth.uid()-scoped, 'not_found' for another user's or a gone document,
    // all-or-nothing (the store is restored if any step fails). Like every
    // RPC fake here it proves the client flow, not the PL/pgSQL body.
    if (fnName === 'preview_document_delete' || fnName === 'delete_document_cascade') {
      const p = params as { p_doc_id: string; p_mode?: string };
      const uid = options.authUserId ?? null;
      if (!uid) return { data: null, error: { message: 'Not signed in', code: '42501' } };
      const doc = (store.documents ?? []).find((d) => d.id === p.p_doc_id && d.user_id === uid);
      if (!doc) return { data: { status: 'not_found' }, error: null };
      const rows = documentLinkedRows(p.p_doc_id, uid);
      const settlements = (store.settlements ?? []).filter((s) => s.document_id === p.p_doc_id && s.user_id === uid);
      if (fnName === 'preview_document_delete') {
        const groups = new Map<string, { table: string; kind: string; count: number; amount: number; ids: unknown[] }>();
        for (const r of rows) {
          const key = `${r.tbl}|${r.kind}`;
          const g = groups.get(key) ?? { table: r.tbl, kind: r.kind, count: 0, amount: 0, ids: [] };
          g.count += 1;
          g.amount += Number(r.amount ?? 0);
          g.ids.push(r.row_id);
          groups.set(key, g);
        }
        return {
          data: {
            status: 'ok',
            document: {
              id: doc.id,
              filename: doc.filename ?? null,
              doc_type: doc.doc_type ?? null,
              doc_date: doc.doc_date ?? null,
              amount: doc.amount ?? null,
              storage_path: doc.storage_path ?? null,
            },
            settlements: settlements.map((s) => ({ id: s.id, week_ending: s.week_ending, gross: s.gross ?? null, net: s.net ?? null, truck_id: s.truck_id ?? null })),
            tables: [...groups.values()],
          },
          error: null,
        };
      }
      if (p.p_mode !== 'all' && p.p_mode !== 'file_only') return { data: null, error: { message: `Unknown delete mode: ${p.p_mode}`, code: '22023' } };
      const snapshot = JSON.stringify(store);
      const deleted: Record<string, number> = {};
      if (p.p_mode === 'all') for (const r of rows) if (r.kind !== 'kept') deleted[r.tbl] = (deleted[r.tbl] ?? 0) + 1;
      const run = async (q: PromiseLike<{ error: FakeSupabaseError | null }>) => {
        const { error } = await q;
        if (error) throw error;
      };
      try {
        const settIds = settlements.map((s) => s.id);
        if (p.p_mode === 'all') {
          await run(from('driver_payments').delete().eq('user_id', uid).in('settlement_id', settIds));
          await run(from('settlements').delete().eq('user_id', uid).eq('document_id', p.p_doc_id));
          for (const [table, column] of DOC_ATTACHED_TABLES) await run(from(table).delete().eq('user_id', uid).eq(column, p.p_doc_id));
        } else {
          await run(from('settlements').update({ document_id: null }).eq('user_id', uid).eq('document_id', p.p_doc_id));
        }
        await run(from('documents').delete().eq('user_id', uid).eq('id', p.p_doc_id));
      } catch (error) {
        const restored = JSON.parse(snapshot) as FakeSupabaseStore;
        for (const key of Object.keys(store)) delete store[key];
        Object.assign(store, restored);
        return { data: null, error: error as FakeSupabaseError };
      }
      return { data: { status: 'deleted', mode: p.p_mode, storage_path: doc.storage_path ?? null, deleted }, error: null };
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
            // Batch A item 7: failures: [{ table: 'storage', mode: 'delete', ... }]
            const injected = takeFailure('storage', 'delete');
            if (injected) return { data: null, error: injected };
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
