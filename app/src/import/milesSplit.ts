import { numOrNull } from '@/src/lib/number';
import { isPrimeCarrier } from '@/src/import/primeOperatingStatement';
import type { ExtractedLoad } from '@/src/import/types';

// LOADED / EMPTY MILES PER WEEK (owner decision 2026-10-30, master plan
// batch C item 6). One reader turns a settlement extraction into the
// week's loaded / empty / total split, stored on the settlement
// (settlements.loaded_miles / empty_miles / miles_split_*, PENDING_SQL §82)
// so Home, Scorecard and the Miles list read one figure per week.
//
// - Prime keeps its exact reading: the RV lines' LOADED and EMPTY columns
//   (loads[].loadedMiles / emptyMiles), label "empty".
// - Any other carrier: the generic reader over the printed weekly miles
//   lines (settlement.milesLines, ai-import) — "deadhead", "DH",
//   "unloaded", "empty" all mean empty miles; the label the statement used
//   is kept. Only loaded + total printed -> empty = total - loaded, marked
//   "derived". A deadhead PAY line without miles is NOT the week's empty
//   miles (flagged). Bobtail and out-of-route miles are never deadhead.
//   Cumulative (LTD/YTD/QTD) lines are ignored.
// - Nothing recognizable -> null (never 0); the Miles card counts those
//   weeks as "without breakdown".

export type MilesSplitSource = 'loads' | 'statement' | 'derived' | 'manual';
export type MilesSplitFlag = 'deadhead_pay_without_miles';

export type ExtractedMilesLine = { label?: string | null; miles?: number | string | null };

export type MilesSplit = {
  loaded: number | null;
  empty: number | null;
  total: number | null;
  source: MilesSplitSource | null;
  // The statement's own word for empty miles ("EMPTY", "DEADHEAD", "DH",
  // "UNLOADED"); null when nothing was printed.
  label: string | null;
  flag: MilesSplitFlag | null;
};

const NO_SPLIT: MilesSplit = { loaded: null, empty: null, total: null, source: null, label: null, flag: null };

const CUMULATIVE = /\b(LTD|YTD|QTD|LIFE|LIFETIME|TO[\s-]*DATE|ODOMETER|ODO)\b/;
const NEVER_DEADHEAD = /BOBTAIL|OUT[\s-]*OF[\s-]*ROUTE|\bOOR\b/;
const EMPTY_WORD = /\b(EMPTY|MT|UNLOADED|DEAD[\s-]*HEAD|DH)\b/;
const LOADED_WORD = /\b(LOADED|REVENUE MILES|PAID MILES|DISPATCHED MILES)\b/;
const TOTAL_WORD = /\b(TOTAL|WEEK(LY)?)\b/;

export type MilesLineKind = 'loaded' | 'empty' | 'total' | 'ignored';

export function classifyMilesLabel(rawLabel: string | null | undefined): { kind: MilesLineKind; word: string | null } {
  const label = (rawLabel ?? '').toUpperCase().replace(/[^A-Z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label || CUMULATIVE.test(label) || NEVER_DEADHEAD.test(label)) return { kind: 'ignored', word: null };
  const empty = label.match(EMPTY_WORD);
  if (empty) return { kind: 'empty', word: empty[1] };
  if (LOADED_WORD.test(label)) return { kind: 'loaded', word: null };
  if (TOTAL_WORD.test(label) || /\bMILES?\b/.test(label)) return { kind: 'total', word: null };
  return { kind: 'ignored', word: null };
}

function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : numOrNull(v == null ? null : String(v));
  return n != null && Number.isFinite(n) && n >= 0 ? n : null;
}

function primeSplit(loads: Pick<ExtractedLoad, 'loadedMiles' | 'emptyMiles'>[]): MilesSplit {
  let loaded = 0;
  let empty = 0;
  let any = false;
  for (const l of loads) {
    const lm = positive(l.loadedMiles);
    const em = positive(l.emptyMiles);
    if (lm != null) loaded += lm;
    if (em != null) empty += em;
    if (lm != null || em != null) any = true;
  }
  if (!any || loaded + empty <= 0) return NO_SPLIT;
  return { loaded, empty, total: loaded + empty, source: 'loads', label: 'EMPTY', flag: null };
}

export function readMilesSplit(input: {
  carrier: string | null | undefined;
  loads?: Pick<ExtractedLoad, 'loadedMiles' | 'emptyMiles'>[] | null;
  milesLines?: ExtractedMilesLine[] | null;
}): MilesSplit {
  const loads = input.loads ?? [];
  if (isPrimeCarrier(input.carrier)) return primeSplit(loads);

  let loaded: number | null = null;
  let empty: number | null = null;
  let total: number | null = null;
  let label: string | null = null;
  let flag: MilesSplitFlag | null = null;
  for (const line of input.milesLines ?? []) {
    const { kind, word } = classifyMilesLabel(line.label);
    const miles = positive(line.miles);
    if (kind === 'empty' && miles == null) {
      // A deadhead PAY line with no miles is pay, not the week's empty miles.
      flag = 'deadhead_pay_without_miles';
      continue;
    }
    if (miles == null || kind === 'ignored') continue;
    // Weekly totals, not per-load lines: pages are concatenated by the
    // page-by-page merge, so a repeated line is taken once (largest).
    if (kind === 'loaded') loaded = Math.max(loaded ?? 0, miles);
    else if (kind === 'empty') {
      empty = Math.max(empty ?? 0, miles);
      label = label ?? word;
    } else total = Math.max(total ?? 0, miles);
  }

  if (loaded != null && empty != null) {
    return { loaded, empty, total: total ?? loaded + empty, source: 'statement', label, flag };
  }
  if (loaded != null && total != null && total >= loaded) {
    return { loaded, empty: total - loaded, total, source: 'derived', label: null, flag };
  }
  if (empty != null && total != null && total >= empty) {
    return { loaded: total - empty, empty, total, source: 'derived', label, flag };
  }
  // Nothing printed as a split: the loads' own columns, when they carry any.
  const fromLoads = primeSplit(loads);
  if (fromLoads.source) return { ...fromLoads, label: null, flag };
  return { ...NO_SPLIT, flag };
}

// What a save writes to the settlement row. A manual split is never
// replaced by a re-import, and a missing reading never replaces a real one
// (null never beats a number).
export type StoredMilesSplit = {
  loaded_miles: number | null;
  empty_miles: number | null;
  miles_split_source: MilesSplitSource | null;
  miles_split_label: string | null;
  miles_split_flag: MilesSplitFlag | null;
};

export function milesSplitUpdate(
  next: MilesSplit,
  existing: Partial<StoredMilesSplit> | null
): Partial<StoredMilesSplit> | null {
  if (existing?.miles_split_source === 'manual') return null;
  if (next.source == null) {
    // Keep what is stored; only the flag may be added.
    return next.flag ? { miles_split_flag: next.flag } : null;
  }
  return {
    loaded_miles: next.loaded,
    empty_miles: next.empty,
    miles_split_source: next.source,
    miles_split_label: next.label,
    miles_split_flag: next.flag,
  };
}
