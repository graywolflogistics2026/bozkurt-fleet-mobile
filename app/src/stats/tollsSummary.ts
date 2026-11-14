// TOLLS & FEES SCREEN (owner 2026-11-13). What the screen lists and totals.
// Screen-only: profit, Home, KPIs, Capital and what an import saves are
// untouched.
//
// Rows:
// - every deduction in the "Tolls & Scales" category (withheld by a
//   settlement AND paid by the owner);
// - every row of the `tolls` table that is NOT covered by a toll/fee
//   deduction of its own settlement (no settlement_id, or its settlement
//   has no toll/fee deduction).
// A `tolls` row whose settlement HAS a toll/fee deduction is that line's
// itemized breakdown (e.g. HCTRA/NJTP plazas under "EZ EZ FAST LN TOLL0024
// thru 09/09"): shown under the line, never added again. A deduction and
// the tolls rows of its own settlement are never summed together.
//
// Subtotals, by description: SCALES = "weight ticket(s)", "cat scale", or
// the word "scale(s)"; everything else (EZ FAST LN, DRVWYZE WGH STN, plaza
// names, transponder fees) = TOLLS & FEES. A Drivewyze weigh-station
// bypass is a fee, not a scale ticket.
//
// Period: the shared PERIOD_OPTIONS window (src/stats/periodFilter.ts). A
// settlement row is dated by its settlement's week ending; an own row by
// its own date.

import { filterByPeriod, type PeriodOption } from '@/src/stats/periodFilter';

export const TOLLS_SCALES_CATEGORY = 'Tolls & Scales';

export type TollKind = 'tolls' | 'scales';

const SCALES_RE = /weight\s*tickets?|\bcat\s*scales?\b|\bscales?\b/i;

export function tollKindOf(description: string | null | undefined): TollKind {
  return SCALES_RE.test(description ?? '') ? 'scales' : 'tolls';
}

export type TollsDeductionIn = {
  id: string;
  category: string | null;
  description: string | null;
  code?: string | null;
  amount: number | null;
  ded_date: string | null;
  settlement_id: string | null;
  source: string | null;
};

export type TollsTableIn = {
  id: string;
  plaza: string | null;
  network: string | null;
  amount: number | null;
  toll_date: string | null;
  settlement_id: string | null;
  source: string | null;
};

export type TollsSettlementIn = { id: string; week_ending: string | null; carrier?: string | null };

export type TollBreakdownItem = { id: string; date: string | null; label: string; amount: number };

export type TollEntry = {
  key: string;
  table: 'deductions' | 'tolls';
  id: string;
  // Settlement rows: the week ending; own rows: their own date.
  date: string | null;
  description: string;
  amount: number;
  kind: TollKind;
  // Withheld by a settlement (carrier) vs paid by the owner.
  withheld: boolean;
  carrier: string | null;
  settlementId: string | null;
  // Itemized tolls rows of this line's settlement (informational only).
  breakdown: TollBreakdownItem[];
};

export type TollsSummary = {
  entries: TollEntry[];
  tolls: number;
  scales: number;
  total: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const amt = (n: number | null | undefined) => Number(n ?? 0) || 0;

function isTollsScalesCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === TOLLS_SCALES_CATEGORY.toLowerCase();
}

export function buildTollsSummary(input: {
  deductions: TollsDeductionIn[];
  tolls: TollsTableIn[];
  settlements: TollsSettlementIn[];
  period: PeriodOption;
  now?: Date;
}): TollsSummary {
  const settlementById = new Map(input.settlements.map((s) => [s.id, s]));
  const weekOf = (settlementId: string | null) => (settlementId ? settlementById.get(settlementId)?.week_ending ?? null : null);
  const carrierOf = (settlementId: string | null) => (settlementId ? settlementById.get(settlementId)?.carrier ?? null : null);
  const isWithheld = (r: { settlement_id: string | null; source: string | null }) => !!r.settlement_id || r.source === 'settlement';

  const dedEntries: TollEntry[] = input.deductions
    .filter((d) => isTollsScalesCategory(d.category))
    .map((d) => {
      const description = (d.description ?? '').trim() || TOLLS_SCALES_CATEGORY;
      return {
        key: `d:${d.id}`,
        table: 'deductions' as const,
        id: d.id,
        date: weekOf(d.settlement_id) ?? d.ded_date,
        description,
        amount: amt(d.amount),
        kind: tollKindOf(`${d.code ?? ''} ${description}`),
        withheld: isWithheld(d),
        carrier: carrierOf(d.settlement_id),
        settlementId: d.settlement_id,
        breakdown: [],
      };
    });

  // The toll/fee line of each settlement that has one (the largest when
  // there are several): its tolls rows are its breakdown.
  const coveringLine = new Map<string, TollEntry>();
  for (const e of dedEntries) {
    const sid = e.settlementId;
    if (!sid || e.kind !== 'tolls') continue;
    const prev = coveringLine.get(sid);
    if (!prev || e.amount > prev.amount) coveringLine.set(sid, e);
  }

  const tollEntries: TollEntry[] = [];
  for (const t of input.tolls) {
    const label = (t.plaza ?? '').trim() || (t.network ?? 'other');
    const line = t.settlement_id ? coveringLine.get(t.settlement_id) : undefined;
    if (line) {
      line.breakdown.push({ id: t.id, date: t.toll_date, label, amount: amt(t.amount) });
      continue;
    }
    tollEntries.push({
      key: `t:${t.id}`,
      table: 'tolls',
      id: t.id,
      date: weekOf(t.settlement_id) ?? t.toll_date,
      description: label,
      amount: amt(t.amount),
      kind: tollKindOf(t.plaza),
      withheld: isWithheld(t),
      carrier: carrierOf(t.settlement_id),
      settlementId: t.settlement_id,
      breakdown: [],
    });
  }
  for (const e of dedEntries) e.breakdown.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  const entries = filterByPeriod([...dedEntries, ...tollEntries], (e) => e.date, input.period, input.now).sort(
    (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.amount - a.amount
  );
  const tolls = r2(entries.filter((e) => e.kind === 'tolls').reduce((s, e) => s + e.amount, 0));
  const scales = r2(entries.filter((e) => e.kind === 'scales').reduce((s, e) => s + e.amount, 0));
  return { entries, tolls, scales, total: r2(tolls + scales) };
}
