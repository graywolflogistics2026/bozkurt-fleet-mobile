// Simulated model responses (owner decision 2026-11-13: "the golden weeks
// through the new reader with a simulated model response per document").
// A response is what the content call returns: every figure as PRINTED
// TEXT, statement rows in print order with their TOTAL rows. Two builders:
//   - printedFromWeek(): a week of the owner's 13-week workbook, every
//     printed total real; the statement lines are one line per economic
//     class (the workbook gives the classes, not every line), except where
//     a real line list is passed in;
//   - printedFromExtraction(): an older golden fixture (07/17, 08/14) with
//     its real transcribed lines, printed back into the reader's shape.
import type { Extraction } from '@/src/import/types';
import type { ContentReading, ReadStatementRow, ReadSummaryRow, ReadSettlementLine } from '../../schema';
import type { GoldenWeek } from './prime13Weeks';

const r2 = (n: number) => Math.round(n * 100) / 100;
// As Prime prints it: "1,202.92-" for a negative amount, "" for blank.
export function printed(n: number | null | undefined): string {
  if (n == null) return '';
  const abs = Math.abs(r2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `${abs}-` : abs;
}
export function yymmdd(iso: string): string {
  return `${iso.slice(2, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}
// The header print date: M/D/YY, the day before the week ending.
export function printDateOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
}

export type Section = 'revenue' | 'fuel_oil_tax' | 'repair' | 'tires' | 'misc' | 'out_of_pocket' | 'fixed' | 'other';
export type PrintedLine = { section: Section; label: string; amount: number; ytd?: number | null; page?: number };

const BLOCKS: { section: Section; total: string }[] = [
  { section: 'revenue', total: 'TOTAL REVENUE' },
  { section: 'fuel_oil_tax', total: 'TOTAL FUEL,OIL,TAX' },
  { section: 'repair', total: 'TOTAL EQUIPMENT REPAIR AND MAINT.' },
  { section: 'tires', total: 'TOTAL TIRES' },
  { section: 'misc', total: 'TOTAL MISCELLANEOUS' },
  { section: 'out_of_pocket', total: 'TOTAL OUT OF POCKET COSTS' },
  { section: 'fixed', total: 'TOTAL FIXED COST' },
  { section: 'other', total: 'TOTAL OTHER INCOME AND EXPENSE' },
];

export type StatementInput = {
  lines: PrintedLine[];
  // Printed block totals; a block not given is the sum of its lines, a
  // block with no lines and no total is not printed at all.
  totals?: Partial<Record<Section, number | null>>;
  miles?: number | null;
  ytdMiles?: number | null;
  ytdRevenue?: number | null;
  ytdTotalStatement?: number | null;
  ytdPaid?: number | null;
  cashFlow: boolean;
  balanceForward?: number | null;
  settlementToOperator?: number | null;
  bondHeld?: number | null;
  // Pages: lines of block i go on statementPage(i).
  pageOf?: (section: Section) => number;
};

export function statementRows(input: StatementInput): ReadStatementRow[] {
  const rows: ReadStatementRow[] = [];
  const page = (s: Section) => (input.pageOf ? input.pageOf(s) : s === 'revenue' || s === 'fuel_oil_tax' || s === 'repair' || s === 'tires' || s === 'misc' ? 5 : 6);
  const row = (p: number, label: string, weeks: number | null | undefined, ytd: number | null = null) =>
    rows.push({ page: p, label, weeks: printed(weeks), ytd: printed(ytd), ltd: '' });
  const blockValue: Partial<Record<Section, number>> = {};
  for (const b of BLOCKS) {
    const lines = input.lines.filter((l) => l.section === b.section);
    for (const l of lines) row(l.page ?? page(b.section), l.label, l.amount, l.ytd ?? null);
    if (b.section === 'revenue') row(page('revenue'), 'MILES', input.miles ?? null, input.ytdMiles ?? null);
    const given = input.totals?.[b.section];
    const total = given !== undefined ? given : lines.length > 0 ? r2(lines.reduce((s, l) => s + l.amount, 0)) : undefined;
    if (total != null) {
      blockValue[b.section] = total;
      row(page(b.section), b.total, total, b.section === 'revenue' ? (input.ytdRevenue ?? null) : null);
    }
    if (b.section === 'misc') {
      const variable = r2((['fuel_oil_tax', 'repair', 'tires', 'misc'] as Section[]).reduce((s, x) => s + (blockValue[x] ?? 0), 0));
      blockValue.misc = blockValue.misc ?? 0;
      row(page('misc'), 'TOTAL VARIABLE COSTS', variable);
      blockValue.revenue = blockValue.revenue ?? 0;
      (blockValue as Record<string, number>).variable = variable;
    }
  }
  const variable = (blockValue as Record<string, number>).variable ?? 0;
  const operating = r2(variable + (blockValue.out_of_pocket ?? 0) + (blockValue.fixed ?? 0) + (blockValue.other ?? 0));
  row(page('other'), 'TOTAL OPERATING EXPENSES', operating);
  const statement = r2((blockValue.revenue ?? 0) + operating);
  row(page('other'), 'TOTAL STATEMENT OF INCOME & EXPENSE', statement, input.ytdTotalStatement ?? null);
  if (input.bondHeld != null) row(page('other'), 'PERF BD EMGCY FD', null, input.bondHeld);
  if (input.cashFlow) {
    row(page('other'), 'PRIOR WEEK BALANCE FORWARD', input.balanceForward ? input.balanceForward : null);
    row(page('other'), 'TOTAL CASH FLOW', r2(statement + (input.balanceForward ?? 0)));
  }
  if (input.settlementToOperator !== undefined) row(page('other'), 'SETTLEMENT TO OPERATOR', input.settlementToOperator, input.ytdPaid ?? null);
  return rows;
}

const PAYOUT_LABEL: Record<string, string> = { Banka: 'DIRECT DEPOSIT', 'Karta yükleme': 'AMOUNT LOADED ON CARD' };

// The statement lines of a workbook week, one line per economic class.
export function classLines(w: GoldenWeek): PrintedLine[] {
  const realVariable = r2(w.variableTotal - w.advancesNet - w.personalNet - w.capitalPurchase);
  const lines: PrintedLine[] = [{ section: 'revenue', label: 'REVENUE FROM PRIME INC.', amount: w.revenue }];
  if (realVariable !== 0) lines.push({ section: 'fuel_oil_tax', label: 'TRACTOR FUEL', amount: -realVariable });
  if (w.advancesNet !== 0) lines.push({ section: 'misc', label: 'ADVANCES', amount: -w.advancesNet });
  if (w.personalNet > 0) lines.push({ section: 'misc', label: 'PRIME POINT-OF-SALE', amount: -w.personalNet });
  if (w.personalNet < 0) lines.push({ section: 'misc', label: 'PERSONAL PYMNT RCV', amount: -w.personalNet });
  if (w.capitalPurchase !== 0) lines.push({ section: 'misc', label: 'OPERATOR TRK EXTRAS', amount: -w.capitalPurchase });
  if (w.fixedTotal !== 0) lines.push({ section: 'fixed', label: 'PHYSICAL DAMAGE INSURANCE', amount: -w.fixedTotal });
  if (w.bond !== 0) lines.push({ section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: -w.bond });
  if (w.interestIncome !== 0) lines.push({ section: 'other', label: 'INTEREST INCOME FROM DEPOSIT', amount: w.interestIncome });
  if (w.interestExpense !== 0) lines.push({ section: 'other', label: 'INTEREST EXPENSE ON OVER DRAW', amount: -w.interestExpense });
  return lines;
}

// Real printed lines the owner gave for 08/28 (2026-11-13); the split of
// the remaining misc 24.59 and fixed 155.77 was not transcribed and is one
// line each. Every block total is real.
export const LINES_0828: PrintedLine[] = [
  { section: 'revenue', label: 'REVENUE FROM PRIME INC.', amount: 2.33 },
  { section: 'revenue', label: 'DETENTION', amount: 189.0 },
  { section: 'revenue', label: 'TOLL 1099 PAY', amount: 0.07 },
  { section: 'misc', label: 'ADVANCES', amount: -550 },
  { section: 'misc', label: 'QUALCOMM COST', amount: -24.59 },
  { section: 'fixed', label: 'PHYSICAL DAMAGE INSURANCE', amount: -155.77 },
  { section: 'fixed', label: 'LICENSE AND PERMITS', amount: 225.0 },
  { section: 'fixed', label: 'FEDERAL HWY TAX', amount: 200.0 },
  { section: 'other', label: 'ACCRUAL PERFORMANCE BOND', amount: -100 },
  { section: 'other', label: 'INTEREST INCOME FROM DEPOSIT', amount: 0.45 },
];

export function printedFromWeek(w: GoldenWeek, opts: { lines?: PrintedLine[]; statementOverride?: (rows: ReadStatementRow[]) => ReadStatementRow[] } = {}): ContentReading {
  const lines = opts.lines ?? classLines(w);
  const summary: ReadSummaryRow[] = [
    { page: 1, label: 'TOTAL REV', amount: printed(w.revenue) },
    { page: 2, label: 'TOTAL REIMBURSED', amount: printed(w.reimbursed) },
    { page: 2, label: 'TOTAL DEDUCTIONS FROM TRUCK', amount: printed(w.deductions) },
    { page: 4, label: 'NET AMOUNT DUE UNIT', amount: printed(w.netDue) },
  ];
  if (w.balanceForward !== 0) summary.push({ page: 4, label: 'OWNER BALANCE FORWARD', amount: printed(Math.abs(w.balanceForward)) });
  if (w.interestIncome !== 0) summary.push({ page: 4, label: 'INTEREST ON DEPOSIT', amount: printed(w.interestIncome) });
  summary.push({ page: 4, label: 'SETTLEMENT GROSS DUE TO/FROM OWNER', amount: printed(w.grossDue) });
  if (w.deposited > 0) summary.push({ page: 4, label: PAYOUT_LABEL[w.payout] ?? 'DIRECT DEPOSIT', amount: printed(w.deposited) });
  if (w.owedToCarrier > 0) summary.push({ page: 3, label: 'DUE TO CARRIER', amount: printed(w.owedToCarrier) });
  const freight = lines.find((l) => l.label === 'REVENUE FROM PRIME INC.')?.amount ?? 0;
  let rows = statementRows({
    lines,
    totals: { revenue: w.revenue, fixed: w.fixedTotal !== 0 ? -w.fixedTotal : undefined },
    miles: w.miles,
    ytdRevenue: w.ytdRevenue,
    cashFlow: w.cashFlowPrinted,
    balanceForward: w.balanceForward,
    settlementToOperator: w.deposited > 0 ? w.deposited : null,
    ytdPaid: w.ytdPaid,
    bondHeld: w.bondHeld,
  });
  if (opts.statementOverride) rows = opts.statementOverride(rows);
  const iso = w.weekEnding;
  return {
    docType: 'settlement',
    carrier: 'PRIME INC.',
    unit: '283940',
    driverName: '',
    settlementDateRaw: yymmdd(iso),
    printDateRaw: printDateOf(iso),
    settlementLines: [],
    summary,
    loads: w.miles > 0 ? [{ page: 1, order: '4700001', origin: '', destination: '', loadedMiles: printed(w.loadedMiles), emptyMiles: printed(w.emptyMiles), revenue: printed(freight) }] : [],
    milesLines: [
      { label: 'LOADED MILES', miles: String(w.loadedMiles) },
      { label: 'EMPTY MILES', miles: String(w.emptyMiles) },
      { label: 'TOTAL MILES', miles: String(w.miles) },
    ],
    fuelPurchases: [],
    accounts: [{ page: 3, account: 'PERF BOND', priorBalance: printed(r2(w.bondHeld - w.bond)), thisWeek: printed(w.bond), balance: printed(w.bondHeld), ratePct: '3.83%' }],
    statement: { printed: true, weekEndingRaw: yymmdd(iso), rows },
  };
}

// ---- an older golden fixture printed back into the reader's shape --------

const SUMMARY_FROM: [keyof NonNullable<Extraction['settlement']>, string][] = [
  ['grossRevenue', 'TOTAL REV'],
  ['reimbursements', 'TOTAL REIMBURSED'],
  ['totalDeductions', 'TOTAL DEDUCTIONS FROM TRUCK'],
  ['netPay', 'NET AMOUNT DUE UNIT'],
];

export function printedFromExtraction(e: Extraction, opts: { cashFlow: boolean; pageOf?: (s: Section) => number }): ContentReading {
  const s = e.settlement!;
  const op = s.operating!;
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const summary: ReadSummaryRow[] = SUMMARY_FROM.filter(([k]) => num(s[k]) != null).map(([k, label]) => ({ page: 2, label, amount: printed(num(s[k])) }));
  if (num(s.depositAmount) != null) summary.push({ page: 3, label: s.totalLabels?.depositAmount ?? 'DIRECT DEPOSIT', amount: printed(num(s.depositAmount)) });
  const settlementLines: ReadSettlementLine[] = [
    ...(s.revenueItems ?? []).map((r) => ({ page: 1, section: 'revenue' as const, code: (r as { code?: string }).code ?? '', description: r.desc ?? '', reference: r.order ?? '', amount: printed(r.amount), direction: (r.amount ?? 0) < 0 ? ('charge' as const) : ('credit' as const) })),
    ...(s.reimbursementItems ?? []).map((r) => ({ page: 1, section: 'reimbursement' as const, code: r.code ?? '', description: r.desc ?? '', reference: r.ref ?? '', amount: printed(r.amount), direction: 'credit' as const })),
    ...(s.deductions ?? []).map((d) => ({ page: 2, section: 'deduction' as const, code: d.code ?? '', description: d.desc ?? '', reference: '', amount: printed(Number(d.amount)), direction: Number(d.amount) < 0 ? ('credit' as const) : ('charge' as const) })),
  ];
  const lines = (op.lines ?? []).map((l) => ({ section: l.section as Section, label: l.label!, amount: Number(l.amount) }));
  const t = (v: unknown) => num(v);
  const rows = statementRows({
    lines,
    totals: {
      revenue: t(op.weekTotalRevenue),
      fuel_oil_tax: t(op.weekTotalFuelOilTax),
      repair: t(op.weekTotalRepair),
      tires: t(op.weekTotalTires),
      misc: t(op.weekTotalMiscellaneous),
      out_of_pocket: t(op.weekTotalOutOfPocket),
      fixed: t(op.weekTotalFixedCost),
      other: t(op.weekTotalOtherIncomeAndExpense),
    },
    miles: num(op.weekMiles),
    ytdRevenue: num(op.ytdTotalRevenue),
    cashFlow: opts.cashFlow,
    balanceForward: num(op.priorWeekBalanceForward),
    settlementToOperator: num(op.settlementToOperator),
    ytdPaid: num(op.ytdSettlementToOperator),
    bondHeld: num(op.perfBondEmergencyFundYtd),
    pageOf: opts.pageOf,
  });
  return {
    docType: 'settlement',
    carrier: s.carrier ?? '',
    unit: s.unit ?? '',
    driverName: '',
    settlementDateRaw: s.settlementDateRaw ?? '',
    printDateRaw: s.printDateRaw ?? '',
    settlementLines,
    summary,
    loads: (s.loads ?? []).map((l) => ({ page: 1, order: l.order ?? '', origin: '', destination: '', loadedMiles: String(l.loadedMiles ?? ''), emptyMiles: String(l.emptyMiles ?? ''), revenue: printed(l.revenue) })),
    milesLines: [],
    fuelPurchases: [],
    accounts:
      num(op.escrowBalance) != null
        ? [{ page: 3, account: 'PERF BOND', priorBalance: printed(num(op.escrowPriorBalance)), thisWeek: printed(num(op.escrowThisWeek)), balance: printed(num(op.escrowBalance)), ratePct: '' }]
        : [],
    statement: { printed: true, weekEndingRaw: s.statementWeekEndingRaw ?? s.settlementDateRaw ?? '', rows },
  };
}
