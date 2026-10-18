import { MAJOR_REPAIR_ONE_OFF_THRESHOLD } from '@/src/import/category';

// PRIME STATEMENT AS SOURCE (owner decision 2026-10-13,
// docs/decisions/prime-statement-source.md). The approved line table for
// Prime's "Statement of Income and Expense" (WEEKS column). PRIME-ONLY:
// these labels mean something only on a Prime operating statement, and
// the route that reads them is selected only when that page was actually
// extracted (settlements.statement.source = 'prime_statement').
//
// Amounts are stored SIGNED AS PRINTED: a trailing minus ("1,997.82-") is
// an expense, stored negative; a discount or credit prints without one
// and is stored positive. An expense line's contribution to expenses is
// therefore −amount (a discount reduces expenses on its own sign).

export type StatementSection = 'revenue' | 'fuel_oil_tax' | 'repair' | 'tires' | 'misc' | 'out_of_pocket' | 'fixed' | 'other';
export const STATEMENT_SECTIONS: StatementSection[] = ['revenue', 'fuel_oil_tax', 'repair', 'tires', 'misc', 'out_of_pocket', 'fixed', 'other'];

export type StatementLine = { section: StatementSection; label: string; amount: number };

// Why a line is excluded from profit and CPM (never an expense).
export type StatementExcludeReason = 'advance' | 'escrow' | 'meals_per_diem' | 'truck_extras' | 'owner_money_in' | 'interest_income';

// Lines flagged needs-review the first time a non-zero amount appears.
export type StatementReviewReason =
  | 'unknown_line'
  | 'ot_load_unload_advance'
  | 'out_of_pocket_costs'
  | 'start_up_costs'
  | 'personal_payment_unmatched'
  // A core self-check could not run: a number it needs was not read.
  | 'statement_core_missing'
  // Settlement or statement pages of the PDF were not read.
  | 'line_items_incomplete'
  // Σ load owner revenue + adjustments ≠ REVENUE FROM PRIME INC.
  // (primeLoads.ts) — the loads were saved with no revenue.
  | 'loads_revenue_mismatch'
  // Item 6: the statement passed its gate but a check outside it (miles,
  // the AI's header gross, a header total read differently on two pages)
  // or the line details differ — warnings only.
  | 'statement_warning'
  | 'line_details_differ';

export type LineTreatment =
  | { kind: 'revenue' }
  | { kind: 'expense'; category: string; reviewOnFirst?: StatementReviewReason; cpmOneOffAbove?: number }
  | { kind: 'exclude'; reason: StatementExcludeReason }
  // R1: an offset only up to the same settlement's PR reimbursement lines;
  // any remainder is owner money in (excluded, needs-review).
  | { kind: 'personal_payment' };

type Rule = { labels: string[]; treatment: LineTreatment };

const expense = (category: string, extra: Partial<Extract<LineTreatment, { kind: 'expense' }>> = {}): LineTreatment => ({
  kind: 'expense',
  category,
  ...extra,
});

// Labels are matched after normalizeStatementLabel() (upper case, every
// non-letter/digit run collapsed to one space).
const RULES: Rule[] = [
  // ---- revenue (D1: OUTSIDE LUMPER 1099 PAY counts; gross = TOTAL REVENUE)
  {
    labels: [
      'REVENUE FROM PRIME INC',
      'EXTRA PAY',
      'PICKUP STOP OFF PAY',
      'FUEL SURCG BILL',
      'REEF FUEL SURCG',
      'SAFETY INC',
      'SERVICE INC',
      'OUTSIDE LUMPER 1099 PAY',
      'TOLL 1099 PAY',
    ],
    treatment: { kind: 'revenue' },
  },
  // ---- fuel, oil, tax (D2: STATE FUEL TAX -> Fuel & DEF)
  {
    labels: ['TRACTOR FUEL', 'TRACTOR FUEL DISCOUNT', 'TRACTOR DEF', 'REEFER FUEL', 'REEFER FUEL DISCOUNT', 'DEF DISCOUNT', 'STATE FUEL TAX'],
    treatment: expense('Fuel & DEF'),
  },
  // ---- repair (D5: above the existing one-off threshold -> profit yes, CPM no)
  {
    labels: ['UNIT REPAIR EXPENSE', 'RO PARTS REPAIR'],
    treatment: expense('Maintenance & Repairs', { cpmOneOffAbove: MAJOR_REPAIR_ONE_OFF_THRESHOLD }),
  },
  { labels: ['TIRES'], treatment: expense('Tires') },
  // ---- miscellaneous
  { labels: ['TOLLS', 'WEIGHT TICKETS', 'PREPASS WEIGH STATION'], treatment: expense('Tolls & Scales') },
  { labels: ['MISCELLANEOUS'], treatment: expense('Misc') },
  { labels: ['LUMPERS'], treatment: expense('Lumper Fees') },
  // D3
  { labels: ['OT LOAD UNLOAD ADVANCE'], treatment: expense('Lumper Fees', { reviewOnFirst: 'ot_load_unload_advance' }) },
  { labels: ['QUALCOMM COST', 'TRIP XPRESS CHG'], treatment: expense('ELD & Communications') },
  { labels: ['WIRE CHARGE'], treatment: expense('Bank & Merchant Fees') },
  { labels: ['TRAILER WASH'], treatment: expense('Truck Wash & Detailing') },
  { labels: ['COMPANY STORE'], treatment: expense('Truck Supplies & Equipment') },
  { labels: ['ADVANCES'], treatment: { kind: 'exclude', reason: 'advance' } },
  // D4
  { labels: ['PRIME POINT OF SALE'], treatment: { kind: 'exclude', reason: 'meals_per_diem' } },
  // D6: the warranty/extras purchase — tracked in Truck Cost Basis instead.
  { labels: ['OPERATOR TRK EXTRAS'], treatment: { kind: 'exclude', reason: 'truck_extras' } },
  // R1
  { labels: ['PERSONAL PYMNT RCV'], treatment: { kind: 'personal_payment' } },
  // ---- out of pocket (D7)
  { labels: ['OUT OF POCKET COSTS'], treatment: expense('Misc', { reviewOnFirst: 'out_of_pocket_costs' }) },
  // ---- fixed (R2: the whole section is the FIXED bucket)
  { labels: ['PHYSICAL DAMAGE INSURANCE', 'BT DH INSURANCE'], treatment: expense('Insurance—Truck') },
  { labels: ['LICENSE AND PERMITS', 'FEDERAL HWY TAX'], treatment: expense('Permits, Licenses & Road Taxes') },
  { labels: ['STATEMENT PREPARATION'], treatment: expense('Legal & Professional Services') },
  { labels: ['OPERATOR OCCUP ACC'], treatment: expense('Insurance—Health') },
  // ---- other income and expense
  { labels: ['ACCRUAL PERFORMANCE BOND'], treatment: { kind: 'exclude', reason: 'escrow' } },
  // D8 (interest income stays excluded and gets its own bridge line)
  { labels: ['INTEREST INCOME FROM DEPOSIT', 'INTEREST INCOME FROM DEPOST'], treatment: { kind: 'exclude', reason: 'interest_income' } },
  { labels: ['INTEREST EXPENSE ON OVER DRAW'], treatment: expense('Bank & Merchant Fees') },
  // D7
  { labels: ['START UP EXCESS MILEAGE COST', 'START UP AND EXCESS MILEAGE COST'], treatment: expense('Misc', { reviewOnFirst: 'start_up_costs' }) },
];

const RULE_BY_LABEL = new Map<string, LineTreatment>(RULES.flatMap((r) => r.labels.map((l) => [l, r.treatment] as const)));

export function normalizeStatementLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// A label this table has never seen: revenue-section lines stay revenue,
// every other line counts as Misc — both flagged needs-review, never
// silently dropped or guessed into a category.
export function classifyStatementLine(line: Pick<StatementLine, 'section' | 'label'>): { treatment: LineTreatment; unknown: boolean } {
  const known = RULE_BY_LABEL.get(normalizeStatementLabel(line.label));
  if (known) return { treatment: known, unknown: false };
  if (line.section === 'revenue') return { treatment: { kind: 'revenue' }, unknown: true };
  if (line.section === 'out_of_pocket') return { treatment: expense('Misc', { reviewOnFirst: 'out_of_pocket_costs' }), unknown: false };
  return { treatment: expense('Misc'), unknown: true };
}

// A printed subtotal the AI may have copied into the line list — never a line.
export function isStatementSubtotalLabel(label: string): boolean {
  return /^TOTAL\b/.test(normalizeStatementLabel(label));
}

// Rows of the statement page that are NOT dollar lines of any section
// (owner decision 2026-10-17): MILES (3,316.00 sits inside the revenue
// block but is miles, never dollars), WEEKS IN SERVICE, the cash-flow rows
// below TOTAL STATEMENT (PRIOR WEEK BALANCE FORWARD, SETTLEMENT TO
// OPERATOR) and the escrow balance row (PERF BD/EMGCY FD). The AI may copy
// them into the line list; they never enter a section sum.
export type StatementInfoRow = 'miles' | 'balance_forward' | 'settlement_to_operator' | 'weeks_in_service' | 'escrow_balance';

export function statementInfoRow(label: string): StatementInfoRow | null {
  const l = normalizeStatementLabel(label);
  if (/^(WEEK(LY)? )?MILES$/.test(l)) return 'miles';
  if (/\bBALANCE FORWARD\b|\bBAL(ANCE)? F(OR)?WD\b/.test(l)) return 'balance_forward';
  if (/^SETTLEMENT TO OPERATOR$/.test(l)) return 'settlement_to_operator';
  if (/^WEEKS IN SERVICE$/.test(l)) return 'weeks_in_service';
  if (/^PERF (BOND|BD)\b.*\b(EMGCY|EMERGENCY|EMRG) (FD|FUND)$/.test(l)) return 'escrow_balance';
  return null;
}
