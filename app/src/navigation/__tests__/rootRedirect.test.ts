import { resolveRootRedirect, type RootRedirectInputs } from '@/src/navigation/rootRedirect';

function inputs(overrides: Partial<RootRedirectInputs> = {}): RootRedirectInputs {
  return {
    hasSession: false,
    needsTos: false,
    needsTutorial: false,
    needsOnboarding: false,
    introSeen: false,
    segment: undefined,
    ...overrides,
  };
}

describe('resolveRootRedirect — intro gate (2026-07-29 redirect-loop fix)', () => {
  it('fresh user (introSeen false) not yet on /intro is sent to /intro', () => {
    expect(resolveRootRedirect(inputs({ introSeen: false, segment: undefined }))).toBe('/intro');
  });

  it('fresh user already on /intro is NOT bounced anywhere (shows the slides)', () => {
    expect(resolveRootRedirect(inputs({ introSeen: false, segment: 'intro' }))).toBeNull();
  });

  it('the instant introSeen flips true while still on the intro segment, no redirect fires yet (waits for the explicit navigate)', () => {
    expect(resolveRootRedirect(inputs({ introSeen: true, segment: 'intro' }))).toBeNull();
  });

  it('once navigated to (auth) with introSeen true, there is no bounce-back to /intro (the original bug)', () => {
    expect(resolveRootRedirect(inputs({ introSeen: true, segment: '(auth)' }))).toBeNull();
  });

  it('a returning user (introSeen true from a prior launch) goes straight to sign-in, never sees /intro', () => {
    expect(resolveRootRedirect(inputs({ introSeen: true, segment: undefined }))).toBe('/(auth)/sign-in');
  });

  it('a logged-in user who still needs to accept ToS is sent to /tos regardless of introSeen', () => {
    expect(resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: true, segment: undefined }))).toBe('/tos');
    expect(resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: true, segment: 'tos' }))).toBeNull();
  });

  it('a logged-in user past ToS but not the tutorial is sent to /tutorial (owner decision 2026-08-05, FULL PARITY follow-up item I)', () => {
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: false, needsTutorial: true, segment: undefined }))
    ).toBe('/tutorial');
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: false, needsTutorial: true, segment: 'tutorial' }))
    ).toBeNull();
  });

  it('a logged-in user still needing the tutorial is NOT sent to /onboarding yet, even if onboarding is also incomplete', () => {
    expect(
      resolveRootRedirect(
        inputs({
          hasSession: true,
          introSeen: true,
          needsTos: false,
          needsTutorial: true,
          needsOnboarding: true,
          segment: undefined,
        })
      )
    ).toBe('/tutorial');
  });

  it('a logged-in user past ToS but not onboarded is sent to /onboarding', () => {
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: false, needsOnboarding: true, segment: undefined }))
    ).toBe('/onboarding');
    expect(
      resolveRootRedirect(
        inputs({ hasSession: true, introSeen: true, needsTos: false, needsOnboarding: true, segment: 'onboarding' })
      )
    ).toBeNull();
  });

  it('a fully-cleared logged-in user lands in (tabs) from auth/tos/tutorial/onboarding/intro', () => {
    for (const segment of ['(auth)', 'tos', 'tutorial', 'onboarding', 'intro']) {
      expect(
        resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: false, needsOnboarding: false, segment }))
      ).toBe('/(tabs)');
    }
  });

  it('a fully-cleared logged-in user already inside (tabs) triggers no redirect', () => {
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsTos: false, needsOnboarding: false, segment: '(tabs)' }))
    ).toBeNull();
  });
});
