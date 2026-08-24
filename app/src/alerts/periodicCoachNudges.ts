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
  | 'cpmAboveRpm';

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
  }
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
  ].filter((c): c is CoachNudgeCandidate => c !== null);
}
