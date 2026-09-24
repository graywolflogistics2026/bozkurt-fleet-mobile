import * as fs from 'fs';
import * as path from 'path';
import {
  describeDeduction,
  ensureDescription,
  findDeductionsNeedingDescription,
  hasRealText,
  joinReal,
  realText,
  resolveDescription,
} from '@/src/lib/descriptionText';
import { stripNeedsReviewPrefix } from '@/src/import/needsReview';
import { cleanTitle } from '@/src/data/documentTitle';
import { buildDocFileName, buildDocFolderParts } from '@/src/import/storagePath';

// SHARED DESCRIPTION RULE (owner decision 2026-09-24, "systemic broken
// descriptions").
const BROKEN = ['', '   ', '/', '-', ':', ' — ', '()', ' / ', '—', '|', ' - : / '];
const format = { fallbackLabel: 'Expense' };

describe('what counts as real text', () => {
  it.each(BROKEN)('%j is not real text', (value) => {
    expect(hasRealText(value)).toBe(false);
    expect(realText(value)).toBeNull();
  });

  it('real text is trimmed and whitespace-collapsed, and non-Latin scripts count', () => {
    expect(realText('  Oil   change ')).toBe('Oil change');
    expect(realText('Шины')).toBe('Шины');
    expect(realText('टायर')).toBe('टायर');
    expect(realText('7')).toBe('7');
  });

  it('joinReal only puts a separator between two real pieces', () => {
    expect(joinReal(['', '  '])).toBeNull();
    expect(joinReal(['Warranty', '  '])).toBe('Warranty');
    expect(joinReal(['/', 'Oil change'])).toBe('Oil change');
    expect(joinReal(['Walmart', 'Misc', '9/24'])).toBe('Walmart — Misc — 9/24');
  });
});

describe('resolveDescription — saved -> linked -> vendor -> category + date -> label', () => {
  it('keeps a real saved description', () => {
    expect(resolveDescription({ description: 'Steer tire', category: 'Tires', date: '2026-09-24' }, format)).toBe('Steer tire');
  });

  it.each(BROKEN)('a %j description falls back to "<category> — <date>", never blank or a bare separator', (description) => {
    expect(resolveDescription({ description, category: 'Utilities & Subscriptions', date: '2026-09-24' }, format)).toBe(
      'Utilities & Subscriptions — 9/24'
    );
  });

  it('prefers linked/extracted text, then vendor, over the category default', () => {
    expect(resolveDescription({ description: '', linked: 'Fuel Receipt — Pilot, 7/14', category: 'Fuel & DEF', date: '2026-07-14' }, format)).toBe(
      'Fuel Receipt — Pilot, 7/14'
    );
    expect(resolveDescription({ description: '/', vendor: 'Walmart', category: 'Misc', date: '2026-07-14' }, format)).toBe('Walmart — Misc — 7/14');
  });

  it('no category and no date still gives the label, never ""', () => {
    expect(resolveDescription({ description: ' - ' }, format)).toBe('Expense');
    expect(resolveDescription({ description: null, date: '2026-09-24' }, format)).toBe('Expense — 9/24');
  });

  it('uses the screen\'s locale-aware short date when given one', () => {
    expect(resolveDescription({ category: 'Tires', date: '2026-09-24' }, { fallbackLabel: 'Gasto', shortDate: () => '24/9' })).toBe('Tires — 24/9');
  });

  it('ensureDescription (write paths) stores the category default for any broken input', () => {
    for (const value of [...BROKEN, null, undefined]) {
      expect(ensureDescription(value, { category: 'Fuel & DEF', date: '2026-07-14' })).toBe('Fuel & DEF — 7/14');
    }
    expect(ensureDescription('  Howes diesel treat ', { category: 'Fuel Additives', date: null })).toBe('Howes diesel treat');
    expect(ensureDescription('', { category: null, date: null })).toBe('Misc');
  });
});

describe('describeDeduction + the "Needs a description" review', () => {
  const rows = [
    { id: 'ok', description: 'Oil change', category: 'Maintenance & Repairs', ded_date: '2026-09-01', store: null },
    { id: 'blank', description: '', category: 'Utilities & Subscriptions', ded_date: '2026-09-24', store: null },
    { id: 'slash', description: '/', category: 'Tires', ded_date: '2026-08-02', store: null },
    { id: 'null', description: null, category: 'Misc', ded_date: '2026-09-10', store: 'Walmart' },
  ];

  it('the list row text is never blank or a bare separator', () => {
    for (const r of rows) {
      const text = describeDeduction(r, format);
      expect(hasRealText(text)).toBe(true);
    }
    expect(describeDeduction(rows[1], format)).toBe('Utilities & Subscriptions — 9/24');
    expect(describeDeduction(rows[3], format)).toBe('Walmart — Misc — 9/10');
  });

  it('the review lists only rows whose STORED description is broken, newest first', () => {
    expect(findDeductionsNeedingDescription(rows).map((r) => r.id)).toEqual(['blank', 'null', 'slash']);
  });
});

describe('related fixes found by the audit', () => {
  it('"Mark reviewed" never leaves "" or a bare separator behind', () => {
    expect(stripNeedsReviewPrefix('NEEDS REVIEW:   ')).toBeNull();
    expect(stripNeedsReviewPrefix('NEEDS REVIEW: /')).toBeNull();
    expect(stripNeedsReviewPrefix('NEEDS REVIEW: Tire shop invoice')).toBe('Tire shop invoice');
    expect(stripNeedsReviewPrefix('Oil change')).toBe('Oil change');
  });

  it('a document title of "/" or "—" is not a title', () => {
    expect(cleanTitle('/')).toBeNull();
    expect(cleanTitle(' — ')).toBeNull();
    expect(cleanTitle('IRS Form 2290')).toBe('IRS Form 2290');
  });

  it('a spaces-only store vendor no longer creates an empty storage folder', () => {
    expect(buildDocFolderParts('store', '2026-07-14', '   ')).toEqual(['Jul-2026', 'Equipment-Deductions', 'Unknown Store'].map((p, i) => (i === 0 ? expect.any(String) : p)));
  });

  it('a hand-typed date with slashes never reaches a filename', () => {
    const name = buildDocFileName({ docType: 'fuel', date: '07/14/2026', vendor: 'Pilot' }, 'jpg');
    expect(name).not.toContain('/');
    expect(name.startsWith('undated_')).toBe(true);
  });
});

// Every screen that SHOWS a deduction description goes through
// describeDeduction() — no screen renders the raw field with a "—" fallback.
describe('screens use the shared description (source check)', () => {
  const root = path.join(__dirname, '..', '..', '..', 'app', '(tabs)');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('Deductions, Transactions, Settlements and For Prime Inc Drivers call describeDeduction()', () => {
    for (const rel of ['deductions.tsx', 'transactions.tsx', 'more/settlements.tsx', 'more/prime-driver-expenses.tsx']) {
      expect(read(rel)).toMatch(/describeDeduction\(/);
    }
  });

  it('none of them renders a raw description with a "—" or blank fallback anymore', () => {
    expect(read('deductions.tsx')).not.toMatch(/x\.description \?\? '—'|editing\.description \?\? 'Deduction'/);
    expect(read('transactions.tsx')).not.toMatch(/d\.description\?\.trim\(\)/);
    expect(read('more/settlements.tsx')).not.toMatch(/d\.description \?\? d\.category \?\? '—'/);
    expect(read('more/prime-driver-expenses.tsx')).not.toMatch(/d\.description \?\? ''/);
  });

  it('the manual add form saves through ensureDescription() for both the row and its contribution note', () => {
    const screen = read('deductions.tsx');
    expect((screen.match(/description: ensureDescription\(addDescription/g) ?? []).length).toBe(2);
    expect(screen).not.toMatch(/description: addDescription \|\| null/);
  });
});
