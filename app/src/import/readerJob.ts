// THE APP'S VIEW OF A SETTLEMENT-READER JOB (owner decision 2026-11-13,
// docs/decisions/settlement-reader-2026-11.md). The SERVER decides the
// job's state and persists it in import_jobs.progress.reader; the app only
// renders it. Four states: reading, ready, needs_input, failed.
//   - ready and needs_input both open the Check and certify card (the card
//     asks the profit lines; the answers go to the server, mode
//     read_answer).
//   - failed shows the reason, [Read again] while content reads remain
//     (max 2, counted by the server) and [Send report].
//   - A job without a reader (written by the old page-by-page reader) is
//     shown failed ("read with the old reader") with [Read again], which
//     starts a NEW job from the same stored file.
// Pure: no network, react-query or i18n (the caller passes t()).
import { MAX_CONTENT_READS, canReadAgain, chargedReads, pendingAttachments, type ReaderFailure, type ReaderProgress } from '@/src/settlementReader/machine';
import { RANGE_WINDOW_PAGES } from '@/src/settlementReader/range';
import { gateFailureLines } from './gateFailureText';
import { costByRole, totalCost } from '@/src/settlementReader/cost';
import { GATE_FAIL_REASON_KEY, type GateFailReason } from './settlementGate';
import { formatPageList, type ImportJob } from './importJobs';

export { MAX_CONTENT_READS };

// A job row that never got its reader written: the server refused the
// start (daily limit, allowance, file size, page count, damaged PDF).
export type StartRefused = { reason: 'start_refused'; step: string | null };
export type ReaderJobFailure = ReaderFailure | StartRefused;

export type ReaderJobView =
  | { state: 'reading'; again: boolean; readNo: number }
  | { state: 'ready'; needsInput: boolean }
  // reads = the reads that count against the owner's 2 (failures that are
  // ours do not); pages = where the statement was looked for ("4–5").
  | { state: 'failed'; failure: ReaderJobFailure; reads: number; readAgain: 'same_job' | 'new_job' | null; sameResult: boolean; pages?: string | null; rangePages?: string | null };

type JobInput = Pick<ImportJob, 'id' | 'status' | 'updatedAt'> &
  Partial<Pick<ImportJob, 'reader' | 'storagePath' | 'mediaType' | 'completedAt' | 'heartbeatAt' | 'progress' | 'errorStep'>>;

// "Read again" this app asked for: a cached row from before it is stale.
const readAgainAt = new Map<string, string>();
export function markReaderReadAgain(jobId: string, atIso: string = new Date().toISOString()): void {
  readAgainAt.set(jobId, atIso);
}
export function clearReaderReadAgain(jobId: string): void {
  readAgainAt.delete(jobId);
}

// No sign of life for this long = the worker stopped; the app asks the
// server to continue (the server's own next-run request is the normal path).
export const READER_RESUME_AFTER_MS = 3 * 60 * 1000;
// An old-reader job still marked running after this long is abandoned.
export const OLD_JOB_ABANDONED_AFTER_MS = 10 * 60 * 1000;

const ACTIVE = new Set(['queued', 'processing', 'paused', 'waiting_to_retry']);

function lastSignOfLifeMs(job: JobInput): number {
  const hb = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : NaN;
  const up = new Date(job.updatedAt).getTime();
  return Math.max(Number.isFinite(hb) ? hb : 0, Number.isFinite(up) ? up : 0);
}

function finishedBefore(job: JobInput, notBefore: string | null | undefined): boolean {
  if (!notBefore) return false;
  const finished = job.completedAt ?? job.updatedAt ?? null;
  return !finished || new Date(finished).getTime() < new Date(notBefore).getTime();
}

// The last two reads gave the identical result (the server stopped at once).
function stoppedOnSameResult(r: ReaderProgress): boolean {
  const signed = r.reads.filter((x) => x.signature);
  if (signed.length < 2) return false;
  return signed[signed.length - 1].signature === signed[signed.length - 2].signature;
}

export function readerJobView(job: JobInput, nowIso: string, opts: { notBefore?: string | null } = {}): ReaderJobView {
  const r = job.reader ?? null;
  const notBefore = opts.notBefore ?? readAgainAt.get(job.id) ?? null;
  if (!r) {
    // Just inserted (the reader is written a moment later), or an old job
    // still running: reading. Otherwise failed.
    if (ACTIVE.has(job.status) && new Date(nowIso).getTime() - lastSignOfLifeMs(job) <= OLD_JOB_ABANDONED_AFTER_MS) {
      return { state: 'reading', again: false, readNo: 1 };
    }
    const refused = job.status === 'failed' && job.progress == null;
    const isPdf = (job.mediaType ?? '').includes('pdf');
    return {
      state: 'failed',
      failure: refused ? { reason: 'start_refused', step: job.errorStep ?? null } : { reason: 'old_reader' },
      reads: 0,
      readAgain: !refused && job.storagePath && isPdf ? 'new_job' : null,
      sameResult: false,
    };
  }
  if (r.state === 'reading' || ((r.state === 'ready' || r.state === 'needs_input' || r.state === 'failed') && finishedBefore(job, notBefore))) {
    return { state: 'reading', again: r.readsStarted >= 2, readNo: Math.max(1, r.readsStarted) };
  }
  if (r.state === 'ready' || r.state === 'needs_input') return { state: 'ready', needsInput: r.state === 'needs_input' };
  const range = r.range;
  const statementPages = range ? formatPageList(Array.from({ length: range.lastContentPage - (range.statementFirst ?? 1) + 1 }, (_, i) => (range.statementFirst ?? 1) + i)) : null;
  return {
    state: 'failed',
    failure: r.failure ?? { reason: 'model_failed' },
    reads: chargedReads(r),
    pages: statementPages,
    rangePages: formatPageList(Array.from({ length: Math.max(1, Math.min(r.pagesTotal, RANGE_WINDOW_PAGES)) }, (_, i) => i + 1)),
    readAgain: canReadAgain(r) ? 'same_job' : null,
    sameResult: stoppedOnSameResult(r),
  };
}

// Work still expected on the server: reading, or attachment pages left.
export function hasReaderWork(job: JobInput): boolean {
  const r = job.reader ?? null;
  if (!r) return ACTIVE.has(job.status);
  return r.state === 'reading' || pendingAttachments(r).length > 0;
}

export function readerShouldResume(job: JobInput, nowIso: string): boolean {
  if (!job.reader || !hasReaderWork(job)) return false;
  return new Date(nowIso).getTime() - lastSignOfLifeMs(job) > READER_RESUME_AFTER_MS;
}

export type ReaderChipSummary =
  | { kind: 'hidden' }
  | { kind: 'processing'; job: ImportJob }
  | { kind: 'ready'; job: ImportJob; readyCount: number }
  | { kind: 'failed'; job: ImportJob; failedCount: number };

// Priority: reading > ready to check > could not read > nothing.
export function readerChipSummary(jobs: ImportJob[], nowIso: string): ReaderChipSummary {
  const views = jobs.map((job) => ({ job, view: readerJobView(job, nowIso) }));
  const reading = views.filter((v) => v.view.state === 'reading');
  const ready = views.filter((v) => v.view.state === 'ready');
  const failed = views.filter((v) => v.view.state === 'failed');
  if (reading.length > 0) return { kind: 'processing', job: reading[0].job };
  if (ready.length > 0) return { kind: 'ready', job: ready[0].job, readyCount: ready.length };
  if (failed.length > 0) return { kind: 'failed', job: failed[0].job, failedCount: failed.length };
  return { kind: 'hidden' };
}

type T = (key: string, opts?: Record<string, unknown>) => string;

export const READER_REASON_KEY: Record<string, string> = {
  range_not_found: 'importFlow.reader.reason.rangeNotFound',
  model_failed: 'importFlow.reader.reason.modelFailed',
  same_result: 'importFlow.reader.reason.sameResult',
  old_reader: 'importFlow.reader.reason.oldReader',
  too_many_runs: 'importFlow.reader.reason.tooManyRuns',
  start_refused: 'importFlow.reader.reason.startRefused',
};

// The reason lines of a failed job, never empty: the reason, the failing
// check with its printed and read values, the model's error, and why it
// stopped.
export function readerFailureLines(view: Extract<ReaderJobView, { state: 'failed' }>, t: T, value: (v: number | string) => string = (v) => String(v)): string[] {
  const f = view.failure;
  const lines: string[] = [];
  if (f.reason in GATE_FAIL_REASON_KEY) lines.push(t(GATE_FAIL_REASON_KEY[f.reason as GateFailReason]));
  else lines.push(t(READER_REASON_KEY[f.reason] ?? 'importFlow.serverAnswerMissing', { field: 'reason', step: f.reason === 'start_refused' ? (f as StartRefused).step ?? '—' : undefined }));
  if (f.reason !== 'start_refused') {
    const rf = f as ReaderFailure;
    if (f.reason in GATE_FAIL_REASON_KEY) {
      // NEVER GENERIC (owner 2026-11-13): every label not read with its
      // pages, every failing check with printed vs read, every date problem.
      const details = rf.details ?? (rf.check && rf.printed != null && rf.read != null ? [{ check: rf.check, printed: rf.printed, read: rf.read }] : []);
      lines.push(...gateFailureLines({ reason: f.reason, failures: rf.failures, details }, t, value, view.pages ?? null));
    } else if (f.reason === 'range_not_found') {
      lines.push(t('importFlow.reader.rangeLine', { pages: view.rangePages ?? '1' }));
    }
    if (rf.error) lines.push(t('importFlow.reader.modelError', { error: t(`importFlow.reader.error.${rf.error}`, { defaultValue: rf.error }) }));
  }
  if (view.sameResult) lines.push(t('importFlow.reader.stoppedSame'));
  if (view.reads >= MAX_CONTENT_READS && view.readAgain == null && f.reason !== 'old_reader') lines.push(t('importFlow.reader.readsUsed', { max: MAX_CONTENT_READS }));
  return lines;
}

const usd = (n: number) => `$${n.toFixed(4)}`;

// The job's lines for Send report and Diagnostics: state, reads, reason,
// cost per role, attachments. Codes and numbers only — never a file name.
export function readerReportLines(job: Pick<ImportJob, 'status' | 'createdAt'> & Partial<Pick<ImportJob, 'reader' | 'errorStep'>>): string[] {
  const r = job.reader ?? null;
  if (!r) return [`Reader: none (old reader) · status ${job.status}${job.errorStep ? ` · step ${job.errorStep}` : ''} · ${job.createdAt.slice(0, 16).replace('T', ' ')}`];
  const lines = [`Reader: ${r.state} · step ${r.step} · reads ${r.readsStarted}/${MAX_CONTENT_READS} · runs ${r.runs} · pages ${r.pagesTotal} · ${job.createdAt.slice(0, 16).replace('T', ' ')}`];
  if (r.range) lines.push(`Range: content 1-${r.range.lastContentPage} · attachments ${r.attachments.done.length} read, ${r.attachments.failed.length} failed of ${r.attachments.total}${r.attachments.notRead ? `, ${r.attachments.notRead} not read` : ''}`);
  for (const read of r.reads) lines.push(`Read ${read.n}: ${read.outcome}${read.reason ? ` (${read.reason})` : ''}${read.signature ? ` · ${read.signature}` : ''}`);
  if (r.failure) {
    const f = r.failure;
    lines.push(`Failure: ${f.reason}${f.check ? ` · ${f.check} printed ${f.printed ?? '?'} read ${f.read ?? '?'}` : ''}${f.error ? ` · ${f.error}` : ''}`);
  }
  for (const row of costByRole(r.cost)) lines.push(`Cost ${row.role}: ${row.calls} call(s) · ${row.inputTokens} in / ${row.outputTokens} out · ${usd(row.usd)}`);
  if (r.cost.length > 0) lines.push(`Cost total: ${usd(totalCost(r.cost))}`);
  return lines;
}
