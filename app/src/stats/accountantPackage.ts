import { DEFAULT_SCHEDULE_C_BUCKET } from '@/src/import/category';
import { resolveScheduleCBucket } from '@/src/stats/profitLoss';
import { buildAssetRegister, buildAssetCategoryBreakdown, type AssetCategoryBreakdown } from '@/src/stats/assetRegister';
import type { Deduction, MaintenanceRecord, FuelPurchase, LoanRow, CreditCardRow, UserCategory } from '@/src/types/db';
import type { ExtractedRevenueItem } from '@/src/import/types';

export type CategoryTotal = { category: string; amount: number };

export type LoansAndCardsSummary = {
  loans: { name: string; balance: number; payment: number }[];
  totalLoanBalance: number;
  cards: { name: string; balance: number; limit: number }[];
  totalCardBalance: number;
};

export type AccountantPackage = {
  scheduleC: CategoryTotal[];
  totalExpenses: number;
  income: { total: number; byType: CategoryTotal[] };
  perDiem: { days: number; deduction: number };
  // §4 bug #3 fix: sourced from the SAME EQUIP-coded deductions the real
  // Asset Register uses (src/stats/assetRegister.ts), never a separate
  // store — legacy's own "Assets (by category)" card was permanently
  // broken/empty because it read a dead, disconnected ASSETS2 store.
  assetsByCategory: AssetCategoryBreakdown[];
  loansAndCards: LoansAndCardsSummary;
};

// Best-effort keyword match from a reimbursement line's free-text
// description to the expense category it repays — the ai-import
// revenueItems schema has no explicit category field
// (docs/INDUSTRY_TAXONOMY.md's "Wiring status" flags this as an open
// decision left for whoever builds the rollup), so this is the pragmatic
// mapping until/unless that schema gains one. Falls back to the same
// "Misc" default every other unresolvable category uses rather than
// silently dropping the offset.
const REIMBURSEMENT_KEYWORDS: Array<[RegExp, string]> = [
  [/toll/i, 'Tolls & Scales'],
  [/scale/i, 'Tolls & Scales'],
  [/permit/i, 'Permits, Licenses & Road Taxes'],
  [/lumper/i, 'Misc'],
  [/wash ?out/i, 'Misc'],
];

export function matchReimbursementCategory(desc: string | undefined): string {
  const text = desc ?? '';
  for (const [pattern, category] of REIMBURSEMENT_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return DEFAULT_SCHEDULE_C_BUCKET;
}

// No amortization schedule is stored for a loan (docs/INDUSTRY_TAXONOMY.md
// §B: "Truck/Trailer Payments — loan interest deductible, principal is
// NOT"), so this uses a simple current-balance × APR approximation rather
// than a true schedule — clearly an estimate, same spirit as every other
// tax-adjacent figure in this app (never presented as exact).
export function estimateLoanInterest(loan: LoanRow): number {
  const balance = Number(loan.balance ?? 0);
  const apr = Number(loan.apr ?? 0);
  if (balance <= 0 || apr <= 0) return 0;
  return balance * (apr / 100);
}

// The Accountant Package's per-category Schedule C rollup (PROMPTS.md
// Session 9b) — unlike Operating P&L's lighter preview (buildProfitLoss,
// deductions only), this folds maintenance_records/fuel_purchases/loans
// into the SAME rollup (docs/INDUSTRY_TAXONOMY.md's "Wiring status" flags
// this as previously missing — those tables had no unified tax view) and
// applies the reimbursement-vs-income offset rule (§D): a settlement
// revenueItems line with incomeType 'reimbursement' nets against its
// matched expense category instead of counting as its own income line;
// 'ifta_refund' (and every other incomeType) counts as real income,
// never netted against an expense.
export function buildAccountantPackage(
  deductions: Deduction[],
  maintenanceRecords: MaintenanceRecord[],
  fuelPurchases: FuelPurchase[],
  loans: LoanRow[],
  creditCards: CreditCardRow[],
  revenueItems: ExtractedRevenueItem[],
  userCategories: UserCategory[],
  perDiemDays: number,
  perDiemDeduction: number,
  todayIso: string
): AccountantPackage {
  const buckets = new Map<string, number>();
  function add(category: string, amount: number) {
    if (!amount) return;
    buckets.set(category, (buckets.get(category) ?? 0) + amount);
  }

  for (const d of deductions) {
    // Settlement-withheld rows are already reflected in net pay — never
    // re-counted as a tax deduction (CLAUDE.md invariant #1).
    if (d.source === 'settlement') continue;
    add(resolveScheduleCBucket(d.category, userCategories), Number(d.amount ?? 0));
  }
  for (const m of maintenanceRecords) {
    add('Maintenance & Repairs', Number(m.cost ?? 0));
  }
  for (const f of fuelPurchases) {
    add('Fuel & DEF', Math.max(0, Number(f.amount ?? 0) - Number(f.discount ?? 0)));
  }
  for (const l of loans) {
    add('Truck/Trailer Payments', estimateLoanInterest(l));
  }

  const incomeByType = new Map<string, number>();
  let incomeTotal = 0;
  for (const item of revenueItems) {
    const amount = Number(item.amount ?? 0);
    if (!amount) continue;
    if (item.incomeType === 'reimbursement') {
      const category = matchReimbursementCategory(item.desc);
      const current = buckets.get(category) ?? 0;
      buckets.set(category, Math.max(0, current - amount));
      continue;
    }
    const type = item.incomeType ?? 'other_income';
    incomeByType.set(type, (incomeByType.get(type) ?? 0) + amount);
    incomeTotal += amount;
  }

  const scheduleC = [...buckets.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = scheduleC.reduce((sum, c) => sum + c.amount, 0);
  const byType = [...incomeByType.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  const assetsByCategory = buildAssetCategoryBreakdown(buildAssetRegister(deductions, todayIso));

  const loanRows = loans.map((l) => ({ name: l.name ?? '—', balance: Number(l.balance ?? 0), payment: Number(l.payment ?? 0) }));
  const cardRows = creditCards.map((c) => ({ name: c.name ?? '—', balance: Number(c.balance ?? 0), limit: Number(c.credit_limit ?? 0) }));
  const loansAndCards: LoansAndCardsSummary = {
    loans: loanRows,
    totalLoanBalance: loanRows.reduce((sum, l) => sum + l.balance, 0),
    cards: cardRows,
    totalCardBalance: cardRows.reduce((sum, c) => sum + c.balance, 0),
  };

  return {
    scheduleC,
    totalExpenses,
    income: { total: incomeTotal, byType },
    perDiem: { days: perDiemDays, deduction: perDiemDeduction },
    assetsByCategory,
    loansAndCards,
  };
}
