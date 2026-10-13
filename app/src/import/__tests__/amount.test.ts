import { parseAmount, printedTotal, sumAmounts } from '@/src/import/amount';

// TRAILING-MINUS AMOUNTS (golden settlement pass, owner decision 2026-10-13).
describe('parseAmount', () => {
  it('reads a trailing-minus credit as negative', () => {
    expect(parseAmount('184.85-')).toBe(-184.85);
    expect(parseAmount('17.92-')).toBe(-17.92);
    expect(parseAmount(' 29.15 - ')).toBe(-29.15);
    // Prime prints amounts under $1 with no leading zero (".25", ".37").
    expect(parseAmount('.37-')).toBe(-0.37);
  });

  it('leaves every other input exactly as before', () => {
    expect(parseAmount(-184.85)).toBe(-184.85);
    expect(parseAmount(184.85)).toBe(184.85);
    expect(parseAmount('-184.85')).toBe(-184.85);
    expect(parseAmount('184.85')).toBe(184.85);
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('N/A')).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
    expect(parseAmount(undefined)).toBeNaN();
  });
});

describe('printedTotal — a total the statement did not print is null, never 0', () => {
  it('missing, non-numeric and the schema 0 default are all "not printed"', () => {
    expect(printedTotal(undefined)).toBeNull();
    expect(printedTotal('')).toBeNull();
    expect(printedTotal(0)).toBeNull();
    expect(printedTotal('3,212.19'.replace(',', ''))).toBe(3212.19);
    expect(printedTotal('184.85-')).toBe(-184.85);
  });
});

describe('sumAmounts', () => {
  it('sums lines, credits included, non-numeric lines counted as 0', () => {
    expect(sumAmounts([{ a: 100 }, { a: '184.85-' }, { a: 'x' }], (r) => r.a)).toBeCloseTo(-84.85, 10);
    expect(sumAmounts(undefined, () => 1)).toBe(0);
  });
});
