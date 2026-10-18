import type { Extraction, ExtractedLoad } from './types';
import { parseAmount } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeStatementLabel, statementInfoRow } from './primeStatementLines';

// PRIME LOADS (owner decision 2026-10-17, week ending 2026-08-14). PRIME
// ONLY — carrier isolation: an "RV" revenue line means something only on a
// Prime settlement.
//   - An RV line with no miles (e.g. "Linehaul 47.34-", order 4845329) is
//     an ADJUSTMENT to load revenue, never a load.
//   - Loads check: Σ load OWNER REVENUE + Σ adjustments = the statement's
//     REVENUE FROM PRIME INC. (8/14: 2,900.40 + 1,763.24 + 1,451.40 − 47.34
//     = 6,067.70; 8/21: 1,505.71 + 1,839.41 = 3,345.12). On a mismatch the
//     loads are saved with no revenue and the week is flagged needs-review
//     — gross never comes from loads, so profit is untouched either way.

export type PrimeLoadAdjustment = { order: string | null; desc: string | null; amount: number };

export type PrimeLoadSplit = {
  loads: ExtractedLoad[];
  adjustments: PrimeLoadAdjustment[];
  loadRevenue: number;
  adjustmentTotal: number;
  // The statement's REVENUE FROM PRIME INC. line; null when not read.
  statementRevenue: number | null;
  // null = nothing to compare (no statement line, or no loads).
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
const LOAD_REVENUE_DESC = /\bLINE\s*HAUL\b|\bTRIP\s+REV|\bLOAD\s+REV|\bOWNER\s+REV/i;

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

  const loadRevenue = round2(loads.reduce((sum, l) => sum + amountOf(l.revenue), 0));
  const adjustmentTotal = round2(adjustments.reduce((sum, a) => sum + a.amount, 0));
  const matches =
    statementRevenue == null || loads.length === 0 ? null : Math.abs(loadRevenue + adjustmentTotal - statementRevenue) <= TOLERANCE;
  return { loads, adjustments, loadRevenue, adjustmentTotal, statementRevenue, matches };
}
