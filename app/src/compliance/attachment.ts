import { slugify } from '@/src/import/storagePath';

// DOCUMENTS & RENEWALS EXPANSION (owner decision 2026-08-24, device
// testing round, item 3) — a manual compliance/renewal item's optional
// attachment follows the SAME `{user_id}/...` storage convention every
// other upload in this app uses (CLAUDE.md's storage-path rule), organized
// under its own "Compliance" category folder (mirrors buildDocFolderParts'
// per-docType folder mapping in storagePath.ts, just for a docType — a
// manual renewal record — that AI-import never produces).
export function buildComplianceAttachmentPath(userId: string, label: string, filename: string): string {
  return `${userId}/Compliance/${slugify(label)}/${filename}`;
}
