// Pure profile-gate resolution (owner decision 2026-08-24, tutorial-gate
// bug fix) — extracted out of AuthContext.tsx's useMemo bodies into pure,
// testable functions, same convention as rootRedirect.ts/signUpFlow.ts.
// The concrete bug this regression-guards: an UNKNOWN gate state (profile
// not yet loaded, or its fetch failed/timed out) must default to SHOW,
// never to "already done" — the previous needsTutorial implementation got
// this backwards (`if (!profile) return false`), which silently skipped
// the first-run tutorial for good during a sign-in transition (session set,
// profile fetch still in flight) or for any account whose profile fetch
// never resolved. needsTos already had the correct default
// (`if (!profile) return true`); needsTutorial now matches it.
// needsOnboarding's own `if (!profileLoaded) return false` is UNCHANGED —
// not part of this bug report — but is extracted here too for the same
// testability/consistency reasons.

export function resolveNeedsTos(input: {
  hasSession: boolean;
  profileLoaded: boolean;
  tosAcceptedAt: string | null | undefined;
  tosVersion: string | null | undefined;
  currentTosVersion: string;
}): boolean {
  if (!input.hasSession) return false;
  if (!input.profileLoaded) return true; // unknown — default to SHOW (block until confirmed)
  return input.tosAcceptedAt === null || input.tosVersion !== input.currentTosVersion;
}

export function resolveNeedsTutorial(input: {
  hasSession: boolean;
  needsTos: boolean;
  profileLoaded: boolean;
  tutorialSeenAt: string | null | undefined;
}): boolean {
  if (!input.hasSession || input.needsTos) return false;
  if (!input.profileLoaded) return true; // unknown — default to SHOW, never "already seen"
  return input.tutorialSeenAt === null;
}

export function resolveNeedsOnboarding(input: {
  hasSession: boolean;
  needsTos: boolean;
  needsTutorial: boolean;
  profileLoaded: boolean;
  onboardingCompletedAt: string | null | undefined;
}): boolean {
  if (!input.hasSession || input.needsTos || input.needsTutorial) return false;
  if (!input.profileLoaded) return false;
  return input.onboardingCompletedAt === null;
}
