import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/src/lib/supabase';

export { isImageFilename } from '@/src/data/documentsFilter';

// DOCUMENTS ARCHIVE (owner decision 2026-07-30): storage_path is always
// user-scoped ({user_id}/... — CLAUDE.md storage convention) and RLS-
// protected, so a document is NEVER viewed/shared via a public URL — every
// access goes through a short-lived signed URL generated on demand.

export async function getSignedDocumentUrl(storagePath: string, expiresInSeconds = 600): Promise<string> {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not generate a link to this file.');
  return data.signedUrl;
}

// Native share sheet (Share/Download, item 2 of the spec) — downloads the
// signed URL to a local cache file first since Sharing.shareAsync needs a
// local file:// URI, not a remote one (same File/Paths/Sharing pattern as
// the Accountant Package export, app/(tabs)/more/accountant-package.tsx).
export async function shareDocumentFile(storagePath: string, filename: string): Promise<void> {
  const signedUrl = await getSignedDocumentUrl(storagePath);
  const destination = await File.downloadFileAsync(signedUrl, Paths.cache);
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(destination.uri, { dialogTitle: filename });
}
