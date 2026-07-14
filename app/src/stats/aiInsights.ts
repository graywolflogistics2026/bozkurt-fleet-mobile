export type FuelBenchmarkInsight = { type: 'fuelBenchmark'; pctPointsAboveRange: number; estMonthlyDelta: number };
export type NeedsReviewInsight = { type: 'needsReview'; count: number; estValue: number };
export type CpmTargetInsight = { type: 'cpmTarget'; targetRate: number };
export type PaceProjectionInsight = { type: 'paceProjection'; projectedNet: number };

export type Insight = FuelBenchmarkInsight | NeedsReviewInsight | CpmTargetInsight | PaceProjectionInsight;

export type InsightInputs = {
  fuelPctOfRevenue: number | null; // src/stats/profitAnalysis.ts buildProfitAnalysis()
  fuelBenchmarkHigh: number | null; // benchmarks table, metric 'fuel_pct_of_revenue' — high bound only (an insight fires when the user is ABOVE the published reference range)
  monthlyRevenue: number; // same trailing-30-day window profitAnalysis.ts already uses, for estimating a $ delta from a percentage-point gap
  needsReviewCount: number;
  needsReviewEstValue: number;
  costPerMile: number | null; // stats.cpm.costPerMile — the break-even rate a load must clear
  avgNetPerWeek: number;
};

// AI Insights rotating card (Session 9d item 6, CLAUDE.md invariant #22 —
// composed ONLY from this account's own data + the published benchmarks
// table, never live external data). Each candidate only appears when
// there's real data behind it (an account with no fuel purchases yet
// simply never sees the fuel insight) — "rotating" means picking a
// different one of the APPLICABLE candidates each calendar day, not
// cycling through placeholders. Deterministic day-of-year rotation
// through the candidate list IS the daily cache: same day + same
// underlying data always picks the same insight, no AsyncStorage needed.
export function buildInsightCandidates(inputs: InsightInputs): Insight[] {
  const candidates: Insight[] = [];

  if (inputs.fuelPctOfRevenue != null && inputs.fuelBenchmarkHigh != null && inputs.fuelPctOfRevenue > inputs.fuelBenchmarkHigh) {
    const gap = inputs.fuelPctOfRevenue - inputs.fuelBenchmarkHigh;
    candidates.push({
      type: 'fuelBenchmark',
      pctPointsAboveRange: gap * 100,
      estMonthlyDelta: gap * inputs.monthlyRevenue,
    });
  }

  if (inputs.needsReviewCount > 0) {
    candidates.push({ type: 'needsReview', count: inputs.needsReviewCount, estValue: inputs.needsReviewEstValue });
  }

  if (inputs.costPerMile != null && inputs.costPerMile > 0) {
    candidates.push({ type: 'cpmTarget', targetRate: inputs.costPerMile });
  }

  if (inputs.avgNetPerWeek > 0) {
    candidates.push({ type: 'paceProjection', projectedNet: inputs.avgNetPerWeek * 52 });
  }

  return candidates;
}

export function selectDailyInsight(candidates: Insight[], now: Date = new Date()): Insight | null {
  if (candidates.length === 0) return null;
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
  return candidates[dayOfYear % candidates.length];
}
