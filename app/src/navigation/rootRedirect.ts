// Root navigation gate (app/_layout.tsx's RootLayoutNav) — extracted into a
// pure, testable function rather than inline effect logic, same "every
// calculation is a tested function" convention as calcTruckHealth/
// calcComplianceStatus/etc. `introSeen` must already be resolved (caller
// waits for the IntroContext's null → boolean transition before calling
// this) so this function itself never has to special-case "not yet known".
export type RootRedirectInputs = {
  hasSession: boolean;
  // FIRST-RUN LANGUAGE SCREEN (owner decision, LANGUAGE PICKER — FIVE
  // LANGUAGES AT LAUNCH) — runs before EVERY other gate, including
  // `hasSession`'s own intro/sign-in branches: it's a device-local
  // preference (not account-scoped like the gates below it), and the
  // whole point is that intro/auth/ToS/tutorial text itself should already
  // render in the chosen language, so it must be resolved first.
  languageScreenSeen: boolean;
  // AUTH COMPLETENESS (owner decision 2026-08-24) — runs FIRST among the
  // authenticated gates: a session whose email isn't confirmed yet can't
  // meaningfully accept ToS/see the tutorial/onboard, so this blocks ahead
  // of all three, same "slots in before the next gate" pattern the
  // tutorial gate itself used against onboarding.
  needsEmailConfirmation: boolean;
  needsTos: boolean;
  // FIRST-RUN TUTORIAL (owner decision 2026-08-05, FULL PARITY follow-up
  // item I) — slotted between ToS and the onboarding wizard, per the
  // spec's own "after signup+ToS and before setup wizard" ordering.
  needsTutorial: boolean;
  needsOnboarding: boolean;
  introSeen: boolean;
  segment: string | undefined; // segments[0] from expo-router's useSegments()
};

export function resolveRootRedirect({
  hasSession,
  languageScreenSeen,
  needsEmailConfirmation,
  needsTos,
  needsTutorial,
  needsOnboarding,
  introSeen,
  segment,
}: RootRedirectInputs): string | null {
  const inAuthGroup = segment === '(auth)';
  const onTosScreen = segment === 'tos';
  const onTutorialScreen = segment === 'tutorial';
  const onOnboardingScreen = segment === 'onboarding';
  const onIntroScreen = segment === 'intro';
  const onConfirmEmailScreen = segment === 'confirm-email';
  const onResetPasswordScreen = segment === 'reset-password';
  const onLanguageScreen = segment === 'language';

  // BLOCKS every other gate below while unseen — same "own screen guards
  // itself, short-circuits everything else" shape as every other gate in
  // this chain (intro/ToS/tutorial/onboarding each have their own
  // `!onXScreen` guard on their own trigger condition), except this one
  // runs FIRST and must therefore prevent EVERY later check from firing on
  // its behalf too — none of those later checks know anything about the
  // language gate, so without this explicit short-circuit a fresh,
  // language-unseen device sitting on /language with no session yet would
  // immediately get yanked to /intro by the very next check.
  if (!languageScreenSeen) return onLanguageScreen ? null : '/language';

  if (!hasSession && !introSeen && !onIntroScreen) return '/intro';
  // AUTH COMPLETENESS (owner decision 2026-08-24): a password-reset or
  // email-confirmation link is opened with NO session yet — the screen
  // itself establishes one by exchanging the link's token — so both are
  // exempt from the "no session -> sign-in" bounce, same spirit as
  // intro/(auth) already being exempt.
  if (!hasSession && !inAuthGroup && !onIntroScreen && !onResetPasswordScreen && !onConfirmEmailScreen) return '/(auth)/sign-in';
  if (hasSession && needsEmailConfirmation && !onConfirmEmailScreen) return '/confirm-email';
  if (hasSession && !needsEmailConfirmation && needsTos && !onTosScreen) return '/tos';
  if (hasSession && !needsEmailConfirmation && !needsTos && needsTutorial && !onTutorialScreen) return '/tutorial';
  if (hasSession && !needsEmailConfirmation && !needsTos && !needsTutorial && needsOnboarding && !onOnboardingScreen) return '/onboarding';
  if (
    hasSession &&
    !needsEmailConfirmation &&
    !needsTos &&
    !needsTutorial &&
    !needsOnboarding &&
    (inAuthGroup || onTosScreen || onTutorialScreen || onOnboardingScreen || onIntroScreen || onConfirmEmailScreen || onLanguageScreen)
  ) {
    return '/(tabs)';
  }
  // NOTE: `/reset-password` is deliberately never targeted by the "fully
  // cleared -> tabs" branch above, unlike every other gate screen — a
  // recovery-token exchange can grant a session mid-flow (before the user
  // has actually submitted a new password), and this screen must never be
  // yanked away before that submit completes. It navigates itself once
  // done (same explicit-navigate pattern as tutorial.tsx/onboarding.tsx).
  return null;
}
