import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { NULL_NAMES, shorten, type BuildInfo } from '@/src/lib/buildInfoFormat';

export type { BuildInfo } from '@/src/lib/buildInfoFormat';
export { formatBuildInfoLine } from '@/src/lib/buildInfoFormat';

// RUNTIME VISIBILITY (owner decision 2026-07-30; UPDATE VISIBILITY FIX
// 2026-11-03): "which JS is on this device" should never be a guess. Read
// by Settings' footer, Diagnostics, the crash screen and every report.
//
// Every value is read on its OWN guard. Before 2026-11-03 one try wrapped
// them all, and Constants.expoConfig — whose getter throws
// ERR_CONSTANTS_MANIFEST_UNAVAILABLE in a standalone build that has no
// manifest — dropped every field to "unknown / embedded / none" at once,
// on a device that was running an OTA update. A read that throws is named
// in `errors`; it never hides the other values.
//
// Sources:
// - version / build: expo-application (nativeApplicationVersion /
//   nativeBuildVersion), required lazily — its module throws at import if
//   the native module is missing, so a static import could crash the app;
//   then Constants.expoConfig.version.
// - update: expo-updates (updateId, createdAt, channel, runtimeVersion,
//   isEmbeddedLaunch).
// - commit: app.config.js `extra.gitCommitHash` (EAS_BUILD_GIT_COMMIT_HASH
//   on a build; `git rev-parse HEAD` at `eas update` time), read from
//   Constants.expoConfig, else from the running update's own manifest.

type ApplicationModule = { nativeApplicationVersion: string | null; nativeBuildVersion: string | null };

function read<T>(name: string, errors: string[], fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    errors.push(name);
    return null;
  }
}

function application(errors: string[]): ApplicationModule | null {
  return read('expo-application', errors, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-application') as ApplicationModule;
  });
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export function getBuildInfo(): BuildInfo {
  const errors: string[] = [];
  const app = application(errors);
  const nativeVersion = text(read('Application.nativeApplicationVersion', errors, () => app?.nativeApplicationVersion));
  const buildVersion = text(read('Application.nativeBuildVersion', errors, () => app?.nativeBuildVersion));
  const expoConfig = read('Constants.expoConfig', errors, () => Constants.expoConfig);
  const configVersion = text(expoConfig?.version);
  const updateId = text(read('Updates.updateId', errors, () => Updates.updateId));
  const createdAt = read('Updates.createdAt', errors, () => Updates.createdAt);
  const manifestCommit = read('Updates.manifest', errors, () => {
    const m = Updates.manifest as { extra?: { expoClient?: { extra?: { gitCommitHash?: unknown } } } } | null | undefined;
    return m?.extra?.expoClient?.extra?.gitCommitHash;
  });
  const gitCommitHash = text(expoConfig?.extra?.gitCommitHash) ?? text(manifestCommit);
  const isEmbeddedLaunch = read('Updates.isEmbeddedLaunch', errors, () => Updates.isEmbeddedLaunch) === true;
  return {
    version: nativeVersion ?? configVersion ?? NULL_NAMES.version,
    buildVersion,
    updateId,
    updateIdShort: shorten(updateId),
    updateCreatedAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : null,
    channel: text(read('Updates.channel', errors, () => Updates.channel)),
    // Updates.runtimeVersion is expo-updates' own value for the running
    // binary — compare it against `eas update:list` for the update you
    // expect; a mismatch makes an update incompatible regardless of channel.
    runtimeVersion: text(read('Updates.runtimeVersion', errors, () => Updates.runtimeVersion)),
    gitCommitHash,
    gitCommitHashShort: shorten(gitCommitHash, 7),
    isEmbeddedLaunch,
    errors,
  };
}
