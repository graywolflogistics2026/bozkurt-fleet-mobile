import {
  buildRecommendationCandidates,
  selectTopRecommendations,
  sumRecommendationImpact,
  type Recommendation,
  type RecommendationInputs,
} from '@/src/stats/aiRecommendations';

function inputs(overrides: Partial<RecommendationInputs> = {}): RecommendationInputs {
  return {
    fuelPctOfRevenue: null,
    fuelBenchmarkHigh: null,
    monthlyRevenue: 0,
    needsReviewCount: 0,
    needsReviewEstValue: 0,
    taxReserveShortfall: null,
    maintenanceAlertCount: 0,
    complianceDueSoonCount: 0,
    ...overrides,
  };
}

describe('buildRecommendationCandidates', () => {
  it('returns no candidates when there is nothing to recommend', () => {
    expect(buildRecommendationCandidates(inputs())).toEqual([]);
  });

  it('includes a fuelEfficiency candidate only when fuel % of revenue is above the published benchmark high', () => {
    const above = buildRecommendationCandidates(inputs({ fuelPctOfRevenue: 0.4, fuelBenchmarkHigh: 0.3, monthlyRevenue: 10000 }));
    expect(above).toHaveLength(1);
    expect(above[0].type).toBe('fuelEfficiency');
    expect(above[0].estMonthlyImpact).toBeCloseTo(1000, 5);
    expect(above[0].detail.pctPointsAboveRange).toBeCloseTo(10, 5);

    const within = buildRecommendationCandidates(inputs({ fuelPctOfRevenue: 0.25, fuelBenchmarkHigh: 0.3, monthlyRevenue: 10000 }));
    expect(within).toEqual([]);
  });

  it('includes a needsReview candidate with the real flagged $ value as its impact', () => {
    expect(buildRecommendationCandidates(inputs({ needsReviewCount: 2, needsReviewEstValue: 450 }))).toEqual([
      { type: 'needsReview', estMonthlyImpact: 450, detail: { count: 2 } },
    ]);
    expect(buildRecommendationCandidates(inputs({ needsReviewCount: 0 }))).toEqual([]);
  });

  it('includes a taxReserveShortfall candidate only when the shortfall is positive', () => {
    expect(buildRecommendationCandidates(inputs({ taxReserveShortfall: 2000 }))).toEqual([
      { type: 'taxReserveShortfall', estMonthlyImpact: 2000, detail: {} },
    ]);
    expect(buildRecommendationCandidates(inputs({ taxReserveShortfall: 0 }))).toEqual([]);
    expect(buildRecommendationCandidates(inputs({ taxReserveShortfall: null }))).toEqual([]);
  });

  it('includes maintenance/compliance catch-up candidates with a null (never fabricated) impact', () => {
    const result = buildRecommendationCandidates(inputs({ maintenanceAlertCount: 3, complianceDueSoonCount: 1 }));
    expect(result).toEqual([
      { type: 'maintenanceCatchUp', estMonthlyImpact: null, detail: { count: 3 } },
      { type: 'complianceCatchUp', estMonthlyImpact: null, detail: { count: 1 } },
    ]);
  });
});

describe('selectTopRecommendations', () => {
  it('sorts money-backed candidates descending by impact, null-impact ones last', () => {
    const candidates: Recommendation[] = [
      { type: 'maintenanceCatchUp', estMonthlyImpact: null, detail: {} },
      { type: 'needsReview', estMonthlyImpact: 200, detail: {} },
      { type: 'taxReserveShortfall', estMonthlyImpact: 900, detail: {} },
      { type: 'fuelEfficiency', estMonthlyImpact: 500, detail: {} },
    ];
    const top3 = selectTopRecommendations(candidates, 3);
    expect(top3.map((r) => r.type)).toEqual(['taxReserveShortfall', 'fuelEfficiency', 'needsReview']);
  });

  it('caps at the requested count', () => {
    const candidates: Recommendation[] = [
      { type: 'needsReview', estMonthlyImpact: 100, detail: {} },
      { type: 'fuelEfficiency', estMonthlyImpact: 200, detail: {} },
      { type: 'taxReserveShortfall', estMonthlyImpact: 300, detail: {} },
      { type: 'maintenanceCatchUp', estMonthlyImpact: null, detail: {} },
    ];
    expect(selectTopRecommendations(candidates, 3)).toHaveLength(3);
  });
});

describe('sumRecommendationImpact', () => {
  it('sums only money-backed recommendations, ignoring null-impact ones', () => {
    const recs: Recommendation[] = [
      { type: 'fuelEfficiency', estMonthlyImpact: 500, detail: {} },
      { type: 'needsReview', estMonthlyImpact: 300, detail: {} },
      { type: 'maintenanceCatchUp', estMonthlyImpact: null, detail: {} },
    ];
    expect(sumRecommendationImpact(recs)).toBe(800);
  });

  it('returns 0 for an empty list', () => {
    expect(sumRecommendationImpact([])).toBe(0);
  });
});
