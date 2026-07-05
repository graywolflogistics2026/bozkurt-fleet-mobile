import { calcScorpSavingsPreview } from '@/src/tax/scorpSavings';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';

const seTaxConfig = fixtureTaxYearData.se_tax;

describe('calcScorpSavingsPreview', () => {
  it('shows the SE tax saved by capping the SE-tax base at the reasonable salary', () => {
    const result = calcScorpSavingsPreview(100000, 40000, seTaxConfig);
    const currentSeTax = 100000 * 0.9235 * 0.153;
    const scorpSeTax = 40000 * 0.9235 * 0.153;
    expect(result.currentSeTax).toBeCloseTo(currentSeTax, 5);
    expect(result.scorpSeTax).toBeCloseTo(scorpSeTax, 5);
    expect(result.savings).toBeCloseTo(currentSeTax - scorpSeTax, 5);
  });

  it('shows 0 savings when the reasonable salary equals net profit', () => {
    const result = calcScorpSavingsPreview(100000, 100000, seTaxConfig);
    expect(result.savings).toBeCloseTo(0, 5);
  });

  it('caps an over-high reasonable salary at net profit', () => {
    const result = calcScorpSavingsPreview(100000, 500000, seTaxConfig);
    expect(result.scorpSeTax).toBeCloseTo(result.currentSeTax, 5);
    expect(result.savings).toBeCloseTo(0, 5);
  });
});
