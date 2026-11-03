import * as Updates from 'expo-updates';
import { mapCheckForUpdateOutcome, type CheckForUpdateResult } from '@/src/lib/checkForUpdateFormat';

export type { CheckForUpdateResult } from '@/src/lib/checkForUpdateFormat';

// MANUAL "CHECK FOR UPDATE NOW" (owner decision, device report: "eas
// update has never reached my device... a failed update is never
// invisible again"). expo-updates' own automatic ON_LOAD check (kept, the
// default; app.config.js sets no `checkAutomatically` override) is
// silent by design. This module makes the check observable on demand.
// All status/message DECISIONS live in the pure, tested
// checkForUpdateFormat.ts — this file only calls the real Updates.* APIs.
//
// UPDATE VISIBILITY FIX (owner 2026-11-03): an update that is found is
// downloaded right away; the screen then offers "Restart now"
// (restartToApplyUpdate). A downloaded update applies on the next launch
// either way.
export async function checkForUpdateNow(): Promise<CheckForUpdateResult> {
  const isEnabled = Updates.isEnabled;
  if (!isEnabled) {
    return mapCheckForUpdateOutcome(false, { type: 'not-available' });
  }
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return mapCheckForUpdateOutcome(true, { type: 'not-available' });
    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew && !fetched.isRollBackToEmbedded) return mapCheckForUpdateOutcome(true, { type: 'not-available' });
    const manifest = (fetched.manifest ?? result.manifest) as { id?: string; createdAt?: string } | undefined;
    return mapCheckForUpdateOutcome(true, { type: 'downloaded', manifestId: manifest?.id ?? null, createdAt: manifest?.createdAt ?? null });
  } catch (err) {
    // The exact caught message IS the diagnostic payload here — a
    // network failure, a manifest/runtime-version mismatch, or a
    // server-side error all produce distinct text from expo-updates
    // itself; never swallow it down to a generic string.
    return mapCheckForUpdateOutcome(true, { type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export type ApplyUpdateResult = { success: boolean; message: string };

// "Restart now": runs the downloaded update. reloadAsync() tears down the
// JS context, so the return is only reached on a failure.
export async function restartToApplyUpdate(): Promise<ApplyUpdateResult> {
  try {
    await Updates.reloadAsync();
    return { success: true, message: 'Restarting.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}
