import type { TaxYearData } from '@/src/types/db';

// Per diem day-counting — CORRECTED 2026-07-09 (owner decision, supersedes
// the 2026-07-07 load-date-range rework). Deriving per diem from
// AI-extracted load pickup/delivery dates made the number non-deterministic:
// re-importing the exact same settlement PDF could produce a different
// extraction (and therefore a different per-diem total) run to run. Per
// diem must be a pure function of data the app itself controls, so this is
// now: 7 days × the number of DISTINCT settlement weeks (deduped by
// week_ending) — never derived from load dates. `loads.pickup_date`/
// `delivery_date` (docs/PENDING_SQL.md §8) stay in the schema and keep
// being populated for possible future use, but the tax engine must not
// depend on them.
export type SettlementWeek = { week_ending: string };

export function calcPerDiemDays(settlements: SettlementWeek[]): number {
  const distinctWeeks = new Set(settlements.map((s) => s.week_ending));
  return distinctWeeks.size * 7;
}

export function calcPerDiemDeduction(days: number, perDiem: TaxYearData['per_diem']): number {
  return days * perDiem.daily_rate * (perDiem.deductible_pct / 100);
}
