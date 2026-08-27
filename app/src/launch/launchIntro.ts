import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { shouldShowLaunchIntro } from '@/src/launch/launchIntroGate';

// ANIMATED BRAND INTRO — the IMPURE orchestrator. See launchIntroGate.ts
// for the actual (unit-tested) decision rules — this file's only job is
// resolving the two native "was this a targeted open" signals and holding
// the cold-start-per-process guard, neither of which can run inside this
// repo's plain-Node jest environment.

// COLD START, not "first time ever" and not "once per day" — a plain
// module-level flag is the correct (and only) mechanism for this: it
// starts `false` exactly once per real cold start (the JS engine/module
// registry is torn down and re-evaluated from scratch only when the OS
// actually kills and relaunches the process) and stays `true` for the
// remainder of that process's lifetime regardless of how many times the
// app is backgrounded/foregrounded or how many times this function is
// called again — no AsyncStorage/persisted flag needed, and none would be
// correct here (persisting it would make the intro a "once ever" feature,
// which isn't what "cold start only" means).
let hasCheckedThisProcess = false;

// Defensive same as every other native-capability check in this app
// (importJobNotifications.ts's own convention) — a native module that
// isn't linked/available must never crash the app on launch; it simply
// resolves as "no signal," which is the SAFER of the two possible
// mistakes here (worst case, the intro shows when it maybe shouldn't,
// never the reverse of silently crashing app startup).
export async function checkShouldShowLaunchIntro(): Promise<boolean> {
  const alreadyDecided = hasCheckedThisProcess;
  hasCheckedThisProcess = true;
  if (alreadyDecided) return false;

  const [url, notificationResponse] = await Promise.all([
    Linking.getInitialURL().catch(() => null),
    typeof Notifications.getLastNotificationResponseAsync === 'function'
      ? Notifications.getLastNotificationResponseAsync().catch(() => null)
      : Promise.resolve(null),
  ]);

  return shouldShowLaunchIntro({
    alreadyDecidedThisProcess: alreadyDecided,
    hasDeepLinkUrl: !!url,
    hasNotificationResponse: !!notificationResponse,
  });
}
