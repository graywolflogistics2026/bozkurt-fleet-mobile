import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PROMPTS.md Session 8 — local notification scaffolding for Truck Health
// (Local notifications are fine for v1). Deliberately string-free (CLAUDE.md
// invariant #11: no hardcoded user-facing string) — the caller (the Truck
// Health screen, which has `t()`) builds the localized title/body and
// passes them in; this module only owns permission/dedupe/scheduling
// mechanics, never copy.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// No background task runner exists yet, so there's no daily re-check —
// this fires shortly after the Truck Health screen itself computes a
// due_soon/overdue status (the one moment the app actually knows about
// it). A future session can swap the trigger for a real background-
// scheduled one without touching the dedupe/permission logic here.
const FIRE_DELAY_SECONDS = 5;
// Don't re-notify for a status that hasn't changed within this window —
// "sensible dedupe so it doesn't nag daily" (owner ask) even though the
// only trigger today is "the user opened the screen again."
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function dedupeKey(truckId: string, category: string): string {
  return `truck-health-notif:${truckId}:${category}`;
}

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

// Only call this from an explicit user action (a button tap with context
// already shown) — "permission asked politely with context" (owner ask),
// never fired automatically on screen mount.
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status;
}

export type HealthAlertStatus = 'due_soon' | 'overdue';

export async function scheduleHealthNotification(params: {
  truckId: string;
  category: string;
  status: HealthAlertStatus;
  title: string;
  body: string;
}): Promise<void> {
  const permission = await getNotificationPermissionStatus();
  if (permission !== 'granted') return;

  const key = dedupeKey(params.truckId, params.category);
  const stored = await AsyncStorage.getItem(key);
  const parsed = stored ? (JSON.parse(stored) as { status: HealthAlertStatus; notifiedAt: number }) : null;
  const unchanged = !!parsed && parsed.status === params.status && Date.now() - parsed.notifiedAt < DEDUPE_WINDOW_MS;
  if (unchanged) return;

  await Notifications.scheduleNotificationAsync({
    identifier: key,
    content: { title: params.title, body: params.body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: FIRE_DELAY_SECONDS },
  });
  await AsyncStorage.setItem(key, JSON.stringify({ status: params.status, notifiedAt: Date.now() }));
}
