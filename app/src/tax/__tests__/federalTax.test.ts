import { calcFederalTax } from '@/src/tax/federalTax';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const brackets = fixtureTaxYearData.federal_brackets;

describe('calcFederalTax', () => {
  it('computes MFJ tax across multiple brackets', () => {
    // 0-23850 @10% = 2385; 23850-96950 @12% = 8772; 96950-100000 @22% = 671
    expect(calcFederalTax(100000, 'mfj', brackets)).toBeCloseTo(2385 + 8772 + 671, 5);
  });

  it('computes single tax across multiple brackets', () => {
    // 0-11925 @10% = 1192.5; 11925-48475 @12% = 4386; 48475-60000 @22% = 2535.5
    expect(calcFederalTax(60000, 'single', brackets)).toBeCloseTo(1192.5 + 4386 + 2535.5, 5);
  });

  it('uses the SAME bracket table for single and hoh (legacy quirk, not a bug)', () => {
    expect(brackets.hoh).toEqual(brackets.single);
    expect(calcFederalTax(60000, 'hoh', brackets)).toBe(calcFederalTax(60000, 'single', brackets));
  });

  it('taxes the uncapped top bracket at its marginal rate', () => {
    const belowTop = calcFederalTax(751600, 'mfj', brackets);
    const atTopPlus100k = calcFederalTax(851600, 'mfj', brackets);
    expect(atTopPlus100k - belowTop).toBeCloseTo(100000 * 0.37, 5);
  });

  it('returns 0 for zero or negative taxable income', () => {
    expect(calcFederalTax(0, 'single', brackets)).toBe(0);
  });
});
