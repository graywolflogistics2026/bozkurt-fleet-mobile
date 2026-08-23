// EXPENSE TOTAL EXPLAINER (owner decision 2026-08-05, FULL PARITY
// follow-up item D) — tapping the Home trio's "Expenses" tile opens this
// breakdown instead of just navigating away: total/fixed/variable (the
// same classification CPM's "Why?" breakdown uses, src/stats/cpm.ts) plus
// the 12 largest rows for the period, each deletable right from the
// breakdown. Any row over 15% of the total is flagged as a possible
// depreciable asset (a single expense that large usually isn't a routine
// operating cost) — informational only, this module never reclassifies
// or excludes it from the total on that basis alone.
import { bucketFor, typeFor } from '@/src/stats/cpm';
import { isVehiclePurchaseOneOff } from '@/src/import/category';

const POSSIBLE_DEPRECIABLE_ASSET_THRESHOLD = 0.15;
const LARGEST_ROWS_LIMIT = 12;

export type ExpenseExplainerDeduction = {
  id: string;
  description: string | null;
  amount: number | null;
  category: string | null;
};

export type ExpenseExplainerRow = {
  id: string;
  description: string;
  amount: number;
  category: string | null;
  isPossibleDepreciableAsset: boolean;
};

export type ExpenseTotalExplainerResult = {
  total: number;
  fixedTotal: number;
  variableTotal: number;
  // Vehicle-purchase-shaped rows excluded from `total`/the buckets/the
  // largest-rows list entirely (spec item D's "auto-excludes vehicle-
  // purchase-shaped descriptions") — a capital/asset purchase isn't an
  // operating expense this breakdown should explain, even though it
  // still counts normally in P&L/tax (this module never touches those).
  excludedVehiclePurchaseTotal: number;
  largestRows: ExpenseExplainerRow[];
};

export function buildExpenseTotalExplainer(deductions: ExpenseExplainerDeduction[]): ExpenseTotalExplainerResult {
  const included: ExpenseExplainerDeduction[] = [];
  let excludedVehiclePurchaseTotal = 0;

  for (const d of deductions) {
    if (isVehiclePurchaseOneOff(d.description ?? undefined)) {
      excludedVehiclePurchaseTotal += Number(d.amount ?? 0);
      continue;
    }
    included.push(d);
  }

  const total = included.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  let fixedTotal = 0;
  let variableTotal = 0;
  for (const d of included) {
    const amount = Number(d.amount ?? 0);
    if (typeFor(bucketFor(d.category)) === 'fixed') fixedTotal += amount;
    else variableTotal += amount;
  }

  const largestRows = [...included]
    .sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
    .slice(0, LARGEST_ROWS_LIMIT)
    .map((d) => {
      const amount = Number(d.amount ?? 0);
      return {
        id: d.id,
        description: d.description ?? '—',
        amount,
        category: d.category,
        isPossibleDepreciableAsset: total > 0 && amount / total > POSSIBLE_DEPRECIABLE_ASSET_THRESHOLD,
      };
    });

  return { total, fixedTotal, variableTotal, excludedVehiclePurchaseTotal, largestRows };
}
