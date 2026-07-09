import { supabase } from '@/src/lib/supabase';
import { importIdempotent, type ImportOutcome } from '@/src/data/legacyImport/idempotent';
import type {
  LegacyBackupPayload,
  LegacyCapitalContribution,
  LegacyCapitalDraw,
  LegacyCard,
  LegacyDeduction,
  LegacyFuel,
  LegacyHealth,
  LegacyLoad,
  LegacyLoan,
  LegacyMaintenance,
  LegacyReimbursement,
  LegacySettlement,
  LegacyToll,
} from '@/src/data/legacyImport/types';
import type {
  CapitalTransactionInsert,
  CreditCardInsert,
  DeductionInsert,
  FuelPurchaseInsert,
  LoadInsert,
  LoanInsert,
  MaintenanceRecordInsert,
  ReimbursementInsert,
  TollInsert,
  TruckInsert,
} from '@/src/types/db';

export type LegacyImportEntityResult = { label: string; inserted: number; skipped: number; failed: number; firstError: string | null };
export type LegacyImportResult = {
  truckId: string | null;
  truckCreated: boolean;
  entities: LegacyImportEntityResult[];
  warnings: string[];
};
export type ImportProgress = { label: string; index: number; total: number };

const STEPS = [
  'Setting up truck profile',
  'Importing settlements',
  'Importing loads',
  'Importing fuel purchases',
  'Importing deductions',
  'Importing maintenance records',
  'Importing tolls',
  'Importing reimbursements',
  'Importing loans',
  'Importing credit cards',
  'Importing capital draws',
  'Importing capital contributions',
  'Importing bank statements',
  'Importing checking statements',
  'Syncing Truck Health & business balance',
  'Running consistency checks',
] as const;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : fallback;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

// Runs one entity's import; if it throws for any reason (a bug, an
// unexpected shape, a network blip), that failure is captured as this
// entity's result instead of propagating up and aborting every step after
// it — the exact "one entity's error aborting/skipping others" failure mode
// that made the previous run under-report silently.
async function runEntity(
  label: string,
  totalInputRows: number,
  fn: () => Promise<{ inserted: number; skipped: number; failed?: number; firstError?: string | null }>
): Promise<LegacyImportEntityResult> {
  try {
    const r = await fn();
    return { label, inserted: r.inserted, skipped: r.skipped, failed: r.failed ?? 0, firstError: r.firstError ?? null };
  } catch (err) {
    return { label, inserted: 0, skipped: 0, failed: totalInputRows, firstError: errorMessage(err) };
  }
}

// ---------- 1. Truck (must exist first — trigger seeds maintenance_intervals) ----------
async function ensureTruck(userId: string, health: LegacyHealth | undefined) {
  const { data: existing, error } = await supabase
    .from('trucks')
    .select('id')
    .eq('user_id', userId)
    .eq('unit_number', '830157')
    .maybeSingle();
  if (error) throw error;
  if (existing) return { truckId: existing.id as string, created: false };

  const insertRow: TruckInsert = {
    user_id: userId,
    unit_number: '830157',
    year: 2023,
    make: 'International',
    model: 'LT',
    engine: 'A26 12.4L',
    fleet_mpg: health?.mpg ?? 8.9,
    current_odometer: health?.odo ?? null,
    apu_hours: health?.apuHours ?? null,
    is_active: true,
  };
  const { data: created, error: insertError } = await supabase
    .from('trucks')
    .insert(insertRow)
    .select('id')
    .single();
  if (insertError) throw insertError;
  return { truckId: created.id as string, created: true };
}

async function applyFluidTypeOverrides(truckId: string, health: LegacyHealth | undefined) {
  if (!health) return;
  if (health.transSynthetic === false) {
    await supabase.from('maintenance_intervals').update({ interval_miles: 250000 }).eq('truck_id', truckId).eq('category', 'trans');
  }
  if (health.diffSynthetic === false) {
    await supabase.from('maintenance_intervals').update({ interval_miles: 100000 }).eq('truck_id', truckId).eq('category', 'diff');
  }
}

// ---------- 2. Settlements ----------
// Legacy itself tolerates a missing weekEnding and falls back to the
// settlement's import `date` in several places (e.g. the CPM chart sort at
// legacy/index.html:1436 — `new Date(a.weekEnding||a.date)`). The importer
// must do the same: treating a missing weekEnding as "no settlement" was
// silently dropping every row whose weekEnding the AI extraction never
// filled in, which is exactly what produced a reported "success" with 0
// settlements imported.
async function importSettlements(userId: string, truckId: string | null, sett: LegacySettlement[]) {
  const dateToSettlementId = new Map<string, string>();

  const withWeek = sett.map((s) => ({ s, week: s.weekEnding || s.date || null }));
  const missingBoth = withWeek.filter((x) => !x.week).length;
  const usable = withWeek.filter((x): x is { s: LegacySettlement; week: string } => !!x.week);

  if (usable.length === 0) {
    return {
      dateToSettlementId,
      inserted: 0,
      skipped: 0,
      failed: missingBoth,
      firstError: missingBoth > 0 ? 'Settlement has neither weekEnding nor date — cannot key it.' : null,
    };
  }

  // Two rows resolving to the same week in a single upsert() statement make
  // Postgres reject the WHOLE statement ("ON CONFLICT DO UPDATE command
  // cannot affect row a second time") — dedupe first so one repeated week
  // can't sink every other settlement in the batch.
  const dedupedByWeek = new Map<string, LegacySettlement>();
  for (const { s, week } of usable) {
    if (!dedupedByWeek.has(week)) dedupedByWeek.set(week, s);
  }
  const collapsedDuplicates = usable.length - dedupedByWeek.size;

  const { data: existing, error: existingError } = await supabase
    .from('settlements')
    .select('week_ending')
    .eq('user_id', userId);
  if (existingError) {
    return { dateToSettlementId, inserted: 0, skipped: 0, failed: usable.length, firstError: errorMessage(existingError) };
  }
  const existingWeeks = new Set((existing ?? []).map((r) => r.week_ending as string));

  const entries = Array.from(dedupedByWeek.entries());
  const toRow = (week: string, s: LegacySettlement) => ({
    user_id: userId,
    truck_id: truckId,
    week_ending: week,
    gross: num(s.gross),
    net: num(s.net),
    miles: num(s.miles),
  });
  const rows = entries.map(([week, s]) => toRow(week, s));

  let inserted = 0;
  let failed = 0;
  let firstError: string | null = null;

  const { data, error } = await supabase
    .from('settlements')
    .upsert(rows, { onConflict: 'user_id,week_ending' })
    .select('id, week_ending');

  if (!error) {
    for (const row of data ?? []) {
      const week = row.week_ending as string;
      const legacyS = dedupedByWeek.get(week);
      dateToSettlementId.set(legacyS?.date ?? week, row.id as string);
      if (!existingWeeks.has(week)) inserted++;
    }
  } else {
    // Bulk upsert failed — fall back row-by-row so one bad settlement
    // doesn't take every other one down with it.
    for (const [week, s] of entries) {
      const { data: single, error: rowError } = await supabase
        .from('settlements')
        .upsert(toRow(week, s), { onConflict: 'user_id,week_ending' })
        .select('id, week_ending')
        .single();
      if (rowError || !single) {
        failed++;
        if (!firstError) firstError = errorMessage(rowError ?? new Error('upsert returned no row'));
        continue;
      }
      dateToSettlementId.set(s.date ?? week, single.id as string);
      if (!existingWeeks.has(week)) inserted++;
    }
  }

  const alreadyExisted = dedupedByWeek.size - inserted - failed;
  return {
    dateToSettlementId,
    inserted,
    skipped: alreadyExisted + collapsedDuplicates,
    failed: failed + missingBoth,
    firstError: firstError ?? (missingBoth > 0 ? `${missingBoth} settlement(s) had neither weekEnding nor date.` : null),
  };
}

// ---------- 3. Loads ----------
function loadKey(row: Record<string, unknown>): string {
  return [row.settlement_id ?? 'none', row.load_date ?? '', row.order_number ?? '', num(row.revenue)].join('|');
}
async function importLoads(userId: string, loads: LegacyLoad[], dateToSettlementId: Map<string, string>): Promise<ImportOutcome> {
  // pickup_date/delivery_date (docs/PENDING_SQL.md §8) feed the per-diem
  // exact day-range calc when the legacy backup happens to have them.
  const rows: LoadInsert[] = loads.map((l) => {
    const pickupDate = l.pickupDate ?? l.date ?? null;
    return {
      user_id: userId,
      settlement_id: dateToSettlementId.get(l.date ?? '') ?? null,
      load_date: pickupDate,
      pickup_date: pickupDate,
      delivery_date: l.deliveryDate ?? pickupDate,
      order_number: l.order ?? null,
      origin: l.from ?? null,
      destination: l.to ?? null,
      loaded_miles: num(l.loadedMiles),
      empty_miles: num(l.emptyMiles),
      revenue: num(l.revenue),
    };
  });
  return importIdempotent({
    table: 'loads',
    userId,
    selectColumns: 'id,settlement_id,load_date,order_number,revenue',
    rows,
    keyOf: loadKey,
  });
}

// ---------- 4. Fuel purchases ----------
function fuelKey(row: Record<string, unknown>): string {
  return [row.settlement_id ?? 'none', row.fuel_type, row.purchase_date ?? '', num(row.amount), num(row.gallons)].join('|');
}
async function importFuel(
  userId: string,
  tractorFuel: LegacyFuel[],
  reeferFuel: LegacyFuel[],
  dateToSettlementId: Map<string, string>
): Promise<ImportOutcome> {
  const toRow = (f: LegacyFuel, fuel_type: 'tractor' | 'reefer'): FuelPurchaseInsert => ({
    user_id: userId,
    settlement_id: dateToSettlementId.get(f.date ?? '') ?? null,
    fuel_type,
    purchase_date: f.date ?? null,
    location: f.location ?? null,
    gallons: f.gallons ?? null,
    amount: f.amount ?? null,
    discount: num(f.discount),
  });
  const rows = [...tractorFuel.map((f) => toRow(f, 'tractor')), ...reeferFuel.map((f) => toRow(f, 'reefer'))];
  return importIdempotent({
    table: 'fuel_purchases',
    userId,
    selectColumns: 'id,settlement_id,fuel_type,purchase_date,amount,gallons',
    rows,
    keyOf: fuelKey,
  });
}

// ---------- 5. Deductions (net-pay model, CLAUDE.md invariant #1) ----------
function inferDeductionSource(d: LegacyDeduction): 'settlement' | 'import' | 'manual' {
  if (d.source === 'settlement' || d.source === 'import' || d.source === 'manual') return d.source;
  if ((d.payment ?? '').toLowerCase() === 'settlement withheld') return 'settlement';
  return 'manual';
}
function dedKey(row: Record<string, unknown>): string {
  return [row.ded_date ?? '', num(row.amount).toFixed(2), row.description ?? ''].join('|');
}
async function importDeductions(userId: string, ded: LegacyDeduction[], dateToSettlementId: Map<string, string>) {
  const pairs = ded.map((d) => {
    const source = inferDeductionSource(d);
    const insert: DeductionInsert = {
      user_id: userId,
      settlement_id: source === 'settlement' ? dateToSettlementId.get(d.date ?? '') ?? null : null,
      ded_date: d.date ?? null,
      code: d.code ?? null,
      description: d.desc ?? null,
      amount: num(d.amount),
      category: d.category ?? null,
      store: d.store ?? null,
      payment_method: d.payment ?? null,
      source,
    };
    return { legacyId: d.id, insert };
  });

  const result = await importIdempotent({
    table: 'deductions',
    userId,
    selectColumns: 'id,ded_date,amount,description',
    rows: pairs.map((p) => p.insert),
    keyOf: dedKey,
  });

  const legacyDedIdToNewId = new Map<string, string>();
  for (const p of pairs) {
    if (!p.legacyId) continue;
    const newId = result.idByKey.get(dedKey(p.insert as unknown as Record<string, unknown>));
    if (newId) legacyDedIdToNewId.set(p.legacyId, newId);
  }

  return { ...result, legacyDedIdToNewId };
}

// ---------- 6. Maintenance records ----------
// Key includes `description`, not just service_type+odometer: same-day
// bundled services (e.g. oil + fuel filter both logged the same day at the
// same odometer) previously collapsed into one another whenever their
// service_type came out identical (undetected type falling back to
// 'general' for both, or the same category used for genuinely distinct
// line items) — description is what actually distinguishes them.
function maintKey(row: Record<string, unknown>): string {
  return [row.truck_id, row.service_date ?? '', row.service_type ?? '', num(row.odometer), row.description ?? ''].join('|');
}
async function importMaintenance(userId: string, truckId: string | null, maint: LegacyMaintenance[]): Promise<ImportOutcome> {
  const rows: MaintenanceRecordInsert[] = maint.map((m) => ({
    user_id: userId,
    truck_id: truckId,
    service_date: m.date ?? null,
    service_type: m.type ?? 'general',
    description: m.desc ?? null,
    odometer: m.odo ?? null,
    engine_hours: m.hours && m.hours > 0 ? m.hours : null,
    cost: num(m.total),
    vendor: m.shop ?? m.unit ?? null,
    invoice_number: m.invoice ?? null,
  }));
  return importIdempotent({
    table: 'maintenance_records',
    userId,
    selectColumns: 'id,truck_id,service_date,service_type,odometer,description',
    rows,
    keyOf: maintKey,
  });
}

// ---------- 7. Tolls ----------
function tollKey(row: Record<string, unknown>): string {
  return [row.toll_date ?? '', num(row.amount).toFixed(2), row.network ?? ''].join('|');
}
async function importTolls(userId: string, ezpass: LegacyToll[], drivewyze: LegacyToll[]): Promise<ImportOutcome> {
  const toRow = (t: LegacyToll, network: 'ezpass' | 'drivewyze'): TollInsert => ({
    user_id: userId,
    network,
    toll_date: t.date ?? null,
    amount: num(t.amount),
    plaza: t.plaza ?? t.location ?? null,
  });
  const rows = [...ezpass.map((t) => toRow(t, 'ezpass')), ...drivewyze.map((t) => toRow(t, 'drivewyze'))];
  return importIdempotent({ table: 'tolls', userId, selectColumns: 'id,toll_date,amount,network', rows, keyOf: tollKey });
}

// ---------- 8. Reimbursements ----------
function reimbKey(row: Record<string, unknown>): string {
  return [row.reimb_date ?? '', num(row.amount).toFixed(2), row.description ?? ''].join('|');
}
async function importReimbursements(userId: string, reimb: LegacyReimbursement[]): Promise<ImportOutcome> {
  const rows: ReimbursementInsert[] = reimb.map((r) => ({
    user_id: userId,
    reimb_date: r.date ?? null,
    description: r.desc ?? null,
    reference: r.ref ?? null,
    amount: num(r.amount),
  }));
  return importIdempotent({
    table: 'reimbursements',
    userId,
    selectColumns: 'id,reimb_date,amount,description',
    rows,
    keyOf: reimbKey,
  });
}

// ---------- 9/10. Loans & credit cards (upsert-by-name) ----------
async function importLoans(userId: string, loans: LegacyLoan[]) {
  if (loans.length === 0) return { inserted: 0, skipped: 0, failed: 0, firstError: null };
  const { data: existing, error } = await supabase.from('loans').select('id, name').eq('user_id', userId);
  if (error) return { inserted: 0, skipped: 0, failed: loans.length, firstError: errorMessage(error) };
  const idByName = new Map((existing ?? []).map((r) => [r.name as string, r.id as string]));
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const l of loans) {
    if (!l.name) {
      failed++;
      if (!firstError) firstError = 'Loan record missing name.';
      continue;
    }
    const row: LoanInsert = {
      user_id: userId,
      name: l.name,
      lender: l.lender ?? null,
      original_amount: l.original ?? null,
      balance: l.balance ?? null,
      payment: l.payment ?? null,
      frequency: l.freq ?? null,
      apr: l.apr ?? null,
      next_due: l.due || null,
    };
    const existingId = idByName.get(l.name);
    const { error: writeError } = existingId
      ? await supabase.from('loans').update(row).eq('id', existingId)
      : await supabase.from('loans').insert(row);
    if (writeError) {
      failed++;
      if (!firstError) firstError = errorMessage(writeError);
      continue;
    }
    if (existingId) updated++;
    else inserted++;
  }
  return { inserted, skipped: updated, failed, firstError };
}

async function importCreditCards(userId: string, cards: LegacyCard[]) {
  if (cards.length === 0) return { inserted: 0, skipped: 0, failed: 0, firstError: null };
  const { data: existing, error } = await supabase.from('credit_cards').select('id, name').eq('user_id', userId);
  if (error) return { inserted: 0, skipped: 0, failed: cards.length, firstError: errorMessage(error) };
  const idByName = new Map((existing ?? []).map((r) => [r.name as string, r.id as string]));
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const c of cards) {
    if (!c.name) {
      failed++;
      if (!firstError) firstError = 'Credit card record missing name.';
      continue;
    }
    const row: CreditCardInsert = {
      user_id: userId,
      name: c.name,
      credit_limit: c.limit ?? null,
      balance: c.balance ?? null,
      apr: c.apr ?? null,
      due_day: c.dueday ? parseInt(c.dueday, 10) || null : null,
    };
    const existingId = idByName.get(c.name);
    const { error: writeError } = existingId
      ? await supabase.from('credit_cards').update(row).eq('id', existingId)
      : await supabase.from('credit_cards').insert(row);
    if (writeError) {
      failed++;
      if (!firstError) firstError = errorMessage(writeError);
      continue;
    }
    if (existingId) updated++;
    else inserted++;
  }
  return { inserted, skipped: updated, failed, firstError };
}

// ---------- 11. Capital draws ----------
function drawKey(row: Record<string, unknown>): string {
  return ['draw', row.tx_date ?? '', num(row.amount).toFixed(2), row.note ?? ''].join('|');
}
async function importDraws(userId: string, draws: LegacyCapitalDraw[]): Promise<ImportOutcome> {
  const rows: CapitalTransactionInsert[] = draws
    .filter((d) => !!d.date)
    .map((d) => ({ user_id: userId, tx_type: 'draw', amount: num(d.amount), tx_date: d.date, note: d.note ?? null }));
  const missingDate = draws.length - rows.length;
  const result = await importIdempotent({
    table: 'capital_transactions',
    userId,
    selectColumns: 'id,tx_type,tx_date,amount,note',
    rows,
    keyOf: drawKey,
  });
  return { ...result, failed: result.failed + missingDate };
}

// ---------- 12. Capital contributions (id-linked to a deduction) ----------
async function importContributions(
  userId: string,
  contributions: LegacyCapitalContribution[],
  legacyDedIdToNewId: Map<string, string>
) {
  const linked = contributions
    .map((c) => ({ c, newDedId: legacyDedIdToNewId.get(c.id) }))
    .filter((x): x is { c: LegacyCapitalContribution; newDedId: string } => !!x.newDedId);
  const orphaned = contributions.length - linked.length;
  if (linked.length === 0) return { inserted: 0, skipped: 0, failed: 0, firstError: null, orphaned };

  const { data: existing, error } = await supabase
    .from('capital_transactions')
    .select('id, linked_deduction_id')
    .eq('user_id', userId)
    .eq('tx_type', 'contribution')
    .in('linked_deduction_id', linked.map((x) => x.newDedId));
  if (error) return { inserted: 0, skipped: 0, failed: linked.length, firstError: errorMessage(error), orphaned };
  const idByDedId = new Map((existing ?? []).map((r) => [r.linked_deduction_id as string, r.id as string]));

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const { c, newDedId } of linked) {
    const row: CapitalTransactionInsert = {
      user_id: userId,
      tx_type: 'contribution',
      amount: num(c.amount),
      tx_date: c.date,
      note: c.note ?? null,
      linked_deduction_id: newDedId,
    };
    const existingId = idByDedId.get(newDedId);
    const { error: writeError } = existingId
      ? await supabase.from('capital_transactions').update(row).eq('id', existingId)
      : await supabase.from('capital_transactions').insert(row);
    if (writeError) {
      failed++;
      if (!firstError) firstError = errorMessage(writeError);
      continue;
    }
    if (existingId) updated++;
    else inserted++;
  }
  return { inserted, skipped: updated, failed, firstError, orphaned };
}

// ---------- 13/14. Bank & checking statements ----------
async function importBankStatements(userId: string, statements: LegacyBackupPayload['bankStatements']) {
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const s of statements ?? []) {
    if (!s.month) {
      failed++;
      if (!firstError) firstError = 'Bank statement missing month.';
      continue;
    }
    const { data: existingStmt } = await supabase
      .from('bank_statements')
      .select('id')
      .eq('user_id', userId)
      .eq('account_type', 'card')
      .eq('statement_month', s.month)
      .maybeSingle();
    if (existingStmt) {
      skipped++;
      continue;
    }
    const { data: created, error } = await supabase
      .from('bank_statements')
      .insert({ user_id: userId, account_type: 'card', statement_month: s.month })
      .select('id')
      .single();
    if (error || !created) {
      failed++;
      if (!firstError) firstError = errorMessage(error ?? new Error('insert returned no row'));
      continue;
    }
    inserted++;
    const txRows = (s.transactions ?? []).map((t) => ({
      statement_id: created.id,
      user_id: userId,
      tx_date: t.date ?? null,
      description: t.merchant ?? null,
      category: t.category ?? null,
      tx_type: 'charge' as const,
      amount: num(t.amount),
      deductible: !!t.deductible,
    }));
    if (txRows.length > 0) {
      const { error: txError } = await supabase.from('bank_transactions').insert(txRows);
      if (txError && !firstError) firstError = errorMessage(txError);
    }
  }
  return { inserted, skipped, failed, firstError };
}

async function importCheckingStatements(userId: string, statements: LegacyBackupPayload['checkingStatements']) {
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const s of statements ?? []) {
    if (!s.month) {
      failed++;
      if (!firstError) firstError = 'Checking statement missing month.';
      continue;
    }
    const { data: existingStmt } = await supabase
      .from('bank_statements')
      .select('id')
      .eq('user_id', userId)
      .eq('account_type', 'checking')
      .eq('statement_month', s.month)
      .maybeSingle();
    if (existingStmt) {
      skipped++;
      continue;
    }
    const { data: created, error } = await supabase
      .from('bank_statements')
      .insert({ user_id: userId, account_type: 'checking', statement_month: s.month })
      .select('id')
      .single();
    if (error || !created) {
      failed++;
      if (!firstError) firstError = errorMessage(error ?? new Error('insert returned no row'));
      continue;
    }
    inserted++;
    const txRows = (s.transactions ?? []).map((t) => ({
      statement_id: created.id,
      user_id: userId,
      tx_date: t.date ?? null,
      description: t.description ?? null,
      category: t.category ?? null,
      tx_type: (t.type ?? null) as 'deposit' | 'withdrawal' | null,
      amount: num(t.amount),
      deductible: false,
    }));
    if (txRows.length > 0) {
      const { error: txError } = await supabase.from('bank_transactions').insert(txRows);
      if (txError && !firstError) firstError = errorMessage(txError);
    }
  }
  return { inserted, skipped, failed, firstError };
}

// ---------- 15. Truck Health overrides + business balance ----------
async function applyHealthOverrides(userId: string, truckId: string, health: LegacyHealth | undefined) {
  if (!health) return 0;
  const categoryToOdo: Record<string, number | undefined> = {
    oil: health.lastOil,
    fuel: health.lastFuelFilter || health.lastOil,
    dpf: health.lastDpf,
    def: health.lastDef,
    coolant_ext: health.lastCoolExt,
    coolant: health.lastCoolant,
    trans: health.lastTrans,
    diff: health.lastDiff,
    airfilter: health.lastAirFilter,
    airdryer: health.lastAirDryer,
    chassis: health.lastChassis,
  };

  const { data: existingMaint } = await supabase.from('maintenance_records').select('service_type').eq('truck_id', truckId);
  const typesWithRecords = new Set((existingMaint ?? []).map((r) => r.service_type as string));

  const overrides: Record<string, { odometer?: number; hours?: number }> = {};
  for (const [category, odo] of Object.entries(categoryToOdo)) {
    if (!odo || odo <= 0) continue;
    if (typesWithRecords.has(category)) continue;
    if (category === 'fuel' && typesWithRecords.has('oil')) continue; // bundled_with_category
    overrides[category] = { odometer: odo };
  }
  if (health.lastApuHours && health.lastApuHours > 0 && !typesWithRecords.has('apu')) {
    overrides.apu = { hours: health.lastApuHours };
  }
  if (Object.keys(overrides).length === 0) return 0;

  const { data: existingConfig } = await supabase
    .from('truck_health_config')
    .select('overrides')
    .eq('truck_id', truckId)
    .maybeSingle();
  const merged = { ...((existingConfig?.overrides as Record<string, unknown>) ?? {}), ...overrides };
  await supabase.from('truck_health_config').upsert({ truck_id: truckId, user_id: userId, overrides: merged });
  return Object.keys(overrides).length;
}

async function updateBusinessBalance(userId: string, bizBalance: LegacyBackupPayload['bizBalance']) {
  if (bizBalance === undefined || bizBalance === null) return false;
  const value = num(bizBalance, NaN);
  if (Number.isNaN(value)) return false;
  await supabase.from('profiles').update({ business_balance: value }).eq('user_id', userId);
  return true;
}

// ---------- 16. Consistency passes (mirrors legacy's on-load re-sync) ----------
async function runConsistencyPasses(userId: string): Promise<string[]> {
  const warnings: string[] = [];

  const { data: mistagged, error } = await supabase
    .from('deductions')
    .select('id')
    .eq('user_id', userId)
    .ilike('payment_method', 'settlement withheld')
    .neq('source', 'settlement');
  if (error) throw error;
  if (mistagged && mistagged.length > 0) {
    await supabase
      .from('deductions')
      .update({ source: 'settlement' })
      .in('id', mistagged.map((r) => r.id));
    warnings.push(`Re-tagged ${mistagged.length} settlement-withheld deduction(s) missing source='settlement'.`);
  }
  // "Remove orphaned contributions" (legacy cleanupOrphanedContributions):
  // structurally impossible here — capital_transactions.linked_deduction_id
  // is ON DELETE CASCADE, so a contribution can never outlive its deduction.

  return warnings;
}

export async function importLegacyBackup(
  payload: LegacyBackupPayload,
  userId: string,
  onProgress?: (p: ImportProgress) => void
): Promise<LegacyImportResult> {
  const total = STEPS.length;
  const report = (index: number) => onProgress?.({ label: STEPS[index], index, total });
  const entities: LegacyImportEntityResult[] = [];
  const warnings: string[] = [];
  const db = payload.DB ?? {};

  report(0);
  let truckId: string | null = null;
  let truckCreated = false;
  try {
    const r = await ensureTruck(userId, payload.health);
    truckId = r.truckId;
    truckCreated = r.created;
    if (truckCreated) await applyFluidTypeOverrides(truckId, payload.health);
  } catch (err) {
    warnings.push(`Could not create/find the truck profile — truck-scoped records will import without a truck link: ${errorMessage(err)}`);
  }

  // Settlements returns dateToSettlementId (needed by loads/fuel/deductions
  // below) alongside the standard counts — call it directly rather than
  // through runEntity() so that map survives a partial failure too.
  report(1);
  let dateToSettlementId = new Map<string, string>();
  try {
    const r = await importSettlements(userId, truckId, db.sett ?? []);
    dateToSettlementId = r.dateToSettlementId;
    entities.push({ label: 'Settlements', inserted: r.inserted, skipped: r.skipped, failed: r.failed, firstError: r.firstError });
  } catch (err) {
    entities.push({ label: 'Settlements', inserted: 0, skipped: 0, failed: (db.sett ?? []).length, firstError: errorMessage(err) });
  }

  report(2);
  entities.push(await runEntity('Loads', (db.loads ?? []).length, () => importLoads(userId, db.loads ?? [], dateToSettlementId)));

  report(3);
  entities.push(
    await runEntity('Fuel purchases', (db.fuel?.tr?.length ?? 0) + (db.fuel?.re?.length ?? 0), () =>
      importFuel(userId, db.fuel?.tr ?? [], db.fuel?.re ?? [], dateToSettlementId)
    )
  );

  // Deductions returns legacyDedIdToNewId (needed by capital contributions
  // below) alongside the standard counts — same reasoning as settlements.
  report(4);
  let legacyDedIdToNewId = new Map<string, string>();
  try {
    const r = await importDeductions(userId, db.ded ?? [], dateToSettlementId);
    legacyDedIdToNewId = r.legacyDedIdToNewId;
    entities.push({ label: 'Deductions', inserted: r.inserted, skipped: r.skipped, failed: r.failed, firstError: r.firstError });
  } catch (err) {
    entities.push({ label: 'Deductions', inserted: 0, skipped: 0, failed: (db.ded ?? []).length, firstError: errorMessage(err) });
  }

  report(5);
  entities.push(await runEntity('Maintenance records', (db.maint ?? []).length, () => importMaintenance(userId, truckId, db.maint ?? [])));

  report(6);
  entities.push(
    await runEntity('Tolls', (db.tolls?.ez?.length ?? 0) + (db.tolls?.dw?.length ?? 0), () =>
      importTolls(userId, db.tolls?.ez ?? [], db.tolls?.dw ?? [])
    )
  );

  report(7);
  entities.push(await runEntity('Reimbursements', (db.reimb ?? []).length, () => importReimbursements(userId, db.reimb ?? [])));

  report(8);
  entities.push(await runEntity('Loans', (payload.loans ?? []).length, () => importLoans(userId, payload.loans ?? [])));

  report(9);
  entities.push(await runEntity('Credit cards', (payload.cards ?? []).length, () => importCreditCards(userId, payload.cards ?? [])));

  report(10);
  entities.push(await runEntity('Capital draws', (payload.capitalDraws ?? []).length, () => importDraws(userId, payload.capitalDraws ?? [])));

  // Capital contributions returns `orphaned` alongside the standard counts —
  // same reasoning as settlements/deductions above.
  report(11);
  try {
    const r = await importContributions(userId, payload.capitalContributions ?? [], legacyDedIdToNewId);
    entities.push({ label: 'Capital contributions', inserted: r.inserted, skipped: r.skipped, failed: r.failed, firstError: r.firstError });
    if (r.orphaned > 0) {
      warnings.push(`${r.orphaned} capital contribution(s) referenced a deduction not found in this backup — skipped.`);
    }
  } catch (err) {
    entities.push({
      label: 'Capital contributions',
      inserted: 0,
      skipped: 0,
      failed: (payload.capitalContributions ?? []).length,
      firstError: errorMessage(err),
    });
  }

  report(12);
  entities.push(
    await runEntity('Bank (card) statements', (payload.bankStatements ?? []).length, () =>
      importBankStatements(userId, payload.bankStatements)
    )
  );

  report(13);
  entities.push(
    await runEntity('Checking statements', (payload.checkingStatements ?? []).length, () =>
      importCheckingStatements(userId, payload.checkingStatements)
    )
  );

  report(14);
  if (truckId) {
    try {
      const healthCategoriesWritten = await applyHealthOverrides(userId, truckId, payload.health);
      if (healthCategoriesWritten > 0) {
        warnings.push(`Wrote ${healthCategoriesWritten} manual Truck Health baseline override(s) with no backing maintenance record.`);
      }
    } catch (err) {
      warnings.push(`Truck Health override sync failed: ${errorMessage(err)}`);
    }
  }
  try {
    const balanceUpdated = await updateBusinessBalance(userId, payload.bizBalance);
    if (balanceUpdated) warnings.push('Business balance updated from backup.');
  } catch (err) {
    warnings.push(`Business balance update failed: ${errorMessage(err)}`);
  }

  if (db.docs && db.docs.length > 0) {
    warnings.push(`Skipped ${db.docs.length} legacy document-archive entr(y/ies) — no source file to store.`);
  }

  report(15);
  try {
    const consistencyWarnings = await runConsistencyPasses(userId);
    warnings.push(...consistencyWarnings);
  } catch (err) {
    warnings.push(`Consistency pass failed: ${errorMessage(err)}`);
  }

  return { truckId, truckCreated, entities, warnings };
}
