// Batch A item 7 (2026-10-30): delete a document and everything linked.
// Runs the real documentDelete.ts against fakeSupabase.ts, whose §80 RPC
// fake mirrors PENDING_SQL §80 (scoped to the caller, all-or-nothing) and
// whose FK rules mirror the documented cascades. Honest boundary: this
// proves the client flow and the deletion SHAPE; the PL/pgSQL body itself
// runs only on the live database (§80's check query).
import * as fs from 'fs';
import * as path from 'path';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase, type FakeSupabaseFailure, type FakeSupabaseStore } from './fakeSupabase';
import {
  DocumentDeleteNotInstalledError,
  affectedWeekEnding,
  deleteDocumentCascade,
  documentDeleteProfitEffect,
  linkedRowCount,
  previewDocumentDelete,
  retryPendingStorageRemovals,
  settlementWeekToConfirm,
  typedConfirmationMatches,
  type KeyValueStore,
} from '@/src/data/documentDelete';
import { DOCUMENT_REFERENCES } from '@/src/data/documentReferences';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { checkDuplicateImport } from '@/src/import/duplicateCheck';
import { computeKpis } from '@/src/stats/kpi';
import type { Extraction } from '@/src/import/types';

const ME = 'user-1';
const OTHER = 'user-2';
const TRUCK = 'truck-1';

function memoryKv(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    async getItem(k) {
      return data[k] ?? null;
    },
    async setItem(k, v) {
      data[k] = v;
    },
  };
}

// The account WITHOUT either document: one other settlement week and a
// manual expense. Every "after delete" store must equal this.
function baseFixture(): FakeSupabaseStore {
  return {
    trucks: [{ id: TRUCK, user_id: ME, unit_number: '100', is_active: true }],
    documents: [{ id: 'doc-other', user_id: ME, doc_type: 'fuel', storage_path: `${ME}/2026-08/Fuel/other.pdf` }],
    settlements: [{ id: 's-0814', user_id: ME, truck_id: TRUCK, week_ending: '2026-08-14', gross: 5000, net: 3000, miles: 2000, document_id: null }],
    loads: [{ id: 'l-0814', user_id: ME, settlement_id: 's-0814', revenue: 5000, loaded_miles: 2000 }],
    deductions: [
      { id: 'd-manual', user_id: ME, truck_id: null, ded_date: '2026-08-18', amount: 20, category: 'Misc', source: 'manual', document_id: null, settlement_id: null },
    ],
    fuel_purchases: [],
    maintenance_records: [],
    tolls: [],
    reimbursements: [],
    capital_transactions: [],
    equipment: [],
    driver_payments: [],
    loans: [{ id: 'loan-manual', user_id: ME, name: 'Truck note', balance: 40000, settlement_id: null, source: 'manual' }],
    import_jobs: [],
    prime_driver_expenses: [],
    misc_income: [],
    household_income: [],
    compliance_items: [],
    bank_statements: [],
  };
}

// + a store receipt that created a deduction, a capital contribution
//   (owner-paid sync) and an equipment row.
// + a settlement document (W/E 8/21) with its children, a driver share, a
//   loan created from it, and an attached compliance item.
// + another user's document.
function fullFixture(): FakeSupabaseStore {
  const s = baseFixture();
  s.documents.push(
    { id: 'doc-receipt', user_id: ME, doc_type: 'store', doc_date: '2026-08-19', amount: 66.3, filename: 'walmart.jpg', storage_path: `${ME}/2026-08/Store/walmart.jpg` },
    { id: 'doc-sett', user_id: ME, doc_type: 'settlement', doc_date: '2026-08-21', amount: 1884.73, filename: 'settlement.pdf', storage_path: `${ME}/2026-08/Payroll/Week-3/settlement.pdf` },
    { id: 'doc-theirs', user_id: OTHER, doc_type: 'store', storage_path: `${OTHER}/x.jpg` }
  );
  s.deductions.push(
    { id: 'd-receipt', user_id: ME, truck_id: null, ded_date: '2026-08-19', amount: 66.3, category: 'Safety Gear & Workwear', source: 'import', document_id: 'doc-receipt', settlement_id: null },
    { id: 'd-withheld', user_id: ME, truck_id: TRUCK, ded_date: '2026-08-21', amount: 300, category: 'Escrow & Deposits', source: 'settlement', document_id: 'doc-sett', settlement_id: 's-0821' },
    { id: 'd-theirs', user_id: OTHER, truck_id: null, ded_date: '2026-08-19', amount: 5, category: 'Misc', source: 'manual', document_id: 'doc-theirs', settlement_id: null }
  );
  s.capital_transactions.push({ id: 'c-receipt', user_id: ME, tx_type: 'contribution', amount: 66.3, linked_deduction_id: 'd-receipt' });
  s.equipment.push({ id: 'e-receipt', user_id: ME, name: 'Rain jacket', purchase_price: 66.3, linked_deduction_id: 'd-receipt' });
  s.settlements.push({ id: 's-0821', user_id: ME, truck_id: TRUCK, week_ending: '2026-08-21', gross: 4783.75, net: 1884.73, miles: 2327, document_id: 'doc-sett' });
  s.loads.push({ id: 'l-0821', user_id: ME, settlement_id: 's-0821', revenue: 4783.75, loaded_miles: 2327 });
  s.fuel_purchases.push({ id: 'f-0821', user_id: ME, truck_id: TRUCK, settlement_id: 's-0821', purchase_date: '2026-08-19', amount: 900 });
  s.reimbursements.push({ id: 'r-0821', user_id: ME, settlement_id: 's-0821', amount: 85 });
  s.tolls.push({ id: 't-0821', user_id: ME, truck_id: TRUCK, settlement_id: 's-0821', toll_date: '2026-08-20', amount: 12 });
  s.driver_payments.push({ id: 'p-0821', user_id: ME, driver_id: 'drv', settlement_id: 's-0821', gross_pay: 400 });
  s.loans.push({ id: 'loan-sett', user_id: ME, name: 'Warranty', balance: 1200, settlement_id: 's-0821', source: 'settlement' });
  s.import_jobs.push({ id: 'job-0821', user_id: ME, document_id: 'doc-sett', storage_path: `${ME}/2026-08/Payroll/Week-3/settlement.pdf` });
  s.compliance_items.push({ id: 'ci-receipt', user_id: ME, source_document_id: 'doc-receipt', truck_id: null });
  return s;
}

const kpis = (s: FakeSupabaseStore, window: { startIso: string; endIso: string } | null) =>
  computeKpis({
    trucks: s.trucks as never,
    settlements: s.settlements as never,
    loads: s.loads as never,
    deductions: s.deductions.filter((d) => d.user_id === ME) as never,
    fuelPurchases: s.fuel_purchases as never,
    maintenanceRecords: s.maintenance_records as never,
    tolls: s.tolls as never,
    reimbursements: s.reimbursements as never,
    truckScope: null,
    window,
  });

const mineOnly = (s: FakeSupabaseStore) =>
  Object.fromEntries(Object.entries(s).map(([t, rows]) => [t, rows.filter((r) => r.user_id === undefined || r.user_id === ME)]));

describe('receipt that created a deduction, a capital contribution and an equipment row', () => {
  it('preview lists all three with dollars; nothing is a settlement, no week to type', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    const preview = await previewDocumentDelete('doc-receipt');
    expect(preview.status).toBe('ok');
    if (preview.status !== 'ok') return;
    const byTable = Object.fromEntries(preview.tables.map((t) => [`${t.table}:${t.kind}`, t]));
    expect(byTable['deductions:attached']).toMatchObject({ count: 1, amount: 66.3, ids: ['d-receipt'] });
    expect(byTable['capital_transactions:attached']).toMatchObject({ count: 1, amount: 66.3 });
    expect(byTable['equipment:attached']).toMatchObject({ count: 1, amount: 66.3 });
    expect(byTable['compliance_items:attached']).toMatchObject({ count: 1 });
    expect(linkedRowCount(preview)).toBe(4);
    expect(settlementWeekToConfirm(preview)).toBeNull();
    expect(typedConfirmationMatches('', null)).toBe(true);
    expect(affectedWeekEnding(preview)).toBe('2026-08-22'); // the Saturday after 8/19
  });

  it('delete all removes all three, and every total equals an account that never had the document', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    const kv = memoryKv();
    const result = await deleteDocumentCascade('doc-receipt', 'all', kv);
    expect(result).toMatchObject({ status: 'deleted', storageRemoved: true, deleted: { deductions: 1, capital_transactions: 1, equipment: 1, compliance_items: 1 } });
    const s = mockClient.__store;
    expect(s.deductions.map((d) => d.id)).not.toContain('d-receipt');
    expect(s.capital_transactions).toEqual([]);
    expect(s.equipment).toEqual([]);
    expect(s.documents.map((d) => d.id)).not.toContain('doc-receipt');
    expect(mockClient.__removedStoragePaths).toEqual([`${ME}/2026-08/Store/walmart.jpg`]);

    // Same account minus the receipt and its rows == fixture without it.
    const without = fullFixture();
    without.documents = without.documents.filter((d) => d.id !== 'doc-receipt');
    without.deductions = without.deductions.filter((d) => d.id !== 'd-receipt');
    without.capital_transactions = [];
    without.equipment = [];
    without.compliance_items = [];
    expect(s).toEqual(without);
    for (const w of [null, { startIso: '2026-08-16', endIso: '2026-08-22' }]) {
      const a = kpis(s, w);
      const b = kpis(without, w);
      expect([a.gross, a.net, a.expenses.total]).toEqual([b.gross, b.net, b.expenses.total]);
    }
  });
});

describe('settlement document', () => {
  it('preview: whole settlement, children counted, loan kept, week ending to type, profit before → after', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    const preview = await previewDocumentDelete('doc-sett');
    if (preview.status !== 'ok') throw new Error('expected ok');
    expect(preview.settlements).toEqual([{ id: 's-0821', week_ending: '2026-08-21', gross: 4783.75, net: 1884.73, truck_id: TRUCK }]);
    const kinds = Object.fromEntries(preview.tables.map((t) => [t.table, t.kind]));
    expect(kinds).toMatchObject({
      settlements: 'derived',
      loads: 'derived',
      fuel_purchases: 'derived',
      reimbursements: 'derived',
      tolls: 'derived',
      deductions: 'derived',
      driver_payments: 'derived',
      import_jobs: 'derived',
      loans: 'kept',
    });
    expect(settlementWeekToConfirm(preview)).toBe('2026-08-21');
    expect(typedConfirmationMatches('2026-08-2', '2026-08-21')).toBe(false);
    expect(typedConfirmationMatches(' 2026-08-21 ', '2026-08-21')).toBe(true);

    const store = mockClient.__store;
    const inputs = {
      trucks: store.trucks,
      settlements: store.settlements,
      loads: store.loads,
      deductions: store.deductions.filter((d) => d.user_id === ME),
      fuelPurchases: store.fuel_purchases,
      maintenanceRecords: store.maintenance_records,
      tolls: store.tolls,
      reimbursements: store.reimbursements,
    } as never;
    const effect = documentDeleteProfitEffect(preview, 'all', inputs)!;
    const week = { startIso: '2026-08-15', endIso: '2026-08-21' };
    expect(effect.weekEnding).toBe('2026-08-21');
    expect(effect.before).toBeCloseTo(kpis(store, week).net, 10);
    expect(effect.before).not.toBeCloseTo(effect.after, 2);
    expect(documentDeleteProfitEffect(preview, 'file_only', inputs)).toEqual({ weekEnding: '2026-08-21', before: effect.before, after: effect.before });

    // The previewed "after" is what the account really shows after the delete.
    await deleteDocumentCascade('doc-sett', 'all', memoryKv());
    expect(kpis(mockClient.__store, week).net).toBeCloseTo(effect.after, 10);
  });

  it('delete all removes the settlement, its children, its driver share and the import job; the loan stays un-linked', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    await deleteDocumentCascade('doc-sett', 'all', memoryKv());
    const s = mockClient.__store;
    const without = fullFixture();
    without.documents = without.documents.filter((d) => d.id !== 'doc-sett');
    without.settlements = without.settlements.filter((r) => r.id !== 's-0821');
    without.loads = without.loads.filter((r) => r.id !== 'l-0821');
    without.deductions = without.deductions.filter((r) => r.id !== 'd-withheld');
    without.fuel_purchases = [];
    without.reimbursements = [];
    without.tolls = [];
    without.driver_payments = [];
    without.import_jobs = [];
    without.loans = without.loans.map((l) => (l.id === 'loan-sett' ? { ...l, settlement_id: null } : l));
    expect(s).toEqual(without);
    // profit, gross and the deposit (net) of every remaining week equal the fixture.
    expect(kpis(s, null).net).toBeCloseTo(kpis(without, null).net, 10);
    expect(s.settlements.reduce((sum, r) => sum + Number(r.net), 0)).toBe(3000);
  });

  it('"file only" keeps every record and clears only the links', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    const before = fullFixture();
    const result = await deleteDocumentCascade('doc-sett', 'file_only', memoryKv());
    expect(result).toMatchObject({ status: 'deleted', mode: 'file_only', deleted: {} });
    const s = mockClient.__store;
    expect(s.settlements.find((r) => r.id === 's-0821')).toMatchObject({ document_id: null, gross: 4783.75 });
    expect(s.loads).toHaveLength(before.loads.length);
    expect(s.deductions).toHaveLength(before.deductions.length);
    expect(s.driver_payments).toHaveLength(1);
    expect(s.documents.map((d) => d.id)).not.toContain('doc-sett');
    expect(kpis(s, null).net).toBeCloseTo(kpis(before, null).net, 10);
  });
});

describe('safety', () => {
  it('a failure halfway rolls everything back', async () => {
    const failure: FakeSupabaseFailure = { table: 'bank_statements', mode: 'delete', error: { message: 'boom', code: 'XX000' } };
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME, failures: [failure] });
    await expect(deleteDocumentCascade('doc-sett', 'all', memoryKv())).rejects.toMatchObject({ message: 'boom' });
    expect(mockClient.__store).toEqual(fullFixture());
    expect(mockClient.__removedStoragePaths).toEqual([]);
  });

  it("another user's document cannot be previewed or deleted", async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    expect(await previewDocumentDelete('doc-theirs')).toEqual({ status: 'not_found' });
    expect(await deleteDocumentCascade('doc-theirs', 'all', memoryKv())).toEqual({ status: 'not_found' });
    expect(mockClient.__store).toEqual(fullFixture());
  });

  it('idempotent: a second delete changes nothing', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    await deleteDocumentCascade('doc-receipt', 'all', memoryKv());
    const after = JSON.stringify(mockClient.__store);
    expect(await deleteDocumentCascade('doc-receipt', 'all', memoryKv())).toEqual({ status: 'not_found' });
    expect(JSON.stringify(mockClient.__store)).toBe(after);
  });

  it('re-importing the same file after a delete is not flagged as a duplicate', async () => {
    mockClient = createFakeSupabase(fullFixture(), { authUserId: ME });
    const extraction = { docType: 'store', date: '2026-08-19', totalAmount: 66.3 } as unknown as Extraction;
    const docsOf = () => mineOnly(mockClient.__store).documents as never;
    expect(checkDuplicateImport(extraction, 'walmart.jpg', docsOf()).byContent).toHaveLength(1);
    await deleteDocumentCascade('doc-receipt', 'all', memoryKv());
    const again = checkDuplicateImport(extraction, 'walmart.jpg', docsOf());
    expect(again.byContent).toEqual([]);
    expect(again.byFilename).toEqual([]);
  });

  it('the stored file is removed after the commit; a failed removal is queued and retried', async () => {
    mockClient = createFakeSupabase(fullFixture(), {
      authUserId: ME,
      failures: [{ table: 'storage', mode: 'delete', count: 1, error: { message: 'network' } }],
    });
    const kv = memoryKv();
    const result = await deleteDocumentCascade('doc-receipt', 'all', kv);
    expect(result).toMatchObject({ status: 'deleted', storageRemoved: false });
    expect(mockClient.__store.deductions.map((d) => d.id)).not.toContain('d-receipt'); // the records are gone regardless
    expect(JSON.parse(kv.data['pending-storage-removals'])).toEqual([`${ME}/2026-08/Store/walmart.jpg`]);
    expect(await retryPendingStorageRemovals(kv)).toEqual({ removed: 1, remaining: 0 });
    expect(mockClient.__removedStoragePaths).toEqual([`${ME}/2026-08/Store/walmart.jpg`]);
    expect(JSON.parse(kv.data['pending-storage-removals'])).toEqual([]);
  });

  it('before PENDING_SQL §80 runs, the app says so and nothing is deleted', async () => {
    mockClient = createFakeSupabase(fullFixture(), {
      authUserId: ME,
      failures: [{ table: 'rpc:preview_document_delete', error: { code: 'PGRST202', message: 'Could not find the function public.preview_document_delete' } }],
    });
    await expect(previewDocumentDelete('doc-receipt')).rejects.toBeInstanceOf(DocumentDeleteNotInstalledError);
    expect(mockClient.__store).toEqual(fullFixture());
  });
});

describe('orphan detection sees every reference', () => {
  it('a document still attached to a compliance item is not an orphan', async () => {
    const s = baseFixture();
    s.documents.push({ id: 'doc-medical', user_id: ME, storage_path: `${ME}/m.pdf` });
    s.compliance_items.push({ id: 'ci-1', user_id: ME, source_document_id: 'doc-medical' });
    mockClient = createFakeSupabase(s, { authUserId: ME });
    await cleanupOrphanedDocument('doc-medical');
    expect(mockClient.__store.documents.map((d) => d.id)).toContain('doc-medical');
    expect(mockClient.__removedStoragePaths).toEqual([]);
  });

  it('DOCUMENT_REFERENCES covers every table the SQL points at documents from', () => {
    const docs = path.resolve(__dirname, '../../../../docs');
    const sql = ['SCHEMA.sql', 'PENDING_SQL.md'].map((f) => fs.readFileSync(path.join(docs, f), 'utf8')).join('\n');
    const owners = new Set<string>();
    const re = /references documents\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const before = sql.slice(0, m.index);
      const tables = [...before.matchAll(/(?:create|alter) table (?:if not exists )?(\w+)/g)];
      const owner = tables[tables.length - 1]?.[1];
      if (owner) owners.add(owner);
    }
    expect(owners.size).toBeGreaterThan(5);
    const listed = DOCUMENT_REFERENCES.map((r) => r.table);
    for (const owner of owners) expect(listed).toContain(owner);
  });
});
