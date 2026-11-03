// Pure half of buildInfo.ts (RUNTIME VISIBILITY, owner decision
// 2026-07-30) — deliberately has ZERO imports of expo-constants/
// expo-updates/expo-application, so it's unit-testable in a plain Node
// environment and safely importable from anywhere (including
// ScreenErrorBoundary, the last line of defense).
//
// UPDATE VISIBILITY FIX (owner decision 2026-11-03): the device showed
// "vunknown · embedded build (no OTA update) · channel none · runtime
// unknown" while it was running an OTA update on channel preview, runtime
// 1.1.0. Every field had fallen back at once because ONE read threw
// (Constants.expoConfig -> getManifest() throws
// ERR_CONSTANTS_MANIFEST_UNAVAILABLE in a standalone build without a
// manifest) inside a single try. Now every value is read on its own; a
// value an API returned as null is printed as that API's name
// ("Updates.channel=null"), never "unknown"; "embedded build" only when
// Updates.isEmbeddedLaunch is true AND Updates.updateId is null.
export type BuildInfo = {
  // The display version: Application.nativeApplicationVersion, else
  // Constants.expoConfig.version, else the API name with "=null".
  version: string;
  // Application.nativeBuildVersion (Android versionCode).
  buildVersion?: string | null;
  updateId: string | null;
  updateIdShort: string | null;
  // Updates.createdAt as an ISO string.
  updateCreatedAt?: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  gitCommitHash: string | null;
  gitCommitHashShort: string | null;
  isEmbeddedLaunch: boolean;
  // API names whose read threw (shown so a throw is never invisible).
  errors?: string[];
};

export const NULL_NAMES = {
  version: 'Application.nativeApplicationVersion=null',
  updateId: 'Updates.updateId=null',
  channel: 'Updates.channel=null',
  runtimeVersion: 'Updates.runtimeVersion=null',
  gitCommitHash: 'extra.gitCommitHash=null',
} as const;

export function shorten(id: string | null | undefined, length = 8): string | null {
  return id ? id.slice(0, length) : null;
}

// "embedded build" only when expo-updates says the embedded bundle launched
// AND there is no update id.
export function isEmbeddedBuild(info: Pick<BuildInfo, 'isEmbeddedLaunch' | 'updateId' | 'updateIdShort'>): boolean {
  return info.isEmbeddedLaunch && !info.updateId && !info.updateIdShort;
}

// "2026-11-03 14:05" (UTC) — a stable, locale-free stamp for reports. Takes
// a full timestamp (Updates.createdAt), never a date-only value.
export function stamp(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// The update segment: the running update's id and date, "embedded build",
// or the API name that returned null.
export function updateText(info: BuildInfo): string {
  if (info.updateIdShort) {
    const at = stamp(info.updateCreatedAt);
    return at ? `update ${info.updateIdShort} (${at} UTC)` : `update ${info.updateIdShort}`;
  }
  return isEmbeddedBuild(info) ? 'embedded build (no OTA update)' : `update ${NULL_NAMES.updateId}`;
}

// One-line summary — used identically in Settings' footer, the crash
// screen and every Send report, so they can never disagree.
export function formatBuildInfoLine(info: BuildInfo): string {
  const parts = [info.buildVersion ? `v${info.version} (build ${info.buildVersion})` : `v${info.version}`];
  parts.push(updateText(info));
  parts.push(`commit ${info.gitCommitHashShort ?? NULL_NAMES.gitCommitHash}`);
  parts.push(`channel ${info.channel ?? NULL_NAMES.channel}`);
  parts.push(`runtime ${info.runtimeVersion ?? NULL_NAMES.runtimeVersion}`);
  if (info.errors && info.errors.length > 0) parts.push(`threw: ${info.errors.join(', ')}`);
  return parts.join(' · ');
}
