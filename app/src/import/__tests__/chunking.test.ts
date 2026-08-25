import {
  computeChunkPageRanges,
  mergeChunkedExtractions,
  buildChunkPromptAddendum,
  mergeAllPages,
  runWithConcurrencyLimit,
  triagePageOrder,
  type ChunkExtraction,
  type PageByteSize,
  type PageOutcome,
} from '../../../../supabase/functions/ai-import/chunking';
import { sanitizeExtractionMiles } from '@/src/import/milesGuard';
import type { Extraction } from '@/src/import/types';

// PDF CHUNKING FOR MULTI-PAGE SETTLEMENTS (owner decision 2026-08-02,
// device evidence: real 8-page Prime settlements consistently timed out).
// This test imports the Deno Edge Function's pure chunking/merge module
// directly via a relative path — that module is deliberately
// dependency-free (no Deno globals, no external imports) specifically so
// it can be unit-tested here without a Deno runtime, same "one canonical
// implementation, not two copies to keep in sync" reasoning documented
// in chunking.ts's own header comment.
describe('computeChunkPageRanges', () => {
  it('splits an 8-page document into 3-page chunks, covering every page exactly once', () => {
    expect(computeChunkPageRanges(8, 3)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: 8 },
    ]);
  });

  it('produces one chunk for a document at or under the chunk size', () => {
    expect(computeChunkPageRanges(3, 3)).toEqual([{ start: 1, end: 3 }]);
    expect(computeChunkPageRanges(1, 3)).toEqual([{ start: 1, end: 1 }]);
  });

  it('splits into single-page chunks when pagesPerChunk is 1 (the timeout-fallback case)', () => {
    expect(computeChunkPageRanges(3, 1)).toEqual([{ start: 1, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 3 }]);
  });

  it('returns no ranges for a non-positive page count', () => {
    expect(computeChunkPageRanges(0, 3)).toEqual([]);
  });
});

describe('buildChunkPromptAddendum', () => {
  it('names the exact page range and total page count', () => {
    const text = buildChunkPromptAddendum({ start: 4, end: 6 }, 8);
    expect(text).toContain('pages 4-6');
    expect(text).toContain('8-page');
  });
});

function settlementChunk(overrides: Partial<NonNullable<ChunkExtraction['settlement']>>): ChunkExtraction {
  return {
    docType: 'settlement',
    confidence: 'high',
    settlement: { ...overrides },
  };
}

describe('mergeChunkedExtractions', () => {
  it('passes a single chunk through unchanged', () => {
    const chunk = settlementChunk({ weekEnding: '2026-07-24', grossRevenue: 2000 });
    expect(mergeChunkedExtractions([chunk])).toBe(chunk);
  });

  it('takes header scalars from chunk[0] (the page-1 chunk), even when the value is a legitimate 0', () => {
    // Chunk 0 = pages 1-3 (has the header, including a genuine 0-mile
    // home week); chunk 1 = pages 4-6 (deductions page, no header data,
    // per the addendum's instruction its header fields stay at default).
    const chunk0 = settlementChunk({
      weekEnding: '2026-07-24',
      carrier: 'Prime Inc.',
      grossRevenue: 5.16,
      netPay: -1155.35,
      totalMiles: 0, // genuine home week — must NOT be overridden
    });
    const chunk1 = settlementChunk({ deductions: [{ code: 'INS', amount: 100 }] });
    const merged = mergeChunkedExtractions([chunk0, chunk1]);
    expect(merged.settlement?.weekEnding).toBe('2026-07-24');
    expect(merged.settlement?.carrier).toBe('Prime Inc.');
    expect(merged.settlement?.grossRevenue).toBe(5.16);
    expect(merged.settlement?.totalMiles).toBe(0);
    expect(merged.settlement?.netPay).toBe(-1155.35);
  });

  it('falls back to a later chunk for a header STRING field chunk[0] left empty', () => {
    const chunk0 = settlementChunk({ weekEnding: '', grossRevenue: 0 });
    const chunk1 = settlementChunk({ weekEnding: '2026-07-24' });
    const merged = mergeChunkedExtractions([chunk0, chunk1]);
    expect(merged.settlement?.weekEnding).toBe('2026-07-24');
  });

  it('concatenates line-item arrays across every chunk, in page order, without deduping', () => {
    const chunk0 = settlementChunk({ loads: [{ order: 'L1' }], tractorFuel: [{ amount: 300 }] });
    const chunk1 = settlementChunk({ loads: [{ order: 'L2' }], deductions: [{ code: 'INS', amount: 150 }] });
    const chunk2 = settlementChunk({ deductions: [{ code: 'ESC', amount: 100 }], maintenance: [{ desc: 'Oil change' }] });
    const merged = mergeChunkedExtractions([chunk0, chunk1, chunk2]);
    expect(merged.settlement?.loads).toEqual([{ order: 'L1' }, { order: 'L2' }]);
    expect(merged.settlement?.tractorFuel).toEqual([{ amount: 300 }]);
    expect(merged.settlement?.deductions).toEqual([
      { code: 'INS', amount: 150 },
      { code: 'ESC', amount: 100 },
    ]);
    expect(merged.settlement?.maintenance).toEqual([{ desc: 'Oil change' }]);
  });

  it('scans every chunk (not just chunk[0]) for the tolls subtotal, since it may be on any page', () => {
    const chunk0 = settlementChunk({});
    const chunk1 = settlementChunk({ tolls: { ezpass: { total: 45.5, items: [{ amount: 45.5 }] } } });
    const merged = mergeChunkedExtractions([chunk0, chunk1]);
    expect(merged.settlement?.tolls?.ezpass?.total).toBe(45.5);
    expect(merged.settlement?.tolls?.ezpass?.items).toEqual([{ amount: 45.5 }]);
  });

  it('always marks a multi-chunk merge confidence "low", even when every chunk reported "high"', () => {
    const chunk0 = settlementChunk({ weekEnding: '2026-07-24' });
    const chunk1 = settlementChunk({ deductions: [{ amount: 50 }] });
    const merged = mergeChunkedExtractions([{ ...chunk0, confidence: 'high' }, { ...chunk1, confidence: 'high' }]);
    expect(merged.confidence).toBe('low');
  });

  it('concatenates each chunk\'s own partial summary rather than only keeping chunk[0]\'s', () => {
    const chunk0: ChunkExtraction = { docType: 'settlement', summary: 'Header and revenue.', settlement: {} };
    const chunk1: ChunkExtraction = { docType: 'settlement', summary: 'Deductions and tolls.', settlement: {} };
    const merged = mergeChunkedExtractions([chunk0, chunk1]);
    expect(merged.summary).toBe('Header and revenue. Deductions and tolls.');
  });

  it('does not deep-merge the settlement sub-object for a non-settlement docType — chunk[0] wins verbatim', () => {
    const chunk0: ChunkExtraction = { docType: 'fuel', vendor: 'Pilot' };
    const chunk1: ChunkExtraction = { docType: 'fuel', vendor: 'Loves' };
    const merged = mergeChunkedExtractions([chunk0, chunk1]);
    expect(merged.docType).toBe('fuel');
    expect(merged.settlement).toBeUndefined();
  });

  it('a genuine real-world case: 3 chunks combining to the exact real-statement numbers', () => {
    // Mirrors the negative-settlement regression fixture: W/E 2026-07-24,
    // 0 miles, $5.16 revenue, deductions totaling $1,160.51 split across
    // pages, net -$1,155.35 only on the header page.
    const headerChunk = settlementChunk({
      weekEnding: '2026-07-24',
      grossRevenue: 5.16,
      netPay: -1155.35,
      totalMiles: 0,
      loads: [],
    });
    const deductionsChunk1 = settlementChunk({
      deductions: [
        { code: 'MEAL', desc: 'Pilot Travel Center Restaurant', amount: 66.95 },
        { code: 'ADV', desc: 'Advance Repayment', amount: 550.0 },
      ],
    });
    const deductionsChunk2 = settlementChunk({
      deductions: [
        { code: 'BOND', desc: 'PERFORMNCE BOND', amount: 100.0 },
        { code: 'INS', desc: 'Weekly Insurance', amount: 443.56 },
      ],
    });
    const merged = mergeChunkedExtractions([headerChunk, deductionsChunk1, deductionsChunk2]);
    expect(merged.settlement?.weekEnding).toBe('2026-07-24');
    expect(merged.settlement?.netPay).toBe(-1155.35);
    expect(merged.settlement?.totalMiles).toBe(0);
    const total = (merged.settlement?.deductions as { amount: number }[]).reduce((sum, d) => sum + d.amount, 0);
    expect(total).toBeCloseTo(1160.51, 2);
  });

  // MILES READ BUT NOT USED (owner decision 2026-08-24) — a real, nonzero
  // totalMiles on the header page survives the merge completely unchanged
  // (the ordinary, expected case — the "0 is legitimate" chunk[0] rule
  // only matters when chunk[0] genuinely lacks the field).
  it('a real nonzero totalMiles on the header chunk survives the merge unchanged', () => {
    const headerChunk = settlementChunk({ weekEnding: '2026-07-24', grossRevenue: 8500, totalMiles: 10146 });
    const deductionsChunk = settlementChunk({ deductions: [{ code: 'INS', amount: 100 }] });
    const merged = mergeChunkedExtractions([headerChunk, deductionsChunk]);
    expect(merged.settlement?.totalMiles).toBe(10146);
  });

  // END TO END: merge + the milesGuard client-side safety net together.
  // mergeChunkedExtractions() itself still takes chunk[0]'s totalMiles
  // unconditionally (by design — see this suite's own "even when the
  // value is a legitimate 0" test above) — so if the page that actually
  // prints the mileage recap isn't chunk[0] (e.g. it's a later page), the
  // merge alone would lose it. sanitizeExtractionMiles() (src/import/
  // milesGuard.ts), applied to whatever the merge produces, is the second
  // line of defense: loads ARE concatenated across every chunk correctly
  // regardless of which chunk had the header, so the real total is
  // recoverable from them even when the merge's own scalar-priority rule
  // can't find it.
  it('survives the guard AND the multi-page merge together, even when the header chunk itself lacks totalMiles', () => {
    // Chunk 0 = pages 1-2 (header + loads, but the AI genuinely didn't
    // see a printed mileage summary on THESE pages — left at the schema
    // default per the chunk prompt's own instruction).
    const headerChunk = settlementChunk({
      weekEnding: '2026-07-24',
      grossRevenue: 8500,
      totalMiles: 0,
      loads: [
        { order: 'L1', loadedMiles: 6200, emptyMiles: 800 },
        { order: 'L2', loadedMiles: 2600, emptyMiles: 546 },
      ],
    });
    // Chunk 1 = pages 3-6 (deductions section — no header data of its own).
    const deductionsChunk = settlementChunk({ deductions: [{ code: 'INS', amount: 100 }] });

    const merged = mergeChunkedExtractions([headerChunk, deductionsChunk]);
    // The merge alone still reflects chunk[0]'s (wrong) 0 — expected,
    // documented behavior, not itself the fix.
    expect(merged.settlement?.totalMiles).toBe(0);
    expect(merged.settlement?.loads).toHaveLength(2);

    // The guard, applied to the merge's own output, recovers the real
    // total from the loads it correctly preserved. Cast: in production
    // this exact boundary crossing happens over the wire (the server's
    // own local ChunkExtraction type becomes whatever JSON the client
    // receives and treats as Extraction) — there's no runtime validation
    // step between them, so a cast here mirrors reality rather than
    // papering over a real type mismatch.
    const sanitized = sanitizeExtractionMiles(merged as unknown as Extraction);
    expect(sanitized.settlement?.totalMiles).toBe(10146);
    expect(sanitized.confidence).toBe('low');
  });
});

function pageOk(page: number, overrides: Partial<NonNullable<ChunkExtraction['settlement']>>): PageOutcome {
  return { page, extraction: settlementChunk(overrides) };
}
function pageMissing(page: number): PageOutcome {
  return { page, missing: true };
}

// GAP-TOLERANT PAGE MERGE (owner decision 2026-08-03, round 4 — MEASURED
// EVIDENCE fix: round 3's mergeSequentialPageResults STOPPED THE WHOLE
// DOCUMENT at the first failed page, which is exactly why a real 11-page
// settlement's banner read "Imported pages 1-1 of 11" after page 2 hit
// the old 40s per-page cap. mergeAllPages replaces that with "a failed
// page (even after index.ts's one non-fatal retry) is recorded as
// MISSING and every remaining page is still attempted" — the loop must
// always attempt every page, per the owner's explicit instruction.
describe('mergeAllPages', () => {
  it('returns null when every page is missing — nothing to save', () => {
    expect(mergeAllPages([pageMissing(1)])).toBeNull();
    expect(mergeAllPages([pageMissing(1), pageMissing(2)])).toBeNull();
  });

  it('passes a single successfully-processed page through with no missing pages', () => {
    const result = mergeAllPages([pageOk(1, { weekEnding: '2026-07-24', grossRevenue: 5.16 })]);
    expect(result).not.toBeNull();
    expect(result?.coveredPages).toEqual([1]);
    expect(result?.missingPages).toEqual([]);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-24');
  });

  it('forces confidence "low" whenever ANY page is missing, even just one out of many', () => {
    const result = mergeAllPages([pageOk(1, { weekEnding: '2026-07-24' }), pageMissing(2), pageOk(3, {})]);
    expect(result?.missingPages).toEqual([2]);
    expect(result?.extraction.confidence).toBe('low');
  });

  it('a middle page failing does NOT stop later pages from being merged (the exact "1 of 11" bug this fixes)', () => {
    const page1 = pageOk(1, { weekEnding: '2026-07-24', grossRevenue: 2000, deductions: [{ code: 'INS', amount: 100 }] });
    const page2Missing = pageMissing(2); // hit the per-page timeout even after retry
    const page3 = pageOk(3, { deductions: [{ code: 'FUEL', amount: 200 }] });
    const page4 = pageOk(4, { deductions: [{ code: 'TOLL', amount: 50 }] });
    const result = mergeAllPages([page1, page2Missing, page3, page4]);
    expect(result?.coveredPages).toEqual([1, 3, 4]);
    expect(result?.missingPages).toEqual([2]);
    const deductions = result?.extraction.settlement?.deductions as { code: string; amount: number }[];
    // Page 2's own (missing) deductions are absent, but page 1's own AND
    // pages 3 AND 4 — which come AFTER the failure — are all still
    // present. Round 3 would have stopped at page 2 and never seen pages
    // 3/4 at all.
    expect(deductions.map((d) => d.code)).toEqual(['INS', 'FUEL', 'TOLL']);
    expect(result?.extraction.settlement?.grossRevenue).toBe(2000);
  });

  it('every page succeeding has zero missing pages and is not forced low-confidence by that alone', () => {
    const result = mergeAllPages([pageOk(1, { weekEnding: '2026-07-24' }), pageOk(2, {}), pageOk(3, {})]);
    expect(result?.missingPages).toEqual([]);
    expect(result?.extraction.confidence).toBe('low'); // still forced low by mergeChunkedExtractions' own 2+-merge rule
  });

  it('a real-world case: pages 1-3 of a 12-page settlement succeed, page 4+ never attempted this invocation', () => {
    const results: PageOutcome[] = [
      pageOk(1, { weekEnding: '2026-07-24', carrier: 'Prime Inc.', grossRevenue: 5.16, netPay: -1155.35, totalMiles: 0 }),
      pageOk(2, { deductions: [{ code: 'MEAL', amount: 66.95 }, { code: 'ADV', amount: 550 }] }),
      pageOk(3, { deductions: [{ code: 'BOND', amount: 100 }, { code: 'INS', amount: 443.56 }] }),
    ];
    const result = mergeAllPages(results);
    expect(result?.coveredPages).toEqual([1, 2, 3]);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-24');
    expect(result?.extraction.settlement?.netPay).toBe(-1155.35);
    const total = (result?.extraction.settlement?.deductions as { amount: number }[]).reduce((s, d) => s + d.amount, 0);
    expect(total).toBeCloseTo(1160.51, 2);
  });

  // MEASURED EVIDENCE FIX (owner decision 2026-08-03): proves the merge
  // itself correctly accumulates every page's deductions across an
  // 11-page settlement into a complete, non-zero-net result when every
  // page succeeds. The actual per-page network calls/retry-then-skip
  // logic and the client's round-trip loop live in index.ts/
  // aiImportCall.ts and are covered by aiImportCall's own mocked-network
  // tests (see aiImportCall.test.ts) — this proves the pure merge math.
  it('an 11-page settlement with deductions spread across many pages yields complete deductions and a non-zero net', () => {
    const header = pageOk(1, {
      weekEnding: '2026-07-31',
      carrier: 'Prime Inc.',
      grossRevenue: 8235.47,
      totalDeductions: 4637.15,
      netPay: 3598.32,
      totalMiles: 3265,
      loads: [{ order: 'L1' }, { order: 'L2' }, { order: 'L3' }],
    });
    // Deduction line items genuinely spread across pages 2-9, matching
    // the reported document shape (revenue/header early, full deduction
    // breakdown much later on a long statement).
    const deductionPages = [
      pageOk(2, { deductions: [{ code: 'INS', desc: 'Weekly Insurance', amount: 500 }] }),
      pageOk(3, { deductions: [{ code: 'ESC', desc: 'Escrow', amount: 300 }] }),
      pageOk(4, { deductions: [{ code: 'FUEL', desc: 'Fuel Advance', amount: 1200 }] }),
      pageOk(5, { deductions: [{ code: 'ELD', desc: 'ELD Fee', amount: 45 }] }),
      pageOk(6, { deductions: [{ code: 'TOLL', desc: 'Tolls', amount: 187.15 }] }),
      pageOk(7, { deductions: [{ code: 'MAINT', desc: 'Maintenance Reserve', amount: 900 }] }),
      pageOk(8, { deductions: [{ code: 'ADV', desc: 'Advance Repayment', amount: 1200 }] }),
      pageOk(9, { deductions: [{ code: 'MISC', desc: 'Misc Fee', amount: 305 }] }),
    ];
    // Pages 10-11: operating statement / recap, no new deduction lines.
    const tailPages = [pageOk(10, {}), pageOk(11, {})];
    const allPages = [header, ...deductionPages, ...tailPages];
    expect(allPages).toHaveLength(11);

    const result = mergeAllPages(allPages);
    expect(result?.coveredPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result?.missingPages).toEqual([]);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-31');
    expect(result?.extraction.settlement?.netPay).toBe(3598.32);
    expect(result?.extraction.settlement?.netPay).not.toBe(0);
    const deductions = result?.extraction.settlement?.deductions as { amount: number }[];
    expect(deductions).toHaveLength(8);
    const total = deductions.reduce((s, d) => s + d.amount, 0);
    expect(total).toBeCloseTo(4637.15, 2);
    expect(total).toBe(result?.extraction.settlement?.totalDeductions);
  });

  it('a retried-then-skipped page (simulating index.ts giving up after one retry) still yields the rest of the document', () => {
    // Mirrors the measured-evidence scenario: page 2 timed out on the
    // first attempt, timed out AGAIN on the one non-fatal retry, so
    // index.ts records it as missing — but pages 3-11 still all succeed.
    const header = pageOk(1, { weekEnding: '2026-07-31', grossRevenue: 8235.47, totalDeductions: 4137.15, netPay: 4098.32 });
    const page2RetriedAndStillFailed = pageMissing(2);
    const rest = [3, 4, 5, 6, 7, 8, 9, 10, 11].map((p) => pageOk(p, p <= 9 ? { deductions: [{ code: `D${p}`, amount: 500 }] } : {}));
    const result = mergeAllPages([header, page2RetriedAndStillFailed, ...rest]);
    expect(result?.coveredPages).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result?.missingPages).toEqual([2]);
    expect(result?.extraction.confidence).toBe('low');
    // 9 deduction pages (3-9 have one $500 line each = 7 lines) captured
    // despite page 2 being permanently lost.
    const deductions = result?.extraction.settlement?.deductions as unknown[];
    expect(deductions).toHaveLength(7);
  });

  // SPEED PASS (owner decision 2026-08-24) — CRITICAL CORRECTNESS FIX:
  // both SMART PAGE TRIAGE (financially-meaningful pages processed first,
  // not necessarily page 1's own physical position) and CONTROLLED
  // CONCURRENCY (pages can complete out of order) mean `outcomes` can no
  // longer be assumed to arrive in ascending page order the way it always
  // used to when processing was strictly sequential. mergeAllPages() must
  // sort by PAGE NUMBER before treating the first entry as "primary" for
  // header/summary scalars (mergeChunkedExtractions' own convention) —
  // this proves it does, regardless of what order outcomes are handed in.
  it('OUT-OF-ORDER OUTCOMES: merge is still correct when pages complete/arrive out of page order (triage + concurrency)', () => {
    const page1 = pageOk(1, { weekEnding: '2026-07-31', carrier: 'Prime Inc.', grossRevenue: 8235.47, netPay: 3598.32, deductions: [{ code: 'A', amount: 100 }] });
    const page2 = pageOk(2, { deductions: [{ code: 'B', amount: 200 }] });
    const page3 = pageOk(3, { deductions: [{ code: 'C', amount: 300 }] });
    // Pages handed to mergeAllPages in a scrambled order (page 3's own
    // extraction arrives FIRST in the array, page 1 LAST) — simulating
    // triage having processed page 3 before page 1, or page 3's own
    // concurrent request simply resolving first.
    const scrambled = [page3, page1, page2];
    const inOrder = [page1, page2, page3];

    const scrambledResult = mergeAllPages(scrambled);
    const inOrderResult = mergeAllPages(inOrder);

    // Header/summary scalars must come from page 1 (the lowest-numbered
    // succeeded page) regardless of array position — a bug here would
    // have silently produced a merge with NO weekEnding/grossRevenue/
    // netPay at all, since pages 2 and 3 never carry those fields.
    expect(scrambledResult?.extraction.settlement?.weekEnding).toBe('2026-07-31');
    expect(scrambledResult?.extraction.settlement?.grossRevenue).toBe(8235.47);
    expect(scrambledResult?.extraction.settlement?.netPay).toBe(3598.32);
    // coveredPages is reported in ascending page order regardless of
    // input order too.
    expect(scrambledResult?.coveredPages).toEqual([1, 2, 3]);
    // Line items concatenate in ascending page order either way, so a
    // scrambled input produces the IDENTICAL final merge as the
    // naturally-ordered input — completeness never depends on arrival
    // order.
    expect(scrambledResult).toEqual(inOrderResult);
    const codes = (scrambledResult?.extraction.settlement?.deductions as { code: string }[]).map((d) => d.code);
    expect(codes).toEqual(['A', 'B', 'C']);
  });

  it('OUT-OF-ORDER OUTCOMES: still gap-tolerant and low-confidence-flagged when a middle page is missing, regardless of arrival order', () => {
    const page1 = pageOk(1, { weekEnding: '2026-07-31', grossRevenue: 100 });
    const page3 = pageOk(3, { deductions: [{ code: 'C', amount: 50 }] });
    const page2Missing = pageMissing(2);
    // Missing-page entry arrives FIRST, page 3 arrives BEFORE page 1.
    const result = mergeAllPages([page2Missing, page3, page1]);
    expect(result?.coveredPages).toEqual([1, 3]);
    expect(result?.missingPages).toEqual([2]);
    expect(result?.extraction.confidence).toBe('low');
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-31');
  });
});

// CONTROLLED CONCURRENCY (owner decision 2026-08-24, SPEED PASS item 1) —
// see chunking.ts's own header comment on runWithConcurrencyLimit for the
// full "not all at once, not one at a time" reasoning. Tests use a
// manually-controlled deferred-promise pattern (rather than real timers)
// so completion order is fully deterministic and assertable.
describe('runWithConcurrencyLimit', () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
  function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('never runs more than `limit` workers at once', async () => {
    // A real (tiny) delay per worker rather than manually-staggered gates
    // — this only needs to prove the AGGREGATE bound (concurrency never
    // exceeded `limit` at any point across the whole run), not any
    // specific microtask interleaving, so a small real timer is the more
    // robust choice here than hand-counting microtask ticks.
    let current = 0;
    let maxObserved = 0;
    const results = await runWithConcurrencyLimit([0, 1, 2, 3, 4], 2, async (i) => {
      current++;
      maxObserved = Math.max(maxObserved, current);
      await new Promise((resolve) => setTimeout(resolve, 5));
      current--;
      return i * 10;
    });
    expect(maxObserved).toBeLessThanOrEqual(2);
    expect(maxObserved).toBeGreaterThan(0); // sanity: workers actually ran
    expect(results).toEqual([0, 10, 20, 30, 40]);
  });

  it('results preserve input order regardless of completion order', async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const resultsPromise = runWithConcurrencyLimit(['a', 'b', 'c'], 3, async (item, i) => {
      await gates[i].promise;
      return item.toUpperCase();
    });
    // Resolve in REVERSE order — item 'c' finishes first, 'a' finishes last.
    gates[2].resolve();
    gates[1].resolve();
    gates[0].resolve();
    const results = await resultsPromise;
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('an empty item list resolves immediately to an empty array', async () => {
    const worker = jest.fn(async () => 'never called');
    const results = await runWithConcurrencyLimit([], 2, worker);
    expect(results).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('a limit larger than the item count behaves the same as no limit at all', async () => {
    const order: number[] = [];
    const results = await runWithConcurrencyLimit([1, 2, 3], 10, async (n) => {
      order.push(n);
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6]);
    expect(order).toHaveLength(3);
  });

  it('limit=1 runs strictly sequentially, never starting item N+1 before item N resolves', async () => {
    const gate = deferred<void>();
    const startedOrder: number[] = [];
    const resultsPromise = runWithConcurrencyLimit([1, 2], 1, async (n) => {
      startedOrder.push(n);
      if (n === 1) await gate.promise;
      return n;
    });
    await Promise.resolve();
    await Promise.resolve();
    // Item 2 must NOT have started yet — item 1 is still blocked on `gate`.
    expect(startedOrder).toEqual([1]);
    gate.resolve();
    await resultsPromise;
    expect(startedOrder).toEqual([1, 2]);
  });
});

// SMART PAGE TRIAGE (owner decision 2026-08-24, SPEED PASS item 2) — see
// chunking.ts's own header comment for the full "cheap, not exact,
// honestly flagged" reasoning (byte-size-relative-to-median as a proxy
// for "looks like an embedded scan," since there's no OCR/text-extraction
// library available in this Deno function).
describe('triagePageOrder', () => {
  function sizes(...byteSize: number[]): PageByteSize[] {
    return byteSize.map((byteSize, i) => ({ page: i + 1, byteSize }));
  }

  it('returns an empty order for an empty document', () => {
    expect(triagePageOrder([])).toEqual([]);
  });

  it('leaves natural page order alone when every page is a similar size', () => {
    expect(triagePageOrder(sizes(1000, 1050, 980, 1020))).toEqual([1, 2, 3, 4]);
  });

  it('moves a single much-larger (attachment-looking) page to the end, preserving relative order otherwise', () => {
    // Page 2 is ~6x the median — a photographed attachment among native
    // text pages.
    expect(triagePageOrder(sizes(1000, 6000, 1100, 950))).toEqual([1, 3, 4, 2]);
  });

  it('moves MULTIPLE attachment-looking pages to the end, each keeping its own relative order', () => {
    // Pages 2 and 4 are both large; pages 1, 3, 5 are small.
    expect(triagePageOrder(sizes(900, 5000, 950, 5200, 1000))).toEqual([1, 3, 5, 2, 4]);
  });

  it('never drops a page — every input page number appears exactly once in the output', () => {
    const input = sizes(500, 8000, 600, 550, 7000, 500);
    const order = triagePageOrder(input);
    expect(order.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(order).size).toBe(order.length);
  });

  it('leaves order alone when every page is exactly zero bytes (degenerate input, no meaningful "larger")', () => {
    expect(triagePageOrder(sizes(0, 0, 0))).toEqual([1, 2, 3]);
  });

  it('a single page is trivially its own order', () => {
    expect(triagePageOrder(sizes(12345))).toEqual([1]);
  });
});
