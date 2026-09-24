// LUMPER PAYMENTS MISSING FROM THE "FOR PRIME INC DRIVERS" REPORT (owner
// decision 2026-09-19, bug investigation + fix).
//
// DIAGNOSIS (confirmed by tracing the real extraction pipeline, not
// guessed): the category mapping (Lumper Fees -> Lumpers), the origin
// rule, and the historical backfill were ALL already correct for a
// genuine out-of-pocket `deductions` row. The confirmed root cause: a
// lumper fee the driver pays personally at the dock, then gets
// reimbursed for through a settlement's own `reimbursementItems` section,
// NEVER created a matching `deductions` row anywhere in this app —
// `reimbursements` has no category column at all, so the expense side of
// that transaction was completely invisible to the "For Prime Inc
// Drivers" report (and to true profit/tax, a materially bigger gap this
// same fix closes: the settlement's own net-pay figure already includes
// the reimbursement credit, so without a matching expense the driver's
// real cash outlay was never recognized anywhere).
//
// This test exercises the REAL saveExtraction()/mapSettlement() against
// an in-memory fake Supabase client, then feeds the actual saved rows
// through the REAL eligibleDeductionRowsForReport() (the exact function
// the report screen itself calls) — proving end to end, not just at one
// function's own boundary, that ONLY the genuinely out-of-pocket lumper
// expense surfaces on the report.
import type { Extraction } from '@/src/import/types';
import type { Deduction, Reimbursement } from '@/src/types/db';

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
import { eligibleDeductionRowsForReport } from '@/src/stats/primeDriverExpenses';

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

describe('lumper reimbursement companion expense (owner decision 2026-09-19)', () => {
  // A carrier-ADVANCED lumper ("ADV FOR OUTSIDE LUMPER") stays settlement-
  // withheld and non-deductible, so no out-of-pocket companion expense is
  // created from a reimbursement on the same settlement. The "For Prime
  // Inc Drivers" report still shows each withheld lumper line under
  // Lumpers via its Prime-only exception (owner decision 2026-09-23) —
  // exactly once, never also as a reimbursement-derived companion.
  test('a settlement with withheld lumper lines: no companion expense, and the report shows each withheld lumper exactly once', async () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-06',
        grossRevenue: 3000,
        netPay: 2200,
        totalMiles: 2000,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1500 }],
        deductions: [
          { code: 'LM', desc: 'LM LUMPER UNLOAD', amount: 50 },
          { code: 'WA', desc: 'ADV FOR OUTSIDE LUMPER', amount: 217.55 },
        ],
        reimbursementItems: [{ desc: 'Reimbursement for outside lumper fee', ref: 'RB-1', amount: 215 }],
      },
    };

    await saveExtraction(baseParams(extraction));

    const deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    const lumperDeductions = deductions.filter((d) => d.category === 'Lumper Fees');
    // Only the two withheld rows — no out-of-pocket companion.
    expect(lumperDeductions).toHaveLength(2);
    expect(lumperDeductions.every((d) => d.source === 'settlement')).toBe(true);
    for (const w of lumperDeductions) expect(w.accountant_category ?? null).toBeNull();

    // The reimbursement itself is still saved, unchanged.
    expect((mockClient.__store.reimbursements ?? []) as Reimbursement[]).toHaveLength(1);

    const reportRows = eligibleDeductionRowsForReport(
      deductions.map((d) => ({
        id: d.id,
        ded_date: d.ded_date,
        amount: d.amount,
        accountant_category: d.accountant_category,
        source: d.source,
        description: d.description,
        category: d.category,
        settlement_id: d.settlement_id,
      }))
    );
    const lumperReportRows = reportRows.filter((r) => r.category === 'Lumpers');
    expect(lumperReportRows.map((r) => r.amount).sort()).toEqual([217.55, 50]);
    expect(lumperReportRows.every((r) => r.origin === 'prime_settlement')).toBe(true);
  });

  test('a lumper reimbursement with NO carrier advance (driver paid cash) creates one out-of-pocket expense on the report', async () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-06',
        grossRevenue: 3000,
        netPay: 2200,
        totalMiles: 2000,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1500 }],
        deductions: [{ code: 'MY', desc: 'MAYFAIR PHY DAM', amount: 36.08 }],
        reimbursementItems: [{ desc: 'Reimbursement for outside lumper fee', ref: 'RB-1', amount: 65 }],
      },
    };

    await saveExtraction(baseParams(extraction));

    const deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    const companion = deductions.find((d) => d.category === 'Lumper Fees' && d.source === 'import');
    expect(companion?.amount).toBe(65);
    expect(companion?.accountant_category).toBe('Lumpers');
    expect(companion?.payment_method).toBeNull();

    const reportRows = eligibleDeductionRowsForReport(
      deductions.map((d) => ({
        id: d.id,
        ded_date: d.ded_date,
        amount: d.amount,
        accountant_category: d.accountant_category,
        source: d.source,
        description: d.description,
      }))
    );
    const lumperReportRows = reportRows.filter((r) => r.category === 'Lumpers');
    expect(lumperReportRows).toHaveLength(1);
    expect(lumperReportRows[0].amount).toBe(65);
  });

  test('a reimbursement that does not name a lumper never creates a companion deduction', async () => {
    const extraction: Extraction = {
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-06',
        grossRevenue: 3000,
        netPay: 2500,
        totalMiles: 2000,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1500 }],
        reimbursementItems: [{ desc: 'Reimbursement for tolls already paid', ref: 'RB-2', amount: 20 }],
      },
    };
    await saveExtraction(baseParams(extraction));
    const deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    expect(deductions.filter((d) => d.category === 'Lumper Fees')).toHaveLength(0);
    const reimbursements = (mockClient.__store.reimbursements ?? []) as Reimbursement[];
    expect(reimbursements).toHaveLength(1);
  });

  test('RE-IMPORT: re-importing the same settlement replaces the companion deduction instead of duplicating it', async () => {
    const extraction = (amount: number): Extraction => ({
      docType: 'settlement',
      settlement: {
        weekEnding: '2026-06-06',
        grossRevenue: 3000,
        netPay: 2500,
        totalMiles: 2000,
        loads: [{ order: 'L1', from: 'A', to: 'B', revenue: 1500 }],
        reimbursementItems: [{ desc: 'Reimbursement for outside lumper fee', ref: 'RB-1', amount }],
      },
    });

    await saveExtraction(baseParams(extraction(65)));
    let deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    expect(deductions.filter((d) => d.category === 'Lumper Fees' && d.source === 'import')).toHaveLength(1);

    // Re-import the SAME week with a corrected amount — the old companion
    // row must be replaced, never duplicated (the exact bug this pass's
    // own widened re-import old-id capture fixes: without dropping the
    // `.eq('source','settlement')` filter, this companion row — the
    // first-ever deduction with settlement_id set and source!=='settlement'
    // — would never have been captured as "old" and would have
    // accumulated one new duplicate on every re-import).
    await saveExtraction(baseParams(extraction(70)));
    deductions = (mockClient.__store.deductions ?? []) as Deduction[];
    const lumperOutOfPocket = deductions.filter((d) => d.category === 'Lumper Fees' && d.source === 'import');
    expect(lumperOutOfPocket).toHaveLength(1);
    expect(lumperOutOfPocket[0].amount).toBe(70);
  });
});
