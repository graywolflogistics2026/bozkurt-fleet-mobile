import { slugify } from '@/src/import/storagePath';

// DEDUCTIONS MANUAL ENTRY — ATTACH A RECEIPT (owner decision) — a manual
// deduction's optional photo/PDF attachment follows the SAME `{user_id}/
// ...` storage convention every other upload in this app uses (CLAUDE.md's
// storage-path rule), organized under its own "Receipts" category folder —
// mirrors src/compliance/attachment.ts's buildComplianceAttachmentPath()
// exactly (same pattern, different category folder), for a manual
// deduction the same way that one exists for a manual compliance/renewal
// item.
export function buildDeductionAttachmentPath(userId: string, description: string, filename: string): string {
  return `${userId}/Receipts/${slugify(description || 'receipt')}/${filename}`;
}
