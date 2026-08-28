// LOAN DEDUPE FIX (owner decision, device report: "the extended warranty
// loan is re-created on every settlement import"). Root cause was the
// loan-upsert loop's match key — exact string equality on `loans.name`
// — which silently missed the existing row whenever the AI's own
// extracted wording for the recurring recap line varied week to week.
// These tests exercise the REAL saveExtraction() against an in-memory
// fake Supabase client, proving two settlements whose loans[] line
// carries slightly different wording (a trailing reference suffix,
// punctuation, case) resolve to ONE loan row with an updated balance,
// never two.
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

const USER_ID = 'user-1';

function settlementWithLoan(weekEnding: string, loanName: string, balance: number): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding,
      grossRevenue: 2000,
      netPay: 1500,
      totalMiles: 1500,
      loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
      deductions: [{ code: 'ADV', desc: 'ADVANCE — EXT WARRANTY', amount: 500 }],
      loans: [{ name: loanName, balance, payment: 500, frequency: 'weekly' }],
    },
  };
}

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

describe('loan upsert dedupe (owner decision, device report)', () => {
  test('slightly-different wording across settlements resolves to ONE loan row with an updated balance', async () => {
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 6500)));
    await saveExtraction(baseParams(settlementWithLoan('2026-07-12', 'EXTENDED WARRANTY - REF#4471', 6000)));
    await saveExtraction(baseParams(settlementWithLoan('2026-07-19', 'extended warranty', 5500)));

    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(1);
    expect(loans[0].balance).toBe(5500);
    // The most recent settlement's id is the one this loan is linked to.
    const settlements = mockClient.__store.settlements ?? [];
    const latest = settlements.find((s) => s.week_ending === '2026-07-19');
    expect(loans[0].settlement_id).toBe(latest?.id);
  });

  test('a genuinely different loan with a similar name but a wildly different balance is NOT merged', async () => {
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 500)));
    // A truck loan that happens to share the word "warranty" in some
    // stray wording — balance is 20x higher, well past MAX_BALANCE_RATIO.
    await saveExtraction(
      baseParams({
        docType: 'settlement',
        settlement: {
          weekEnding: '2026-07-12',
          grossRevenue: 2000,
          netPay: 1500,
          totalMiles: 1500,
          loads: [{ order: 'L2', from: 'A', to: 'B', revenue: 1000 }],
          loans: [{ name: 'Extended Warranty Truck Note', balance: 58000, payment: 1200, frequency: 'monthly' }],
        },
      })
    );

    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(2);
  });

  test('two loan lines in the SAME settlement that both normalize to the same key merge into one row', async () => {
    await saveExtraction(
      baseParams({
        docType: 'settlement',
        settlement: {
          weekEnding: '2026-07-05',
          grossRevenue: 2000,
          netPay: 1500,
          totalMiles: 1500,
          loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1000 }],
          loans: [
            { name: 'Extended Warranty', balance: 6500 },
            { name: 'EXTENDED WARRANTY', balance: 6500 },
          ],
        },
      })
    );

    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(1);
  });

  test('re-importing the same week updates the same loan row, never duplicates it', async () => {
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 6500)));
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 6000)));

    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(1);
    expect(loans[0].balance).toBe(6000);
  });
});

describe('warranty advance repayment is never double-counted (owner decision, device report item 2)', () => {
  test('the withheld deduction resolves to non-deductible Advance Repayment, never Warranty & Service Contracts', async () => {
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 6500)));

    const deductions = mockClient.__store.deductions ?? [];
    expect(deductions).toHaveLength(1);
    expect(deductions[0].category).toBe('Advance Repayment');
    expect(deductions[0].tax_deductible).toBe(false);
  });

  test('true profit excludes the advance repayment amount and is unaffected by the loan balance', async () => {
    const { reducesTrueProfit } = await import('@/src/stats/trueProfit');
    await saveExtraction(baseParams(settlementWithLoan('2026-07-05', 'Extended Warranty', 6500)));

    const deductions = mockClient.__store.deductions ?? [];
    expect(deductions.every((d) => !reducesTrueProfit(d as never))).toBe(true);

    // The loan's own balance/payment fields are never read by any
    // true-profit/CPM expense calculation — the only channel is the
    // deduction row above, already proven excluded.
    const loans = mockClient.__store.loans ?? [];
    expect(loans[0].balance).toBe(6500);
  });
});
