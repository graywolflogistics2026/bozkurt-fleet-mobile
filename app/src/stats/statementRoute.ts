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
//   deposit  = TOTAL STATEMENT (what Prime paid into the bank)
//   profit   = deposit + every excluded non-expense line added back
//              (advances, bond, ...) − interest income
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
};

export type StatementSettlement = {
  id?: string;
  truck_id?: string | null;
  week_ending?: string | null;
  statement?: SettlementStatement | null;
};

export function statementWeekOf(settlement: StatementSettlement): StatementWeek | null {
  const st = settlement.statement;
  if (!settlement.id || !isStatementBacked(st) || !st?.prime) return null;
  const { lines, totals, prReimbursementTotal } = st.prime;
  const ledger: StatementLedgerEntry[] = [];
  const addBacks: StatementWeek['addBacks'] = [];
  let interestIncome = 0;

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
      // R1 — PERSONAL PYMNT RCV: an offset only up to this settlement's PR
      // reimbursement lines; any remainder is owner money in (excluded).
      if (line.amount <= 0) {
        ledger.push({ ...base, status: 'counted', contribution: -line.amount, category: 'Bank & Merchant Fees', costType: 'variable', reason: 'expense' });
        continue;
      }
      const offset = Math.min(line.amount, Math.max(0, prReimbursementTotal));
      const remainder = line.amount - offset;
      if (offset > 0) {
        ledger.push({ ...base, printed: offset, status: 'offset', contribution: -offset, category: 'Bank & Merchant Fees', costType: 'variable', reason: 'pr_offset' });
      }
      if (remainder > 0.005) {
        ledger.push({ ...base, printed: remainder, status: 'excluded', contribution: 0, category: null, costType: null, reason: 'owner_money_in' });
        addBacks.push({ label: line.label, reason: 'owner_money_in', amount: -remainder });
      }
    }
  }

  return {
    settlementId: settlement.id,
    truckId: settlement.truck_id ?? null,
    weekEnding: settlement.week_ending ?? null,
    gross: totals.totalRevenue ?? 0,
    // BANK DEPOSIT IS READ, NEVER COMPUTED: the printed deposit line, else
    // the statement total (what Prime paid out).
    deposit: st.printed.depositSource && st.printed.depositSource !== 'net_due' && st.printed.deposit != null ? st.printed.deposit : (totals.totalStatement ?? 0),
    expenses: ledger.reduce((sum, e) => sum + e.contribution, 0),
    ledger,
    addBacks,
    interestIncome,
  };
}
