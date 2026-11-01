// IMPORT RELIABILITY OVER SPEED (owner decision 2026-10-31). End to end:
// the REAL server job engine (supabase/functions/ai-import/jobEngine.ts) in
// the simulated world of ./jobSimulation.ts, with a simulated model that
// returns the golden weeks' pages; then the APP side on what the server
// stored — readiness, the fetch for review, the one gate, and an atomic
// Certify and add. Both golden weeks: 8/21 (profit 2,534.36) and 8/14
// (MILES row in the revenue block, prior week balance forward 1,202.92-).
let mockClient: ReturnType<typeof import('../../data/__tests__/fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array();
    }
  },
  Paths: { cache: '' },
}));
jest.mock('@/src/data/documentViewer', () => ({ getSignedDocumentUrl: jest.fn() }));
jest.mock('@/src/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

import { createFakeSupabase } from '../../data/__tests__/fakeSupabase';
import { saveExtraction } from '@/src/data/aiImportSave';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { evaluateSettlementGate, nextImportStep } from '@/src/import/settlementGate';
import type { Extraction } from '@/src/import/types';
import type { Settlement } from '@/src/types/db';
import { DEDUCTIONS, KEY, LOADS, MILELESS_ADJUSTMENT, REIMBURSEMENT_ITEMS, REVENUE_ITEMS, STATEMENT, STATEMENT_LINES, WEEK_ENDING } from '../../data/__tests__/golden0814Fixture';
import { GOLDEN_PAGES, page } from './golden0821Pages';
import { attachmentMix, primeDoc, simulateImport, type DocSpec, type SimOptions } from './jobSimulation';
import type { PageKind } from '../../../../supabase/functions/ai-import/jobEngine';

// ---------------------------------------------------------------------
// The two golden weeks as the pages a Prime PDF prints them on.
// ---------------------------------------------------------------------
function doc0821(attachments: PageKind[] = []): DocSpec {
  const d = primeDoc(4, attachments);
  // The real PDF prints SETTLEMENT DATE 26/08/21, print DATE 8/20/26 and the
  // statement WEEK ENDING 26/08/21 (the older page fixture predates printed dates).
  const printed: Record<number, Record<string, unknown>> = { 0: { settlementDateRaw: '26/08/21', printDateRaw: '8/20/26' }, 4: { statementWeekEndingRaw: '26/08/21' } };
  d.pages = d.pages.map((p, i) => {
    const base = GOLDEN_PAGES[i];
    const extraction = base && printed[i] ? { ...base, settlement: { ...base.settlement, ...printed[i] } } : base;
    return { ...p, extraction: extraction ?? undefined };
  });
  return d;
}

const OP_SPLIT = 14; // statement lines 1-14 on page 5, the rest on page 6
const PAGES_0814 = [
  page({
    weekEnding: WEEK_ENDING,
    settlementDateRaw: '26/08/14',
    printDateRaw: '8/13/26',
    carrier: 'PRIME INC.',
    unit: '283940',
    grossRevenue: KEY.revenue,
    reimbursements: KEY.reimbursements,
    totalDeductions: KEY.deductionsPrinted,
    netPay: KEY.netDue,
    totalMiles: KEY.miles,
    loadedMiles: KEY.loadedMiles,
    revenueItems: REVENUE_ITEMS,
    reimbursementItems: REIMBURSEMENT_ITEMS,
    loads: [LOADS[0], MILELESS_ADJUSTMENT, LOADS[1], LOADS[2]],
    deductions: DEDUCTIONS.slice(0, 1),
  }),
  page({ deductions: DEDUCTIONS.slice(1) }),
  page({}),
  page({ depositAmount: KEY.deposit }),
  page({
    statementWeekEndingRaw: '26/08/14',
    operating: {
      lines: STATEMENT_LINES.slice(0, OP_SPLIT),
      weekEnding: WEEK_ENDING,
      weekMiles: STATEMENT.weekMiles,
      weekTotalOtherRevenue: STATEMENT.weekTotalOtherRevenue,
      weekTotalRevenue: STATEMENT.weekTotalRevenue,
      weekTotalFuelOilTax: STATEMENT.weekTotalFuelOilTax,
    },
  }),
  page({
    operating: {
      lines: STATEMENT_LINES.slice(OP_SPLIT),
      weekTotalRepair: STATEMENT.weekTotalRepair,
      weekTotalMiscellaneous: STATEMENT.weekTotalMiscellaneous,
      weekTotalVariableCosts: STATEMENT.weekTotalVariableCosts,
      weekTotalFixedCost: STATEMENT.weekTotalFixedCost,
      weekTotalOtherIncomeAndExpense: STATEMENT.weekTotalOtherIncomeAndExpense,
      weekTotalOperatingExpenses: STATEMENT.weekTotalOperatingExpenses,
      weekTotalStatement: STATEMENT.weekTotalStatement,
      priorWeekBalanceForward: STATEMENT.priorWeekBalanceForward,
      weekTotalCashFlow: STATEMENT.weekTotalCashFlow,
      settlementToOperator: STATEMENT.settlementToOperator,
      directDeposit: STATEMENT.directDeposit,
    },
  }),
];

function doc0814(overrides: Partial<Record<number, Partial<DocSpec['pages'][number]>>> = {}, attachments: PageKind[] = []): DocSpec {
  const d = primeDoc(4, attachments);
  d.pages = d.pages.map((p, i) => ({ ...p, extraction: PAGES_0814[i] ?? undefined, ...(overrides[i + 1] ?? {}) }));
  return d;
}

// Page 6 of 8/14 read with the deposit's digits swapped (3,027.57).
const PAGE6_MISREAD = page({ operating: { ...(PAGES_0814[5].settlement as { operating: Record<string, unknown> }).operating, directDeposit: 3027.57, settlementToOperator: 3027.57, weekTotalCashFlow: 3027.57 } });

// ---------------------------------------------------------------------
// The APP side, exactly as the import screen runs it on a ready job.
// ---------------------------------------------------------------------
async function appSide(resultJson: unknown, importDate: string) {
  const reading = sanitizeExtraction(resultJson as Extraction);
  const gate = evaluateSettlementGate(reading, { importDate });
  return { reading, gate, step: nextImportStep(gate, 0) };
}

async function engine(d: DocSpec, opts: SimOptions = {}) {
  const sim = await simulateImport(d, opts);
  expect(sim.violations).toEqual([]);
  return sim;
}

describe('8/21 golden week: server job engine -> app gate -> certify', () => {
  it('the job is ready, the card shows the statement numbers, the next step is Certify', async () => {
    const sim = await engine(doc0821());
    expect(sim.row.status).toBe('ready');
    const { gate, step } = await appSide(sim.row.resultJson, '2026-08-25');
    expect(gate?.status).toBe('pass');
    if (gate?.status !== 'pass') return;
    expect(gate.headline).toMatchObject({ weekEnding: '2026-08-21', revenue: 4783.75, deposited: 1884.73, miles: 2327 });
    // The page fixture lists only some deduction lines: the lines differ, so
    // they are not stored — and that never gates the week.
    expect(gate.lineDetails).toBe('mismatch');
    expect(step).toBe('certify');
  });

  // Failed before step B1 (two pages at a time); passes since B1.
  it('17 pages with a killed worker: resumes without redoing finished pages, then the same card', async () => {
    const sim = await engine(doc0821(attachmentMix(11)), { killAt: [{ invocation: 2, afterMs: 20_000 }] });
    expect(sim.invocations[1].killed).toBe(true);
    expect(sim.row.status).toBe('ready');
    // Statement pages (1-6) read once each except at most the page in flight.
    expect([1, 2, 3, 4, 5, 6].filter((p) => (sim.pageCalls.get(p) ?? 0) > 1).length).toBeLessThanOrEqual(1);
    const { gate } = await appSide(sim.row.resultJson, '2026-08-25');
    expect(gate?.status).toBe('pass');
  });
});

describe('8/14 golden week (MILES row, balance forward 1,202.92-)', () => {
  it('ready; deposit 3,072.57 read from the statement; miles 3,316 (2,739 loaded / 577 empty); Certify', async () => {
    const sim = await engine(doc0814());
    expect(sim.row.status).toBe('ready');
    const { gate, step } = await appSide(sim.row.resultJson, '2026-08-15');
    expect(gate?.status).toBe('pass');
    if (gate?.status !== 'pass') return;
    expect(gate.headline).toMatchObject({ weekEnding: WEEK_ENDING, revenue: KEY.revenue, netDue: KEY.netDue, deposited: KEY.deposit, owedToCarrier: 0, miles: KEY.miles });
    expect(step).toBe('certify');
  });

  it('a page whose first reply cannot be parsed is read again and the week still reaches Certify', async () => {
    const sim = await engine(doc0814({ 5: { fail: 'parse_failed_once' } }));
    expect(sim.row.status).toBe('ready');
    const { gate, step } = await appSide(sim.row.resultJson, '2026-08-15');
    expect(gate?.status).toBe('pass');
    expect(step).toBe('certify');
  });

  it('a LINE page that never parses never gates the week: Certify, never an automatic re-read', async () => {
    const sim = await engine(doc0814({ 2: { fail: 'parse_failed' } }));
    expect(sim.row.status).toBe('ready');
    const { gate, step } = await appSide(sim.row.resultJson, '2026-08-15');
    expect(gate?.status).toBe('pass');
    expect(step).toBe('certify');
  });

  // Step C (dual read). Still fails: one read per page until then.
  it.failing('two reads of the statement page disagree on the deposit: a third read decides, the agreed number wins', async () => {
    const sim = await engine(doc0814({ 6: { readings: [PAGE6_MISREAD, PAGES_0814[5], PAGES_0814[5]] } }));
    expect(sim.row.status).toBe('ready');
    const { gate } = await appSide(sim.row.resultJson, '2026-08-15');
    expect(gate?.status).toBe('pass');
    if (gate?.status !== 'pass') return;
    expect(gate.headline.deposited).toBe(KEY.deposit);
    // What disagreed is kept for the Send report (names only, no amounts).
    expect(JSON.stringify((sim.row.resultJson as { readCheck?: unknown }).readCheck ?? null)).toContain('directDeposit');
  });

  it('Certify and add on the engine result is atomic: the week and its certification, certify last', async () => {
    const sim = await engine(doc0814());
    const reading = sanitizeExtraction(sim.row.resultJson as Extraction);
    mockClient = createFakeSupabase({ profiles: [{ user_id: 'user-1', business_balance: 0 }] });
    const saved = await saveExtraction({
      importDate: '2026-08-15',
      extraction: reading,
      userId: 'user-1',
      truckId: 'truck-283940',
      driverId: null,
      driverShareAmount: null,
      fileUri: null,
      fileExt: 'pdf',
      mediaType: 'application/pdf',
      createContribution: false,
      certify: { appVersion: '1.1.0', nowIso: '2026-10-31T12:00:00.000Z' },
    });
    expect(saved.certified).toBe(true);
    const st = (mockClient.__store as Record<string, Settlement[]>).settlements;
    expect(st).toHaveLength(1);
    expect(st[0].certified_at).toBe('2026-10-31T12:00:00.000Z');
  });

  // Failed before step B1 (an 8-page Prime PDF was one whole-document
  // call, so the misread page never reached the gate); passes since B1.
  it('a reading that fails the gate stores nothing at all', async () => {
    const sim = await engine(doc0814({ 6: { readings: [PAGE6_MISREAD] } }));
    const reading = sanitizeExtraction(sim.row.resultJson as Extraction);
    mockClient = createFakeSupabase({ profiles: [{ user_id: 'user-1', business_balance: 0 }] });
    await expect(
      saveExtraction({
        importDate: '2026-08-15',
        extraction: reading,
        userId: 'user-1',
        truckId: 'truck-283940',
        driverId: null,
        driverShareAmount: null,
        fileUri: null,
        fileExt: 'pdf',
        mediaType: 'application/pdf',
        createContribution: false,
        certify: { appVersion: '1.1.0', nowIso: '2026-10-31T12:00:00.000Z' },
      })
    ).rejects.toThrow(/Nothing was saved/);
    const store = mockClient.__store as Record<string, unknown[]>;
    expect(store.settlements ?? []).toHaveLength(0);
  });
});

describe('readiness: one rule for the chip, the notification, the button and the fetch', () => {
  // Loaded dynamically so this file still compiles where the function is missing.
  const jobs = require('@/src/import/importJobs') as Record<string, unknown>;

  it('isReadyToReview exists and is the one rule', () => {
    expect(typeof jobs.isReadyToReview).toBe('function');
  });

  it('a list row still saying "ready" from BEFORE a re-read was requested is not ready (the stale-cache dead end)', () => {
    const isReady = jobs.isReadyToReview as (j: unknown, o?: unknown) => boolean;
    const stale = { status: 'ready', completedAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T10:00:00.000Z' };
    expect(isReady(stale, { notBefore: '2026-10-31T10:05:00.000Z' })).toBe(false);
    const fresh = { status: 'ready', completedAt: '2026-10-31T10:09:00.000Z', updatedAt: '2026-10-31T10:09:00.000Z' };
    expect(isReady(fresh, { notBefore: '2026-10-31T10:05:00.000Z' })).toBe(true);
  });

  it('the fetch never dead-ends: a ready row without its result is "finishing", not null', async () => {
    const data = require('@/src/data/importJobs') as Record<string, unknown>;
    expect(typeof data.loadJobForReview).toBe('function');
    mockClient = createFakeSupabase({ import_jobs: [{ id: 'j1', user_id: 'user-1', status: 'ready', result_json: null, file_name: 'w.pdf', storage_path: 'user-1/x.pdf', media_type: 'application/pdf' }] });
    const r = await (data.loadJobForReview as (id: string) => Promise<{ state: string }>)('j1');
    expect(r.state).toBe('finishing');
  });
});
