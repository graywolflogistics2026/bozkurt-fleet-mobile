// RESUMABLE PAGE-BY-PAGE IMPORT JOBS (owner decision 2026-10-13, 17-page
// stall redesign A-H + amendments 1-6 + "scale to any page count").
// supabase/functions/ai-import/jobEngine.ts run in a simulated 150 s
// Free-plan world (./jobSimulation.ts). Durations are estimates; the rules
// tested (time limits, resume, leases, partial save, privacy) are exact.
import {
  FREE_PLAN_WALL_CLOCK_MS,
  MAX_ATTACHMENT_READS,
  buildPageMap,
  callTimeoutNow,
  checkImportLimits,
  limitsFor,
  physicalPagePlan,
  primePagePlan,
  resetFailedPages,
  statementBoundary,
  type PageKind,
} from '../../../../supabase/functions/ai-import/jobEngine';
import { mergeAllPages, type ChunkExtraction } from '../../../../supabase/functions/ai-import/chunking';
import { scrubBankDigits as serverScrub, BANK_DIGITS_RE as SERVER_RE } from '../../../../supabase/functions/ai-import/bankDigits';
import { scrubBankDigits as appScrub, BANK_DIGITS_RE as APP_RE } from '@/src/import/bankDigits';
import {
  buildPrimeStatementCheck,
  buildSettlementStatement,
  isStatementBacked,
  lineItemsIncomplete,
  settlementVerification,
} from '@/src/import/settlementStatement';
import type { Extraction } from '@/src/import/types';
import { attachmentMix, primeDoc, simulateImport, TEXT_PAGE_BYTES, unknownCarrierDoc, type DocSpec } from './jobSimulation';

const limits = limitsFor(FREE_PLAN_WALL_CLOCK_MS);

// ---------------------------------------------------------------------
// The golden Prime week (GRWLLG-OY-PrimeInc6, W/E 2026-08-21) as a 6-page
// settlement + operating statement printed across pages 5 and 6.
// ---------------------------------------------------------------------
const LINES_PAGE_5 = [
  ['revenue', 'REVENUE FROM PRIME INC.', 3345.12],
  ['revenue', 'EXTRA PAY', 175],
  ['revenue', 'FUEL SURCG BILL', 1210.04],
  ['revenue', 'REEF FUEL SURCG', 20.82],
  ['revenue', 'SAFETY INC', 16.35],
  ['revenue', 'SERVICE INC', 16.35],
  ['revenue', 'TOLL 1099 PAY', 0.07],
  ['fuel_oil_tax', 'TRACTOR FUEL', -1997.82],
  ['fuel_oil_tax', 'TRACTOR FUEL DISCOUNT', 184.85],
  ['fuel_oil_tax', 'TRACTOR DEF', -95.11],
  ['fuel_oil_tax', 'REEFER FUEL', -46.23],
  ['fuel_oil_tax', 'REEFER FUEL DISCOUNT', 17.92],
  ['fuel_oil_tax', 'DEF DISCOUNT', 29.15],
  ['fuel_oil_tax', 'STATE FUEL TAX', -46.54],
  ['misc', 'TOLLS', -0.25],
  ['misc', 'ADVANCES', -550],
  ['misc', 'WEIGHT TICKETS', -15.25],
  ['misc', 'QUALCOMM COST', -18.34],
  ['misc', 'WIRE CHARGE', -2],
  ['misc', 'TRIP XPRESS CHG', -5],
  ['misc', 'PERSONAL PYMNT RCV', 1],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));
const LINES_PAGE_6 = [
  ['fixed', 'PHYSICAL DAMAGE INSURANCE', -30.43],
  ['fixed', 'BT/DH INSURANCE', -5.98],
  ['fixed', 'LICENSE AND PERMITS', -100],
  ['fixed', 'STATEMENT PREPARATION', -89.37],
  ['fixed', 'OPERATOR OCCUP ACC', -29.99],
  ['other', 'ACCRUAL PERFORMANCE BOND', -100],
  ['other', 'INTEREST INCOME FROM DEPOST', 0.37],
].map(([section, label, amount]) => ({ section: section as string, label: label as string, amount: amount as number }));

// What one page returns: every field it does not print at its default.
function page(settlement: Record<string, unknown>, summary = ''): ChunkExtraction {
  return {
    docType: 'settlement',
    summary,
    confidence: 'high',
    settlement: {
      weekEnding: '',
      carrier: '',
      unit: '',
      grossRevenue: 0,
      netPay: 0,
      totalDeductions: 0,
      totalMiles: 0,
      reimbursements: 0,
      deductions: [],
      revenueItems: [],
      reimbursementItems: [],
      operating: {
        lines: [],
        weekMiles: 0,
        weekTotalRevenue: 0,
        weekTotalFuelOilTax: 0,
        weekTotalMiscellaneous: 0,
        weekTotalVariableCosts: 0,
        weekTotalFixedCost: 0,
        weekTotalOtherIncomeAndExpense: 0,
        weekTotalOperatingExpenses: 0,
        weekTotalStatement: 0,
        settlementToOperator: 0,
        directDeposit: 0,
      },
      ...settlement,
    },
  };
}

const PAGE_1 = page({ weekEnding: '2026-08-21', carrier: 'Prime Inc.', unit: '283940', grossRevenue: 4783.75, netPay: 1884.36, totalMiles: 2327, deductions: [{ code: 'QC', desc: 'QUALCOMM', amount: 18.34 }] });
const PAGE_2 = page({ deductions: [{ code: 'WT', desc: 'WEIGHT TICKET', amount: 15.25 }] });
const PAGE_3 = page({ deductions: [{ code: 'WC', desc: 'WIRE CHARGE', amount: 2 }] });
const PAGE_4 = page({ deductions: [{ code: 'TX', desc: 'TRIP XPRESS', amount: 5 }] });
const PAGE_5 = page({
  operating: {
    lines: LINES_PAGE_5,
    weekTotalRevenue: 4783.75,
    weekTotalFuelOilTax: -1953.78,
    weekTotalMiscellaneous: -589.84,
    weekTotalVariableCosts: -2543.62,
  },
});
const PAGE_6 = page(
  {
    operating: {
      lines: LINES_PAGE_6,
      weekMiles: 2327,
      weekTotalFixedCost: -255.77,
      weekTotalOtherIncomeAndExpense: -99.63,
      weekTotalOperatingExpenses: -2899.02,
      weekTotalStatement: 1884.73,
      settlementToOperator: 1884.73,
      directDeposit: 1884.73,
    },
  },
  'DIRECT DEPOSIT TO BANK ROUTING #111000025 ACCT # 4455-6677-88 for 1,884.73'
);
const GOLDEN_PAGES = [PAGE_1, PAGE_2, PAGE_3, PAGE_4, PAGE_5, PAGE_6];

function goldenDoc(attachments: PageKind[], overrides: Partial<Record<number, Partial<DocSpec['pages'][number]>>> = {}): DocSpec {
  const doc = primeDoc(4, attachments);
  doc.pages = doc.pages.map((p, i) => ({ ...p, extraction: GOLDEN_PAGES[i] ?? undefined, ...(overrides[i + 1] ?? {}) }));
  return doc;
}

// The 17-page fixture: 6 content pages + 11 attachments.
const ELEVEN_ATTACHMENTS = attachmentMix(11);

function asExtraction(v: unknown): Extraction {
  return v as Extraction;
}

describe('limits come from one documented constant (Free plan wall clock 150 s)', () => {
  it('a call may start only if elapsed + timeout + 15 s <= 140 s; nothing starts after 130 s', () => {
    expect(limits).toEqual({ wallClockMs: 150_000, callEndLimitMs: 140_000, startMarginMs: 15_000, exitByMs: 130_000 });
    expect(callTimeoutNow(limits, 0, 100_000, 100_000)).toBe(100_000);
    expect(callTimeoutNow(limits, 25_000, 100_000, 100_000)).toBe(100_000);
    expect(callTimeoutNow(limits, 25_001, 100_000, 100_000)).toBeNull();
    // A page call may be shortened to what fits, but never below 45 s.
    expect(callTimeoutNow(limits, 60_000, 100_000, 45_000)).toBe(65_000);
    expect(callTimeoutNow(limits, 80_001, 100_000, 45_000)).toBeNull();
    expect(callTimeoutNow(limits, 130_000, 100_000, 1)).toBeNull();
  });

  it('hard input limits: 10 MB and 150 pages, each with a way forward', () => {
    expect(checkImportLimits(150, 10 * 1024 * 1024)).toBeNull();
    expect(checkImportLimits(151, 1000)).toMatchObject({ code: 'too_many_pages' });
    expect(checkImportLimits(151, 1000)!.message).toMatch(/151 pages; the limit is 150 pages per import\. Split it/);
    expect(checkImportLimits(10, 10 * 1024 * 1024 + 1)).toMatchObject({ code: 'oversized' });
    expect(checkImportLimits(10, 12 * 1024 * 1024)!.message).toMatch(/12\.0 MB; the limit is 10 MB/);
  });
});

describe('page plans', () => {
  const classified = (kinds: PageKind[], tcfAt?: number) => kinds.map((kind, i) => ({ page: i + 1, kind, hasTotalCashFlow: i + 1 === tcfAt }));

  it('Prime: everything up to TOTAL CASH FLOW is content; toll bills / repair invoices after it are attachments (max 12); the rest is stored', () => {
    const kinds: PageKind[] = ['settlement', 'settlement', 'statement', 'statement', ...attachmentMix(30)];
    const plan = primePagePlan(kinds.length, classified(kinds, 4), 4);
    expect(plan.filter((p) => p.role === 'content').map((p) => p.page)).toEqual([1, 2, 3, 4]);
    const attachments = plan.filter((p) => p.role === 'attachment');
    expect(attachments).toHaveLength(MAX_ATTACHMENT_READS);
    expect(attachments.every((p) => p.kind === 'toll_bill' || p.kind === 'repair_invoice')).toBe(true);
    expect(plan.filter((p) => p.kind === 'delivery_receipt').every((p) => p.role === 'stored')).toBe(true);
    // Classification is advisory: a page classified as an attachment BEFORE
    // the boundary is still read as content, in physical order.
    const odd = primePagePlan(5, classified(['settlement', 'toll_bill', 'statement', 'statement', 'toll_bill'], 4), 4);
    expect(odd.map((p) => p.role)).toEqual(['content', 'content', 'content', 'content', 'attachment']);
  });

  it('the boundary waits for the next window unless TOTAL CASH FLOW or a non-statement page follows', () => {
    expect(statementBoundary(classified(['settlement', 'statement']), 2, 30)).toBeNull();
    expect(statementBoundary(classified(['settlement', 'statement'], 2), 2, 30)).toBe(2);
    expect(statementBoundary(classified(['settlement', 'statement', 'toll_bill']), 3, 30)).toBe(2);
    expect(statementBoundary(classified(['settlement', 'settlement']), 2, 2)).toBeNull();
  });

  it('no boundary: physical order, first 40 pages content, the rest stored and listed', () => {
    const plan = physicalPagePlan(60, []);
    expect(plan.filter((p) => p.role === 'content')).toHaveLength(40);
    expect(plan.filter((p) => p.role === 'stored').map((p) => p.page)[0]).toBe(41);
  });
});

describe('the 17-page Prime PDF (6 content pages + 11 attachments) — the stall that started this', () => {
  it('finishes inside the budget in a simulated 150 s world: no run is stopped, every call obeys the start rule, attachments never block', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS));
    expect(sim.violations).toEqual([]);
    expect(sim.invocations.some((i) => i.killed)).toBe(false);
    for (const inv of sim.invocations) expect((inv.endMs ?? 0) - inv.startMs).toBeLessThanOrEqual(130_000);
    // Ready to review costs the 6 content pages, not 17.
    expect(sim.readyAtMs).not.toBeNull();
    expect(sim.modelCalls.classify).toBe(1);
    expect(sim.modelCalls.content).toBe(6);
    // 11 attachments: 8 toll bills / repair invoices read last, 3 delivery receipts never sent.
    expect(sim.modelCalls.attachment).toBe(8);
    expect([...sim.pageCalls.keys()].filter((p) => ELEVEN_ATTACHMENTS[p - 7] === 'delivery_receipt')).toEqual([]);
    // Every page read exactly once.
    expect([...sim.pageCalls.values()].every((n) => n === 1)).toBe(true);
    expect(sim.row.status).toBe('ready');
    // The allowance counts ONE import; classification is logged for cost only.
    expect(sim.usage.filter((u) => u.callType === 'ai_import' && u.success)).toHaveLength(1);
    expect(sim.usage.filter((u) => u.callType === 'ai_import_classify')).toHaveLength(1);

    // The merged week passes the statement self-check (statement on two pages).
    const result = asExtraction(sim.row.resultJson);
    const check = buildPrimeStatementCheck(result)!;
    expect(check.checks.filter((c) => !c.passed)).toEqual([]);
    expect(check.coreMissing).toEqual([]);
    const statement = buildSettlementStatement(result, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(isStatementBacked(statement)).toBe(true);
    expect(statement.printed.deposit).toBe(1884.73);
    expect(result.pageMap!.filter((p) => p.role === 'stored').map((p) => p.page)).toEqual(
      ELEVEN_ATTACHMENTS.map((k, i) => (k === 'delivery_receipt' ? i + 7 : null)).filter((p) => p != null)
    );
  });

  it('the job is "ready to review" before the attachments are read (they never block)', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS));
    // Pages 7+ (attachments) finished after readyAt: the attachments ran
    // in the background after the week was ready.
    const attachmentResults = Object.entries(sim.row.results).filter(([, r]) => r.role === 'attachment');
    expect(attachmentResults.length).toBe(8);
    expect(sim.readyAtMs!).toBeLessThan(sim.finishedAtMs);
  });

  it('the old design for comparison: one 240 s run would have been stopped at 150 s (documented, not simulated)', () => {
    // 120 s whole-document call + two ~25 s pages = the "Page 2 of 17"
    // stall. The new engine never gives one call more than 100 s and never
    // reads pages in the seconds left over after a whole-document timeout.
    expect(limits.callEndLimitMs).toBeLessThan(150_000);
  });
});

describe('whole document (<= 8 pages) and its timeout', () => {
  it('a normal 8-page week is one call', async () => {
    const doc = primeDoc(6, []);
    doc.wholeDocMs = 85_000;
    const sim = await simulateImport(doc);
    expect(sim.modelCalls).toMatchObject({ whole: 1, classify: 0, content: 0 });
    expect(sim.invocations).toHaveLength(1);
    expect(sim.row.status).toBe('ready');
  });

  it('a whole-document timeout continues the page plan in a NEW invocation, never in the leftover seconds', async () => {
    const doc = primeDoc(6, []);
    doc.wholeDocMs = 130_000;
    const sim = await simulateImport(doc);
    expect(sim.modelCalls.whole).toBe(1);
    expect(sim.invocations[0].result?.kind).toBe('continued');
    expect(sim.invocations[0].result?.modelCalls).toBe(1);
    expect(sim.modelCalls.classify).toBe(1);
    expect(sim.row.status).toBe('ready');
    expect(sim.violations).toEqual([]);
  });
});

describe('resume: a killed worker never redoes a finished page', () => {
  it('the platform stops run 2 in the middle of a page; the app resumes after 3 minutes; finished pages are not read again', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS), { killAt: [{ invocation: 2, afterMs: 20_000 }] });
    expect(sim.invocations[1].killed).toBe(true);
    expect(sim.row.status).toBe('ready');
    const doneOnce = [...sim.pageCalls.entries()].filter(([, n]) => n === 1).map(([p]) => p);
    const twice = [...sim.pageCalls.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    // Only the page(s) in flight when the worker was stopped were read again.
    expect(twice.length).toBeGreaterThan(0);
    expect(twice.length).toBeLessThanOrEqual(2);
    expect(doneOnce.length).toBeGreaterThan(5);
    // The stopped page counted one attempt ('worker_stopped'), then succeeded.
    for (const p of twice) expect(sim.row.results[String(p)].status).toBe('done');
    // pages_done never goes backwards: every finished page is still finished.
    expect(Object.values(sim.row.results).filter((r) => r.status === 'done').length).toBe(14);
  });

  it('a lost self-invoke request is covered by the app restart (heartbeat older than 3 minutes)', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS), { dropSelfInvoke: true });
    expect(sim.row.status).toBe('ready');
    expect([...sim.pageCalls.values()].every((n) => n === 1)).toBe(true);
    // Each restart happened at least 3 minutes after the previous run's last heartbeat.
    for (let i = 1; i < sim.invocations.length; i++) {
      expect(sim.invocations[i].startMs - (sim.invocations[i - 1].endMs ?? 0)).toBeGreaterThanOrEqual(179_000);
    }
  });

  it('a user Resume gives failed pages fresh attempts and keeps finished ones', () => {
    const results = {
      '1': { status: 'done' as const, role: 'content' as const, kind: 'settlement' as PageKind, attempts: 1, run: 1, extraction: {} },
      '2': { status: 'failed' as const, role: 'content' as const, kind: 'settlement' as PageKind, attempts: 2, run: 2 },
    };
    const reset = resetFailedPages(results);
    expect(reset['1']).toBe(results['1']);
    expect(reset['2']).toMatchObject({ status: 'pending', attempts: 0 });
  });
});

describe('a stray run never reopens a finished or failed job', () => {
  it('a run started after the job failed changes nothing', async () => {
    const doc = unknownCarrierDoc(9);
    doc.pages = doc.pages.map((p) => ({ ...p, fail: 'parse_failed' as const }));
    const sim = await simulateImport(doc, { doubleStart: false });
    expect(sim.row.status).toBe('failed');
    const { runJobStep, limitsFor: lf } = await import('../../../../supabase/functions/ai-import/jobEngine');
    const writes: string[] = [];
    const result = await runJobStep({
      owner: 'late',
      limits: lf(),
      elapsedMs: () => 0,
      nowMs: () => 0,
      sleep: async () => {},
      store: {
        claim: async () => true,
        load: async () => ({ plan: sim.row.plan, results: sim.row.results, documentId: null, startedAt: new Date(0).toISOString() }),
        savePlan: async () => {
          writes.push('plan');
          return true;
        },
        putPage: async () => {
          writes.push('page');
          return true;
        },
        release: async () => {},
        loadBaseDocument: async () => null,
      },
      model: {
        wholeDocument: async () => ({ errorType: 'internal', message: '' }),
        classifyWindow: async () => ({ errorType: 'internal', message: '' }),
        readPage: async () => ({ errorType: 'internal', message: '' }),
      },
      merge: () => null,
      scrub: (v) => v,
      isPrimeCarrier: () => false,
      logUsage: async () => {},
      consumeCreditIfOverAllowance: async () => {},
      continueInNewInvocation: async () => {},
      startHeartbeat: () => () => {},
      log: () => {},
    });
    expect(result).toEqual({ kind: 'failed', modelCalls: 0 });
    expect(writes).toEqual([]);
  });
});

describe('one chain per job: the lease', () => {
  it('two runs started at the same moment: one owns the job, the other does nothing; no page is read twice', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS), { doubleStart: true });
    expect(sim.invocations[1].result?.kind).toBe('not_owner');
    expect([...sim.pageCalls.values()].every((n) => n === 1)).toBe(true);
    expect(sim.row.status).toBe('ready');
  });
});

describe('partial save', () => {
  it('an attachment that always fails does not block Save; it is listed as not read', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS, { 7: { fail: 'parse_failed' } }));
    expect(sim.row.status).toBe('ready');
    const result = asExtraction(sim.row.resultJson);
    const statement = buildSettlementStatement(result, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(isStatementBacked(statement)).toBe(true);
    expect(lineItemsIncomplete(statement)).toBe(false);
    expect(statement.pages!.unread.map((p) => p.page)).toContain(7);
  });

  it('statement read and passing, a settlement page failing: saved from the statement, "line items incomplete", needs-review', async () => {
    const sim = await simulateImport(goldenDoc(ELEVEN_ATTACHMENTS, { 3: { fail: 'always_timeout' } }));
    expect(sim.row.status).toBe('ready');
    expect(sim.row.results['3']).toMatchObject({ status: 'failed', attempts: 2, error: { type: 'timeout' } });
    const result = asExtraction(sim.row.resultJson);
    const statement = buildSettlementStatement(result, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(isStatementBacked(statement)).toBe(true);
    expect(settlementVerification({ statement })).toBe('verified_prime');
    expect(lineItemsIncomplete(statement)).toBe(true);
    expect(statement.pages!.incomplete).toEqual([{ page: 3, kind: 'settlement', cause: 'timeout' }]);
    expect(statement.reviewReasons).toContainEqual({ reason: 'line_items_incomplete', label: '3' });
    // The failure names the page, the run and the cause.
    expect((sim.row.progress as { failed: unknown[] }).failed).toContainEqual(expect.objectContaining({ page: 3, kind: 'settlement', type: 'timeout' }));
  });

  it('every content page failing fails the job with a message naming the page, run and cause', async () => {
    const doc = unknownCarrierDoc(9);
    doc.pages = doc.pages.map((p) => ({ ...p, fail: 'parse_failed' as const }));
    const sim = await simulateImport(doc);
    expect(sim.row.status).toBe('failed');
    expect(sim.row.errorMessage).toMatch(/^Page 1 of 9 \(settlement\), run \d+: the AI reply could not be read\. Resume from page 1\.$/);
    expect(sim.row.errorPage).toBe(1);
  });
});

describe('core self-checks cannot be skipped (amendment 1)', () => {
  const golden = (mergeAllPages(GOLDEN_PAGES.map((extraction, i) => ({ page: i + 1, extraction })))!.extraction as unknown) as Extraction;

  it('the golden statement read page by page passes every check', () => {
    const check = buildPrimeStatementCheck(golden)!;
    expect(check.passed).toBe(true);
    expect(check.coreMissing).toEqual([]);
    expect(check.totals).toMatchObject({ totalRevenue: 4783.75, totalOperatingExpenses: -2899.02, settlementToOperator: 1884.73, directDeposit: 1884.73, miles: 2327 });
  });

  it('a missing core number (SETTLEMENT TO OPERATOR not read) makes the week Unverified, line route, needs-review — without blocking Save', () => {
    const missing: Extraction = {
      ...golden,
      settlement: { ...golden.settlement!, operating: { ...golden.settlement!.operating!, settlementToOperator: 0, weekTotalStatement: 0, directDeposit: 0 } },
    };
    const check = buildPrimeStatementCheck(missing)!;
    expect(check.checks.filter((c) => !c.passed)).toEqual([]);
    expect(check.coreMissing).toEqual(['settlementToOperator']);
    const statement = buildSettlementStatement(missing, { savedFlagged: false, priorLabelsSeen: new Set() });
    expect(isStatementBacked(statement)).toBe(false);
    expect(settlementVerification({ statement })).toBe('unverified');
    expect(statement.reviewReasons).toContainEqual({ reason: 'statement_core_missing', label: 'settlementToOperator' });
  });

  it('gross not read, or the fixed block not read, are core misses too; miles may be skipped', () => {
    const noGross = { ...golden, settlement: { ...golden.settlement!, grossRevenue: 0 } };
    expect(buildPrimeStatementCheck(noGross)!.coreMissing).toEqual(['grossMatches']);
    const op = golden.settlement!.operating!;
    const noFixed = { ...golden, settlement: { ...golden.settlement!, operating: { ...op, weekTotalFixedCost: 0, lines: op.lines!.filter((l) => l.section !== 'fixed') } } };
    expect(buildPrimeStatementCheck(noFixed)!.coreMissing).toContain('operatingExpenses');
    const noMiles = { ...golden, settlement: { ...golden.settlement!, totalMiles: 0, operating: { ...op, weekMiles: 0 } } };
    const milesCheck = buildPrimeStatementCheck(noMiles)!;
    expect(milesCheck.coreMissing).toEqual([]);
    expect(milesCheck.checks.find((c) => c.id === 'milesMatch')).toBeUndefined();
  });

  it('a statement total read differently on two pages is a failing check (Save blocked, named)', () => {
    const conflicting = mergeAllPages([
      { page: 1, extraction: PAGE_1 },
      { page: 5, extraction: page({ operating: { lines: LINES_PAGE_5, weekTotalRevenue: 4783.75, weekTotalOperatingExpenses: -2899.02 } }) },
      { page: 6, extraction: page({ operating: { lines: LINES_PAGE_6, weekTotalOperatingExpenses: -2989.02, weekTotalStatement: 1884.73, settlementToOperator: 1884.73 } }) },
    ])!.extraction as unknown as Extraction;
    expect(conflicting.mergeConflicts).toContainEqual({ path: 'settlement.operating.weekTotalOperatingExpenses', values: [-2899.02, -2989.02] });
    const check = buildPrimeStatementCheck(conflicting)!;
    expect(check.passed).toBe(false);
    expect(check.checks).toContainEqual({ id: 'mergeConflict', expected: -2899.02, actual: -2989.02, passed: false });
  });

  it('statements saved before coreMissing existed are re-derived from their stored totals', () => {
    const statement = buildSettlementStatement(golden, { savedFlagged: false, priorLabelsSeen: new Set() });
    const legacy = { ...statement, prime: { ...statement.prime!, coreMissing: undefined as unknown as [] } };
    expect(isStatementBacked(legacy)).toBe(true);
    const legacyMissing = { ...legacy, prime: { ...legacy.prime, totals: { ...legacy.prime.totals, settlementToOperator: null } } };
    expect(isStatementBacked(legacyMissing)).toBe(false);
  });
});

describe('merge per field across pages (amendment 5)', () => {
  it('the deposit printed only on page 6 is kept (the old lowest-page rule lost it); null and 0 never beat a number', () => {
    const merged = mergeAllPages(GOLDEN_PAGES.map((extraction, i) => ({ page: i + 1, extraction })))!.extraction;
    const s = merged.settlement as Record<string, unknown> & { operating: Record<string, unknown> };
    expect(s.grossRevenue).toBe(4783.75);
    expect(s.operating.directDeposit).toBe(1884.73);
    expect(s.operating.weekTotalRevenue).toBe(4783.75);
    expect(s.operating.weekTotalFixedCost).toBe(-255.77);
    expect((s.operating.lines as unknown[]).length).toBe(LINES_PAGE_5.length + LINES_PAGE_6.length);
    expect(merged.mergeConflicts).toBeUndefined();
  });

  it('a genuine 0 (a home week) stays 0 when no page printed anything else', () => {
    const merged = mergeAllPages([
      { page: 1, extraction: page({ totalMiles: 0, grossRevenue: 5.16 }) },
      { page: 2, extraction: page({}) },
    ])!.extraction;
    expect((merged.settlement as Record<string, unknown>).totalMiles).toBe(0);
  });
});

describe('privacy: bank digits are never persisted (amendment 4)', () => {
  it('a model reply with routing and account digits leaves no digits in page results, result_json, plan or error text', async () => {
    const leaky = page({ deductions: [{ code: 'DD', desc: 'DIRECT DEPOSIT ROUTING 111000025 ACCOUNT 4455667788', amount: 0 }] }, 'aba #021000021 acct: 99887766');
    const doc = goldenDoc(ELEVEN_ATTACHMENTS, { 2: { extraction: leaky } });
    const sim = await simulateImport(doc);
    const everything = sim.writes.join('\n');
    expect(everything).not.toMatch(/111000025|4455-6677-88|4455667788|021000021|99887766/);
    expect(everything).toMatch(/\[removed\]/);
  });

  it('the server copy of the scrubber is identical to the app copy', () => {
    expect(SERVER_RE.source).toBe(APP_RE.source);
    expect(SERVER_RE.flags).toBe(APP_RE.flags);
    const sample = { summary: 'DIRECT DEPOSIT TO BANK ROUTING #111000025 ACCT # 4455-6677-88', lines: ['aba 021000021'] };
    expect(serverScrub(sample)).toEqual(appScrub(sample));
  });
});

describe('page map', () => {
  it('marks content read/failed, attachments pending until read, stored pages unread', () => {
    const plan = {
      version: 2 as const,
      kind: 'import' as const,
      mediaType: 'application/pdf',
      totalPages: 4,
      fileBytes: 4 * TEXT_PAGE_BYTES,
      phase: 'pages' as const,
      runs: 1,
      pages: [
        { page: 1, role: 'content' as const, kind: 'settlement' as PageKind },
        { page: 2, role: 'content' as const, kind: 'statement' as PageKind },
        { page: 3, role: 'attachment' as const, kind: 'toll_bill' as PageKind },
        { page: 4, role: 'stored' as const, kind: 'delivery_receipt' as PageKind },
      ],
    };
    const map = buildPageMap(plan, {
      '1': { status: 'done', role: 'content', kind: 'settlement', attempts: 1, run: 1 },
      '2': { status: 'failed', role: 'content', kind: 'statement', attempts: 2, run: 1, error: { type: 'timeout', message: '' } },
    });
    expect(map.map((p) => p.status)).toEqual(['read', 'failed', 'pending', 'unread']);
    expect(map[1].cause).toBe('timeout');
  });
});
