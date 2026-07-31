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
export function formatBuildInfoLine(info: BuildInfo): string {
  const parts = [`v${info.version}`];
  parts.push(info.updateIdShort ? `update ${info.updateIdShort}` : 'embedded build (no OTA update)');
  if (info.gitCommitHashShort) parts.push(`commit ${info.gitCommitHashShort}`);
  return parts.join(' · ');
}
