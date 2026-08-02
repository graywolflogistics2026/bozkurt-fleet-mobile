import type { Deduction, DocumentRow, Settlement } from '@/src/types/db';

// BETA FEEDBACK ROUND 2 (owner decision 2026-07-31, device tester
// report): "needs review" must be visually loud everywhere it appears —
// one shared, pure definition every screen's row/filter/badge derives
// from, instead of each screen re-deriving its own notion of "flagged."
// Two underlying signals, both treated identically per the directive
// ("low-confidence AI extractions use the same treatment"):
//  (1) a deduction whose description was prefixed "NEEDS REVIEW: " at
//      save time (CLAUDE.md invariant #3/#14 — an unrecognized-but-
//      financial document, or a service/fee line with no real item to
//      fold into);
//  (2) any extraction the AI itself flagged low-confidence
//      (`documents.parsed_json.confidence === 'low'`, CLAUDE.md
//      invariant #14) — a blurry/ambiguous key field, regardless of
//      docType.
export function isDeductionNeedsReview(d: Pick<Deduction, 'description'>): boolean {
  return (d.description ?? '').trim().startsWith('NEEDS REVIEW:');
}

export function isDocumentNeedsReview(doc: Pick<DocumentRow, 'parsed_json'>): boolean {
  return doc.parsed_json?.confidence === 'low';
}

// A settlement row carries no description/confidence of its own — its
// "needs review" status comes from its LINKED document's extraction
// confidence, looked up by `document_id`. Returns false (never a guess)
// when there's no linked document or it hasn't loaded yet.
export function isSettlementNeedsReview(
  settlement: Pick<Settlement, 'document_id'>,
  documentsById: Map<string, Pick<DocumentRow, 'parsed_json'>>
): boolean {
  if (!settlement.document_id) return false;
  const doc = documentsById.get(settlement.document_id);
  return doc ? isDocumentNeedsReview(doc) : false;
}
