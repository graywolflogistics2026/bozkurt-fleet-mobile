// UX MEGA-PASS item E (owner decision 2026-07-31, device evidence: a
// document's title/label must reflect the actual store or document
// subject, e.g. "Walmart", not the raw docType label "Store/Amazon
// Purchase"). `documents.parsed_json` always holds the FULL raw
// Extraction (CLAUDE.md's D3 audit trail, aiImportSave.ts) regardless of
// docType, and `Extraction.vendor` is populated by the AI-import prompt
// for any document that names a vendor/store/shop on its face — not just
// purchase receipts. Falls back to the docType's own i18n label
// (docTypeMeta) whenever no vendor was extracted, which is the previous
// (and still correct) behavior for docTypes that never carry a vendor
// name at all (e.g. a bank statement).
export function deriveDocumentTitle(parsedJson: Record<string, unknown> | null | undefined, fallbackLabel: string): string {
  const vendor = parsedJson?.vendor;
  if (typeof vendor === 'string' && vendor.trim().length > 0) return vendor.trim();
  return fallbackLabel;
}
