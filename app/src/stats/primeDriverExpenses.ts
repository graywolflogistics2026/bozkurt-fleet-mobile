import { PRIME_DRIVER_EXPENSE_CATEGORIES, type PrimeDriverExpenseCategory } from '@/src/primeDriverExpenses/categories';
import { isEligibleForAccountantReport, isWithheldLumperAdvance } from '@/src/primeDriverExpenses/categoryMapping';
import { calcPerDiemDays, type SettlementWeek } from '@/src/tax/perDiem';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner decision
// 2026-09-17) — pure grouping/subtotal logic, zero React/Expo/Supabase
// imports so it's unit-testable via plain ts-jest, same "pure stats
// module, thin screen reads from it" split every other src/stats/*.ts
// file in this codebase already uses.
//
// ISOLATION (item 6, the hard requirement): this module — and the whole
// `prime_driver_expenses` table it reads from, AND `deductions.
// accountant_category` (owner decision 2026-09-17, docs/PENDING_SQL.md
// §75) — is NEVER imported by src/stats/kpi.ts (computeKpis),
// src/stats/trueProfit.ts (sumCanonicalExpenses/calcTrueProfit),
// src/stats/cpm.ts (calcCanonicalCpm), src/stats/truckComparison.ts
// (buildTruckComparison), src/stats/accountantPackage.ts (buildLineItems),
// or src/data/taxEstimate.ts — confirmed by grep before and after writing
// this file (zero hits for "prime_driver_expenses"/"PrimeDriverExpense"/
// "primeDriverExpenses"/"accountant_category" in any of those files). See
// this file's own dedicated isolation test (primeDriverExpenses.test.ts's
// "CANONICAL ISOLATION" block) for the end-to-end proof: a realistic
// settlement+deduction dataset run through every one of those canonical
// functions produces BYTE-IDENTICAL results whether or not
// prime_driver_expenses rows / accountant_category values exist on the
// same account — structurally guaranteed, not just asserted, since none
// of those functions' own input types have anywhere to receive this data
// at all.

export type PrimeDriverExpenseRow = {
  id: string;
  exp_date: string | null;
  amount: number | null;
  category: string | null;
  note: string | null;
  // ZERO DUPLICATION (item 5) — which of the two disjoint sources this
  // row actually came from. 'direct' rows have no deduction counterpart
  // at all (entered right on this screen); 'deduction' rows are a LIVE
  // read of a real `deductions` row (never copied/duplicated) — editing
  // or deleting one of these must go through the SAME code path
  // Deductions' own screen uses, never a parallel write path.
  // 'prime_settlement' = a settlement-withheld Prime lumper line shown
  // under Lumpers by this report's Prime-only exception (see
  // eligibleDeductionRowsForReport()). READ-ONLY here: it is the real
  // withheld deductions row, so editing or deleting it from this screen
  // would change true profit/tax elsewhere.
  origin: 'direct' | 'deduction' | 'prime_settlement';
};

// The shape this module needs from a real `deductions` row — deliberately
// minimal (never the full `Deduction` type) so this file has no reason to
// import from `src/types/db.ts` and no path for a future column to sneak
// into a canonical-total-adjacent computation by accident.
export type EligibleDeductionSource = {
  id: string;
  ded_date: string | null;
  amount: number | null;
  accountant_category: string | null;
  source: string | null;
  description: string | null;
  category?: string | null;
  settlement_id?: string | null;
};

// THE ORIGIN RULE, applied here too (item 2's own explicit requirement:
// "only out-of-pocket rows may ever appear on the report... origin is
// checked, not just category name"). A settlement-withheld row is
// excluded here EVEN IF it somehow carries a non-null accountant_category
// (which should never happen given every write path already checks this —
// see categoryMapping.ts — but this is the report's own last line of
// defense, not the only one).
//
// PRIME LUMPER EXCEPTION (owner decision 2026-09-23) — the ONE exception
// to the origin rule, scoped to THIS report, the Lumpers category, and
// Prime settlements only. This screen exists to translate Prime's format
// for the owner's accountant, whose system can't read Prime's lumper
// structure (an "OUTSIDE LUMPER" revenue line paired with a withheld
// "ADV FOR OUTSIDE LUMPER" advance). So every settlement-withheld lumper
// line is shown here under Lumpers, read live, never copied, and never
// given an accountant_category. Nothing outside this function sees the
// exception: the deduction row keeps source='settlement' and
// tax_deductible=false, so Deductions, KPIs, true profit, CPM, tax and
// the Accountant Package treat it exactly as before (proven by
// primeDriverExpenses.test.ts's "PRIME LUMPER EXCEPTION" test).
// `nonPrimeSettlementIds` = settlements whose carrier is known and is not
// Prime; lumpers from those stay excluded. A settlement with no recorded
// carrier is treated as Prime, since this screen is Prime-only.
// Every other category keeps the strict origin rule.
export function eligibleDeductionRowsForReport(
  deductions: EligibleDeductionSource[],
  nonPrimeSettlementIds: ReadonlySet<string> = new Set()
): PrimeDriverExpenseRow[] {
  const rows: PrimeDriverExpenseRow[] = [];
  for (const d of deductions) {
    if (!isEligibleForAccountantReport(d.source)) {
      const isPrime = !(d.settlement_id && nonPrimeSettlementIds.has(d.settlement_id));
      if (isPrime && isWithheldLumperAdvance({ category: d.category ?? null, description: d.description, source: d.source })) {
        rows.push({ id: d.id, exp_date: d.ded_date, amount: d.amount, category: 'Lumpers', note: d.description, origin: 'prime_settlement' });
      }
      continue;
    }
    if (!d.accountant_category) continue;
    rows.push({
      id: d.id,
      exp_date: d.ded_date,
      amount: d.amount,
      category: d.accountant_category,
      note: d.description,
      origin: 'deduction',
    });
  }
  return rows;
}

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
  // DAYS AWAY FROM HOME OVERRIDE (owner decision 2026-09-17, docs/
  // PENDING_SQL.md §75) — true whenever the caller supplied a real
  // override for this exact month; `daysAwayFromHome` above already
  // reflects it (the override wins) — this flag exists purely so the UI
  // can show a "manually set" indicator and a reset action.
  daysAwayFromHomeIsOverridden: boolean;
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

// ZERO DUPLICATION (item 5) — the ONE merge point for the two structurally
// disjoint sources (a `prime_driver_expenses` row has no deduction
// counterpart by definition — that table carries no `settlement_id`/
// origin concept at all, it's always manual entry). This is a plain
// concatenation, not a de-dupe — there is no shared identity between the
// two tables for a real collision to hide behind; "never both for the
// same real-world expense" is a user-discipline concern the UI's own
// origin labeling (item 5's "from Deductions, {{date}}" vs. a direct
// entry) addresses, not a data-collision risk this function needs to
// guard against.
export function mergePrimeDriverExpenseRows(directRows: PrimeDriverExpenseRow[], deductionRows: PrimeDriverExpenseRow[]): PrimeDriverExpenseRow[] {
  return [...directRows, ...deductionRows];
}

// Every one of the 16 fixed categories renders as its own section EVEN
// WHEN it has zero entries this month — a $0 subtotal, never a hidden
// row — matching the accountant's own blank-template layout (item 3).
export function buildPrimeDriverExpenseMonth(
  rows: PrimeDriverExpenseRow[],
  settlements: SettlementWeek[],
  year: number,
  month: number,
  daysAwayFromHomeOverride?: number | null
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

  // DAYS AWAY FROM HOME (item 3, override added by item 8) — reads the
  // EXISTING per-diem day tracking (src/tax/perDiem.ts's
  // calcPerDiemDays(), CLAUDE.md invariant #9's own deterministic
  // day-counting rule) scoped to this month's own settlement weeks —
  // never a second, independently-computed day count. A real override
  // (a plain integer, `!= null`) always wins for THIS REPORT'S OWN
  // DISPLAY ONLY — it is never written back to `settlements.
  // per_diem_days`, `calcPerDiemDays()`, Tax Estimator, or the Accountant
  // Package's own per-diem block, all of which keep reading the real
  // calculated figure regardless of what's set here (proven by
  // primeDriverExpenses.test.ts's dedicated isolation case).
  const monthSettlements = settlements.filter(
    (s) => (s.week_ending ?? '').slice(0, 4) === String(year) && (s.week_ending ?? '').slice(5, 7) === String(month).padStart(2, '0')
  );
  const calculatedDays = calcPerDiemDays(monthSettlements);
  const hasOverride = daysAwayFromHomeOverride != null;
  const daysAwayFromHome = hasOverride ? (daysAwayFromHomeOverride as number) : calculatedDays;

  return { year, month, sections, grandTotal, daysAwayFromHome, daysAwayFromHomeIsOverridden: hasOverride };
}

// Pure key builder for the override jsonb map (profiles.
// prime_driver_days_override, keyed "YYYY-MM") — one shared function so
// the screen's read and write sides can never format the key
// differently.
export function daysOverrideKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Settlements whose recorded carrier is known and is NOT Prime Inc — the
// only settlements excluded from the Prime lumper exception above.
export function nonPrimeSettlementIds(settlements: Array<{ id: string; carrier?: string | null }>): Set<string> {
  const ids = new Set<string>();
  for (const s of settlements) {
    const carrier = (s.carrier ?? '').trim();
    if (carrier && !/\bprime\b/i.test(carrier)) ids.add(s.id);
  }
  return ids;
}
