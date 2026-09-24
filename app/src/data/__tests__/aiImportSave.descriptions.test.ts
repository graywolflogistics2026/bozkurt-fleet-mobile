// SHARED DESCRIPTION RULE (owner decision 2026-09-24, "systemic broken
// descriptions") — every AI-import path the audit found writing "",
// whitespace, a bare separator, or a leading " — ", run end to end through
// the REAL saveExtraction(). No stored deduction description may be blank,
// separator-only, or start with a separator.
import type { Extraction } from '@/src/import/types';
import type { Deduction } from '@/src/types/db';

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
import { hasRealText } from '@/src/lib/descriptionText';

const USER_ID = 'user-1';

async function importDoc(extraction: Extraction) {
  return saveExtraction({
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution: false,
  });
}

function descriptions(): string[] {
  return ((mockClient.__store.deductions ?? []) as Deduction[]).map((d) => d.description as string);
}

function expectAllClean() {
  for (const text of descriptions()) {
    expect(hasRealText(text)).toBe(true);
    expect(text).toBe(text.trim());
    expect(text).not.toMatch(/^[—\-/:|(]/);
  }
}

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

describe('settlement lines (the AI template defaults "desc":"")', () => {
  test('blank, spaces-only and separator-only lines are stored as "<category> — <week ending>"', async () => {
    await importDoc({
      docType: 'settlement',
      settlement: {
        carrier: 'PRIME INC',
        weekEnding: '2026-07-17',
        grossRevenue: 1000,
        netPay: 500,
        totalMiles: 445,
        deductions: [
          { code: 'MY', desc: '', amount: 36.08, category: 'Insurance' },
          { code: 'QR', desc: '   ', amount: 15.72 },
          { code: 'XX', desc: '/', amount: 4 },
          { code: 'AS', desc: 'ACCOUNTING SERV', amount: 8.5 },
        ],
      },
    });
    expectAllClean();
    const texts = descriptions();
    expect(texts).toContain('ACCOUNTING SERV');
    // The three broken ones got a category + date default, not "".
    expect(texts.filter((t) => t.endsWith(' — 7/17'))).toHaveLength(3);
  });
});

describe('financial documents (utility / insurance / lease / factoring)', () => {
  test('spaces-only description, reference and period never produce "( )" or a dangling " — "', async () => {
    await importDoc({
      docType: 'utility_subscription',
      date: '2026-09-24',
      summary: '  ',
      vendor: ' ',
      financialDoc: { kind: 'utility_subscription', amount: 60, description: '   ', reference: ' ', period: ' ' },
    } as Extraction);
    expectAllClean();
    expect(descriptions()).toEqual(['Business expense']);
  });

  test('real pieces are still joined normally', async () => {
    await importDoc({
      docType: 'utility_subscription',
      date: '2026-09-24',
      vendor: 'Starlink',
      financialDoc: { kind: 'utility_subscription', amount: 120, description: 'Starlink Roam', reference: 'INV-9', period: 'Sep 2026' },
    } as Extraction);
    expect(descriptions()).toEqual(['Starlink Roam (INV-9) — Sep 2026']);
  });
});

describe('unrecognized ("other") documents', () => {
  test('a blank summary is never stored as a bare "NEEDS REVIEW:   "', async () => {
    await importDoc({ docType: 'other', date: '2026-09-24', summary: '   ', totalAmount: 25 } as Extraction);
    expectAllClean();
    expect(descriptions()[0]).toBe('NEEDS REVIEW: Document');
  });
});

describe('store / Amazon receipts', () => {
  test('an item with a blank name never starts with " — " (its category stands in)', async () => {
    await importDoc({
      docType: 'store',
      date: '2026-07-14',
      vendor: '  ',
      purchase: { items: [{ name: '', qty: 1, price: 20 }], total: 20 },
    } as Extraction);
    expectAllClean();
  });
});
