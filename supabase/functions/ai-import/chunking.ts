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
// by mergeChunkedExtractions's generic field-by-field merge.

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
// mergeChunkedExtractions() treats a default 0/"" as "not on this
// page", so a value another page printed always wins).
export function buildChunkPromptAddendum(range: PageRange, totalPages: number): string {
  return `\n\nIMPORTANT — PARTIAL DOCUMENT: this file contains ONLY pages ${range.start}-${range.end} of a ${totalPages}-page settlement statement (split for processing; you are seeing a subset, not the whole document). Extract whatever sections/line items appear on THESE specific pages using the exact same JSON schema as always. Leave any field that does not appear on these pages at its normal zero/empty default (0, "", or an empty array) — do NOT guess, estimate, or reconstruct a value that isn't visible here, and do NOT repeat a total/summary figure that belongs to a different section of the document. Header/summary fields (weekEnding, printDate, carrier, unit, driverName, grossRevenue, netPay, totalMiles, reimbursements, totalDeductions) usually appear only on the settlement's first page — if that page is not among ${range.start}-${range.end}, leave those fields at their default; a different chunk's own extraction will supply them.`;
}

// A conflict: two pages printed DIFFERENT non-zero values for the same
// single-valued field (e.g. a statement total read as 1,884.73 on one page
// and 1,884.37 on the other). The first value is kept; the conflict travels
// with the merged extraction so the self-check can refuse to trust it.
export type MergeConflict = { path: string; values: number[] };

// Fields that describe the page split itself, never merged as data.
const PAGE_META_KEYS = new Set(['pageMap', 'mergeConflicts', 'pagesTotal']);

// Amount-like strings ("1,884.73", "$.37-", "(12.50)") as numbers, for
// conflict comparison only — the merged value itself is kept as printed.
function amountOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /-\s*$/.test(t) || /^-/.test(t);
  const digits = t.replace(/[()$,\s-]/g, '');
  if (!/^\d*\.?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

// A value a page actually printed: a non-zero number or a non-empty string.
// The schema default (0, "") is what a page returns when the field is not
// on it, so it never beats a printed value from another page.
function isMeaningful(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') return v.trim() !== '';
  return typeof v === 'boolean';
}

function mergeValues(values: unknown[], path: string, conflicts: MergeConflict[]): unknown {
  const defined = values.filter((v) => v !== undefined && v !== null);
  if (defined.length === 0) return values.find((v) => v !== undefined);
  // Line-item lists: every page's lines, in page order.
  if (defined.some(Array.isArray)) {
    const out: unknown[] = [];
    for (const v of defined) if (Array.isArray(v)) out.push(...v);
    return out;
  }
  // Nested sections (operating, tolls, assets): merged field by field.
  if (defined.every((v) => typeof v === 'object')) {
    const keys: string[] = [];
    for (const v of defined) for (const k of Object.keys(v as Record<string, unknown>)) if (!keys.includes(k)) keys.push(k);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = mergeValues(defined.map((v) => (v as Record<string, unknown>)[k]), path ? `${path}.${k}` : k, conflicts);
    }
    return out;
  }
  // Single values: null never beats a number, and a page's default (0 or
  // "") never beats a value another page printed. A genuine 0 (a home
  // week's 0 miles) survives because no page printed anything else.
  const meaningful = defined.filter(isMeaningful);
  if (meaningful.length === 0) return defined[0];
  const amounts = meaningful.map(amountOf).filter((n): n is number => n != null);
  if (amounts.length === meaningful.length && amounts.length > 1) {
    const distinct = [...new Set(amounts.map((n) => Math.round(n * 100) / 100))];
    if (distinct.length > 1) conflicts.push({ path, values: distinct });
  }
  return meaningful[0];
}

// Deterministic merge of per-page extractions (in page order; a base
// extraction, when re-reading pages of a saved document, goes first) into
// one Extraction-shaped object. Owner decision 2026-10-13 (17-page stall
// redesign, amendment 5): EVERY field is merged across pages — line-item
// arrays are joined in page order, single values take the first value a
// page actually printed (null never beats a number, a default 0/"" never
// beats a printed value), and two different printed values for the same
// field are recorded in `mergeConflicts`. This replaces the old rules that
// took header totals and the deposit from the lowest-numbered page only
// and the operating statement from the first page that had any of it — a
// statement printed across two pages lost its second page under those.
// `summary` joins every page's summary; `confidence` is always "low" for a
// multi-page merge (the needs-review machinery sees it before it's saved).
export function mergeChunkedExtractions(chunks: ChunkExtraction[]): ChunkExtraction {
  if (chunks.length === 0) throw new Error('mergeChunkedExtractions: no chunks to merge');
  if (chunks.length === 1) return chunks[0];

  const conflicts: MergeConflict[] = [];
  for (const c of chunks) {
    const prior = c.mergeConflicts;
    if (Array.isArray(prior)) conflicts.push(...(prior as MergeConflict[]));
  }
  const data = chunks.map((c) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) if (!PAGE_META_KEYS.has(k) && k !== 'summary' && k !== 'confidence') out[k] = v;
    return out;
  });
  const merged = mergeValues(data, '', conflicts) as ChunkExtraction;
  const summary = chunks
    .map((c) => c.summary)
    .filter((s): s is string => !!s)
    .join(' ')
    .slice(0, 2000);
  // The first page's docType wins (an attachment page read as part of a
  // settlement must never turn the whole document into a receipt).
  merged.docType = chunks.find((c) => !!c.docType)?.docType ?? merged.docType;
  merged.summary = summary || chunks[0].summary;
  merged.confidence = 'low';
  if (conflicts.length > 0) merged.mergeConflicts = conflicts;
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

  // SORT BY PAGE NUMBER (owner decision 2026-08-24, SPEED PASS — critical
  // correctness fix required by BOTH controlled concurrency and smart page
  // triage below): `outcomes` used to always arrive in natural page order,
  // since pages were both PROCESSED and RETURNED strictly sequentially —
  // `succeeded[0]` was always page 1's own extraction, which
  // mergeChunkedExtractions() relies on as its "primary" source for
  // header/summary scalars (weekEnding, grossRevenue, netPay, ...). Once
  // pages can be (a) reordered by triage (financially-meaningful pages
  // processed first, which is not always page 1's own physical position)
  // and/or (b) completed out of order under concurrency, that assumption
  // breaks — `succeeded[0]` could be ANY page. Sorting here, once, before
  // merge, restores the invariant regardless of processing/completion
  // order: `extractions[0]` is always the LOWEST-numbered page that
  // actually succeeded, never merely the one that finished first. This
  // also keeps every line-item array (loads, deductions, ...) concatenated
  // in natural page-ascending order, same as before.
  const sorted = [...succeeded].sort((a, b) => a.page - b.page);
  const extractions = sorted.map((o) => o.extraction);
  const merged = extractions.length === 1 ? { ...extractions[0] } : mergeChunkedExtractions(extractions);
  const missingPages = outcomes.filter((o): o is { page: number; missing: true } => 'missing' in o).map((o) => o.page);
  // A single successfully-processed page (or a full set with zero gaps)
  // is a complete, coherent read (mergeChunkedExtractions' own
  // "confidence forced low" rule only fires for a 2+-extraction merge)
  // — but ANY missing page means the result as a whole is incomplete
  // data for whatever this document actually is, so the needs-review
  // machinery must see it regardless of how many pages merged cleanly.
  if (missingPages.length > 0) merged.confidence = 'low';
  return { extraction: merged, coveredPages: sorted.map((o) => o.page), missingPages };
}

// CONTROLLED CONCURRENCY (owner decision 2026-08-24, SPEED PASS — an
// 11-page settlement processed strictly one page at a time took 3-5
// minutes; an EARLIER uncontrolled `Promise.all` attempt over a whole
// batch caused real Anthropic rate-limit/contention failures, which is
// exactly why processing went sequential in the first place). This is the
// one dial between those two failed extremes: a generic, order-preserving
// bounded-concurrency pool — at most `limit` workers run at once
// (deliberately never "fire everything," never "one at a time"), using
// the classic worker-pool pattern (each of the `limit` workers repeatedly
// claims the next unclaimed index from a shared cursor until the queue is
// empty) rather than batching+`Promise.all`, so a non-multiple-of-`limit`
// item count never leaves a worker idle. `results[i]` always corresponds
// to `items[i]` regardless of which one actually finishes first — this is
// what lets mergeAllPages() above safely sort by PAGE NUMBER rather than
// needing to reason about completion order itself.
export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runOneWorker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: boundedLimit }, () => runOneWorker()));
  return results;
}

// SMART PAGE TRIAGE (owner decision 2026-08-24, SPEED PASS): a
// settlement's financially meaningful pages (header/revenue/
// reimbursement/deduction/recap) are extracted FIRST so the client can
// show a running preview of the header/totals while an attachment-heavy
// tail (a photographed repair invoice, an EZ-Pass statement bundled into
// the same PDF) is still processing. This REORDERS, it never SKIPS —
// MULTI-PAGE SETTLEMENT CHUNKING ROUND 3's own hard-won lesson (CLAUDE.md)
// is that a fixed page CAP silently produced a $0-deductions settlement
// because real financial content lived past the cap; an
// attachment-looking page here still gets extracted, just LAST, and if
// it's ever cut off by the invocation's own time budget it becomes a
// `missingPages` entry — already gap-tolerant (mergeAllPages above) and
// already flagged low-confidence, never silently dropped.
// CHEAP, NOT EXACT, HONESTLY FLAGGED: there is no OCR/text-extraction
// library available in this Deno function (adding one would be a new,
// much heavier dependency — deliberately out of scope for a speed pass),
// so this uses each page's own single-page-PDF byte size as a proxy: a
// page far larger than the document's own median usually embeds a
// full-page raster scan (a photographed attachment) rather than the
// settlement's native, compact text/table content. This is a heuristic,
// not a guarantee — a short, image-heavy settlement recap page could
// still be misclassified — which is exactly why misclassifying an
// attachment as "content" (or vice versa) is harmless: every page still
// gets extracted, only the ORDER changes.
export type PageByteSize = { page: number; byteSize: number };

// A page's own single-page-PDF byte size must be at least this many times
// the document's median page size before it's treated as attachment-like
// — chosen conservatively (most native settlement pages vary somewhat in
// size already) so a merely slightly-larger content page is never
// wrongly deprioritized behind a genuinely smaller one.
const ATTACHMENT_SIZE_RATIO = 1.8;

export function triagePageOrder(pages: PageByteSize[]): number[] {
  if (pages.length === 0) return [];
  const sortedSizes = [...pages.map((p) => p.byteSize)].sort((a, b) => a - b);
  const median = sortedSizes[Math.floor(sortedSizes.length / 2)];
  const threshold = median * ATTACHMENT_SIZE_RATIO;
  // threshold === 0 means every page is (near-)zero bytes — nothing
  // meaningfully stands out as "larger," so leave every page in its
  // original, natural order rather than manufacturing a split.
  if (threshold <= 0) return pages.map((p) => p.page);
  const content = pages.filter((p) => p.byteSize <= threshold);
  const attachments = pages.filter((p) => p.byteSize > threshold);
  return [...content, ...attachments].map((p) => p.page);
}
