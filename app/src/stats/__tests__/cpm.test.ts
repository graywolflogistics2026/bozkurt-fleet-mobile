import { calcCpm, ppmColor } from '@/src/stats/cpm';

describe('calcCpm', () => {
  it('computes revenue/cost/profit per mile', () => {
    const result = calcCpm(200000, 150000, 100000);
    expect(result.revenuePerMile).toBeCloseTo(2.0, 5);
    expect(result.costPerMile).toBeCloseTo(1.5, 5);
    expect(result.profitPerMile).toBeCloseTo(0.5, 5);
  });

  it('returns nulls when there are no miles (avoids divide-by-zero)', () => {
    expect(calcCpm(50000, 20000, 0)).toEqual({ revenuePerMile: null, costPerMile: null, profitPerMile: null });
  });
});

describe('ppmColor', () => {
  it('is green strictly above $0.50 (legacy: ppm>0.5)', () => {
    expect(ppmColor(0.51)).toBe('green');
  });

  it('is orange at exactly $0.50 and down to just above $0', () => {
    expect(ppmColor(0.5)).toBe('orange');
    expect(ppmColor(0.01)).toBe('orange');
  });

  it('is red at 0 or negative', () => {
    expect(ppmColor(0)).toBe('red');
    expect(ppmColor(-0.2)).toBe('red');
  });
});
