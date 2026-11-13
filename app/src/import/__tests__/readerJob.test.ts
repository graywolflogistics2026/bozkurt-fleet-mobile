import { newReaderProgress, type ReaderProgress } from '@/src/settlementReader/machine';
import type { ImportJob } from '../importJobs';
import {
  clearReaderReadAgain,
  hasReaderWork,
  markReaderReadAgain,
  readerChipSummary,
  readerFailureLines,
  readerJobView,
  readerReportLines,
  readerShouldResume,
} from '../readerJob';
import { sanitizeExtraction } from '../sanitizeExtraction';
import en from '@/src/i18n/locales/en.json';

const NOW = '2026-11-13T12:00:00.000Z';
const range = { lastContentPage: 8, statementFirst: 5, attachmentPages: [9, 10], attachmentsNotRead: 0 } as unknown as ReaderProgress['range'];

function reader(over: Partial<ReaderProgress> = {}): ReaderProgress {
  return { ...newReaderProgress(10, '2026-11-13'), range, ...over };
}

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    status: 'processing',
    pagesDone: 0,
    pagesTotal: 10,
    fileName: 'week.pdf',
    mediaType: 'application/pdf',
    errorMessage: null,
    errorStep: null,
    createdAt: '2026-11-13T11:55:00.000Z',
    updatedAt: '2026-11-13T11:59:00.000Z',
    completedAt: null,
    progress: null,
    heartbeatAt: null,
    reader: reader(),
    storagePath: 'u/import-jobs/week.pdf',
    ...over,
  };
}

// A t() that resolves en.json keys and fills {{vars}} — the real English text.
const t = (key: string, opts: Record<string, unknown> = {}): string => {
  const raw = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), en);
  const text = typeof raw === 'string' ? raw : typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

describe('readerJobView: the server decides, the app renders', () => {
  test('reading; the second read says "again"', () => {
    expect(readerJobView(job(), NOW)).toEqual({ state: 'reading', again: false, readNo: 1 });
    expect(readerJobView(job({ reader: reader({ readsStarted: 2 }) }), NOW)).toEqual({ state: 'reading', again: true, readNo: 2 });
  });

  test('ready and needs_input both open the card', () => {
    expect(readerJobView(job({ status: 'ready', reader: reader({ state: 'ready', readsStarted: 1 }) }), NOW)).toEqual({ state: 'ready', needsInput: false });
    expect(readerJobView(job({ status: 'needs_decision', reader: reader({ state: 'needs_input', readsStarted: 1 }) }), NOW)).toEqual({ state: 'ready', needsInput: true });
  });

  test('failed: Read again only while reads remain (max 2)', () => {
    const once = readerJobView(job({ status: 'failed', reader: reader({ state: 'failed', readsStarted: 1, failure: { reason: 'gross_differs' } }) }), NOW);
    expect(once).toMatchObject({ state: 'failed', readAgain: 'same_job', reads: 1 });
    const twice = readerJobView(job({ status: 'failed', reader: reader({ state: 'failed', readsStarted: 2, failure: { reason: 'gross_differs' } }) }), NOW);
    expect(twice).toMatchObject({ state: 'failed', readAgain: null, reads: 2 });
  });

  test('a range failure is ours: Read again on the same job (the range call again)', () => {
    const v = readerJobView(job({ status: 'failed', reader: reader({ state: 'failed', range: null, failure: { reason: 'range_not_found', error: 'timeout' } }) }), NOW);
    expect(v).toMatchObject({ state: 'failed', readAgain: 'same_job' });
  });

  test('identical reads are reported', () => {
    const v = readerJobView(
      job({
        status: 'failed',
        reader: reader({
          state: 'failed',
          readsStarted: 2,
          failure: { reason: 'gross_differs' },
          reads: [
            { n: 1, signature: 'abc', outcome: 'failed' },
            { n: 2, signature: 'abc', outcome: 'failed' },
          ],
        }),
      }),
      NOW
    );
    expect(v).toMatchObject({ state: 'failed', sameResult: true });
  });

  test('a cached row from before Read again stays "reading"', () => {
    const failed = job({ status: 'failed', completedAt: '2026-11-13T11:58:00.000Z', reader: reader({ state: 'failed', readsStarted: 1, failure: { reason: 'gross_differs' } }) });
    markReaderReadAgain('job-1', '2026-11-13T11:59:30.000Z');
    expect(readerJobView(failed, NOW).state).toBe('reading');
    expect(readerJobView({ ...failed, completedAt: '2026-11-13T11:59:50.000Z' }, NOW).state).toBe('failed');
    clearReaderReadAgain('job-1');
    expect(readerJobView(failed, NOW).state).toBe('failed');
  });

  test('no reader yet: a just-inserted row is reading', () => {
    expect(readerJobView(job({ status: 'queued', reader: null }), NOW).state).toBe('reading');
  });

  test('the server refused the start: failed with its step, no Read again', () => {
    const v = readerJobView(job({ status: 'failed', reader: null, errorStep: 'rate_limited' }), NOW);
    expect(v).toMatchObject({ state: 'failed', failure: { reason: 'start_refused', step: 'rate_limited' }, readAgain: null });
  });

  test('an old-reader job is failed with Read again as a new job', () => {
    const oldProgress = { phase: 'done' } as unknown as ImportJob['progress'];
    expect(readerJobView(job({ status: 'ready', reader: null, progress: oldProgress }), NOW)).toMatchObject({ state: 'failed', failure: { reason: 'old_reader' }, readAgain: 'new_job' });
    // A running old job is abandoned after 10 minutes without a sign of life.
    expect(readerJobView(job({ status: 'processing', reader: null, updatedAt: '2026-11-13T11:30:00.000Z' }), NOW)).toMatchObject({ state: 'failed', failure: { reason: 'old_reader' } });
    // A photo job has no new-reader path (PDFs only).
    expect(readerJobView(job({ status: 'ready', reader: null, progress: oldProgress, mediaType: 'image/jpeg' }), NOW)).toMatchObject({ readAgain: null });
  });
});

describe('work, resume and the chip', () => {
  test('attachments left = work, even when ready', () => {
    expect(hasReaderWork(job({ status: 'ready', reader: reader({ state: 'ready' }) }))).toBe(true);
    expect(hasReaderWork(job({ status: 'ready', reader: reader({ state: 'ready', attachments: { total: 2, done: [9], failed: [10], notRead: 0 } }) }))).toBe(false);
    expect(hasReaderWork(job({ status: 'failed', reader: reader({ state: 'failed' }) }))).toBe(false);
  });

  test('resume after 3 minutes without a heartbeat, reader jobs only', () => {
    expect(readerShouldResume(job({ heartbeatAt: '2026-11-13T11:58:00.000Z', updatedAt: '2026-11-13T11:58:00.000Z' }), NOW)).toBe(false);
    expect(readerShouldResume(job({ heartbeatAt: '2026-11-13T11:56:00.000Z', updatedAt: '2026-11-13T11:56:00.000Z' }), NOW)).toBe(true);
    expect(readerShouldResume(job({ reader: null, updatedAt: '2026-11-13T11:00:00.000Z' }), NOW)).toBe(false);
  });

  test('chip priority: reading > ready > failed > hidden', () => {
    const reading = job({ id: 'a' });
    const ready = job({ id: 'b', status: 'needs_decision', reader: reader({ state: 'needs_input' }) });
    const failed = job({ id: 'c', status: 'failed', reader: reader({ state: 'failed', failure: { reason: 'model_failed', error: 'timeout' } }) });
    expect(readerChipSummary([failed, ready, reading], NOW)).toMatchObject({ kind: 'processing', job: { id: 'a' } });
    expect(readerChipSummary([failed, ready], NOW)).toMatchObject({ kind: 'ready', readyCount: 1 });
    expect(readerChipSummary([failed], NOW)).toMatchObject({ kind: 'failed', failedCount: 1 });
    expect(readerChipSummary([], NOW)).toEqual({ kind: 'hidden' });
  });
});

describe('failure lines and the report', () => {
  test('a gate failure: reason, the check with printed and read', () => {
    const v = readerJobView(job({ status: 'failed', reader: reader({ state: 'failed', readsStarted: 2, failure: { reason: 'gross_differs', check: 'statementTotal', printed: 1155.28, read: 1155.35 } }) }), NOW);
    if (v.state !== 'failed') throw new Error('expected failed');
    const lines = readerFailureLines(v, t);
    expect(lines[0]).toBe(en.importFlow.reason.grossDiffers);
    expect(lines[1]).toContain('1155.28');
    expect(lines[1]).toContain('1155.35');
    expect(lines[lines.length - 1]).toBe('This file was already read 2 times. Upload it again to start a new import.');
  });

  test('a model failure names the error', () => {
    const v = readerJobView(job({ status: 'failed', reader: reader({ state: 'failed', readsStarted: 2, failure: { reason: 'model_failed', error: 'timeout' } }) }), NOW);
    if (v.state !== 'failed') throw new Error('expected failed');
    expect(readerFailureLines(v, t).slice(0, 2)).toEqual(['The AI could not read this file.', 'AI error: it took too long']);
  });

  test('old reader and refused start', () => {
    const old = readerJobView(job({ status: 'ready', reader: null, progress: { phase: 'done' } as unknown as ImportJob['progress'] }), NOW);
    if (old.state !== 'failed') throw new Error('expected failed');
    expect(readerFailureLines(old, t)).toEqual([en.importFlow.reader.reason.oldReader]);
    const refused = readerJobView(job({ status: 'failed', reader: null, errorStep: 'rate_limited' }), NOW);
    if (refused.state !== 'failed') throw new Error('expected failed');
    expect(readerFailureLines(refused, t)).toEqual(['The import could not start (rate_limited).']);
  });

  test('every reason and model error has English text', () => {
    for (const k of Object.keys(en.importFlow.reader.reason)) expect(t(`importFlow.reader.reason.${k}`, { step: 'x' })).not.toContain('importFlow');
    for (const e of ['timeout', 'max_tokens', 'refusal', 'unreadable_reply', 'busy', 'api_error']) expect(t(`importFlow.reader.error.${e}`)).not.toContain('importFlow');
  });

  test('report lines: state, reads n/2, failure, cost per role', () => {
    const lines = readerReportLines(
      job({
        status: 'failed',
        reader: reader({
          state: 'failed',
          step: 'done',
          readsStarted: 2,
          runs: 3,
          failure: { reason: 'gross_differs', check: 'statementTotal', printed: 1, read: 2 },
          cost: [
            { role: 'range', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0.0015, ms: 3000, outcome: 'ok' },
            { role: 'content', model: 'claude-opus-5-5', inputTokens: 20000, outputTokens: 5000, cacheWriteTokens: 0, cacheReadTokens: 0, usd: 0.225, ms: 90000, outcome: 'ok' },
          ],
        }),
      })
    );
    expect(lines[0]).toContain('Reader: failed');
    expect(lines[0]).toContain('reads 2/2');
    expect(lines.some((l) => l.startsWith('Failure: gross_differs · statementTotal printed 1 read 2'))).toBe(true);
    expect(lines).toContain('Cost content: 1 call(s) · 20000 in / 5000 out · $0.2250');
    expect(lines[lines.length - 1]).toBe('Cost total: $0.2265');
    expect(lines.join('\n')).not.toContain('week.pdf');
  });

  test('old job report line', () => {
    expect(readerReportLines(job({ reader: null, status: 'ready' }))[0]).toMatch(/^Reader: none \(old reader\) · status ready/);
  });
});

describe('photo settlement result', () => {
  test('a docType-only settlement sanitizes without throwing', () => {
    expect(() => sanitizeExtraction({ docType: 'settlement' } as never)).not.toThrow();
  });
});
