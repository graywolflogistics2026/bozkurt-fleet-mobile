// THE KNOWN PRIME TEMPLATE (owner decision 2026-11-03,
// docs/decisions/prime-statement-template.md). Prime's Statement of Income
// and Expense prints the same labels in the same blocks every week (a line
// is left out when its WEEKS TOTAL is blank). For a block whose read lines
// do not add up to its PRINTED total, this lists which template labels were
// expected but not read and which were read twice, and which statement
// pages to read again. PRIME-ONLY (carrier isolation): never applied to any
// other carrier's statement.
import { labeledStatementTotals } from './statementTotalLabels';
import { normalizeStatementLabel, statementInfoRow, type StatementSection } from './primeStatementLines';
import { parseAmount } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import type { Extraction } from './types';

// Template order = print order on the page.
export const PRIME_TEMPLATE: { section: StatementSection; name: string; total: string; labels: string[] }[] = [
  {
    section: 'revenue',
    name: 'REVENUE',
    total: 'TOTAL REVENUE',
    labels: ['REVENUE FROM PRIME INC', 'EXTRA PAY', 'PICKUP STOP OFF PAY', 'FUEL SURCG BILL', 'REEF FUEL SURCG', 'SAFETY INC', 'SERVICE INC', 'OUTSIDE LUMPER 1099 PAY', 'TOLL 1099 PAY'],
  },
  {
    section: 'fuel_oil_tax',
    name: 'FUEL',
    total: 'TOTAL FUEL,OIL,TAX',
    labels: ['TRACTOR FUEL', 'TRACTOR FUEL DISCOUNT', 'TRACTOR DEF', 'REEFER FUEL', 'REEFER FUEL DISCOUNT', 'DEF DISCOUNT', 'STATE FUEL TAX'],
  },
  { section: 'repair', name: 'REPAIR', total: 'TOTAL EQUIPMENT REPAIR AND MAINT.', labels: ['UNIT REPAIR EXPENSE', 'RO PARTS REPAIR'] },
  { section: 'tires', name: 'TIRES', total: 'TOTAL TIRES', labels: ['TIRES'] },
  {
    section: 'misc',
    name: 'MISCELLANEOUS',
    total: 'TOTAL MISCELLANEOUS',
    labels: [
      'TOLLS',
      'LUMPERS',
      'OT LOAD UNLOAD ADVANCE',
      'ADVANCES',
      'WEIGHT TICKETS',
      'QUALCOMM COST',
      'WIRE CHARGE',
      'TRIP XPRESS CHG',
      'TRAILER WASH',
      'COMPANY STORE',
      'PRIME POINT OF SALE',
      'PREPASS WEIGH STATION',
      'OPERATOR TRK EXTRAS',
      'PERSONAL PYMNT RCV',
      'MISCELLANEOUS',
    ],
  },
  { section: 'out_of_pocket', name: 'OUT OF POCKET', total: 'TOTAL OUT OF POCKET COSTS', labels: ['OUT OF POCKET COSTS'] },
  {
    section: 'fixed',
    name: 'FIXED COST',
    total: 'TOTAL FIXED COST',
    labels: ['PHYSICAL DAMAGE INSURANCE', 'BT DH INSURANCE', 'LICENSE AND PERMITS', 'STATEMENT PREPARATION', 'OPERATOR OCCUP ACC', 'FEDERAL HWY TAX'],
  },
  {
    section: 'other',
    name: 'OTHER INCOME AND EXPENSE',
    total: 'TOTAL OTHER INCOME AND EXPENSE',
    labels: ['ACCRUAL PERFORMANCE BOND', 'INTEREST INCOME FROM DEPOSIT', 'INTEREST EXPENSE ON OVER DRAW', 'START UP EXCESS MILEAGE COST'],
  },
];

const VARIABLE: StatementSection[] = ['fuel_oil_tax', 'repair', 'tires', 'misc'];
const SECTION_FIELD: Record<StatementSection, string> = {
  revenue: 'weekTotalRevenue',
  fuel_oil_tax: 'weekTotalFuelOilTax',
  repair: 'weekTotalRepair',
  tires: 'weekTotalTires',
  misc: 'weekTotalMiscellaneous',
  out_of_pocket: 'weekTotalOutOfPocket',
  fixed: 'weekTotalFixedCost',
  other: 'weekTotalOtherIncomeAndExpense',
};

export type BlockDiagnosis = {
  section: StatementSection;
  name: string;
  // The printed block total (null: the TOTAL line was not read either).
  printed: number | null;
  // What the read lines add up to.
  read: number;
  // printed − read; for a whole missing variable block, its share of the
  // TOTAL VARIABLE COSTS gap.
  difference: number;
  // Neither a line nor the TOTAL line of this block was read.
  wholeBlockMissing: boolean;
  // Template labels not read this week (labels this account printed
  // before come first when the history is known).
  missing: string[];
  // Labels read more than once.
  readTwice: string[];
  // Statement pages to read again for this block.
  pages: number[];
};

type RawLine = { section?: unknown; label?: unknown; amount?: unknown; page?: unknown };
const r2 = (n: number) => Math.round(n * 100) / 100;

// Every Prime block that does not add up, with the labels that explain it.
// `priorLabelsSeen` = normalized labels already printed on this account's
// earlier statements (narrows "missing" to what this truck usually prints).
export function diagnosePrimeBlocks(extraction: Extraction | null | undefined, priorLabelsSeen: Set<string> = new Set()): BlockDiagnosis[] {
  const s = extraction?.settlement;
  if (!s || !isPrimeCarrier(s.carrier) || !s.operating) return [];
  const raw: RawLine[] = Array.isArray(s.operating.lines) ? (s.operating.lines as RawLine[]) : [];
  const lines = raw
    .map((l) => ({ section: String(l.section ?? ''), label: normalizeStatementLabel(String(l.label ?? '')), amount: parseAmount(l.amount), page: Number.isInteger(l.page) ? (l.page as number) : null }))
    .filter((l) => l.label && Number.isFinite(l.amount) && !/^TOTAL\b/.test(l.label) && statementInfoRow(l.label) == null);
  const totals = labeledStatementTotals(s.operating, []).values as Record<string, number | null>;
  const pagesOf = (section: StatementSection) => [...new Set(lines.filter((l) => l.section === section && l.page != null).map((l) => l.page as number))];
  const statementPages = [...new Set(lines.filter((l) => l.page != null).map((l) => l.page as number))].sort((a, b) => a - b);

  const out: BlockDiagnosis[] = [];
  const variableGap = (() => {
    const tvc = totals.weekTotalVariableCosts;
    if (tvc == null) return null;
    const sum = VARIABLE.reduce((acc, sec) => acc + (totals[SECTION_FIELD[sec]] ?? lines.filter((l) => l.section === sec).reduce((a, l) => a + l.amount, 0)), 0);
    return r2(tvc - sum);
  })();

  // Variable blocks of which nothing was read. With a TOTAL VARIABLE COSTS
  // gap, the gap is in one (or several) of them: reported once, naming
  // every candidate ("REPAIR or TIRES"), the ones this account printed
  // before first.
  const emptyVariable = PRIME_TEMPLATE.filter(
    (b) => VARIABLE.includes(b.section) && totals[SECTION_FIELD[b.section]] == null && !lines.some((l) => l.section === b.section)
  ).sort((a, b) => Number(b.labels.some((l) => priorLabelsSeen.has(l))) - Number(a.labels.some((l) => priorLabelsSeen.has(l))));
  const gapOpen = variableGap != null && Math.abs(variableGap) >= 0.005 && emptyVariable.length > 0;

  PRIME_TEMPLATE.forEach((block, index) => {
    const blockLines = lines.filter((l) => l.section === block.section);
    const read = r2(blockLines.reduce((a, l) => a + l.amount, 0));
    const printed = totals[SECTION_FIELD[block.section]] ?? null;
    const wholeBlockMissing = blockLines.length === 0 && printed == null;
    let difference: number | null = printed != null ? r2(printed - read) : null;
    let name = block.name;
    let templateLabels = block.labels;
    if (wholeBlockMissing && gapOpen && emptyVariable[0] === block) {
      difference = variableGap;
      name = emptyVariable.map((b) => b.name).join(' or ');
      templateLabels = emptyVariable.flatMap((b) => b.labels);
    }
    if (difference == null || Math.abs(difference) < 0.005) return;
    const readLabels = blockLines.map((l) => l.label);
    const notRead = templateLabels.filter((label) => !readLabels.includes(label));
    const usual = notRead.filter((label) => priorLabelsSeen.has(label));
    const missing = usual.length > 0 ? [...usual, ...notRead.filter((l) => !usual.includes(l))] : notRead;
    const readTwice = [...new Set(readLabels.filter((label, i) => readLabels.indexOf(label) !== i))];
    let pages = pagesOf(block.section);
    if (pages.length === 0) {
      // Nothing of the block was read: the pages of the blocks around it.
      const before = PRIME_TEMPLATE.slice(0, index).reverse().map((b) => pagesOf(b.section)).find((p) => p.length > 0) ?? [];
      const after = PRIME_TEMPLATE.slice(index + 1).map((b) => pagesOf(b.section)).find((p) => p.length > 0) ?? [];
      pages = [...new Set([before.length > 0 ? Math.max(...before) : null, after.length > 0 ? Math.min(...after) : null].filter((p): p is number => p != null))];
      if (pages.length === 0) pages = statementPages;
    }
    out.push({ section: block.section, name, printed, read, difference: r2(difference), wholeBlockMissing, missing, readTwice, pages: pages.sort((a, b) => a - b) });
  });
  return out;
}

// "FUEL block: STATE FUEL TAX missing" — for the re-read reason and the
// Send report. English on purpose: it names printed Prime labels.
export function blockDiagnosisLine(d: BlockDiagnosis): string {
  const parts: string[] = [];
  if (d.wholeBlockMissing) parts.push('no line and no TOTAL line read');
  if (d.missing.length > 0) parts.push(`${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? ` (+${d.missing.length - 6})` : ''} missing`);
  if (d.readTwice.length > 0) parts.push(`${d.readTwice.join(', ')} read twice`);
  const amounts = d.printed != null ? `printed ${d.printed.toFixed(2)}, read ${d.read.toFixed(2)}` : `gap ${d.difference.toFixed(2)}`;
  return `${d.name} block (${amounts}): ${parts.join('; ') || 'lines differ'}${d.pages.length > 0 ? ` · page ${d.pages.join(', ')}` : ''}`;
}

// PROFIT FROM TOTALS NEEDS ONLY A FEW LINES (owner decision 2026-11-03):
// profit = TOTAL STATEMENT with these lines taken back out, by label. Each
// is printed with its usual sign (−1 = a charge with a trailing minus,
// +1 = a credit). When one of them may sit unread inside a block that does
// not add up, the review card asks the owner to type it (one field, the
// printed label shown) instead of failing the week.
export const PROFIT_LINES: { section: StatementSection; label: string; printed: string; sign: 1 | -1 }[] = [
  { section: 'misc', label: 'ADVANCES', printed: 'ADVANCES', sign: -1 },
  { section: 'misc', label: 'PRIME POINT OF SALE', printed: 'PRIME POINT-OF-SALE', sign: -1 },
  { section: 'misc', label: 'OPERATOR TRK EXTRAS', printed: 'OPERATOR TRK EXTRAS', sign: -1 },
  { section: 'misc', label: 'PERSONAL PYMNT RCV', printed: 'PERSONAL PYMNT RCV', sign: 1 },
  { section: 'other', label: 'ACCRUAL PERFORMANCE BOND', printed: 'ACCRUAL PERFORMANCE BOND', sign: -1 },
  { section: 'other', label: 'INTEREST INCOME FROM DEPOSIT', printed: 'INTEREST INCOME FROM DEPOSIT', sign: 1 },
];

export type ProfitLineQuestion = (typeof PROFIT_LINES)[number];

// The profit lines to ask for: not read, in a block that does not add up.
export function profitLinesToAsk(extraction: Extraction | null | undefined, priorLabelsSeen: Set<string> = new Set()): ProfitLineQuestion[] {
  const blocks = diagnosePrimeBlocks(extraction, priorLabelsSeen);
  const answered = new Set(extraction?.settlement?.operating?.typedNotPrinted ?? []);
  // Template labels are unique across blocks, so "missing in a block that
  // does not add up" is enough (a whole-block gap names several blocks).
  return PROFIT_LINES.filter((p) => !answered.has(p.label) && blocks.some((b) => b.missing.includes(p.label)));
}

// The owner's typed amounts become statement lines of their block (signed
// as Prime prints them, flagged typed). 0 = "not printed this week": no
// line (never a $0 row), the label is remembered so it is not asked again.
export function withTypedStatementLines(extraction: Extraction, answers: { label: string; amount: number }[]): Extraction {
  const s = extraction.settlement;
  if (!s?.operating) return extraction;
  const typed: { section: string; label: string; amount: number; typed: true }[] = [];
  const notPrinted: string[] = [];
  for (const a of answers) {
    const q = PROFIT_LINES.find((p) => p.label === a.label);
    if (!q || !Number.isFinite(a.amount)) continue;
    const amount = Math.round(q.sign * Math.abs(a.amount) * 100) / 100;
    if (amount === 0) notPrinted.push(q.label);
    else typed.push({ section: q.section, label: q.printed, amount, typed: true });
  }
  if (typed.length === 0 && notPrinted.length === 0) return extraction;
  return {
    ...extraction,
    settlement: {
      ...s,
      operating: {
        ...s.operating,
        lines: [...(s.operating.lines ?? []), ...typed],
        typedNotPrinted: [...(s.operating.typedNotPrinted ?? []), ...notPrinted],
      },
    },
  };
}
