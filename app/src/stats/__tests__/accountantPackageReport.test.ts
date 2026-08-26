import { buildAccountantReportHtml, buildAccountantReportFilename, type AccountantReportInput, type AccountantReportStrings, type AccountantReportFormatters } from '../accountantPackageReport';
import { ACCOUNTANT_EXPORT_COLORS } from '../accountantPackageColors';
import { buildLineItems, buildScheduleCTotals, groupLineItemsByScheduleCBucket } from '../accountantPackage';
import type { LineItem, GroupedScheduleCCategory, OwnersEquitySummary } from '../accountantPackage';
import { formatMonthLabel } from '@/src/i18n/format';

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
    vendor: null,
    reference: null,
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
    rows: [],
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
  referenceLabel: 'Inv#',
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
  ownersEquityDetailTitle: "Owner's Equity — Detail",
  ownersEquityNoRows: 'No contributions or draws recorded for this period.',
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

// OWNER'S EQUITY ROW DETAIL (owner decision, device report: "contributions
// and draws currently show too little — every row must carry its exact
// date, its full description/note, its type, and its amount — in the
// on-screen report, the Excel export and the PDF"). PDF and Excel share
// this exact HTML (this file's own header comment), so one test covers
// both surfaces; the on-screen render reads from the identical
// ownersEquity.rows array (accountant-package.tsx), proven separately in
// accountantPackage.test.ts's own buildOwnersEquity — rows tests.
describe('buildAccountantReportHtml — Owner\'s Equity row detail (date/description/type/amount, chronological)', () => {
  const rows = [
    { id: 'c1', date: '2026-01-01', description: 'Initial deposit', type: 'cashContribution' as const, amount: 1000 },
    { id: 'c2', date: '2026-07-01', description: 'Parts — paid personally (Cash)', type: 'expensePaidPersonally' as const, amount: 200 },
    { id: 'r1', date: '2026-07-15', description: 'Parts — reimbursed to owner', type: 'reimbursementTakenBack' as const, amount: 100 },
    { id: 'd1', date: '2026-08-01', description: 'Personal withdrawal', type: 'ownerDraw' as const, amount: 300 },
  ];

  it('DETAILED mode renders every row with its own real date, description, type label, and amount', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows }) }), baseStrings, fmt, 'detailed');
    expect(html).toContain('Owner\'s Equity — Detail');
    for (const row of rows) {
      expect(html).toContain(row.date);
      expect(html).toContain(row.description);
    }
    // Type labels reuse the SAME 4 strings the summary section already
    // uses — never a second, separately-translated set.
    expect(html).toContain(baseStrings.cashContributedLabel);
    expect(html).toContain(baseStrings.expensesPaidPersonallyLabel);
    expect(html).toContain(baseStrings.reimbursementsTakenBackLabel);
    expect(html).toContain(baseStrings.ownerDrawsLabel);
    expect(html).toContain('$1000.00'); // cash contribution, no sign
    expect(html).toContain('-$100.00'); // reimbursement, out
    expect(html).toContain('-$300.00'); // owner draw, out
  });

  it('rows appear in the SAME chronological order buildCapitalFlowRows() already sorted them in — the report never re-sorts', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows }) }), baseStrings, fmt, 'detailed');
    const positions = rows.map((r) => html.indexOf(r.description));
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  });

  it('IN flows (contribution/expense paid personally) get the flow-in tint; OUT flows (reimbursement/draw) get flow-out', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows: [rows[0]] }) }), baseStrings, fmt, 'detailed');
    expect(html).toContain(`<tr class="flow-in"><td>2026-01-01 — Initial deposit</td>`);
    const outHtml = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows: [rows[3]] }) }), baseStrings, fmt, 'detailed');
    expect(outHtml).toContain(`<tr class="flow-out"><td>2026-08-01 — Personal withdrawal</td>`);
  });

  it('SUMMARY mode shows NONE of the itemized rows — totals only, matching every other section\'s own summary/detailed convention', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows }) }), baseStrings, fmt, 'summary');
    for (const row of rows) expect(html).not.toContain(row.description);
    expect(html).not.toContain('Owner\'s Equity — Detail');
    // The existing flow TOTALS still show, unaffected by this change.
    expect(html).toContain('Net Position');
  });

  it('shows a "no rows" message when there are no contributions/draws at all, instead of an empty table', () => {
    const html = buildAccountantReportHtml(baseInput({ ownersEquity: ownersEquity({ rows: [] }) }), baseStrings, fmt, 'detailed');
    expect(html).toContain(baseStrings.ownersEquityNoRows);
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

// SHORT VS DETAILED EXPORT (owner decision, web-parity pass) — a realistic
// multi-category, multi-item fixture shared by every test in this block,
// so "detailed contains every line item" and "summary's subtotals equal
// the sum of the detailed lines beneath them" are proven against the
// EXACT SAME data, never two slightly-different fixtures that could
// coincidentally agree.
function multiCategoryFixture() {
  const fuel1 = lineItem({ id: 'fuel-1', category: 'Fuel & DEF', description: 'Pilot #123', amount: 400, date: '2026-08-02' });
  const fuel2 = lineItem({ id: 'fuel-2', category: 'Fuel & DEF', description: 'TA #456', amount: 200, date: '2026-08-10' });
  const parts1 = lineItem({
    id: 'parts-1',
    category: 'Truck Parts',
    description: 'Brake pads',
    amount: 150,
    date: '2026-08-05',
    vendor: 'NAPA Auto Parts',
  });
  const maint1 = lineItem({
    id: 'maint-1',
    category: 'Maintenance & Repairs',
    description: 'Oil change',
    amount: 300,
    date: '2026-08-12',
    vendor: "Joe's Truck Repair",
    reference: 'INV-4471',
  });
  const lumper1 = lineItem({ id: 'lumper-1', category: 'Lumper Fees', description: 'Unload at DC #9', amount: 75, date: '2026-08-03' });
  const lumper2 = lineItem({ id: 'lumper-2', category: 'Lumper Fees', description: 'Load at DC #2', amount: 60, date: '2026-08-20' });

  const groupedCategories: GroupedScheduleCCategory[] = [
    { category: 'Fuel & DEF', amount: 600, scheduleCLine: '9', items: [fuel1, fuel2] },
    { category: 'Truck Parts', amount: 150, scheduleCLine: '21', items: [parts1] },
    { category: 'Maintenance & Repairs', amount: 300, scheduleCLine: '21', items: [maint1] },
  ];
  const lumperFees = [lumper1, lumper2];
  const lumperTotal = 135;
  const totalExpenses = 600 + 150 + 300; // Lumper Fees is its own section, not folded into the category grand total

  return { groupedCategories, lumperFees, lumperTotal, totalExpenses, allItems: [fuel1, fuel2, parts1, maint1, lumper1, lumper2] };
}

describe('buildAccountantReportHtml — SUMMARY vs DETAILED format', () => {
  it('DETAILED contains every line item in the data, across every category and Lumper Fees', () => {
    const { groupedCategories, lumperFees, lumperTotal, totalExpenses, allItems } = multiCategoryFixture();
    const html = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'detailed');
    for (const item of allItems) {
      expect(html).toContain(item.description);
    }
  });

  it('SUMMARY contains NO individual line items — only category/lumper subtotals', () => {
    const { groupedCategories, lumperFees, lumperTotal, totalExpenses, allItems } = multiCategoryFixture();
    const html = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'summary');
    for (const item of allItems) {
      expect(html).not.toContain(item.description);
    }
    // The subtotals themselves are still fully present.
    expect(html).toContain('$600.00');
    expect(html).toContain('$150.00');
    expect(html).toContain('$300.00');
    expect(html).toContain('$135.00');
  });

  it("SUMMARY's category subtotals equal the sum of the detailed lines beneath them — they reconcile exactly", () => {
    const { groupedCategories, lumperFees, lumperTotal, totalExpenses } = multiCategoryFixture();
    const summaryHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'summary');
    const detailedHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'detailed');

    for (const cat of groupedCategories) {
      const summedFromItems = cat.items.reduce((sum, i) => sum + i.amount, 0);
      expect(cat.amount).toBe(summedFromItems); // the fixture's own invariant
      const rendered = `$${cat.amount.toFixed(2)}`;
      expect(summaryHtml).toContain(rendered);
      expect(detailedHtml).toContain(rendered);
    }
    // Same for Lumper Fees' own total vs. its own two items.
    const lumperSummed = lumperFees.reduce((sum, i) => sum + i.amount, 0);
    expect(lumperTotal).toBe(lumperSummed);
    expect(summaryHtml).toContain(`$${lumperTotal.toFixed(2)}`);
    expect(detailedHtml).toContain(`$${lumperTotal.toFixed(2)}`);
    // And the grand total is identical in both formats.
    expect(summaryHtml).toContain(`$${totalExpenses.toFixed(2)}`);
    expect(detailedHtml).toContain(`$${totalExpenses.toFixed(2)}`);
  });

  it('DETAILED enriches a row with vendor and/or invoice reference when captured; SUMMARY never shows them at all', () => {
    const { groupedCategories, lumperFees, lumperTotal, totalExpenses } = multiCategoryFixture();
    const detailedHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'detailed');
    const summaryHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'summary');

    expect(detailedHtml).toContain('Brake pads (NAPA Auto Parts)');
    expect(detailedHtml).toContain("Oil change (Joe's Truck Repair) — Inv# INV-4471");
    expect(summaryHtml).not.toContain('NAPA Auto Parts');
    expect(summaryHtml).not.toContain('INV-4471');
  });

  it('a row with no vendor/reference renders with no enrichment suffix at all', () => {
    const html = buildAccountantReportHtml(
      baseInput({ groupedCategories: [{ category: 'Fuel & DEF', amount: 100, scheduleCLine: '9', items: [lineItem({ description: 'Pilot #1', amount: 100 })] }] }),
      baseStrings,
      fmt,
      'detailed'
    );
    expect(html).toContain('Pilot #1');
    expect(html).not.toContain('Pilot #1 (');
  });

  it('defaults to DETAILED when no format is passed — every pre-existing caller keeps its current behavior', () => {
    const { groupedCategories, lumperFees, lumperTotal, totalExpenses } = multiCategoryFixture();
    const defaultHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt);
    const explicitDetailedHtml = buildAccountantReportHtml(baseInput({ groupedCategories, lumperFees, lumperTotal, totalExpenses }), baseStrings, fmt, 'detailed');
    expect(defaultHtml).toBe(explicitDetailedHtml);
  });

  it('respects whatever scope/period filtering already narrowed the input, IDENTICALLY in both formats — format never re-filters data', () => {
    // buildLineItems()/buildScheduleCTotals() (accountantPackage.ts) are
    // what apply scope/period filtering, upstream of this module entirely
    // — buildAccountantReportHtml() has no year/month/scope parameter at
    // all, so a caller's own filtered `groupedCategories`/`lumperFees`
    // input is rendered as-is, item-for-item, regardless of format.
    const narrowed: GroupedScheduleCCategory[] = [{ category: 'Fuel & DEF', amount: 400, scheduleCLine: '9', items: [lineItem({ id: 'only-this-one', description: 'Pilot #123', amount: 400 })] }];
    const summaryHtml = buildAccountantReportHtml(baseInput({ groupedCategories: narrowed, totalExpenses: 400 }), baseStrings, fmt, 'summary');
    const detailedHtml = buildAccountantReportHtml(baseInput({ groupedCategories: narrowed, totalExpenses: 400 }), baseStrings, fmt, 'detailed');
    expect(summaryHtml).toContain('$400.00');
    expect(detailedHtml).toContain('$400.00');
    expect(detailedHtml).toContain('Pilot #123');
    expect(summaryHtml).not.toContain('Pilot #123');
  });

  it('an empty Lumper Fees list omits the whole Lumper Fees section in both formats (never an empty header)', () => {
    const summaryHtml = buildAccountantReportHtml(baseInput({ lumperFees: [], lumperTotal: 0 }), baseStrings, fmt, 'summary');
    const detailedHtml = buildAccountantReportHtml(baseInput({ lumperFees: [], lumperTotal: 0 }), baseStrings, fmt, 'detailed');
    expect(summaryHtml).not.toContain(baseStrings.lumperFeesTitle);
    expect(detailedHtml).not.toContain(baseStrings.lumperFeesTitle);
  });
});

describe('buildAccountantReportFilename (spec item 4)', () => {
  it('builds "…-july-2026-out-of-pocket-detailed.pdf" for a specific month', () => {
    expect(buildAccountantReportFilename(2026, 7, 'outOfPocket', 'detailed', 'pdf')).toBe('accountant-package-july-2026-out-of-pocket-detailed.pdf');
  });

  it('builds a year-only slug for "All Year" (month=null)', () => {
    expect(buildAccountantReportFilename(2026, null, 'outOfPocket', 'summary', 'xls')).toBe('accountant-package-2026-out-of-pocket-summary.xls');
  });

  it('reflects every scope value with its own distinct slug', () => {
    expect(buildAccountantReportFilename(2026, 1, 'outOfPocket', 'summary', 'pdf')).toContain('out-of-pocket');
    expect(buildAccountantReportFilename(2026, 1, 'withheld', 'summary', 'pdf')).toContain('settlement-withheld');
    expect(buildAccountantReportFilename(2026, 1, 'combined', 'summary', 'pdf')).toContain('combined');
  });

  it('reflects both format values with their own distinct slug', () => {
    expect(buildAccountantReportFilename(2026, 1, 'outOfPocket', 'summary', 'pdf')).toContain('-summary.pdf');
    expect(buildAccountantReportFilename(2026, 1, 'outOfPocket', 'detailed', 'pdf')).toContain('-detailed.pdf');
  });

  it('uses the real English month name for every month, not a zero-padded number', () => {
    expect(buildAccountantReportFilename(2026, 1, 'combined', 'summary', 'pdf')).toContain('january-2026');
    expect(buildAccountantReportFilename(2026, 12, 'combined', 'summary', 'pdf')).toContain('december-2026');
  });
});

// MONTH FILTER OFF-BY-ONE — FULL CHAIN, END TO END (owner decision, device
// report: "selecting May shows June's documents, selecting June shows
// July's"). Root cause was in the SCREEN's own month-Pill labels
// (app/(tabs)/more/accountant-package.tsx), not in buildLineItems() or
// this HTML builder — both were already correct. This test proves the
// WHOLE chain a real user experiences agrees for a given month selection:
// the real filtering (buildLineItems, exercised with RAW deduction rows,
// not pre-built LineItems like every other test in this file) AND the
// exported HTML (which the PDF and Excel exports share verbatim, per this
// file's own header comment — one proof covers both surfaces) AND the
// month LABEL itself (formatMonthLabel(), src/i18n/format.ts — the actual
// fix for the reported bug).
describe('MONTH FILTER OFF-BY-ONE — full chain: label, filter, and exported HTML all agree for one row per month across 3 consecutive months', () => {
  function rawDeduction(overrides: { id: string; ded_date: string; description: string; amount: number }) {
    return {
      id: overrides.id,
      user_id: 'u1',
      settlement_id: null,
      driver_id: null,
      truck_id: null,
      document_id: null,
      ded_date: overrides.ded_date,
      code: null,
      description: overrides.description,
      amount: overrides.amount,
      category: 'Misc',
      store: null,
      payment_method: null,
      source: 'manual' as const,
      warranty_years: null,
      tags: null,
      tax_deductible: true,
      reviewed_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  const rows = [
    rawDeduction({ id: 'march-row', ded_date: '2026-03-10', description: 'March Item', amount: 111 }),
    rawDeduction({ id: 'april-row', ded_date: '2026-04-10', description: 'April Item', amount: 222 }),
    rawDeduction({ id: 'may-row', ded_date: '2026-05-10', description: 'May Item', amount: 333 }),
  ];

  const months = [
    { month: 3, expectedLabel: 'March', expectedDescription: 'March Item' },
    { month: 4, expectedLabel: 'April', expectedDescription: 'April Item' },
    { month: 5, expectedLabel: 'May', expectedDescription: 'May Item' },
  ];

  for (const { month, expectedLabel, expectedDescription } of months) {
    it(`selecting month ${month} (${expectedLabel}) shows exactly "${expectedDescription}" on screen, in Excel, and in PDF — never a neighboring month's row`, () => {
      // "On screen" — the real buildLineItems() pipeline, same function
      // the screen's own groupedCategories useMemo calls.
      const lineItems = buildLineItems(rows, [], [], [], 2026, month, 'combined');
      expect(lineItems.map((i) => i.description)).toEqual([expectedDescription]);

      // The month LABEL itself — the actual fix. Proves the label the
      // user taps and the numeric value that drove the filter above
      // genuinely agree (this is what was broken: the Pill LABELED "May"
      // used to set month=6).
      const label = formatMonthLabel(2026, month, 'en', { month: 'long' });
      expect(label).toBe(expectedLabel);

      // "In Excel and in PDF" — buildAccountantReportHtml() is the ONE
      // shared HTML both exports render (this file's own header comment);
      // proving the exported HTML contains this month's row and no other
      // month's covers both surfaces at once.
      const totals = buildScheduleCTotals(lineItems, []);
      const grouped = groupLineItemsByScheduleCBucket(lineItems, totals, []);
      const html = buildAccountantReportHtml(
        baseInput({
          headerLine: `Test Co — Unit 1 — ${label} 2026 — Combined`,
          groupedCategories: grouped,
          totalExpenses: lineItems.reduce((sum, i) => sum + i.amount, 0),
        }),
        baseStrings,
        fmt
      );

      expect(html).toContain(`${label} 2026`);
      expect(html).toContain(expectedDescription);
      for (const other of months) {
        if (other.month !== month) expect(html).not.toContain(other.expectedDescription);
      }
    });
  }
});
