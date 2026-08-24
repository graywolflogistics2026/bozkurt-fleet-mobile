// AI COACH — PERIODIC NUDGES (owner decision 2026-08-24, NEXT PASS item
// E2): a second, disjoint family of nudge topics from item D2's missing-
// data nudges — conversational, AI-Coach-voiced observations rather than
// "something's not set up," rotated with a 30-day-per-topic cooldown
// ("never repeat the same one within a month," spec's own words) via the
// SAME frequency engine (src/alerts/nudgeFrequency.ts,
// ONE_MONTH_MS) and the SAME profiles.nudge_state column (disjoint topic
// keys, so the two families can never collide in the same JSON blob). Pure
// detection functions, same "take minimal already-fetched row shapes"
// convention as missingDataNudges.ts.
export type CoachNudgeTopic =
  | 'noReceiptRecently'
  | 'missingCommonCategory'
  | 'accountantPackageReady'
  | 'quarterlyTaxDueSoon'
  | 'fuelPctTrendUp'
  | 'deadheadTrendUp'
  | 'cpmAboveRpm'
  // WEEKLY GOAL DRIVES THE COACH (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 3 item 2) — same rotating-observation family,
  // same 30-day-per-topic cooldown, disjoint topic keys.
  | 'goalStreakOver'
  | 'goalStreakUnder'
  | 'goalRpmGap'
  | 'goalCostCategoryShortfall'
  | 'goalRaiseSuggestion'
  | 'goalLowerSuggestion';

export type CoachNudgeCandidate = { topic: CoachNudgeTopic; detail: Record<string, number | string> };

const NO_RECEIPT_DAYS = 12;
const ACCOUNTANT_PACKAGE_WINDOW_DAYS = 21;
const QUARTERLY_TAX_WINDOW_DAYS = 14;
const TREND_UP_THRESHOLD = 0.05; // 5 percentage points

// Categories a trucker usually has SOME spend in every quarter — a
// deliberately short, high-confidence list (not every canonical category,
// which would false-positive constantly for a legitimately-uncommon one).
export const COMMON_QUARTERLY_CATEGORIES = [
  'Fuel Additives',
  'Safety Gear & Workwear',
  'Tools & Equipment',
  'Parking & Lodging',
  'ELD & Communications',
  'Truck Wash & Detailing',
] as const;

// "You haven't added a receipt in 12 days" — an empty account is an
// onboarding/empty-state concern, not a nudge.
export function detectNoReceiptRecently(deductions: { ded_date: string | null }[], now: Date = new Date()): CoachNudgeCandidate | null {
  const dates = deductions.map((d) => d.ded_date).filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  const latest = dates.reduce((max, d) => (d > max ? d : max), dates[0]);
  const daysSince = Math.floor((now.getTime() - new Date(`${latest}T00:00:00`).getTime()) / 86400000);
  return daysSince >= NO_RECEIPT_DAYS ? { topic: 'noReceiptRecently', detail: { days: daysSince } } : null;
}

function currentQuarterBounds(now: Date): { start: string; end: string } {
  const quarterIndex = Math.floor(now.getUTCMonth() / 3);
  const startMonth = quarterIndex * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Phrased as a QUESTION by the i18n copy itself (alerts.coachNudges.
// missingCommonCategory) per the spec's explicit "never advice to invent
// expenses" — this only ever names ONE missing category at a time (the
// first in COMMON_QUARTERLY_CATEGORIES order still missing), never all of
// them at once, so it reads as one small question, not a checklist demand.
export function detectMissingCommonCategory(
  deductions: { category: string | null; ded_date: string | null }[],
  now: Date = new Date()
): CoachNudgeCandidate | null {
  const { start, end } = currentQuarterBounds(now);
  const presentThisQuarter = new Set(
    deductions.filter((d) => d.ded_date && d.ded_date >= start && d.ded_date <= end).map((d) => d.category)
  );
  const missing = COMMON_QUARTERLY_CATEGORIES.find((c) => !presentThisQuarter.has(c));
  return missing ? { topic: 'missingCommonCategory', detail: { category: missing } } : null;
}

// "Your accountant package for <month> is ready — export it before the
// quarterly deadline" — only once a real quarterly deadline is close AND
// there's actual out-of-pocket data this month worth exporting (an empty
// package isn't "ready").
export function detectAccountantPackageReady(
  quarterlyDeadlineDaysUntil: number | null,
  hasOutOfPocketThisMonth: boolean,
  monthLabel: string
): CoachNudgeCandidate | null {
  if (quarterlyDeadlineDaysUntil == null) return null;
  if (quarterlyDeadlineDaysUntil < 0 || quarterlyDeadlineDaysUntil > ACCOUNTANT_PACKAGE_WINDOW_DAYS) return null;
  if (!hasOutOfPocketThisMonth) return null;
  return { topic: 'accountantPackageReady', detail: { month: monthLabel, days: quarterlyDeadlineDaysUntil } };
}

// Compliance/quarterly-tax timing tied to real dates — reuses
// src/tax/quarterly.ts's own nextQuarterlyDeadline() output (the caller
// passes daysUntil straight through), never a second deadline calculation.
export function detectQuarterlyTaxDueSoon(quarterlyDeadlineDaysUntil: number | null): CoachNudgeCandidate | null {
  if (quarterlyDeadlineDaysUntil == null) return null;
  if (quarterlyDeadlineDaysUntil < 0 || quarterlyDeadlineDaysUntil > QUARTERLY_TAX_WINDOW_DAYS) return null;
  return { topic: 'quarterlyTaxDueSoon', detail: { days: quarterlyDeadlineDaysUntil } };
}

// Trend observations — this week vs. the user's own trailing 4-week
// average (same trailing-average convention as cashFlowForecast.ts's
// trailingWeeklyRevenueAverage/etc.), never an absolute/industry
// threshold, so it can never nag a fleet that's always run a bit fuel-
// heavy but is otherwise stable.
export function detectFuelPctTrendUp(thisWeekFuelPct: number | null, trailingAvgFuelPct: number | null): CoachNudgeCandidate | null {
  if (thisWeekFuelPct == null || trailingAvgFuelPct == null) return null;
  const deltaPoints = Math.round((thisWeekFuelPct - trailingAvgFuelPct) * 1000) / 10;
  return deltaPoints >= TREND_UP_THRESHOLD * 100 ? { topic: 'fuelPctTrendUp', detail: { points: deltaPoints } } : null;
}

export function detectDeadheadTrendUp(thisWeekDeadheadPct: number | null, trailingAvgDeadheadPct: number | null): CoachNudgeCandidate | null {
  if (thisWeekDeadheadPct == null || trailingAvgDeadheadPct == null) return null;
  const deltaPoints = Math.round((thisWeekDeadheadPct - trailingAvgDeadheadPct) * 1000) / 10;
  return deltaPoints >= TREND_UP_THRESHOLD * 100 ? { topic: 'deadheadTrendUp', detail: { points: deltaPoints } } : null;
}

// CPM drifting above RPM — losing money per mile, the single clearest
// "worth flagging" signal this app can compute with zero ambiguity.
export function detectCpmAboveRpm(cpm: number | null, rpm: number | null): CoachNudgeCandidate | null {
  if (cpm == null || rpm == null) return null;
  if (cpm <= rpm) return null;
  return { topic: 'cpmAboveRpm', detail: { cpm: Math.round(cpm * 100) / 100, rpm: Math.round(rpm * 100) / 100 } };
}

// Presentation helper (same "one shared function, never two copies of the
// same i18n-key-picking logic" convention as aiRecommendations.ts's own
// recommendationText()) — used by both Home's AiCoachSection and the
// Alerts screen's "From your AI Coach" section.
export function coachNudgeText(candidate: CoachNudgeCandidate, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (candidate.topic) {
    case 'noReceiptRecently':
      return t('alerts.coachNudges.noReceiptRecently', { days: candidate.detail.days });
    case 'missingCommonCategory':
      return t('alerts.coachNudges.missingCommonCategory', { category: candidate.detail.category });
    case 'accountantPackageReady':
      return t('alerts.coachNudges.accountantPackageReady', { month: candidate.detail.month });
    case 'quarterlyTaxDueSoon':
      return t('alerts.coachNudges.quarterlyTaxDueSoon', { count: candidate.detail.days, days: candidate.detail.days });
    case 'fuelPctTrendUp':
      return t('alerts.coachNudges.fuelPctTrendUp', { points: candidate.detail.points });
    case 'deadheadTrendUp':
      return t('alerts.coachNudges.deadheadTrendUp', { points: candidate.detail.points });
    case 'cpmAboveRpm':
      return t('alerts.coachNudges.cpmAboveRpm', { cpm: candidate.detail.cpm, rpm: candidate.detail.rpm });
    case 'goalStreakOver':
      return t('alerts.coachNudges.goalStreakOver', { count: candidate.detail.weeks, weeks: candidate.detail.weeks });
    case 'goalStreakUnder':
      return t('alerts.coachNudges.goalStreakUnder', { count: candidate.detail.weeks, weeks: candidate.detail.weeks });
    case 'goalRpmGap':
      return t('alerts.coachNudges.goalRpmGap', { needed: candidate.detail.needed, actual: candidate.detail.actual });
    case 'goalCostCategoryShortfall':
      return t('alerts.coachNudges.goalCostCategoryShortfall', { category: candidate.detail.category, amount: candidate.detail.amount });
    case 'goalRaiseSuggestion':
      return t('alerts.coachNudges.goalRaiseSuggestion', { count: candidate.detail.weeks, weeks: candidate.detail.weeks });
    case 'goalLowerSuggestion':
      return t('alerts.coachNudges.goalLowerSuggestion', { count: candidate.detail.weeks, weeks: candidate.detail.weeks });
  }
}

// ---- PART 3 item 2: goal-aware detectors ----

const GOAL_STREAK_MIN_TO_MENTION = 2;

// "consecutive weeks over/under goal" — only worth mentioning at 2+ (a
// single week is just "this week," not a streak worth naming).
export function detectGoalStreak(streak: number): CoachNudgeCandidate | null {
  if (streak >= GOAL_STREAK_MIN_TO_MENTION) return { topic: 'goalStreakOver', detail: { weeks: streak } };
  if (streak <= -GOAL_STREAK_MIN_TO_MENTION) return { topic: 'goalStreakUnder', detail: { weeks: Math.abs(streak) } };
  return null;
}

// "the RPM needed versus what they're getting" — the RPM this week would
// have needed to average, AT THE SAME MILES actually driven, to hit goal.
export function detectGoalRpmGap(neededRpm: number | null, actualRpm: number | null): CoachNudgeCandidate | null {
  if (neededRpm == null || actualRpm == null || neededRpm <= actualRpm) return null;
  return { topic: 'goalRpmGap', detail: { needed: Math.round(neededRpm * 100) / 100, actual: Math.round(actualRpm * 100) / 100 } };
}

// "which cost category explains a shortfall" — the single largest expense
// category this week, named only when the goal was actually missed.
export function detectGoalCostCategoryShortfall(
  shortByDollars: number,
  topCategory: string | null,
  topCategoryAmount: number
): CoachNudgeCandidate | null {
  if (shortByDollars <= 0 || !topCategory || topCategoryAmount <= 0) return null;
  return { topic: 'goalCostCategoryShortfall', detail: { category: topCategory, amount: Math.round(topCategoryAmount) } };
}

// "a suggestion to raise the goal after three consecutive beats (or lower
// it supportively after a long run of misses)" — thin wrapper over
// src/stats/goalProgress.ts's suggestGoalAdjustment() so this detector
// stays a pure function of the same streak calcGoalStreak() produces.
export function detectGoalAdjustmentSuggestion(streak: number, suggestion: 'raise' | 'lower' | null): CoachNudgeCandidate | null {
  if (suggestion === 'raise') return { topic: 'goalRaiseSuggestion', detail: { weeks: streak } };
  if (suggestion === 'lower') return { topic: 'goalLowerSuggestion', detail: { weeks: Math.abs(streak) } };
  return null;
}

export function buildPeriodicCoachNudgeCandidates(input: {
  deductions: { category: string | null; ded_date: string | null }[];
  quarterlyDeadlineDaysUntil: number | null;
  hasOutOfPocketThisMonth: boolean;
  monthLabel: string;
  thisWeekFuelPct: number | null;
  trailingAvgFuelPct: number | null;
  thisWeekDeadheadPct: number | null;
  trailingAvgDeadheadPct: number | null;
  cpm: number | null;
  rpm: number | null;
  now?: Date;
  // PART 3 item 2 (goal-aware observations) — all optional; omitted means
  // "no goal set yet" (Part 3 item 3: the caller simply doesn't pass
  // these), so none of the 4 goal detectors fire, same "omission is not a
  // false positive" convention as missingDataNudges.ts.
  goalStreak?: number;
  goalNeededRpm?: number | null;
  goalShortByDollars?: number;
  goalTopCostCategory?: string | null;
  goalTopCostCategoryAmount?: number;
  goalAdjustmentSuggestion?: 'raise' | 'lower' | null;
}): CoachNudgeCandidate[] {
  const now = input.now ?? new Date();
  return [
    detectNoReceiptRecently(input.deductions, now),
    detectMissingCommonCategory(input.deductions, now),
    detectAccountantPackageReady(input.quarterlyDeadlineDaysUntil, input.hasOutOfPocketThisMonth, input.monthLabel),
    detectQuarterlyTaxDueSoon(input.quarterlyDeadlineDaysUntil),
    detectFuelPctTrendUp(input.thisWeekFuelPct, input.trailingAvgFuelPct),
    detectDeadheadTrendUp(input.thisWeekDeadheadPct, input.trailingAvgDeadheadPct),
    detectCpmAboveRpm(input.cpm, input.rpm),
    input.goalStreak !== undefined ? detectGoalStreak(input.goalStreak) : null,
    input.goalNeededRpm !== undefined ? detectGoalRpmGap(input.goalNeededRpm, input.rpm) : null,
    input.goalShortByDollars !== undefined
      ? detectGoalCostCategoryShortfall(input.goalShortByDollars, input.goalTopCostCategory ?? null, input.goalTopCostCategoryAmount ?? 0)
      : null,
    input.goalStreak !== undefined
      ? detectGoalAdjustmentSuggestion(input.goalStreak, input.goalAdjustmentSuggestion ?? null)
      : null,
  ].filter((c): c is CoachNudgeCandidate => c !== null);
}
