// CRITICAL: negative settlements + miles traps + escrow (owner decision
// 2026-08-02, verified against a real statement): W/E 2026-07-24, 0
// miles, revenue $5.16, deductions $1,160.51, NET = -$1,155.35 — the
// owner OWES the carrier that week. This end-to-end test exercises the
// REAL saveExtraction() path against the fake Supabase client with the
// exact real-world numbers, proving:
//   1. A negative net pay DECREASES business_balance (never clamped to 0,
//      never gated on netPay > 0).
//   2. Per-diem days default to 0 for a genuine 0-miles/0-loads week.
//   3. Deductions total $1,160.51; of that, $66.95 (meals) + $550.00
//      (advance repayment) + $100.00 (escrow) = $716.95 are excluded from
//      true profit as non-expenses, leaving exactly $443.56 deductible.
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
import { calcTrueProfit, reducesTrueProfit } from '@/src/stats/trueProfit';
import type { Deduction, Settlement } from '@/src/types/db';

const USER_ID = 'user-1';
const WEEK_ENDING = '2026-07-24';

function realStatementExtraction(): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: WEEK_ENDING,
      grossRevenue: 5.16,
      netPay: -1155.35,
      totalMiles: 0,
      loads: [],
      deductions: [
        { code: 'MEAL', desc: 'Pilot Travel Center Restaurant', amount: 66.95 },
        { code: 'ADV', desc: 'Advance Repayment - Extended Warranty', amount: 550.0, chargebackType: 'advance_repayment' },
        // Deliberately no chargebackType set — proves the OCR-damaged-
        // spelling client-side fallback (isEscrowDeposit()) catches it
        // even when the AI missed the "escrow_reserve" classification.
        { code: 'BOND', desc: 'PERFORMNCE BOND', amount: 100.0 },
        { code: 'INS', desc: 'Weekly Insurance', amount: 443.56, chargebackType: 'insurance_bobtail' },
      ],
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
    profiles: [{ user_id: USER_ID, business_balance: 200 }],
  });
});

describe('negative settlement end-to-end (real statement numbers)', () => {
  test('deductions total $1,160.51, categorized correctly (meals/advance/escrow/deductible)', async () => {
    await saveExtraction(baseParams(realStatementExtraction()));

    const deductions = mockClient.__store.deductions as Deduction[];
    expect(deductions).toHaveLength(4);

    const total = deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    expect(total).toBeCloseTo(1160.51, 2);

    const byCategory = Object.fromEntries(deductions.map((d) => [d.category, Number(d.amount)]));
    expect(byCategory['Meals (per diem covered)']).toBe(66.95);
    expect(byCategory['Advance Repayment']).toBe(550.0);
    // The OCR-damaged "PERFORMNCE BOND" line, with no AI-set chargebackType,
    // still lands in Escrow & Deposits via the client-side text fallback.
    expect(byCategory['Escrow & Deposits']).toBe(100.0);
    expect(byCategory['Insurance—Truck']).toBe(443.56);
  });

  test('per-diem days default to 0 for a genuine 0-miles week', async () => {
    await saveExtraction(baseParams(realStatementExtraction()));
    const settlements = mockClient.__store.settlements as Settlement[];
    expect(settlements[0].per_diem_days).toBe(0);
    expect(settlements[0].miles).toBe(0);
  });

  test('settlement net pay is the real, negative, unclamped figure', async () => {
    await saveExtraction(baseParams(realStatementExtraction()));
    const settlements = mockClient.__store.settlements as Settlement[];
    expect(settlements[0].net).toBe(-1155.35);
  });

  // REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — a
  // negative net-pay week (the exact real-statement shape that originally
  // proved the balance math correct) now leaves business_balance
  // completely untouched, same as any other settlement import.
  test('business_balance is never touched, even by a real negative net pay week', async () => {
    const result = await saveExtraction(baseParams(realStatementExtraction()));

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(200); // unchanged from the seeded starting value
    expect(result).not.toHaveProperty('netPayAdded');
  });

  test('a corrected re-import (still negative) still never touches business_balance', async () => {
    await saveExtraction(baseParams(realStatementExtraction()));
    // Re-import with a corrected (less severe) negative net pay.
    const corrected = realStatementExtraction();
    corrected.settlement!.netPay = -900;
    const second = await saveExtraction(baseParams(corrected));

    const profile = mockClient.__store.profiles.find((p) => p.user_id === USER_ID);
    expect(profile?.business_balance).toBe(200); // still unchanged
    expect(second).not.toHaveProperty('netPayAdded');
  });

  test('true profit excludes meals/advance/escrow, counting only the genuinely deductible $443.56', async () => {
    await saveExtraction(baseParams(realStatementExtraction()));

    const settlements = mockClient.__store.settlements as Settlement[];
    const deductions = mockClient.__store.deductions as Deduction[];

    for (const d of deductions) {
      const excluded = d.category === 'Meals (per diem covered)' || d.category === 'Advance Repayment' || d.category === 'Escrow & Deposits';
      expect(reducesTrueProfit(d)).toBe(!excluded);
    }

    // gross 5.16 - deductible 443.56 = -438.4 (true profit is NEVER the
    // same figure as settlement.net here — net includes every withheld
    // row, true profit excludes the three non-expense categories).
    expect(calcTrueProfit(settlements, deductions)).toBeCloseTo(-438.4, 2);
  });
});
