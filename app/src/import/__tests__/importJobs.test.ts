import {
  deriveChipSummary,
  isActiveJob,
  isReviewableJob,
  isRetryableJob,
  jobProgressFraction,
  sortImportJobsForDisplay,
  type ImportJob,
} from '../importJobs';

function job(overrides: Partial<ImportJob> & Pick<ImportJob, 'id' | 'status'>): ImportJob {
  return {
    pagesDone: 0,
    pagesTotal: null,
    fileName: 'settlement.pdf',
    mediaType: 'application/pdf',
    errorMessage: null,
    errorStep: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('job lifecycle status checks', () => {
  it('queued and processing are active; ready and failed are not', () => {
    expect(isActiveJob(job({ id: '1', status: 'queued' }))).toBe(true);
    expect(isActiveJob(job({ id: '1', status: 'processing' }))).toBe(true);
    expect(isActiveJob(job({ id: '1', status: 'ready' }))).toBe(false);
    expect(isActiveJob(job({ id: '1', status: 'failed' }))).toBe(false);
  });

  it('only a failed job is retryable', () => {
    expect(isRetryableJob(job({ id: '1', status: 'failed' }))).toBe(true);
    expect(isRetryableJob(job({ id: '1', status: 'queued' }))).toBe(false);
    expect(isRetryableJob(job({ id: '1', status: 'processing' }))).toBe(false);
    expect(isRetryableJob(job({ id: '1', status: 'ready' }))).toBe(false);
  });

  it('only a ready job is reviewable', () => {
    expect(isReviewableJob(job({ id: '1', status: 'ready' }))).toBe(true);
    expect(isReviewableJob(job({ id: '1', status: 'failed' }))).toBe(false);
    expect(isReviewableJob(job({ id: '1', status: 'processing' }))).toBe(false);
  });
});

describe('QUEUEING: sortImportJobsForDisplay', () => {
  it('puts active jobs (queued/processing) ahead of terminal ones (ready/failed), regardless of age', () => {
    const old = job({ id: 'old-ready', status: 'ready', createdAt: '2026-08-20T00:00:00.000Z' });
    const recent = job({ id: 'recent-processing', status: 'processing', createdAt: '2026-08-24T00:00:00.000Z' });
    const result = sortImportJobsForDisplay([old, recent]);
    expect(result.map((j) => j.id)).toEqual(['recent-processing', 'old-ready']);
  });

  it('within the same active/terminal bucket, newest first', () => {
    const a = job({ id: 'a', status: 'processing', createdAt: '2026-08-24T10:00:00.000Z' });
    const b = job({ id: 'b', status: 'queued', createdAt: '2026-08-24T12:00:00.000Z' });
    const c = job({ id: 'c', status: 'processing', createdAt: '2026-08-24T08:00:00.000Z' });
    expect(sortImportJobsForDisplay([a, b, c]).map((j) => j.id)).toEqual(['b', 'a', 'c']);
  });

  it('multiple queued jobs behind one processing job all stay ordered correctly (real queueing scenario)', () => {
    const processing = job({ id: 'p', status: 'processing', createdAt: '2026-08-24T09:00:00.000Z' });
    const queued1 = job({ id: 'q1', status: 'queued', createdAt: '2026-08-24T09:05:00.000Z' });
    const queued2 = job({ id: 'q2', status: 'queued', createdAt: '2026-08-24T09:10:00.000Z' });
    const failedOld = job({ id: 'f', status: 'failed', createdAt: '2026-08-23T00:00:00.000Z' });
    const result = sortImportJobsForDisplay([failedOld, queued1, processing, queued2]);
    expect(result.map((j) => j.id)).toEqual(['q2', 'q1', 'p', 'f']);
  });

  it('does not mutate the input array', () => {
    const input = [job({ id: '1', status: 'ready' }), job({ id: '2', status: 'processing' })];
    const copy = [...input];
    sortImportJobsForDisplay(input);
    expect(input).toEqual(copy);
  });
});

describe('deriveChipSummary — priority: processing/queued > ready > failed > hidden', () => {
  it('returns hidden for an empty job list', () => {
    expect(deriveChipSummary([])).toEqual({ kind: 'hidden' });
  });

  it('surfaces a processing job even when ready/failed jobs also exist', () => {
    const processing = job({ id: 'p', status: 'processing' });
    const ready = job({ id: 'r', status: 'ready' });
    const failed = job({ id: 'f', status: 'failed' });
    const summary = deriveChipSummary([ready, failed, processing]);
    expect(summary).toMatchObject({ kind: 'processing', job: { id: 'p' } });
  });

  it('a queued (not yet processing) job also counts as "processing" for chip purposes, with a queuedCount', () => {
    const queued1 = job({ id: 'q1', status: 'queued' });
    const queued2 = job({ id: 'q2', status: 'queued' });
    const summary = deriveChipSummary([queued1, queued2]);
    expect(summary).toMatchObject({ kind: 'processing', queuedCount: 2 });
  });

  it('prefers an in-flight processing job over a merely-queued one as the headline job', () => {
    const queued = job({ id: 'q', status: 'queued' });
    const processing = job({ id: 'p', status: 'processing' });
    const summary = deriveChipSummary([queued, processing]);
    expect(summary).toMatchObject({ kind: 'processing', job: { id: 'p' } });
  });

  it('surfaces "ready" once nothing is still processing/queued', () => {
    const ready = job({ id: 'r', status: 'ready' });
    const failed = job({ id: 'f', status: 'failed' });
    const summary = deriveChipSummary([failed, ready]);
    expect(summary).toMatchObject({ kind: 'ready', job: { id: 'r' }, readyCount: 1 });
  });

  it('surfaces "failed" only when nothing is processing/queued/ready', () => {
    const failed = job({ id: 'f', status: 'failed' });
    expect(deriveChipSummary([failed])).toMatchObject({ kind: 'failed', job: { id: 'f' }, failedCount: 1 });
  });

  it('counts multiple ready/failed jobs correctly', () => {
    const ready1 = job({ id: 'r1', status: 'ready' });
    const ready2 = job({ id: 'r2', status: 'ready' });
    const summary = deriveChipSummary([ready1, ready2]);
    expect(summary).toMatchObject({ kind: 'ready', readyCount: 2 });
  });

  // RESUMING AFTER BACKGROUNDING (owner decision 2026-08-24, item 2) — the
  // whole point of a server-tracked job is that the client has NO state
  // of its own to lose. This proves deriveChipSummary is a pure function
  // of whatever the CURRENT poll returned — calling it again with a
  // freshly-changed snapshot (as if the server made real progress while
  // the screen was unmounted/the app was backgrounded) reflects the NEW
  // state completely, with no dependency on the previous call.
  it('reflects a fresh snapshot completely on the next call — no hidden state carried between calls', () => {
    const beforeBackgrounding = job({ id: 'j1', status: 'processing', pagesDone: 2, pagesTotal: 11 });
    const firstSummary = deriveChipSummary([beforeBackgrounding]);
    expect(firstSummary).toMatchObject({ kind: 'processing', job: { pagesDone: 2 } });

    // Simulate: app backgrounded, server kept working via waitUntil, user
    // reopens the app — a fresh poll returns the job now complete.
    const afterReopening = job({ id: 'j1', status: 'ready', pagesDone: 11, pagesTotal: 11 });
    const secondSummary = deriveChipSummary([afterReopening]);
    expect(secondSummary).toMatchObject({ kind: 'ready', job: { pagesDone: 11 } });

    // The first call's result is untouched by the second — genuinely two
    // independent, side-effect-free computations.
    expect(firstSummary).toMatchObject({ kind: 'processing', job: { pagesDone: 2 } });
  });
});

describe('jobProgressFraction', () => {
  it('returns null when pagesTotal is not known yet (job just queued)', () => {
    expect(jobProgressFraction({ pagesDone: 0, pagesTotal: null })).toBeNull();
  });

  it('returns null when pagesTotal is 0 (defensive — should not happen for a real document)', () => {
    expect(jobProgressFraction({ pagesDone: 0, pagesTotal: 0 })).toBeNull();
  });

  it('computes a plain fraction', () => {
    expect(jobProgressFraction({ pagesDone: 4, pagesTotal: 11 })).toBeCloseTo(4 / 11, 5);
  });

  it('clamps to 1 even if pagesDone somehow exceeds pagesTotal (a transient mid-update read)', () => {
    expect(jobProgressFraction({ pagesDone: 12, pagesTotal: 11 })).toBe(1);
  });

  it('clamps to 0 for a negative pagesDone (defensive)', () => {
    expect(jobProgressFraction({ pagesDone: -1, pagesTotal: 11 })).toBe(0);
  });
});
