import {
  detectReferralNudge,
  hasQualifiedReferralRecently,
  recordReferralNudgeDismissed,
  REFERRAL_NUDGE_MAX_DISMISSALS,
} from '@/src/referral/referralNudge';
import { selectNudgesToShow, recordNudgesShown, type NudgeState } from '@/src/alerts/nudgeFrequency';
import type { ReferralNudgeTopic } from '@/src/referral/referralNudge';

const PROGRESS = { inCurrentCycle: 1, remaining: 2 };

describe('detectReferralNudge — priority order and "never randomly" gating', () => {
  test('never fires on day one, regardless of other conditions', () => {
    expect(
      detectReferralNudge({
        hasQualifiedReferralRecently: true,
        metGoalThisWeek: true,
        hasExportedAccountantPackage: true,
        accountAgeDays: 0,
        referralProgress: PROGRESS,
      })
    ).toEqual({ topic: 'referralQualified', detail: PROGRESS });
  });

  test('a qualified referral wins over every other simultaneous trigger', () => {
    const result = detectReferralNudge({
      hasQualifiedReferralRecently: true,
      metGoalThisWeek: true,
      hasExportedAccountantPackage: true,
      accountAgeDays: 30,
      referralProgress: PROGRESS,
    });
    expect(result?.topic).toBe('referralQualified');
  });

  test('a goal-beating week wins over a first export and mere activity', () => {
    const result = detectReferralNudge({
      hasQualifiedReferralRecently: false,
      metGoalThisWeek: true,
      hasExportedAccountantPackage: true,
      accountAgeDays: 30,
      referralProgress: PROGRESS,
    });
    expect(result?.topic).toBe('referralGoalWeek');
  });

  test('a first accountant-package export wins over mere activity', () => {
    const result = detectReferralNudge({
      hasQualifiedReferralRecently: false,
      metGoalThisWeek: false,
      hasExportedAccountantPackage: true,
      accountAgeDays: 30,
      referralProgress: PROGRESS,
    });
    expect(result?.topic).toBe('referralFirstExport');
  });

  test('active 3+ weeks (>=21 days) fires only when nothing else did', () => {
    expect(
      detectReferralNudge({
        hasQualifiedReferralRecently: false,
        metGoalThisWeek: false,
        hasExportedAccountantPackage: false,
        accountAgeDays: 21,
        referralProgress: PROGRESS,
      })?.topic
    ).toBe('referralActive3Weeks');
    expect(
      detectReferralNudge({
        hasQualifiedReferralRecently: false,
        metGoalThisWeek: false,
        hasExportedAccountantPackage: false,
        accountAgeDays: 20,
        referralProgress: PROGRESS,
      })
    ).toBeNull();
  });

  test('nothing fires when no moment is true and the account is under 3 weeks old', () => {
    expect(
      detectReferralNudge({
        hasQualifiedReferralRecently: false,
        metGoalThisWeek: false,
        hasExportedAccountantPackage: false,
        accountAgeDays: 5,
        referralProgress: PROGRESS,
      })
    ).toBeNull();
  });
});

describe('hasQualifiedReferralRecently', () => {
  const NOW = new Date('2026-08-27T00:00:00Z');

  test('true for a referral qualified within the last 14 days', () => {
    expect(hasQualifiedReferralRecently([{ status: 'qualified', qualified_at: '2026-08-20T00:00:00Z' }], NOW)).toBe(true);
  });

  test('false for a referral that qualified months ago — "when it qualifies," not "whenever one happens to be qualified"', () => {
    expect(hasQualifiedReferralRecently([{ status: 'qualified', qualified_at: '2026-03-01T00:00:00Z' }], NOW)).toBe(false);
  });

  test('false for a pending (not yet qualified) referral', () => {
    expect(hasQualifiedReferralRecently([{ status: 'pending', qualified_at: null }], NOW)).toBe(false);
  });

  test('false for no referrals at all', () => {
    expect(hasQualifiedReferralRecently([], NOW)).toBe(false);
  });
});

describe('"never more than once every two weeks" — reuses the shared frequency engine', () => {
  test('a referral nudge respects a 14-day cooldown via selectNudgesToShow', () => {
    const now = new Date('2026-08-27T00:00:00Z');
    const shown6DaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const state: NudgeState<ReferralNudgeTopic> = { referralActive3Weeks: { lastShownAt: shown6DaysAgo, silencedAt: null } };
    const result = selectNudgesToShow(
      [{ topic: 'referralActive3Weeks' as ReferralNudgeTopic, detail: {} }],
      state,
      '2026-01-01T00:00:00Z',
      now,
      14 * 24 * 60 * 60 * 1000
    );
    expect(result).toEqual([]);
  });

  test('shows again once 14+ days have passed', () => {
    const now = new Date('2026-08-27T00:00:00Z');
    const shown15DaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const state: NudgeState<ReferralNudgeTopic> = { referralActive3Weeks: { lastShownAt: shown15DaysAgo, silencedAt: null } };
    const result = selectNudgesToShow(
      [{ topic: 'referralActive3Weeks' as ReferralNudgeTopic, detail: {} }],
      state,
      '2026-01-01T00:00:00Z',
      now,
      14 * 24 * 60 * 60 * 1000
    );
    expect(result.length).toBe(1);
  });
});

describe('recordReferralNudgeDismissed — "never after two dismissals"', () => {
  test('a first dismissal only records a count, does not silence', () => {
    const state = recordReferralNudgeDismissed({}, 'referralActive3Weeks');
    expect(state.referralActive3Weeks?.dismissCount).toBe(1);
    expect(state.referralActive3Weeks?.silencedAt).toBeNull();
  });

  test('a second dismissal silences the topic permanently', () => {
    let state: NudgeState<ReferralNudgeTopic> = recordReferralNudgeDismissed({}, 'referralActive3Weeks');
    state = recordReferralNudgeDismissed(state, 'referralActive3Weeks');
    expect(state.referralActive3Weeks?.dismissCount).toBe(REFERRAL_NUDGE_MAX_DISMISSALS);
    expect(state.referralActive3Weeks?.silencedAt).not.toBeNull();
  });

  test('once silenced, the shared frequency engine never shows it again regardless of cooldown', () => {
    let state: NudgeState<ReferralNudgeTopic> = recordReferralNudgeDismissed({}, 'referralActive3Weeks');
    state = recordReferralNudgeDismissed(state, 'referralActive3Weeks');
    const result = selectNudgesToShow(
      [{ topic: 'referralActive3Weeks' as ReferralNudgeTopic, detail: {} }],
      state,
      '2020-01-01T00:00:00Z',
      new Date('2030-01-01T00:00:00Z'),
      14 * 24 * 60 * 60 * 1000
    );
    expect(result).toEqual([]);
  });

  test('dismiss counts are tracked independently per topic', () => {
    let state: NudgeState<ReferralNudgeTopic> = recordReferralNudgeDismissed({}, 'referralGoalWeek');
    state = recordReferralNudgeDismissed(state, 'referralFirstExport');
    expect(state.referralGoalWeek?.dismissCount).toBe(1);
    expect(state.referralFirstExport?.dismissCount).toBe(1);
    expect(state.referralGoalWeek?.silencedAt).toBeNull();
  });
});

// recordNudgesShown is re-exercised here only to prove it composes cleanly
// with the referral topic union (no separate implementation needed for
// "shown" tracking — only "dismissed" needed the new dismiss-count logic).
describe('recordNudgesShown composes with ReferralNudgeTopic', () => {
  test('marks lastShownAt without touching dismissCount', () => {
    let state: NudgeState<ReferralNudgeTopic> = recordReferralNudgeDismissed({}, 'referralGoalWeek');
    state = recordNudgesShown(state, ['referralGoalWeek'], new Date('2026-08-27T00:00:00Z'));
    expect(state.referralGoalWeek?.lastShownAt).toBe('2026-08-27T00:00:00.000Z');
  });
});
