import type { Extraction } from '@/src/import/types';

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
  const byContent = existingDocs.filter(
    (doc) =>
      doc.doc_type === docType &&
      doc.doc_date === (extraction.date ?? null) &&
      Math.abs((doc.amount ?? 0) - (extraction.totalAmount ?? 0)) < 0.01
  );
  const byFilename = filename ? existingDocs.filter((doc) => doc.filename && doc.filename === filename) : [];
  return { byContent, byFilename };
}
