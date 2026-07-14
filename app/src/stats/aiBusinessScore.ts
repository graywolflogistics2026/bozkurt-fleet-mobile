import type { HealthStatus } from '@/src/truck/health';
import type { TrendDirection } from '@/src/stats/heroStats';

export type StarRating = 1 | 2 | 3 | 4 | 5;

export type BusinessScoreStars = {
  fuelEfficiency: StarRating;
  taxOptimization: StarRating;
  maintenance: StarRating;
  cashFlow: StarRating;
};

export type BusinessScoreResult = { score: number; stars: BusinessScoreStars };

export type BusinessScoreInputs = {
  fuelPerMile: number | null; // same fuelCost/totalMiles definition as scorecard.ts's calcScorecard()
  taxReserveRatio: number | null; // business_balance / upcoming quarterlyPayment, same definition Fleet Health's taxes chip uses
  truckHealthStatuses: HealthStatus[];
  cashFlowDirection: TrendDirection; // this-week-vs-last-week net, same calcWeekOverWeekChange the Dashboard Hero Card uses
};

function fuelStars(fpm: number | null): StarRating {
  if (fpm == null) return 3;
  if (fpm <= 0.45) return 5;
  if (fpm <= 0.55) return 4;
  if (fpm <= 0.65) return 3;
  if (fpm <= 0.8) return 2;
  return 1;
}

function taxStars(ratio: number | null): StarRating {
  if (ratio == null) return 3;
  if (ratio >= 1.25) return 5;
  if (ratio >= 1) return 4;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

function maintenanceStars(statuses: HealthStatus[]): StarRating {
  if (statuses.length === 0) return 3;
  const overdueCount = statuses.filter((s) => s === 'overdue').length;
  const dueSoonCount = statuses.filter((s) => s === 'due_soon').length;
  if (overdueCount > 0) return 1;
  if (dueSoonCount >= 2) return 2;
  if (dueSoonCount === 1) return 3;
  return 5;
}

function cashFlowStars(direction: TrendDirection): StarRating {
  if (direction === 'down') return 2;
  if (direction === 'flat') return 3;
  return 5;
}

// AI Business Score (Session 9d item 14, CEO Mode screen) — 0-100 with
// four 1-5 star sub-ratings. Distinct category set from the Dashboard's
// Fleet Health Score (Truck/Maintenance/Taxes/Cash Flow) but built from
// the same kind of already-computed inputs (fuel/mile like scorecard.ts,
// tax reserve ratio and truck-health statuses like Fleet Health, week-
// over-week cash flow direction like the Hero Card) — CLAUDE.md invariant
// #22 compliant, no external data.
export function calcBusinessScore(inputs: BusinessScoreInputs): BusinessScoreResult {
  const stars: BusinessScoreStars = {
    fuelEfficiency: fuelStars(inputs.fuelPerMile),
    taxOptimization: taxStars(inputs.taxReserveRatio),
    maintenance: maintenanceStars(inputs.truckHealthStatuses),
    cashFlow: cashFlowStars(inputs.cashFlowDirection),
  };
  const avgStars = (stars.fuelEfficiency + stars.taxOptimization + stars.maintenance + stars.cashFlow) / 4;
  const score = Math.round((avgStars / 5) * 100);
  return { score, stars };
}
