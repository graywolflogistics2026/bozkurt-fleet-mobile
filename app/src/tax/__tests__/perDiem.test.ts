import {
  calcPerDiemDays,
  calcPerDiemDeduction,
  clampPerDiemDays,
  defaultPerDiemDaysForMiles,
  type SettlementWeek,
} from '@/src/tax/perDiem';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

describe('calcPerDiemDays', () => {
  it('is 0 with no settlements', () => {
    expect(calcPerDiemDays([])).toBe(0);
  });

  it('falls back to the legacy flat 7 for rows with no per_diem_days at all (pre-migration rows)', () => {
    const settlements: SettlementWeek[] = [
      { week_ending: '2026-06-06' },
      { week_ending: '2026-06-13' },
      { week_ending: '2026-06-20' },
    ];
    expect(calcPerDiemDays(settlements)).toBe(21);
  });

  it('dedupes by week_ending so a repeated week is only counted once', () => {
    const settlements: SettlementWeek[] = [
      { week_ending: '2026-06-06' },
      { week_ending: '2026-06-06' },
      { week_ending: '2026-06-13' },
    ];
    expect(calcPerDiemDays(settlements)).toBe(14);
  });

  it('is deterministic regardless of any load-date-shaped input — signature takes only week_ending', () => {
    // Regression guard for the 2026-07-09 correction: this function must
    // not accept or depend on load pickup/delivery dates.
    expect(calcPerDiemDays.length).toBe(1);
  });

  // PER DIEM INTELLIGENCE (owner decision 2026-07-30) — sums whatever
  // per_diem_days is actually stored per settlement, rather than always
  // assuming 7. This is the fix for the reported bug: a 0-mile "home week"
  // settlement (per_diem_days: 0) must contribute 0 days, not 7.
  it('sums explicit per-settlement per_diem_days instead of assuming 7', () => {
    const settlements: SettlementWeek[] = [
      { week_ending: '2026-07-18', per_diem_days: 7 },
      { week_ending: '2026-07-25', per_diem_days: 0 }, // home week, 0 miles
    ];
    expect(calcPerDiemDays(settlements)).toBe(7);
  });

  it('dedupes duplicate week_ending rows (multi-truck fleet, same week) by taking the MIN, not summing both', () => {
    const settlements: SettlementWeek[] = [
      { week_ending: '2026-07-18', per_diem_days: 7 },
      { week_ending: '2026-07-18', per_diem_days: 3 }, // a 2nd truck's settlement for the same calendar week
    ];
    expect(calcPerDiemDays(settlements)).toBe(3);
  });

  it('clamps an out-of-range stored value defensively (0-7)', () => {
    expect(calcPerDiemDays([{ week_ending: '2026-07-18', per_diem_days: 10 }])).toBe(7);
    expect(calcPerDiemDays([{ week_ending: '2026-07-18', per_diem_days: -2 }])).toBe(0);
  });
});

describe('clampPerDiemDays', () => {
  it('clamps to the 0-7 range', () => {
    expect(clampPerDiemDays(-1)).toBe(0);
    expect(clampPerDiemDays(8)).toBe(7);
    expect(clampPerDiemDays(4)).toBe(4);
  });

  it('rounds a fractional value', () => {
    expect(clampPerDiemDays(3.6)).toBe(4);
  });

  it('treats a non-finite value as 0', () => {
    expect(clampPerDiemDays(NaN)).toBe(0);
  });
});

describe('defaultPerDiemDaysForMiles (smart default)', () => {
  it('defaults to 0 for a 0-mile "home week" settlement — the exact reported bug (W/E 2026-07-25)', () => {
    expect(defaultPerDiemDaysForMiles(0)).toBe(0);
    expect(defaultPerDiemDaysForMiles(null)).toBe(0);
    expect(defaultPerDiemDaysForMiles(undefined)).toBe(0);
  });

  it('defaults to 7 for any positive mileage', () => {
    expect(defaultPerDiemDaysForMiles(1)).toBe(7);
    expect(defaultPerDiemDaysForMiles(2500)).toBe(7);
  });
});

describe('calcPerDiemDeduction', () => {
  it('multiplies days by the daily rate at 100% deductible', () => {
    expect(calcPerDiemDeduction(70, fixtureTaxYearData.per_diem)).toBe(70 * 64);
  });

  it('applies a partial deductible_pct if ever set below 100', () => {
    expect(calcPerDiemDeduction(70, { daily_rate: 64, deductible_pct: 50 })).toBe(70 * 64 * 0.5);
  });
});
