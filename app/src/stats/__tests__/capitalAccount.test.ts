import { calcCapitalAccount } from '@/src/stats/capitalAccount';

describe('calcCapitalAccount', () => {
  it('effective contribution is initial capital plus extra contributions', () => {
    const result = calcCapitalAccount(60000, 5000, 2000);
    expect(result.effectiveContribution).toBe(65000);
    expect(result.taxFreeRemaining).toBe(63000);
  });

  it('clamps tax-free-remaining at 0 when draws exceed contributions', () => {
    const result = calcCapitalAccount(60000, 0, 90000);
    expect(result.taxFreeRemaining).toBe(0);
  });
});
