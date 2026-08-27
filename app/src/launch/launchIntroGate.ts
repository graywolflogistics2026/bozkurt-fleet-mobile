// ANIMATED BRAND INTRO — the PURE decision (owner decision). Split out of
// launchIntro.ts specifically so this stays unit-testable: this repo's
// jest config is plain ts-jest under Node (no jest-expo/RN mocking), so
// ANY module with a top-level `import ... from 'react-native'` or an Expo
// native module can't even be loaded by a test — same reason
// src/lib/buildInfoFormat.ts is split out of buildInfo.ts. This file has
// zero react-native/expo imports; launchIntro.ts is the thin, untested
// orchestrator that actually calls Linking/Notifications and wraps this.
//
// Three rules, in order: (1) cold start only, never on return from
// background; (2) skip entirely when the app was opened via a deep link
// or a notification tap — "the user is going somewhere specific"; (3)
// reduced-motion is NOT a gating condition here — it changes HOW the
// intro animates (fade only, no scale/movement), never WHETHER it shows,
// so it's handled inside LaunchIntroOverlay.tsx's own rendering instead.
export function shouldShowLaunchIntro(params: {
  alreadyDecidedThisProcess: boolean;
  hasDeepLinkUrl: boolean;
  hasNotificationResponse: boolean;
}): boolean {
  if (params.alreadyDecidedThisProcess) return false;
  if (params.hasDeepLinkUrl || params.hasNotificationResponse) return false;
  return true;
}
