import { slugify } from '@/src/import/storagePath';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER — optional
// receipt attachment (owner decision 2026-09-17). Same `{user_id}/...`
// storage convention as every other upload in this app (CLAUDE.md's
// storage-path rule) — mirrors src/deductions/attachment.ts's
// buildDeductionAttachmentPath() exactly (same pattern, its own category
// folder, kept separate from Deductions' own Receipts folder so the two
// screens' attachments never collide on Storage path).
export function buildPrimeDriverExpenseAttachmentPath(userId: string, category: string, filename: string): string {
  return `${userId}/PrimeDriverExpenses/${slugify(category || 'expense')}/${filename}`;
}
