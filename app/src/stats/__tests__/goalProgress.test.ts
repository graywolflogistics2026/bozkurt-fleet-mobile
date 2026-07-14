import { calcGoalProgressPct, calcTruckLoanProgress } from '@/src/stats/goalProgress';

describe('calcGoalProgressPct', () => {
  it('computes a rounded percentage of current net against the weekly goal', () => {
    expect(calcGoalProgressPct(750, 1000)).toBe(75);
  });

  it('can exceed 100% when the goal is beaten', () => {
    expect(calcGoalProgressPct(1500, 1000)).toBe(150);
  });

  it('returns null when there is no goal set (null/undefined/0/negative)', () => {
    expect(calcGoalProgressPct(500, null)).toBeNull();
    expect(calcGoalProgressPct(500, undefined)).toBeNull();
    expect(calcGoalProgressPct(500, 0)).toBeNull();
    expect(calcGoalProgressPct(500, -100)).toBeNull();
  });
});

describe('calcTruckLoanProgress', () => {
  it('returns null when there are no loans with a positive original_amount', () => {
    expect(calcTruckLoanProgress([])).toBeNull();
    expect(calcTruckLoanProgress([{ original_amount: null, balance: 1000 }])).toBeNull();
    expect(calcTruckLoanProgress([{ original_amount: 0, balance: 0 }])).toBeNull();
  });

  it('computes paid principal and percentage for a single loan', () => {
    const result = calcTruckLoanProgress([{ original_amount: 100000, balance: 40000 }]);
    expect(result).toEqual({ paidPrincipal: 60000, originalAmount: 100000, pct: 60 });
  });

  it('picks the loan with the largest original_amount when there are several', () => {
    const result = calcTruckLoanProgress([
      { original_amount: 20000, balance: 5000 },
      { original_amount: 150000, balance: 100000 },
    ]);
    expect(result?.originalAmount).toBe(150000);
    expect(result?.paidPrincipal).toBe(50000);
  });

  it('caps at 100% and floors paid principal at 0 for an over-balance data glitch', () => {
    const result = calcTruckLoanProgress([{ original_amount: 50000, balance: -1000 }]);
    expect(result?.pct).toBe(100);
  });
});
