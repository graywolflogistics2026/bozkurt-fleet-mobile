import type { NudgeCandidate, NudgeTopic } from '@/src/alerts/missingDataNudges';

// FREQUENCY DISCIPLINE (owner decision 2026-08-24, NEXT PASS item D3): at
// most one nudge per topic per week, never more than two nudges a day,
// silenceable per topic, nothing at all in the first 24 hours after
// sign-up. Persisted server-side as profiles.nudge_state (jsonb,
// docs/PENDING_SQL.md §49) — one entry per topic ever shown/silenced.
export type NudgeStateEntry = { lastShownAt: string | null; silencedAt: string | null };
export type NudgeState = Partial<Record<NudgeTopic, NudgeStateEntry>>;

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNUP_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_NUDGES_PER_DAY = 2;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

// Deterministic given the same inputs (no I/O) — the ONE function under
// test for "does this respect the caps." Candidates are expected to
// already be sorted most-important-first by the caller (selectNudgesToShow
// never reorders) so the per-day cap keeps whichever ones matter most.
export function selectNudgesToShow(candidates: NudgeCandidate[], state: NudgeState, accountCreatedAt: string | null, now: Date = new Date()): NudgeCandidate[] {
  if (accountCreatedAt) {
    const createdMs = new Date(accountCreatedAt).getTime();
    if (!Number.isNaN(createdMs) && now.getTime() - createdMs < SIGNUP_GRACE_MS) return [];
  }

  const eligible = candidates.filter((c) => {
    const entry = state[c.topic];
    if (entry?.silencedAt) return false;
    if (entry?.lastShownAt) {
      const lastShownMs = new Date(entry.lastShownAt).getTime();
      if (now.getTime() - lastShownMs < ONE_WEEK_MS) return false;
    }
    return true;
  });

  const shownTodayCount = Object.values(state).filter((entry) => entry?.lastShownAt && isSameCalendarDay(new Date(entry.lastShownAt), now)).length;
  const remainingToday = Math.max(0, MAX_NUDGES_PER_DAY - shownTodayCount);

  return eligible.slice(0, remainingToday);
}

// Called once the caller has actually rendered `topics` to the user — NOT
// on every recompute, or the "once per week" cap would never engage (see
// useNudges.ts for the render-then-record wiring).
export function recordNudgesShown(state: NudgeState, topics: NudgeTopic[], now: Date = new Date()): NudgeState {
  const next = { ...state };
  for (const topic of topics) {
    next[topic] = { lastShownAt: now.toISOString(), silencedAt: next[topic]?.silencedAt ?? null };
  }
  return next;
}

export function silenceNudgeTopic(state: NudgeState, topic: NudgeTopic, now: Date = new Date()): NudgeState {
  return { ...state, [topic]: { lastShownAt: state[topic]?.lastShownAt ?? null, silencedAt: now.toISOString() } };
}

export function unsilenceNudgeTopic(state: NudgeState, topic: NudgeTopic): NudgeState {
  if (!state[topic]) return state;
  return { ...state, [topic]: { ...state[topic]!, silencedAt: null } };
}
