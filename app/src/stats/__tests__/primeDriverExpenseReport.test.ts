import { buildPrimeDriverExpenseReportHtml, buildPrimeDriverExpenseReportFilename } from '@/src/stats/primeDriverExpenseReport';
import { buildPrimeDriverExpenseMonth, type PrimeDriverExpenseRow } from '@/src/stats/primeDriverExpenses';

const strings = {
  categoryTableTitle: 'Categories',
  daysAwayFromHomeLabel: 'Days Away From Home',
  grandTotalLabel: 'Grand Total',
  noEntriesLabel: 'No entries this month.',
  disclaimer: 'This tool is provided to help organize your own records. Not tax advice — consult a qualified CPA.',
};
const fmt = { money: (n: number) => `$${n.toFixed(2)}`, date: (iso: string) => iso };

describe('buildPrimeDriverExpenseReportHtml ("FOR PRIME INC DRIVERS" export, owner decision 2026-09-17)', () => {
  const rows: PrimeDriverExpenseRow[] = [
    { id: '1', exp_date: '2026-06-03', amount: 45, category: 'Lumpers', note: 'Load 123' },
  ];
  const settlements = [{ week_ending: '2026-06-06', per_diem_days: 7 }];
  const monthData = buildPrimeDriverExpenseMonth(rows, settlements, 2026, 6);

  it('renders the header identity line verbatim', () => {
    const html = buildPrimeDriverExpenseReportHtml('Bozkurt Trucking — Unit 830157 — June 2026', monthData, strings, fmt);
    expect(html).toContain('Bozkurt Trucking — Unit 830157 — June 2026');
  });

  it('renders all 16 category sections even when 15 of them have zero entries', () => {
    const html = buildPrimeDriverExpenseReportHtml('Header', monthData, strings, fmt);
    for (const category of [
      'Lumpers', 'Cash Tolls/Parking Fees', 'Scales', 'Equipment/Operating Supplies', 'Safety/Weather Gear',
      'Cash Fuel', 'Oil &amp; Additives', 'Truck &amp; Trailer Wash', 'Repairs', 'Communication', 'Advertising',
      'Office Supplies', 'Lodging', 'Laundry/Showers', 'Bank/ATM Fees', 'Misc',
    ]) {
      expect(html).toContain(category);
    }
    // A category with zero entries shows the "no entries" line, not a
    // missing section.
    expect(html).toContain(strings.noEntriesLabel);
  });

  it('renders the grand total', () => {
    const html = buildPrimeDriverExpenseReportHtml('Header', monthData, strings, fmt);
    expect(html).toContain(fmt.money(monthData.grandTotal));
    expect(html).toContain(strings.grandTotalLabel);
  });

  it('renders Days Away From Home', () => {
    const html = buildPrimeDriverExpenseReportHtml('Header', monthData, strings, fmt);
    expect(html).toContain(strings.daysAwayFromHomeLabel);
    expect(html).toContain(String(monthData.daysAwayFromHome));
  });

  it('renders the disclaimer', () => {
    const html = buildPrimeDriverExpenseReportHtml('Header', monthData, strings, fmt);
    expect(html).toContain(strings.disclaimer);
  });

  it('escapes untrusted note text', () => {
    const withHtml: PrimeDriverExpenseRow[] = [{ id: '1', exp_date: '2026-06-03', amount: 10, category: 'Misc', note: '<script>alert(1)</script>' }];
    const data = buildPrimeDriverExpenseMonth(withHtml, settlements, 2026, 6);
    const html = buildPrimeDriverExpenseReportHtml('Header', data, strings, fmt);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildPrimeDriverExpenseReportFilename', () => {
  it('builds a stable, non-localized filename', () => {
    expect(buildPrimeDriverExpenseReportFilename(2026, 6, 'pdf')).toBe('prime-driver-expenses-june-2026.pdf');
    expect(buildPrimeDriverExpenseReportFilename(2026, 12, 'xls')).toBe('prime-driver-expenses-december-2026.xls');
  });
});
