import { buildAccountantReportHtml, type AccountantReportInput, type AccountantReportStrings, type AccountantReportFormatters } from '../accountantPackageReport';
import { ACCOUNTANT_EXPORT_COLORS } from '../accountantPackageColors';
import type { LineItem, GroupedScheduleCCategory, OwnersEquitySummary } from '../accountantPackage';

// FULL VISUAL PARITY WITH WEB (owner decision, v2026.08.05-W chase) — the
// PDF and Excel exports share this EXACT same generated HTML (the screen
// only varies the extension/MIME type), so proving the HTML itself has
// the amber owner-paid treatment + "Paid with" column covers BOTH export
// surfaces at once — there is no separate PDF-only or Excel-only code
// path to diverge.

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
function dateFmt(iso: string): string {
  return iso;
}
const fmt: AccountantReportFormatters = { money, date: dateFmt };

function lineItem(overrides: Partial<LineItem>): LineItem {
  return {
    id: 'li-1',
    kind: 'deduction',
    date: '2026-08-01',
    description: 'Truck parts',
    category: 'Truck Parts',
    amount: 100,
    origin: 'import',
    isOwnerPaid: false,
    paymentMethod: null,
    ...overrides,
  };
}

function ownersEquity(overrides: Partial<OwnersEquitySummary> = {}): OwnersEquitySummary {
  return {
    cashAmount: 0,
    cashCount: 0,
    linkedAmount: 0,
    linkedCount: 0,
    total: 0,
    unmatchedOwnerPaidCount: 0,
    flows: {
      cashContributed: 1000,
      cashContributedCount: 1,
      expensesPaidPersonallyOutstanding: 200,
      expensesPaidPersonallyOutstandingCount: 2,
      reimbursementsTakenBack: 50,
      reimbursementsTakenBackCount: 1,
      ownerDraws: 300,
      ownerDrawsCount: 3,
      netPosition: 850,
    },
    ...overrides,
  };
}

const baseStrings: AccountantReportStrings = {
  grossIncome: 'Gross Income',
  deductibleExpenses: 'Deductible Expenses',
  reconcilingCaption: 'Reconciles below.',
  perDiemTitle: 'Per Diem',
  perDiemMonthLabel: 'This Month',
  perDiemYtdLabel: 'YTD',
  perDiemDaysUnit: 'days',
  perDiemNote: 'Per diem note.',
  lumperFeesTitle: 'Lumper Fees',
  paidWithLabel: 'Paid with',
  categoryTableTitle: 'Expenses by Category',
  lineLabel: 'Line',
  grandTotal: 'Grand Total',
  ownerPaidBadge: 'OWNER PAID',
  capitalAssetsTitle: 'Capital Assets',
  capitalAssetsNote: 'Depreciable.',
  noCapitalAssets: 'None.',
  financingCash: 'cash',
  financingLoan: 'loan',
  ownersEquityTitle: "Owner's Equity",
  cashContributedLabel: 'Cash contributed',
  cashContributedNote: 'Cash in note.',
  expensesPaidPersonallyLabel: 'Paid personally',
  expensesPaidPersonallyNote: 'Paid personally note.',
  reimbursementsTakenBackLabel: 'Reimbursements taken back',
  reimbursementsTakenBackNote: 'Taken back note.',
  ownerDrawsLabel: 'Owner draws',
  ownerDrawsNote: 'Draws note.',
  netPositionLabel: 'Net Position',
  footerMealsNote: 'Meals excluded.',
  footerNonDeductibleNote: 'Advances/escrow non-deductible.',
  footerOwnerPaidNote: 'Owner paid = contributions.',
  disclaimer: 'Estimates only.',
};

function baseInput(overrides: Partial<AccountantReportInput> = {}): AccountantReportInput {
  return {
    headerLine: 'Graywolf Logistics LLC — Unit 4471 — August 2026 — Out-of-pocket only',
    grossIncome: 5000,
    reimbursementsTotal: 0,
    totalExpenses: 1000,
    perDiem: null,
    implausibleDates: [],
    miscWarning: null,
    lumperFees: [],
    lumperTotal: 0,
    groupedCategories: [],
    capitalAssets: [],
    ownersEquity: ownersEquity(),
    ...overrides,
  };
}

describe('buildAccountantReportHtml — header identity (spec item 3)', () => {
  it('renders the exact pre-composed header line as the H1, unmodified', () => {
    const html = buildAccountantReportHtml(baseInput({ headerLine: 'Acme LLC — Unit 42 — August 2026 — Out-of-pocket only' }), baseStrings, fmt);
    expect(html).toContain('<h1>Acme LLC — Unit 42 — August 2026 — Out-of-pocket only</h1>');
  });
});

describe('buildAccountantReportHtml — OWNER PAID rows get amber treatment + Paid With column (spec item 1)', () => {
  it('an owner-paid lumper fee row gets the amber background, badge, and payment method', () => {
    const ownerPaidLumper = lineItem({ id: 'lumper-1', category: 'Lumper Fees', isOwnerPaid: true, paymentMethod: 'Cash', amount: 75 });
    const input = baseInput({ lumperFees: [ownerPaidLumper], lumperTotal: 75 });
    const html = buildAccountantReportHtml(input, baseStrings, fmt);

    expect(html).toContain(`background:${ACCOUNTANT_EXPORT_COLORS.ownerPaidBg}`);
    expect(html).toContain('OWNER PAID');
    expect(html).toContain('Cash');
  });

  it('a non-owner-paid row gets no amber background and no payment method text', () => {
    const normalItem = lineItem({ id: 'normal-1', category: 'Fuel & DEF', isOwnerPaid: false, paymentMethod: null });
    const grouped: GroupedScheduleCCategory[] = [{ category: 'Fuel & DEF', amount: 100, scheduleCLine: '9', items: [normalItem] }];
    const input = baseInput({ groupedCategories: grouped, totalExpenses: 100 });
    const html = buildAccountantReportHtml(input, baseStrings, fmt);

    expect(html).not.toContain(`background:${ACCOUNTANT_EXPORT_COLORS.ownerPaidBg}`);
    expect(html).not.toContain('OWNER PAID');
  });

  it('an owner-paid row inside the category table (not just lumper fees) also gets the amber treatment + paid-with value', () => {
    const ownerPaidPart = lineItem({ id: 'part-1', category: 'Truck Parts', isOwnerPaid: true, paymentMethod: 'Personal Credit Card', amount: 250 });
    const grouped: GroupedScheduleCCategory[] = [{ category: 'Truck Parts', amount: 250, scheduleCLine: '21', items: [ownerPaidPart] }];
    const input = baseInput({ groupedCategories: grouped, totalExpenses: 250 });
    const html = buildAccountantReportHtml(input, baseStrings, fmt);

    expect(html).toContain(`background:${ACCOUNTANT_EXPORT_COLORS.ownerPaidBg}`);
    expect(html).toContain('Personal Credit Card');
  });

  it('the "Paid with" column header appears above both the lumper table and the category table', () => {
    const html = buildAccountantReportHtml(
      baseInput({ lumperFees: [lineItem({ category: 'Lumper Fees' })], lumperTotal: 100 }),
      baseStrings,
      fmt
    );
    const occurrences = html.split('Paid with').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('buildAccountantReportHtml — section order matches spec item 4 exactly', () => {
  it('summary tiles -> per-diem -> warnings -> LUMPER FEES -> category table -> Capital Assets -> Owner\'s Equity', () => {
    const input = baseInput({
      perDiem: { monthDays: 5, monthDeduction: 350, ytdDays: 40, ytdDeduction: 2800, dailyRate: 70 },
      implausibleDates: [{ label: 'Fuel', date: '2019-01-01' }],
      miscWarning: { miscAmount: 500, miscPct: 0.3 },
      lumperFees: [lineItem({ category: 'Lumper Fees' })],
      lumperTotal: 100,
      groupedCategories: [{ category: 'Fuel & DEF', amount: 200, scheduleCLine: '9', items: [lineItem({ category: 'Fuel & DEF' })] }],
      capitalAssets: [{ type: 'truck', name: 'Unit 42', date: '2026-01-01', price: 50000, financing: 'loan' }],
    });
    const strings: AccountantReportStrings = {
      ...baseStrings,
      implausibleDateWarning: '1 row(s) have an implausible date.',
      miscConcentrationWarning: '"Misc" makes up 30%.',
    };
    const html = buildAccountantReportHtml(input, strings, fmt);

    const indices = {
      grossIncome: html.indexOf('Gross Income'),
      perDiem: html.indexOf('>Per Diem<'),
      implausibleWarning: html.indexOf('1 row(s) have an implausible date.'),
      miscWarning: html.indexOf('"Misc" makes up 30%.'),
      lumperFees: html.indexOf('>Lumper Fees<'),
      categoryTable: html.indexOf('>Expenses by Category<'),
      capitalAssets: html.indexOf('Capital Assets'),
      ownersEquity: html.indexOf("Owner's Equity"),
    };

    for (const [key, idx] of Object.entries(indices)) {
      expect(idx).toBeGreaterThan(-1);
    }
    expect(indices.grossIncome).toBeLessThan(indices.perDiem);
    expect(indices.perDiem).toBeLessThan(indices.implausibleWarning);
    expect(indices.implausibleWarning).toBeLessThan(indices.miscWarning);
    expect(indices.miscWarning).toBeLessThan(indices.lumperFees);
    expect(indices.lumperFees).toBeLessThan(indices.categoryTable);
    expect(indices.categoryTable).toBeLessThan(indices.capitalAssets);
    expect(indices.capitalAssets).toBeLessThan(indices.ownersEquity);
  });

  it('omits the per-diem, warning, and lumper sections entirely when there is nothing to show', () => {
    const html = buildAccountantReportHtml(baseInput(), baseStrings, fmt);
    expect(html).not.toContain('>Per Diem<');
    expect(html).not.toContain('>Lumper Fees<');
  });
});

describe('buildAccountantReportHtml — colour coding for totals/income/capital assets (spec item 1)', () => {
  it('the deductible expenses total row is red', () => {
    const html = buildAccountantReportHtml(baseInput(), baseStrings, fmt);
    expect(html).toContain('class="total expenses-row"');
    expect(html).toContain(`.total.expenses-row { background: ${ACCOUNTANT_EXPORT_COLORS.totalRowBg}; }`);
  });

  it('the gross income row is green', () => {
    const html = buildAccountantReportHtml(baseInput(), baseStrings, fmt);
    expect(html).toContain('class="income-row"');
    expect(html).toContain(`.income-row { background: ${ACCOUNTANT_EXPORT_COLORS.grossIncomeBg}; }`);
  });

  it('capital assets section uses the blue background/header', () => {
    const html = buildAccountantReportHtml(baseInput(), baseStrings, fmt);
    expect(html).toContain(`background: ${ACCOUNTANT_EXPORT_COLORS.capitalAssetsBg}`);
    expect(html).toContain(`background: ${ACCOUNTANT_EXPORT_COLORS.capitalAssetsHeaderBg}`);
  });

  it('a category subtotal row uses the grey background', () => {
    const grouped: GroupedScheduleCCategory[] = [{ category: 'Fuel & DEF', amount: 200, scheduleCLine: '9', items: [] }];
    const html = buildAccountantReportHtml(baseInput({ groupedCategories: grouped }), baseStrings, fmt);
    expect(html).toContain(`background:${ACCOUNTANT_EXPORT_COLORS.subtotalRowBg}`);
  });

  it('a Schedule C line reference renders as a chip', () => {
    const grouped: GroupedScheduleCCategory[] = [{ category: 'Fuel & DEF', amount: 200, scheduleCLine: '9', items: [] }];
    const html = buildAccountantReportHtml(baseInput({ groupedCategories: grouped }), baseStrings, fmt);
    expect(html).toContain('class="chip"');
    expect(html).toContain('Line 9');
  });

  it('the owner-equity four flows render with in/out tinting and their one-liner notes', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity() }), baseStrings, fmt);
    expect(html).toContain('class="flow-in"');
    expect(html).toContain('class="flow-out"');
    expect(html).toContain('Cash in note.');
    expect(html).toContain('Paid personally note.');
    expect(html).toContain('Taken back note.');
    expect(html).toContain('Draws note.');
    expect(html).toContain('Net Position');
  });
});

describe('buildAccountantReportHtml — footer notes always present', () => {
  it('includes the meals/non-deductible/owner-paid footer notes and the disclaimer', () => {
    const html = buildAccountantReportHtml(baseInput(), baseStrings, fmt);
    expect(html).toContain('Meals excluded.');
    expect(html).toContain('Advances/escrow non-deductible.');
    expect(html).toContain('Owner paid = contributions.');
    expect(html).toContain('Estimates only.');
  });
});

describe('buildAccountantReportHtml — escapes untrusted text', () => {
  it('escapes HTML-special characters in a line item description', () => {
    const item = lineItem({ description: '<script>alert(1)</script> & "quotes"' });
    const grouped: GroupedScheduleCCategory[] = [{ category: 'Truck Parts', amount: 100, scheduleCLine: null, items: [item] }];
    const html = buildAccountantReportHtml(baseInput({ groupedCategories: grouped }), baseStrings, fmt);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// PER DIEM YTD BUG FIX (owner decision, device report: "this month" and
// "year-to-date" showed the SAME number in the PDF/Excel report") — both
// exports share this exact HTML, so proving it here covers both surfaces.
describe('buildAccountantReportHtml — per diem month vs YTD never show the same figure', () => {
  it('shows two distinct rows with distinct numbers when a real month is selected', () => {
    const html = buildAccountantReportHtml(
      baseInput({ perDiem: { monthDays: 35, monthDeduction: 1960, ytdDays: 42, ytdDeduction: 2352, dailyRate: 56 } }),
      baseStrings,
      fmt
    );
    expect(html).toContain('35 days');
    expect(html).toContain('42 days');
    expect(html).toContain('$1960.00');
    expect(html).toContain('$2352.00');
  });

  it('omits the "This Month" row entirely when no month is selected — never repeats the YTD figure under a second label', () => {
    const html = buildAccountantReportHtml(
      baseInput({ perDiem: { monthDays: null, monthDeduction: null, ytdDays: 42, ytdDeduction: 2352, dailyRate: 56 } }),
      baseStrings,
      fmt
    );
    // The YTD row is still present...
    expect(html).toContain('42 days');
    expect(html).toContain('$2352.00');
    // ...but the "This Month" label/row never appears at all.
    expect(html).not.toContain(baseStrings.perDiemMonthLabel);
  });
});
