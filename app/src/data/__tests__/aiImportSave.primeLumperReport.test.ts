// "FOR PRIME INC DRIVERS" — PRIME LUMPER GUARANTEES (owner decision
// 2026-09-23). Every test runs the REAL saveExtraction() into an in-memory
// Supabase, then reads the report the way the screen does: the account's
// FULL deductions + settlements lists (useDeductions()/useSettlements() are
// unfiltered) through eligibleDeductionRowsForReport(), and only then picks
// a month with buildPrimeDriverExpenseMonth().
//   1. ALL MONTHS — each month's Lumpers total = only that month's settlements
//   2. NEW / BACK-DATED IMPORTS — show up in their own month, no extra step
//   3. COUNTED ONCE — re-import, truck/no-truck double import, and a
//      reimbursement + advance on one settlement
import type { Extraction } from '@/src/import/types';
import type { Deduction, Settlement } from '@/src/types/db';

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
import { buildPrimeDriverExpenseMonth, eligibleDeductionRowsForReport, nonPrimeSettlementIds } from '@/src/stats/primeDriverExpenses';

const USER_ID = 'user-1';

type Lumper = { desc?: string; amount: number };

function primeSettlement(weekEnding: string, lumpers: Lumper[], extra: Partial<NonNullable<Extraction['settlement']>> = {}): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      carrier: 'PRIME INC',
      weekEnding,
      grossRevenue: 1000,
      netPay: 500,
      totalMiles: 445,
      loads: [{ order: '4785405', from: 'Springfield MO', to: 'Tyler TX', revenue: 696.96 }],
      deductions: [
        { code: 'MY', desc: 'MAYFAIR PHY DAM', amount: 36.08 },
        ...lumpers.map((l) => ({ code: 'WA', desc: l.desc ?? 'ADV FOR OUTSIDE LUMPER', amount: l.amount })),
      ],
      ...extra,
    },
  };
}

async function importSettlement(extraction: Extraction, truckId: string | null = null) {
  await saveExtraction({
    extraction,
    userId: USER_ID,
    truckId,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'pdf',
    mediaType: 'application/pdf',
    createContribution: false,
  });
}

// Exactly what the screen does on every render — no caching, no month filter
// until buildPrimeDriverExpenseMonth().
function lumpersTotal(year: number, month: number): number {
  const deductions = (mockClient.__store.deductions ?? []) as Deduction[];
  const settlements = (mockClient.__store.settlements ?? []) as Settlement[];
  const rows = eligibleDeductionRowsForReport(
    deductions,
    nonPrimeSettlementIds(settlements),
    new Map(settlements.map((s) => [s.id, s.truck_id ?? null] as const))
  );
  const monthData = buildPrimeDriverExpenseMonth(rows, settlements, year, month);
  const total = monthData.sections.find((s) => s.category === 'Lumpers')!.subtotal;
  return Math.round(total * 100) / 100;
}

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

describe('1. ALL MONTHS — the Lumpers reader is not month-specific', () => {
  test('four months of Prime settlements: each month shows only its own lumpers', async () => {
    await importSettlement(primeSettlement('2026-05-15', [{ amount: 150 }]));
    await importSettlement(primeSettlement('2026-07-17', [{ amount: 217.55 }]));
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 328.54 }, { amount: 216 }]));
    await importSettlement(primeSettlement('2026-08-21', []));
    await importSettlement(primeSettlement('2026-09-04', [{ amount: 99 }]));

    expect(lumpersTotal(2026, 5)).toBe(150);
    expect(lumpersTotal(2026, 6)).toBe(0);
    expect(lumpersTotal(2026, 7)).toBe(762.09);
    expect(lumpersTotal(2026, 8)).toBe(0);
    expect(lumpersTotal(2026, 9)).toBe(99);
    // A different YEAR's same month is never mixed in.
    expect(lumpersTotal(2025, 7)).toBe(0);
  });
});

describe('2. NEW AND BACK-DATED IMPORTS — appear in their own month with no extra step', () => {
  test('importing a settlement from months ago puts its lumpers in that past month immediately', async () => {
    // The account already has this week's settlement.
    await importSettlement(primeSettlement('2026-09-18', [{ amount: 215 }]));
    expect(lumpersTotal(2026, 9)).toBe(215);
    expect(lumpersTotal(2026, 3)).toBe(0);

    // Now an OLD settlement, never imported before. Nothing else is called
    // after the import: no backfill, no banner, no re-sync.
    await importSettlement(primeSettlement('2026-03-06', [{ amount: 327.54 }, { amount: 190 }]));

    expect(lumpersTotal(2026, 3)).toBe(517.54);
    // The newer month is untouched.
    expect(lumpersTotal(2026, 9)).toBe(215);
  });

  test('a lumper line is found by its description even if Prime changes the wording slightly', async () => {
    await importSettlement(primeSettlement('2026-04-10', [{ desc: 'LUMPER ADV', amount: 80 }]));
    expect(lumpersTotal(2026, 4)).toBe(80);
  });
});

describe('3. COUNTED ONCE', () => {
  test('re-importing the SAME settlement twice (same week, same truck) replaces it — the lumper is counted once', async () => {
    await importSettlement(primeSettlement('2026-07-17', [{ amount: 217.55 }]), 't1');
    await importSettlement(primeSettlement('2026-07-17', [{ amount: 217.55 }]), 't1');

    expect((mockClient.__store.settlements ?? []) as Settlement[]).toHaveLength(1);
    expect(lumpersTotal(2026, 7)).toBe(217.55);
  });

  test('re-import with the "not truck-specific" option both times also replaces — counted once', async () => {
    await importSettlement(primeSettlement('2026-07-17', [{ amount: 217.55 }]), null);
    await importSettlement(primeSettlement('2026-07-17', [{ amount: 217.55 }]), null);
    expect(lumpersTotal(2026, 7)).toBe(217.55);
  });

  test('the same settlement imported once WITH a truck and once WITHOUT one (the week+truck check misses this) — counted once', async () => {
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 328.54 }, { amount: 216 }]), 't1');
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 328.54 }, { amount: 216 }]), null);

    // Two settlement rows really exist — this is the gap the report guards.
    expect((mockClient.__store.settlements ?? []) as Settlement[]).toHaveLength(2);
    expect(lumpersTotal(2026, 7)).toBe(544.54);
  });

  test('two DIFFERENT trucks with identical lumper lines the same week are a real fleet — both counted', async () => {
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 215 }]), 't1');
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 215 }]), 't2');
    expect(lumpersTotal(2026, 7)).toBe(430);
  });

  test('a lumper in BOTH the Reimbursement section and a withheld advance on one settlement is counted once', async () => {
    await importSettlement(
      primeSettlement('2026-07-31', [{ amount: 216 }], {
        reimbursementItems: [{ desc: 'OUTSIDE LUMPER', ref: '4857478', amount: 215 }],
      })
    );

    const deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    // Import creates NO out-of-pocket companion row for it...
    expect(deductions.filter((d) => d.source === 'import')).toHaveLength(0);
    // ...so only the withheld advance is on the report.
    expect(lumpersTotal(2026, 7)).toBe(216);
  });

  test('a companion row saved by the Sep 19 build (before import refused them) is still not double-counted', async () => {
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 216 }]));
    const settlementId = ((mockClient.__store.settlements ?? []) as Settlement[])[0].id;
    // Simulate the old build's reimbursement-derived companion row.
    (mockClient.__store.deductions as Deduction[]).push({
      id: 'legacy-companion',
      user_id: USER_ID,
      settlement_id: settlementId,
      ded_date: '2026-07-31',
      description: 'OUTSIDE LUMPER',
      amount: 215,
      category: 'Lumper Fees',
      source: 'import',
      tax_deductible: true,
      accountant_category: 'Lumpers',
    } as unknown as Deduction);

    expect(lumpersTotal(2026, 7)).toBe(216);
  });

  test('a genuine out-of-pocket lumper (manual entry, no settlement) is still counted alongside Prime lumpers', async () => {
    await importSettlement(primeSettlement('2026-07-31', [{ amount: 216 }]));
    (mockClient.__store.deductions as Deduction[]).push({
      id: 'manual-lumper',
      user_id: USER_ID,
      settlement_id: null,
      ded_date: '2026-07-20',
      description: 'Dock lumper, paid cash',
      amount: 60,
      category: 'Lumper Fees',
      source: 'manual',
      tax_deductible: true,
      accountant_category: 'Lumpers',
    } as unknown as Deduction);

    expect(lumpersTotal(2026, 7)).toBe(276);
  });
});
