import type { TaxYearData } from '@/src/types/db';
import type { Extraction } from '@/src/import/types';

// Per diem day-counting — CORRECTED 2026-07-09 (owner decision, supersedes
// the 2026-07-07 load-date-range rework). Deriving per diem from
// AI-extracted load pickup/delivery dates made the number non-deterministic:
// re-importing the exact same settlement PDF could produce a different
// extraction (and therefore a different per-diem total) run to run. Per
// diem must be a pure function of data the app itself controls — never
// derived from load dates. `loads.pickup_date`/`delivery_date`
// (docs/PENDING_SQL.md §8) stay in the schema and keep being populated for
// possible future use, but the tax engine must not depend on them.
//
// PER DIEM INTELLIGENCE (owner decision 2026-07-30, mega-pass part B,
// docs/PENDING_SQL.md §35): superseded the flat "7 × distinct weeks" rule
// with a per-settlement, editable `per_diem_days` (0-7) — the real bug
// this fixes is a "home week" (0 miles driven, e.g. W/E 2026-07-25) that
// used to still count as a full 7 per-diem days just for having a
// settlement row at all. `per_diem_days` is smart-defaulted at
// import/save time from miles (see mapSettlement() in
// src/import/mapExtraction.ts) and freely editable afterward — this
// function only SUMS whatever's stored, it never re-derives from miles
// itself, so a user's manual edit always sticks.
//
// Dedup rule: when 2+ settlements share the same week_ending (a multi-
// truck fleet routinely settles every truck on the same week), that's
// still ONE calendar week for the person claiming per diem — summing each
// truck's own per_diem_days would double/triple-count the same week, so
// duplicates dedupe by week_ending taking the MIN value among them (the
// conservative reading: if any one settlement for that week says "home
// week, 0 days," the week itself wasn't a full away-from-home week).
export type SettlementWeek = { week_ending: string; per_diem_days?: number | null };

// 0-7 inclusive, whole days — used both when computing the smart default
// at import time and to guard any manual entry (detail screen/import
// preview) from an out-of-range value.
export function clampPerDiemDays(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(7, Math.round(n)));
}

// Smart default (owner decision 2026-07-30): a settlement with 0 total
// miles is a "home week" — no per diem earned unless the user overrides
// it; any positive mileage defaults to the full 7 days, matching the old
// flat behavior for every settlement that actually represents time OTR.
export function defaultPerDiemDaysForMiles(totalMiles: number | null | undefined): number {
  return (totalMiles ?? 0) > 0 ? 7 : 0;
}

// Import preview wiring: applies the smart default exactly once (only
// when the extraction doesn't already carry a perDiemDays — either the
// user already edited it, or this was already applied on a prior render)
// and exposes an editable setter, same "apply once, editable forever"
// pattern as dateGuard.ts's getPrimaryExtractionDate()/
// withPrimaryExtractionDate() for weekEnding.
export function applyDefaultPerDiemDays(extraction: Extraction): Extraction {
  if (extraction.docType !== 'settlement' || !extraction.settlement) return extraction;
  if (extraction.settlement.perDiemDays != null) return extraction;
  return {
    ...extraction,
    settlement: { ...extraction.settlement, perDiemDays: defaultPerDiemDaysForMiles(extraction.settlement.totalMiles) },
  };
}

export function withPerDiemDays(extraction: Extraction, days: number): Extraction {
  if (extraction.docType !== 'settlement' || !extraction.settlement) return extraction;
  return { ...extraction, settlement: { ...extraction.settlement, perDiemDays: clampPerDiemDays(days) } };
}

export function calcPerDiemDays(settlements: SettlementWeek[]): number {
  const byWeek = new Map<string, number>();
  for (const s of settlements) {
    // Rows saved before this column existed (or read through a narrower
    // select that omitted it) have no per_diem_days at all — falls back to
    // the legacy flat 7, same total those weeks always contributed.
    const days = clampPerDiemDays(s.per_diem_days ?? 7);
    const existing = byWeek.get(s.week_ending);
    if (existing === undefined || days < existing) byWeek.set(s.week_ending, days);
  }
  let total = 0;
  for (const days of byWeek.values()) total += days;
  return total;
}

export function calcPerDiemDeduction(days: number, perDiem: TaxYearData['per_diem']): number {
  return days * perDiem.daily_rate * (perDiem.deductible_pct / 100);
}
