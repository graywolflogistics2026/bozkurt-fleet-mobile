import type { Extraction } from '@/src/import/types';
import { getPrimaryExtractionDate } from '@/src/import/dateGuard';

export type ExistingDocSummary = {
  filename: string | null;
  doc_date: string | null;
  doc_type: string | null;
  amount: number | null;
  imported_at: string;
};

export type DuplicateCheckResult = {
  byContent: ExistingDocSummary[];
  byFilename: ExistingDocSummary[];
};

// Verbatim port of legacy checkDuplicateImport() (legacy/index.html:2442):
// flags matches on docType + date + amount (1-cent tolerance for rounding),
// and separately on an exact filename match.
export function checkDuplicateImport(
  extraction: Extraction,
  filename: string | undefined,
  existingDocs: ExistingDocSummary[]
): DuplicateCheckResult {
  const docType = extraction.docType || 'other';
  const primaryDate = getPrimaryExtractionDate(extraction) || null;
  const byContent = existingDocs.filter(
    (doc) =>
      doc.doc_type === docType &&
      doc.doc_date === primaryDate &&
      Math.abs((doc.amount ?? 0) - (extraction.totalAmount ?? 0)) < 0.01
  );
  const byFilename = filename ? existingDocs.filter((doc) => doc.filename && doc.filename === filename) : [];
  return { byContent, byFilename };
}
