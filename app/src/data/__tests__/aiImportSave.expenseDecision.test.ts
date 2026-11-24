// USER DECIDES DEDUCTIBILITY (owner decision 2026-11-24). Through the REAL
// saveExtraction(): a "No" writes NO deduction row (the document row is
// still saved); a "Yes" writes exactly the same row as today's deductible
// import; the AI's taxDeductible value is ignored.
import type { Extraction } from '@/src/import/types';
import type { ExpenseDecision } from '@/src/import/expenseDecision';

jest.mock('@/src/import/settlementGate', () => require('./gatePassMock').gatePassMock());

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array();
    }
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { saveExtraction } from '@/src/data/aiImportSave';

const USER_ID = 'user-1';

async function importDoc(extraction: Extraction, expenseDecision?: ExpenseDecision | null, createContribution = false) {
  return saveExtraction({
    importDate: '2026-11-24',
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution,
    expenseDecision,
  });
}

function table(name: string): Record<string, unknown>[] {
  return (mockClient.__store[name] ?? []) as Record<string, unknown>[];
}

// Drop generated ids/timestamps so two saves can be compared field by field.
function comparable(rows: Record<string, unknown>[]) {
  return rows.map(({ id: _id, document_id: _doc, created_at: _c, updated_at: _u, ...rest }) => rest);
}

const receipt: Extraction = {
  docType: 'store',
  date: '2026-11-20',
  vendor: 'Home Depot',
  totalAmount: 230,
  purchase: {
    paymentMethod: 'Personal Credit Card',
    items: [
      { name: 'Milwaukee Drill', qty: 1, price: 150 },
      { name: 'Work gloves', qty: 2, price: 40 },
    ],
    total: 230,
  },
};

const otherDoc: Extraction = { docType: 'other', date: '2026-11-20', totalAmount: 60, summary: 'Parking fee', suggestedCategory: 'Parking' };
const insuranceBill: Extraction = { docType: 'insurance', date: '2026-11-01', vendor: 'Progressive', totalAmount: 900, financialDoc: { kind: 'insurance', amount: 900 } };

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

async function rowsFor(extraction: Extraction, decision?: ExpenseDecision | null, contribution = false) {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  const result = await importDoc(extraction, decision, contribution);
  return { result, deductions: table('deductions'), documents: table('documents'), capital: table('capital_transactions'), equipment: table('equipment') };
}

describe.each([
  ['store receipt', receipt],
  ['other document', otherDoc],
  ['insurance bill', insuranceBill],
])('%s', (_label, extraction) => {
  test('No: no deduction (and no contribution/equipment) row, the document row is still saved', async () => {
    const r = await rowsFor(extraction, { all: false }, true);
    expect(r.deductions).toHaveLength(0);
    expect(r.capital).toHaveLength(0);
    expect(r.equipment).toHaveLength(0);
    expect(r.documents).toHaveLength(1);
    expect(r.result.documentId).toBeTruthy();
    expect(r.result.expenseRowsNotRecorded).toBeGreaterThan(0);
  });

  test("Yes: exactly the same rows as today's deductible import (no decision passed)", async () => {
    const today = await rowsFor(extraction, undefined, true);
    const yes = await rowsFor(extraction, { all: true }, true);
    expect(yes.deductions.length).toBeGreaterThan(0);
    expect(comparable(yes.deductions)).toEqual(comparable(today.deductions));
    expect(comparable(yes.capital)).toEqual(comparable(today.capital));
    expect(yes.deductions.every((d) => d.tax_deductible !== false)).toBe(true);
    expect(yes.result.expenseRowsNotRecorded).toBe(0);
  });
});

describe('per-item choice on a multi-item receipt', () => {
  test('only the Yes items are written; a picked category wins', async () => {
    const r = await rowsFor(receipt, { rows: [{ deductible: true, category: 'Tools & Equipment' }, { deductible: false }] });
    expect(r.deductions).toHaveLength(1);
    expect(r.deductions[0].category).toBe('Tools & Equipment');
    expect(String(r.deductions[0].description)).toContain('Milwaukee Drill');
    expect(r.result.expenseRowsNotRecorded).toBe(1);
  });
});

describe('the AI taxDeductible value is ignored', () => {
  test('an AI "false" on a receipt changes nothing: same rows as without it', async () => {
    const without = await rowsFor({ ...receipt, taxDeductible: undefined }, { all: true });
    const aiFalse = await rowsFor({ ...receipt, taxDeductible: false }, { all: true });
    expect(comparable(aiFalse.deductions)).toEqual(comparable(without.deductions));
    expect(aiFalse.deductions.every((d) => d.tax_deductible === true)).toBe(true);
  });
});

describe('out of scope: a decision is ignored, today behaviour kept', () => {
  test('a toll document still writes its row even if a No is passed', async () => {
    const r = await rowsFor({ docType: 'toll', date: '2026-11-20', totalAmount: 42, summary: 'Toll bill' }, { all: false });
    expect(r.deductions).toHaveLength(1);
    expect(r.result.expenseRowsNotRecorded).toBe(0);
  });
  test('a settlement-withheld deduction stays tax_deductible false', async () => {
    const r = await rowsFor(
      {
        docType: 'settlement',
        settlement: {
          carrier: 'ACME CARRIER',
          weekEnding: '2026-07-17',
          settlementDateRaw: '07/17/2026',
          grossRevenue: 1000,
          netPay: 900,
          totalMiles: 445,
          deductions: [{ code: 'ESC', desc: 'Escrow', amount: 100 }],
        },
      },
      { all: true }
    );
    expect(r.deductions.length).toBeGreaterThan(0);
    expect(r.deductions.every((d) => d.tax_deductible === false)).toBe(true);
  });
});

describe('Yes row pinned to the pre-change code output (captured 2026-11-24)', () => {
  test('the drill line is byte-for-byte the row the old import wrote', async () => {
    const r = await rowsFor(receipt, { all: true }, true);
    expect(comparable(r.deductions)[0]).toEqual({
      user_id: 'user-1',
      ded_date: '2026-11-20',
      code: 'EQUIP',
      description: 'Milwaukee Drill — Truck maintenance/repair tool | Home Depot | Personal Credit Card — Owner Contribution',
      amount: 150,
      category: 'Tools & Equipment',
      store: 'Home Depot',
      payment_method: 'Personal Credit Card',
      source: 'import',
      warranty_years: null,
      tax_deductible: true,
      accountant_category: 'Equipment/Operating Supplies',
    });
  });
});
