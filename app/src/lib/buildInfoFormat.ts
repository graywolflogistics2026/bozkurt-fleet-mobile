// Pure half of buildInfo.ts (RUNTIME VISIBILITY, owner decision
// 2026-07-30) — deliberately has ZERO imports of expo-constants/
// expo-updates, so it's unit-testable in a plain Node environment and
// safely importable from anywhere (including ScreenErrorBoundary, the
// last line of defense) without adding a new native-module dependency to
// worry about.
export type BuildInfo = {
  version: string;
  updateId: string | null;
  updateIdShort: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  gitCommitHash: string | null;
  gitCommitHashShort: string | null;
  isEmbeddedLaunch: boolean;
};

export function shorten(id: string | null | undefined, length = 8): string | null {
  return id ? id.slice(0, length) : null;
}

// One-line summary — used identically in Settings' footer and
// ScreenErrorBoundary's crash screen so the two can never disagree about
// the format.
//
// CHANNEL + RUNTIME VERSION (owner decision, device report: "vunknown ·
// embedded build (no OTA update)" — no EAS update has ever reached this
// device, and the prior line format gave no way to tell WHY). `channel`
// (`expo-updates`' own `Updates.channel`, already captured by
// getBuildInfo() but never actually rendered until now) is the single
// most decisive signal: `null` here means THIS BUILD has no EAS Update
// channel baked in at all (per expo-updates' own docs, this is always
// null for Expo Go and a development-client build) — such a build can
// NEVER receive an OTA update regardless of what's published to any
// branch, no channel/branch-mapping investigation needed. A non-null
// channel that still never receives updates instead points at a
// channel/branch mismatch or a runtimeVersion mismatch (`runtimeVersion`,
// also `expo-updates`' own value — compare it directly against
// `eas update:view <id>`'s own reported runtime version for whatever was
// last published; a mismatch there is exactly what makes an update
// "compatible" or not for a given build, independent of channel).
// Segments after `commit` are appended only when present — never a blank
// placeholder — matching this function's own pre-existing convention.
export function formatBuildInfoLine(info: BuildInfo): string {
  const parts = [`v${info.version}`];
  parts.push(info.updateIdShort ? `update ${info.updateIdShort}` : 'embedded build (no OTA update)');
  if (info.gitCommitHashShort) parts.push(`commit ${info.gitCommitHashShort}`);
  parts.push(`channel ${info.channel ?? 'none'}`);
  parts.push(`runtime ${info.runtimeVersion ?? 'unknown'}`);
  return parts.join(' · ');
}
