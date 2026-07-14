import { calcTaxProgressColor, calcTaxProgressPct } from '@/src/stats/taxProgress';

describe('calcTaxProgressColor', () => {
  it('is red when fewer than 7 days remain', () => {
    expect(calcTaxProgressColor(6)).toBe('red');
    expect(calcTaxProgressColor(0)).toBe('red');
  });

  it('is amber between 7 and 29 days', () => {
    expect(calcTaxProgressColor(7)).toBe('amber');
    expect(calcTaxProgressColor(29)).toBe('amber');
  });

  it('is green at 30+ days', () => {
    expect(calcTaxProgressColor(30)).toBe('green');
    expect(calcTaxProgressColor(90)).toBe('green');
  });

  it('is green when there is no known deadline (null/undefined)', () => {
    expect(calcTaxProgressColor(null)).toBe('green');
    expect(calcTaxProgressColor(undefined)).toBe('green');
  });
});

describe('calcTaxProgressPct', () => {
  it('computes a rounded percentage of reserved against target', () => {
    expect(calcTaxProgressPct(3000, 12000)).toBe(25);
  });

  it('caps at 100% when reserved exceeds target', () => {
    expect(calcTaxProgressPct(15000, 12000)).toBe(100);
  });

  it('floors at 0% for a negative reserve', () => {
    expect(calcTaxProgressPct(-500, 12000)).toBe(0);
  });

  it('returns 0 when target is 0 or negative (no tax data yet)', () => {
    expect(calcTaxProgressPct(1000, 0)).toBe(0);
    expect(calcTaxProgressPct(1000, -1)).toBe(0);
  });
});
