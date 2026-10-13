import type { Deduction, Settlement } from '@/src/types/db';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';

// TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31, follow-up to the
// UX mega-pass's Net-to-Owner audit fix): the ONE canonical "what does
// the owner actually net" calculation — Home, Scorecard's own weekly
// trend, CEO Mode / AI Coach, Share Weekly Profit, and Profit Analysis
// all consume this instead of each computing (or mis-computing) their
// own version.
//
// profit = grossRevenue − every REAL deductible expense (withheld +
// out-of-pocket alike), computed by starting from GROSS rather than a
// settlement's own `net` field. Two things this gets right that the
// screens it replaces did not:
//
// 1. NEVER double-counts or under-counts withheld chargebacks. Starting
//    from `net` (gross minus withheld deductions already baked in) and
//    then ALSO subtracting out-of-pocket deductions is CLAUDE.md
//    invariant #1's tax-model shortcut; starting from GROSS and
//    subtracting every deduction row (withheld + out-of-pocket) once
//    produces the identical number a different way (verified equal by
//    src/stats/profitLoss.ts's own header comment — "gross - withheld
//    already equals settlement net by definition"). This module always
//    takes the GROSS route so a caller never has to reason about which
//    rows are already "in" a settlement's `net`.
// 2. EXCLUDES deductions marked `tax_deductible: false` — a Meal already
//    covered by the per diem allowance, or an Advance Repayment (CLAUDE.md's
//    NON_DEDUCTIBLE_CATEGORIES, src/import/category.ts). An advance
//    repayment is literally returning already-received money, never a
//    real expense; a per-diem-covered meal receipt would double-count
//    against the per diem allowance if also subtracted here. The prior
//    Dashboard "Net to Owner" fix (UX mega-pass) used grossRevenue −
//    ALL deductions unconditionally, which OVER-subtracted these two
//    categories when present — this module is the corrected version.
//
// Deliberately NOT used by src/stats/profitLoss.ts's buildProfitLoss()
// (Operating P&L, a verbatim legacy rOper() port — counts every
// deduction unconditionally, by design, for accountant/legacy-parity
// purposes) or src/stats/scorecard.ts's calcScorecard() (a verbatim
// legacy rScore() port, same "operating" ALL-deductions definition by
// design). Those two stay exactly as documented — this module is for
// every OTHER "what's my profit" figure in the app.
export function isDeductibleExpense(d: { tax_deductible: boolean | null }): boolean {
  return d.tax_deductible !== false;
}

// CRITICAL BUG FIX (device feedback 2026-07-31, "Cash Flow shows revenue
// with none of the settlement's expenses subtracted"): mapSettlement()
// stamps EVERY settlement-withheld row tax_deductible:false unconditionally
// (CLAUDE.md invariant #1 defense-in-depth, so a withheld chargeback is
// never double-counted as a TAX deduction) — but isDeductibleExpense() was
// also being used here to decide whether a row reduces TRUE PROFIT, which
// is a different question. That made calcTrueProfit() silently skip every
// withheld dollar (fuel advance, insurance, ELD fees, tolls, escrow...)
// instead of subtracting it, exactly contradicting this file's own header
// comment ("gross - every deduction row, withheld + out-of-pocket, once").
// A withheld row genuinely left the settlement check — it must count —
// UNLESS it's one of three specific non-expense categories: a per-diem-
// covered meal (owner decision 2026-07-17, already covered by the per
// diem allowance, never a new expense), an Advance Repayment (owner
// decision 2026-07-17, loan principal being returned, not a new expense
// either), or Escrow & Deposits (owner decision 2026-08-02, verified
// against a real statement with a "PERFORMNCE BOND" line — a performance
// bond/escrow reserve/tire fund/emergency fund/maintenance reserve is a
// REFUNDABLE DEPOSIT the carrier holds, not a cost that reduces profit).
// These three stay excluded regardless of source; every other withheld
// row still counts.
const TRUE_PROFIT_EXCLUDED_CATEGORIES = new Set(['Meals (per diem covered)', 'Advance Repayment', 'Escrow & Deposits']);

export function reducesTrueProfit(d: {
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
}): boolean {
  if (TRUE_PROFIT_EXCLUDED_CATEGORIES.has(d.category ?? '')) return false;
  if (d.source === 'settlement') return true;
  return isDeductibleExpense(d);
}

// FULL PARITY pass (owner decision 2026-08-05, spec item C.2 "ONE
// CANONICAL EXPENSE ENGINE... INCLUDING fuel, maintenance and tolls — the
// dashboard total must never be just the deductions table"). Audit
// finding: fuel_purchases/maintenance_records/tolls are their OWN tables,
// never mirrored into `deductions` — a standalone (non-settlement) fuel
// receipt, maintenance invoice, or toll charge was a REAL out-of-pocket
// cost that calcTrueProfit()/calcCpm()/buildProfitLoss() ALL silently
// missed entirely, since every one of them only ever summed `deductions`.
// (`src/stats/accountantPackage.ts`'s buildAccountantPackage() already
// folds fuel_purchases/maintenance_records in — this is what extends that
// same fix to every OTHER "what's my profit/cost" figure in the app, per
// the spec's explicit "one canonical engine" requirement.)
//
// DOUBLE-COUNT GUARD, fuel only — PER ROW (golden settlement pass, owner
// decision 2026-10-13, docs/decisions/golden-settlement.md). A settlement's
// fuel can arrive in two places: its withheld deductions ("TRACTOR FUEL
// 60.44") and/or its own itemized fuel list (fuel_purchases rows stamped
// with the settlement's id). The old guard skipped EVERY settlement-linked
// fuel row on the assumption that the same fuel was always also in the
// deductions — when the extraction put fuel only in the fuel list, the
// whole week's fuel vanished from profit (the golden Prime settlement read
// $4,577 instead of $2,534). Now a settlement-linked fuel row is skipped
// only when a withheld fuel deduction OF THE SAME SETTLEMENT matches it
// (same amount within one cent — the row's charged amount or its amount
// net of its per-line discount — and the same fuel type or date); each
// deduction line can cover one fuel row at most. Every other row counts
// once. A counted settlement-linked row counts at its CHARGED amount: its
// per-line discount column is informational, because the settlement
// applies the discount through its own credit lines (Prime's UD/RD/ED),
// which are already negative deductions — subtracting both would double
// the discount. Standalone fuel (settlement_id null, a receipt imported on
// its own) still counts amount minus discount, as before. tolls/
// maintenance_records have no settlement_id to match on — same as
// buildAccountantPackage()'s precedent, they're added unconditionally.

export type CanonicalFuel = {
  amount: number | null;
  discount?: number | null;
  settlement_id?: string | null;
  fuel_type?: string | null;
  purchase_date?: string | null;
};
type CanonicalMaintenance = { cost: number | null };
type CanonicalToll = { amount: number | null };
export type CanonicalDeduction = {
  amount: number | null;
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
  settlement_id?: string | null;
  description?: string | null;
  ded_date?: string | null;
};
// REIMBURSEMENTS OFFSET EXPENSES (golden settlement pass, owner decision
// 2026-10-13, every carrier): a reimbursement repays a cost the business
// already booked (reefer fuel, a trailer wash, a lumper), so it reduces
// expenses — it is NEVER counted as revenue, which keeps RPM on the
// carrier's own revenue figure. Prime prints the same convention on its
// operating statement (REEFER FUEL 262.53 deducted − 216.30 reimbursed =
// 46.23).
export type CanonicalReimbursement = { amount: number | null };

const FUEL_LINE_RE = /\b(fuel|diesel|def|reefer|reef)\b/i;
const NOT_FUEL_COST_RE = /\b(tax|taxes|card|dscnt|discount|surcg|surc|surcharge|additives?)\b/i;

// A withheld deduction line that is itself a fuel/DEF purchase (not a fuel
// tax, fuel-card fee, discount credit or surcharge).
export function isWithheldFuelLine(d: CanonicalDeduction): boolean {
  if (Number(d.amount ?? 0) <= 0) return false;
  const text = d.description ?? '';
  if (NOT_FUEL_COST_RE.test(text)) return false;
  return d.category === 'Fuel & DEF' || FUEL_LINE_RE.test(text);
}

function fuelTypeOfLine(d: CanonicalDeduction): 'tractor' | 'reefer' {
  return /\breef/i.test(d.description ?? '') ? 'reefer' : 'tractor';
}

const CENT_TOLERANCE = 0.01 + 1e-9;

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= CENT_TOLERANCE;
}

export type ResolvedFuelRow<F> = { row: F; cost: number };

// The ONE place that decides which fuel rows count and for how much —
// canonicalExpenseBreakdown() and calcCanonicalCpm() (src/stats/cpm.ts)
// both read it, so profit and CPM can never disagree about fuel.
export function resolveFuelRows<F extends CanonicalFuel>(
  fuelPurchases: F[],
  deductions: CanonicalDeduction[]
): { counted: ResolvedFuelRow<F>[]; skippedAsDuplicate: F[] } {
  const unusedLines = new Map<string, CanonicalDeduction[]>();
  for (const d of deductions) {
    if (!d.settlement_id || !isWithheldFuelLine(d)) continue;
    const list = unusedLines.get(d.settlement_id) ?? [];
    list.push(d);
    unusedLines.set(d.settlement_id, list);
  }

  const counted: ResolvedFuelRow<F>[] = [];
  const skippedAsDuplicate: F[] = [];
  for (const f of fuelPurchases) {
    const amount = Number(f.amount ?? 0);
    const discount = Number(f.discount ?? 0);
    if (!f.settlement_id) {
      counted.push({ row: f, cost: Math.max(0, amount - discount) });
      continue;
    }
    const candidates = unusedLines.get(f.settlement_id) ?? [];
    const matchIndex = candidates.findIndex((d) => {
      const lineAmount = Number(d.amount ?? 0);
      const amountMatches = sameAmount(lineAmount, amount) || (discount > 0 && sameAmount(lineAmount, amount - discount));
      if (!amountMatches) return false;
      const typeMatches = !!f.fuel_type && fuelTypeOfLine(d) === f.fuel_type;
      const dateMatches = !!f.purchase_date && d.ded_date === f.purchase_date;
      return typeMatches || dateMatches;
    });
    if (matchIndex >= 0) {
      candidates.splice(matchIndex, 1);
      skippedAsDuplicate.push(f);
      continue;
    }
    counted.push({ row: f, cost: amount });
  }
  return { counted, skippedAsDuplicate };
}

export function sumReimbursements(reimbursements: CanonicalReimbursement[]): number {
  return reimbursements.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
}

// Settlement-linked fuel and reimbursement rows belong to their
// SETTLEMENT's week, not to the per-line purchase date printed beside them
// (a Prime week ending 8/21 itemizes fuel bought 8/13) — otherwise part of
// a week's own fuel lands outside that week's window. Standalone rows keep
// their own date. `inWindowSettlementIds` = the settlements already inside
// the window/scope being computed.
export function filterSettlementLinkedRowsToWindow<R extends { settlement_id?: string | null }>(
  rows: R[],
  getDate: (row: R) => string | null | undefined,
  inWindowSettlementIds: Set<string>,
  inWindow: (date: string) => boolean
): R[] {
  return rows.filter((r) => {
    if (r.settlement_id) return inWindowSettlementIds.has(r.settlement_id);
    const d = getDate(r);
    return !!d && inWindow(d);
  });
}

// "GHOST VALUE" pass (owner decision 2026-08-28) — src/stats/
// profitAnalysis.ts's own reconciliation breakdown (Profit Analysis
// screen: "$X deductions (Y excluded) + $Z fuel + $W maintenance + $V
// tolls − $R reimbursements = $Total Expenses") needs the SAME
// per-category math sumCanonicalExpenses() computes, not a second,
// possibly-drifting reimplementation.
export type CanonicalExpenseBreakdown = {
  deductionsTotal: number;
  fuelTotal: number;
  maintenanceTotal: number;
  tollsTotal: number;
  reimbursementsTotal: number;
  total: number;
};

// Every expense source is REQUIRED (never an optional `= []`) — a
// forgotten source silently overstates profit, the exact bug class the
// golden settlement exposed for reimbursements.
export function canonicalExpenseBreakdown(
  deductions: CanonicalDeduction[],
  fuelPurchases: CanonicalFuel[],
  maintenanceRecords: CanonicalMaintenance[],
  tolls: CanonicalToll[],
  reimbursements: CanonicalReimbursement[]
): CanonicalExpenseBreakdown {
  const deductionsTotal = deductions.filter(reducesTrueProfit).reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
  const fuelTotal = resolveFuelRows(fuelPurchases, deductions).counted.reduce((sum, r) => sum + r.cost, 0);
  const maintenanceTotal = maintenanceRecords.reduce((sum, m) => sum + Number(m.cost ?? 0), 0);
  const tollsTotal = tolls.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  const reimbursementsTotal = sumReimbursements(reimbursements);
  return {
    deductionsTotal,
    fuelTotal,
    maintenanceTotal,
    tollsTotal,
    reimbursementsTotal,
    total: deductionsTotal + fuelTotal + maintenanceTotal + tollsTotal - reimbursementsTotal,
  };
}

// Exported so every OTHER "what's my profit/cost" module can share the
// exact same canonical total instead of re-deriving its own — the whole
// point of spec item C.2's "ONE canonical expense engine."
export function sumCanonicalExpenses(
  deductions: CanonicalDeduction[],
  fuelPurchases: CanonicalFuel[],
  maintenanceRecords: CanonicalMaintenance[],
  tolls: CanonicalToll[],
  reimbursements: CanonicalReimbursement[]
): number {
  return canonicalExpenseBreakdown(deductions, fuelPurchases, maintenanceRecords, tolls, reimbursements).total;
}

export function calcTrueProfit(
  settlements: Array<{ gross: number | null }>,
  deductions: CanonicalDeduction[],
  fuelPurchases: CanonicalFuel[],
  maintenanceRecords: CanonicalMaintenance[],
  tolls: CanonicalToll[],
  reimbursements: CanonicalReimbursement[]
): number {
  const grossRevenue = settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
  const trueExpenses = sumCanonicalExpenses(deductions, fuelPurchases, maintenanceRecords, tolls, reimbursements);
  return grossRevenue - trueExpenses;
}

// Same {weekEnding, gross, net} shape as cashFlowTrend.ts's
// buildWeeklyTrend() — a deliberate drop-in replacement wherever `.net`
// was being read as "profit" rather than literally "this settlement's
// own net pay field." `net` here is calcTrueProfit()'s figure for that
// week's settlements + deductions/fuel/maintenance/tolls/reimbursements
// dated within the settlement's 7-day window (weekStartFromEnding..
// weekEnding); settlement-linked fuel/reimbursement rows follow their
// settlement's week (filterSettlementLinkedRowsToWindow()).
export type TrueProfitWeeklyPoint = { weekEnding: string; gross: number; net: number };

export function buildWeeklyTrueProfitTrend(
  settlements: Settlement[],
  deductions: Deduction[],
  fuelPurchases: Array<CanonicalFuel & { purchase_date?: string | null }>,
  maintenanceRecords: Array<CanonicalMaintenance & { service_date?: string | null }>,
  tolls: Array<CanonicalToll & { toll_date?: string | null }>,
  reimbursements: Array<CanonicalReimbursement & { settlement_id?: string | null; reimb_date?: string | null }>
): TrueProfitWeeklyPoint[] {
  const weekEndings = [...new Set(settlements.filter((s) => s.week_ending).map((s) => s.week_ending as string))].sort();

  return weekEndings.map((weekEnding) => {
    const weekSettlements = settlements.filter((s) => s.week_ending === weekEnding);
    const weekSettlementIds = new Set(weekSettlements.map((s) => s.id));
    const gross = weekSettlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);
    const start = weekStartFromEnding(weekEnding);
    const inRange = (dateStr: string) => dateStr >= start && dateStr <= weekEnding;
    const inWindow = (dateStr: string | null | undefined) => !!dateStr && inRange(dateStr);
    const weekDeductions = deductions.filter((d) => inWindow(d.ded_date));
    const weekFuel = filterSettlementLinkedRowsToWindow(fuelPurchases, (f) => f.purchase_date, weekSettlementIds, inRange);
    const weekMaintenance = maintenanceRecords.filter((m) => inWindow(m.service_date));
    const weekTolls = tolls.filter((t) => inWindow(t.toll_date));
    const weekReimbursements = filterSettlementLinkedRowsToWindow(reimbursements, (r) => r.reimb_date, weekSettlementIds, inRange);
    const trueExpenses = sumCanonicalExpenses(weekDeductions, weekFuel, weekMaintenance, weekTolls, weekReimbursements);
    return { weekEnding, gross, net: gross - trueExpenses };
  });
}
