import { File } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { buildPrimeDriverExpenseAttachmentPath } from '@/src/primeDriverExpenses/attachment';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER — optional
// receipt attachment (owner decision 2026-09-17). Mirrors
// src/data/deductionAttachment.ts's uploadDeductionAttachment() exactly:
// upload the file first, then insert its `documents` row (D3 audit
// trail, doc_type always 'other' — no AI extraction behind a manual
// attachment). Returns the new document's id, to be stored as
// prime_driver_expenses.document_id.
export async function uploadPrimeDriverExpenseAttachment(
  userId: string,
  category: string,
  fileUri: string,
  filename: string,
  mediaType: string,
  expDate: string | null
): Promise<string> {
  const storagePath = buildPrimeDriverExpenseAttachmentPath(userId, category, filename);
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
      doc_date: expDate,
      amount: null,
      storage_path: storagePath,
      parsed_json: null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
