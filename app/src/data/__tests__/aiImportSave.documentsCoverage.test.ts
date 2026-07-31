// DOCUMENTS-NOT-LISTING AUDIT (owner directive, mega-pass part E,
// 2026-07-30): proves saveExtraction() inserts a `documents` row for
// EVERY docType, not just some — the exact claim the Documents Archive
// screen depends on. Run against the real saveExtraction() code path with
// an in-memory fake Supabase client (fakeSupabase.ts), same pattern as
// aiImportSave.settlement.test.ts.
import type { DocType, Extraction } from '@/src/import/types';

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
const DRIVER_ID = 'driver-1';

function baseParams(extraction: Extraction) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: DRIVER_ID,
    driverShareAmount: null,
    fileUri: 'file://doc.jpg',
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution: false,
  };
}

// One minimal, VALID extraction per docType — enough for the per-docType
// mapper not to throw, nothing more.
const EXTRACTIONS: Record<DocType, Extraction> = {
  settlement: { docType: 'settlement', settlement: { weekEnding: '2026-07-05', netPay: 1000, totalMiles: 500 } },
  fuel: { docType: 'fuel', date: '2026-07-01', fuel: { gallons: 100, gross: 400 } },
  maintenance: { docType: 'maintenance', date: '2026-07-01', maintenance: { total: 200 } },
  amazon: { docType: 'amazon', date: '2026-07-01', vendor: 'Amazon', purchase: { items: [{ name: 'Drill', price: 100, qty: 1 }], total: 100 } },
  store: { docType: 'store', date: '2026-07-01', vendor: 'AutoZone', purchase: { items: [{ name: 'Filter', price: 20, qty: 1 }], total: 20 } },
  toll: { docType: 'toll', date: '2026-07-01', totalAmount: 15 },
  loan: { docType: 'loan', date: '2026-07-01', totalAmount: 500 },
  w2: { docType: 'w2', date: '2026-12-31', w2: { employer: 'Acme', box1Wages: 40000 } },
  driver_payment: { docType: 'driver_payment', date: '2026-07-01', driverPayment: { driverName: 'Alice', amount: 800 } },
  insurance: { docType: 'insurance', date: '2026-07-01', financialDoc: { kind: 'insurance', amount: 300 } },
  lease_rent: { docType: 'lease_rent', date: '2026-07-01', financialDoc: { kind: 'lease_rent', amount: 900 } },
  factoring_statement: { docType: 'factoring_statement', date: '2026-07-01', financialDoc: { kind: 'factoring_statement', amount: 50 } },
  government_or_misc_income: { docType: 'government_or_misc_income', date: '2026-07-01', totalAmount: 300, taxDeductible: false },
  utility_subscription: { docType: 'utility_subscription', date: '2026-07-01', financialDoc: { kind: 'utility_subscription', amount: 60 } },
  medical_card: { docType: 'medical_card', date: '2026-07-01', compliance: { type: 'medical_card', dueDate: '2027-07-01' } },
  inspection_report: { docType: 'inspection_report', date: '2026-07-01', compliance: { type: 'inspection_report', dueDate: '2027-07-01' } },
  registration_cab_card: { docType: 'registration_cab_card', date: '2026-07-01', compliance: { type: 'registration_cab_card', dueDate: '2027-07-01' } },
  irs_2290_schedule1: { docType: 'irs_2290_schedule1', date: '2026-07-01', compliance: { type: 'irs_2290_schedule1', dueDate: '2027-08-31' } },
  insurance_policy: { docType: 'insurance_policy', date: '2026-07-01', compliance: { type: 'insurance_policy', dueDate: '2027-07-01' } },
  loan_agreement: {
    docType: 'loan_agreement',
    date: '2026-07-01',
    loanAgreement: { lender: 'Test Bank', amount: 10000, assetType: 'other', assetName: '' },
  },
  other: { docType: 'other', date: '2026-07-01', totalAmount: 42, suggestedCategory: 'Parking' },
};

describe('saveExtraction inserts a documents row for EVERY docType', () => {
  beforeEach(() => {
    mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
  });

  for (const [docType, extraction] of Object.entries(EXTRACTIONS) as Array<[DocType, Extraction]>) {
    it(`docType "${docType}" creates a visible documents row`, async () => {
      await saveExtraction(baseParams(extraction));
      const docs = mockClient.__store.documents ?? [];
      expect(docs).toHaveLength(1);
      expect(docs[0].doc_type).toBe(docType);
      expect(docs[0].user_id).toBe(USER_ID);
    });
  }

  it('creates one documents row per import call, even across every docType in sequence', async () => {
    const docTypes = Object.values(EXTRACTIONS);
    for (const extraction of docTypes) {
      await saveExtraction(baseParams(extraction));
    }
    const docs = mockClient.__store.documents ?? [];
    expect(docs).toHaveLength(docTypes.length);
  });
});
