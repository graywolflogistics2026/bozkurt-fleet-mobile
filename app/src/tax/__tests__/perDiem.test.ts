import { calcPerDiemDays, calcPerDiemDeduction } from '@/src/tax/perDiem';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

describe('calcPerDiemDays', () => {
  it('counts 7 days per settlement week', () => {
    expect(calcPerDiemDays(10)).toBe(70);
  });

  it('is 0 with no settlements', () => {
    expect(calcPerDiemDays(0)).toBe(0);
  });

  it('clamps a negative count to 0', () => {
    expect(calcPerDiemDays(-3)).toBe(0);
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
