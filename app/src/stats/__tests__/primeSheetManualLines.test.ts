// MANUAL LINE CHOICE for the For Prime Inc Drivers sheet (owner decision
// 2026-11-24, option (a), docs/decisions/prime-sheet-manual-lines-proposal.md).
// Old rows keep their stored line (numbers byte-identical); a NEW Misc/Other
// row has no line, is outside every subtotal and the grand total, and is
// counted in the line the user picks.
import { suggestAccountantCategory, findRowsNeedingAccountantCategory } from '@/src/primeDriverExpenses/categoryMapping';
import { buildPrimeDriverExpenseMonth, eligibleDeductionRowsForReport, mergePrimeDriverExpenseRows, type EligibleDeductionSource, type PrimeDriverExpenseRow } from '@/src/stats/primeDriverExpenses';

type Row = EligibleDeductionSource & { category: string | null };
const ded = (id: string, category: string, amount: number, accountant_category: string | null, extra: Partial<EligibleDeductionSource> = {}): Row => ({
  id,
  ded_date: '2026-10-14',
  amount,
  category,
  accountant_category,
  source: 'import',
  description: `${id} purchase`,
  ...extra,
});

// The owner's live data shape (checked 2026-11-24): one old row on the Misc
// line ($1,750), no old Misc/Other row without a line.
const OLD_ROWS: Row[] = [
  ded('old-misc', 'Misc', 1750, 'Misc'),
  ded('repair', 'Maintenance & Repairs', 420.5, 'Repairs'),
  ded('wash', 'Truck Wash & Detailing', 45, 'Truck & Trailer Wash'),
  ded('tools', 'Tools & Equipment', 129.99, 'Equipment/Operating Supplies'),
  ded('fuel-cash', 'Fuel & DEF', 300, 'Cash Fuel'),
  ded('withheld', 'Misc', 999, null, { source: 'settlement', settlement_id: 's1' }),
];
const DIRECT: PrimeDriverExpenseRow[] = [{ id: 'direct', exp_date: '2026-10-02', amount: 12, category: 'Laundry/Showers', note: 'Showers', origin: 'direct' }];

function month(deductions: EligibleDeductionSource[]) {
  const rows = mergePrimeDriverExpenseRows(DIRECT, eligibleDeductionRowsForReport(deductions));
  return buildPrimeDriverExpenseMonth(rows, [], 2026, 10);
}
const subtotals = (m: ReturnType<typeof month>) => Object.fromEntries(m.sections.map((s) => [s.category, s.subtotal]));

describe('golden month: old rows keep their line, numbers identical', () => {
  test('every subtotal and the grand total (pinned literals)', () => {
    const m = month(OLD_ROWS);
    expect(subtotals(m)).toEqual({
      Lumpers: 0,
      'Cash Tolls/Parking Fees': 0,
      Scales: 0,
      'Equipment/Operating Supplies': 129.99,
      'Safety/Weather Gear': 0,
      'Cash Fuel': 300,
      'Oil & Additives': 0,
      'Truck & Trailer Wash': 45,
      Repairs: 420.5,
      Communication: 0,
      Advertising: 0,
      'Office Supplies': 0,
      Lodging: 0,
      'Laundry/Showers': 12,
      'Bank/ATM Fees': 0,
      Misc: 1750,
    });
    expect(m.grandTotal).toBeCloseTo(2657.49, 2);
  });
  test('day one: the needs list is empty and the $1,750 row stays in Misc', () => {
    expect(findRowsNeedingAccountantCategory(OLD_ROWS)).toEqual([]);
    expect(month(OLD_ROWS).sections.find((s) => s.category === 'Misc')!.rows.map((r) => r.id)).toEqual(['old-misc']);
  });
});

describe('a NEW Misc/Other row', () => {
  const newMisc = ded('new-misc', 'Misc', 88.4, suggestAccountantCategory('Misc', 'import'));
  const newOther = ded('new-other', 'Other', 61.6, suggestAccountantCategory('Other', 'manual'));

  test('gets no line and is outside every subtotal and the grand total', () => {
    expect(newMisc.accountant_category).toBeNull();
    expect(newOther.accountant_category).toBeNull();
    const before = month(OLD_ROWS);
    const after = month([...OLD_ROWS, newMisc, newOther]);
    expect(subtotals(after)).toEqual(subtotals(before));
    expect(after.grandTotal).toBe(before.grandTotal);
    expect(findRowsNeedingAccountantCategory([newMisc, newOther]).map((r) => r.id).sort()).toEqual(['new-misc', 'new-other']);
  });

  test('a picked row is counted in the picked line', () => {
    const picked = { ...newMisc, accountant_category: 'Office Supplies' };
    const m = month([...OLD_ROWS, picked]);
    expect(subtotals(m)['Office Supplies']).toBeCloseTo(88.4, 2);
    expect(subtotals(m).Misc).toBe(1750);
    expect(m.grandTotal).toBeCloseTo(2657.49 + 88.4, 2);
    expect(findRowsNeedingAccountantCategory([picked])).toEqual([]);
  });

  test('a vehicle registration row filed under Misc stays excluded everywhere', () => {
    const reg = ded('reg', 'Misc', 300, null, { description: 'Truck registration and license plate renewal' });
    expect(findRowsNeedingAccountantCategory([reg])).toEqual([]);
    expect(eligibleDeductionRowsForReport([reg])).toEqual([]);
  });
});

// STAGE 2: totals + export (the Unassigned block is never optional).
import { unassignedDeductionRowsForReport } from '@/src/stats/primeDriverExpenses';
import { buildPrimeDriverExpenseReportHtml } from '@/src/stats/primeDriverExpenseReport';
import { localeNotice } from '@/src/legal/__tests__/localeNotice';

function fullMonth(deductions: Row[], docIds: ReadonlySet<string> = new Set()) {
  const rows = mergePrimeDriverExpenseRows(DIRECT, eligibleDeductionRowsForReport(deductions, docIds));
  return buildPrimeDriverExpenseMonth(rows, [], 2026, 10, null, unassignedDeductionRowsForReport(deductions, docIds));
}
const STRINGS = {
  categoryTableTitle: 'Categories',
  daysAwayFromHomeLabel: 'Days',
  grandTotalLabel: 'Grand Total',
  noEntriesLabel: 'No entries',
  disclaimer: 'Disclaimer',
  unassignedTitle: 'Unassigned — needs your choice',
  unassignedNote: 'Not in the grand total',
  estimateNotice: localeNotice(undefined, 'note'),
};
const FMT = { money: (n: number) => `$${n.toFixed(2)}`, date: (iso: string) => iso };

describe('stage 2: unassigned rows on the sheet and in the export', () => {
  const newMisc = ded('new-misc', 'Misc', 88.4, null);
  const newOtherNov = ded('new-other-nov', 'Other', 10, null, { ded_date: '2026-11-03' });

  test('day one (old rows only): no unassigned rows, numbers identical, no Unassigned block', () => {
    const m = fullMonth(OLD_ROWS);
    expect(m.unassigned).toEqual({ rows: [], total: 0 });
    expect(m.grandTotal).toBe(month(OLD_ROWS).grandTotal);
    expect(subtotals(m)).toEqual(subtotals(month(OLD_ROWS)));
    expect(buildPrimeDriverExpenseReportHtml('H', m, STRINGS, FMT)).not.toContain(STRINGS.unassignedTitle);
  });

  test('a waiting row of this month is listed as unassigned, outside the grand total; other months stay out', () => {
    const m = fullMonth([...OLD_ROWS, newMisc, newOtherNov]);
    expect(m.unassigned.rows.map((r) => r.id)).toEqual(['new-misc']);
    expect(m.unassigned.total).toBeCloseTo(88.4, 2);
    expect(m.grandTotal).toBe(month(OLD_ROWS).grandTotal);
  });

  test('the export HTML has the Unassigned block, after the grand-total-bearing table rows and not summed into it', () => {
    const m = fullMonth([...OLD_ROWS, newMisc]);
    const html = buildPrimeDriverExpenseReportHtml('H', m, STRINGS, FMT);
    expect(html).toContain(STRINGS.unassignedTitle);
    expect(html).toContain('new-misc purchase');
    expect(html).toContain('$88.40');
    expect(html).toContain(STRINGS.unassignedNote);
    // grand total printed unchanged (old rows only)
    expect(html).toContain(`$${m.grandTotal.toFixed(2)}`);
    expect(m.grandTotal).toBeCloseTo(2657.49, 2);
  });

  test('origin rule: settlement rows and settlement-document rows are never unassigned', () => {
    const withheld = ded('w', 'Misc', 50, null, { source: 'settlement' });
    const linked = ded('l', 'Other', 60, null, { settlement_id: 's9' });
    const fromDoc = ded('d', 'Misc', 70, null, { document_id: 'doc-s' });
    const m = fullMonth([...OLD_ROWS, withheld, linked, fromDoc], new Set(['doc-s']));
    expect(m.unassigned.rows).toEqual([]);
  });

  test('vehicle registration rows stay excluded from the Unassigned block', () => {
    const reg = ded('reg', 'Misc', 300, null, { description: 'Truck registration and license plate renewal' });
    expect(fullMonth([...OLD_ROWS, reg]).unassigned.rows).toEqual([]);
  });

  test('direct sheet entries are never unassigned', () => {
    expect(fullMonth(OLD_ROWS).sections.find((s) => s.category === 'Laundry/Showers')!.rows.map((r) => r.id)).toEqual(['direct']);
  });
});

// STAGE 3: notices use the very same list (and so the same origin rule).
import { readFileSync } from 'fs';
import { join } from 'path';
describe('stage 3: notices read the same needs list', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../../..', p), 'utf8');
  test.each(['app/(tabs)/deductions.tsx', 'app/(tabs)/more/accountant-package.tsx'])('%s builds its notice from findRowsNeedingAccountantCategory + settlementDocumentIds', (p) => {
    const s = src(p);
    expect(s).toContain('findRowsNeedingAccountantCategory(');
    expect(s).toContain('settlementDocumentIds(');
  });
});
