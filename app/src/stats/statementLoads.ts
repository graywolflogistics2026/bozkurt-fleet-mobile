import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import { isMilelessLoad, loadRevenueByOrder } from '@/src/import/primeLoads';
import type { ExtractedLoad, ExtractedRevenueItem } from '@/src/import/types';
import { num } from '@/src/lib/number';

// STATEMENT LOADS, VIEW ONLY (owner decision 2026-11-24,
// docs/decisions/settlement-loads-view-fix-proposal.md). A week saved with
// "line details not saved" (settlements.statement.linesNotSaved, the gate's
// lineDetails 'mismatch') has no `loads` rows, but its stored reading
// (documents.parsed_json.settlement.loads) lists the printed loads. This
// returns them for DISPLAY ONLY on the Loads screen and the settlement
// detail: they are never records, never counted, never exported.
// ISOLATION: only those two screens may import this module
// (statementLoads.test.ts checks every other file).

export type StatementLoadSettlement = {
  id: string;
  week_ending: string | null;
  truck_id: string | null;
  carrier?: string | null;
  document_id: string | null;
  statement?: { linesNotSaved?: boolean } | null;
};

export type StatementLoadDocument = { id: string; parsed_json: Record<string, unknown> | null };

export type StatementLoad = {
  key: string;
  order: string | null;
  origin: string | null;
  destination: string | null;
  loadedMiles: number;
  emptyMiles: number;
  // The load's revenue from the week's own revenue lines (owner 2026-11-25,
  // docs/decisions/line-details-gate-proposal.md stage 1): the Prime load
  // revenue lines of this order number, summed (primeLoads.ts
  // loadRevenueByOrder, the same helper as the loads check and the save). Those are the owner's amounts that tie to
  // the printed gross. The reader's per-load figure is never used here:
  // in some weeks it is the TRIP column at 100%. Null when no line matches
  // (and for other carriers, where that rule does not apply). Shown only,
  // never counted.
  revenueFromLines: number | null;
};

export type StatementLoadWeek = {
  settlementId: string;
  // Same field name as a load row, so the Loads screen's truck filter
  // (filterLoadsByTruckScope) applies the same rule as to real loads.
  settlement_id: string;
  weekEnding: string;
  truckId: string | null;
  loads: StatementLoad[];
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

type Reading = { carrier: string | null; loads: ExtractedLoad[]; revenueItems: ExtractedRevenueItem[] };

function objects<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => !!x && typeof x === 'object') as T[]) : [];
}

function readLoads(parsedJson: Record<string, unknown> | null): Reading {
  const settlement = parsedJson?.settlement;
  if (!settlement || typeof settlement !== 'object') return { carrier: null, loads: [], revenueItems: [] };
  const s = settlement as Record<string, unknown>;
  return { carrier: text(s.carrier), loads: objects<ExtractedLoad>(s.loads), revenueItems: objects<ExtractedRevenueItem>(s.revenueItems) };
}

// Newest week first. Only weeks saved without line details AND with no
// `loads` rows; Prime loads without miles (adjustments) are hidden, the
// same rule the save uses (primeLoads.ts isMilelessLoad).
export function statementOnlyLoadWeeks(
  settlements: StatementLoadSettlement[],
  documents: StatementLoadDocument[],
  loadRows: { settlement_id: string | null }[]
): StatementLoadWeek[] {
  const withRows = new Set(loadRows.map((l) => l.settlement_id).filter((id): id is string => !!id));
  const docs = new Map(documents.map((d) => [d.id, d]));
  const weeks: StatementLoadWeek[] = [];
  for (const s of settlements) {
    if (!s.statement?.linesNotSaved || !s.week_ending || !s.document_id || withRows.has(s.id)) continue;
    const doc = docs.get(s.document_id);
    if (!doc) continue;
    const read = readLoads(doc.parsed_json);
    const prime = isPrimeCarrier(s.carrier ?? read.carrier);
    const lineRevenue = prime ? loadRevenueByOrder(read.revenueItems) : new Map<string, number>();
    const loads = read.loads
      .filter((l) => !prime || !isMilelessLoad(l))
      .map((l, i) => {
        const order = text(l.order);
        return {
          key: `${s.id}:${i}`,
          order,
          origin: text(l.from),
          destination: text(l.to),
          loadedMiles: num(l.loadedMiles),
          emptyMiles: num(l.emptyMiles),
          revenueFromLines: order ? (lineRevenue.get(order) ?? null) : null,
        };
      });
    if (loads.length === 0) continue;
    weeks.push({ settlementId: s.id, settlement_id: s.id, weekEnding: s.week_ending, truckId: s.truck_id, loads });
  }
  return weeks.sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
}

export function statementLoadCount(weeks: StatementLoadWeek[]): number {
  return weeks.reduce((sum, w) => sum + w.loads.length, 0);
}
