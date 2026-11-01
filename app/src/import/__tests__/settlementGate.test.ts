import fs from 'fs';
import path from 'path';
import {
  evaluateSettlementGate,
  gateRank,
  headlineFromSettlement,
  nextImportStep,
  weekQuietLines,
  withGateAudit,
  GATE_FAIL_REASON_KEY,
  MAX_AUTO_REREADS,
} from '@/src/import/settlementGate';
import { silentAttachmentStep, simpleJobState } from '@/src/import/importJobs';
import { couldNotReadReport } from '@/src/import/importAudit';
import type { Extraction } from '@/src/import/types';
import en from '@/src/i18n/locales/en.json';
import es from '@/src/i18n/locales/es.json';
import ru from '@/src/i18n/locales/ru.json';
import tr from '@/src/i18n/locales/tr.json';
import hi from '@/src/i18n/locales/hi.json';

// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2). The two golden
// Prime weeks are in src/data/__tests__/goldenPrimeSettlement*.test.ts;
// here: other carriers, the flow helpers, the quiet lines, the silent
// attachment jobs, the screens and the five enabled locales.

const IMPORT_DATE = '2026-08-25';
const other = (s: Partial<NonNullable<Extraction['settlement']>> = {}): Extraction => ({
  docType: 'settlement',
  settlement: {
    carrier: 'Landstar Ranger',
    weekEnding: '2026-08-21',
    settlementDateRaw: '08/21/2026',
    grossRevenue: 5000,
    totalDeductions: 1200,
    netPay: 3800,
    totalMiles: 2400,
    revenueItems: [{ desc: 'Linehaul', amount: 5000 }],
    deductions: [
      { desc: 'Insurance', amount: 400 },
      { desc: 'Fuel', amount: 800 },
    ],
    ...s,
  } as NonNullable<Extraction['settlement']>,
});
const gateOf = (e: Extraction) => evaluateSettlementGate(e, { importDate: IMPORT_DATE })!;

describe('evaluateSettlementGate — other carriers', () => {
  test('printed totals that add up within $1 + required fields -> pass, headline from the printed figures', () => {
    const gate = gateOf(other());
    expect(gate).toMatchObject({ status: 'pass', lineDetails: 'match' });
    if (gate.status !== 'pass') return;
    expect(gate.headline).toMatchObject({ weekEnding: '2026-08-21', revenue: 5000, netDue: 3800, deposited: 3800, owedToCarrier: 0, miles: 2400, perDiemDays: 7, source: 'printed_totals' });
    expect(gate.headline.estimatedProfit).toBe(3800);
  });

  test('a statement that prints no totals -> fail "totals not printed" (send report)', () => {
    expect(gateOf(other({ grossRevenue: undefined, totalDeductions: undefined, netPay: undefined }))).toMatchObject({ status: 'fail', reason: 'totals_not_printed' });
    expect(gateOf(other({ totalDeductions: undefined }))).toMatchObject({ status: 'fail', reason: 'totals_not_printed' });
  });

  test('printed totals that do not add up, or lines that do not match them -> fail', () => {
    expect(gateOf(other({ netPay: 3700 }))).toMatchObject({ status: 'fail', reason: 'totals_differ' });
    expect(gateOf(other({ deductions: [{ desc: 'Insurance', amount: 400 }] }))).toMatchObject({ status: 'fail', reason: 'lines_differ' });
  });

  test('net due missing -> fail (required field)', () => {
    expect(gateOf(other({ netPay: undefined }))).toMatchObject({ status: 'fail', reason: 'missing_fields' });
  });

  test('an ambiguous date is asked once inside the card (needs_date); answered -> pass', () => {
    const e = other({ settlementDateRaw: '08/07/2026', weekEnding: '2026-08-07' });
    const gate = gateOf(e);
    expect(gate.status).toBe('needs_date');
    expect(nextImportStep(gate, 0)).toBe('certify');
    const answered = other({ settlementDateRaw: '08/07/2026', weekEnding: '2026-08-07', dateConfirmed: { weekEnding: '2026-08-07', by: 'user' } });
    expect(gateOf(answered).status).toBe('pass');
  });

  test('no week ending at all -> fail', () => {
    expect(gateOf(other({ settlementDateRaw: undefined, weekEnding: '' }))).toMatchObject({ status: 'fail', reason: 'date_unreadable' });
  });

  test('not a settlement -> null (the gate is for settlements only)', () => {
    expect(evaluateSettlementGate({ docType: 'fuel' } as Extraction, { importDate: IMPORT_DATE })).toBeNull();
  });
});

describe('flow helpers', () => {
  test('re-read twice, then COULD NOT READ; a pass goes straight to the card', () => {
    const failing = gateOf(other({ netPay: 3700 }));
    expect(MAX_AUTO_REREADS).toBe(2);
    expect([0, 1, 2, 3].map((n) => nextImportStep(failing, n))).toEqual(['reread', 'reread', 'could_not_read', 'could_not_read']);
    expect(nextImportStep(gateOf(other()), 0)).toBe('certify');
  });

  test('rank: pass+match > pass+mismatch > needs_date > fail', () => {
    const pass = gateOf(other());
    const ask = gateOf(other({ settlementDateRaw: '08/07/2026', weekEnding: '2026-08-07' }));
    const fail = gateOf(other({ netPay: 3700 }));
    expect(gateRank(pass)).toBeGreaterThan(gateRank(ask));
    expect(gateRank(ask)).toBeGreaterThan(gateRank(fail));
  });

  test('the gate result is kept in parsed_json for audit, never as a label', () => {
    expect(withGateAudit(other(), gateOf(other())).settlementGate).toEqual({ status: 'pass', lineDetails: 'match', lineDifference: null });
  });

  test('every fail reason has an en sentence', () => {
    for (const key of Object.values(GATE_FAIL_REASON_KEY)) {
      const leaf = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
      expect(typeof leaf).toBe('string');
    }
  });

  test('the report with no reading is the reason only; bank digits never leave', () => {
    const t = (k: string) => k;
    expect(couldNotReadReport(null, 'job_failed', t)).toBe('importFlow.couldNotReadTitle\nimportFlow.reason.jobFailed');
    const e = other({ unit: 'acct 123456789012' } as never);
    expect(couldNotReadReport(e, 'totals_differ', t)).not.toContain('123456789012');
  });
});

describe('stored weeks: Certify later, quiet lines', () => {
  test('headline from the stored numbers (owed week shows owed, not a deposit)', () => {
    const h = headlineFromSettlement(
      { week_ending: '2026-08-07', carrier: 'Prime Inc', gross: 3000, net: -1202.92, miles: 1500, loaded_miles: 1200, empty_miles: 300, per_diem_days: 7, statement: null },
      410.5
    );
    expect(h).toMatchObject({ revenue: 3000, netDue: -1202.92, deposited: 0, owedToCarrier: 1202.92, loadedMiles: 1200, emptyMiles: 300, estimatedProfit: 410.5 });
  });

  test('"Line details were not saved" and "Attachments: N saved, M read" (Read capped at 12 pages)', () => {
    const pageMap = [
      { page: 1, role: 'content', status: 'read' },
      { page: 2, role: 'content', status: 'read' },
      ...Array.from({ length: 15 }, (_, i) => ({ page: 3 + i, role: i < 3 ? 'attachment' : 'stored', status: i < 3 ? 'read' : 'unread' })),
    ];
    const lines = weekQuietLines({ linesNotSaved: true }, { pageMap });
    expect(lines.linesNotSaved).toBe(true);
    expect(lines.contentPages).toEqual([1, 2]);
    expect(lines.attachments).toEqual({ saved: 15, read: 3, unreadPages: Array.from({ length: 12 }, (_, i) => 6 + i) });
    expect(weekQuietLines(null, null)).toEqual({ linesNotSaved: false, contentPages: [], attachments: null });
  });
});

describe('jobs: three states; post-save attachment jobs are silent', () => {
  test('reading / ready / failed only', () => {
    for (const status of ['queued', 'processing', 'paused', 'waiting_to_retry', 'needs_decision'] as const) expect(simpleJobState({ status })).toBe('reading');
    expect(simpleJobState({ status: 'ready' })).toBe('ready');
    expect(simpleJobState({ status: 'failed' })).toBe('failed');
  });

  test('a job of a saved week (document_id) is stored or dropped silently, never reviewed', () => {
    expect(silentAttachmentStep({ status: 'ready', documentId: 'd1' })).toBe('store');
    expect(silentAttachmentStep({ status: 'failed', documentId: 'd1' })).toBe('drop');
    expect(silentAttachmentStep({ status: 'processing', documentId: 'd1' })).toBe('wait');
    expect(silentAttachmentStep({ status: 'ready', documentId: null })).toBeNull();
  });
});

describe('screens (source checks)', () => {
  const app = path.resolve(__dirname, '../../..');
  const read = (rel: string) => fs.readFileSync(path.join(app, rel), 'utf8');

  test('no Save anyway, Review All, Things to check, Verified badge, duplicate banner or line-items-incomplete notice on any screen', () => {
    const screens = [
      'app/(tabs)/import/index.tsx',
      'app/(tabs)/import/jobs.tsx',
      'app/(tabs)/more/settlements.tsx',
      'app/(tabs)/deductions.tsx',
      'app/(tabs)/more/fuel.tsx',
      'app/(tabs)/more/tolls.tsx',
      'app/(tabs)/more/maintenance.tsx',
      'src/components/ProfitAudit.tsx',
      'src/components/WeekReviewCard.tsx',
      'src/components/ImportJobsChip.tsx',
    ].map(read);
    for (const src of screens) {
      expect(src).not.toMatch(/saveAnywayFlagged|handleSaveFlagged|reviewAll|handleReviewAll|thingsToCheck|VerificationBadge|audit\.verification|possibleDuplicateTitle|settlementReplaceTitle|IncompleteLineItemsNotice \/>|lineItemsIncompleteTitle|DateCheckList|jobProgressText|resumeFromPage|interruptedNote/);
    }
  });

  test('the import card and saveExtraction() use the same gate; certify is passed on save', () => {
    const screen = read('app/(tabs)/import/index.tsx');
    expect(screen).toContain('evaluateSettlementGate(e, {');
    expect(screen).toContain("certify: isSettlement ? { appVersion: appVersionLabel() } : null");
    expect(read('src/data/aiImportSave.ts')).toContain('evaluateSettlementGate(d, {');
  });
});

describe('five enabled locales', () => {
  const keys = ['reading', 'certifyAndAdd', 'certifyLine', 'couldNotReadTitle', 'uploadAgain', 'sendReport', 'deposited', 'netDue', 'linesNotSaved', 'attachmentsLine'] as const;
  test.each([['es', es], ['ru', ru], ['tr', tr], ['hi', hi]] as const)('%s translates the card', (_name, loc) => {
    for (const k of keys) {
      expect((loc as typeof en).importFlow[k]).toBeTruthy();
      expect((loc as typeof en).importFlow[k]).not.toBe(en.importFlow[k]);
    }
    expect((loc as typeof en).certify.certifiedOn).not.toBe(en.certify.certifiedOn);
  });

  test('en wording as specified (DRAFT certification line, attorney review)', () => {
    expect(en.importFlow.reading).toBe('Reading your statement. Keep the app open. Usually 2-4 minutes for 17 pages.');
    expect(en.importFlow.couldNotReadTitle).toBe("We couldn't read this statement reliably. Nothing was saved.");
    expect(en.importFlow.certifyAndAdd).toBe('Certify and add to my books');
    expect(en.importFlow.certifyLine).toBe('I checked these numbers against my statement. AI-generated estimates, not tax advice.');
    expect(tr.importFlow.certifyAndAdd).toBe('Onayla ve defterime ekle');
  });
});
