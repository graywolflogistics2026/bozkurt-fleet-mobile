// PDF CHUNKING FOR MULTI-PAGE SETTLEMENTS (owner decision 2026-08-02,
// device evidence: real 8-page Prime settlements consistently exceeded
// the Anthropic call's own timeout). This module holds the PURE, portable
// TypeScript half of that feature — page-range arithmetic and
// deterministic JSON merging — deliberately with ZERO Deno-specific APIs
// and ZERO external imports, so it can be unit-tested directly from the
// app's Jest suite via a relative import (see
// app/src/import/__tests__/chunking.test.ts) without needing a Deno
// runtime in CI. The Deno-only half (actually splitting PDF bytes via
// pdf-lib, which only runs at the edge) lives in index.ts and calls
// computeChunkPageRanges() from here to know WHERE to cut.
//
// Each Edge Function in this repo is self-contained (existing convention
// — see delete-account/reset-data's duplicated deleteStorageFolder()) —
// this module deliberately does NOT import app/src/import/types.ts's
// `Extraction` type (that would entangle this Deno function's
// deployment with the RN app's directory); ChunkExtraction below is a
// minimal, LOCAL shape covering only the fields this module actually
// reads/writes. Any field this module doesn't know about is preserved
// unchanged from chunk[0] via the object spread in mergeChunkedExtractions.

export type ChunkExtraction = {
  docType?: string;
  date?: string;
  vendor?: string;
  totalAmount?: number;
  taxDeductible?: boolean;
  bizPct?: number;
  summary?: string;
  confidence?: 'high' | 'low';
  suggestedCategory?: string;
  settlement?: {
    weekEnding?: string;
    printDate?: string;
    carrier?: string;
    unit?: string;
    driverName?: string;
    grossRevenue?: number;
    reimbursements?: number;
    totalDeductions?: number;
    netPay?: number;
    totalMiles?: number;
    loadedMiles?: number;
    revenueItems?: unknown[];
    reimbursementItems?: unknown[];
    loads?: unknown[];
    tractorFuel?: unknown[];
    reeferFuel?: unknown[];
    deductions?: unknown[];
    maintenance?: unknown[];
    tolls?: {
      ezpass?: { total?: number; items?: unknown[] };
      drivewyze?: { total?: number; items?: unknown[] };
    };
    loans?: unknown[];
    assets?: Record<string, unknown>;
    operating?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type PageRange = { start: number; end: number };

// 1-indexed, inclusive page ranges covering every page exactly once —
// e.g. computeChunkPageRanges(8, 3) -> [{1,3},{4,6},{7,8}]. Never
// overlapping (the whole point: non-overlapping ranges mean concatenating
// each chunk's line-item arrays can never duplicate a real line item).
export function computeChunkPageRanges(totalPages: number, pagesPerChunk: number): PageRange[] {
  if (totalPages <= 0 || pagesPerChunk <= 0) return [];
  const ranges: PageRange[] = [];
  for (let start = 1; start <= totalPages; start += pagesPerChunk) {
    ranges.push({ start, end: Math.min(start + pagesPerChunk - 1, totalPages) });
  }
  return ranges;
}

// Appended to the SAME base extraction prompt for each chunk — tells the
// model it's seeing only a subset of pages and must leave anything not
// visible on THESE pages at its normal schema default rather than
// guessing/reconstructing it (another chunk's own extraction supplies it;
// see mergeChunkedExtractions()'s "chunk[0] priority" rule below, which
// relies on this instruction actually being followed).
export function buildChunkPromptAddendum(range: PageRange, totalPages: number): string {
  return `\n\nIMPORTANT — PARTIAL DOCUMENT: this file contains ONLY pages ${range.start}-${range.end} of a ${totalPages}-page settlement statement (split for processing; you are seeing a subset, not the whole document). Extract whatever sections/line items appear on THESE specific pages using the exact same JSON schema as always. Leave any field that does not appear on these pages at its normal zero/empty default (0, "", or an empty array) — do NOT guess, estimate, or reconstruct a value that isn't visible here, and do NOT repeat a total/summary figure that belongs to a different section of the document. Header/summary fields (weekEnding, printDate, carrier, unit, driverName, grossRevenue, netPay, totalMiles, reimbursements, totalDeductions) usually appear only on the settlement's first page — if that page is not among ${range.start}-${range.end}, leave those fields at their default; a different chunk's own extraction will supply them.`;
}

function firstNonEmptyString(values: (string | undefined)[]): string | undefined {
  for (const v of values) if (v) return v;
  return undefined;
}

function concatArrays<T>(arrays: (T[] | undefined)[]): T[] {
  const out: T[] = [];
  for (const arr of arrays) if (Array.isArray(arr)) out.push(...arr);
  return out;
}

// Header/summary numerics (grossRevenue, totalMiles, ...) use "chunk[0]'s
// value, full stop" (see mergeChunkedExtractions) rather than this
// function — a 0 there is very often a legitimate value (e.g. a genuine
// 0-mile home week) that must never be skipped past in favor of a later
// chunk's value. This scanner is for LOWER-STAKES numerics that can
// legitimately live on ANY page (tolls subtotals, the optional
// "operating" YTD section) — first non-zero across every chunk, falling
// back to the first merely-defined (possibly 0) value if every chunk is
// genuinely 0/undefined.
function firstMeaningfulNumber(values: (number | undefined)[]): number | undefined {
  for (const v of values) if (v !== undefined && v !== null && v !== 0) return v;
  for (const v of values) if (v !== undefined && v !== null) return v;
  return undefined;
}

function firstTruthyObject<T extends Record<string, unknown>>(objs: (T | undefined)[]): T | undefined {
  for (const o of objs) {
    if (o && Object.values(o).some((v) => (Array.isArray(v) ? v.length > 0 : !!v))) return o;
  }
  return objs.find((o) => o !== undefined);
}

// Deterministic merge of one settlement extraction per page-chunk (in
// page order — chunks[0] is always the range starting at page 1) back
// into a single Extraction-shaped object. Field-by-field rules, chosen so
// the result is reproducible and never silently drops or duplicates a
// dollar amount:
//   - Header/summary SCALARS that are near-universally on page 1
//     (weekEnding, printDate, carrier, unit, driverName, grossRevenue,
//     netPay, totalMiles, reimbursements, totalDeductions, loadedMiles):
//     chunk[0]'s value, unconditionally, for numerics (0 is a legitimate
//     answer, e.g. a home week — "first non-zero" would wrongly skip past
//     a correct 0 in favor of a later chunk's erroneous guess); "first
//     non-empty STRING across all chunks" for text fields, as a safety
//     net for the rare case the header spans a chunk boundary.
//   - Line-item ARRAYS (loads, fuel, deductions, maintenance, tolls
//     items, loans, revenue/reimbursement items): concatenated across
//     every chunk in page order — safe because chunk page ranges never
//     overlap, so the same physical line can never appear twice.
//   - Tolls SUBTOTALS and the optional "operating"/"assets" sections: not
///    guaranteed to be on page 1, so these scan every chunk for the
//     first meaningful (non-zero, or non-empty object) value instead of
//     assuming chunk[0].
//   - `summary`: every chunk's non-empty summary concatenated (each
//     chunk only sees part of the document, so its own summary is
//     necessarily partial) — capped defensively at 2000 chars.
//   - `confidence`: ALWAYS "low" on a merged (2+ chunk) result,
//     regardless of what any individual chunk reported — a multi-chunk
//     merge is inherently more guess-prone than a single coherent read
//     (a heuristic decides where the header "really" is, array
//     concatenation assumes clean non-overlapping boundaries, etc.), so
//     CLAUDE.md's "never silently trust a guess" needs-review machinery
//     should always see this result before it's saved.
export function mergeChunkedExtractions(chunks: ChunkExtraction[]): ChunkExtraction {
  if (chunks.length === 0) throw new Error('mergeChunkedExtractions: no chunks to merge');
  if (chunks.length === 1) return chunks[0];

  const primary = chunks[0];
  const summary = chunks
    .map((c) => c.summary)
    .filter((s): s is string => !!s)
    .join(' ')
    .slice(0, 2000);

  const merged: ChunkExtraction = {
    ...primary,
    date: firstNonEmptyString(chunks.map((c) => c.date)) ?? primary.date,
    vendor: firstNonEmptyString(chunks.map((c) => c.vendor)) ?? primary.vendor,
    summary: summary || primary.summary,
    confidence: 'low',
    suggestedCategory: firstNonEmptyString(chunks.map((c) => c.suggestedCategory)) ?? primary.suggestedCategory,
  };

  if (primary.docType === 'settlement') {
    const settlements = chunks.map((c) => c.settlement).filter((s): s is NonNullable<ChunkExtraction['settlement']> => !!s);
    const first = settlements[0] ?? {};
    merged.settlement = {
      ...first,
      weekEnding: firstNonEmptyString(settlements.map((s) => s.weekEnding)) ?? first.weekEnding,
      printDate: firstNonEmptyString(settlements.map((s) => s.printDate)) ?? first.printDate,
      carrier: firstNonEmptyString(settlements.map((s) => s.carrier)) ?? first.carrier,
      unit: firstNonEmptyString(settlements.map((s) => s.unit)) ?? first.unit,
      driverName: firstNonEmptyString(settlements.map((s) => s.driverName)) ?? first.driverName,
      grossRevenue: first.grossRevenue,
      reimbursements: first.reimbursements,
      totalDeductions: first.totalDeductions,
      netPay: first.netPay,
      totalMiles: first.totalMiles,
      loadedMiles: first.loadedMiles,
      revenueItems: concatArrays(settlements.map((s) => s.revenueItems)),
      reimbursementItems: concatArrays(settlements.map((s) => s.reimbursementItems)),
      loads: concatArrays(settlements.map((s) => s.loads)),
      tractorFuel: concatArrays(settlements.map((s) => s.tractorFuel)),
      reeferFuel: concatArrays(settlements.map((s) => s.reeferFuel)),
      deductions: concatArrays(settlements.map((s) => s.deductions)),
      maintenance: concatArrays(settlements.map((s) => s.maintenance)),
      tolls: {
        ezpass: {
          total: firstMeaningfulNumber(settlements.map((s) => s.tolls?.ezpass?.total)),
          items: concatArrays(settlements.map((s) => s.tolls?.ezpass?.items)),
        },
        drivewyze: {
          total: firstMeaningfulNumber(settlements.map((s) => s.tolls?.drivewyze?.total)),
          items: concatArrays(settlements.map((s) => s.tolls?.drivewyze?.items)),
        },
      },
      loans: concatArrays(settlements.map((s) => s.loans)),
      assets: firstTruthyObject(settlements.map((s) => s.assets)) ?? first.assets,
      operating: firstTruthyObject(settlements.map((s) => s.operating)) ?? first.operating,
    };
  }

  return merged;
}

// GAP-TOLERANT PAGE MERGE (owner decision 2026-08-03, round 4 — "STOP
// AND SIMPLIFY" + MEASURED EVIDENCE fix. Real per-page Anthropic call
// durations from Supabase logs: 23.9s, 39.1s, and one that needed just
// over the OLD 40s cap and got killed — single pages can legitimately
// need up to (and apparently sometimes just past) 40s. Round 3's
// `mergeSequentialPageResults` STOPPED THE WHOLE DOCUMENT at the first
// failed page — that is exactly why a real 11-page settlement's banner
// read "Imported pages 1-1 of 11" after page 2 hit the old 40s cap. This
// replaces that stop-at-first-failure design with a GAP-TOLERANT one:
// a page that fails (even after index.ts's one non-fatal retry) is
// recorded as MISSING and the loop moves on to every remaining page —
// "the loop must always attempt every page" (owner decision). The
// server-side per-page network calls and retry-once logic live in
// index.ts (Deno-only); this function is the pure, testable merge/
// bookkeeping half it hands already-resolved per-page outcomes to.
export type PageOutcome = { page: number; extraction: ChunkExtraction } | { page: number; missing: true };

export type FullMergeResult = {
  extraction: ChunkExtraction;
  // Page numbers that produced real data vs. that failed even after
  // retry, both in ascending page order — the import screen turns
  // `missingPages` into a plain "pages X, Y couldn't be processed" note,
  // and the reconciliation guard (settlementReconciliation.ts) still
  // independently catches the resulting incomplete totals regardless of
  // whether the caller even surfaces this list.
  coveredPages: number[];
  missingPages: number[];
};

export function mergeAllPages(outcomes: PageOutcome[]): FullMergeResult | null {
  const succeeded = outcomes.filter((o): o is { page: number; extraction: ChunkExtraction } => 'extraction' in o);
  if (succeeded.length === 0) return null;

  const extractions = succeeded.map((o) => o.extraction);
  const merged = extractions.length === 1 ? { ...extractions[0] } : mergeChunkedExtractions(extractions);
  const missingPages = outcomes.filter((o): o is { page: number; missing: true } => 'missing' in o).map((o) => o.page);
  // A single successfully-processed page (or a full set with zero gaps)
  // is a complete, coherent read (mergeChunkedExtractions' own
  // "confidence forced low" rule only fires for a 2+-extraction merge)
  // — but ANY missing page means the result as a whole is incomplete
  // data for whatever this document actually is, so the needs-review
  // machinery must see it regardless of how many pages merged cleanly.
  if (missingPages.length > 0) merged.confidence = 'low';
  return { extraction: merged, coveredPages: succeeded.map((o) => o.page), missingPages };
}
