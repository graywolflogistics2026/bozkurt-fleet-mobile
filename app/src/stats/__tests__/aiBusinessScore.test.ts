import { calcBusinessScore, type BusinessScoreInputs } from '@/src/stats/aiBusinessScore';

function inputs(overrides: Partial<BusinessScoreInputs> = {}): BusinessScoreInputs {
  return {
    fuelPerMile: null,
    taxReserveRatio: null,
    truckHealthStatuses: [],
    cashFlowDirection: 'flat',
    ...overrides,
  };
}

describe('calcBusinessScore', () => {
  it('scores 100 (5 stars everywhere) for excellent fuel/mile, tax reserve, healthy truck, and a cash-flow uptick', () => {
    const result = calcBusinessScore(
      inputs({ fuelPerMile: 0.4, taxReserveRatio: 1.5, truckHealthStatuses: ['ok', 'ok'], cashFlowDirection: 'up' })
    );
    expect(result.stars).toEqual({ fuelEfficiency: 5, taxOptimization: 5, maintenance: 5, cashFlow: 5 });
    expect(result.score).toBe(100);
  });

  it('gives every sub-rating a neutral middle (3 stars) when its input is unknown/empty', () => {
    const result = calcBusinessScore(inputs());
    expect(result.stars).toEqual({ fuelEfficiency: 3, taxOptimization: 3, maintenance: 3, cashFlow: 3 });
    expect(result.score).toBe(60);
  });

  it('drops maintenance to 1 star when any truck-health category is overdue, regardless of others', () => {
    const result = calcBusinessScore(inputs({ truckHealthStatuses: ['ok', 'ok', 'overdue'] }));
    expect(result.stars.maintenance).toBe(1);
  });

  it('drops maintenance to 2 stars for 2+ due_soon categories, 3 stars for exactly 1', () => {
    expect(calcBusinessScore(inputs({ truckHealthStatuses: ['due_soon', 'due_soon'] })).stars.maintenance).toBe(2);
    expect(calcBusinessScore(inputs({ truckHealthStatuses: ['ok', 'due_soon'] })).stars.maintenance).toBe(3);
  });

  it('rates fuel efficiency worse as fuel/mile rises', () => {
    expect(calcBusinessScore(inputs({ fuelPerMile: 0.9 })).stars.fuelEfficiency).toBe(1);
    expect(calcBusinessScore(inputs({ fuelPerMile: 0.7 })).stars.fuelEfficiency).toBe(2);
  });

  it('rates tax optimization worse as the reserve ratio drops', () => {
    expect(calcBusinessScore(inputs({ taxReserveRatio: 0.3 })).stars.taxOptimization).toBe(1);
    expect(calcBusinessScore(inputs({ taxReserveRatio: 0.9 })).stars.taxOptimization).toBe(3);
  });

  it('rates cash flow 2 stars on a down trend, 3 on flat, 5 on up', () => {
    expect(calcBusinessScore(inputs({ cashFlowDirection: 'down' })).stars.cashFlow).toBe(2);
    expect(calcBusinessScore(inputs({ cashFlowDirection: 'flat' })).stars.cashFlow).toBe(3);
    expect(calcBusinessScore(inputs({ cashFlowDirection: 'up' })).stars.cashFlow).toBe(5);
  });

  it('scores near the bottom when every input is bad', () => {
    const result = calcBusinessScore(
      inputs({ fuelPerMile: 1.5, taxReserveRatio: 0, truckHealthStatuses: ['overdue'], cashFlowDirection: 'down' })
    );
    expect(result.stars).toEqual({ fuelEfficiency: 1, taxOptimization: 1, maintenance: 1, cashFlow: 2 });
    expect(result.score).toBe(25);
  });
});
