// FREQUENCY DISCIPLINE (owner decision 2026-08-24, NEXT PASS item D3, also
// reused by item E2's periodic AI Coach nudges with a longer cooldown): at
// most one nudge per topic per cooldown window (7 days for D's missing-
// data nudges, 30 days — "never repeat the same one within a month" — for
// E's periodic coach nudges), never more than two nudges a day, silenceable
// per topic, nothing at all in the first 24 hours after sign-up. Persisted
// server-side as profiles.nudge_state (jsonb, docs/PENDING_SQL.md §49) —
// ONE shared column/shape for both nudge families (they use disjoint topic
// key sets, so they can never collide in the same object).
// DAILY TIPS (owner decision) — two new OPTIONAL fields, a third disjoint
// topic-key family (all prefixed "tip"/"referral" so they can never
// collide with the existing missing-data/periodic-coach topic strings):
// `variantIndex` remembers which of a topic's several phrasings was shown
// last (src/alerts/dailyTips.ts rotates through them in order before any
// repeat); `dismissCount` powers "never after two dismissals" for the
// referral-nudge family (src/referral/referralNudge.ts) — auto-silences
// once it reaches 2, a small extension of the existing silence mechanism
// rather than a second one. Both are optional and simply unused by the
// two original nudge families, so nothing about their own behavior
// changes.
export type NudgeStateEntry = { lastShownAt: string | null; silencedAt: string | null; variantIndex?: number; dismissCount?: number };
export type NudgeState<Topic extends string = string> = Partial<Record<Topic, NudgeStateEntry>>;
export type FrequencyCandidate<Topic extends string> = { topic: Topic; detail: Record<string, number | string> };

export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SIGNUP_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_NUDGES_PER_DAY = 2;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

// Deterministic given the same inputs (no I/O) — the ONE function under
// test for "does this respect the caps." Candidates are expected to
// already be sorted most-important-first by the caller (selectNudgesToShow
// never reorders) so the per-day cap keeps whichever ones matter most.
// `cooldownMs` defaults to the weekly cap (item D3's own spec); item E2's
// periodic coach nudges pass ONE_MONTH_MS instead.
export function selectNudgesToShow<Topic extends string>(
  candidates: FrequencyCandidate<Topic>[],
  state: NudgeState<Topic>,
  accountCreatedAt: string | null,
  now: Date = new Date(),
  cooldownMs: number = ONE_WEEK_MS
): FrequencyCandidate<Topic>[] {
  if (accountCreatedAt) {
    const createdMs = new Date(accountCreatedAt).getTime();
    if (!Number.isNaN(createdMs) && now.getTime() - createdMs < SIGNUP_GRACE_MS) return [];
  }

  const eligible = candidates.filter((c) => {
    const entry = state[c.topic];
    if (entry?.silencedAt) return false;
    if (entry?.lastShownAt) {
      const lastShownMs = new Date(entry.lastShownAt).getTime();
      if (now.getTime() - lastShownMs < cooldownMs) return false;
    }
    return true;
  });

  const shownTodayCount = Object.values<NudgeStateEntry | undefined>(state).filter(
    (entry) => entry?.lastShownAt && isSameCalendarDay(new Date(entry.lastShownAt), now)
  ).length;
  const remainingToday = Math.max(0, MAX_NUDGES_PER_DAY - shownTodayCount);

  return eligible.slice(0, remainingToday);
}

// Called once the caller has actually rendered `topics` to the user — NOT
// on every recompute, or the cooldown would never engage (see
// src/data/alerts.ts / src/data/aiCoachNudges.ts for the render-then-record
// wiring).
// DAILY TIPS fix: this used to build a BRAND-NEW entry object with only
// lastShownAt/silencedAt, silently dropping dismissCount (and
// variantIndex) if either was already set — the referral-nudge family's
// own "never after two dismissals" tracking would have been wiped the
// next time the SAME topic was simply shown again. Now preserves every
// field it doesn't itself own.
export function recordNudgesShown<Topic extends string>(state: NudgeState<Topic>, topics: Topic[], now: Date = new Date()): NudgeState<Topic> {
  const next = { ...state };
  for (const topic of topics) {
    next[topic] = { ...next[topic], lastShownAt: now.toISOString(), silencedAt: next[topic]?.silencedAt ?? null };
  }
  return next;
}

export function silenceNudgeTopic<Topic extends string>(state: NudgeState<Topic>, topic: Topic, now: Date = new Date()): NudgeState<Topic> {
  return { ...state, [topic]: { ...state[topic], lastShownAt: state[topic]?.lastShownAt ?? null, silencedAt: now.toISOString() } } as NudgeState<Topic>;
}

export function unsilenceNudgeTopic<Topic extends string>(state: NudgeState<Topic>, topic: Topic): NudgeState<Topic> {
  if (!state[topic]) return state;
  return { ...state, [topic]: { ...state[topic]!, silencedAt: null } } as NudgeState<Topic>;
}
