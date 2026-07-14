import { buildInsightCandidates, selectDailyInsight, type Insight, type InsightInputs } from '@/src/stats/aiInsights';

function inputs(overrides: Partial<InsightInputs> = {}): InsightInputs {
  return {
    fuelPctOfRevenue: null,
    fuelBenchmarkHigh: null,
    monthlyRevenue: 0,
    needsReviewCount: 0,
    needsReviewEstValue: 0,
    costPerMile: null,
    avgNetPerWeek: 0,
    ...overrides,
  };
}

describe('buildInsightCandidates', () => {
  it('returns no candidates when there is nothing to say', () => {
    expect(buildInsightCandidates(inputs())).toEqual([]);
  });

  it('includes a fuelBenchmark candidate only when fuel % of revenue is ABOVE the published benchmark high', () => {
    const above = buildInsightCandidates(inputs({ fuelPctOfRevenue: 0.4, fuelBenchmarkHigh: 0.3, monthlyRevenue: 10000 }));
    expect(above).toHaveLength(1);
    const insight = above[0] as { type: string; pctPointsAboveRange: number; estMonthlyDelta: number };
    expect(insight.type).toBe('fuelBenchmark');
    expect(insight.pctPointsAboveRange).toBeCloseTo(10, 5);
    expect(insight.estMonthlyDelta).toBeCloseTo(1000, 5);

    const within = buildInsightCandidates(inputs({ fuelPctOfRevenue: 0.25, fuelBenchmarkHigh: 0.3, monthlyRevenue: 10000 }));
    expect(within).toEqual([]);
  });

  it('includes a needsReview candidate only when the count is > 0', () => {
    expect(buildInsightCandidates(inputs({ needsReviewCount: 3, needsReviewEstValue: 450 }))).toEqual([
      { type: 'needsReview', count: 3, estValue: 450 },
    ]);
    expect(buildInsightCandidates(inputs({ needsReviewCount: 0 }))).toEqual([]);
  });

  it('includes a cpmTarget candidate only when costPerMile is a positive number', () => {
    expect(buildInsightCandidates(inputs({ costPerMile: 1.25 }))).toEqual([{ type: 'cpmTarget', targetRate: 1.25 }]);
    expect(buildInsightCandidates(inputs({ costPerMile: 0 }))).toEqual([]);
    expect(buildInsightCandidates(inputs({ costPerMile: null }))).toEqual([]);
  });

  it('includes a paceProjection candidate only when avgNetPerWeek is positive, projecting 52 weeks', () => {
    expect(buildInsightCandidates(inputs({ avgNetPerWeek: 1000 }))).toEqual([{ type: 'paceProjection', projectedNet: 52000 }]);
    expect(buildInsightCandidates(inputs({ avgNetPerWeek: 0 }))).toEqual([]);
  });

  it('can return multiple candidates at once when several are applicable', () => {
    const result = buildInsightCandidates(inputs({ needsReviewCount: 2, needsReviewEstValue: 100, costPerMile: 1.1 }));
    expect(result).toHaveLength(2);
  });
});

describe('selectDailyInsight', () => {
  it('returns null for an empty candidate list', () => {
    expect(selectDailyInsight([], new Date('2026-07-13'))).toBeNull();
  });

  it('deterministically picks the same candidate for the same calendar day', () => {
    const candidates: Insight[] = [
      { type: 'needsReview', count: 1, estValue: 50 },
      { type: 'cpmTarget', targetRate: 1.1 },
      { type: 'paceProjection', projectedNet: 40000 },
    ];
    const a = selectDailyInsight(candidates, new Date('2026-07-13T08:00:00Z'));
    const b = selectDailyInsight(candidates, new Date('2026-07-13T22:00:00Z'));
    expect(a).toEqual(b);
  });

  it('rotates to a different candidate on a different day (when candidate count > 1)', () => {
    const candidates: Insight[] = [
      { type: 'needsReview', count: 1, estValue: 50 },
      { type: 'cpmTarget', targetRate: 1.1 },
    ];
    const day1 = selectDailyInsight(candidates, new Date('2026-07-13T00:00:00Z'));
    const day2 = selectDailyInsight(candidates, new Date('2026-07-14T00:00:00Z'));
    expect(day1).not.toEqual(day2);
  });

  it('always returns the sole candidate when there is only one', () => {
    const candidates: Insight[] = [{ type: 'paceProjection', projectedNet: 10000 }];
    expect(selectDailyInsight(candidates, new Date('2026-01-01'))).toEqual(candidates[0]);
    expect(selectDailyInsight(candidates, new Date('2026-12-31'))).toEqual(candidates[0]);
  });
});
