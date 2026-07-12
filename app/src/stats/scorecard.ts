export type ScorecardGrade = 'excellent' | 'good' | 'average' | 'needs_work';

export type ScorecardResult = {
  score: number;
  grade: ScorecardGrade;
  revenuePerMile: number;
  fuelPerMile: number;
  netPerMile: number;
};

// Verbatim port of legacy rScore() (legacy/index.html:1961) — a 0-100
// composite business-health score: revenue/mile up to 25pts, fuel/mile up
// to 25pts (lower is better), net/mile up to 25pts, +15 flat for any
// miles driven at all. `totalDeductions` is ALL deductions (withheld +
// out-of-pocket combined, legacy's `DB.ded` sum) — same "operating" total
// Dashboard's CPM card and Operating P&L use, not the tax engine's
// out-of-pocket-only net-profit figure (CLAUDE.md invariant #1 is about
// tax deductions specifically, not this operating view).
export function calcScorecard(
  grossRevenue: number,
  totalDeductions: number,
  totalMiles: number,
  fuelCost: number
): ScorecardResult | null {
  if (!grossRevenue || !totalMiles) return null;

  const rpm = grossRevenue / totalMiles;
  const fpm = fuelCost / totalMiles;
  const npm = (grossRevenue - totalDeductions) / totalMiles;

  let score = 0;
  if (rpm >= 2.5) score += 25;
  else if (rpm >= 2.0) score += 20;
  else if (rpm >= 1.7) score += 12;
  else score += 5;

  if (fpm <= 0.5) score += 25;
  else if (fpm <= 0.65) score += 18;
  else if (fpm <= 0.8) score += 10;
  else score += 3;

  if (npm >= 0.8) score += 25;
  else if (npm >= 0.6) score += 18;
  else if (npm >= 0.4) score += 10;
  else score += 3;

  score += 15; // totalMiles > 0 is already guaranteed by the early return above

  score = Math.min(100, Math.round(score));
  const grade: ScorecardGrade = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'average' : 'needs_work';

  return { score, grade, revenuePerMile: rpm, fuelPerMile: fpm, netPerMile: npm };
}
