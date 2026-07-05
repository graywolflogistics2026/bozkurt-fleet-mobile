import type { TaxYearData } from '@/src/types/db';

// Legacy calcPerDiemDays() (legacy/index.html:2301) sums (deliveryDate -
// pickupDate) per load from DB.loads. The Postgres `loads` table
// (docs/SCHEMA.sql) only kept a single `load_date` column, not the
// pickup/delivery pair legacy tracked per load — so the exact per-load
// method can't be reproduced from this schema today (see PROMPTS.md).
// Until a future migration adds pickup_date/delivery_date back, this uses
// the same "OTR the whole week" approximation the settlement cadence
// itself implies: one settlement = one full week away from home = 7 per
// diem days. This is clearly an ESTIMATE (CLAUDE.md invariant #8), same as
// every other figure this engine produces.
export function calcPerDiemDays(settlementCount: number): number {
  return Math.max(0, settlementCount) * 7;
}

export function calcPerDiemDeduction(days: number, perDiem: TaxYearData['per_diem']): number {
  return days * perDiem.daily_rate * (perDiem.deductible_pct / 100);
}
