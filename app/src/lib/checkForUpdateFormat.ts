// Pure half of checkForUpdate.ts — deliberately has ZERO import of
// expo-updates, so it's unit-testable in a plain Node environment (this
// repo's jest setup has no jest-expo/native-module mocking, same reason
// buildInfo.ts's own pure half, buildInfoFormat.ts, is split out this
// way). The impure orchestrator (checkForUpdate.ts) calls the real
// Updates.* APIs and hands their raw outcome to mapCheckForUpdateOutcome()
// below, which does 100% of the actual status/message decision-making.
export type CheckForUpdateResult =
  | { status: 'disabled'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'update-available'; message: string; manifestId: string | null }
  | { status: 'error'; message: string };

export type CheckForUpdateOutcome =
  | { type: 'available'; manifestId: string | null }
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
  if (outcome.type === 'available') {
    return { status: 'update-available', message: 'A new update is available.', manifestId: outcome.manifestId };
  }
  return { status: 'up-to-date', message: 'Checked successfully — no new update is available for this build/channel/runtime version.' };
}
