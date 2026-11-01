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
// 'paused' (between two server runs of one job) and 'needs_decision' ("This
// file has N pages. Read the first 40 now?") — RESUMABLE IMPORT JOBS, owner
// decision 2026-10-13, docs/PENDING_SQL.md §78.
export type ImportJobStatus = 'queued' | 'processing' | 'paused' | 'waiting_to_retry' | 'needs_decision' | 'ready' | 'failed';

// What the server writes to import_jobs.progress on every page start and
// finish (supabase/functions/ai-import/jobEngine.ts buildProgress()). Null
// for a job started before §78.
export type ImportJobProgress = {
  phase: 'start' | 'whole' | 'classify' | 'pages' | 'awaiting_decision' | 'done' | 'failed';
  run: number;
  totalPages: number;
  contentTotal: number;
  contentDone: number;
  contentFailed: number;
  current: { page: number; kind: string; role: 'content' | 'attachment' | 'stored'; position: number }[];
  resumePage: number | null;
  attachmentsQueued: number;
  attachmentsDone: number;
  storedPages: number[];
  failed: { page: number; kind: string; type: string; run: number; timeoutMs?: number }[];
  question: { kind: 'page_cap'; totalPages: number; cap: number } | null;
  startedAt: string;
  readyAt: string | null;
};

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
  // RESUMABLE IMPORT JOBS (§78) — absent/null before §78 runs.
  progress?: ImportJobProgress | null;
  heartbeatAt?: string | null;
  errorPage?: number | null;
  // Set once the week was saved while attachment pages were still being read.
  documentId?: string | null;
};

export function isActiveJob(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'processing' || job.status === 'paused' || job.status === 'waiting_to_retry';
}

// ---------------------------------------------------------------------
// RESUMABLE IMPORT JOBS (owner decision 2026-10-13, 17-page stall
// redesign): heartbeat, "Interrupted at page N - Resume", progress text.
// ---------------------------------------------------------------------

// The server updates the job's heartbeat at every page start/finish and
// every 20 s during a model call. No heartbeat for 2 minutes = the worker
// was stopped (for example by the platform's 150 s limit): the row says
// "Interrupted at page N - Resume from page N" instead of "processing".
export const INTERRUPTED_AFTER_MS = 2 * 60 * 1000;
// The app resumes an interrupted job by itself after 3 minutes (the
// server's own next-run request is the normal path; this is the backup).
export const AUTO_RESUME_AFTER_MS = 3 * 60 * 1000;

function lastSignOfLifeMs(job: Pick<ImportJob, 'heartbeatAt' | 'updatedAt'>): number {
  const hb = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : NaN;
  const up = new Date(job.updatedAt).getTime();
  return Math.max(Number.isFinite(hb) ? hb : 0, Number.isFinite(up) ? up : 0);
}

// Work is still expected on this job: an active status, or a ready job
// whose attachment pages are still being read in the background.
export function hasPendingWork(job: Pick<ImportJob, 'status' | 'progress'>): boolean {
  if (isActiveJob(job)) return true;
  return job.status === 'ready' && (job.progress?.attachmentsQueued ?? 0) > 0;
}

export function isInterruptedJob(
  job: Pick<ImportJob, 'status' | 'progress' | 'heartbeatAt' | 'updatedAt'>,
  nowIso: string,
  afterMs: number = INTERRUPTED_AFTER_MS
): boolean {
  if (!hasPendingWork(job) || job.status === 'waiting_to_retry') return false;
  return new Date(nowIso).getTime() - lastSignOfLifeMs(job) > afterMs;
}

export function shouldAutoResume(job: Pick<ImportJob, 'status' | 'progress' | 'heartbeatAt' | 'updatedAt'>, nowIso: string): boolean {
  return isInterruptedJob(job, nowIso, AUTO_RESUME_AFTER_MS);
}

// The page a resume starts from: the server's own answer, else the first
// failed page, else the page that was being read.
export function resumeFromPage(job: Pick<ImportJob, 'progress' | 'errorPage'>): number | null {
  const p = job.progress;
  return p?.resumePage ?? job.errorPage ?? p?.failed[0]?.page ?? p?.current[0]?.page ?? null;
}

// A structured description of where a job is — the screen turns it into
// text with t(); kept pure so every state is unit-tested.
export type JobProgressView =
  | { state: 'starting'; elapsedSec: number }
  | { state: 'whole'; totalPages: number; elapsedSec: number }
  | { state: 'classifying'; totalPages: number; elapsedSec: number }
  | { state: 'reading'; kind: string; role: 'content' | 'attachment'; position: number; total: number; attachmentsQueued: number; elapsedSec: number }
  | { state: 'attachments'; done: number; queued: number; elapsedSec: number }
  | { state: 'between_runs'; contentDone: number; contentTotal: number; attachmentsQueued: number; elapsedSec: number }
  | { state: 'waiting'; elapsedSec: number }
  | { state: 'question'; totalPages: number; cap: number }
  | { state: 'interrupted'; page: number | null }
  | { state: 'ready'; attachmentsQueued: number; storedPages: number[]; failed: ImportJobProgress['failed'] }
  | { state: 'failed'; failure: ImportJobProgress['failed'][number] | null; totalPages: number; resumePage: number | null };

export function jobProgressView(job: ImportJob, nowIso: string): JobProgressView {
  const p = job.progress ?? null;
  const startedMs = new Date(job.createdAt).getTime();
  const endMs = p?.readyAt ? new Date(p.readyAt).getTime() : new Date(nowIso).getTime();
  const elapsedSec = Number.isFinite(startedMs) ? Math.max(0, Math.round((endMs - startedMs) / 1000)) : 0;
  if (job.status === 'failed') {
    const failure = p?.failed.find((f) => f.page === job.errorPage) ?? p?.failed[0] ?? null;
    return { state: 'failed', failure, totalPages: p?.totalPages ?? job.pagesTotal ?? 0, resumePage: resumeFromPage(job) };
  }
  if (job.status === 'needs_decision' && p?.question) return { state: 'question', totalPages: p.question.totalPages, cap: p.question.cap };
  if (isInterruptedJob(job, nowIso)) return { state: 'interrupted', page: resumeFromPage(job) };
  if (job.status === 'ready') {
    if ((p?.attachmentsQueued ?? 0) > 0 && p?.current.some((c) => c.role === 'attachment')) {
      return { state: 'attachments', done: p.attachmentsDone, queued: p.attachmentsQueued, elapsedSec };
    }
    return { state: 'ready', attachmentsQueued: p?.attachmentsQueued ?? 0, storedPages: p?.storedPages ?? [], failed: p?.failed ?? [] };
  }
  if (job.status === 'waiting_to_retry') return { state: 'waiting', elapsedSec };
  if (!p) return { state: 'starting', elapsedSec };
  if (p.phase === 'whole') return { state: 'whole', totalPages: p.totalPages, elapsedSec };
  if (p.phase === 'classify') return { state: 'classifying', totalPages: p.totalPages, elapsedSec };
  if (p.phase === 'start') return { state: 'starting', elapsedSec };
  const reading = p.current.find((c) => c.role !== 'stored');
  if (reading) {
    const isAttachment = reading.role === 'attachment';
    return {
      state: 'reading',
      kind: reading.kind,
      role: isAttachment ? 'attachment' : 'content',
      position: reading.position,
      total: isAttachment ? p.attachmentsDone + p.attachmentsQueued : p.contentTotal,
      attachmentsQueued: p.attachmentsQueued,
      elapsedSec,
    };
  }
  return { state: 'between_runs', contentDone: p.contentDone, contentTotal: p.contentTotal, attachmentsQueued: p.attachmentsQueued, elapsedSec };
}

// "7–10, 12" — consecutive pages collapsed into ranges.
export function formatPageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i];
    parts.push(end > start ? `${start}–${end}` : String(start));
  }
  return parts.join(', ');
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function isRetryableJob(job: Pick<ImportJob, 'status'>): boolean {
  return job.status === 'failed';
}

// READY TO REVIEW — ONE RULE (owner decision 2026-10-31, import
// reliability item 1). The chip, the notification, the jobs-list button,
// the import screen's follow effect and the fetch all decide "ready" here.
// Ready = the server finished the content pages and stored the merged
// reading (status 'ready', written together with result_json by
// jobEngine.ts finalizeReady); attachments and line pages never gate it.
// THE DEAD END THIS FIXES: after an automatic re-read the server clears
// result_json and sets the job back to 'queued', but the cached jobs list
// still says 'ready' until its refetch lands; the screen used to open that
// stale row, the fetch found no result and showed "This import isn't
// ready to review yet" with no way forward. A job a re-read was requested
// for is ready only once it completed AFTER that request.
const rereadRequestedAt = new Map<string, string>();

export function markRereadRequested(jobId: string, atIso: string = new Date().toISOString()): void {
  rereadRequestedAt.set(jobId, atIso);
}

export function clearRereadRequested(jobId: string): void {
  rereadRequestedAt.delete(jobId);
}

export type ReadinessInput = Pick<ImportJob, 'status'> & Partial<Pick<ImportJob, 'id' | 'completedAt' | 'updatedAt'>>;

export function isReadyToReview(
  job: ReadinessInput,
  opts: { notBefore?: string | null } = {}
): boolean {
  if (job.status !== 'ready') return false;
  const notBefore = opts.notBefore ?? (job.id ? rereadRequestedAt.get(job.id) : undefined) ?? null;
  if (!notBefore) return true;
  const finished = job.completedAt ?? job.updatedAt ?? null;
  return !!finished && new Date(finished).getTime() >= new Date(notBefore).getTime();
}

export function isReviewableJob(job: ReadinessInput): boolean {
  return isReadyToReview(job);
}

// UNAWAITED handleJobStart + EdgeRuntime.waitUntil WITHOUT A CAPABILITY
// CHECK (P1 fix, FULL SYSTEM AUDIT) — "surface stranded jobs to the user
// with a Retry." The server-side fix (a service-role client for
// runJobInBackground()'s own writes, supabase/functions/ai-import/index.ts)
// closes the MAIN way a job used to get stuck — but this is a client-side
// safety net for the remaining cases (the function's own hard wall-clock
// budget being exceeded before it can write anything, the whole isolate
// getting killed mid-job, a genuinely unreachable server for a while) —
// an ACTIVE job (queued/processing/waiting_to_retry) whose `updatedAt`
// hasn't moved in a long time is presumed abandoned. THRESHOLD_MS is set
// comfortably above the server's own JOB_HARD_BUDGET_MS (240s) with real
// margin for slow polling/clock skew, never so tight that a merely-slow
// (but still actually progressing) job gets flagged.
export const STRANDED_JOB_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export function isStrandedJob(job: Pick<ImportJob, 'status' | 'updatedAt'>, nowIso: string, thresholdMs: number = STRANDED_JOB_THRESHOLD_MS): boolean {
  if (!isActiveJob(job)) return false;
  const updatedAtMs = new Date(job.updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return false;
  return new Date(nowIso).getTime() - updatedAtMs > thresholdMs;
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
  | { kind: 'question'; job: ImportJob }
  | { kind: 'processing'; job: ImportJob; queuedCount: number }
  | { kind: 'ready'; job: ImportJob; readyCount: number }
  | { kind: 'failed'; job: ImportJob; failedCount: number };

export function deriveChipSummary(jobs: ImportJob[]): ChipSummary {
  // 'waiting_to_retry' (BATCH BACK-PRESSURE) folds into the same
  // 'processing' chip kind as 'processing' itself — from the user's own
  // perspective both mean "still working on it," just with a different
  // status label/note shown once they open the jobs list.
  const processing = jobs.filter((j) => j.status === 'processing' || j.status === 'paused' || j.status === 'waiting_to_retry');
  const queued = jobs.filter((j) => j.status === 'queued');
  const ready = jobs.filter((j) => isReadyToReview(j));
  const failed = jobs.filter((j) => j.status === 'failed');
  const question = jobs.find((j) => j.status === 'needs_decision');

  // Priority: a question waiting for the user > something actively
  // running > something ready to review > something that failed > nothing.
  if (question) return { kind: 'question', job: question };
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

// MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass) —
// how many files a single picker selection may enqueue at once. A single
// pick (the common case) always keeps using the pre-existing one-job flow
// unchanged; this only bounds a genuine multi-select.
export const MAX_BATCH_IMPORT_FILES = 10;

// The generic, order-preserving bounded-concurrency worker pool this app's
// server side already established for exactly this class of problem
// (supabase/functions/ai-import/chunking.ts's runWithConcurrencyLimit(),
// "controlled concurrency" — see CLAUDE.md's SPEED UP SETTLEMENT IMPORT
// entry) — this is the CLIENT-side counterpart, for starting several
// import_jobs at once without either (a) firing all N uploads/invocations
// simultaneously (real contention/rate-limit risk, the exact failure mode
// that pass's own history already worked through) or (b) waiting for each
// file fully sequentially (slow for a real 10-file batch). Pure and fully
// injectable — the actual async work (upload + invoke) is passed in, not
// imported here, so this is unit-testable without a live Supabase project.
// "A failed item never blocks the others" (spec item 5): each task's own
// outcome is captured independently via Promise.allSettled-style handling
// — one rejection never stops or skips any other task, and results always
// stay correctly paired with their own input item regardless of which
// order the concurrent tasks actually finish in.
export type BatchTaskOutcome<T, R> = { item: T; result?: R; error?: unknown };

export async function runBatchWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<BatchTaskOutcome<T, R>[]> {
  const results: BatchTaskOutcome<T, R>[] = new Array(items.length);
  let cursor = 0;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      try {
        const result = await task(item);
        results[index] = { item, result };
      } catch (error) {
        results[index] = { item, error };
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}

// BATCH REVIEW FLOW (owner decision, "Next/Skip without returning to the
// queue between each" pass) — pure "pop the next id off the queue" step so
// the screen's own advance-to-next-document logic is directly testable
// without mounting a real screen (this repo has no RN rendering harness).
export function nextBatchReviewStep(queue: string[]): { next: string | null; remaining: string[] } {
  if (queue.length === 0) return { next: null, remaining: [] };
  const [next, ...remaining] = queue;
  return { next, remaining };
}

// MULTI-FILE IMPORT ORDER vs DISPLAY ORDER (owner decision, device
// report: "importing up to 10 files at once can mix weeks in any order").
// The base entity lists (Settlements/Loads/Fuel/Maintenance/Tolls/
// Deductions/Documents) already sort by each row's OWN date column via
// entityHooks.ts's ORDER_COLUMN map, independent of upload/processing
// order — confirmed correct, unchanged by this pass. The one real gap:
// `handleReviewAll()` (app/(tabs)/import/jobs.tsx) used to build its
// `reviewJobIds` list straight from `readyJobs` — which is
// `sortImportJobsForDisplay()`'s own output, ordered by job CREATION time
// (when each upload/job was STARTED), not by the underlying document's
// own extracted date. With bounded concurrency, a job started 3rd can
// finish (and become 'ready') 1st, so start-time order and true
// chronological (document date) order routinely disagree.
//
// This pure sorter is the fix: given each READY job's own id + its
// extracted document date (fetched once the job's result_json exists,
// impure layer's job — src/data/importJobs.ts), it orders newest-first,
// matching every list's own convention. A job with no resolvable date
// (extraction failed to find one, or the fetch itself failed) sorts
// LAST, never first — never let an unknown date masquerade as "most
// recent." This runs ONLY over jobs already in a REVIEWABLE state
// (isReviewableJob() true) — a job still queued/processing has no
// result yet and is never part of this ordering decision at all.
export function sortJobIdsByDocumentDate(entries: Array<{ id: string; date: string | null }>): string[] {
  return [...entries]
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    })
    .map((e) => e.id);
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

// SIMPLE IMPORT FLOW (batch D2 2.4): after "Certify and add", a week's
// attachment pages keep being read in the background (cap 12). That job
// (document_id set by import_job_saved) is never reviewed and never
// re-saves the week — re-saving would clear its certification. Its
// readings are stored on the week's document (parsed_json, the audit
// trail) and the job row goes; a failure is dropped without a warning.
export function silentAttachmentStep(job: Pick<ImportJob, 'status' | 'documentId'>): 'store' | 'drop' | 'wait' | null {
  if (!job.documentId) return null;
  if (job.status === 'ready') return 'store';
  if (job.status === 'failed') return 'drop';
  return 'wait';
}

// What the owner sees for a job (batch D2 2.1): three states only.
export function simpleJobState(job: ReadinessInput): 'reading' | 'ready' | 'failed' {
  if (isReadyToReview(job)) return 'ready';
  if (job.status === 'failed') return 'failed';
  return 'reading';
}
