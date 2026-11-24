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
