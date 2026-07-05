import { supabase } from '@/src/lib/supabase';
import { importIdempotent } from '@/src/data/legacyImport/idempotent';
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

export type LegacyImportEntityResult = { label: string; inserted: number; skipped: number };
export type LegacyImportResult = {
  truckId: string;
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

// Only applied right after truck creation — the DB trigger just seeded
// synthetic-fluid defaults (500k/500k); a freshly-created truck's intervals
// are still the untouched seed, so it's safe to correct them here without
// clobbering later owner edits (CLAUDE.md invariant #4: user-editable, not
// re-asserted on every re-import).
async function applyFluidTypeOverrides(truckId: string, health: LegacyHealth | undefined) {
  if (!health) return;
  if (health.transSynthetic === false) {
    await supabase.from('maintenance_intervals').update({ interval_miles: 250000 }).eq('truck_id', truckId).eq('category', 'trans');
  }
  if (health.diffSynthetic === false) {
    await supabase.from('maintenance_intervals').update({ interval_miles: 100000 }).eq('truck_id', truckId).eq('category', 'diff');
  }
}

// ---------- 2. Settlements (upsert on the unique (user_id, week_ending)) ----------
async function importSettlements(userId: string, truckId: string, sett: NonNullable<LegacyBackupPayload['DB']>['sett']) {
  const validSett = (sett ?? []).filter((s) => !!s.weekEnding);
  if (validSett.length === 0) return { dateToSettlementId: new Map<string, string>(), inserted: 0, skipped: 0 };

  const { data: existing, error: existingError } = await supabase
    .from('settlements')
    .select('week_ending')
    .eq('user_id', userId);
  if (existingError) throw existingError;
  const existingWeeks = new Set((existing ?? []).map((r) => r.week_ending as string));

  const rows = validSett.map((s) => ({
    user_id: userId,
    truck_id: truckId,
    week_ending: s.weekEnding,
    gross: num(s.gross),
    net: num(s.net),
    miles: num(s.miles),
  }));

  const { data, error } = await supabase
    .from('settlements')
    .upsert(rows, { onConflict: 'user_id,week_ending' })
    .select('id, week_ending');
  if (error) throw error;

  const idByWeek = new Map<string, string>();
  for (const row of data ?? []) idByWeek.set(row.week_ending as string, row.id as string);

  // Loads/fuel/tolls/deductions in the legacy record carry the settlement's
  // import `date`, not `weekEnding` (legacy handleFile() stamps all of them
  // with the same d.date in one synchronous pass) — key the lookup that way.
  const dateToSettlementId = new Map<string, string>();
  for (const s of validSett) {
    const id = idByWeek.get(s.weekEnding);
    if (id) dateToSettlementId.set(s.date ?? s.weekEnding, id);
  }

  const inserted = validSett.filter((s) => !existingWeeks.has(s.weekEnding)).length;
  return { dateToSettlementId, inserted, skipped: validSett.length - inserted };
}

// ---------- 3. Loads ----------
function loadKey(row: Record<string, unknown>): string {
  return [row.settlement_id ?? 'none', row.load_date ?? '', row.order_number ?? '', num(row.revenue)].join('|');
}
async function importLoads(userId: string, loads: LegacyLoad[], dateToSettlementId: Map<string, string>) {
  const rows: LoadInsert[] = loads.map((l) => ({
    user_id: userId,
    settlement_id: dateToSettlementId.get(l.date ?? '') ?? null,
    load_date: l.pickupDate ?? l.date ?? null,
    order_number: l.order ?? null,
    origin: l.from ?? null,
    destination: l.to ?? null,
    loaded_miles: num(l.loadedMiles),
    empty_miles: num(l.emptyMiles),
    revenue: num(l.revenue),
  }));
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
) {
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
function maintKey(row: Record<string, unknown>): string {
  return [row.truck_id, row.service_date ?? '', row.service_type ?? '', num(row.odometer)].join('|');
}
async function importMaintenance(userId: string, truckId: string, maint: LegacyMaintenance[]) {
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
    selectColumns: 'id,truck_id,service_date,service_type,odometer',
    rows,
    keyOf: maintKey,
  });
}

// ---------- 7. Tolls ----------
function tollKey(row: Record<string, unknown>): string {
  return [row.toll_date ?? '', num(row.amount).toFixed(2), row.network ?? ''].join('|');
}
async function importTolls(userId: string, ezpass: LegacyToll[], drivewyze: LegacyToll[]) {
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
async function importReimbursements(userId: string, reimb: LegacyReimbursement[]) {
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

// ---------- 9/10. Loans & credit cards (upsert-by-name — legacy's own restore fully replaces the list; ours updates in place instead so re-importing a newer backup refreshes balances without duplicating rows) ----------
async function importLoans(userId: string, loans: LegacyLoan[]) {
  if (loans.length === 0) return { inserted: 0, skipped: 0 };
  const { data: existing, error } = await supabase.from('loans').select('id, name').eq('user_id', userId);
  if (error) throw error;
  const idByName = new Map((existing ?? []).map((r) => [r.name as string, r.id as string]));
  let inserted = 0;
  let updated = 0;
  for (const l of loans) {
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
    if (existingId) {
      const { error: updateError } = await supabase.from('loans').update(row).eq('id', existingId);
      if (updateError) throw updateError;
      updated++;
    } else {
      const { error: insertError } = await supabase.from('loans').insert(row);
      if (insertError) throw insertError;
      inserted++;
    }
  }
  return { inserted, skipped: updated };
}

async function importCreditCards(userId: string, cards: LegacyCard[]) {
  if (cards.length === 0) return { inserted: 0, skipped: 0 };
  const { data: existing, error } = await supabase.from('credit_cards').select('id, name').eq('user_id', userId);
  if (error) throw error;
  const idByName = new Map((existing ?? []).map((r) => [r.name as string, r.id as string]));
  let inserted = 0;
  let updated = 0;
  for (const c of cards) {
    const row: CreditCardInsert = {
      user_id: userId,
      name: c.name,
      credit_limit: c.limit ?? null,
      balance: c.balance ?? null,
      apr: c.apr ?? null,
      due_day: c.dueday ? parseInt(c.dueday, 10) || null : null,
    };
    const existingId = idByName.get(c.name);
    if (existingId) {
      const { error: updateError } = await supabase.from('credit_cards').update(row).eq('id', existingId);
      if (updateError) throw updateError;
      updated++;
    } else {
      const { error: insertError } = await supabase.from('credit_cards').insert(row);
      if (insertError) throw insertError;
      inserted++;
    }
  }
  return { inserted, skipped: updated };
}

// ---------- 11. Capital draws ----------
function drawKey(row: Record<string, unknown>): string {
  return ['draw', row.tx_date ?? '', num(row.amount).toFixed(2), row.note ?? ''].join('|');
}
async function importDraws(userId: string, draws: LegacyCapitalDraw[]) {
  const rows: CapitalTransactionInsert[] = draws
    .filter((d) => !!d.date)
    .map((d) => ({ user_id: userId, tx_type: 'draw', amount: num(d.amount), tx_date: d.date, note: d.note ?? null }));
  return importIdempotent({
    table: 'capital_transactions',
    userId,
    selectColumns: 'id,tx_type,tx_date,amount,note',
    rows,
    keyOf: drawKey,
  });
}

// ---------- 12. Capital contributions (id-linked to a deduction — CLAUDE.md invariant #2) ----------
async function importContributions(
  userId: string,
  contributions: LegacyCapitalContribution[],
  legacyDedIdToNewId: Map<string, string>
) {
  const linked = contributions
    .map((c) => ({ c, newDedId: legacyDedIdToNewId.get(c.id) }))
    .filter((x): x is { c: LegacyCapitalContribution; newDedId: string } => !!x.newDedId);
  const orphaned = contributions.length - linked.length;
  if (linked.length === 0) return { inserted: 0, skipped: 0, orphaned };

  const { data: existing, error } = await supabase
    .from('capital_transactions')
    .select('id, linked_deduction_id')
    .eq('user_id', userId)
    .eq('tx_type', 'contribution')
    .in('linked_deduction_id', linked.map((x) => x.newDedId));
  if (error) throw error;
  const idByDedId = new Map((existing ?? []).map((r) => [r.linked_deduction_id as string, r.id as string]));

  let inserted = 0;
  let updated = 0;
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
    if (existingId) {
      const { error: updateError } = await supabase.from('capital_transactions').update(row).eq('id', existingId);
      if (updateError) throw updateError;
      updated++;
    } else {
      const { error: insertError } = await supabase.from('capital_transactions').insert(row);
      if (insertError) throw insertError;
      inserted++;
    }
  }
  return { inserted, skipped: updated, orphaned };
}

// ---------- 13/14. Bank & checking statements ----------
async function importBankStatements(userId: string, statements: LegacyBackupPayload['bankStatements']) {
  let inserted = 0;
  let skipped = 0;
  for (const s of statements ?? []) {
    if (!s.month) continue;
    const { data: existing } = await supabase
      .from('bank_statements')
      .select('id')
      .eq('user_id', userId)
      .eq('account_type', 'card')
      .eq('statement_month', s.month)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    const { data: created, error } = await supabase
      .from('bank_statements')
      .insert({ user_id: userId, account_type: 'card', statement_month: s.month })
      .select('id')
      .single();
    if (error) throw error;
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
      if (txError) throw txError;
    }
  }
  return { inserted, skipped };
}

async function importCheckingStatements(userId: string, statements: LegacyBackupPayload['checkingStatements']) {
  let inserted = 0;
  let skipped = 0;
  for (const s of statements ?? []) {
    if (!s.month) continue;
    const { data: existing } = await supabase
      .from('bank_statements')
      .select('id')
      .eq('user_id', userId)
      .eq('account_type', 'checking')
      .eq('statement_month', s.month)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    const { data: created, error } = await supabase
      .from('bank_statements')
      .insert({ user_id: userId, account_type: 'checking', statement_month: s.month })
      .select('id')
      .single();
    if (error) throw error;
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
      if (txError) throw txError;
    }
  }
  return { inserted, skipped };
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
  const { truckId, created: truckCreated } = await ensureTruck(userId, payload.health);
  if (truckCreated) await applyFluidTypeOverrides(truckId, payload.health);

  report(1);
  const { dateToSettlementId, inserted: sInserted, skipped: sSkipped } = await importSettlements(
    userId,
    truckId,
    db.sett ?? []
  );
  entities.push({ label: 'Settlements', inserted: sInserted, skipped: sSkipped });

  report(2);
  const loadsResult = await importLoads(userId, db.loads ?? [], dateToSettlementId);
  entities.push({ label: 'Loads', inserted: loadsResult.inserted, skipped: loadsResult.skipped });

  report(3);
  const fuelResult = await importFuel(userId, db.fuel?.tr ?? [], db.fuel?.re ?? [], dateToSettlementId);
  entities.push({ label: 'Fuel purchases', inserted: fuelResult.inserted, skipped: fuelResult.skipped });

  report(4);
  const dedResult = await importDeductions(userId, db.ded ?? [], dateToSettlementId);
  entities.push({ label: 'Deductions', inserted: dedResult.inserted, skipped: dedResult.skipped });

  report(5);
  const maintResult = await importMaintenance(userId, truckId, db.maint ?? []);
  entities.push({ label: 'Maintenance records', inserted: maintResult.inserted, skipped: maintResult.skipped });

  report(6);
  const tollsResult = await importTolls(userId, db.tolls?.ez ?? [], db.tolls?.dw ?? []);
  entities.push({ label: 'Tolls', inserted: tollsResult.inserted, skipped: tollsResult.skipped });

  report(7);
  const reimbResult = await importReimbursements(userId, db.reimb ?? []);
  entities.push({ label: 'Reimbursements', inserted: reimbResult.inserted, skipped: reimbResult.skipped });

  report(8);
  const loansResult = await importLoans(userId, payload.loans ?? []);
  entities.push({ label: 'Loans', inserted: loansResult.inserted, skipped: loansResult.skipped });

  report(9);
  const cardsResult = await importCreditCards(userId, payload.cards ?? []);
  entities.push({ label: 'Credit cards', inserted: cardsResult.inserted, skipped: cardsResult.skipped });

  report(10);
  const drawsResult = await importDraws(userId, payload.capitalDraws ?? []);
  entities.push({ label: 'Capital draws', inserted: drawsResult.inserted, skipped: drawsResult.skipped });

  report(11);
  const contribResult = await importContributions(
    userId,
    payload.capitalContributions ?? [],
    dedResult.legacyDedIdToNewId
  );
  entities.push({ label: 'Capital contributions', inserted: contribResult.inserted, skipped: contribResult.skipped });
  if (contribResult.orphaned > 0) {
    warnings.push(
      `${contribResult.orphaned} capital contribution(s) referenced a deduction not found in this backup — skipped.`
    );
  }

  report(12);
  const bankResult = await importBankStatements(userId, payload.bankStatements);
  entities.push({ label: 'Bank (card) statements', inserted: bankResult.inserted, skipped: bankResult.skipped });

  report(13);
  const checkingResult = await importCheckingStatements(userId, payload.checkingStatements);
  entities.push({ label: 'Checking statements', inserted: checkingResult.inserted, skipped: checkingResult.skipped });

  report(14);
  const healthCategoriesWritten = await applyHealthOverrides(userId, truckId, payload.health);
  const balanceUpdated = await updateBusinessBalance(userId, payload.bizBalance);
  if (healthCategoriesWritten > 0) {
    warnings.push(`Wrote ${healthCategoriesWritten} manual Truck Health baseline override(s) with no backing maintenance record.`);
  }
  if (balanceUpdated) warnings.push('Business balance updated from backup.');

  if (db.docs && db.docs.length > 0) {
    warnings.push(`Skipped ${db.docs.length} legacy document-archive entr(y/ies) — no source file to store.`);
  }

  report(15);
  const consistencyWarnings = await runConsistencyPasses(userId);
  warnings.push(...consistencyWarnings);

  return { truckId, truckCreated, entities, warnings };
}
