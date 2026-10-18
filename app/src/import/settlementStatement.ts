import type { Extraction } from './types';
import { parseAmount, printedTotal, sumAmounts } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { trySwapYearAndDay } from './dateGuard';
import { splitPrimeLoads } from './primeLoads';
import {
  STATEMENT_SECTIONS,
  classifyStatementLine,
  isStatementSubtotalLabel,
  normalizeStatementLabel,
  statementInfoRow,
  type StatementInfoRow,
  type StatementLine,
  type StatementReviewReason,
  type StatementSection,
} from './primeStatementLines';

// PRIME STATEMENT AS SOURCE + SOURCE LABELS (owner decision 2026-10-13,
// docs/decisions/prime-statement-source.md). What is saved in
// `settlements.statement` (docs/PENDING_SQL.md §77) for every imported
// settlement, so the KPI engine reads typed figures, never parsed_json:
//   - `printed`: the statement's own printed totals (every carrier) — the
//     source of the "Totals match" label;
//   - `prime`: Prime's Statement of Income and Expense, ONLY when that
//     page was actually extracted from a Prime statement (carrier gate) —
//     every line signed as printed, every printed subtotal, the self-check
//     results. The Prime route is used only when `source` is
//     'prime_statement' AND the self-check passed AND the week was not
//     saved past a failing check ("Save anyway, flagged needs-review").

export type PrimeStatementTotals = {
  totalFreightRevenue: number | null;
  totalOtherRevenue: number | null;
  totalRevenue: number | null;
  totalFuelOilTax: number | null;
  totalRepair: number | null;
  totalTires: number | null;
  totalMiscellaneous: number | null;
  totalVariableCosts: number | null;
  totalOutOfPocket: number | null;
  totalFixedCost: number | null;
  totalOtherIncomeAndExpense: number | null;
  totalOperatingExpenses: number | null;
  totalStatement: number | null;
  settlementToOperator: number | null;
  directDeposit: number | null;
  miles: number | null;
  // BALANCE FORWARD (owner decision 2026-10-17), signed as printed: the
  // prior week's balance with Prime, settled out of this week's cash.
  // Optional: statements stored before this pass do not carry it.
  priorWeekBalanceForward?: number | null;
  totalCashFlow?: number | null;
};

export type StatementCheckId =
  | 'revenueLines'
  | 'section_fuel_oil_tax'
  | 'section_repair'
  | 'section_tires'
  | 'section_misc'
  | 'section_out_of_pocket'
  | 'section_fixed'
  | 'section_other'
  | 'variableCosts'
  | 'operatingExpenses'
  | 'statementTotal'
  // TOTAL STATEMENT + PRIOR WEEK BALANCE FORWARD = TOTAL CASH FLOW.
  | 'totalCashFlow'
  | 'settlementToOperator'
  | 'directDeposit'
  | 'grossMatches'
  | 'milesMatch'
  // The statement page's week ending = the settlement's week ending.
  | 'statementWeekEnding'
  | 'requiredTotals'
  // Two pages printed different values for the same statement total
  // (page-by-page reading, chunking.ts mergeConflicts) — never trusted.
  | 'mergeConflict';

// CORE SELF-CHECKS (owner decision 2026-10-13, 17-page stall redesign
// amendment 1): these three can never be skipped. If a number one of them
// needs was not read, the week is NOT statement-backed (Unverified, line
// route, needs-review). Only optional checks (miles, escrow, interest) may
// be skipped when their numbers are missing.
//   grossMatches         TOTAL REVENUE = the settlement's gross
//   operatingExpenses    variable + out of pocket + fixed + other = TOTAL OPERATING EXPENSES
//   settlementToOperator TOTAL REVENUE + TOTAL OPERATING EXPENSES (signed)
//                        + PRIOR WEEK BALANCE FORWARD = SETTLEMENT TO OPERATOR
export const CORE_STATEMENT_CHECKS = ['grossMatches', 'operatingExpenses', 'settlementToOperator'] as const;
export type CoreStatementCheck = (typeof CORE_STATEMENT_CHECKS)[number];

// statementWeekEnding compares dates: expected/actual are then YYYYMMDD
// numbers and expectedText/actualText carry the ISO dates for display.
export type StatementCheck = {
  id: StatementCheckId;
  expected: number;
  actual: number;
  passed: boolean;
  expectedText?: string;
  actualText?: string;
  // mergeConflict: the field two pages read differently.
  path?: string;
};

// THE GATE (owner decision 2026-10-17, item 6). Every check INSIDE the
// statement — each block's lines = its printed total, variable + fixed +
// other = TOTAL OPERATING EXPENSES, revenue − expenses = TOTAL STATEMENT,
// the cash chain to the deposit — plus statement week ending = settlement
// week ending. All must have run and passed. When the gate passes, profit
// comes from the statement, the settlement's gross is TOTAL REVENUE and
// the deposit SETTLEMENT TO OPERATOR; anything else that differs (miles,
// the AI's header gross, a header total two pages read differently, the
// line items) only WARNS: amber + needs-review, Save works.
const WARN_ONLY_CHECKS: StatementCheckId[] = ['milesMatch', 'grossMatches'];
export function isGateCheck(check: Pick<StatementCheck, 'id' | 'path'>): boolean {
  if (check.id === 'mergeConflict') return !check.path || check.path.startsWith('settlement.operating.');
  return !WARN_ONLY_CHECKS.includes(check.id);
}

// Totals the gate needs read; missing -> the gate fails (never skipped).
export type GateMissing = 'totalRevenue' | 'totalOperatingExpenses' | 'totalStatement' | 'settlementToOperator' | 'variableCosts' | 'fixedCost' | 'statementWeekEnding';

export type PrimeStatementCheckResult = {
  lines: StatementLine[];
  totals: PrimeStatementTotals;
  checks: StatementCheck[];
  // Every check that ran passed. A failed check blocks Save (with "Save
  // anyway, flagged needs-review").
  passed: boolean;
  // Core checks that could not run because a number they need was not
  // read. Does not block Save, but the week is not statement-backed.
  coreMissing: CoreStatementCheck[];
  // THE GATE (item 6). Optional: statements stored before 2026-10-17 lack
  // it and keep the old rule (passed + no core missing).
  gatePassed?: boolean;
  gateMissing?: GateMissing[];
  // Failed checks outside the gate — warnings only.
  warnings?: StatementCheck[];
};

export type DepositSource = 'direct_deposit' | 'settlement_to_operator' | 'net_due';

export type PrintedTotals = {
  grossRevenue: number | null;
  reimbursements: number | null;
  reimbursementLines: number;
  totalDeductions: number | null;
  netDue: number | null;
  // BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13): the
  // printed deposit (Prime: DIRECT DEPOSIT TO BANK, else SETTLEMENT TO
  // OPERATOR), else the printed net due (labeled "Net due"). Stored as
  // printed — an amount only, never any bank digits.
  deposit: number | null;
  depositSource: DepositSource | null;
  // Interest the carrier paid this week (Prime's INTEREST INCOME FROM
  // DEPOSIT line), for the deposit check: net due + interest = deposit.
  interestIncome: number;
  // BALANCE FORWARD (owner decision 2026-10-17): Prime's PRIOR WEEK
  // BALANCE FORWARD, signed as printed (negative = the owner owed Prime),
  // and every interest line signed (income +, INTEREST EXPENSE ON OVER
  // DRAW −). Deposit identity: net due + balance forward + interest
  // = deposit. Optional: statements stored before this pass lack them.
  balanceForward?: number;
  interestNet?: number;
};

export type SettlementStatement = {
  version: 1;
  source: 'prime_statement' | 'printed_totals';
  printed: PrintedTotals;
  prime: (PrimeStatementCheckResult & { prReimbursementTotal: number }) | null;
  // Saved past a failing check — profit then comes from the line route
  // and the week is never "Verified".
  savedFlagged: boolean;
  // Why this week was flagged needs-review at import (first appearances
  // of D3/D7 lines, unknown labels, an unmatched personal payment, a core
  // check that could not run, pages that were not read).
  reviewReasons: { reason: StatementReviewReason; label: string }[];
  // RESUMABLE IMPORT JOBS (owner decision 2026-10-13): pages of this
  // week's PDF that were not read. `incomplete` = settlement/statement
  // pages that failed ("line items incomplete"); `unread` = pages kept in
  // the stored PDF without being read (attachments past the cap, delivery
  // receipts, pages past the 40-page cap, attachment pages that failed).
  pages?: StatementPages | null;
};

export type StatementPages = {
  total: number;
  incomplete: { page: number; kind: string; cause?: string }[];
  unread: { page: number; kind: string }[];
};

const DOLLAR_TOLERANCE = 1.0;
const MILES_TOLERANCE = 1;

const SECTION_TOTAL_KEY: Record<StatementSection, Exclude<keyof PrimeStatementTotals, 'priorWeekBalanceForward' | 'totalCashFlow'>> = {
  revenue: 'totalRevenue',
  fuel_oil_tax: 'totalFuelOilTax',
  repair: 'totalRepair',
  tires: 'totalTires',
  misc: 'totalMiscellaneous',
  out_of_pocket: 'totalOutOfPocket',
  fixed: 'totalFixedCost',
  other: 'totalOtherIncomeAndExpense',
};

function asSection(v: unknown): StatementSection | null {
  return typeof v === 'string' && (STATEMENT_SECTIONS as string[]).includes(v) ? (v as StatementSection) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Prime's operating-statement page as read by the AI, self-checked at
// TOTAL level. Null when the carrier is not Prime or no statement lines
// were extracted (carrier gate: a null/unknown carrier never selects it).
export function buildPrimeStatementCheck(extraction: Extraction | null | undefined): PrimeStatementCheckResult | null {
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) return null;
  const s = extraction.settlement;
  if (!isPrimeCarrier(s.carrier)) return null;
  const op = s.operating;
  const rawLines = op?.lines ?? [];
  if (!op || rawLines.length === 0) return null;

  const lines: StatementLine[] = [];
  // Non-dollar rows the AI copied into the line list (MILES, PRIOR WEEK
  // BALANCE FORWARD, ...) never enter a section sum; their value is used
  // only when the dedicated field was not read.
  const infoRows: Partial<Record<StatementInfoRow, number>> = {};
  for (const l of rawLines) {
    const section = asSection(l.section);
    const amount = parseAmount(l.amount);
    const label = (l.label ?? '').trim();
    if (!section || !label || !Number.isFinite(amount) || isStatementSubtotalLabel(label)) continue;
    const info = statementInfoRow(label);
    if (info) {
      if (infoRows[info] == null) infoRows[info] = amount;
      continue;
    }
    lines.push({ section, label, amount });
  }
  if (lines.length === 0) return null;

  // A printed total, signed as printed. 0 is a legitimate printed value
  // for a subtotal only when it was actually printed — the schema default
  // is 0 too, so 0 means "not printed" here (null never fails a check).
  const t = (v: unknown) => printedTotal(v);
  const totals: PrimeStatementTotals = {
    totalFreightRevenue: t(op.weekTotalFreightRevenue),
    totalOtherRevenue: t(op.weekTotalOtherRevenue),
    totalRevenue: t(op.weekTotalRevenue),
    totalFuelOilTax: t(op.weekTotalFuelOilTax),
    totalRepair: t(op.weekTotalRepair),
    totalTires: t(op.weekTotalTires),
    totalMiscellaneous: t(op.weekTotalMiscellaneous),
    totalVariableCosts: t(op.weekTotalVariableCosts),
    totalOutOfPocket: t(op.weekTotalOutOfPocket),
    totalFixedCost: t(op.weekTotalFixedCost),
    totalOtherIncomeAndExpense: t(op.weekTotalOtherIncomeAndExpense),
    totalOperatingExpenses: t(op.weekTotalOperatingExpenses),
    totalStatement: t(op.weekTotalStatement),
    settlementToOperator: t(op.settlementToOperator),
    directDeposit: t(op.directDeposit),
    miles: t(op.weekMiles) ?? printedTotal(infoRows.miles),
    priorWeekBalanceForward: t(op.priorWeekBalanceForward) ?? printedTotal(infoRows.balance_forward),
    totalCashFlow: t(op.weekTotalCashFlow),
  };
  if (totals.settlementToOperator == null) totals.settlementToOperator = printedTotal(infoRows.settlement_to_operator);

  const checks: StatementCheck[] = [];
  const add = (id: StatementCheckId, expected: number | null, actual: number | null, tolerance = DOLLAR_TOLERANCE) => {
    if (expected == null || actual == null) return;
    checks.push({ id, expected: round2(expected), actual: round2(actual), passed: Math.abs(expected - actual) <= tolerance });
  };
  const sectionSum = (section: StatementSection) => lines.filter((l) => l.section === section).reduce((sum, l) => sum + l.amount, 0);
  const hasLines = (section: StatementSection) => lines.some((l) => l.section === section);
  // A block's value for the chain checks: its printed total, else the sum
  // of its lines, else 0 when the block printed nothing at all.
  const block = (section: StatementSection) => totals[SECTION_TOTAL_KEY[section]] ?? (hasLines(section) ? sectionSum(section) : 0);

  add('revenueLines', totals.totalRevenue, hasLines('revenue') ? sectionSum('revenue') : null);
  for (const section of STATEMENT_SECTIONS.filter((x) => x !== 'revenue')) {
    add(`section_${section}` as StatementCheckId, totals[SECTION_TOTAL_KEY[section]], hasLines(section) ? sectionSum(section) : null);
  }
  const variable = block('fuel_oil_tax') + block('repair') + block('tires') + block('misc');
  add('variableCosts', totals.totalVariableCosts, variable);
  add(
    'operatingExpenses',
    totals.totalOperatingExpenses,
    (totals.totalVariableCosts ?? variable) + block('out_of_pocket') + block('fixed') + block('other')
  );
  if (totals.totalRevenue != null && totals.totalOperatingExpenses != null) {
    add('statementTotal', totals.totalStatement, totals.totalRevenue + totals.totalOperatingExpenses);
  }
  const revenuePlusExpenses =
    totals.totalRevenue != null && totals.totalOperatingExpenses != null ? totals.totalRevenue + totals.totalOperatingExpenses : null;
  // BALANCE FORWARD (owner decision 2026-10-17): the cash chain is
  // TOTAL STATEMENT + PRIOR WEEK BALANCE FORWARD = TOTAL CASH FLOW =
  // SETTLEMENT TO OPERATOR = DIRECT DEPOSIT. No balance forward printed
  // -> 0, the chain is the old one.
  const statementTotal = totals.totalStatement ?? revenuePlusExpenses;
  const cashFlow = statementTotal != null ? statementTotal + (totals.priorWeekBalanceForward ?? 0) : null;
  add('totalCashFlow', totals.totalCashFlow ?? null, cashFlow);
  add('settlementToOperator', totals.settlementToOperator, totals.totalCashFlow ?? cashFlow);
  add('directDeposit', totals.directDeposit, totals.settlementToOperator ?? totals.totalCashFlow ?? cashFlow);
  add('grossMatches', totals.totalRevenue, printedTotal(s.grossRevenue));
  add('milesMatch', totals.miles, printedTotal(s.totalMiles), MILES_TOLERANCE);
  const weekCheck = statementWeekEndingCheck(op.weekEnding, s.weekEnding);
  if (weekCheck) checks.push(weekCheck);

  for (const conflict of coreMergeConflicts(extraction)) {
    checks.push({ id: 'mergeConflict', expected: round2(conflict.values[0]), actual: round2(conflict.values[1]), passed: false, path: conflict.path });
  }

  // A missing core number no longer blocks Save (it used to, as
  // 'requiredTotals'): the week is saved on the line route, Unverified and
  // needs-review (amendment 1).
  const coreMissing = primeCoreMissing(totals, lines, printedTotal(s.grossRevenue));
  const gateMissing = primeGateMissing(totals, lines, weekCheck != null);
  const gatePassed = gateMissing.length === 0 && checks.filter(isGateCheck).every((c) => c.passed);
  const warnings = checks.filter((c) => !isGateCheck(c) && !c.passed);
  return { lines, totals, checks, passed: checks.every((c) => c.passed), coreMissing, gatePassed, gateMissing, warnings };
}

export function primeGateMissing(totals: PrimeStatementTotals, lines: StatementLine[], weekEndingRead: boolean): GateMissing[] {
  const has = (section: StatementSection) => lines.some((l) => l.section === section);
  const missing: GateMissing[] = [];
  if (totals.totalRevenue == null) missing.push('totalRevenue');
  if (totals.totalOperatingExpenses == null) missing.push('totalOperatingExpenses');
  if (totals.totalStatement == null) missing.push('totalStatement');
  if (totals.settlementToOperator == null) missing.push('settlementToOperator');
  if (totals.totalVariableCosts == null && !(['fuel_oil_tax', 'repair', 'tires', 'misc'] as StatementSection[]).some(has)) missing.push('variableCosts');
  if (totals.totalFixedCost == null && !has('fixed')) missing.push('fixedCost');
  if (!weekEndingRead) missing.push('statementWeekEnding');
  return missing;
}

// The statement page's week ending must be the settlement's (owner
// decision 2026-10-17). Its header prints YY/MM/DD ("26/08/14"); a reading
// with the year and day swapped (2014-08-26) is the same date read the
// wrong way round and passes only when the swap lands exactly on the
// settlement's week ending (dateGuard.ts trySwapYearAndDay). Skipped when
// either date was not read.
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export function statementWeekEndingCheck(statementWeekEnding: unknown, settlementWeekEnding: unknown): StatementCheck | null {
  const a = typeof statementWeekEnding === 'string' ? statementWeekEnding.trim() : '';
  const b = typeof settlementWeekEnding === 'string' ? settlementWeekEnding.trim() : '';
  if (!ISO_RE.test(a) || !ISO_RE.test(b)) return null;
  const passed = a === b || trySwapYearAndDay(a) === b;
  const asNumber = (iso: string) => Number(iso.replace(/-/g, ''));
  return { id: 'statementWeekEnding', expected: asNumber(a), actual: asNumber(b), passed, expectedText: a, actualText: b };
}

// The core checks (CORE_STATEMENT_CHECKS) that cannot run because a number
// they need was not read. A block (variable, fixed) counts as read when its
// printed total or any of its lines was read.
export function primeCoreMissing(totals: PrimeStatementTotals, lines: StatementLine[], gross: number | null): CoreStatementCheck[] {
  const has = (section: StatementSection) => lines.some((l) => l.section === section);
  const variableRead = totals.totalVariableCosts != null || (['fuel_oil_tax', 'repair', 'tires', 'misc'] as StatementSection[]).some(has);
  const fixedRead = totals.totalFixedCost != null || has('fixed');
  const missing: CoreStatementCheck[] = [];
  if (totals.totalRevenue == null || gross == null) missing.push('grossMatches');
  if (totals.totalOperatingExpenses == null || !variableRead || !fixedRead) missing.push('operatingExpenses');
  if (totals.settlementToOperator == null || totals.totalRevenue == null || totals.totalOperatingExpenses == null) missing.push('settlementToOperator');
  return missing;
}

// Statement totals two pages read differently (chunking.ts mergeConflicts).
const CORE_CONFLICT_PATH = /^settlement\.(grossRevenue|netPay|totalDeductions|depositAmount|reimbursements|operating\.(week[A-Za-z]+|settlementToOperator|directDeposit))$/;
function coreMergeConflicts(extraction: Extraction): { path: string; values: number[] }[] {
  const raw = extraction.mergeConflicts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => typeof c?.path === 'string' && Array.isArray(c.values) && c.values.length >= 2 && CORE_CONFLICT_PATH.test(c.path));
}

// Prime's PR (personal payment) reimbursement lines — the R1 offset limit.
export function prReimbursementTotal(extraction: Extraction): number {
  const items = extraction.settlement?.reimbursementItems ?? [];
  return sumAmounts(
    items.filter((r) => (r.code ?? '').trim().toUpperCase() === 'PR' || (r.ref ?? '').trim().toUpperCase() === 'PR'),
    (r) => r.amount
  );
}

// The printed deposit, in the approved order: the deposit line itself,
// else Prime's SETTLEMENT TO OPERATOR, else the printed net due.
export function printedDepositOf(extraction: Extraction): { deposit: number | null; depositSource: DepositSource | null } {
  const s = extraction.settlement ?? {};
  const prime = isPrimeCarrier(s.carrier);
  const direct = printedTotal(s.depositAmount) ?? (prime ? printedTotal(s.operating?.directDeposit) : null);
  if (direct != null) return { deposit: direct, depositSource: 'direct_deposit' };
  const toOperator = prime ? printedTotal(s.operating?.settlementToOperator) : null;
  if (toOperator != null) return { deposit: toOperator, depositSource: 'settlement_to_operator' };
  const netDue = printedTotal(s.netPay);
  return netDue != null ? { deposit: netDue, depositSource: 'net_due' } : { deposit: null, depositSource: null };
}

// Interest income printed on a Prime statement page (0 for any other
// carrier, or when no such line is printed).
export function printedInterestIncomeOf(extraction: Extraction): number {
  const s = extraction.settlement;
  if (!s || !isPrimeCarrier(s.carrier)) return 0;
  return round2(
    (s.operating?.lines ?? [])
      .filter((l) => {
        if (asSection(l.section) == null || !l.label) return false;
        const { treatment } = classifyStatementLine({ section: asSection(l.section)!, label: l.label });
        return treatment.kind === 'exclude' && treatment.reason === 'interest_income';
      })
      .reduce((sum, l) => sum + (Number.isFinite(parseAmount(l.amount)) ? parseAmount(l.amount) : 0), 0)
  );
}

// Prime's PRIOR WEEK BALANCE FORWARD, signed as printed (0 for any other
// carrier, or when none is printed).
export function printedBalanceForwardOf(extraction: Extraction): number {
  const s = extraction.settlement;
  if (!s || !isPrimeCarrier(s.carrier)) return 0;
  const direct = printedTotal(s.operating?.priorWeekBalanceForward);
  if (direct != null) return round2(direct);
  const row = (s.operating?.lines ?? []).find((l) => !!l.label && statementInfoRow(l.label) === 'balance_forward');
  const fromRow = row ? parseAmount(row.amount) : NaN;
  return Number.isFinite(fromRow) ? round2(fromRow) : 0;
}

// Every interest line on a Prime statement page, signed as printed:
// INTEREST INCOME FROM DEPOSIT (+) and INTEREST EXPENSE ON OVER DRAW (−).
export function printedInterestNetOf(extraction: Extraction): number {
  const s = extraction.settlement;
  if (!s || !isPrimeCarrier(s.carrier)) return 0;
  return round2(
    (s.operating?.lines ?? [])
      .filter((l) => asSection(l.section) != null && /^INTEREST (INCOME|EXPENSE)\b/.test(normalizeStatementLabel(l.label ?? '')))
      .reduce((sum, l) => sum + (Number.isFinite(parseAmount(l.amount)) ? parseAmount(l.amount) : 0), 0)
  );
}

export function printedTotalsOf(extraction: Extraction): PrintedTotals {
  const s = extraction.settlement ?? {};
  return {
    grossRevenue: printedTotal(s.grossRevenue),
    reimbursements: printedTotal(s.reimbursements),
    reimbursementLines: round2(sumAmounts(s.reimbursementItems, (r) => r.amount)),
    totalDeductions: printedTotal(s.totalDeductions),
    netDue: printedTotal(s.netPay),
    ...printedDepositOf(extraction),
    interestIncome: printedInterestIncomeOf(extraction),
    balanceForward: printedBalanceForwardOf(extraction),
    interestNet: printedInterestNetOf(extraction),
  };
}

// ---------------------------------------------------------------------
// DEPOSITED (owner decision 2026-10-13) — read per week, never computed,
// never a running balance. A week where the owner owes the carrier
// (negative) adds 0 to "Deposited" and shows "Owed to carrier".
// ---------------------------------------------------------------------
export type WeekDeposit = { deposited: number; owedToCarrier: number; source: DepositSource | 'owed_to_carrier' };

export function settlementDeposit(settlement: { net?: number | null; statement?: SettlementStatement | null }): WeekDeposit {
  const printed = settlement.statement?.printed;
  const amount = printed?.deposit ?? printed?.netDue ?? Number(settlement.net ?? 0);
  const source: DepositSource = printed?.depositSource ?? 'net_due';
  if (amount < 0) return { deposited: 0, owedToCarrier: -amount, source: 'owed_to_carrier' };
  return { deposited: amount, owedToCarrier: 0, source };
}

// Needs-review reasons from a passing statement. D3/D7 lines and unknown
// labels flag only the FIRST time a non-zero amount appears on this
// account (`priorLabelsSeen` = normalized labels already seen on earlier
// statements); an unmatched personal payment (R1) flags every time.
export function statementReviewReasons(
  lines: StatementLine[],
  prTotal: number,
  priorLabelsSeen: Set<string>
): SettlementStatement['reviewReasons'] {
  const reasons: SettlementStatement['reviewReasons'] = [];
  for (const line of lines) {
    if (line.amount === 0) continue;
    const { treatment, unknown } = classifyStatementLine(line);
    const seen = priorLabelsSeen.has(normalizeStatementLabel(line.label));
    if (unknown && !seen) reasons.push({ reason: 'unknown_line', label: line.label });
    else if (treatment.kind === 'expense' && treatment.reviewOnFirst && !seen) reasons.push({ reason: treatment.reviewOnFirst, label: line.label });
    else if (treatment.kind === 'personal_payment' && line.amount - Math.min(Math.max(line.amount, 0), prTotal) > 0.005) {
      reasons.push({ reason: 'personal_payment_unmatched', label: line.label });
    }
  }
  return reasons;
}

// Pages that were not read, from the import job's page map
// (extraction.pageMap, supabase/functions/ai-import/jobEngine.ts).
export function statementPagesOf(extraction: Extraction): StatementPages | null {
  const map = extraction.pageMap;
  if (!Array.isArray(map) || map.length === 0) return null;
  const incomplete = map
    .filter((p) => p.role === 'content' && p.status !== 'read')
    .map((p) => ({ page: p.page, kind: p.kind, ...(p.cause ? { cause: p.cause } : {}) }));
  const unread = map
    .filter((p) => p.role === 'stored' || (p.role === 'attachment' && p.status !== 'read'))
    .map((p) => ({ page: p.page, kind: p.kind }));
  return { total: extraction.pagesTotal ?? map.length, incomplete, unread };
}

export function buildSettlementStatement(
  extraction: Extraction,
  options: {
    savedFlagged: boolean;
    priorLabelsSeen: Set<string>;
    // Item 6: how far the line details are from the statement (largest
    // line-item or per-group difference), when the gate passed and they
    // differ — saved as a needs-review reason, never blocking.
    lineDetailsDifference?: number | null;
  }
): SettlementStatement {
  const prime = buildPrimeStatementCheck(extraction);
  const prTotal = prReimbursementTotal(extraction);
  const pages = statementPagesOf(extraction);
  const gatePassed = !!prime?.gatePassed;
  const reviewReasons: SettlementStatement['reviewReasons'] = gatePassed ? statementReviewReasons(prime!.lines, prTotal, options.priorLabelsSeen) : [];
  if (prime && !gatePassed && (prime.gateMissing?.length ?? 0) > 0) {
    reviewReasons.push({ reason: 'statement_core_missing', label: prime.gateMissing!.join(', ') });
  }
  if (gatePassed && (prime!.warnings?.length ?? 0) > 0) {
    reviewReasons.push({ reason: 'statement_warning', label: prime!.warnings!.map((w) => w.id).join(', ') });
  }
  if (gatePassed && options.lineDetailsDifference != null && Math.abs(options.lineDetailsDifference) > 0.005) {
    reviewReasons.push({ reason: 'line_details_differ', label: round2(options.lineDetailsDifference).toFixed(2) });
  }
  if (pages && pages.incomplete.length > 0) reviewReasons.push({ reason: 'line_items_incomplete', label: pages.incomplete.map((p) => p.page).join(', ') });
  const loads = splitPrimeLoads(extraction);
  if (loads && loads.matches !== true && (loads.matches === false || gatePassed) && loads.loads.length > 0) {
    reviewReasons.push({
      reason: 'loads_revenue_mismatch',
      label: `${round2(loads.loadRevenue + loads.adjustmentTotal)} vs REVENUE FROM PRIME INC. ${loads.statementRevenue ?? '—'}`,
    });
  }
  // Item 6 (b): with the gate passed, the week's gross is TOTAL REVENUE
  // and the deposit SETTLEMENT TO OPERATOR — never the AI's header fields.
  // Net due stays the printed page-3 figure.
  const printed = printedTotalsOf(extraction);
  if (gatePassed && prime) {
    if (prime.totals.totalRevenue != null) printed.grossRevenue = prime.totals.totalRevenue;
    if (prime.totals.settlementToOperator != null) {
      printed.deposit = prime.totals.settlementToOperator;
      printed.depositSource = 'settlement_to_operator';
    }
  }
  return {
    version: 1,
    source: prime ? 'prime_statement' : 'printed_totals',
    printed,
    prime: prime ? { ...prime, prReimbursementTotal: round2(prTotal) } : null,
    savedFlagged: options.savedFlagged,
    reviewReasons,
    pages,
  };
}

// Settlement or statement pages of this week were not read.
export function lineItemsIncomplete(statement: SettlementStatement | null | undefined): boolean {
  return (statement?.pages?.incomplete?.length ?? 0) > 0;
}

// Normalized labels with a non-zero amount on a stored statement — the
// "already seen" set for first-appearance review flags.
export function labelsSeenOn(statement: SettlementStatement | null | undefined): string[] {
  return (statement?.prime?.lines ?? []).filter((l) => l.amount !== 0).map((l) => normalizeStatementLabel(l.label));
}

// ---------------------------------------------------------------------
// SOURCE LABELS (Part 2) — one verification state per settlement week.
// ---------------------------------------------------------------------
export type SettlementVerification = 'verified_prime' | 'totals_match' | 'unverified';

// The Prime route: a Prime statement page was extracted, its self-check
// passed, and the week was not saved past a failing check.
export function isStatementBacked(statement: SettlementStatement | null | undefined): boolean {
  if (!statement || statement.source !== 'prime_statement' || !statement.prime || statement.savedFlagged) return false;
  // THE GATE (item 6), when the stored statement carries it.
  if (statement.prime.gatePassed != null) return statement.prime.gatePassed;
  if (!statement.prime.passed) return false;
  // Core checks can never be skipped (amendment 1). Statements saved before
  // coreMissing existed are re-derived from their stored totals.
  const coreMissing =
    statement.prime.coreMissing ?? primeCoreMissing(statement.prime.totals, statement.prime.lines, statement.printed?.grossRevenue ?? null);
  return coreMissing.length === 0;
}

// "Totals match": gross, total deductions and net due printed, and
// gross + reimbursements − deductions = net due within $1. Reimbursements
// are the printed total, else the reimbursement lines (0 when none).
export function printedTotalsMatch(printed: PrintedTotals | null | undefined): boolean {
  if (!printed || printed.grossRevenue == null || printed.totalDeductions == null || printed.netDue == null) return false;
  const reimbursements = printed.reimbursements ?? printed.reimbursementLines ?? 0;
  return Math.abs(printed.grossRevenue + reimbursements - printed.totalDeductions - printed.netDue) <= DOLLAR_TOLERANCE;
}

export function settlementVerification(settlement: { statement?: SettlementStatement | null }): SettlementVerification {
  const st = settlement.statement;
  if (!st || st.savedFlagged) return 'unverified';
  if (isStatementBacked(st)) return 'verified_prime';
  // A Prime page that was extracted but failed its own check never reads
  // as verified in any form.
  if (st.source === 'prime_statement') return 'unverified';
  return printedTotalsMatch(st.printed) ? 'totals_match' : 'unverified';
}

// Guard-chain step (src/data/aiImportCall.ts): a Prime statement page
// that fails its own self-check downgrades confidence to 'low' (the
// existing needs-review machinery); everything else passes unchanged.
export function applyPrimeOperatingStatementCheck(extraction: Extraction): Extraction {
  const check = buildPrimeStatementCheck(extraction);
  if (!check || (check.gatePassed && (check.warnings?.length ?? 0) === 0)) return extraction;
  return { ...extraction, confidence: 'low' };
}
