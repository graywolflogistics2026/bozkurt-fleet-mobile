import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { shorten, type BuildInfo } from '@/src/lib/buildInfoFormat';

export type { BuildInfo } from '@/src/lib/buildInfoFormat';
export { formatBuildInfoLine } from '@/src/lib/buildInfoFormat';

// RUNTIME VISIBILITY (owner decision 2026-07-30): "which JS is on this
// device" should never be a guess — surfaced in Settings' footer AND on
// ScreenErrorBoundary's crash screen, both reading from this one module.
// `updateId` is EAS Update's own artifact id for the currently-running JS
// bundle — the single most reliable "which bundle actually loaded"
// signal, stamped by the update pipeline itself. `gitCommitHash` comes
// from app.config.js's build-time injection of
// EAS_BUILD_GIT_COMMIT_HASH (an env var EAS Build sets automatically on
// every cloud build; null for a local dev-client run).
//
// Deliberately defensive: expo-constants/expo-updates are stable,
// always-linked core Expo modules (unlike the reanimated/gesture-handler
// stack behind the Customize Dashboard crash-on-mount bug), but this
// function is called from ScreenErrorBoundary — the LAST line of
// defense — so it must never itself become a new way to throw. Every
// field falls back to a safe placeholder instead of propagating an
// exception.
const FALLBACK: BuildInfo = {
  version: 'unknown',
  updateId: null,
  updateIdShort: null,
  channel: null,
  gitCommitHash: null,
  gitCommitHashShort: null,
  isEmbeddedLaunch: true,
};

export function getBuildInfo(): BuildInfo {
  try {
    const version = Constants.expoConfig?.version ?? 'unknown';
    const gitCommitHash = (Constants.expoConfig?.extra?.gitCommitHash as string | null | undefined) ?? null;
    const updateId = Updates.updateId ?? null;
    return {
      version,
      updateId,
      updateIdShort: shorten(updateId),
      channel: Updates.channel ?? null,
      gitCommitHash,
      gitCommitHashShort: shorten(gitCommitHash, 7),
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    };
  } catch {
    return FALLBACK;
  }
}
