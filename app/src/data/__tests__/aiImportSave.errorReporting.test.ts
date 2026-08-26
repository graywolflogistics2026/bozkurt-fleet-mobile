// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02, device feedback:
// "settlement imports failing frequently"). Proves two things end to end
// against the real saveExtraction():
//   1. Every write step now throws a step-tagged SaveExtractionError
//      (never a bare/anonymous Error) carrying a snapshot of what was
//      already durably saved before the failing step.
//   2. Four call sites that used to silently swallow a Postgres error
//      (loans upsert, capital_transactions insert, the loan_agreement
//      asset-link update, the maintenance warranty reimbursement insert)
//      now actually throw instead of reporting success.
import type { Extraction } from '@/src/import/types';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;
let failures: import('./fakeSupabase').FakeSupabaseFailure[] = [];

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
import { isSaveExtractionError, buildErrorReport } from '@/src/data/saveExtractionError';

const USER_ID = 'user-1';

function settlementExtraction(): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: '2026-07-05',
      grossRevenue: 2000,
      netPay: 1000,
      totalMiles: 1500,
      loads: [{ order: 'L1', from: 'A', to: 'B', loadedMiles: 500, revenue: 1000 }],
      tractorFuel: [{ amount: 300, gallons: 100 }],
      deductions: [{ code: 'INS', desc: 'Insurance', amount: 150 }],
      loans: [{ name: 'Truck Note', balance: 20000, payment: 500 }],
    },
  };
}

function purchaseExtraction(): Extraction {
  return {
    docType: 'amazon',
    vendor: 'Amazon',
    totalAmount: 100,
    date: '2026-07-05',
    purchase: {
      items: [{ name: 'Drill', qty: 1, price: 100 }],
      total: 100,
      paymentMethod: 'Venmo', // personal payment -> triggers capital_transactions
    },
  };
}

function maintenanceExtraction(): Extraction {
  return {
    docType: 'maintenance',
    date: '2026-07-05',
    vendor: 'Joe\'s Shop',
    totalAmount: 500,
    maintenance: { total: 500, warrantyCredit: 100, description: 'Alternator replacement' },
  };
}

function loanAgreementExtraction(): Extraction {
  return {
    docType: 'loan_agreement',
    vendor: 'Bank',
    totalAmount: 30000,
    loanAgreement: { lender: 'Bank', amount: 30000, assetType: 'truck', assetName: 'Unit 4471' },
  };
}

function baseParams(extraction: Extraction, createContribution = false) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution,
  };
}

beforeEach(() => {
  failures = [];
  mockClient = createFakeSupabase(
    {
      profiles: [{ user_id: USER_ID, business_balance: 0 }],
      trucks: [{ id: 'truck-1', user_id: USER_ID, unit_number: 'Unit 4471', trailer_unit_number: null }],
    },
    { failures }
  );
});

function withFailure(failure: import('./fakeSupabase').FakeSupabaseFailure) {
  failures.push(failure);
  mockClient = createFakeSupabase(
    {
      profiles: [{ user_id: USER_ID, business_balance: 0 }],
      trucks: [{ id: 'truck-1', user_id: USER_ID, unit_number: 'Unit 4471', trailer_unit_number: null }],
    },
    { failures }
  );
}

describe('step-tagged errors', () => {
  test('a documents-insert failure is tagged with that step and carries no partial saves', async () => {
    withFailure({ table: 'documents', mode: 'insert', error: { message: 'RLS denied insert', code: '42501' } });
    await expect(saveExtraction(baseParams(settlementExtraction()))).rejects.toMatchObject({
      step: 'documents-insert',
    });
    try {
      await saveExtraction(baseParams(settlementExtraction()));
    } catch (err) {
      expect(isSaveExtractionError(err)).toBe(true);
      if (isSaveExtractionError(err)) {
        expect(err.code).toBe('42501');
        expect(err.partial.documentId).toBeNull();
        expect(err.partial.settlementSaved).toBe(false);
      }
    }
  });

  // IMPORT SAVE BUG FIX (owner decision 2026-08-05) — superseded: a
  // deductions-insert failure on a BRAND-NEW (non-reimport) settlement no
  // longer aborts the whole save. insertBatchResilient() falls back to
  // per-row inserts, and since this fake failure is table-wide (every
  // insert to 'deductions' fails, batch AND per-row), the one deduction
  // row ends up in the result's skippedRows instead of throwing — see
  // the "IMPORT SAVE BUG FIX (resilient batch insert)" describe block
  // below for the full behavior this replaces the old expectation with.
  test('a deductions-insert failure on a NEW settlement no longer aborts the whole save — it is reported in skippedRows', async () => {
    withFailure({ table: 'deductions', mode: 'insert', error: { message: 'value too long for column "category"', code: '22001' } });
    const result = await saveExtraction(baseParams(settlementExtraction()));
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0]).toMatchObject({ table: 'deductions', reason: 'value too long for column "category"' });
  });

  test('a balance-update (RPC) failure is tagged and shows every child row already saved', async () => {
    // BALANCE LEDGER ATOMICITY FIX (docs/PENDING_SQL.md §60): the
    // settlement save path now calls apply_settlement_business_balance_credit,
    // not the plain apply_business_balance_delta (that RPC is still used
    // elsewhere, e.g. capitalTransactions.ts's own callers pre-§60 — but no
    // longer here).
    withFailure({ table: 'rpc:apply_settlement_business_balance_credit', error: { message: 'No settlement row matched.', code: 'P0002' } });
    try {
      await saveExtraction(baseParams(settlementExtraction()));
      throw new Error('expected saveExtraction to throw');
    } catch (err) {
      expect(isSaveExtractionError(err)).toBe(true);
      if (isSaveExtractionError(err)) {
        expect(err.step).toBe('balance-update');
        expect(err.partial.settlementSaved).toBe(true);
        expect(err.partial.childRowsSaved).toBe(true);
        expect(err.partial.oldRowsCleanedUp).toBe(true);
        expect(err.partial.balanceUpdated).toBe(false);
      }
    }
  });

  test('a duplicate-settlement-race (unique violation) is flagged distinctly', async () => {
    withFailure({
      table: 'settlements',
      mode: 'insert',
      error: { message: 'duplicate key value violates unique constraint "settlements_user_week_notruck_uidx"', code: '23505' },
    });
    try {
      await saveExtraction(baseParams(settlementExtraction()));
      throw new Error('expected saveExtraction to throw');
    } catch (err) {
      expect(isSaveExtractionError(err)).toBe(true);
      if (isSaveExtractionError(err)) {
        expect(err.isDuplicateSettlementRace).toBe(true);
      }
    }
  });

  test('buildErrorReport includes the step, message, code, and what was already saved', async () => {
    // documents-insert (not one of the resilient-batch tables) still
    // throws immediately, same as before — a good, still-fatal step to
    // exercise buildErrorReport()'s own formatting.
    withFailure({ table: 'documents', mode: 'insert', error: { message: 'boom', code: '22001', hint: 'check the value' } });
    try {
      await saveExtraction(baseParams(settlementExtraction()));
      throw new Error('expected saveExtraction to throw');
    } catch (err) {
      expect(isSaveExtractionError(err)).toBe(true);
      if (isSaveExtractionError(err)) {
        const report = buildErrorReport(err, 'v1.0.0 · embedded build');
        expect(report).toContain('documents-insert');
        expect(report).toContain('boom');
        expect(report).toContain('22001');
        expect(report).toContain('check the value');
      }
    }
  });
});

// IMPORT SAVE BUG FIX (owner decision 2026-08-05, device report: "Failed
// while saving loads/fuel/deductions — invalid input syntax for type
// date: \"\""). insertBatchResilient()'s own behavior, proven against the
// real saveExtraction().
describe('IMPORT SAVE BUG FIX (resilient batch insert)', () => {
  test('a transient batch failure recovers via the per-row fallback (count:1 — fails once, succeeds on retry)', async () => {
    withFailure({ table: 'loads', mode: 'insert', error: { message: 'transient', code: '40001' }, count: 1 });
    const result = await saveExtraction(baseParams(settlementExtraction()));
    // The batch insert fails once (consuming the count:1 failure), then
    // the per-row fallback succeeds for the single load — nothing
    // skipped, no throw.
    expect(result.skippedRows).toHaveLength(0);
  });

  test('a persistent per-row failure on a NEW settlement is skipped and reported, never thrown', async () => {
    withFailure({ table: 'fuel_purchases', mode: 'insert', error: { message: 'bad fuel row', code: '22001' } });
    const result = await saveExtraction(baseParams(settlementExtraction()));
    expect(result.skippedRows).toEqual([{ table: 'fuel_purchases', description: expect.any(String), reason: 'bad fuel row' }]);
  });

  test('a persistent per-row failure on a RE-IMPORT still throws — never deletes last week\'s data over an incomplete replacement', async () => {
    mockClient = createFakeSupabase(
      {
        profiles: [{ user_id: USER_ID, business_balance: 0 }],
        trucks: [{ id: 'truck-1', user_id: USER_ID, unit_number: 'Unit 4471', trailer_unit_number: null }],
        settlements: [{ id: 'sett-old', user_id: USER_ID, week_ending: '2026-07-05', truck_id: null, business_balance_credit: 500 }],
      },
      { failures: [{ table: 'deductions', mode: 'insert', error: { message: 'bad deduction row', code: '22001' } }] }
    );
    await expect(saveExtraction(baseParams(settlementExtraction()))).rejects.toMatchObject({ step: 'deductions-insert' });
  });

  test('rows that save successfully alongside a skipped row are still saved (not all-or-nothing within the batch)', async () => {
    withFailure({ table: 'deductions', mode: 'insert', error: { message: 'bad row', code: '22001' } });
    const extraction = settlementExtraction();
    // Two loads, so even though every 'deductions' insert fails, both
    // loads (a different table, unaffected by the deductions failure)
    // must still save normally.
    extraction.settlement!.loads = [
      { order: 'L1', from: 'A', to: 'B', loadedMiles: 500, revenue: 1000 },
      { order: 'L2', from: 'B', to: 'C', loadedMiles: 400, revenue: 800 },
    ];
    const result = await saveExtraction(baseParams(extraction));
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].table).toBe('deductions');
  });
});

describe('previously-silent failures now throw (pre-launch error-visibility fix)', () => {
  test('a loans upsert failure now throws instead of silently succeeding', async () => {
    withFailure({ table: 'loans', mode: 'insert', error: { message: 'loans insert failed', code: '23502' } });
    await expect(saveExtraction(baseParams(settlementExtraction()))).rejects.toMatchObject({ step: 'loans-upsert' });
  });

  test('a capital_transactions insert failure now throws instead of silently succeeding', async () => {
    withFailure({ table: 'capital_transactions', mode: 'insert', error: { message: 'capital insert failed', code: '23502' } });
    await expect(saveExtraction(baseParams(purchaseExtraction(), true))).rejects.toMatchObject({
      step: 'capital-transaction-insert',
    });
  });

  test('a maintenance warranty reimbursement insert failure now throws instead of silently succeeding', async () => {
    withFailure({ table: 'reimbursements', mode: 'insert', error: { message: 'reimbursement insert failed', code: '23502' } });
    await expect(saveExtraction(baseParams(maintenanceExtraction()))).rejects.toMatchObject({
      step: 'maintenance-warranty-reimbursement-insert',
    });
  });

  test('a loan_agreement asset-link update failure now throws instead of silently succeeding', async () => {
    withFailure({ table: 'trucks', mode: 'update', error: { message: 'trucks update failed', code: '23502' } });
    await expect(saveExtraction(baseParams(loanAgreementExtraction()))).rejects.toMatchObject({
      step: 'asset-link-update',
    });
  });
});
