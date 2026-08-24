// REGRESSION SUITE FOR THE SETTLEMENT IMPORT CONTINUATION LOOP (owner
// decision 2026-08-03, round 5, MEASURED EVIDENCE fix; wire protocol
// renamed/extended 2026-08-24, SPEED PASS — orderIndex/pageOrder replace
// the old raw-page-number pageRangeStart/nextPageStart now that SMART
// PAGE TRIAGE means pages aren't necessarily processed in ascending page
// order). This area has broken four times in a row (parallel-chunk
// timeouts, a 3-page cap that silently dropped every deduction, a
// continuation loop that stopped after "1 of 11" pages) — these tests
// exercise callAiImport()'s ACTUAL round-trip loop against a mocked
// supabase.functions.invoke, proving the client-side behavior the owner
// explicitly asked to be locked down: every page gets attempted, a
// mid-document failure doesn't kill the run, and the loop terminates
// correctly when the server says it's done.
import type { Extraction } from '@/src/import/types';

const invokeMock = jest.fn();
jest.mock('@/src/lib/supabase', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

import { callAiImport } from '@/src/data/aiImportCall';

function settlementPage(overrides: Partial<NonNullable<Extraction['settlement']>>): Extraction {
  return { docType: 'settlement', confidence: 'high', settlement: { ...overrides } };
}

const PAGE_ORDER_11 = Array.from({ length: 11 }, (_, i) => i + 1);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('callAiImport — continuation loop (PAGES_PER_BATCH=2, orderIndex/pageOrder protocol)', () => {
  it('an 11-page document performs the expected number of round trips and completes all batches', async () => {
    // Mirrors index.ts's own batching: 2 pages per invocation, 11 pages
    // total => ceil(11/2) = 6 round trips, each one succeeding cleanly.
    // orderIndex is 0-INDEXED (a position into pageOrder), not a page
    // number — round 1 starts at 0, attempts 2, next round resumes at 2.
    const responses = [
      { data: settlementPage({ weekEnding: '2026-07-31', grossRevenue: 8235.47 }), nextOrderIndex: 2, pageOrder: PAGE_ORDER_11, rawPageExtractions: [{ page: 1, extraction: {} }, { page: 2, extraction: {} }], rawMissingPages: [] },
      { data: settlementPage({}), nextOrderIndex: 4, pageOrder: PAGE_ORDER_11, rawPageExtractions: [{ page: 1, extraction: {} }, { page: 2, extraction: {} }, { page: 3, extraction: {} }, { page: 4, extraction: {} }], rawMissingPages: [] },
      { data: settlementPage({}), nextOrderIndex: 6, pageOrder: PAGE_ORDER_11, rawPageExtractions: Array.from({ length: 6 }, (_, i) => ({ page: i + 1, extraction: {} })), rawMissingPages: [] },
      { data: settlementPage({}), nextOrderIndex: 8, pageOrder: PAGE_ORDER_11, rawPageExtractions: Array.from({ length: 8 }, (_, i) => ({ page: i + 1, extraction: {} })), rawMissingPages: [] },
      { data: settlementPage({}), nextOrderIndex: 10, pageOrder: PAGE_ORDER_11, rawPageExtractions: Array.from({ length: 10 }, (_, i) => ({ page: i + 1, extraction: {} })), rawMissingPages: [] },
      // Final round: index 10 only (11 total, batch would be 10-12 but
      // clamped to 11 pages) — no nextOrderIndex, this is the terminal response.
      { data: settlementPage({ weekEnding: '2026-07-31', grossRevenue: 8235.47, totalDeductions: 4637.15, netPay: 3598.32 }) },
    ];
    for (const r of responses) invokeMock.mockResolvedValueOnce({ data: r, error: null });

    const result = await callAiImport('base64file', 'application/pdf');

    expect(invokeMock).toHaveBeenCalledTimes(6);
    expect(result.error).toBeUndefined();
    expect(result.pagesProcessed).toBeUndefined(); // fully complete, nothing to flag
    expect(result.data?.settlement?.netPay).toBe(3598.32);

    // Verify each round-trip actually carried forward the right
    // continuation state — this is the exact mechanism that was broken
    // in round 4 (the loop stopping after one page because the
    // continuation state wasn't correctly threaded through).
    const bodies = invokeMock.mock.calls.map((c) => c[1].body);
    expect(bodies[0].orderIndex).toBeUndefined();
    expect(bodies[1].orderIndex).toBe(2);
    expect(bodies[1].pageOrder).toEqual(PAGE_ORDER_11);
    expect(bodies[1].priorPageExtractions).toHaveLength(2);
    expect(bodies[5].orderIndex).toBe(10);
    expect(bodies[5].priorPageExtractions).toHaveLength(10);
  });

  it('a page that fails even after the server retries it does NOT kill the run — the loop continues and the final result reports exactly what is missing', async () => {
    // Round 1: page 1 succeeds, page 2 times out (server already retried
    // it once internally and gave up) — the response still carries
    // nextOrderIndex, because "the loop must always attempt every page."
    const pageOrder5 = [1, 2, 3, 4, 5];
    const responses = [
      {
        data: settlementPage({ weekEnding: '2026-07-31', grossRevenue: 8235.47, deductions: [{ code: 'INS', amount: 500 }] }),
        nextOrderIndex: 2,
        pageOrder: pageOrder5,
        rawPageExtractions: [{ page: 1, extraction: { settlement: { deductions: [{ code: 'INS', amount: 500 }] } } }],
        rawMissingPages: [2],
      },
      {
        data: settlementPage({}),
        nextOrderIndex: 4,
        pageOrder: pageOrder5,
        rawPageExtractions: [{ page: 1, extraction: {} }, { page: 3, extraction: {} }, { page: 4, extraction: {} }],
        rawMissingPages: [2],
      },
      // Terminal round: index 4 (page 5, the document is only 5 pages) —
      // done, but page 2 is permanently missing, so pagesProcessed is set.
      {
        data: settlementPage({ weekEnding: '2026-07-31', grossRevenue: 8235.47, totalDeductions: 500, netPay: 400, deductions: [{ code: 'INS', amount: 500 }] }),
        pagesProcessed: { total: 5, missingPages: [2] },
      },
    ];
    for (const r of responses) invokeMock.mockResolvedValueOnce({ data: r, error: null });

    const result = await callAiImport('base64file', 'application/pdf');

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(result.error).toBeUndefined();
    // The run completed — it was NOT aborted by page 2's failure.
    expect(result.data).toBeDefined();
    expect(result.data?.settlement?.netPay).toBe(400);
    // The final result honestly reports the gap rather than silently
    // pretending the document was fully covered.
    expect(result.pagesProcessed).toEqual({ total: 5, missingPages: [2] });
  });

  it('a genuinely small document (no continuation needed) makes exactly one call', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { data: settlementPage({ weekEnding: '2026-07-24', grossRevenue: 2000, netPay: 1800 }) },
      error: null,
    });

    const result = await callAiImport('base64file', 'image/jpeg');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.pagesProcessed).toBeUndefined();
    expect(result.data?.settlement?.netPay).toBe(1800);
  });

  it('reports the onProgress callback once per intermediate round trip, not on the terminal one, and forwards partialData', async () => {
    const pageOrder3 = [1, 2, 3];
    const responses = [
      {
        data: settlementPage({ grossRevenue: 500 }),
        nextOrderIndex: 2,
        pageOrder: pageOrder3,
        rawPageExtractions: [{ page: 1, extraction: {} }, { page: 2, extraction: {} }],
        rawMissingPages: [],
        partialData: settlementPage({ weekEnding: '2026-07-31', grossRevenue: 500 }),
        progress: { through: 2, total: 3 },
      },
      { data: settlementPage({ netPay: 100 }) },
    ];
    for (const r of responses) invokeMock.mockResolvedValueOnce({ data: r, error: null });

    const progressCalls: { through: number; total: number; partialData?: Extraction }[] = [];
    await callAiImport('base64file', 'application/pdf', undefined, undefined, undefined, undefined, undefined, (p) => progressCalls.push(p));

    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0].through).toBe(2);
    expect(progressCalls[0].total).toBe(3);
    // PROGRESSIVE UI (SPEED PASS item 4) — the partial preview is
    // sanitized (dateGuard/milesGuard) the same way the terminal `data`
    // is, and forwarded through to the caller's onProgress.
    expect(progressCalls[0].partialData?.settlement?.weekEnding).toBe('2026-07-31');
    expect(progressCalls[0].partialData?.settlement?.grossRevenue).toBe(500);
  });

  it('a genuine server error on any round trip stops the loop immediately and surfaces that error', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { data: settlementPage({}), nextOrderIndex: 1, pageOrder: [1, 2, 3], rawPageExtractions: [{ page: 1, extraction: {} }], rawMissingPages: [] },
      error: null,
    });
    invokeMock.mockResolvedValueOnce({
      data: { error: { type: 'anthropic_error', message: 'Server misconfigured.' } },
      error: null,
    });

    const result = await callAiImport('base64file', 'application/pdf');

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.error?.type).toBe('anthropic_error');
    expect(result.data).toBeUndefined();
  });

  it('a legitimate orderIndex of 0 with zero pages attempted this round still counts as "continue," never mistaken for terminal', async () => {
    // Edge case the old truthiness-based `nextPageStart` check could
    // never hit (real page numbers start at 1, always truthy) — but
    // 0-indexed orderIndex CAN legitimately be 0 (e.g. an invocation that
    // hit its own budget ceiling before attempting even one page). Must
    // still be treated as "keep going," not silently terminal.
    const pageOrder3 = [1, 2, 3];
    const responses = [
      { data: settlementPage({}), nextOrderIndex: 0, pageOrder: pageOrder3, rawPageExtractions: [], rawMissingPages: [], progress: { through: 0, total: 3 } },
      { data: settlementPage({ netPay: 250 }) },
    ];
    for (const r of responses) invokeMock.mockResolvedValueOnce({ data: r, error: null });

    const result = await callAiImport('base64file', 'application/pdf');

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.data?.settlement?.netPay).toBe(250);
    const bodies = invokeMock.mock.calls.map((c) => c[1].body);
    expect(bodies[1].orderIndex).toBe(0);
  });
});
