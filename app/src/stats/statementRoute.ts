import { classifyStatementLine, type StatementExcludeReason, type StatementSection } from '@/src/import/primeStatementLines';
import { isStatementBacked, type SettlementStatement } from '@/src/import/settlementStatement';

// PRIME STATEMENT AS SOURCE (owner decision 2026-10-13,
// docs/decisions/prime-statement-source.md). For a statement-backed Prime
// week, profit comes from Prime's own self-checked Statement of Income and
// Expense, not from re-adding ~70 extracted settlement lines:
//   gross    = TOTAL REVENUE
//   expenses = − Σ (expense lines, signed as printed) − personal-payment
//              offset (R1)
//   profit   = gross − expenses
//   deposit  = what Prime paid into the bank = TOTAL STATEMENT + PRIOR
//              WEEK BALANCE FORWARD (owner decision 2026-10-17)
//   profit   = deposit − balance forward + every excluded non-expense
//              line added back (advances, bond, meals) − interest income
// The week's settlement-linked rows stay as detail but are never counted
// again (trueProfit.ts splitSettlementLayers()).

// Shared reason vocabulary for every audit-ledger row (statement lines and
// line-route rows alike) — i18n keys `audit.reason.<reason>`.
export type LedgerReason =
  | 'expense'
  | 'discount_credit'
  | 'reimbursement'
  | 'pr_offset'
  | 'duplicate_fuel'
  | 'non_deductible'
  // IMPORT GATE FIX 1.1: the part of a block's PRINTED total its read
  // lines do not explain — counted, so profit ties to the printed totals.
  | 'line_residual'
  | StatementExcludeReason;

export type StatementLedgerEntry = {
  label: string;
  section: StatementSection;
  printed: number;
  status: 'revenue' | 'counted' | 'offset' | 'excluded';
  // Effect on expenses: + for a counted line, − for an offset, 0 otherwise.
  contribution: number;
  category: string | null;
  costType: 'fixed' | 'variable' | null;
  reason: LedgerReason | 'revenue';
  // D5: a repair line above the one-off threshold counts in profit but is
  // left out of CPM.
  cpmOneOff: boolean;
};

export type StatementWeek = {
  settlementId: string;
  truckId: string | null;
  weekEnding: string | null;
  gross: number;
  deposit: number;
  expenses: number;
  ledger: StatementLedgerEntry[];
  // Excluded non-expense lines, as the amount each ADDS BACK from deposit
  // to profit (advances 550.00, bond 100.00, ...). Interest is separate.
  addBacks: { label: string; reason: StatementExcludeReason; amount: number }[];
  interestIncome: number;
  // PRIOR WEEK BALANCE FORWARD, signed as printed (−1,202.92 = last
  // week's deficit, recovered out of this deposit). Never revenue or an
  // expense; the bridge adds −balanceForward back from deposit to profit.
  balanceForward: number;
};

export type StatementSettlement = {
  id?: string;
  truck_id?: string | null;
  week_ending?: string | null;
  statement?: SettlementStatement | null;
};

const RESIDUAL_SECTIONS: Exclude<StatementSection, 'revenue'>[] = ['fuel_oil_tax', 'repair', 'tires', 'misc', 'out_of_pocket', 'fixed', 'other'];
const SECTION_PRINTED_LABEL: Record<(typeof RESIDUAL_SECTIONS)[number], string> = {
  fuel_oil_tax: 'TOTAL FUEL,OIL,TAX',
  repair: 'TOTAL EQUIPMENT REPAIR AND MAINT.',
  tires: 'TOTAL TIRES',
  misc: 'TOTAL MISCELLANEOUS',
  out_of_pocket: 'TOTAL OUT OF POCKET COSTS',
  fixed: 'TOTAL FIXED COST',
  other: 'TOTAL OTHER INCOME AND EXPENSE',
};
const SECTION_TOTALS = {
  fuel_oil_tax: 'totalFuelOilTax',
  repair: 'totalRepair',
  tires: 'totalTires',
  misc: 'totalMiscellaneous',
  out_of_pocket: 'totalOutOfPocket',
  fixed: 'totalFixedCost',
  other: 'totalOtherIncomeAndExpense',
} as const;

export function statementWeekOf(settlement: StatementSettlement): StatementWeek | null {
  const st = settlement.statement;
  if (!settlement.id || !isStatementBacked(st) || !st?.prime) return null;
  const { lines, totals } = st.prime;
  const ledger: StatementLedgerEntry[] = [];
  const addBacks: StatementWeek['addBacks'] = [];
  let interestIncome = 0;
  const balanceForward = totals.priorWeekBalanceForward ?? 0;

  for (const line of lines) {
    const { treatment } = classifyStatementLine(line);
    const base = { label: line.label, section: line.section, printed: line.amount, cpmOneOff: false };
    if (treatment.kind === 'revenue') {
      ledger.push({ ...base, status: 'revenue', contribution: 0, category: null, costType: null, reason: 'revenue' });
    } else if (treatment.kind === 'expense') {
      const contribution = -line.amount;
      ledger.push({
        ...base,
        status: contribution < 0 ? 'offset' : 'counted',
        contribution,
        category: treatment.category,
        // R2: Prime's FIXED section is the fixed bucket; everything else variable.
        costType: line.section === 'fixed' ? 'fixed' : 'variable',
        reason: contribution < 0 ? 'discount_credit' : 'expense',
        cpmOneOff: treatment.cpmOneOffAbove != null && contribution > treatment.cpmOneOffAbove,
      });
    } else if (treatment.kind === 'exclude') {
      ledger.push({ ...base, status: 'excluded', contribution: 0, category: null, costType: null, reason: treatment.reason });
      if (treatment.reason === 'interest_income') interestIncome += line.amount;
      else addBacks.push({ label: line.label, reason: treatment.reason, amount: -line.amount });
    } else {
      // PERSONAL PYMNT RCV (owner decision 2026-11-03, replaces the R1 PR
      // offset): the whole credit is owner money in — excluded from profit,
      // never an expense offset; the expense it paid for stays an expense.
      // Also applies to weeks stored before this rule (their stored
      // prReimbursementTotal is ignored).
      if (line.amount <= 0) {
        ledger.push({ ...base, status: 'counted', contribution: -line.amount, category: 'Bank & Merchant Fees', costType: 'variable', reason: 'expense' });
        continue;
      }
      ledger.push({ ...base, status: 'excluded', contribution: 0, category: null, costType: null, reason: 'owner_money_in' });
      addBacks.push({ label: line.label, reason: 'owner_money_in', amount: -line.amount });
    }
  }

  // IMPORT GATE FIX 1.1 (owner 2026-11-03): summed lines never block, so a
  // block whose read lines differ from its PRINTED total keeps the printed
  // total: the difference is one counted line (profit = the statement's
  // printed figures). Only blocks with a printed total; revenue is TOTAL
  // REVENUE already.
  for (const section of RESIDUAL_SECTIONS) {
    const printedTotal = totals[SECTION_TOTALS[section]];
    if (printedTotal == null) continue;
    const linesSum = lines.filter((l) => l.section === section).reduce((sum, l) => sum + l.amount, 0);
    const residual = Math.round((printedTotal - linesSum) * 100) / 100;
    if (Math.abs(residual) < 0.005) continue;
    ledger.push({
      label: `${SECTION_PRINTED_LABEL[section]} (lines not read)`,
      section,
      printed: residual,
      status: residual > 0 ? 'offset' : 'counted',
      contribution: -residual,
      category: 'Misc',
      costType: section === 'fixed' ? 'fixed' : 'variable',
      reason: 'line_residual',
      cpmOneOff: false,
    });
  }

  // PROFIT FROM TOTALS (owner decision 2026-11-03, week ending 07/24): a
  // block can be missing entirely (no lines, no TOTAL line), so the blocks
  // above do not add up to TOTAL VARIABLE COSTS / TOTAL OPERATING EXPENSES.
  // The printed subtotal wins: the gap is one counted line, so expenses
  // always tie to TOTAL OPERATING EXPENSES and profit = TOTAL STATEMENT
  // with only the excluded lines (advances, bond, PR, interest...) added
  // back by label.
  const blockValue = (section: (typeof RESIDUAL_SECTIONS)[number]) =>
    totals[SECTION_TOTALS[section]] ?? lines.filter((l) => l.section === section).reduce((sum, l) => sum + l.amount, 0);
  const pushGap = (label: string, section: StatementSection, gap: number) => {
    const residual = Math.round(gap * 100) / 100;
    if (Math.abs(residual) < 0.005) return;
    ledger.push({ label, section, printed: residual, status: residual > 0 ? 'offset' : 'counted', contribution: -residual, category: 'Misc', costType: 'variable', reason: 'line_residual', cpmOneOff: false });
  };
  const variableBlocks = (['fuel_oil_tax', 'repair', 'tires', 'misc'] as const).reduce((sum, s) => sum + blockValue(s), 0);
  if (totals.totalVariableCosts != null) pushGap('TOTAL VARIABLE COSTS (lines not read)', 'misc', totals.totalVariableCosts - variableBlocks);
  if (totals.totalOperatingExpenses != null) {
    const variable = totals.totalVariableCosts ?? variableBlocks;
    const rest = (['out_of_pocket', 'fixed', 'other'] as const).reduce((sum, s) => sum + blockValue(s), 0);
    pushGap('TOTAL OPERATING EXPENSES (lines not read)', 'other', totals.totalOperatingExpenses - (variable + rest));
  }

  return {
    settlementId: settlement.id,
    truckId: settlement.truck_id ?? null,
    weekEnding: settlement.week_ending ?? null,
    gross: totals.totalRevenue ?? 0,
    // BANK DEPOSIT IS READ, NEVER COMPUTED: the printed deposit line, else
    // what Prime paid out (SETTLEMENT TO OPERATOR / TOTAL CASH FLOW, else
    // TOTAL STATEMENT + balance forward).
    deposit:
      st.printed.depositSource && st.printed.depositSource !== 'net_due' && st.printed.deposit != null
        ? st.printed.deposit
        : (totals.settlementToOperator ?? totals.totalCashFlow ?? (totals.totalStatement ?? 0) + balanceForward),
    expenses: ledger.reduce((sum, e) => sum + e.contribution, 0),
    ledger,
    addBacks,
    interestIncome,
    balanceForward,
  };
}
