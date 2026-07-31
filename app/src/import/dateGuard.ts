import type { Extraction } from '@/src/import/types';

// DATE HARDENING round 2 (owner decision 2026-07-30): carrier settlement
// headers commonly print dates as YY/MM/DD (26/07/24 = 2026-07-24), while
// other fields on the same document print M/D/YY (7/16/26) — the AI can
// misread the carrier-header format as if it were the other one,
// transposing the year and day while leaving the month alone (26/07/24
// misread as DD/MM/YY comes out 2024-07-26: day 26 and year 24 swapped
// places). Round 1 only rejected OBVIOUSLY implausible dates; a swap like
// this one can land INSIDE that plausible window on its own (2024 isn't an
// absurd year), so it slipped through. This module actively prefers
// whichever reading — as extracted, or with year/day swapped — is closer
// to "a real trucking document dated recently."
const PAST_WINDOW_MONTHS = 13;
const FUTURE_WINDOW_MONTHS = 1;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function addMonths(date: Date, delta: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d;
}

function parseIsoDate(dateStr: string): Date | null {
  const m = ISO_DATE_RE.exec(dateStr);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Swaps a YYYY-MM-DD date's year and day within the same century (month
// untouched) — e.g. 2024-07-26 -> 2026-07-24. Returns null when the swap
// wouldn't produce a value that could plausibly be a day-of-month (>31),
// or wouldn't form a real calendar date (e.g. day 31 in a 30-day month).
export function trySwapYearAndDay(dateStr: string): string | null {
  const m = ISO_DATE_RE.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const century = Math.floor(year / 100) * 100;
  const swappedYear = century + day;
  const swappedDay = year % 100;
  if (swappedDay < 1 || swappedDay > 31) return null;

  const candidate = new Date(Date.UTC(swappedYear, month - 1, swappedDay));
  if (candidate.getUTCFullYear() !== swappedYear || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== swappedDay) {
    return null; // e.g. day 31 in April — not a real date
  }
  return `${String(swappedYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(swappedDay).padStart(2, '0')}`;
}

// Only corrects when the AS-EXTRACTED reading is meaningfully stale
// (>13 months before `now`) AND the swapped reading lands within a tight,
// plausible recent window (13 months back through 1 month forward, to
// tolerate clock skew / near-future scanning) — a genuinely old document
// the user is intentionally importing late is only "corrected" if its
// own year/day-swapped reading ALSO happens to look recent, which is why
// this is a SMART DEFAULT, not a lock: the import preview still shows
// the (possibly swapped) date as an editable field for the user to fix
// either way (see the import screen's own date-confirmation UI).
export function correctImplausibleDate(dateStr: string | null | undefined, now: Date = new Date()): string | null {
  if (!dateStr) return dateStr ?? null;
  const original = parseIsoDate(dateStr);
  if (!original) return dateStr; // not a plain YYYY-MM-DD string — leave alone, nothing this module understands

  const lowerBound = addMonths(now, -PAST_WINDOW_MONTHS);
  if (original >= lowerBound) return dateStr; // already plausible as-is

  const swapped = trySwapYearAndDay(dateStr);
  if (!swapped) return dateStr;
  const swappedDate = parseIsoDate(swapped);
  if (!swappedDate) return dateStr;

  const upperBound = addMonths(now, FUTURE_WINDOW_MONTHS);
  return swappedDate >= lowerBound && swappedDate <= upperBound ? swapped : dateStr;
}

// Applied once, right after the AI extraction is received (src/data/
// aiImportCall.ts), so every downstream mapper (mapSettlement/mapFuel/
// mapPurchase/etc.) and the import preview screen all see the corrected
// date automatically. Scoped to "when did this transaction/document
// happen" fields only — deliberately does NOT touch forward-looking due
// dates (loan nextDue, compliance dueDate), which are expected to be in
// the future and would be wrongly "corrected" by the same recency logic.
export function sanitizeExtractionDates(extraction: Extraction, now: Date = new Date()): Extraction {
  const fix = (v: string | null | undefined): string | undefined => correctImplausibleDate(v, now) ?? undefined;

  const s = extraction.settlement;
  const settlement = s
    ? {
        ...s,
        weekEnding: fix(s.weekEnding),
        loads: s.loads?.map((l) => ({
          ...l,
          pickupDate: fix(l.pickupDate),
          deliveryDate: fix(l.deliveryDate),
          date: fix(l.date),
          dropDate: fix(l.dropDate),
        })),
        tractorFuel: s.tractorFuel?.map((f) => ({ ...f, date: fix(f.date) })),
        reeferFuel: s.reeferFuel?.map((f) => ({ ...f, date: fix(f.date) })),
        tolls: s.tolls
          ? {
              ezpass: s.tolls.ezpass ? { ...s.tolls.ezpass, items: s.tolls.ezpass.items?.map((t) => ({ ...t, date: fix(t.date) })) } : undefined,
              drivewyze: s.tolls.drivewyze
                ? { ...s.tolls.drivewyze, items: s.tolls.drivewyze.items?.map((t) => ({ ...t, date: fix(t.date) })) }
                : undefined,
            }
          : s.tolls,
      }
    : s;

  const compliance = extraction.compliance ? { ...extraction.compliance, issueDate: fix(extraction.compliance.issueDate) } : extraction.compliance;

  return {
    ...extraction,
    date: fix(extraction.date),
    settlement,
    compliance,
  };
}

// Import preview "Is this date correct?" highlight (owner decision
// 2026-07-30) — a much looser check than the correction guard above
// (6 months, not 13), since this is just a prompt for the human to take
// a second look, not an automatic rewrite.
export function isOlderThanMonths(dateStr: string | null | undefined, months: number, now: Date = new Date()): boolean {
  if (!dateStr) return false;
  const d = parseIsoDate(dateStr);
  if (!d) return false;
  return d < addMonths(now, -months);
}

// The ONE "what date does this extraction represent" resolver — for a
// settlement that's settlement.weekEnding (what actually feeds
// week_ending/per-diem/the settlement-replace match key), everything else
// it's the top-level date. Shared by the import preview's editable date
// field AND duplicateCheck.ts's possible-duplicate comparison (bug fixed
// 2026-07-30 — duplicateCheck used to compare a settlement's top-level
// `date`, which is typically unset for settlements, against the wrong
// field entirely) so the two can never disagree about "what date is this."
export function getPrimaryExtractionDate(extraction: Extraction): string {
  if (extraction.docType === 'settlement') return extraction.settlement?.weekEnding ?? extraction.date ?? '';
  return extraction.date ?? '';
}

export function withPrimaryExtractionDate(extraction: Extraction, newDate: string): Extraction {
  if (extraction.docType === 'settlement' && extraction.settlement) {
    return { ...extraction, settlement: { ...extraction.settlement, weekEnding: newDate } };
  }
  return { ...extraction, date: newDate };
}

// DATE HARDENING round 3 (owner decision 2026-07-30, CRITICAL BUG FIX): a
// settlement's weekEnding is the entire match key for the
// coexist-vs-replace decision (aiImportSave.ts findExistingSettlement()) —
// the import preview must block Save until the user has confirmed one,
// exactly mirroring the throw in saveExtraction() (see its own comment)
// so the UI never lets a request reach that throw in the first place.
export function isSettlementWeekEndingMissing(extraction: Extraction): boolean {
  return extraction.docType === 'settlement' && !getPrimaryExtractionDate(extraction);
}
