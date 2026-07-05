import { calcSeTax } from '@/src/tax/seTax';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const seTaxConfig = fixtureTaxYearData.se_tax;

describe('calcSeTax', () => {
  it('applies factor then rate, verbatim legacy math (seb=np*.9235, set=seb*.153)', () => {
    const { seTax } = calcSeTax(100000, seTaxConfig);
    expect(seTax).toBeCloseTo(100000 * 0.9235 * 0.153, 5);
  });

  it('deduction is exactly half of SE tax', () => {
    const { seTax, seTaxDeduction } = calcSeTax(100000, seTaxConfig);
    expect(seTaxDeduction).toBeCloseTo(seTax * 0.5, 5);
  });

  it('applies UNCAPPED — no ss_wage_base cutoff even far above it', () => {
    const base = seTaxConfig.ss_wage_base! * 3;
    const { seTax } = calcSeTax(base, seTaxConfig);
    expect(seTax).toBeCloseTo(base * 0.9235 * 0.153, 5);
  });

  it('clamps negative net profit to 0', () => {
    expect(calcSeTax(-5000, seTaxConfig).seTax).toBe(0);
  });
});
