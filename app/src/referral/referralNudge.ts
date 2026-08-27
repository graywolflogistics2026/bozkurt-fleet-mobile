// REFERRAL NUDGE — SURFACE AT THE RIGHT MOMENTS (owner decision, Part 2 of
// the AI Coach daily-tips request: "surface at the RIGHT moments, not
// randomly... Never on day one, never more than once every two weeks,
// never after two dismissals"). Deliberately NOT part of dailyTips.ts's
// rotating pool — this is a milestone-triggered nudge (fires only at 4
// specific real events), not a "pick one of 39 eligible topics" rotation.
// Shares profiles.nudge_state (a 4th, still-disjoint topic-key family,
// every key prefixed `referral`) and reuses src/alerts/nudgeFrequency.ts's
// existing selectNudgesToShow()/recordNudgesShown() for the frequency cap
// — a 14-day cooldown per topic ("once every two weeks") is exactly what
// that engine's own `cooldownMs` parameter already supports, no new
// mechanism needed there. "Never after two dismissals" is the one genuinely
// new piece: dismissDailyTip-style single-shot silencing isn't enough (the
// user should get a second chance before this goes away for good), so
// recordReferralNudgeDismissed() below tracks NudgeStateEntry's new
// `dismissCount` field and only calls silenceNudgeTopic() once it reaches 2.
import type { NudgeState, NudgeStateEntry } from '@/src/alerts/nudgeFrequency';
import { computeReferralProgress } from '@/src/referral/reward';

export type ReferralNudgeTopic = 'referralQualified' | 'referralGoalWeek' | 'referralFirstExport' | 'referralActive3Weeks';

export type ReferralNudgeCandidate = { topic: ReferralNudgeTopic; detail: Record<string, number | string> };

const RECENT_QUALIFY_WINDOW_DAYS = 14;
export const REFERRAL_NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // "once every two weeks"
export const REFERRAL_NUDGE_MAX_DISMISSALS = 2;

// Priority order — the most exciting/time-relevant moment wins when more
// than one is simultaneously true; "You just built a month of clean
// books" (first export) and "active 3+ weeks" are the two evergreen,
// lower-urgency ones, checked last.
export function detectReferralNudge(input: {
  hasQualifiedReferralRecently: boolean;
  metGoalThisWeek: boolean;
  hasExportedAccountantPackage: boolean;
  accountAgeDays: number;
  referralProgress: { inCurrentCycle: number; remaining: number };
}): ReferralNudgeCandidate | null {
  const { inCurrentCycle, remaining } = input.referralProgress;
  if (input.hasQualifiedReferralRecently) return { topic: 'referralQualified', detail: { inCurrentCycle, remaining } };
  if (input.metGoalThisWeek) return { topic: 'referralGoalWeek', detail: { inCurrentCycle, remaining } };
  if (input.hasExportedAccountantPackage) return { topic: 'referralFirstExport', detail: { inCurrentCycle, remaining } };
  if (input.accountAgeDays >= 21) return { topic: 'referralActive3Weeks', detail: { inCurrentCycle, remaining } };
  return null;
}

// A referral's own qualified_at falling within the last 14 days — "when a
// referral qualifies," not merely "one happens to be qualified" (which
// could be stale, from months ago).
export function hasQualifiedReferralRecently(referrals: { status: string; qualified_at: string | null }[], now: Date = new Date()): boolean {
  return referrals.some((r) => {
    if (r.status === 'pending' || !r.qualified_at) return false;
    const daysSince = (now.getTime() - new Date(r.qualified_at).getTime()) / 86400000;
    return daysSince >= 0 && daysSince <= RECENT_QUALIFY_WINDOW_DAYS;
  });
}

export { computeReferralProgress };

export function recordReferralNudgeDismissed(
  state: NudgeState<ReferralNudgeTopic>,
  topic: ReferralNudgeTopic,
  now: Date = new Date()
): NudgeState<ReferralNudgeTopic> {
  const entry: NudgeStateEntry | undefined = state[topic];
  const dismissCount = (entry?.dismissCount ?? 0) + 1;
  // Writes dismissCount directly here (rather than delegating the silence
  // branch to the shared silenceNudgeTopic()) — that helper has no
  // dismissCount parameter of its own, so calling it would silence the
  // topic while leaving the incremented count unwritten, a real bug this
  // pass's own test suite caught (silencedAt correctly set, but
  // dismissCount stuck at 1 instead of 2).
  return {
    ...state,
    [topic]: { lastShownAt: entry?.lastShownAt ?? null, silencedAt: dismissCount >= REFERRAL_NUDGE_MAX_DISMISSALS ? now.toISOString() : null, dismissCount },
  };
}
