// WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE ADDITIONS
// pass, PART 3) — pure, testable goal-progress math. Takes an already-
// computed weekly true-profit trend (src/stats/trueProfit.ts's
// buildWeeklyTrueProfitTrend(), the SAME series Home/Scorecard/CEO Mode
// already read — never a second, possibly-drifting profit calculation) so
// "goal progress" always means the same thing everywhere it's shown.
export type GoalWeek = { weekEnding: string; net: number };

// Trailing N-week average net — used BOTH to prefill the goal-entry field
// (Part 3 item 4: "prefilled from the trailing 4-week average net") and as
// the real number the "set a weekly goal" unlock nudge names (Part 1) — one
// shared function so the two surfaces can never suggest different numbers.
export function trailingAverageNet(weeks: GoalWeek[], count = 4): number | null {
  const slice = weeks.slice(-count);
  if (slice.length === 0) return null;
  return slice.reduce((sum, w) => sum + w.net, 0) / slice.length;
}

export type GoalProgressResult = {
  progressDollars: number;
  progressPct: number; // can exceed 100
  metGoal: boolean;
  gapDollars: number; // 0 when goal is met/exceeded
  milesToCloseGap: number | null; // gapDollars / rpm, "miles at your current RPM"
  loadsToCloseGap: number | null; // gapDollars / avgRevenuePerLoad, "one more load at your average"
};

// Real figures only (spec's own words) — milesToCloseGap/loadsToCloseGap
// are null (never a guess) when the caller doesn't have a real rpm/
// avg-revenue-per-load to divide by.
export function calcGoalProgress(
  weeklyGoal: number | null,
  latestNet: number | null,
  rpm: number | null,
  avgRevenuePerLoad: number | null
): GoalProgressResult | null {
  if (!weeklyGoal || weeklyGoal <= 0 || latestNet == null) return null;
  const progressDollars = latestNet;
  const progressPct = (latestNet / weeklyGoal) * 100;
  const metGoal = latestNet >= weeklyGoal;
  const gapDollars = metGoal ? 0 : weeklyGoal - latestNet;
  const milesToCloseGap = gapDollars > 0 && rpm && rpm > 0 ? gapDollars / rpm : null;
  const loadsToCloseGap = gapDollars > 0 && avgRevenuePerLoad && avgRevenuePerLoad > 0 ? gapDollars / avgRevenuePerLoad : null;
  return { progressDollars, progressPct, metGoal, gapDollars, milesToCloseGap, loadsToCloseGap };
}

// Consecutive-week streak against the goal, most-recent-first: a positive
// N means the N most recent weeks all met/beat the goal; a negative N means
// the N most recent weeks all missed it. Stops at the first week that
// breaks the streak (or at the end of the trend). 0 when there's no goal
// or no weeks yet.
export function calcGoalStreak(weeks: GoalWeek[], weeklyGoal: number | null): number {
  if (!weeklyGoal || weeklyGoal <= 0 || weeks.length === 0) return 0;
  const reversed = [...weeks].reverse();
  const metMostRecent = reversed[0].net >= weeklyGoal;
  let count = 0;
  for (const w of reversed) {
    const met = w.net >= weeklyGoal;
    if (met !== metMostRecent) break;
    count++;
  }
  return metMostRecent ? count : -count;
}

export const RAISE_GOAL_STREAK_THRESHOLD = 3;
export const LOWER_GOAL_STREAK_THRESHOLD = 5;

// "Raise the goal after three consecutive beats (or lower it supportively
// after a long run of misses)" — spec's exact framing. Tone (motivating vs.
// supportive) lives in the i18n copy, not here.
export function suggestGoalAdjustment(streak: number): 'raise' | 'lower' | null {
  if (streak >= RAISE_GOAL_STREAK_THRESHOLD) return 'raise';
  if (streak <= -LOWER_GOAL_STREAK_THRESHOLD) return 'lower';
  return null;
}
