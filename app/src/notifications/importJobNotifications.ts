import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// BACKGROUND IMPORT (owner decision 2026-08-24) — same permission/
// scheduling pattern as truckHealthNotifications.ts/
// complianceNotifications.ts (mirrored rather than shared, per those
// modules' own established convention). Deliberately string-free
// (CLAUDE.md invariant #11) — the caller (useImportJobs()'s polling
// effect, which has t()) builds the localized title/body and passes them
// in.
//
// HONEST LIMITATION, stated plainly: this app has "no background task
// runner" (same limitation truckHealthNotifications.ts's own header
// comment already documents) — a local notification can only be
// SCHEDULED from the device's own running JS. The import JOB itself
// genuinely survives navigation and full app backgrounding (it's driven
// server-side via EdgeRuntime.waitUntil(), see supabase/functions/
// ai-import/index.ts) — but the NOTIFICATION firing the moment it's ready
// depends on this app's own polling loop (useImportJobs()) actually being
// alive to notice the transition, which requires the app to be
// foregrounded/backgrounded-but-still-JS-alive at that moment. If the app
// is fully closed/killed while a job finishes, the notification fires on
// the NEXT time the app is reopened and polls again — not at the exact
// moment completion happened. A guaranteed "notify me even if the app is
// fully closed" would need real push notifications (APNs/FCM device
// token registration + a server-side sender), a materially larger,
// separate feature this pass deliberately does not attempt.
//
// BACKGROUND IMPORT CRASH FIX (owner decision 2026-08-24, hard rule): a
// job's own completion (the chip/list updating) must NEVER depend on this
// module actually working — every exported function here is defensive
// about the native module potentially being unavailable (not linked in
// this build, a permission call throwing instead of returning 'denied',
// etc.), on top of the caller (ImportJobsChip.tsx) ALSO wrapping every
// call through src/import/importJobs.ts's runOptionalSideEffect() —
// belt-and-suspenders, since this module may have other, future callers.
// setNotificationHandler() itself runs at module-load time (same as
// truckHealthNotifications.ts/complianceNotifications.ts) — wrapped in a
// try/catch so importing this module can never throw synchronously and
// take down whatever imported it (the exact "drag-module crash-on-mount"
// class of bug CLAUDE.md already documents for a different screen).
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch {
  // The native module isn't available in this build/runtime — every
  // exported function below already no-ops safely when that's the case.
}

const NOTIFIED_JOB_IDS_KEY = 'import-job-notified-ids';
// A job's terminal state never changes back (ready/failed is final,
// short of an explicit retry which resets it to queued/processing) — so,
// unlike Truck Health's time-windowed dedupe, this is a permanent
// per-job-id dedupe: once notified for a given id, never again for that
// SAME id. Capped so a long-lived install's list doesn't grow unbounded.
const MAX_TRACKED_IDS = 200;

async function getNotifiedIds(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(NOTIFIED_JOB_IDS_KEY);
  return stored ? (JSON.parse(stored) as string[]) : [];
}

async function markNotified(jobId: string): Promise<void> {
  const ids = await getNotifiedIds();
  await AsyncStorage.setItem(NOTIFIED_JOB_IDS_KEY, JSON.stringify([...ids, jobId].slice(-MAX_TRACKED_IDS)));
}

// Lets a caller (ImportJobsChip) skip a potentially-expensive lookup
// (fetching result_json just to build a notification body) for a job
// that's already been notified about, without duplicating the dedupe
// list's own storage key/shape here. Defensive: AsyncStorage is a very
// standard dependency (low real risk), but a job's completion must never
// hinge on it either — an unreadable dedupe list means "not notified yet,"
// never a crash.
export async function hasNotifiedJob(jobId: string): Promise<boolean> {
  try {
    const ids = await getNotifiedIds();
    return ids.includes(jobId);
  } catch {
    return false;
  }
}

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

// Capability check (hard rule, owner decision 2026-08-24): if the native
// module isn't linked in this build, `Notifications.getPermissionsAsync`
// itself may not even be a function — calling it directly is exactly what
// crashed the background-import completion path. Every exported function
// below goes through this guard first.
function notificationsAvailable(): boolean {
  return typeof Notifications.getPermissionsAsync === 'function' && typeof Notifications.scheduleNotificationAsync === 'function';
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (!notificationsAvailable()) return 'denied';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch {
    return 'denied';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  if (!notificationsAvailable() || typeof Notifications.requestPermissionsAsync !== 'function') return 'denied';
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status;
  } catch {
    return 'denied';
  }
}

// Fires once per job id, ever (whether the job ended ready or failed) —
// the caller decides title/body per outcome. A denied/undetermined
// permission, an unavailable native module, or ANY other failure here is a
// silent no-op (the chip/list still show the same information visually;
// the notification is a convenience, never the only way to find out — see
// the HARD RULE note above this file's setNotificationHandler() call).
export async function notifyImportJobDone(jobId: string, params: { title: string; body: string }): Promise<void> {
  try {
    if (!notificationsAvailable()) return;
    const permission = await getNotificationPermissionStatus();
    if (permission !== 'granted') return;
    const ids = await getNotifiedIds();
    if (ids.includes(jobId)) return;
    await Notifications.scheduleNotificationAsync({
      identifier: `import-job:${jobId}`,
      content: { title: params.title, body: params.body },
      trigger: null,
    });
    await markNotified(jobId);
  } catch {
    // Never propagate — see the HARD RULE note above this file's
    // setNotificationHandler() call.
  }
}
