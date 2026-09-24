// DOCUMENT TITLES (owner decision 2026-09-23, docs/PENDING_SQL.md §76).
// End to end through the REAL saveExtraction() / setDocumentTitle() against
// the in-memory Supabase, plus the pure title rules the Documents screen uses.
import * as fs from 'fs';
import * as path from 'path';
import type { Extraction } from '@/src/import/types';
import type { DocumentRow } from '@/src/types/db';

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
import { setDocumentTitle } from '@/src/data/documentTitleMutations';
import {
  displayDocumentTitle,
  findDocumentsNeedingTitle,
  linkedTitleInputsFor,
  resolveDocumentTitle,
  type LinkedTitleSources,
  shouldApplyAutoTitle,
  suggestDocumentTitle,
  type TitleContext,
} from '@/src/data/documentTitle';
import { filterDocuments } from '@/src/data/documentsFilter';

const USER_ID = 'user-1';

// The English labels useDocumentTitleContext() resolves from en.json.
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', 'locales', 'en.json'), 'utf8'));
const ctx: TitleContext = {
  kindLabel: (docType) => en.docTypes[docType]?.label ?? en.docTypes.other.label,
  weekEnding: (d) => en.documentTitles.weekEnding.replace('{{date}}', d),
  receiptFor: (c) => en.documentTitles.receiptFor.replace('{{category}}', c),
  shortDate: (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`,
};

async function importDoc(extraction: Extraction, withContext = true) {
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
    titleContext: withContext ? ctx : undefined,
  });
}

function docs(): DocumentRow[] {
  return (mockClient.__store.documents ?? []) as DocumentRow[];
}

function doc(overrides: Partial<DocumentRow>): DocumentRow {
  return {
    id: 'doc',
    user_id: USER_ID,
    filename: null,
    doc_type: 'other',
    doc_date: null,
    amount: null,
    storage_path: null,
    parsed_json: null,
    reviewed_at: null,
    title: null,
    title_source: null,
    imported_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockClient = createFakeSupabase({ profiles: [{ user_id: USER_ID, business_balance: 0 }] });
});

describe('1. a newly imported document gets a specific title, not "Document"', () => {
  test('a fuel receipt with no AI title gets one built from what was extracted', async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'PILOT', totalAmount: 412.5, fuel: { station: 'Pilot #412', gallons: 100, gross: 412.5 } });
    const saved = docs()[0];
    expect(saved.title).toBe('Fuel Receipt — Pilot, 7/14');
    expect(saved.title_source).toBe('ai');
    expect(displayDocumentTitle(saved, en.docTypes.fuel.label)).not.toBe(en.docTypes.other.label);
  });

  test("the AI's own suggested title wins when it returns one", async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'Pilot', title: 'Fuel receipt — Pilot, 7/14', fuel: { gallons: 100, gross: 400 } });
    expect(docs()[0].title).toBe('Fuel receipt — Pilot, 7/14');
  });

  test('a Prime settlement is titled by carrier and week ending', async () => {
    await importDoc({
      docType: 'settlement',
      settlement: { carrier: 'PRIME INC', weekEnding: '2026-07-17', grossRevenue: 1000, netPay: 500, totalMiles: 445 },
    });
    expect(docs()[0].title).toBe('Prime Inc Settlement — W/E 7/17');
  });

  test('a document with nothing specific to say stays untitled (and lands in the review queue)', async () => {
    await importDoc({ docType: 'other' });
    expect(docs()[0].title ?? null).toBeNull();
    expect(findDocumentsNeedingTitle(docs())).toHaveLength(1);
  });

  test('saving the title can never fail an import (e.g. before §76 is applied)', async () => {
    const originalFrom = mockClient.from.bind(mockClient);
    (mockClient as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const builder = originalFrom(table) as unknown as Record<string, unknown>;
      if (table === 'documents') {
        builder.update = () => {
          throw new Error('column "title" of relation "documents" does not exist');
        };
      }
      return builder;
    };
    await expect(importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'Pilot', fuel: { gallons: 100, gross: 400 } })).resolves.toBeTruthy();
    expect(docs()).toHaveLength(1);
  });
});

describe("2. a user's manual rename survives every automatic pass", () => {
  test('an AI or record title never overwrites a user rename', async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'Pilot', fuel: { gallons: 100, gross: 400 } });
    const id = docs()[0].id;

    expect(await setDocumentTitle(id, 'Pilot fill-up before Denver run', 'user')).toBe(true);
    expect(await setDocumentTitle(id, 'Fuel Receipt — Pilot, 7/14', 'ai')).toBe(false);
    expect(await setDocumentTitle(id, 'Fuel receipt — 7/14', 'record')).toBe(false);

    expect(docs()[0].title).toBe('Pilot fill-up before Denver run');
    expect(docs()[0].title_source).toBe('user');
    // The user can still rename again themselves.
    expect(await setDocumentTitle(id, 'Pilot — Denver', 'user')).toBe(true);
    expect(docs()[0].title).toBe('Pilot — Denver');
  });

  test('shouldApplyAutoTitle only blocks user-set titles', () => {
    expect(shouldApplyAutoTitle({ title_source: 'user' })).toBe(false);
    expect(shouldApplyAutoTitle({ title_source: 'ai' })).toBe(true);
    expect(shouldApplyAutoTitle({ title_source: 'record' })).toBe(true);
    expect(shouldApplyAutoTitle({ title_source: null })).toBe(true);
  });

  test('an empty rename is rejected', async () => {
    await importDoc({ docType: 'other' });
    await expect(setDocumentTitle(docs()[0].id, '   ', 'user')).rejects.toThrow();
  });
});

describe('3. the review queue lists only documents with no saved title, newest first', () => {
  test('documents with a saved title are left out; the rest are newest first', () => {
    const list = [
      doc({ id: 'old-generic', doc_date: '2026-05-01' }),
      doc({ id: 'titled', doc_date: '2026-09-01', title: 'IRS Form 2290', title_source: 'ai' }),
      doc({ id: 'vendor', doc_date: '2026-08-01', parsed_json: { vendor: 'Walmart' } }),
      doc({ id: 'new-generic', doc_date: '2026-08-20' }),
      doc({ id: 'undated-generic', doc_date: null, imported_at: '2026-07-01T10:00:00Z' }),
    ];
    expect(findDocumentsNeedingTitle(list).map((d) => d.id)).toEqual(['new-generic', 'vendor', 'undated-generic', 'old-generic']);
  });
});

describe('4. a linked record suggests the title first', () => {
  test('a receipt linked to a Fuel Additives deduction on 7/14 suggests "Fuel Additives receipt — 7/14", even if the extraction has a vendor', () => {
    const d = doc({ id: 'r1', parsed_json: { docType: 'store', vendor: 'Walmart', date: '2026-07-14' } });
    const linked = linkedTitleInputsFor('r1', {
      deductions: [{ document_id: 'r1', category: 'Fuel Additives', description: 'Howes Diesel Treat', ded_date: '2026-07-14' }],
    });
    expect(suggestDocumentTitle(d, linked, ctx)).toEqual({ title: 'Fuel Additives receipt — 7/14', source: 'record' });
  });

  test('a document linked to a settlement suggests its carrier and week ending', () => {
    const linked = linkedTitleInputsFor('s1', { settlements: [{ document_id: 's1', week_ending: '2026-07-31', carrier: 'PRIME INC' }] });
    expect(suggestDocumentTitle(doc({ id: 's1' }), linked, ctx)?.title).toBe('Prime Inc Settlement — W/E 7/31');
  });

  test('a multi-item receipt (several deductions) falls back to the extraction', () => {
    const d = doc({ id: 'm1', parsed_json: { docType: 'store', vendor: 'AutoZone', date: '2026-06-02' } });
    const linked = linkedTitleInputsFor('m1', {
      deductions: [
        { document_id: 'm1', category: 'Truck Parts', description: 'Filter', ded_date: '2026-06-02' },
        { document_id: 'm1', category: 'Tools & Equipment', description: 'Wrench', ded_date: '2026-06-02' },
      ],
    });
    expect(suggestDocumentTitle(d, linked, ctx)).toEqual({ title: 'Store Receipt — AutoZone, 6/2', source: 'ai' });
  });

  test('no linked record and no extraction means no suggestion — the user types one', () => {
    expect(suggestDocumentTitle(doc({ id: 'x' }), linkedTitleInputsFor('x', {}), ctx)).toBeNull();
  });
});

describe('5. accepting a suggestion updates the title everywhere it is displayed', () => {
  test('after accepting, the stored row, the display title, search, and the queue all agree', async () => {
    await importDoc({ docType: 'other' });
    const id = docs()[0].id;
    // The real table defaults imported_at to now(); the in-memory fake doesn't.
    docs()[0].imported_at = '2026-09-23T12:00:00Z';
    expect(displayDocumentTitle(docs()[0], en.docTypes.other.label)).toBe('Document');

    expect(await setDocumentTitle(id, 'Insurance card — Mayfair', 'record')).toBe(true);

    const updated = docs()[0];
    expect(updated.title).toBe('Insurance card — Mayfair');
    expect(displayDocumentTitle(updated, en.docTypes.other.label)).toBe('Insurance card — Mayfair');
    expect(filterDocuments(docs(), { search: 'mayfair' }).map((d) => d.id)).toEqual([id]);
    expect(findDocumentsNeedingTitle(docs())).toEqual([]);
  });

  test('the Documents screen computes titles ONCE with resolveDocumentTitle() and shows that same value on the list row and in the detail view', () => {
    const screen = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', '(tabs)', 'more', 'documents.tsx'), 'utf8');
    expect(screen).not.toMatch(/deriveDocumentTitle\(|displayDocumentTitle\(/);
    expect((screen.match(/resolveDocumentTitle\(/g) ?? []).length).toBe(1);
    expect(screen).toMatch(/const title = titles\.get\(doc\.id\)/); // list row
    expect(screen).toMatch(/const selectedTitle = titles\.get\(selected\.id\)/); // detail view
    // The detail title is itself a text field (no separate rename menu).
    expect(screen).toMatch(/<TextInput\s+value=\{titleDraft\}/);
    expect(screen).not.toMatch(/renaming|handleSaveRename/);
  });
});

// THE LIST VIEW (owner decision 2026-09-23, "the list itself must show the
// meaningful title immediately"). listTitle() is exactly what each list row
// renders: the screen's titles map = resolveDocumentTitle(doc,
// linkedTitleInputsFor(doc.id, sources), ctx, docType label).
describe('6. the list row shows a meaningful title immediately', () => {
  function listTitle(d: DocumentRow, sources: LinkedTitleSources = {}): string {
    const label = en.docTypes[d.doc_type ?? 'other']?.label ?? en.docTypes.other.label;
    return resolveDocumentTitle(d, linkedTitleInputsFor(d.id, sources), ctx, label);
  }

  test('NEW document: a fuel receipt imported now shows its title on the list row right away', async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'PILOT', fuel: { station: 'Pilot #412', gallons: 100, gross: 412.5 } });
    expect(listTitle(docs()[0])).toBe('Fuel Receipt — Pilot, 7/14');
  });

  test('EXISTING document imported before §76 (no saved title) shows a title built from its stored extraction — no review needed first', async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'PILOT', fuel: { gallons: 100, gross: 412.5 } });
    const old = { ...docs()[0], title: null, title_source: null }; // what a pre-§76 row looks like
    expect(listTitle(old)).toBe('Fuel Receipt — Pilot, 7/14');
    // Still offered in the review so the title can be saved or changed.
    expect(findDocumentsNeedingTitle([old])).toHaveLength(1);
  });

  test('EXISTING receipt attached from Deductions (no extraction, stored as "other") shows its linked deduction on the list row', () => {
    const receipt = doc({ id: 'att1', doc_type: 'other', doc_date: '2026-07-14' });
    const sources: LinkedTitleSources = {
      deductions: [{ document_id: 'att1', category: 'Fuel Additives', description: 'Howes', ded_date: '2026-07-14' }],
    };
    expect(listTitle(receipt)).toBe('Document'); // the old behavior, without the link
    expect(listTitle(receipt, sources)).toBe('Fuel Additives receipt — 7/14');
  });

  test('EXISTING receipt attached on For Prime Inc Drivers shows its expense category and date', () => {
    const receipt = doc({ id: 'att2', doc_type: 'other' });
    expect(listTitle(receipt, { primeDriverExpenses: [{ document_id: 'att2', category: 'Lumpers', exp_date: '2026-07-20' }] })).toBe(
      'Lumpers receipt — 7/20'
    );
  });

  test('EXISTING settlement document with no saved title shows carrier + week ending from its settlement', () => {
    const d = doc({ id: 'set1', doc_type: 'settlement' });
    expect(listTitle(d, { settlements: [{ document_id: 'set1', week_ending: '2026-07-17', carrier: 'PRIME INC' }] })).toBe(
      'Prime Inc Settlement — W/E 7/17'
    );
  });

  test('a document with nothing to go on still shows the type label, and is in the review with no suggestion', () => {
    const d = doc({ id: 'blank' });
    expect(listTitle(d)).toBe('Document');
    expect(suggestDocumentTitle(d, linkedTitleInputsFor('blank', {}), ctx)).toBeNull();
  });

  test("the user's own title wins on the list row over everything else, and survives an automatic pass", async () => {
    await importDoc({ docType: 'fuel', date: '2026-07-14', vendor: 'Pilot', fuel: { gallons: 100, gross: 400 } });
    const id = docs()[0].id;
    await setDocumentTitle(id, 'Denver fill-up', 'user');
    await setDocumentTitle(id, 'Fuel Receipt — Pilot, 7/14', 'ai');
    const sources: LinkedTitleSources = { deductions: [{ document_id: id, category: 'Fuel & DEF', description: 'Diesel', ded_date: '2026-07-14' }] };
    expect(listTitle(docs()[0], sources)).toBe('Denver fill-up');
  });
});
