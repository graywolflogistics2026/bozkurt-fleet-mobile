import { isImplausibleLoanPayment, monthlyEquivalentPayment } from '@/src/stats/loanSanity';

describe('monthlyEquivalentPayment — same conversion the screen\'s own aggregate uses', () => {
  test('monthly frequency passes through unchanged', () => {
    expect(monthlyEquivalentPayment(500, 'monthly')).toBe(500);
  });

  test('weekly is converted at 4.33x', () => {
    expect(monthlyEquivalentPayment(100, 'weekly')).toBeCloseTo(433, 5);
  });

  test('biweekly is converted at 2.17x', () => {
    expect(monthlyEquivalentPayment(200, 'biweekly')).toBeCloseTo(434, 5);
  });

  test('an unrecognized/missing frequency is treated as already-monthly', () => {
    expect(monthlyEquivalentPayment(300, null)).toBe(300);
    expect(monthlyEquivalentPayment(300, undefined)).toBe(300);
  });

  test('a null/undefined payment is zero', () => {
    expect(monthlyEquivalentPayment(null, 'monthly')).toBe(0);
    expect(monthlyEquivalentPayment(undefined, 'weekly')).toBe(0);
  });
});

describe('isImplausibleLoanPayment — the device-reported bug, caught as a rule', () => {
  test('the exact reported shape: a monthly payment nearly equal to the whole balance is implausible', () => {
    expect(isImplausibleLoanPayment(61574, 58359.5)).toBe(true);
  });

  test('a normal truck-loan ratio (payment a small fraction of balance) is plausible', () => {
    expect(isImplausibleLoanPayment(45000, 850)).toBe(false);
  });

  test('exactly at the 10% boundary is still plausible (strictly greater than, not >=)', () => {
    expect(isImplausibleLoanPayment(10000, 1000)).toBe(false);
  });

  test('just over the 10% boundary is implausible', () => {
    expect(isImplausibleLoanPayment(10000, 1000.01)).toBe(true);
  });

  test('a zero or negative balance never flags (nothing to compare a ratio against)', () => {
    expect(isImplausibleLoanPayment(0, 500)).toBe(false);
    expect(isImplausibleLoanPayment(-100, 500)).toBe(false);
  });

  test('a zero/null payment never flags, regardless of balance', () => {
    expect(isImplausibleLoanPayment(50000, 0)).toBe(false);
    expect(isImplausibleLoanPayment(50000, null)).toBe(false);
  });
});
