import { calcWeekOverWeekChange } from '@/src/stats/heroStats';

describe('calcWeekOverWeekChange', () => {
  it('reports "up" with a positive percentage when current beats previous by more than 1%', () => {
    const result = calcWeekOverWeekChange(2200, 2000);
    expect(result.direction).toBe('up');
    expect(result.pct).toBeCloseTo(10, 5);
  });

  it('reports "down" with a negative percentage when current is worse than previous', () => {
    const result = calcWeekOverWeekChange(1800, 2000);
    expect(result.direction).toBe('down');
    expect(result.pct).toBeCloseTo(-10, 5);
  });

  it('reports "flat" when the change is within 1%', () => {
    const result = calcWeekOverWeekChange(2005, 2000);
    expect(result.direction).toBe('flat');
  });

  it('reports "flat" with a null pct when there is no prior week (null/undefined/0)', () => {
    expect(calcWeekOverWeekChange(2000, null)).toEqual({ pct: null, direction: 'flat' });
    expect(calcWeekOverWeekChange(2000, undefined)).toEqual({ pct: null, direction: 'flat' });
    expect(calcWeekOverWeekChange(2000, 0)).toEqual({ pct: null, direction: 'flat' });
  });

  it('uses the absolute value of previous as the denominator so a negative-to-positive swing is still a sane percentage', () => {
    const result = calcWeekOverWeekChange(500, -500);
    expect(result.direction).toBe('up');
    expect(result.pct).toBeCloseTo(200, 5);
  });
});
