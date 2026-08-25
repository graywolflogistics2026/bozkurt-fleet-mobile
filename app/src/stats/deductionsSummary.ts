import { groupDeductions, isSettlementDed } from '@/src/stats/deductionGroups';
import { NON_DEDUCTIBLE_CATEGORIES } from '@/src/import/category';
import { isoWeekKey } from '@/src/stats/cashFlowClassification';
import { bucketGranularityFor, type PeriodOption } from '@/src/stats/periodFilter';
import type { Deduction } from '@/src/types/db';

// DEDUCTIONS TOTALS BAR (spec item 2a) — three tiles, always reusing
// groupDeductions()'s own canonical origin split (CLAUDE.md's own
// isSettlementDed()/rDed() port) rather than a second out-of-pocket-vs-
// withheld formula. Total is the literal sum of the two tiles above it
// (Total = Out-of-Pocket + Withheld, unconditionally — the same "every
// deduction counts" convention buildProfitLoss()/calcScorecard() already
// use for their own "operating" totals) so the number always visibly
// reconciles with what's shown right above it.
//
// `nonDeductibleAmount` is informational only, computed from the SAME
// canonical NON_DEDUCTIBLE_CATEGORIES set trueProfit.ts's own
// TRUE_PROFIT_EXCLUDED_CATEGORIES mirrors (Meals per diem covered/
// Advance Repayment/Escrow & Deposits) — it never changes what Total
// displays; it's the caption explaining why Total (which counts every
// dollar, deductible or not) is larger than the "true deductible" figure
// shown elsewhere in the app (Accountant Package, True Profit).
export type DeductionsTotalsBar = {
  outOfPocket: { amount: number; count: number };
  withheld: { amount: number; count: number };
  total: { amount: number; count: number };
  nonDeductibleAmount: number;
};

export function buildDeductionsTotalsBar(rows: Deduction[]): DeductionsTotalsBar {
  const { outOfPocket, withheld, outOfPocketTotal, withheldTotal } = groupDeductions(rows);
  const nonDeductibleAmount = rows
    .filter((d) => NON_DEDUCTIBLE_CATEGORIES.includes(d.category ?? ''))
    .reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  return {
    outOfPocket: { amount: outOfPocketTotal, count: outOfPocket.length },
    withheld: { amount: withheldTotal, count: withheld.length },
    total: { amount: outOfPocketTotal + withheldTotal, count: rows.length },
    nonDeductibleAmount,
  };
}

// CHART SERIES (spec item 2c) — two toggleable series (out-of-pocket,
// settlement-withheld) bucketed weekly for "This Month," monthly for
// longer periods (periodFilter.ts's bucketGranularityFor). Buckets with
// zero rows on EITHER side never appear (nothing to plot) — the chart
// component itself decides how to connect/space the remaining points.
export type DeductionsChartBucket = { key: string; outOfPocket: number; withheld: number };

export function buildDeductionsChartSeries(rows: Deduction[], period: PeriodOption, now: Date = new Date()): DeductionsChartBucket[] {
  const granularity = bucketGranularityFor(period);
  const map = new Map<string, DeductionsChartBucket>();
  for (const d of rows) {
    if (!d.ded_date) continue;
    const key = granularity === 'weekly' ? isoWeekKey(d.ded_date) : d.ded_date.slice(0, 7);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, outOfPocket: 0, withheld: 0 });
    const bucket = map.get(key) as DeductionsChartBucket;
    const amount = Number(d.amount ?? 0);
    if (isSettlementDed(d)) bucket.withheld += amount;
    else bucket.outOfPocket += amount;
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// TOP CATEGORIES (spec item 2d) — top N by summed amount across whatever
// rows are currently shown (both origins combined, matching the Total
// tile above); `share` is relative to the sum of ALL rows passed in, so
// it always reads as "% of the Total tile," never a mismatched
// denominator.
export type TopCategory = { category: string; amount: number; share: number };

export function buildTopCategories(rows: Deduction[], n = 3): TopCategory[] {
  const byCategory = new Map<string, number>();
  let grandTotal = 0;
  for (const d of rows) {
    const amount = Number(d.amount ?? 0);
    if (!amount) continue;
    const category = d.category || 'Misc';
    byCategory.set(category, (byCategory.get(category) ?? 0) + amount);
    grandTotal += amount;
  }
  return [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount, share: grandTotal > 0 ? amount / grandTotal : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

// FILTER/CHART STATE IN SYNC (spec item 2e) — the chart's own two toggle
// chips ("Out-of-Pocket" / "Settlement-Withheld") share exactly ONE piece
// of state with the pre-existing All/Out-of-pocket/Settlement segmented
// Pill row, and behave CONSISTENTLY with it: tapping "Out-of-Pocket"
// isolates to out-of-pocket, exactly like tapping the "Out-of-pocket"
// Pill already does — a user tapping the same-labeled control in either
// place must never get opposite results. Tapping the already-isolated
// series' own chip again is the one extra "toggleable" convenience the
// Pills don't offer (spec item 2c) — it restores 'all' rather than
// requiring a trip back to the "All" Pill.
export type OriginFilter = 'all' | 'outOfPocket' | 'withheld';

export function toggleDeductionSeries(current: OriginFilter, series: 'outOfPocket' | 'withheld'): OriginFilter {
  return current === series ? 'all' : series;
}
