import { File } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { buildDeductionAttachmentPath } from '@/src/deductions/attachment';

// DEDUCTIONS MANUAL ENTRY — ATTACH A RECEIPT (owner decision) — uploads a
// manually-attached photo/PDF for a manual deduction and creates its
// `documents` row (D3 audit trail, CLAUDE.md), same two-step "upload the
// file, then insert the row that references its storage_path" order
// aiImportSave.ts's own upload step uses — mirrors
// src/data/complianceAttachment.ts's uploadComplianceAttachment() exactly.
// docType is always 'other' — a manual attachment has no AI extraction
// behind it, so there's no more specific DocType. The manual FIELDS
// (description/category/amount/date/payment method) stay the source of
// truth — this never re-extracts anything from the photo's contents; the
// attachment is proof only. Returns the new document's id, to be stored
// as deductions.document_id (which is what makes the deduction appear in
// Documents & Renewals the same way an AI-imported one does — that screen
// already lists any deduction with a document_id via its existing
// findLinkedRecords()/documentTitle.ts machinery, no new UI needed there).
export async function uploadDeductionAttachment(
  userId: string,
  description: string,
  fileUri: string,
  filename: string,
  mediaType: string,
  dedDate: string | null
): Promise<string> {
  const storagePath = buildDeductionAttachmentPath(userId, description, filename);
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
      doc_date: dedDate,
      amount: null,
      storage_path: storagePath,
      parsed_json: null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
