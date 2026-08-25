// BACKGROUND IMPORT (owner decision 2026-08-24) — pure lifecycle/display
// logic for import_jobs (docs/PENDING_SQL.md §54). Deliberately has ZERO
// network/react-query/i18n code — everything here is a plain function of
// its own inputs, same "pure function, caller owns i18n via t()" pattern
// as unlockNudgePresentation.ts/coachNudgeText. This is what makes
// "resuming after backgrounding" safe: there is no client-side state a
// screen unmount/app background could lose — every derived value (chip
// summary, sort order, progress fraction) is recomputed FROM SCRATCH from
// whatever the server's current row values are on the next poll,
// regardless of how much time passed or what happened while the client
// was away. The actual network layer (polling, upload, job-start/retry
// calls) lives in app/src/data/importJobs.ts, which is untestable here
// without a live Supabase project — this module is what carries the real
// test coverage for job lifecycle/queueing/retry logic.

// 'waiting_to_retry' (owner decision 2026-08-24, BATCH BACK-PRESSURE pass)
// — a job that hit a real Anthropic rate limit and is automatically
// backing off before its next attempt (server-side, ai-import's
// withRateLimitBackoff()) rather than being immediately marked failed. It
// is an ACTIVE status, not a terminal one — the job is still moving
// toward completion, just paused.
export type ImportJobStatus = 'queued' | 'processing' | 'waiting_to_retry' | 'ready' | 'failed';

export type ImportJob = {
  id: string;
  status: ImportJobStatus;
  pagesDone: number;
  pagesTotal: number | null;
  fileName: string | null;
  mediaType: string;
  errorMessage: string | null;
  errorStep: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function isActiveJob(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'processing' || job.status === 'waiting_to_retry';
}

export function isRetryableJob(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'failed';
}

export function isReviewableJob(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'ready';
}

// QUEUEING (owner decision 2026-08-24, item 4) — active jobs always float
// to the top regardless of age (the user cares most about "what's still
// running / needs my attention"); within each bucket, newest first.
export function sortImportJobsForDisplay(jobs: ImportJob[]): ImportJob[] {
  return [...jobs].sort((a, b) => {
    const aActive = isActiveJob(a) ? 0 : 1;
    const bActive = isActiveJob(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// Everything the persistent chip (rendered in the tab layout, always
// mounted) needs to decide what to show, computed once from the full
// jobs list — the UI component just renders this, never re-derives the
// "what matters most" priority logic itself. A ready/failed job stops
// appearing here once its row is gone (dismissed, or a retry moved it
// back to 'processing') — this module has no separate "seen" concept,
// the row's own presence/status IS the source of truth.
export type ChipSummary =
  | { kind: 'hidden' }
  | { kind: 'processing'; job: ImportJob; queuedCount: number }
  | { kind: 'ready'; job: ImportJob; readyCount: number }
  | { kind: 'failed'; job: ImportJob; failedCount: number };

export function deriveChipSummary(jobs: ImportJob[]): ChipSummary {
  // 'waiting_to_retry' (BATCH BACK-PRESSURE) folds into the same
  // 'processing' chip kind as 'processing' itself — from the user's own
  // perspective both mean "still working on it," just with a different
  // status label/note shown once they open the jobs list.
  const processing = jobs.filter((j) => j.status === 'processing' || j.status === 'waiting_to_retry');
  const queued = jobs.filter((j) => j.status === 'queued');
  const ready = jobs.filter((j) => j.status === 'ready');
  const failed = jobs.filter((j) => j.status === 'failed');

  // Priority: something actively running > something ready to review >
  // something that failed > nothing to show.
  if (processing.length > 0 || queued.length > 0) {
    const job = processing[0] ?? queued[0];
    return { kind: 'processing', job, queuedCount: queued.length };
  }
  if (ready.length > 0) {
    return { kind: 'ready', job: ready[0], readyCount: ready.length };
  }
  if (failed.length > 0) {
    return { kind: 'failed', job: failed[0], failedCount: failed.length };
  }
  return { kind: 'hidden' };
}

// COMPLETION MUST NEVER DEPEND ON AN OPTIONAL CAPABILITY (owner decision
// 2026-08-24, BACKGROUND IMPORT CRASH fix, hard rule) — a job's own
// completion is already fully derivable from its `import_jobs` row alone
// (deriveChipSummary above); a LOCAL NOTIFICATION is a convenience on top
// of that, never something the job's visibility can depend on. If the
// notification API isn't available in this build (native module not
// linked, Expo Go dropped support, permission machinery throws instead of
// just returning 'denied', ...) or any other optional side effect throws,
// that failure must never propagate to — let alone crash — the caller.
// Pure and injectable (the real async call is passed in, not imported
// here) so it's fully unit-testable without a real Expo/RN runtime: a
// throwing/rejecting/missing function all resolve cleanly.
export async function runOptionalSideEffect(fn: (() => Promise<void>) | null | undefined): Promise<void> {
  if (typeof fn !== 'function') return;
  try {
    await fn();
  } catch {
    // Swallowed on purpose — see header comment above.
  }
}

// null = no total known yet (job just queued, page count not determined)
// — the caller shows an indeterminate spinner rather than a fraction.
// Clamped to [0, 1] defensively — pagesDone should never exceed
// pagesTotal, but a transient mid-update read (the row updated pagesDone
// before pagesTotal on a fresh job, or vice versa) must never render a
// nonsensical >100% or negative bar.
export function jobProgressFraction(job: Pick<ImportJob, 'pagesDone' | 'pagesTotal'>): number | null {
  if (!job.pagesTotal || job.pagesTotal <= 0) return null;
  return Math.min(1, Math.max(0, job.pagesDone / job.pagesTotal));
}
