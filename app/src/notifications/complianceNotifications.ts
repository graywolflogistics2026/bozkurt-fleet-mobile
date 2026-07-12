import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Same permission/dedupe/scheduling pattern as
// truckHealthNotifications.ts (PROMPTS.md Session 9b item 9 — "local
// notifications ... same per-item scheduling pattern as Truck Health's
// alerts"), mirrored rather than shared since that module is keyed on
// truckId+category and this one is keyed on a single compliance_items id.
// Deliberately string-free (CLAUDE.md invariant #11) — the caller (the
// Compliance Tracker screen, which has `t()`) builds the localized
// title/body and passes them in.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const FIRE_DELAY_SECONDS = 5;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function dedupeKey(itemId: string): string {
  return `compliance-notif:${itemId}`;
}

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status;
}

export type ComplianceAlertStatus = 'due_soon' | 'overdue';

export async function scheduleComplianceNotification(params: {
  itemId: string;
  status: ComplianceAlertStatus;
  title: string;
  body: string;
}): Promise<void> {
  const permission = await getNotificationPermissionStatus();
  if (permission !== 'granted') return;

  const key = dedupeKey(params.itemId);
  const stored = await AsyncStorage.getItem(key);
  const parsed = stored ? (JSON.parse(stored) as { status: ComplianceAlertStatus; notifiedAt: number }) : null;
  const unchanged = !!parsed && parsed.status === params.status && Date.now() - parsed.notifiedAt < DEDUPE_WINDOW_MS;
  if (unchanged) return;

  await Notifications.scheduleNotificationAsync({
    identifier: key,
    content: { title: params.title, body: params.body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: FIRE_DELAY_SECONDS },
  });
  await AsyncStorage.setItem(key, JSON.stringify({ status: params.status, notifiedAt: Date.now() }));
}
