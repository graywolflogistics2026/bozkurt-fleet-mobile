import * as Updates from 'expo-updates';
import { mapCheckForUpdateOutcome, type CheckForUpdateResult } from '@/src/lib/checkForUpdateFormat';

export type { CheckForUpdateResult } from '@/src/lib/checkForUpdateFormat';

// MANUAL "CHECK FOR UPDATE NOW" (owner decision, device report: "eas
// update has never reached my device... a failed update is never
// invisible again"). This app has NO existing manual expo-updates call
// anywhere (confirmed by a repo-wide grep before writing this) — it
// relies entirely on expo-updates' own automatic ON_LOAD check (the
// default; app.config.js sets no `checkAutomatically` override), which
// fails SILENTLY by design: no update found, a network error, or a
// genuine runtime-version/channel mismatch on the server side all just
// mean nothing happens on the next cold start, with nothing surfaced to
// the user either way. This module exists specifically to make that
// check observable ON DEMAND, from the device itself, without waiting on
// (or guessing about) a cold restart's own silent automatic attempt —
// this is the one thing about "is OTA delivery actually broken, and
// why" that's answerable from a real device but NOT from a dev sandbox
// with no `eas` CLI/credentials (see CLAUDE.md's own dated entry on that
// limitation). All actual status/message DECISIONS live in the pure,
// tested checkForUpdateFormat.ts — this file is a thin orchestrator that
// only calls the real Updates.* APIs and hands their outcome over.
export async function checkForUpdateNow(): Promise<CheckForUpdateResult> {
  const isEnabled = Updates.isEnabled;
  if (!isEnabled) {
    return mapCheckForUpdateOutcome(false, { type: 'not-available' });
  }
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      return mapCheckForUpdateOutcome(true, {
        type: 'available',
        manifestId: (result.manifest as { id?: string } | undefined)?.id ?? null,
      });
    }
    return mapCheckForUpdateOutcome(true, { type: 'not-available' });
  } catch (err) {
    // The exact caught message IS the diagnostic payload here — a
    // network failure, a manifest/runtime-version mismatch, or a
    // server-side error all produce distinct text from expo-updates
    // itself; never swallow it down to a generic string.
    return mapCheckForUpdateOutcome(true, { type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export type ApplyUpdateResult = { success: boolean; message: string };

export async function downloadAndApplyUpdate(): Promise<ApplyUpdateResult> {
  try {
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    // reloadAsync() tears down the JS context — this return is normally
    // unreachable, kept only so the function has a defined success path
    // for testing/typing purposes.
    return { success: true, message: 'Update downloaded — reloading now.' };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}
