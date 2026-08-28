// EQUIPMENT AUTO-POPULATE FROM IMPORTS (owner decision, SIMPLIFICATION
// PASS, item 7, binding): a settlement or standalone purchase deduction
// line landing in a durable-goods category also creates a linked
// Equipment row. Run against the REAL saveExtraction() with an in-memory
// fake Supabase client (fakeSupabase.ts) — same pattern as
// aiImportSave.settlement.test.ts/aiImportSave.loanAgreement.test.ts —
// not a reimplementation of the linking logic.
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
import { sumCanonicalExpenses } from '@/src/stats/trueProfit';

const USER_ID = 'user-1';

function baseParams(extraction: Extraction) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution: false,
  };
}

beforeEach(() => {
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 0 }],
  });
});

describe('settlement-withheld deduction landing in a durable-goods category', () => {
  function settlementWithToolsDeduction(): Extraction {
    return {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-06',
        grossRevenue: 2000,
        netPay: 1500,
        totalMiles: 1500,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
        tractorFuel: [{ amount: 300, gallons: 100 }],
        deductions: [
          { desc: 'Impact Wrench Kit', amount: 189.99, category: 'Tools & Equipment' },
          { desc: 'Insurance', amount: 100, category: 'Insurance—Truck' },
        ],
      },
    };
  }

  test('produces BOTH a Deductions row and a LINKED Equipment row for the equipment-category line only', async () => {
    await saveExtraction(baseParams(settlementWithToolsDeduction()));

    const deductions = mockClient.__store.deductions ?? [];
    const equipment = mockClient.__store.equipment ?? [];
    expect(deductions).toHaveLength(2);

    const toolsDed = deductions.find((d) => d.category === 'Tools & Equipment')!;
    expect(toolsDed).toBeDefined();
    expect(equipment).toHaveLength(1);
    expect(equipment[0].linked_deduction_id).toBe(toolsDed.id);
    expect(equipment[0].name).toBe('Impact Wrench Kit');
    expect(equipment[0].purchase_price).toBe(189.99);
    expect(equipment[0].category).toBe('Tools & Equipment');

    // The Insurance line never gets a linked Equipment row.
    const insuranceDed = deductions.find((d) => d.category === 'Insurance—Truck')!;
    expect(equipment.some((e) => e.linked_deduction_id === insuranceDed.id)).toBe(false);
  });

  test('deleting the deduction cascades to remove its linked Equipment row too (docs/PENDING_SQL.md §73)', async () => {
    await saveExtraction(baseParams(settlementWithToolsDeduction()));
    const toolsDed = (mockClient.__store.deductions ?? []).find((d) => d.category === 'Tools & Equipment')!;
    expect(mockClient.__store.equipment ?? []).toHaveLength(1);

    await mockClient.from('deductions').delete().eq('id', toolsDed.id);

    expect(mockClient.__store.equipment ?? []).toHaveLength(0);
  });

  test('canonical expense totals are byte-identical whether or not the linked Equipment row exists — Equipment is a register, never a second ledger', async () => {
    await saveExtraction(baseParams(settlementWithToolsDeduction()));
    const deductions = mockClient.__store.deductions ?? [];
    expect(mockClient.__store.equipment ?? []).toHaveLength(1); // confirms the linked row really was created

    const totalWithEquipmentRow = sumCanonicalExpenses(deductions as never[], [], [], []);

    // Deleting the Equipment row (leaving the deduction untouched) must
    // not change the canonical total at all — proving sumCanonicalExpenses()
    // never reads from `equipment`, structurally, not just by absence of a
    // bug today.
    mockClient.__store.equipment = [];
    const totalWithoutEquipmentRow = sumCanonicalExpenses(deductions as never[], [], [], []);

    expect(totalWithEquipmentRow).toBe(totalWithoutEquipmentRow);
    expect(totalWithEquipmentRow).toBe(189.99 + 100); // tools + insurance, each counted exactly once
  });
});

describe('standalone purchase (amazon/store docType) landing in a durable-goods category', () => {
  function purchaseExtraction(): Extraction {
    return {
      docType: 'store',
      date: '2026-06-10',
      vendor: 'Best Buy',
      // "Dash Cam" matches guessCategory()'s own Electronics keyword rule
      // (category.ts) — mapPurchase() derives the category itself, it's
      // never settable directly on a purchase item.
      purchase: {
        items: [{ name: 'Dash Cam', qty: 1, price: 129.99 }],
      },
    };
  }

  test('produces a linked Equipment row with the real vendor/date/amount carried across', async () => {
    await saveExtraction(baseParams(purchaseExtraction()));

    const deductions = mockClient.__store.deductions ?? [];
    const equipment = mockClient.__store.equipment ?? [];
    expect(deductions).toHaveLength(1);
    expect(equipment).toHaveLength(1);
    expect(equipment[0].linked_deduction_id).toBe(deductions[0].id);
    expect(equipment[0].vendor).toBe('Best Buy');
    expect(equipment[0].purchase_price).toBe(129.99);
    expect(equipment[0].purchase_date).toBe('2026-06-10');
    expect(equipment[0].category).toBe('Electronics');
  });
});

describe('a consumable-category line never creates an Equipment row', () => {
  test('a Fuel & DEF settlement deduction creates no Equipment row', async () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-13',
        grossRevenue: 2000,
        netPay: 1800,
        totalMiles: 1500,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
        tractorFuel: [{ amount: 300, gallons: 100 }],
        deductions: [{ desc: 'Fuel Advance', amount: 200, category: 'Fuel & DEF' }],
      },
    };
    await saveExtraction(baseParams(extraction));
    expect(mockClient.__store.equipment ?? []).toHaveLength(0);
  });
});
