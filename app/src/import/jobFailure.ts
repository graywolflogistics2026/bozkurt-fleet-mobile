// FAILURE SCREENS ARE NEVER GENERIC (owner decision 2026-11-03). Every
// "could not read" a job shows says WHY: the failing check with its printed
// and read values, or "Page N could not be read: <cause>" from the job's
// stored page results, or "Server answer missing: <field>" when the server
// sent no reason at all. Pure: the jobs list row, the import screen's
// COULD NOT READ card and the Send report all build their lines here.
//
// A job whose server status is 'ready' is FAILED only when its stored
// verdict says failed_final. A ready job without a verdict is "Finishing
// up" (the app keeps posting the verdict), never "could not read".
import { GATE_FAIL_REASON_KEY, type GateFailReason } from './settlementGate';
import { finalStateOf, isReadyToReview, type ImportJob, type JobReviewDetail } from './importJobs';

export type JobRowState = 'reading' | 'finishing' | 'ready' | 'failed';

export function jobRowState(job: Pick<ImportJob, 'id' | 'status' | 'review'> & Partial<Pick<ImportJob, 'completedAt' | 'updatedAt'>>): JobRowState {
  if (job.status === 'failed') return 'failed';
  if (job.status !== 'ready') return 'reading';
  const final = finalStateOf(job);
  if (final === 'failed_final') return 'failed';
  if (final === 'ready_final') return isReadyToReview(job) ? 'ready' : 'finishing';
  return 'finishing';
}

export type JobFailureInfo = {
  // The failing checks, each with the printed and the read value.
  details: JobReviewDetail[];
  // Pages that could not be read, with the cause code (unreadable, timeout, ...).
  pages: { page: number; kind: string | null; type: string }[];
  // Why the job stopped reading again: same_values | read_cap | not_rereadable.
  stop: string | null;
  gateReason: string | null;
  // Set only when the server sent no reason at all: the field that is missing.
  missing: string | null;
};

type FailureInput = Pick<ImportJob, 'status' | 'review' | 'progress' | 'errorPage' | 'errorStep'>;

export function jobFailureInfo(job: FailureInput | null | undefined): JobFailureInfo {
  if (!job) return { details: [], pages: [], stop: null, gateReason: null, missing: 'import_jobs row' };
  const final = job.review?.final ?? null;
  const details = final?.details ?? [];
  const pageMap = new Map<number, { page: number; kind: string | null; type: string }>();
  for (const f of job.progress?.failed ?? []) {
    // The exact model outcome (parse_failed, truncated, ...) when stored.
    if (Number.isInteger(f.page)) pageMap.set(f.page, { page: f.page, kind: f.kind ?? null, type: f.detail || f.type || 'unknown_cause' });
  }
  if (job.status === 'failed' && typeof job.errorPage === 'number' && !pageMap.has(job.errorPage)) {
    pageMap.set(job.errorPage, { page: job.errorPage, kind: null, type: job.errorStep ?? 'error_step=null' });
  }
  const pages = [...pageMap.values()].sort((a, b) => a.page - b.page);
  const stop = final?.state === 'failed_final' && final.reason && final.reason !== 'pass' ? final.reason : null;
  const gateReason = final?.gateReason ?? null;
  let missing: string | null = null;
  if (details.length === 0 && pages.length === 0 && !gateReason) {
    if (job.status === 'failed') missing = job.errorStep ? null : 'error_step';
    else if (!final) missing = 'review.final';
    else missing = 'review.final.details';
  }
  return { details, pages, stop, gateReason, missing };
}

type T = (key: string, opts?: Record<string, unknown>) => string;

const STOP_KEY: Record<string, string> = {
  same_values: 'importFlow.stoppedSameValues',
  read_cap: 'importFlow.stoppedReadCap',
  not_rereadable: 'importFlow.stoppedNotRereadable',
  page_failed: 'importFlow.stoppedPageFailed',
};

// One failing check as a line. A page that could not be read (check
// 'page', printed = the page, read = the cause code) says so in words.
export function failDetailLine(d: { check: string; printed: number | string; read: number | string }, t: T, value: (v: number | string) => string = (v) => String(v)): string {
  if (d.check === 'page') return t('importFlow.pageFailed', { page: d.printed, cause: t(`importFlow.pageCause.${d.read}`, { defaultValue: String(d.read) }) });
  return t('importFlow.failDetail', { check: t(`importFlow.checkName.${d.check}`, { defaultValue: d.check }), printed: value(d.printed), read: value(d.read) });
}

// The pages a "Read page N again" button reads: the content pages that
// failed, from the gate details or the job's own failed pages.
export function failedPagesToReadAgain(details: { check: string; printed: number | string }[] | null | undefined, info: Pick<JobFailureInfo, 'pages'> | null): number[] {
  const fromDetails = (details ?? []).filter((d) => d.check === 'page' && Number.isInteger(d.printed)).map((d) => d.printed as number);
  const pages = fromDetails.length > 0 ? fromDetails : (info?.pages ?? []).map((p) => p.page);
  return [...new Set(pages)].sort((a, b) => a - b);
}

// A failure card's lines are never empty: with nothing else, the line says
// which server field was missing.
export function ensureReasonLines(lines: string[], t: T, field: string): string[] {
  return lines.length > 0 ? lines : [t('importFlow.serverAnswerMissing', { field })];
}

// The Send report for a failed job row: title, reason lines, the last
// re-read triggers, the job's status/pages and the build line. Codes,
// checks and page numbers only — never a file name or error message.
export function jobFailureReport(
  job: Pick<ImportJob, 'status' | 'pagesDone' | 'pagesTotal' | 'createdAt'>,
  title: string,
  lines: string[],
  triggerLines: string[],
  buildLine: string
): string {
  return [
    title,
    ...lines,
    ...triggerLines,
    `Job: ${job.status} · ${job.pagesDone}/${job.pagesTotal ?? '?'} pages · ${job.createdAt.slice(0, 16).replace('T', ' ')}`,
    `Build: ${buildLine}`,
  ].join('\n');
}

// The reason lines, never empty.
export function jobFailureLines(
  info: JobFailureInfo,
  t: T,
  value: (v: number | string) => string = (v) => String(v),
  errorStep: string | null = null
): string[] {
  const lines: string[] = [];
  if (info.gateReason && info.gateReason in GATE_FAIL_REASON_KEY && info.details.length === 0) {
    lines.push(t(GATE_FAIL_REASON_KEY[info.gateReason as GateFailReason]));
  }
  for (const d of info.details) lines.push(failDetailLine(d, t, value));
  const detailPages = new Set(info.details.filter((d) => d.check === 'page').map((d) => d.printed));
  for (const p of info.pages) {
    if (detailPages.has(p.page)) continue;
    lines.push(t('importFlow.pageFailed', { page: p.page, cause: t(`importFlow.pageCause.${p.type}`, { defaultValue: p.type }) }));
  }
  if (info.stop && STOP_KEY[info.stop]) lines.push(t(STOP_KEY[info.stop]));
  if (lines.length === 0 && errorStep) lines.push(t('importFlow.jobErrorStep', { step: errorStep }));
  if (lines.length === 0) lines.push(t('importFlow.serverAnswerMissing', { field: info.missing ?? 'reason' }));
  return lines;
}
