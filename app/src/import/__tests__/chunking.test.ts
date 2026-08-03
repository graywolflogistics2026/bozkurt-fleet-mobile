import {
  computeChunkPageRanges,
  mergeChunkedExtractions,
  buildChunkPromptAddendum,
  mergeAllPages,
  type ChunkExtraction,
  type PageOutcome,
} from '../../../../supabase/functions/ai-import/chunking';

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
});
