import {
  computeChunkPageRanges,
  mergeChunkedExtractions,
  buildChunkPromptAddendum,
  mergeSequentialPageResults,
  type ChunkExtraction,
  type PageAttemptResult,
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

function ok(overrides: Partial<NonNullable<ChunkExtraction['settlement']>>): PageAttemptResult {
  return { success: true, extraction: settlementChunk(overrides) };
}
const FAIL: PageAttemptResult = { success: false };

// SEQUENTIAL PAGE-BY-PAGE MERGE (owner decision 2026-08-03, "still failing
// after chunking" fix) — replaces the old parallel N-chunk-or-nothing
// design with per-page sequential calls that stop at the first failure
// and save whatever succeeded before it, instead of losing the whole
// import on one bad page.
describe('mergeSequentialPageResults', () => {
  it('returns null when the very first page fails — nothing to save', () => {
    expect(mergeSequentialPageResults([FAIL], 5)).toBeNull();
    expect(mergeSequentialPageResults([FAIL, ok({ weekEnding: '2026-07-24' })], 5)).toBeNull();
  });

  it('passes a single successfully-processed page through, not truncated when it is the whole document', () => {
    const result = mergeSequentialPageResults([ok({ weekEnding: '2026-07-24', grossRevenue: 5.16 })], 1);
    expect(result).not.toBeNull();
    expect(result?.processedThrough).toBe(1);
    expect(result?.truncated).toBe(false);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-24');
  });

  it('marks truncated=true and forces confidence "low" when fewer pages succeeded than the document actually has', () => {
    const result = mergeSequentialPageResults([ok({ weekEnding: '2026-07-24' })], 8);
    expect(result?.processedThrough).toBe(1);
    expect(result?.truncated).toBe(true);
    expect(result?.extraction.confidence).toBe('low');
  });

  it('stops at the first failed page and merges only the pages before it (sequential, not parallel)', () => {
    const page1 = ok({ weekEnding: '2026-07-24', grossRevenue: 2000, deductions: [{ code: 'INS', amount: 100 }] });
    const page2 = ok({ deductions: [{ code: 'FUEL', amount: 200 }] });
    const page3FailsButNeverReached = FAIL;
    const page4WouldSucceedButNeverAttempted = ok({ deductions: [{ code: 'TOLL', amount: 50 }] });
    const result = mergeSequentialPageResults([page1, page2, page3FailsButNeverReached, page4WouldSucceedButNeverAttempted], 10);
    expect(result?.processedThrough).toBe(2);
    expect(result?.truncated).toBe(true);
    const deductions = result?.extraction.settlement?.deductions as { code: string; amount: number }[];
    expect(deductions.map((d) => d.code)).toEqual(['INS', 'FUEL']);
    expect(result?.extraction.settlement?.grossRevenue).toBe(2000);
  });

  it('all attempted pages succeeding and covering the whole document is not truncated', () => {
    const result = mergeSequentialPageResults([ok({ weekEnding: '2026-07-24' }), ok({}), ok({})], 3);
    expect(result?.processedThrough).toBe(3);
    expect(result?.truncated).toBe(false);
    expect(result?.extraction.confidence).toBe('low'); // still a 3-way merge, mergeChunkedExtractions' own rule
  });

  it('a real-world case: pages 1-3 of a 12-page settlement succeed, page 4+ deliberately never attempted', () => {
    const results: PageAttemptResult[] = [
      ok({ weekEnding: '2026-07-24', carrier: 'Prime Inc.', grossRevenue: 5.16, netPay: -1155.35, totalMiles: 0 }),
      ok({ deductions: [{ code: 'MEAL', amount: 66.95 }, { code: 'ADV', amount: 550 }] }),
      ok({ deductions: [{ code: 'BOND', amount: 100 }, { code: 'INS', amount: 443.56 }] }),
    ];
    const result = mergeSequentialPageResults(results, 12);
    expect(result?.processedThrough).toBe(3);
    expect(result?.truncated).toBe(true);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-24');
    expect(result?.extraction.settlement?.netPay).toBe(-1155.35);
    const total = (result?.extraction.settlement?.deductions as { amount: number }[]).reduce((s, d) => s + d.amount, 0);
    expect(total).toBeCloseTo(1160.51, 2);
  });

  // ROUND 3 FIX (owner decision 2026-08-03, "still failing" device
  // evidence): the round-2 3-page cap silently produced Net Pay $0.00 /
  // Deductions $0.00 on an 11-page settlement because the deduction line
  // items live past page 3. This proves the underlying merge itself
  // (chunking.ts is what the new client-driven continuation protocol,
  // index.ts, ultimately calls once per invocation-batch) correctly
  // accumulates EVERY page's deductions and produces a complete,
  // non-zero-net result when all 11 pages succeed — the actual server
  // orchestration (extractPageBatch/priorPageExtractions) that calls this
  // across multiple invocations is Deno-only and not unit-tested here,
  // same "no Deno runtime available" gap as the orchestration logic in
  // the prior pass.
  it('an 11-page settlement with deductions spread across many pages yields complete deductions and a non-zero net', () => {
    const header = ok({
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
      ok({ deductions: [{ code: 'INS', desc: 'Weekly Insurance', amount: 500 }] }),
      ok({ deductions: [{ code: 'ESC', desc: 'Escrow', amount: 300 }] }),
      ok({ deductions: [{ code: 'FUEL', desc: 'Fuel Advance', amount: 1200 }] }),
      ok({ deductions: [{ code: 'ELD', desc: 'ELD Fee', amount: 45 }] }),
      ok({ deductions: [{ code: 'TOLL', desc: 'Tolls', amount: 187.15 }] }),
      ok({ deductions: [{ code: 'MAINT', desc: 'Maintenance Reserve', amount: 900 }] }),
      ok({ deductions: [{ code: 'ADV', desc: 'Advance Repayment', amount: 1200 }] }),
      ok({ deductions: [{ code: 'MISC', desc: 'Misc Fee', amount: 305 }] }),
    ];
    // Pages 10-11: operating statement / recap, no new deduction lines.
    const tailPages = [ok({}), ok({})];
    const allPages = [header, ...deductionPages, ...tailPages];
    expect(allPages).toHaveLength(11);

    const result = mergeSequentialPageResults(allPages, 11);
    expect(result?.processedThrough).toBe(11);
    expect(result?.truncated).toBe(false);
    expect(result?.extraction.settlement?.weekEnding).toBe('2026-07-31');
    expect(result?.extraction.settlement?.netPay).toBe(3598.32);
    expect(result?.extraction.settlement?.netPay).not.toBe(0);
    const deductions = result?.extraction.settlement?.deductions as { amount: number }[];
    expect(deductions).toHaveLength(8);
    const total = deductions.reduce((s, d) => s + d.amount, 0);
    expect(total).toBeCloseTo(4637.15, 2);
    expect(total).toBe(result?.extraction.settlement?.totalDeductions);
  });
});
