// ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
// DECISION, mega-pass part C): proves the loan_agreement docType creates
// a Loan Center row unconditionally, and links it to the matching
// truck/trailer/equipment when assetName resolves to exactly one — run
// against the real saveExtraction() code path with an in-memory fake
// Supabase client (fakeSupabase.ts), same pattern as
// aiImportSave.settlement.test.ts.
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

function baseParams(extraction: Extraction) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: 'file://loan.pdf',
    fileExt: 'pdf',
    mediaType: 'application/pdf',
    createContribution: false,
  };
}

describe('saveExtraction loan_agreement docType', () => {
  beforeEach(() => {
    mockClient = createFakeSupabase({
      profiles: [{ user_id: USER_ID, business_balance: 0 }],
      trucks: [{ id: 'truck-1', user_id: USER_ID, unit_number: '4471', trailer_unit_number: 'TR-100' }],
      equipment: [{ id: 'equip-1', user_id: USER_ID, name: 'Thermo King Reefer Unit' }],
    });
  });

  it('always creates a loans row, even with no asset match', async () => {
    const extraction: Extraction = {
      docType: 'loan_agreement',
      loanAgreement: { lender: 'Some Bank', amount: 20000, apr: 8, payment: 500, frequency: 'monthly', assetName: 'Unit 9999' },
    };
    await saveExtraction(baseParams(extraction));
    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(1);
    expect(loans[0].lender).toBe('Some Bank');
    expect(loans[0].balance).toBe(20000);

    // No matching asset — nothing gets a loan_id.
    const trucks = mockClient.__store.trucks ?? [];
    expect(trucks[0].loan_id ?? null).toBeNull();
  });

  it('links the loan to the matching truck by unit_number', async () => {
    const extraction: Extraction = {
      docType: 'loan_agreement',
      loanAgreement: { lender: 'Daimler Truck Financial', amount: 85000, assetType: 'truck', assetName: '4471' },
    };
    await saveExtraction(baseParams(extraction));
    const loans = mockClient.__store.loans ?? [];
    expect(loans).toHaveLength(1);
    const truck = (mockClient.__store.trucks ?? []).find((t) => t.id === 'truck-1')!;
    expect(truck.loan_id).toBe(loans[0].id);
    expect(truck.financing).toBe('loan');
  });

  it('links the loan to the matching trailer via trailer_loan_id, not the tractor loan_id', async () => {
    const extraction: Extraction = {
      docType: 'loan_agreement',
      loanAgreement: { lender: 'Trailer Leasing Co', amount: 30000, assetType: 'trailer', assetName: 'TR-100' },
    };
    await saveExtraction(baseParams(extraction));
    const loans = mockClient.__store.loans ?? [];
    const truck = (mockClient.__store.trucks ?? []).find((t) => t.id === 'truck-1')!;
    expect(truck.trailer_loan_id).toBe(loans[0].id);
    expect(truck.trailer_financing).toBe('loan');
    expect(truck.loan_id ?? null).toBeNull();
  });

  it('links the loan to matching equipment by name', async () => {
    const extraction: Extraction = {
      docType: 'loan_agreement',
      loanAgreement: { lender: 'Equipment Finance Co', amount: 12000, assetType: 'equipment', assetName: 'Thermo King Reefer Unit' },
    };
    await saveExtraction(baseParams(extraction));
    const loans = mockClient.__store.loans ?? [];
    const equip = (mockClient.__store.equipment ?? []).find((e) => e.id === 'equip-1')!;
    expect(equip.loan_id).toBe(loans[0].id);
    expect(equip.financing).toBe('loan');
  });

  it('still archives the document regardless of asset match', async () => {
    const extraction: Extraction = {
      docType: 'loan_agreement',
      loanAgreement: { lender: 'Some Bank', amount: 20000 },
    };
    await saveExtraction(baseParams(extraction));
    const docs = mockClient.__store.documents ?? [];
    expect(docs).toHaveLength(1);
    expect(docs[0].doc_type).toBe('loan_agreement');
  });
});
