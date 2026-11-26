import type { Extraction, ExtractedLoad, ExtractedRevenueItem } from './types';
import { parseAmount } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeStatementLabel, statementInfoRow } from './primeStatementLines';
import { numOrNull } from '@/src/lib/number';

// PRIME LOADS (owner decision 2026-10-17, week ending 2026-08-14). PRIME
// ONLY — carrier isolation: an "RV" revenue line means something only on a
// Prime settlement.
//   - An RV line with no miles (e.g. "Linehaul 47.34-", order 4845329) is
//     an ADJUSTMENT to load revenue, never a load.
//   - Loads check: Σ load revenue + Σ adjustments = the statement's
//     REVENUE FROM PRIME INC. (8/14: 2,900.40 + 1,763.24 + 1,451.40 − 47.34
//     = 6,067.70; 8/21: 1,505.71 + 1,839.41 = 3,345.12). On a mismatch the
//     loads are saved with no revenue and the week is flagged needs-review
//     — gross never comes from loads, so profit is untouched either way.
// STAGE 2 (owner 2026-11-25, docs/decisions/advance-family-rule-proposal.md
// section 5 and "Stage 2 evidence 2026-11-25"): a load with miles takes its
// revenue from the SUM of the week's own revenue lines of its order number
// that match LOAD_REVENUE_DESC, never from the reader's per-load figure (in
// some weeks that is the TRIP column at 100%). A load with miles and no
// such line, or with no order number, is a named failure,
// load_without_revenue_line: never a 0 that quietly passes, never the
// reader's figure as a fallback.

export type PrimeLoadAdjustment = { order: string | null; desc: string | null; amount: number };

export type PrimeLoadFailure = { reason: 'load_without_revenue_line'; order: string | null };

export type PrimeLoadSplit = {
  loads: ExtractedLoad[];
  // Per load (same index as `loads`): its order's load revenue line sum;
  // null when it has none (then `failures` names it). An order shared by
  // two loads is counted once, on its first load (the next gets 0).
  lineRevenue: (number | null)[];
  failures: PrimeLoadFailure[];
  adjustments: PrimeLoadAdjustment[];
  // Σ lineRevenue.
  loadRevenue: number;
  // The reader's own per-load figures, for comparison only: never used by
  // the check or the save.
  readerLoadRevenue: number;
  adjustmentTotal: number;
  // The statement's REVENUE FROM PRIME INC. line; null when not read.
  statementRevenue: number | null;
  // null = nothing to compare (no loads, or no statement line); false on
  // any named failure.
  matches: boolean | null;
};

const TOLERANCE = 1.0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (v: unknown) => {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : 0;
};
const milesOf = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const orderOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// A load line is a real load only when it carries miles.
export function isMilelessLoad(load: ExtractedLoad): boolean {
  return milesOf(load.loadedMiles) === 0 && milesOf(load.emptyMiles) === 0;
}

// A revenue line that is load revenue for an order (linehaul / trip /
// load / owner revenue), as opposed to fuel surcharge, incentives, stops.
export const LOAD_REVENUE_DESC = /\bLINE\s*HAUL\b|\bTRIP\s+REV|\bLOAD\s+REV|\bOWNER\s+REV/i;

// Order number -> the sum of that order's load revenue lines
// (LOAD_REVENUE_DESC), to the cent. ONE helper for the loads check, the
// save and the view-only statement loads (src/stats/statementLoads.ts). A
// line with no order number or a non-numeric amount is skipped.
export function loadRevenueByOrder(revenueItems: readonly ExtractedRevenueItem[] | null | undefined): Map<string, number> {
  const byOrder = new Map<string, number>();
  for (const r of revenueItems ?? []) {
    const order = orderOf(r.order);
    const amount = numOrNull(r.amount);
    if (!order || amount == null || !LOAD_REVENUE_DESC.test(r.desc ?? '')) continue;
    byOrder.set(order, round2((byOrder.get(order) ?? 0) + amount));
  }
  return byOrder;
}

export function splitPrimeLoads(extraction: Extraction | null | undefined): PrimeLoadSplit | null {
  const s = extraction?.settlement;
  if (!s || !isPrimeCarrier(s.carrier)) return null;
  const all = s.loads ?? [];
  const loads = all.filter((l) => !isMilelessLoad(l));
  const realOrders = new Set(loads.map((l) => orderOf(l.order)).filter((o): o is string => !!o));

  const adjustments: PrimeLoadAdjustment[] = all
    .filter(isMilelessLoad)
    .filter((l) => amountOf(l.revenue) !== 0)
    .map((l) => ({ order: orderOf(l.order), desc: null, amount: amountOf(l.revenue) }));
  const adjustmentOrders = new Set(adjustments.map((a) => a.order).filter((o): o is string => !!o));
  // The same adjustment printed only as a revenue line (the AI did not list
  // it under loads): an order with no load, read as load revenue.
  for (const r of s.revenueItems ?? []) {
    const order = orderOf(r.order);
    if (!order || realOrders.has(order) || adjustmentOrders.has(order)) continue;
    if (!LOAD_REVENUE_DESC.test(r.desc ?? '') || amountOf(r.amount) === 0) continue;
    adjustments.push({ order, desc: r.desc ?? null, amount: amountOf(r.amount) });
    adjustmentOrders.add(order);
  }

  const statementLines = (s.operating?.lines ?? []).filter(
    (l) => l.section === 'revenue' && !!l.label && !statementInfoRow(l.label) && normalizeStatementLabel(l.label) === 'REVENUE FROM PRIME INC'
  );
  const statementRevenue = statementLines.length > 0 ? round2(statementLines.reduce((sum, l) => sum + amountOf(l.amount), 0)) : null;

  const byOrder = loadRevenueByOrder(s.revenueItems);
  const failures: PrimeLoadFailure[] = [];
  const counted = new Set<string>();
  const lineRevenue = loads.map((l): number | null => {
    const order = orderOf(l.order);
    const sum = order ? byOrder.get(order) : undefined;
    if (!order || sum == null) {
      failures.push({ reason: 'load_without_revenue_line', order });
      return null;
    }
    if (counted.has(order)) return 0;
    counted.add(order);
    return sum;
  });
  const loadRevenue = round2(lineRevenue.reduce((sum: number, r) => sum + (r ?? 0), 0));
  const readerLoadRevenue = round2(loads.reduce((sum, l) => sum + amountOf(l.revenue), 0));
  const adjustmentTotal = round2(adjustments.reduce((sum, a) => sum + a.amount, 0));
  const matches =
    loads.length === 0
      ? null
      : failures.length > 0
        ? false
        : statementRevenue == null
          ? null
          : Math.abs(loadRevenue + adjustmentTotal - statementRevenue) <= TOLERANCE;
  return { loads, lineRevenue, failures, adjustments, loadRevenue, readerLoadRevenue, adjustmentTotal, statementRevenue, matches };
}
