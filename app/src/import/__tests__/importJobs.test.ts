import {
  deriveChipSummary,
  isActiveJob,
  isReviewableJob,
  isRetryableJob,
  isStrandedJob,
  STRANDED_JOB_THRESHOLD_MS,
  jobProgressFraction,
  runOptionalSideEffect,
  runBatchWithConcurrency,
  nextBatchReviewStep,
  MAX_BATCH_IMPORT_FILES,
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

  // BATCH BACK-PRESSURE (owner decision 2026-08-24) — a job automatically
  // backing off from a rate limit is still actively moving toward
  // completion, not stuck or done.
  it('waiting_to_retry is active too', () => {
    expect(isActiveJob(job({ id: '1', status: 'waiting_to_retry' }))).toBe(true);
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

// UNAWAITED handleJobStart + EdgeRuntime.waitUntil WITHOUT A CAPABILITY
// CHECK (P1 fix, FULL SYSTEM AUDIT) — "surface stranded jobs to the user
// with a Retry." isStrandedJob() is the client-side safety net: an active
// job whose updatedAt hasn't moved in a long time is presumed abandoned.
describe('isStrandedJob (P1 fix, "surface stranded jobs with a Retry")', () => {
  it('a job updated moments ago is never stranded, regardless of active status', () => {
    const now = '2026-08-24T10:05:00.000Z';
    expect(isStrandedJob(job({ id: '1', status: 'processing', updatedAt: '2026-08-24T10:04:50.000Z' }), now)).toBe(false);
    expect(isStrandedJob(job({ id: '1', status: 'queued', updatedAt: '2026-08-24T10:04:50.000Z' }), now)).toBe(false);
    expect(isStrandedJob(job({ id: '1', status: 'waiting_to_retry', updatedAt: '2026-08-24T10:04:50.000Z' }), now)).toBe(false);
  });

  it('an active job with no progress well past the threshold IS stranded', () => {
    const staleUpdatedAt = '2026-08-24T10:00:00.000Z';
    const now = new Date(new Date(staleUpdatedAt).getTime() + STRANDED_JOB_THRESHOLD_MS + 60_000).toISOString();
    expect(isStrandedJob(job({ id: '1', status: 'processing', updatedAt: staleUpdatedAt }), now)).toBe(true);
    expect(isStrandedJob(job({ id: '1', status: 'queued', updatedAt: staleUpdatedAt }), now)).toBe(true);
    expect(isStrandedJob(job({ id: '1', status: 'waiting_to_retry', updatedAt: staleUpdatedAt }), now)).toBe(true);
  });

  it('a TERMINAL job (ready/failed) is never stranded, no matter how old', () => {
    const veryOld = '2020-01-01T00:00:00.000Z';
    const now = '2026-08-24T10:05:00.000Z';
    expect(isStrandedJob(job({ id: '1', status: 'ready', updatedAt: veryOld }), now)).toBe(false);
    expect(isStrandedJob(job({ id: '1', status: 'failed', updatedAt: veryOld }), now)).toBe(false);
  });

  it('respects a custom threshold', () => {
    const updatedAt = '2026-08-24T10:00:00.000Z';
    const now = '2026-08-24T10:02:00.000Z'; // 2 minutes later
    expect(isStrandedJob(job({ id: '1', status: 'processing', updatedAt }), now, 60_000)).toBe(true); // past a 1-min threshold
    expect(isStrandedJob(job({ id: '1', status: 'processing', updatedAt }), now, 5 * 60_000)).toBe(false); // within a 5-min threshold
  });

  it('an unparseable updatedAt never crashes and is treated as not-stranded', () => {
    expect(isStrandedJob(job({ id: '1', status: 'processing', updatedAt: 'not-a-date' }), '2026-08-24T10:05:00.000Z')).toBe(false);
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

  it('a waiting_to_retry job floats to the top like any other active job', () => {
    const oldReady = job({ id: 'old-ready', status: 'ready', createdAt: '2026-08-20T00:00:00.000Z' });
    const waiting = job({ id: 'waiting', status: 'waiting_to_retry', createdAt: '2026-08-24T00:00:00.000Z' });
    expect(sortImportJobsForDisplay([oldReady, waiting]).map((j) => j.id)).toEqual(['waiting', 'old-ready']);
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

  // BATCH BACK-PRESSURE (owner decision 2026-08-24) — a job automatically
  // backing off from a rate limit still folds into the same 'processing'
  // chip kind (from the user's own perspective it's still "working on
  // it") even though nothing is else queued/processing.
  it('a waiting_to_retry job surfaces as "processing" for chip purposes', () => {
    const waiting = job({ id: 'w', status: 'waiting_to_retry' });
    const ready = job({ id: 'r', status: 'ready' });
    const summary = deriveChipSummary([ready, waiting]);
    expect(summary).toMatchObject({ kind: 'processing', job: { id: 'w' } });
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

// BACKGROUND IMPORT CRASH FIX (owner decision 2026-08-24, device report:
// "undefined is not a function" on completion) — the actual root cause was
// downloadImportJobFileToLocal() calling Blob.arrayBuffer(), which React
// Native's built-in Blob never implements (fixed in src/data/importJobs.ts
// by switching to the same signed-URL + File.downloadFileAsync() pattern
// documentViewer.ts's shareDocumentFile() already uses in production — not
// unit-testable here since it needs a real Expo/RN runtime, same
// "network/file-system layer lives in src/data/, tested via its own
// pure-logic coverage here" split this file's own header comment
// describes). What IS fully unit-testable here, and is the actual HARD
// RULE this fix introduced: a job's completion must never depend on an
// OPTIONAL capability (a local notification, or any other convenience
// side effect) being available.
describe('runOptionalSideEffect', () => {
  it('resolves cleanly when the function is undefined (capability not available)', async () => {
    await expect(runOptionalSideEffect(undefined)).resolves.toBeUndefined();
  });

  it('resolves cleanly when the function is null', async () => {
    await expect(runOptionalSideEffect(null)).resolves.toBeUndefined();
  });

  it('resolves cleanly when the function throws synchronously', async () => {
    const throwing = () => {
      throw new TypeError('undefined is not a function');
    };
    await expect(runOptionalSideEffect(throwing as unknown as () => Promise<void>)).resolves.toBeUndefined();
  });

  it('resolves cleanly when the function returns a rejected promise', async () => {
    const rejecting = () => Promise.reject(new Error('native module not linked'));
    await expect(runOptionalSideEffect(rejecting)).resolves.toBeUndefined();
  });

  it('still actually calls and awaits a working function — this is not a no-op for the success path', async () => {
    let called = false;
    await runOptionalSideEffect(async () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

// "THE ORIGINATING SCREEN IS GONE" (owner decision 2026-08-24, requirement
// #3/#4) — a job is started by whatever screen called startBackgroundJob(),
// but its COMPLETION must be visible from a totally independent render:
// this simulates exactly that by never sharing any variable, ref, or
// closure between "screen A" (which only ever knew the job id at start
// time) and "screen B" (a fresh computation using nothing but a freshly
// polled jobs array) — proving deriveChipSummary has no hidden dependency
// on anything the originating screen held onto.
describe('completion is visible with zero dependency on the originating screen', () => {
  it('a job started by one (now-unmounted) screen surfaces correctly to a completely independent later computation', () => {
    // "Screen A" starts a job — all it ever has is the id; nothing else is
    // captured or passed forward.
    const startedJobId = 'job-from-screen-a';
    // Screen A unmounts here — nothing further ever runs on its behalf.

    // "Screen B" (could be the same screen remounted, a different screen,
    // or even a different app session after a restart) later polls
    // import_jobs and gets back a FRESH array it built with no knowledge
    // of screen A's own state — the only shared "state" is the server's.
    const polledJobs: ImportJob[] = [job({ id: startedJobId, status: 'ready', pagesDone: 11, pagesTotal: 11 })];
    const summary = deriveChipSummary(polledJobs);
    expect(summary).toMatchObject({ kind: 'ready', job: { id: startedJobId }, readyCount: 1 });
  });

  it('a failed job is equally visible with no dependency on the originating screen', () => {
    const startedJobId = 'job-from-screen-a';
    const polledJobs: ImportJob[] = [job({ id: startedJobId, status: 'failed', errorMessage: 'timeout' })];
    const summary = deriveChipSummary(polledJobs);
    expect(summary).toMatchObject({ kind: 'failed', job: { id: startedJobId }, failedCount: 1 });
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

// MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass) —
// item 6's own required test: "10 files enqueue and complete out of order
// without mixing results."
describe('runBatchWithConcurrency', () => {
  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runBatchWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('10 files enqueue and complete out of order without mixing results', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `file-${i}.pdf`);
    // Deliberately inverted delays — the LAST item resolves FIRST — to
    // prove the returned array stays keyed by each item's own original
    // position, never by completion order.
    const outcomes = await runBatchWithConcurrency(items, 4, async (name) => {
      const index = items.indexOf(name);
      await new Promise((r) => setTimeout(r, (items.length - index) * 2));
      return `job-id-for-${name}`;
    });
    expect(outcomes).toHaveLength(10);
    outcomes.forEach((o, i) => {
      expect(o.item).toBe(items[i]);
      expect(o.result).toBe(`job-id-for-${items[i]}`);
      expect(o.error).toBeUndefined();
    });
  });

  it('one failure never stops or skips any other task', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const outcomes = await runBatchWithConcurrency(items, 2, async (name) => {
      if (name === 'c') throw new Error('upload failed for c');
      return `ok-${name}`;
    });
    expect(outcomes.map((o) => o.result)).toEqual(['ok-a', 'ok-b', undefined, 'ok-d', 'ok-e']);
    expect(outcomes[2].error).toBeInstanceOf(Error);
    expect((outcomes[2].error as Error).message).toBe('upload failed for c');
    expect(outcomes.filter((o) => o.result != null)).toHaveLength(4);
  });

  it('handles an empty item list', async () => {
    await expect(runBatchWithConcurrency([], 3, async () => 'x')).resolves.toEqual([]);
  });

  it('a limit larger than the item count still runs every item exactly once', async () => {
    const items = [1, 2, 3];
    const outcomes = await runBatchWithConcurrency(items, 100, async (n) => n * 10);
    expect(outcomes.map((o) => o.result)).toEqual([10, 20, 30]);
  });
});

describe('nextBatchReviewStep (BATCH REVIEW FLOW pass)', () => {
  it('pops the next id off the front of the queue and returns the rest', () => {
    expect(nextBatchReviewStep(['a', 'b', 'c'])).toEqual({ next: 'a', remaining: ['b', 'c'] });
  });

  it('the last item leaves an empty remaining queue', () => {
    expect(nextBatchReviewStep(['only'])).toEqual({ next: 'only', remaining: [] });
  });

  it('an empty queue has nothing left to review', () => {
    expect(nextBatchReviewStep([])).toEqual({ next: null, remaining: [] });
  });

  it('does not mutate the input array', () => {
    const queue = ['a', 'b', 'c'];
    const copy = [...queue];
    nextBatchReviewStep(queue);
    expect(queue).toEqual(copy);
  });
});

describe('MAX_BATCH_IMPORT_FILES', () => {
  it('caps a single picker selection at 10', () => {
    expect(MAX_BATCH_IMPORT_FILES).toBe(10);
  });
});
