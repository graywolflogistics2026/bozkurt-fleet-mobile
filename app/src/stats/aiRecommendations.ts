// AI Coach's "top 3 recommendations" (Session 9e-B7, CEO Mode evolution).
// Same CLAUDE.md invariant #22 rule as every other AI feature — composed
// ONLY from this account's own data + the published benchmarks table
// (fuel benchmark, via aiInsights.ts's shared gap calc), never a fabricated
// dollar figure. A recommendation only carries an `estMonthlyImpact` when
// there's a real, already-computed number behind it (fuel-efficiency gap,
// NEEDS REVIEW receipts waiting to be sorted, an under-reserved tax
// shortfall); maintenance/compliance catch-up recommendations are real too
// but have no defensible per-item dollar estimate, so their impact is
// `null` — they still surface, just sorted after the money-backed ones and
// excluded from the header's summed total.
export type RecommendationType = 'fuelEfficiency' | 'needsReview' | 'taxReserveShortfall' | 'maintenanceCatchUp' | 'complianceCatchUp';

export type Recommendation = {
  type: RecommendationType;
  estMonthlyImpact: number | null;
  // Extra fields each recommendation's copy is built from (kept loose/
  // per-type rather than a single shared shape, same as aiInsights.ts's
  // Insight union).
  detail: Record<string, number>;
};

export type RecommendationInputs = {
  fuelPctOfRevenue: number | null;
  fuelBenchmarkHigh: number | null;
  monthlyRevenue: number;
  needsReviewCount: number;
  needsReviewEstValue: number;
  taxReserveShortfall: number | null; // quarterlyPayment - businessBalance; only meaningful when > 0
  maintenanceAlertCount: number;
  complianceDueSoonCount: number;
};

export function buildRecommendationCandidates(inputs: RecommendationInputs): Recommendation[] {
  const candidates: Recommendation[] = [];

  if (inputs.fuelPctOfRevenue != null && inputs.fuelBenchmarkHigh != null && inputs.fuelPctOfRevenue > inputs.fuelBenchmarkHigh) {
    const gap = inputs.fuelPctOfRevenue - inputs.fuelBenchmarkHigh;
    candidates.push({
      type: 'fuelEfficiency',
      estMonthlyImpact: gap * inputs.monthlyRevenue,
      detail: { pctPointsAboveRange: gap * 100 },
    });
  }

  if (inputs.needsReviewCount > 0) {
    candidates.push({
      type: 'needsReview',
      estMonthlyImpact: inputs.needsReviewEstValue,
      detail: { count: inputs.needsReviewCount },
    });
  }

  if (inputs.taxReserveShortfall != null && inputs.taxReserveShortfall > 0) {
    candidates.push({
      type: 'taxReserveShortfall',
      estMonthlyImpact: inputs.taxReserveShortfall,
      detail: {},
    });
  }

  if (inputs.maintenanceAlertCount > 0) {
    candidates.push({ type: 'maintenanceCatchUp', estMonthlyImpact: null, detail: { count: inputs.maintenanceAlertCount } });
  }

  if (inputs.complianceDueSoonCount > 0) {
    candidates.push({ type: 'complianceCatchUp', estMonthlyImpact: null, detail: { count: inputs.complianceDueSoonCount } });
  }

  return candidates;
}

// Top 3, money-backed first (descending impact), null-impact candidates
// last — deterministic given the same inputs (no rotation, unlike
// aiInsights.ts's daily pick, since AI Coach shows several at once).
export function selectTopRecommendations(candidates: Recommendation[], count = 3): Recommendation[] {
  return [...candidates]
    .sort((a, b) => (b.estMonthlyImpact ?? -1) - (a.estMonthlyImpact ?? -1))
    .slice(0, count);
}

// Header's "~$X" figure — sums only the money-backed recommendations
// actually selected, never the null-impact ones.
export function sumRecommendationImpact(recommendations: Recommendation[]): number {
  return recommendations.reduce((sum, r) => sum + (r.estMonthlyImpact ?? 0), 0);
}
