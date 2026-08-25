import { File } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { buildComplianceAttachmentPath } from '@/src/compliance/attachment';

// DOCUMENTS & RENEWALS EXPANSION (owner decision 2026-08-24, device
// testing round, item 3) — uploads a manually-attached photo/PDF for a
// compliance/renewal item and creates its `documents` row (D3 audit
// trail, CLAUDE.md), same two-step "upload the file, then insert the row
// that references its storage_path" order aiImportSave.ts's own upload
// step uses. docType is always 'other' — a manual renewal attachment has
// no AI extraction behind it, so there's no more specific DocType to use;
// docTypeMeta('other') already renders a sensible generic label/icon.
// Returns the new document's id, to be stored as
// compliance_items.source_document_id.
export async function uploadComplianceAttachment(
  userId: string,
  label: string,
  fileUri: string,
  filename: string,
  mediaType: string,
  docDate: string | null
): Promise<string> {
  const storagePath = buildComplianceAttachmentPath(userId, label, filename);
  const bytes = await new File(fileUri).bytes();
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, bytes, { contentType: mediaType, upsert: true });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      filename,
      doc_type: 'other',
      doc_date: docDate,
      amount: null,
      storage_path: storagePath,
      parsed_json: null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
