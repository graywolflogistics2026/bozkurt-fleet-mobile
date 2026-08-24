// CARRIER-SCOPED PAYROLL/SETTLEMENT CODES (owner decision, CARRIER-SCOPED
// PAYROLL CODES pass — critical isolation rule, see CLAUDE.md's own dated
// entry for the full invariant text). A two-letter settlement chargeback
// code (e.g. "DH", "BT", "AP") means what it means AT THE CARRIER THAT
// ISSUED THE STATEMENT ONLY — never applied globally, never guessed from
// the user's profile or a prior import. Every function here is pure (no
// I/O) and takes the caller's own already-fetched `CarrierCode[]` — the
// actual data lives server-side in `carrier_code_maps`
// (docs/PENDING_SQL.md §52), never hardcoded in this file (same "no tax
// constant lives in app code" pattern CLAUDE.md invariant #6 already
// establishes for tax_year_data).

export type CarrierCode = {
  carrier: string; // already-normalized key, e.g. 'PRIME INC'
  code: string;
  subCode: string | null;
  label: string;
  description: string | null;
  category: string | null; // null = leave to the generic classifier (income/administrative/ambiguous)
  isDeductible: boolean | null; // null = not an expense line at all
  incomeOrChargeback: 'income' | 'chargeback' | null;
  notes: string | null;
};

// Normalizes a carrier's raw, freely-typed name (as extracted from a
// document's own letterhead, e.g. "Prime, Inc." / "PRIME INC." / "prime
// inc") into the same lookup key `carrier_code_maps.carrier` is seeded
// with — uppercase, punctuation stripped, whitespace collapsed. Returns
// null for an empty/missing carrier (nothing to match against).
export function normalizeCarrierKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return key.length > 0 ? key : null;
}

// Escapes a code/label fragment for use inside a RegExp, then wraps it in
// word boundaries so a short code like "TO" never matches inside an
// unrelated word (e.g. "AUTO").
function wordBoundaryRegex(fragment: string): RegExp {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

// Finds the carrier-specific code that matches a settlement line's own
// description — CARRIER-SCOPED BY CONSTRUCTION: `codes` is filtered down
// to rows whose `carrier` matches `carrierKey` FIRST, before any text
// matching happens, so a code fragment that happens to coincide with a
// DIFFERENT carrier's code can never match. Returns null (never a guess)
// when `carrierKey` is null, doesn't match any seeded carrier, or no code
// in that carrier's own map appears in the description.
export function findCarrierCodeMatch(
  carrierKey: string | null,
  description: string | null | undefined,
  codes: CarrierCode[]
): CarrierCode | null {
  if (!carrierKey || !description) return null;
  const carrierCodes = codes.filter((c) => c.carrier === carrierKey);
  if (carrierCodes.length === 0) return null;

  for (const entry of carrierCodes) {
    if (wordBoundaryRegex(entry.code).test(description)) return entry;
  }
  // Fall back to matching the code's own LABEL text (some statements spell
  // out "DEADHEAD" instead of printing the bare "DH" code) — still
  // strictly scoped to this one carrier's own codes.
  for (const entry of carrierCodes) {
    if (entry.label && wordBoundaryRegex(entry.label).test(description)) return entry;
  }
  return null;
}

// The category half of a carrier-code match — this is what
// mapExtraction.ts's settlement-deduction mapper reads FIRST, ahead of
// the generic, carrier-agnostic classifySettlementLine() (category.ts).
// A null category on the matched row (an income/administrative/ambiguous
// code, docs/CARRIER_CODES.md's own Notes column) still returns null
// here — that's the SAME "leave it to the generic classifier" signal a
// non-match produces, so the caller's fallback chain doesn't need to
// distinguish the two cases.
export function classifySettlementLineForCarrier(
  carrierKey: string | null,
  description: string | null | undefined,
  codes: CarrierCode[]
): string | null {
  return findCarrierCodeMatch(carrierKey, description, codes)?.category ?? null;
}

// Applies carrier-scoped classification across a whole batch of already-
// mapped deduction rows — only OVERRIDES `category` (and, when the match
// says so, `tax_deductible`) on a row where a real carrier-scoped match
// was found; every other row is returned untouched, left for the
// caller's own existing fallback chain (classifySettlementLine() ->
// chargebackType -> raw category string).
export function applyCarrierCodeCategories<T extends { description?: string | null; category?: string | null; tax_deductible?: boolean }>(
  rows: T[],
  carrierKey: string | null,
  codes: CarrierCode[]
): T[] {
  if (!carrierKey || codes.length === 0) return rows;
  return rows.map((row) => {
    const match = findCarrierCodeMatch(carrierKey, row.description, codes);
    if (!match || !match.category) return row;
    return {
      ...row,
      category: match.category,
      ...(match.isDeductible != null ? { tax_deductible: match.isDeductible } : {}),
    };
  });
}

// Prompt-context block for ai-import (owner decision, item 3: "pass ONLY
// the matching carrier's code map into the prompt"). Because the
// carrier itself isn't known until AFTER extraction (this app makes a
// SINGLE Anthropic call per document, never a two-pass "detect carrier
// first" flow — see CLAUDE.md's own note on this tradeoff), every
// seeded carrier's own codes are included, each wrapped in an explicit,
// carrier-named "ONLY apply if you can confirm this document's own
// letterhead says exactly this carrier — otherwise ignore this list
// entirely" instruction. This keeps the single-call architecture intact
// today (only one carrier is seeded) while staying correct as more
// carriers are added: the model is never told to guess, and the
// DETERMINISTIC post-extraction step (findCarrierCodeMatch(), scoped to
// the settlement's own actually-extracted carrier text) is the real
// safety net regardless of what the model does with this hint. Groups by
// carrier; returns '' when there's nothing seeded yet.
export function buildCarrierCodePromptBlock(codes: CarrierCode[]): string {
  if (codes.length === 0) return '';
  const byCarrier = new Map<string, CarrierCode[]>();
  for (const c of codes) {
    if (!byCarrier.has(c.carrier)) byCarrier.set(c.carrier, []);
    byCarrier.get(c.carrier)!.push(c);
  }
  const blocks = Array.from(byCarrier.entries()).map(([carrier, entries]) => {
    const lines = entries
      .map((e) => `${e.code}${e.subCode ? `/${e.subCode}` : ''} = ${e.label}${e.description ? ` (${e.description})` : ''}`)
      .join('; ');
    return `If — and ONLY if — this document's own letterhead/header confirms the carrier is "${carrier}", these settlement line codes mean: ${lines}. If the carrier is anything else, ignore this list entirely and classify using your own general knowledge.`;
  });
  return blocks.join('\n');
}
