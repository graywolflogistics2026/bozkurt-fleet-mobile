// NEVER A GENERIC FAILURE (owner decision 2026-11-03): ready jobs showed
// "We couldn't read this statement" with no reason and no Send report.

import * as fs from 'fs';
import * as path from 'path';
import { ensureReasonLines, jobFailureInfo, jobFailureLines, jobFailureReport, jobRowState } from '../jobFailure';
import { parseVerdictResponse, VerdictAnswerError, verdictRetryDelay } from '../jobVerdict';
import type { ImportJob, JobReviewState } from '../importJobs';
import en from '@/src/i18n/locales/en.json';

const enT = (key: string, opts?: Record<string, unknown>) => {
  let v: unknown = en;
  for (const p of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[p];
  if (typeof v !== 'string') {
    if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
    throw new Error(`missing en key ${key}`);
  }
  return v.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
};

const job = (over: Partial<ImportJob> = {}): ImportJob =>
  ({
    id: 'job-6-8',
    status: 'ready',
    pagesDone: 6,
    pagesTotal: 8,
    fileName: 'week.pdf',
    mediaType: 'application/pdf',
    errorMessage: null,
    errorStep: null,
    createdAt: '2026-11-03T09:20:00.000Z',
    updatedAt: '2026-11-03T09:26:00.000Z',
    completedAt: '2026-11-03T09:26:00.000Z',
    progress: null,
    ...over,
  }) as ImportJob;

const failedFinal: JobReviewState = {
  reads: 2,
  final: {
    state: 'failed_final',
    at: '2026-11-03T09:26:00.000Z',
    reason: 'same_values',
    gateReason: 'statement_check_failed',
    failures: ['variableCosts'],
    details: [{ check: 'variableCosts', printed: -592.69, read: -609.87 }],
  },
  triggers: [],
};

describe('a ready job with no verdict is Finishing up, never "could not read"', () => {
  test('ready + review without a final = finishing', () => {
    expect(jobRowState(job({ review: { reads: 1, final: null, triggers: [] } }))).toBe('finishing');
    expect(jobRowState(job({ review: null }))).toBe('finishing');
  });
  test('the verdict call is retried with backoff', () => {
    expect([0, 1, 2, 3, 9].map(verdictRetryDelay)).toEqual([5000, 15000, 30000, 60000, 60000]);
  });
  test('an answer without `action` names the missing field (old ai-import)', () => {
    expect(() => parseVerdictResponse({ error: { type: 'bad_request' } })).toThrow(new VerdictAnswerError('action'));
    expect(() => parseVerdictResponse(null)).toThrow('server answer missing: body');
    expect(parseVerdictResponse({ jobId: 'j', action: 'final' }).action).toBe('final');
  });
});

describe('a failure always says why', () => {
  test('a failed verdict shows the check name with printed and read', () => {
    const j = job({ review: failedFinal });
    expect(jobRowState(j)).toBe('failed');
    const lines = jobFailureLines(jobFailureInfo(j), enT);
    expect(lines).toContain('TOTAL VARIABLE COSTS: printed -592.69, read -609.87');
    expect(lines).toContain(en.importFlow.stoppedSameValues);
  });

  test('an unreadable page shows the page and the cause', () => {
    const j = job({
      status: 'failed',
      pagesDone: 4,
      pagesTotal: 10,
      progress: { failed: [{ page: 7, kind: 'settlement', type: 'unreadable', run: 2 }] } as ImportJob['progress'],
    });
    expect(jobRowState(j)).toBe('failed');
    expect(jobFailureLines(jobFailureInfo(j), enT)).toEqual(['Page 7 could not be read: the page could not be read (blurry, blank or not a statement page)']);
  });

  test('a failed job with only error_page / error_step still names the page', () => {
    const j = job({ status: 'failed', errorPage: 3, errorStep: 'timeout' });
    expect(jobFailureLines(jobFailureInfo(j), enT)).toEqual(['Page 3 could not be read: the page took too long to read']);
  });

  test('nothing from the server: the missing field is named, never an empty reason', () => {
    const j = job({ review: { reads: 1, final: { state: 'failed_final', at: 'x', reason: 'read_cap' }, triggers: [] } });
    const lines = jobFailureLines(jobFailureInfo(j), enT);
    expect(lines).toContain(en.importFlow.stoppedReadCap);
    expect(jobFailureLines(jobFailureInfo(job({ status: 'failed' })), enT)).toEqual(['Server answer missing: error_step']);
    expect(ensureReasonLines([], enT, 'result_json')).toEqual(['Server answer missing: result_json']);
    expect(jobFailureLines(jobFailureInfo(null), enT)).toEqual(['Server answer missing: import_jobs row']);
  });

  test('the Send report carries the reason, the job and the build', () => {
    const j = job({ review: failedFinal });
    const text = jobFailureReport(j, en.importFlow.couldNotReadTitle, jobFailureLines(jobFailureInfo(j), enT), ['Re-read after read 1: variableCosts'], 'v1.1.0 · update 01a1a0b2');
    expect(text).toContain('TOTAL VARIABLE COSTS: printed -592.69, read -609.87');
    expect(text).toContain('Job: ready · 6/8 pages · 2026-11-03 09:20');
    expect(text).toContain('Build: v1.1.0 · update 01a1a0b2');
    expect(text).not.toContain('week.pdf');
  });
});

describe('Send report is present on every failure screen', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../..', p), 'utf8');
  test('the jobs list row has Send report for a failed row and shows the reason lines', () => {
    const src = read('app/(tabs)/import/jobs.tsx');
    expect(src).toMatch(/state === 'failed' && <SecondaryButton title=\{t\('importFlow\.sendReport'\)\}/);
    expect(src).toContain('reasonLines.map');
    expect(src).not.toContain('simpleJobState');
  });
  test('the COULD NOT READ card always renders Send report and never an empty reason', () => {
    const src = read('src/components/SettlementImportCards.tsx');
    const card = src.slice(src.indexOf('export function CouldNotReadCard'));
    expect(card).toContain("t('importFlow.sendReport')");
    expect(card).toContain('ensureReasonLines(');
  });
  test('the verdict runner never decides a failure on its own', () => {
    const src = read('src/data/jobVerdictRunner.ts');
    expect(src).not.toMatch(/setLocalFinal\([^)]*'failed_final'/);
  });
});
