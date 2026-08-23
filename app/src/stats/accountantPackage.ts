import { DEFAULT_SCHEDULE_C_BUCKET, scheduleCLineFor } from '@/src/import/category';
import { isPersonalPayment } from '@/src/import/paymentMethods';
import { resolveScheduleCBucket } from '@/src/stats/profitLoss';
import { summarizeContributions, type CapitalTransactionLike } from '@/src/stats/capitalAccount';
import { calcPerDiemDays } from '@/src/tax/perDiem';
import { buildAssetRegister, buildAssetCategoryBreakdown, type AssetCategoryBreakdown } from '@/src/stats/assetRegister';
import type { Deduction, Equipment, FuelPurchase, MaintenanceRecord, LoanRow, CreditCardRow, Toll, Truck, UserCategory } from '@/src/types/db';
import type { ExtractedRevenueItem } from '@/src/import/types';
import type { TaxYearData } from '@/src/types/db';

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
    // re-counted as a tax deduction (CLAUDE.md invariant #1). A row flagged
    // tax_deductible=false (Meals/Advance Repayment — docs/PENDING_SQL.md
    // §33, owner decision 2026-07-17) is excluded the same way even when
    // it's an out-of-pocket/imported row, not a settlement one.
    if (d.source === 'settlement' || d.tax_deductible === false) continue;
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

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTANT PACKAGE REWORK (owner decision 2026-08-05, FULL PARITY pass
// PART B) — the owner's accountant needs OUT-OF-POCKET expenses only (the
// carrier's own accountant already has the withheld side). Everything
// below is new, additive surface built on top of the original rollup
// above (kept for any other future caller, but no longer used by the
// Accountant Package screen itself).
// ═══════════════════════════════════════════════════════════════════════

export type AccountantScope = 'outOfPocket' | 'withheld' | 'combined';

// ORIGIN RULE (spec item B.1): a row created by a settlement import —
// including fuel/maintenance/tolls, not just deductions — is settlement-
// withheld and must never appear in the out-of-pocket view.
// `deductions.source`/`maintenance_records.source`/`tolls.source` (docs/
// PENDING_SQL.md §43) all use the same 'settlement'|'import'|'manual'
// values; fuel_purchases has no `source` column, so its origin is derived
// from `settlement_id` (set only for settlement-linked rows, same
// convention `trueProfit.ts`'s canonical expense engine already uses).
export function matchesAccountantScope(origin: string | null | undefined, scope: AccountantScope): boolean {
  if (scope === 'combined') return true;
  const isWithheld = origin === 'settlement';
  return scope === 'withheld' ? isWithheld : !isWithheld;
}

function inAccountantPeriod(dateStr: string | null | undefined, year: number, month: number | null): boolean {
  if (!dateStr) return false;
  const y = Number(dateStr.slice(0, 4));
  if (y !== year) return false;
  if (month == null) return true;
  return Number(dateStr.slice(5, 7)) === month;
}

export type LineItemKind = 'deduction' | 'fuel' | 'maintenance' | 'toll';
export type LineItemOrigin = 'settlement' | 'import' | 'manual';

export type LineItem = {
  id: string;
  kind: LineItemKind;
  date: string | null;
  description: string;
  category: string;
  amount: number;
  origin: LineItemOrigin;
  isOwnerPaid: boolean;
};

// The ONE line-item builder every report section (category table, lumper
// table, warnings) reads from — period + scope filtered, and (spec item
// C.1) a row whose net amount is exactly $0 (a self-service Mark-as-Done
// with nothing out of pocket, a fully warranty-covered repair) is skipped
// entirely: it's history, not an expense line.
export function buildLineItems(
  deductions: Deduction[],
  fuelPurchases: FuelPurchase[],
  maintenanceRecords: MaintenanceRecord[],
  tolls: Toll[],
  year: number,
  month: number | null,
  scope: AccountantScope
): LineItem[] {
  const items: LineItem[] = [];

  for (const d of deductions) {
    const amount = Number(d.amount ?? 0);
    if (!amount) continue;
    if (!inAccountantPeriod(d.ded_date, year, month)) continue;
    const origin: LineItemOrigin = (d.source as LineItemOrigin) ?? 'manual';
    if (!matchesAccountantScope(origin, scope)) continue;
    items.push({
      id: d.id,
      kind: 'deduction',
      date: d.ded_date,
      description: d.description || d.category || 'Deduction',
      category: d.category ?? 'Misc',
      amount,
      origin,
      isOwnerPaid: isPersonalPayment(d.payment_method),
    });
  }

  for (const f of fuelPurchases) {
    const amount = Math.max(0, Number(f.amount ?? 0) - Number(f.discount ?? 0));
    if (!amount) continue;
    if (!inAccountantPeriod(f.purchase_date, year, month)) continue;
    const origin: LineItemOrigin = f.settlement_id ? 'settlement' : 'import';
    if (!matchesAccountantScope(origin, scope)) continue;
    items.push({
      id: f.id,
      kind: 'fuel',
      date: f.purchase_date,
      description: f.location || 'Fuel',
      category: 'Fuel & DEF',
      amount,
      origin,
      isOwnerPaid: false,
    });
  }

  for (const m of maintenanceRecords) {
    const amount = Number(m.cost ?? 0);
    if (!amount) continue;
    if (!inAccountantPeriod(m.service_date, year, month)) continue;
    const origin: LineItemOrigin = m.source ?? 'import';
    if (!matchesAccountantScope(origin, scope)) continue;
    items.push({
      id: m.id,
      kind: 'maintenance',
      date: m.service_date,
      description: m.description || m.service_type || 'Maintenance',
      category: 'Maintenance & Repairs',
      amount,
      origin,
      isOwnerPaid: false,
    });
  }

  for (const t of tolls) {
    const amount = Number(t.amount ?? 0);
    if (!amount) continue;
    if (!inAccountantPeriod(t.toll_date, year, month)) continue;
    const origin: LineItemOrigin = t.source ?? 'import';
    if (!matchesAccountantScope(origin, scope)) continue;
    items.push({
      id: t.id,
      kind: 'toll',
      date: t.toll_date,
      description: t.plaza || 'Toll',
      category: 'Tolls & Scales',
      amount,
      origin,
      isOwnerPaid: false,
    });
  }

  return items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// Category subtotal table (spec item A.5's Schedule C line reference,
// bold category headers in the UI) — built from an already period+scope-
// filtered `lineItems` list so this can never disagree with what the
// screen actually displays row by row.
export type ScheduleCLineTotal = { category: string; amount: number; scheduleCLine: string | null };

export function buildScheduleCTotals(lineItems: LineItem[], userCategories: UserCategory[]): ScheduleCLineTotal[] {
  const buckets = new Map<string, number>();
  for (const item of lineItems) {
    const bucket = resolveScheduleCBucket(item.category, userCategories);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + item.amount);
  }
  return [...buckets.entries()]
    .map(([category, amount]) => ({ category, amount, scheduleCLine: scheduleCLineFor(category) }))
    .sort((a, b) => b.amount - a.amount);
}

// MISC CONCENTRATION WARNING (owner decision 2026-08-05, FULL PARITY
// follow-up item H.1) — "Misc" is the catch-all fallback bucket
// (CLAUDE.md invariant #19's schedule_c_bucket default) for a category
// with no clearer Schedule C mapping; a healthy month should have most
// dollars landing in a real, specific category. Misc pulling more than
// 20% of a month's total is a signal worth flagging so the user goes
// back and re-categorizes those rows into something more specific before
// handing the report to their accountant — informational only, never
// blocks anything.
const MISC_WARNING_THRESHOLD = 0.2;

export type MiscConcentrationWarning = { miscAmount: number; miscPct: number };

export function checkMiscConcentration(totals: ScheduleCLineTotal[]): MiscConcentrationWarning | null {
  const grandTotal = totals.reduce((sum, t) => sum + t.amount, 0);
  if (grandTotal <= 0) return null;
  const misc = totals.find((t) => t.category === 'Misc');
  if (!misc || misc.amount <= 0) return null;
  const miscPct = misc.amount / grandTotal;
  if (miscPct <= MISC_WARNING_THRESHOLD) return null;
  return { miscAmount: misc.amount, miscPct };
}

// LUMPER FEES table (spec item B.2 — shown above the category table, not
// buried at the bottom): every line-item already categorized "Lumper
// Fees" by classifySettlementLine()/guessCategory() (owner decision
// 2026-08-05, FULL PARITY part A).
export function buildLumperFees(lineItems: LineItem[]): LineItem[] {
  return lineItems.filter((li) => li.category === 'Lumper Fees');
}

// PER DIEM BLOCK (spec item B.2) — days + dollars for the selected MONTH
// and separately for YEAR-TO-DATE, both computed via the SAME
// `calcPerDiemDays()` every other per-diem figure in the app uses
// (CLAUDE.md invariant #9's deterministic day-counting) — this function
// never re-derives days itself, only re-scopes which settlements are
// summed.
export type PerDiemBlock = { monthDays: number; monthDeduction: number; ytdDays: number; ytdDeduction: number; dailyRate: number };

export function buildPerDiemBlock(
  settlements: Array<{ week_ending: string; per_diem_days?: number | null }>,
  year: number,
  month: number | null,
  perDiem: TaxYearData['per_diem']
): PerDiemBlock {
  const ytdSettlements = settlements.filter((s) => Number((s.week_ending ?? '').slice(0, 4)) === year);
  const monthSettlements =
    month == null ? ytdSettlements : ytdSettlements.filter((s) => Number((s.week_ending ?? '').slice(5, 7)) === month);
  const monthDays = calcPerDiemDays(monthSettlements);
  const ytdDays = calcPerDiemDays(ytdSettlements);
  const rate = perDiem.daily_rate * (perDiem.deductible_pct / 100);
  return { monthDays, monthDeduction: monthDays * rate, ytdDays, ytdDeduction: ytdDays * rate, dailyRate: rate };
}

// CAPITAL ASSETS section (spec item B.6) — truck/trailer/equipment
// purchases, read from the EXISTING trucks/equipment table columns
// (docs/PENDING_SQL.md §36, "asset purchase & financing") rather than a
// separate ledger — NEVER folded into expense totals (a truck purchase
// is depreciable, not a Schedule C expense; Section 179/bonus
// depreciation is the user's CPA's decision, CLAUDE.md invariant #8).
export type CapitalAssetRow = {
  type: 'truck' | 'trailer' | 'equipment';
  name: string;
  date: string | null;
  price: number;
  financing: 'cash' | 'loan' | null;
};

export function buildCapitalAssets(trucks: Truck[], equipment: Equipment[]): CapitalAssetRow[] {
  const rows: CapitalAssetRow[] = [];
  for (const t of trucks) {
    if (t.purchase_price) {
      rows.push({ type: 'truck', name: t.unit_number || 'Truck', date: t.purchase_date, price: Number(t.purchase_price), financing: t.financing });
    }
    if (t.trailer_purchase_price) {
      rows.push({
        type: 'trailer',
        name: t.trailer_unit_number || 'Trailer',
        date: t.trailer_purchase_date,
        price: Number(t.trailer_purchase_price),
        financing: t.trailer_financing,
      });
    }
  }
  for (const e of equipment) {
    if (e.purchase_price) {
      rows.push({ type: 'equipment', name: e.name, date: e.purchase_date, price: Number(e.purchase_price), financing: e.financing });
    }
  }
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

// OWNER'S EQUITY section (spec item B.7) — must NOT double-count: cash
// transfers (no source deduction) and LINKED contributions (auto-created
// from a personally-paid expense) are two DISTINCT pools of the same
// underlying capital_transactions table (`summarizeContributions()`,
// src/stats/capitalAccount.ts, owner decision 2026-08-05 Capital Account
// pass) — the total here is their SUM, counted once each, never adding a
// hidden base constant on top. `unmatchedOwnerPaidCount` surfaces as a
// WARNING (never mis-totalled) whenever this period's line items include
// more owner-paid rows than there are linked contributions to match —
// e.g. a personally-paid receipt imported without the confirmation
// dialog ever being answered.
export type OwnersEquitySummary = {
  cashAmount: number;
  cashCount: number;
  linkedAmount: number;
  linkedCount: number;
  total: number;
  unmatchedOwnerPaidCount: number;
};

export function buildOwnersEquity(contributions: CapitalTransactionLike[], lineItems: LineItem[]): OwnersEquitySummary {
  const breakdown = summarizeContributions(contributions.filter((c) => c.tx_type === 'contribution'));
  const ownerPaidCount = lineItems.filter((li) => li.isOwnerPaid).length;
  const unmatchedOwnerPaidCount = Math.max(0, ownerPaidCount - breakdown.linkedCount);
  return { ...breakdown, total: breakdown.cashAmount + breakdown.linkedAmount, unmatchedOwnerPaidCount };
}
