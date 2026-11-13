// 08/28 DEVICE TEST, finding 5 (owner 2026-11-13): "confirm that
// re-importing an already saved week replaces it without duplicating
// owner-money rows". Owner money in = the PR (PERSONAL PYMNT) lines, saved
// as capital_transactions contributions linked to their deduction
// (linked_deduction_id, on delete cascade). A re-import inserts the new
// rows, then deletes the old deductions by id; their contributions go with
// them. Run here through the real saveExtraction(), twice, on the same store.
import type { Extraction } from '@/src/import/types';

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
import { golden0717, USER_ID, TRUCK_ID } from './golden0717Fixture';
import { PRIME_13_WEEKS } from '@/src/settlementReader/__tests__/fixtures/prime13Weeks';
import { LINES_0828, printedFromWeek } from '@/src/settlementReader/__tests__/fixtures/printedReading';
import { readThrough } from '@/src/settlementReader/__tests__/fixtures/runReader';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';

type Row = Record<string, unknown>;
const store = () => mockClient.__store as Record<string, Row[]>;
const count = (table: string) => (store()[table] ?? []).length;
const sum = (table: string, col: string) => Math.round((store()[table] ?? []).reduce((a, r) => a + Number(r[col] ?? 0), 0) * 100) / 100;

async function save(extraction: Extraction, importDate: string) {
  await saveExtraction({
    importDate,
    extraction,
    userId: USER_ID,
    truckId: TRUCK_ID,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'pdf',
    mediaType: 'application/pdf',
    createContribution: false,
  });
}

function snapshot() {
  return {
    settlements: count('settlements'),
    deductions: count('deductions'),
    reimbursements: count('reimbursements'),
    loads: count('loads'),
    fuel: count('fuel_purchases'),
    ownerMoneyRows: count('capital_transactions'),
    ownerMoneyTotal: sum('capital_transactions', 'amount'),
  };
}

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

test('07/17 (PR owner money in): the second import replaces the week, owner money is not doubled', async () => {
  await save(golden0717(), '2026-11-03');
  const first = snapshot();
  expect(first.settlements).toBe(1);
  expect(first.ownerMoneyRows).toBeGreaterThan(0);
  await save(golden0717(), '2026-11-03');
  expect(snapshot()).toEqual(first);
  // Every contribution still points at a deduction that exists.
  const dedIds = new Set(store().deductions.map((d) => d.id));
  expect(store().capital_transactions.every((c) => dedIds.has(c.linked_deduction_id))).toBe(true);
});

test('08/28 read by the new reader: the second import replaces the week, nothing doubles', async () => {
  const w = PRIME_13_WEEKS.find((x) => x.weekEnding === '2026-08-28')!;
  const tr = readThrough(printedFromWeek(w, { lines: LINES_0828 }), { pages: 9, lastContentPage: 6, cashFlowPrinted: true, importDate: '2026-08-29' });
  await save(sanitizeExtraction(tr.extraction!), '2026-08-29');
  const first = snapshot();
  expect(first.settlements).toBe(1);
  await save(sanitizeExtraction(tr.extraction!), '2026-08-29');
  expect(snapshot()).toEqual(first);
  // The re-imported zero-mile week now stores its printed 0 / 0 split (fix 3).
  expect(store().settlements[0]).toMatchObject({ loaded_miles: 0, empty_miles: 0 });
});
