// RE-READ RULES (owner decision 2026-11-03, week 07/17 import loop): the job
// decides re-reads before it is ready, max 3 reads, the same values twice
// stop at once, and the review card never sees a non-final job.
import {
  decideJobVerdict,
  manualReread,
  reviewOf,
  MAX_READS_PER_JOB,
  type JobReview,
  type JobVerdictInput,
} from '../../../../supabase/functions/ai-import/jobEngine';
import {
  deriveChipSummary,
  isAwaitingVerdict,
  isReadyToReview,
  jobProgressView,
  jobReviewStep,
  readingAgainOf,
  shouldAutoResume,
  simpleJobState,
  type ImportJob,
  type JobReviewState,
} from '../importJobs';
import { triggerReportLines, verdictOfReading } from '../jobVerdict';
import { MAX_READS_PER_JOB as APP_MAX_READS } from '../importJobs';

const NOW = '2026-11-03T12:00:00.000Z';
const opts = { nowIso: NOW, rereadable: true };

const miscFail = (readNo: number, read = -609.87): JobVerdictInput => ({
  readNo,
  status: 'fail',
  reason: 'statement_mismatch',
  failures: ['variableCosts'],
  details: [{ check: 'variableCosts', printed: -592.69, read }],
  pages: [4, 5],
});

describe('decideJobVerdict', () => {
  test('the app and the server agree on the cap', () => {
    expect(APP_MAX_READS).toBe(MAX_READS_PER_JOB);
    expect(MAX_READS_PER_JOB).toBe(3);
  });

  test('a pass on read 1 is final ready', () => {
    const d = decideJobVerdict(reviewOf(null), { readNo: 1, status: 'pass' }, opts);
    expect(d.action).toBe('final');
    expect(d.review.final?.state).toBe('ready_final');
    expect(d.review.reads).toBe(1);
  });

  test('a check that fails identically twice ends in the failure screen after 2 reads', () => {
    const first = decideJobVerdict(reviewOf(null), miscFail(1), opts);
    expect(first.action).toBe('reread');
    expect(first.review.reads).toBe(2);
    expect(first.review.triggers).toHaveLength(1);
    expect(first.review.triggers[0]).toMatchObject({ readNo: 1, check: 'variableCosts', printed: -592.69, value: -609.87 });
    if (first.action !== 'reread') throw new Error('expected reread');
    expect(first.pages).toEqual([4, 5]);

    const second = decideJobVerdict(first.review, miscFail(2), opts);
    expect(second.action).toBe('final');
    expect(second.review.reads).toBe(2);
    expect(second.review.final).toMatchObject({ state: 'failed_final', reason: 'same_values', gateReason: 'statement_mismatch' });
    expect(second.review.final?.details).toEqual([{ check: 'variableCosts', printed: -592.69, read: -609.87 }]);
  });

  test('different values each time: the hard cap stops at 3 reads', () => {
    const r1 = decideJobVerdict(reviewOf(null), miscFail(1, -609.87), opts);
    const r2 = decideJobVerdict(r1.review, miscFail(2, -600.0), opts);
    expect(r2.action).toBe('reread');
    expect(r2.review.reads).toBe(3);
    const r3 = decideJobVerdict(r2.review, miscFail(3, -595.0), opts);
    expect(r3.action).toBe('final');
    expect(r3.review.final).toMatchObject({ state: 'failed_final', reason: 'read_cap' });
    expect(r3.review.reads).toBe(3);
  });

  test('a stale verdict (older read) or one for a final job is ignored', () => {
    const r1 = decideJobVerdict(reviewOf(null), miscFail(1), opts);
    expect(decideJobVerdict(r1.review, miscFail(1), opts).action).toBe('ignored');
    const done = decideJobVerdict(reviewOf(null), { readNo: 1, status: 'pass' }, opts).review;
    expect(decideJobVerdict(done, miscFail(1), opts).action).toBe('ignored');
  });

  test('no PDF to read again: failed at once, never a re-read', () => {
    const d = decideJobVerdict(reviewOf(null), miscFail(1), { nowIso: NOW, rereadable: false });
    expect(d.review.final).toMatchObject({ state: 'failed_final', reason: 'not_rereadable' });
  });

  test('a manual Read again counts against the cap', () => {
    const at3: JobReview = { reads: 3, final: null, triggers: [] };
    expect(manualReread(at3, NOW, null)).toBeNull();
    const next = manualReread(reviewOf(null), NOW, null)!;
    expect(next.reads).toBe(2);
    expect(next.final).toBeNull();
  });
});

const baseJob = (over: Partial<ImportJob> = {}): ImportJob =>
  ({
    id: 'job-1',
    status: 'ready',
    fileName: 'week.pdf',
    mediaType: 'application/pdf',
    storagePath: 'u/x.pdf',
    createdAt: '2026-11-03T11:55:00.000Z',
    updatedAt: '2026-11-03T11:58:00.000Z',
    completedAt: '2026-11-03T11:58:00.000Z',
    heartbeatAt: '2026-11-03T11:58:00.000Z',
    progress: null,
    ...over,
  }) as ImportJob;

describe('the card renders only for a FINAL job', () => {
  const checking: JobReviewState = { reads: 1, final: null, triggers: [] };
  const rereading: JobReviewState = {
    reads: 2,
    final: null,
    triggers: [{ at: NOW, readNo: 1, check: 'variableCosts', printed: -592.69, value: -609.87, reason: 'statement_mismatch: variableCosts', pages: [4, 5] }],
  };
  const failedFinal: JobReviewState = {
    ...rereading,
    final: { state: 'failed_final', at: NOW, reason: 'same_values', gateReason: 'statement_mismatch', details: [{ check: 'variableCosts', printed: -592.69, read: -609.87 }] },
  };
  const readyFinal: JobReviewState = { reads: 1, final: { state: 'ready_final', at: NOW, reason: 'pass' }, triggers: [] };

  test('a ready job waiting for its verdict is not ready to review', () => {
    const job = baseJob({ review: checking });
    expect(isReadyToReview(job)).toBe(false);
    expect(jobReviewStep(job)).toBe('checking');
    expect(isAwaitingVerdict(job)).toBe(true);
    expect(simpleJobState(job)).toBe('reading');
    expect(jobProgressView(job, NOW).state).not.toBe('ready');
    expect(deriveChipSummary([job]).kind).toBe('processing');
  });

  test('a re-read in progress shows "Reading again (2 of 3): <check>"', () => {
    const job = baseJob({ status: 'processing', review: rereading });
    expect(isReadyToReview(job)).toBe(false);
    expect(readingAgainOf(job)).toEqual({ n: 2, max: 3, check: 'variableCosts' });
  });

  test('a failed_final job shows COULD NOT READ, never the card', () => {
    const job = baseJob({ review: failedFinal });
    expect(isReadyToReview(job)).toBe(false);
    expect(jobReviewStep(job)).toBe('could_not_read');
    expect(simpleJobState(job)).toBe('failed');
    expect(deriveChipSummary([job]).kind).toBe('failed');
    expect(readingAgainOf(job)).toBeNull();
  });

  test('a ready_final job is ready; a row without the review column (older database) too', () => {
    expect(isReadyToReview(baseJob({ review: readyFinal }))).toBe(true);
    expect(jobReviewStep(baseJob({ review: readyFinal }))).toBe('ready');
    expect(isReadyToReview(baseJob({ review: undefined }))).toBe(true);
  });

  test('the 3-minute restart never resumes a job that is only waiting for its verdict', () => {
    const job = baseJob({ review: checking, heartbeatAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z' });
    expect(shouldAutoResume(job, NOW)).toBe(false);
  });
});

describe('verdictOfReading / triggerReportLines', () => {
  test('a non-settlement always passes', () => {
    expect(verdictOfReading({ docType: 'fuel' } as never, 1, { importDate: '2026-11-03' })).toEqual({ readNo: 1, status: 'pass' });
  });

  test('the Send report lists the last 3 triggers with the check and both numbers', () => {
    const t = (readNo: number) => ({ readNo, check: 'variableCosts', printed: -592.69, value: -609.87, reason: 'statement_mismatch' });
    const lines = triggerReportLines([t(1), t(2), t(3), t(4)]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Re-read after read 2: variableCosts printed -592.69, read -609.87 (statement_mismatch)');
    expect(triggerReportLines(null)).toEqual([]);
  });
});
