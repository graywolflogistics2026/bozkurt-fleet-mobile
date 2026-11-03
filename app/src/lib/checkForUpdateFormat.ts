// Pure half of checkForUpdate.ts — deliberately has ZERO import of
// expo-updates, so it's unit-testable in a plain Node environment (this
// repo's jest setup has no jest-expo/native-module mocking, same reason
// buildInfo.ts's own pure half, buildInfoFormat.ts, is split out this
// way). The impure orchestrator (checkForUpdate.ts) calls the real
// Updates.* APIs and hands their raw outcome to mapCheckForUpdateOutcome()
// below, which does 100% of the actual status/message decision-making.
//
// UPDATE VISIBILITY FIX (owner 2026-11-03): a found update is DOWNLOADED
// right away ('downloaded'), and the screen offers "Restart now". After a
// check the screen shows the update that is RUNNING and the newest one
// DOWNLOADED (updateSlotText), so "downloaded, applies on next launch" and
// "running" can never be confused.
import { stamp } from '@/src/lib/buildInfoFormat';

export type CheckForUpdateResult =
  | { status: 'disabled'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'update-available'; message: string; manifestId: string | null }
  | { status: 'downloaded'; message: string; manifestId: string | null; createdAt: string | null }
  | { status: 'error'; message: string };

export type CheckForUpdateOutcome =
  | { type: 'available'; manifestId: string | null }
  | { type: 'downloaded'; manifestId: string | null; createdAt: string | null }
  | { type: 'not-available' }
  | { type: 'error'; message: string };

export function mapCheckForUpdateOutcome(isEnabled: boolean, outcome: CheckForUpdateOutcome): CheckForUpdateResult {
  if (!isEnabled) {
    return {
      status: 'disabled',
      message:
        'expo-updates is not enabled in this build (Updates.isEnabled === false) — this build cannot receive OTA updates at all, regardless of channel or publish history.',
    };
  }
  if (outcome.type === 'error') {
    return { status: 'error', message: outcome.message };
  }
  if (outcome.type === 'downloaded') {
    return {
      status: 'downloaded',
      message: 'A new update was downloaded. It applies when the app restarts.',
      manifestId: outcome.manifestId,
      createdAt: outcome.createdAt,
    };
  }
  if (outcome.type === 'available') {
    return { status: 'update-available', message: 'A new update is available.', manifestId: outcome.manifestId };
  }
  return { status: 'up-to-date', message: 'Checked successfully — no new update is available for this build/channel/runtime version.' };
}

// One update slot (running or downloaded): "abcdef12 · 2026-11-03 14:05 UTC",
// "embedded build", or the API name that returned null.
export function updateSlotText(
  slot: { updateId?: string | null; createdAt?: Date | string | null; isEmbeddedLaunch?: boolean } | null | undefined,
  nullName: string
): string {
  if (!slot) return nullName;
  const id = slot.updateId ? slot.updateId.slice(0, 8) : null;
  const created = slot.createdAt instanceof Date ? slot.createdAt.toISOString() : (slot.createdAt ?? null);
  const at = stamp(created);
  if (id) return at ? `${id} · ${at} UTC` : id;
  if (slot.isEmbeddedLaunch) return at ? `embedded build · ${at} UTC` : 'embedded build';
  return nullName;
}
