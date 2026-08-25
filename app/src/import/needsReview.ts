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
//
// NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
// testing round): there was no explicit "mark reviewed" action anywhere
// in the app, so neither signal above could ever be dismissed — a row
// stayed flagged forever regardless of the user having looked at it.
// `reviewed_at` (docs/PENDING_SQL.md §55a, on BOTH `deductions` and
// `documents`) is the one explicit override both checks below now
// respect — set ONLY by the new markDeductionReviewed()/
// markDocumentReviewed() mutations (src/data/needsReviewMutations.ts),
// NEVER by AI import itself (which only ever writes the ORIGINAL two
// signals). This is the CANONICAL signal — a deduction's "NEEDS REVIEW: "
// prefix is ALSO stripped from its description as a cosmetic cleanup
// when marked reviewed, but `reviewed_at` is what every check actually
// reads, so the flag clears reliably even if the description text isn't
// touched (e.g. the user edited it some other way first).
export function isDeductionNeedsReview(d: Pick<Deduction, 'description' | 'reviewed_at'>): boolean {
  if (d.reviewed_at) return false;
  return (d.description ?? '').trim().startsWith('NEEDS REVIEW:');
}

export function isDocumentNeedsReview(doc: Pick<DocumentRow, 'parsed_json' | 'reviewed_at'>): boolean {
  if (doc.reviewed_at) return false;
  return doc.parsed_json?.confidence === 'low';
}

// A settlement row carries no description/confidence of its own — its
// "needs review" status comes from its LINKED document's extraction
// confidence, looked up by `document_id`. Returns false (never a guess)
// when there's no linked document or it hasn't loaded yet. Marking the
// settlement reviewed (see the Settlements screen) actually marks its
// LINKED DOCUMENT reviewed, since that's the true source of this flag —
// once that document's own reviewed_at is set, this automatically
// reflects it too, with no separate settlement-level column needed.
export function isSettlementNeedsReview(
  settlement: Pick<Settlement, 'document_id'>,
  documentsById: Map<string, Pick<DocumentRow, 'parsed_json' | 'reviewed_at'>>
): boolean {
  if (!settlement.document_id) return false;
  const doc = documentsById.get(settlement.document_id);
  return doc ? isDocumentNeedsReview(doc) : false;
}

// The exact prefix mapExtraction.ts writes (CLAUDE.md invariant #14) —
// shared here so the mark-reviewed mutation strips precisely what was
// written, case-sensitively, never a loose/guessed pattern.
const NEEDS_REVIEW_PREFIX_RE = /^\s*NEEDS REVIEW:\s*/;

// Pure: what a deduction's description should become once reviewed — a
// cosmetic cleanup (the canonical "no longer needs review" signal is
// `reviewed_at`, set separately) so a row marked "Reviewed ✓" doesn't
// still visually shout "NEEDS REVIEW: " right next to that checkmark.
// Never touches a description that doesn't actually have the prefix.
export function stripNeedsReviewPrefix(description: string | null): string | null {
  if (!description) return description;
  return description.replace(NEEDS_REVIEW_PREFIX_RE, '').trim();
}

// Pure builders for the "Mark reviewed" mutations (src/data/
// needsReviewMutations.ts) — kept here, next to the two signals they
// clear, so the exact update shape is directly unit-testable without a
// Supabase mock. `now` is injectable for tests; every real call site lets
// it default to the actual current time.
export function buildMarkDeductionReviewedUpdate(
  description: string | null,
  now: string = new Date().toISOString()
): { reviewed_at: string; description: string | null } {
  return { reviewed_at: now, description: stripNeedsReviewPrefix(description) };
}

export function buildMarkDocumentReviewedUpdate(now: string = new Date().toISOString()): { reviewed_at: string } {
  return { reviewed_at: now };
}
