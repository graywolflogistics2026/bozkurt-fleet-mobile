// The owner's 17 real Prime weeks (2026-07-31 .. 2026-11-20), exported
// read-only on 2026-11-25 (docs/decisions/advance-family-rule-proposal.md,
// answer 6): the stored reading (documents.parsed_json settlement fields)
// and the saved statement (settlements.statement fields). Amounts, labels
// and codes only. Not a test file itself.
//
// primeWeekExtraction() builds the same Extraction the gate reads, on the
// shape of the golden 08-14 week (golden0814()): every settlement field the
// export carries replaces the golden one. Fields the export does not carry
// are derived, never invented as amounts:
//   - the statement's week totals come from the saved statement totals
//     (saved.primeTotals -> operating.weekTotal*);
//   - the printed dates come from the week ending (settlement date and
//     statement week ending YY/MM/DD, print date the day before, M/D/YY).
import type { Extraction } from '@/src/import/types';
import { golden0814 } from '@/src/data/__tests__/golden0814Fixture';
import weeksJson from './primeWeeks2026.json';

type Row = Record<string, unknown>;
type PrimeTotals = Record<string, number | null>;
export type PrimeWeekExport = {
  reading: Row & {
    settlementGate?: { status: string; lineDetails?: string; lineDifference?: number | null } | null;
  };
  saved: { primeLines: Row[] | null; primeTotals: PrimeTotals | null; linesNotSaved: boolean | null; reviewReasons: Row[] | null };
};

export const PRIME_WEEKS = (weeksJson as unknown as { weeks: Record<string, PrimeWeekExport> }).weeks;
export const PRIME_WEEK_ENDINGS = Object.keys(PRIME_WEEKS).sort();

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const opt = <T>(v: unknown): T | undefined => (v == null ? undefined : (v as T));

function printedDates(weekEnding: string) {
  const [y, m, d] = weekEnding.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return {
    settlementDateRaw: `${String(y).slice(2)}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    statementWeekEndingRaw: `${String(y).slice(2)}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
    printDateRaw: `${prev.getMonth() + 1}/${prev.getDate()}/${String(prev.getFullYear()).slice(2)}`,
  };
}

// saved.primeTotals key -> operating field the statement check reads.
const TOTALS_TO_OPERATING: Record<string, string> = {
  miles: 'weekMiles',
  totalFreightRevenue: 'weekTotalFreightRevenue',
  totalOtherRevenue: 'weekTotalOtherRevenue',
  totalRevenue: 'weekTotalRevenue',
  totalFuelOilTax: 'weekTotalFuelOilTax',
  totalRepair: 'weekTotalRepair',
  totalTires: 'weekTotalTires',
  totalMiscellaneous: 'weekTotalMiscellaneous',
  totalVariableCosts: 'weekTotalVariableCosts',
  totalOutOfPocket: 'weekTotalOutOfPocket',
  totalFixedCost: 'weekTotalFixedCost',
  totalOtherIncomeAndExpense: 'weekTotalOtherIncomeAndExpense',
  totalOperatingExpenses: 'weekTotalOperatingExpenses',
  totalStatement: 'weekTotalStatement',
  priorWeekBalanceForward: 'priorWeekBalanceForward',
  totalCashFlow: 'weekTotalCashFlow',
  settlementToOperator: 'settlementToOperator',
  directDeposit: 'directDeposit',
};

export function primeWeekExtraction(weekEnding: string): Extraction {
  const week = PRIME_WEEKS[weekEnding];
  if (!week) throw new Error(`no exported week ${weekEnding}`);
  const r = week.reading;
  const totals = week.saved.primeTotals ?? {};
  const operating: Row = { lines: list(r.operatingLines), weekEnding };
  for (const [from, to] of Object.entries(TOTALS_TO_OPERATING)) {
    if (totals[from] != null) operating[to] = totals[from];
  }
  if (r.weekTotalOperatingExpenses != null) operating.weekTotalOperatingExpenses = r.weekTotalOperatingExpenses;
  const dates = printedDates(weekEnding);
  return golden0814({
    weekEnding,
    ...dates,
    carrier: opt<string>(r.carrier),
    grossRevenue: opt(r.grossRevenue),
    reimbursements: opt(r.reimbursements),
    totalDeductions: opt(r.totalDeductions),
    netPay: opt(r.netPay),
    totalWageExpense: opt(r.totalWageExpense),
    subtotalPriorWage: opt(r.subtotalPriorWage),
    totalDeductionsFromSettlements: opt(r.totalDeductionsFromSettlements),
    totalMiles: opt(totals.miles),
    loadedMiles: undefined,
    revenueItems: list(r.revenueItems),
    reimbursementItems: list(r.reimbursementItems),
    deductions: list(r.deductions),
    wageItems: r.wageItems == null ? undefined : list(r.wageItems),
    loads: list(r.loads),
    tractorFuel: list(r.tractorFuel),
    reeferFuel: list(r.reeferFuel),
    depositAmount: opt(totals.directDeposit ?? totals.settlementToOperator),
    operating: operating as NonNullable<Extraction['settlement']>['operating'],
  });
}
