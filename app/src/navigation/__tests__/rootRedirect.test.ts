import { resolveRootRedirect, type RootRedirectInputs } from '@/src/navigation/rootRedirect';

function inputs(overrides: Partial<RootRedirectInputs> = {}): RootRedirectInputs {
  return {
    hasSession: false,
    // Defaults to "already seen" so every pre-existing test below (written
    // before the language gate existed) keeps exercising exactly the gate
    // chain it always did — the language gate's own describe block below
    // overrides this explicitly to test the unseen case.
    languageScreenSeen: true,
    needsEmailConfirmation: false,
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

describe('resolveRootRedirect — AUTH COMPLETENESS (owner decision 2026-08-24)', () => {
  it('a session with an unconfirmed email is sent to /confirm-email, ahead of ToS/tutorial/onboarding', () => {
    expect(
      resolveRootRedirect(
        inputs({ hasSession: true, introSeen: true, needsEmailConfirmation: true, needsTos: true, needsTutorial: true, needsOnboarding: true, segment: undefined })
      )
    ).toBe('/confirm-email');
  });

  it('already on /confirm-email with an unconfirmed email triggers no redirect', () => {
    expect(resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsEmailConfirmation: true, segment: 'confirm-email' }))).toBeNull();
  });

  it('once confirmed, the normal gate chain resumes (ToS still pending)', () => {
    expect(
      resolveRootRedirect(
        inputs({ hasSession: true, introSeen: true, needsEmailConfirmation: false, needsTos: true, segment: 'confirm-email' })
      )
    ).toBe('/tos');
  });

  it('a fully-cleared user lands in (tabs) from /confirm-email too', () => {
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsEmailConfirmation: false, segment: 'confirm-email' }))
    ).toBe('/(tabs)');
  });

  it('/reset-password is reachable with NO session at all (deep link, no prior sign-in)', () => {
    expect(resolveRootRedirect(inputs({ hasSession: false, introSeen: true, segment: 'reset-password' }))).toBeNull();
  });

  it('/confirm-email is reachable with NO session at all (deep link, no prior sign-in)', () => {
    expect(resolveRootRedirect(inputs({ hasSession: false, introSeen: true, segment: 'confirm-email' }))).toBeNull();
  });

  it('/reset-password is NEVER auto-redirected to (tabs), even once the recovery token grants a fully-cleared session mid-flow', () => {
    expect(
      resolveRootRedirect(inputs({ hasSession: true, introSeen: true, needsEmailConfirmation: false, segment: 'reset-password' }))
    ).toBeNull();
  });

  it('every other top-level segment still bounces to sign-in with no session', () => {
    for (const segment of [undefined, 'tos', 'tutorial', 'onboarding', '(tabs)']) {
      expect(resolveRootRedirect(inputs({ hasSession: false, introSeen: true, segment }))).toBe('/(auth)/sign-in');
    }
  });
});

describe('resolveRootRedirect — FIRST-RUN LANGUAGE SCREEN (owner decision, LANGUAGE PICKER — FIVE LANGUAGES AT LAUNCH)', () => {
  it('runs before EVERY other gate — a fresh device with no session at all is sent to /language, not /intro', () => {
    expect(resolveRootRedirect(inputs({ languageScreenSeen: false, hasSession: false, introSeen: false, segment: undefined }))).toBe(
      '/language'
    );
  });

  it('runs before EVERY other gate even for a fully signed-in, fully-onboarded user (a new device/build reaching this gate for the first time)', () => {
    expect(
      resolveRootRedirect(
        inputs({
          languageScreenSeen: false,
          hasSession: true,
          introSeen: true,
          needsEmailConfirmation: false,
          needsTos: false,
          needsTutorial: false,
          needsOnboarding: false,
          segment: undefined,
        })
      )
    ).toBe('/language');
  });

  it('unseen and already on /language triggers no redirect (shows the screen)', () => {
    expect(resolveRootRedirect(inputs({ languageScreenSeen: false, segment: 'language' }))).toBeNull();
  });

  it('the instant languageScreenSeen flips true while still on the language segment, the NEXT gate in the chain fires immediately — no dedicated "just seen" branch needed', () => {
    // no session yet, hasn't seen intro either -> falls through to /intro
    expect(resolveRootRedirect(inputs({ languageScreenSeen: true, hasSession: false, introSeen: false, segment: 'language' }))).toBe(
      '/intro'
    );
    // a signed-in, fully-cleared user -> straight to (tabs)
    expect(
      resolveRootRedirect(
        inputs({
          languageScreenSeen: true,
          hasSession: true,
          introSeen: true,
          needsTos: false,
          needsTutorial: false,
          needsOnboarding: false,
          segment: 'language',
        })
      )
    ).toBe('/(tabs)');
  });

  it('once seen, a returning user with no session goes straight to sign-in, never sees /language again', () => {
    expect(resolveRootRedirect(inputs({ languageScreenSeen: true, hasSession: false, introSeen: true, segment: undefined }))).toBe(
      '/(auth)/sign-in'
    );
  });
});
