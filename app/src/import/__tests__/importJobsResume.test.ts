// RESUMABLE IMPORT JOBS (owner decision 2026-10-13): what the app shows for
// a job — "Interrupted at page N - Resume from page N" after 2 minutes
// without a heartbeat (never "processing" for 10 minutes, never a bare
// "stuck"), the backup restart after 3 minutes, and the progress words.
import {
  AUTO_RESUME_AFTER_MS,
  INTERRUPTED_AFTER_MS,
  deriveChipSummary,
  formatElapsed,
  formatPageList,
  hasPendingWork,
  isInterruptedJob,
  jobProgressView,
  resumeFromPage,
  shouldAutoResume,
  type ImportJob,
  type ImportJobProgress,
} from '../importJobs';

const T0 = '2026-10-13T10:00:00.000Z';
const at = (ms: number) => new Date(new Date(T0).getTime() + ms).toISOString();

function progress(overrides: Partial<ImportJobProgress> = {}): ImportJobProgress {
  return {
    phase: 'pages',
    run: 1,
    totalPages: 17,
    contentTotal: 6,
    contentDone: 2,
    contentFailed: 0,
    current: [{ page: 3, kind: 'settlement', role: 'content', position: 3 }],
    resumePage: 3,
    attachmentsQueued: 12,
    attachmentsDone: 0,
    storedPages: [15, 16, 17],
    failed: [],
    question: null,
    startedAt: T0,
    readyAt: null,
    ...overrides,
  };
}

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'j1',
    status: 'processing',
    pagesDone: 2,
    pagesTotal: 17,
    fileName: 'GRWLLG-OY-PrimeInc6.pdf',
    mediaType: 'application/pdf',
    errorMessage: null,
    errorStep: null,
    createdAt: T0,
    updatedAt: at(100_000),
    completedAt: null,
    progress: progress(),
    heartbeatAt: at(100_000),
    errorPage: null,
    documentId: null,
    ...overrides,
  };
}

describe('heartbeat: interrupted after 2 minutes, restarted after 3', () => {
  it('a job with a fresh heartbeat is working', () => {
    expect(isInterruptedJob(job(), at(100_000 + INTERRUPTED_AFTER_MS))).toBe(false);
    expect(jobProgressView(job(), at(142_000))).toEqual({
      state: 'reading',
      kind: 'settlement',
      role: 'content',
      position: 3,
      total: 6,
      attachmentsQueued: 12,
      elapsedSec: 142,
    });
  });

  it('no heartbeat for more than 2 minutes: "Interrupted at page 3"', () => {
    const now = at(100_000 + INTERRUPTED_AFTER_MS + 1);
    expect(isInterruptedJob(job(), now)).toBe(true);
    expect(jobProgressView(job(), now)).toEqual({ state: 'interrupted', page: 3 });
    expect(resumeFromPage(job())).toBe(3);
    expect(shouldAutoResume(job(), now)).toBe(false);
    expect(shouldAutoResume(job(), at(100_000 + AUTO_RESUME_AFTER_MS + 1))).toBe(true);
  });

  it('a paused job between runs and a ready job still reading attachments are watched too; a failed or finished job is not', () => {
    const later = at(100_000 + INTERRUPTED_AFTER_MS + 1);
    expect(isInterruptedJob(job({ status: 'paused' }), later)).toBe(true);
    expect(isInterruptedJob(job({ status: 'ready', progress: progress({ attachmentsQueued: 3 }) }), later)).toBe(true);
    expect(isInterruptedJob(job({ status: 'ready', progress: progress({ attachmentsQueued: 0 }) }), later)).toBe(false);
    expect(isInterruptedJob(job({ status: 'failed' }), later)).toBe(false);
    expect(isInterruptedJob(job({ status: 'needs_decision' }), later)).toBe(false);
    expect(hasPendingWork(job({ status: 'ready', progress: progress({ attachmentsQueued: 1 }) }))).toBe(true);
  });

  it('a job started before §78 (no progress, no heartbeat) falls back to updated_at', () => {
    const old = job({ progress: null, heartbeatAt: null, updatedAt: at(0) });
    expect(isInterruptedJob(old, at(INTERRUPTED_AFTER_MS + 1))).toBe(true);
    expect(jobProgressView(old, at(INTERRUPTED_AFTER_MS + 1))).toEqual({ state: 'interrupted', page: null });
  });
});

describe('progress and failure views', () => {
  it('a failed job names the page, its kind, the run and the cause', () => {
    const failed = job({
      status: 'failed',
      errorPage: 9,
      progress: progress({ failed: [{ page: 9, kind: 'statement', type: 'timeout', run: 2, timeoutMs: 100_000 }], resumePage: 9 }),
    });
    expect(jobProgressView(failed, at(500_000))).toEqual({
      state: 'failed',
      failure: { page: 9, kind: 'statement', type: 'timeout', run: 2, timeoutMs: 100_000 },
      totalPages: 17,
      resumePage: 9,
    });
  });

  it('the page-cap question', () => {
    const asking = job({ status: 'needs_decision', progress: progress({ phase: 'awaiting_decision', question: { kind: 'page_cap', totalPages: 150, cap: 40 } }) });
    expect(jobProgressView(asking, at(1000))).toEqual({ state: 'question', totalPages: 150, cap: 40 });
    expect(deriveChipSummary([job(), asking])).toEqual({ kind: 'question', job: asking });
  });

  it('ready with attachments still reading, and the elapsed clock stops at ready', () => {
    const ready = job({ status: 'ready', heartbeatAt: at(390_000), progress: progress({ readyAt: at(146_000), current: [], attachmentsQueued: 8 }) });
    expect(jobProgressView(ready, at(400_000))).toEqual({ state: 'ready', attachmentsQueued: 8, storedPages: [15, 16, 17], failed: [] });
    const reading = job({ status: 'ready', progress: progress({ readyAt: at(146_000), current: [{ page: 7, kind: 'toll_bill', role: 'attachment', position: 1 }], attachmentsQueued: 8 }) });
    expect(jobProgressView(reading, at(150_000))).toEqual({ state: 'attachments', done: 0, queued: 8, elapsedSec: 146 });
  });

  it('formats elapsed time and page lists', () => {
    expect(formatElapsed(102)).toBe('1:42');
    expect(formatElapsed(5)).toBe('0:05');
    expect(formatPageList([7, 8, 9, 10, 12, 15, 16])).toBe('7–10, 12, 15–16');
    expect(formatPageList([3])).toBe('3');
  });
});
