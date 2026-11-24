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
  // there are several): its tolls rows are its breakdown. Which
  // settlements have one is the shared rule (tollLineSettlementIds), the
  // same one the profit core uses.
  const covered = tollLineSettlementIds(input.deductions);
  const coveringLine = new Map<string, TollEntry>();
  for (const e of dedEntries) {
    const sid = e.settlementId;
    if (!sid || !covered.has(sid) || e.kind !== 'tolls') continue;
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

// THE SAME RULE FOR ROWS WITHOUT IDS (owner 2026-11-14): Cash Flow's spend
// events and the Profit Audit cross-check hold rows that may carry no id.
// This runs buildTollsSummary() over them keyed by array index and answers:
// - deductionDate: index -> date for each "Tolls & Scales" deduction (its
//   settlement's week ending, else its own date);
// - countedTolls: index -> date for each tolls row that counts (not
//   covered by a toll/fee line of its own settlement). A tolls row absent
//   from this map is a breakdown row and is never added again.
export type TollRuleDeduction = {
  category?: string | null;
  description?: string | null;
  code?: string | null;
  amount?: number | null;
  ded_date?: string | null;
  settlement_id?: string | null;
  source?: string | null;
};
export type TollRuleToll = {
  plaza?: string | null;
  network?: string | null;
  amount?: number | null;
  toll_date?: string | null;
  settlement_id?: string | null;
  source?: string | null;
};
export type TollRuleSettlement = { id?: string | null; week_ending?: string | null; carrier?: string | null };

// THE SHARED COVERAGE RULE (owner 2026-11-24, docs/decisions/
// toll-rule-profit-core-proposal.md). A deduction is a TOLL LINE when it is
// in "Tolls & Scales", belongs to a settlement, and is of the toll/fee kind
// (not a scale ticket). Its settlement's tolls rows are that line's
// itemized breakdown and are never counted on top of it.
// Coverage is a fact about the SETTLEMENT, never about a date: build it
// from the FULL deductions list, before any date window or truck scope (a
// line dated on its week ending covers plazas dated days earlier).
// `covers` narrows which lines may cover (the profit core passes
// reducesTrueProfit, owner decision T6(b)); the Tolls & Fees screen uses
// every toll line.
export function isTollLine(d: TollRuleDeduction): boolean {
  if (!d.settlement_id || !isTollsScalesCategory(d.category)) return false;
  const description = (d.description ?? '').trim() || TOLLS_SCALES_CATEGORY;
  return tollKindOf(`${d.code ?? ''} ${description}`) === 'tolls';
}

export function tollLineSettlementIds<D extends TollRuleDeduction>(
  deductions: ReadonlyArray<D>,
  covers: (d: D) => boolean = () => true
): Set<string> {
  const ids = new Set<string>();
  for (const d of deductions) if (isTollLine(d) && covers(d)) ids.add(d.settlement_id as string);
  return ids;
}

// The tolls rows that count: every row except the breakdown rows of a
// settlement with a toll line. Safe to run twice, or again on a filtered
// subset: a row left after a pass over the full list has no covering line
// anywhere, so no subset can cover it.
// (Some row types, e.g. truckComparison's ComparisonToll, do not declare
// settlement_id; the database rows always carry it.)
export function withoutCoveredTolls<T extends object, D extends TollRuleDeduction>(
  tolls: ReadonlyArray<T>,
  deductions: ReadonlyArray<D>,
  covers?: (d: D) => boolean
): T[] {
  const covered = tollLineSettlementIds(deductions, covers);
  return tolls.filter((t) => {
    const sid = (t as { settlement_id?: string | null }).settlement_id;
    return !sid || !covered.has(sid);
  });
}

export function tollRuleByIndex(
  deductions: ReadonlyArray<TollRuleDeduction>,
  tolls: ReadonlyArray<TollRuleToll>,
  settlements: ReadonlyArray<TollRuleSettlement> = []
): { deductionDate: Map<number, string | null>; countedTolls: Map<number, string | null> } {
  const summary = buildTollsSummary({
    deductions: deductions.map((d, i) => ({
      id: String(i),
      category: d.category ?? null,
      description: d.description ?? null,
      code: d.code ?? null,
      amount: d.amount ?? null,
      ded_date: d.ded_date ?? null,
      settlement_id: d.settlement_id ?? null,
      source: d.source ?? null,
    })),
    tolls: tolls.map((t, i) => ({
      id: String(i),
      plaza: t.plaza ?? null,
      network: t.network ?? null,
      amount: t.amount ?? null,
      toll_date: t.toll_date ?? null,
      settlement_id: t.settlement_id ?? null,
      source: t.source ?? null,
    })),
    settlements: settlements.filter((s): s is TollRuleSettlement & { id: string } => !!s.id).map((s) => ({ id: s.id, week_ending: s.week_ending ?? null, carrier: s.carrier ?? null })),
    period: 'all',
  });
  const deductionDate = new Map<number, string | null>();
  const countedTolls = new Map<number, string | null>();
  for (const e of summary.entries) (e.table === 'deductions' ? deductionDate : countedTolls).set(Number(e.id), e.date);
  return { deductionDate, countedTolls };
}
