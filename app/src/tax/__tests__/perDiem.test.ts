import { calcPerDiemDays, calcPerDiemDeduction, type SettlementWeek } from '@/src/tax/perDiem';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

describe('calcPerDiemDays', () => {
  it('is 0 with no settlements', () => {
    expect(calcPerDiemDays([])).toBe(0);
  });

  it('counts 7 days per distinct settlement week', () => {
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
});

describe('calcPerDiemDeduction', () => {
  it('multiplies days by the daily rate at 100% deductible', () => {
    expect(calcPerDiemDeduction(70, fixtureTaxYearData.per_diem)).toBe(70 * 64);
  });

  it('applies a partial deductible_pct if ever set below 100', () => {
    expect(calcPerDiemDeduction(70, { daily_rate: 64, deductible_pct: 50 })).toBe(70 * 64 * 0.5);
  });
});
