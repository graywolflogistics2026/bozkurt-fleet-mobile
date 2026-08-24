import {
  resolveNeedsEmailConfirmation,
  resolveNeedsTos,
  resolveNeedsTutorial,
  resolveNeedsOnboarding,
} from '@/src/auth/profileGates';

describe('resolveNeedsEmailConfirmation (owner decision 2026-08-24, AUTH COMPLETENESS)', () => {
  test('no session — never needed', () => {
    expect(resolveNeedsEmailConfirmation({ hasSession: false, emailConfirmedAt: null })).toBe(false);
  });

  test('session with email_confirmed_at null — needed', () => {
    expect(resolveNeedsEmailConfirmation({ hasSession: true, emailConfirmedAt: null })).toBe(true);
  });

  test('session with email_confirmed_at undefined — needed', () => {
    expect(resolveNeedsEmailConfirmation({ hasSession: true, emailConfirmedAt: undefined })).toBe(true);
  });

  test('session with email_confirmed_at set — not needed', () => {
    expect(resolveNeedsEmailConfirmation({ hasSession: true, emailConfirmedAt: '2026-08-01T00:00:00Z' })).toBe(false);
  });
});

describe('resolveNeedsTos', () => {
  test('no session — never needed', () => {
    expect(resolveNeedsTos({ hasSession: false, profileLoaded: true, tosAcceptedAt: null, tosVersion: null, currentTosVersion: 'v1' })).toBe(false);
  });

  test('profile not loaded — unknown defaults to SHOW', () => {
    expect(resolveNeedsTos({ hasSession: true, profileLoaded: false, tosAcceptedAt: null, tosVersion: null, currentTosVersion: 'v1' })).toBe(true);
  });

  test('accepted, version matches — not needed', () => {
    expect(resolveNeedsTos({ hasSession: true, profileLoaded: true, tosAcceptedAt: '2026-01-01', tosVersion: 'v1', currentTosVersion: 'v1' })).toBe(
      false
    );
  });

  test('never accepted — needed', () => {
    expect(resolveNeedsTos({ hasSession: true, profileLoaded: true, tosAcceptedAt: null, tosVersion: null, currentTosVersion: 'v1' })).toBe(true);
  });

  test('accepted an old version — needed (re-prompt)', () => {
    expect(resolveNeedsTos({ hasSession: true, profileLoaded: true, tosAcceptedAt: '2026-01-01', tosVersion: 'v0', currentTosVersion: 'v1' })).toBe(
      true
    );
  });
});

describe('resolveNeedsTutorial (owner decision 2026-08-24, device report "tutorial never appeared")', () => {
  test('no session — never needed', () => {
    expect(resolveNeedsTutorial({ hasSession: false, needsTos: false, profileLoaded: true, tutorialSeenAt: null })).toBe(false);
  });

  test('ToS not yet accepted — tutorial waits, never shows early', () => {
    expect(resolveNeedsTutorial({ hasSession: true, needsTos: true, profileLoaded: true, tutorialSeenAt: null })).toBe(false);
  });

  // THE BUG: profile not yet loaded (or its fetch failed/timed out) used
  // to silently mean "already seen" — the exact wrong default. A slow
  // profile fetch, or a sign-in transition where session is set before
  // fetchProfile resolves, must default to SHOW, matching resolveNeedsTos's
  // own already-correct default.
  test('profile not loaded — unknown defaults to SHOW, not "already seen"', () => {
    expect(resolveNeedsTutorial({ hasSession: true, needsTos: false, profileLoaded: false, tutorialSeenAt: null })).toBe(true);
  });

  test('tutorial_seen_at null — needed', () => {
    expect(resolveNeedsTutorial({ hasSession: true, needsTos: false, profileLoaded: true, tutorialSeenAt: null })).toBe(true);
  });

  test('tutorial_seen_at set — not needed', () => {
    expect(resolveNeedsTutorial({ hasSession: true, needsTos: false, profileLoaded: true, tutorialSeenAt: '2026-08-20T00:00:00Z' })).toBe(false);
  });
});

describe('resolveNeedsOnboarding', () => {
  test('no session — never needed', () => {
    expect(resolveNeedsOnboarding({ hasSession: false, needsTos: false, needsTutorial: false, profileLoaded: true, onboardingCompletedAt: null })).toBe(
      false
    );
  });

  test('ToS still pending — onboarding waits', () => {
    expect(resolveNeedsOnboarding({ hasSession: true, needsTos: true, needsTutorial: false, profileLoaded: true, onboardingCompletedAt: null })).toBe(
      false
    );
  });

  test('tutorial still pending — onboarding waits (slots in between)', () => {
    expect(resolveNeedsOnboarding({ hasSession: true, needsTos: false, needsTutorial: true, profileLoaded: true, onboardingCompletedAt: null })).toBe(
      false
    );
  });

  test('profile not loaded — unchanged pre-existing default (false, not part of this bug fix)', () => {
    expect(resolveNeedsOnboarding({ hasSession: true, needsTos: false, needsTutorial: false, profileLoaded: false, onboardingCompletedAt: null })).toBe(
      false
    );
  });

  test('onboarding_completed_at null, gates clear — needed', () => {
    expect(resolveNeedsOnboarding({ hasSession: true, needsTos: false, needsTutorial: false, profileLoaded: true, onboardingCompletedAt: null })).toBe(
      true
    );
  });

  test('onboarding_completed_at set — not needed', () => {
    expect(
      resolveNeedsOnboarding({
        hasSession: true,
        needsTos: false,
        needsTutorial: false,
        profileLoaded: true,
        onboardingCompletedAt: '2026-08-01T00:00:00Z',
      })
    ).toBe(false);
  });
});
