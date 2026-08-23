// Root navigation gate (app/_layout.tsx's RootLayoutNav) — extracted into a
// pure, testable function rather than inline effect logic, same "every
// calculation is a tested function" convention as calcTruckHealth/
// calcComplianceStatus/etc. `introSeen` must already be resolved (caller
// waits for the IntroContext's null → boolean transition before calling
// this) so this function itself never has to special-case "not yet known".
export type RootRedirectInputs = {
  hasSession: boolean;
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

  if (!hasSession && !introSeen && !onIntroScreen) return '/intro';
  if (!hasSession && !inAuthGroup && !onIntroScreen) return '/(auth)/sign-in';
  if (hasSession && needsTos && !onTosScreen) return '/tos';
  if (hasSession && !needsTos && needsTutorial && !onTutorialScreen) return '/tutorial';
  if (hasSession && !needsTos && !needsTutorial && needsOnboarding && !onOnboardingScreen) return '/onboarding';
  if (
    hasSession &&
    !needsTos &&
    !needsTutorial &&
    !needsOnboarding &&
    (inAuthGroup || onTosScreen || onTutorialScreen || onOnboardingScreen || onIntroScreen)
  ) {
    return '/(tabs)';
  }
  return null;
}
