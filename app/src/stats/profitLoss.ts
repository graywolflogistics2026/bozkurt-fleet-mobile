import { CANONICAL_CATEGORIES, DEFAULT_SCHEDULE_C_BUCKET } from '@/src/import/category';
import type { UserCategory } from '@/src/types/db';

// Operating P&L (PROMPTS.md Session 9a) — a lighter "system-data totals +
// per-category Schedule C rollup preview" than the full Accountant Package
// export (PROMPTS.md Session 9b, which additionally folds in
// maintenance_records/fuel_purchases/loans and the reimbursement-vs-income
// offset rule, docs/INDUSTRY_TAXONOMY.md §D). Verbatim port of legacy
// rOper()'s math (legacy/index.html:1879): revenue = sum(settlements.gross),
// expenses = sum(ALL deductions, including settlement-withheld) — this is
// NOT the tax engine's net-pay model (CLAUDE.md invariant #1 is about tax
// DEDUCTIONS specifically); gross - withheld already equals settlement net
// by definition, so netting ALL deductions against gross here produces the
// same operating net income legacy shows, just expressed a different way.
export type CategoryTotal = { category: string; amount: number };

export type ProfitLossRollup = {
  revenue: number;
  totalExpenses: number;
  netIncome: number;
  expensesByBucket: CategoryTotal[];
};

// A custom expense category's dollars must always land in a real Schedule C
// bucket (CLAUDE.md invariant #19 tax safety rail) rather than sitting in
// their own un-rollable line — canonical categories ARE their own bucket;
// a custom category resolves through user_categories.schedule_c_bucket,
// defaulting to "Misc" for a category the app doesn't recognize at all
// (e.g. one entered before user_categories existed, or a deleted custom row).
export function resolveScheduleCBucket(category: string | null, userCategories: UserCategory[]): string {
  if (!category) return DEFAULT_SCHEDULE_C_BUCKET;
  const canonical: readonly string[] = CANONICAL_CATEGORIES;
  if (canonical.includes(category)) return category;
  const custom = userCategories.find((c) => c.name === category && c.kind === 'expense');
  return custom?.schedule_c_bucket || DEFAULT_SCHEDULE_C_BUCKET;
}

export function buildProfitLoss(
  settlements: Array<{ gross: number | null }>,
  deductions: Array<{ amount: number | null; category: string | null }>,
  userCategories: UserCategory[]
): ProfitLossRollup {
  const revenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const totalExpenses = deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  const buckets = new Map<string, number>();
  for (const d of deductions) {
    const bucket = resolveScheduleCBucket(d.category, userCategories);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + Number(d.amount ?? 0));
  }
  const expensesByBucket = [...buckets.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { revenue, totalExpenses, netIncome: revenue - totalExpenses, expensesByBucket };
}
