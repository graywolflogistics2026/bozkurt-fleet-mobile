import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';
import { calcPerDiemDays, type SettlementWeek } from '@/src/tax/perDiem';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner decision
// 2026-09-17) — pure grouping/subtotal logic, zero React/Expo/Supabase
// imports so it's unit-testable via plain ts-jest, same "pure stats
// module, thin screen reads from it" split every other src/stats/*.ts
// file in this codebase already uses.
//
// ISOLATION (item 6, the hard requirement): this module — and the whole
// `prime_driver_expenses` table it reads from — is NEVER imported by
// src/stats/kpi.ts (computeKpis), src/stats/trueProfit.ts
// (sumCanonicalExpenses/calcTrueProfit), src/stats/cpm.ts
// (calcCanonicalCpm), src/stats/truckComparison.ts (buildTruckComparison),
// src/stats/accountantPackage.ts (buildLineItems), or src/data/taxEstimate.ts
// — confirmed by grep before and after writing this file (zero hits for
// "prime_driver_expenses"/"PrimeDriverExpense"/"primeDriverExpenses" in
// any of those files). See this file's own dedicated isolation test
// (primeDriverExpenses.test.ts's "CANONICAL ISOLATION" block) for the
// end-to-end proof: a realistic settlement+deduction dataset run through
// every one of those canonical functions produces BYTE-IDENTICAL results
// whether or not prime_driver_expenses rows exist on the same account —
// structurally guaranteed, not just asserted, since none of those
// functions' own input types have anywhere to receive this data at all.

export type PrimeDriverExpenseRow = {
  id: string;
  exp_date: string | null;
  amount: number | null;
  category: string | null;
  note: string | null;
};

export type PrimeDriverExpenseCategorySection = {
  category: PrimeDriverExpenseCategory;
  rows: PrimeDriverExpenseRow[];
  subtotal: number;
};

export type PrimeDriverExpenseMonth = {
  year: number;
  month: number; // 1-12
  sections: PrimeDriverExpenseCategorySection[];
  grandTotal: number;
  daysAwayFromHome: number;
};

// A row genuinely belongs to a month/year purely by its own `exp_date` —
// editing a row's date and re-querying this function with the new month
// is what "moves it to the correct month automatically" means; there is
// no separate per-month cache anywhere for a stale value to hide in.
function rowsInMonth(rows: PrimeDriverExpenseRow[], year: number, month: number): PrimeDriverExpenseRow[] {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  return rows.filter((r) => (r.exp_date ?? '').slice(0, 4) === y && (r.exp_date ?? '').slice(5, 7) === m);
}

// Every one of the 16 fixed categories renders as its own section EVEN
// WHEN it has zero entries this month — a $0 subtotal, never a hidden
// row — matching the accountant's own blank-template layout (item 3).
export function buildPrimeDriverExpenseMonth(
  rows: PrimeDriverExpenseRow[],
  settlements: SettlementWeek[],
  year: number,
  month: number
): PrimeDriverExpenseMonth {
  const monthRows = rowsInMonth(rows, year, month);
  const sections: PrimeDriverExpenseCategorySection[] = PRIME_DRIVER_EXPENSE_CATEGORIES.map((category) => {
    const categoryRows = monthRows.filter((r) => r.category === category);
    return {
      category,
      rows: categoryRows,
      subtotal: categoryRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
    };
  });
  const grandTotal = sections.reduce((sum, s) => sum + s.subtotal, 0);

  // DAYS AWAY FROM HOME (item 3) — reads the EXISTING per-diem day
  // tracking (src/tax/perDiem.ts's calcPerDiemDays(), CLAUDE.md invariant
  // #9's own deterministic day-counting rule) scoped to this month's own
  // settlement weeks — never a second, independently-computed day count.
  // Read-only on this screen by construction: this function has no way
  // to write back to `settlements.per_diem_days`, only to read it.
  const monthSettlements = settlements.filter(
    (s) => (s.week_ending ?? '').slice(0, 4) === String(year) && (s.week_ending ?? '').slice(5, 7) === String(month).padStart(2, '0')
  );
  const daysAwayFromHome = calcPerDiemDays(monthSettlements);

  return { year, month, sections, grandTotal, daysAwayFromHome };
}
