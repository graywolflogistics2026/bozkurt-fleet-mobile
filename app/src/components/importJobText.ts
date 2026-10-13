import type { TFunction } from 'i18next';
import { formatElapsed, type ImportJob, type ImportJobProgress, type JobProgressView } from '@/src/import/importJobs';

// RESUMABLE IMPORT JOBS (owner decision 2026-10-13): the words for a job's
// progress, shared by the jobs list and the persistent chip so both always
// say the same thing ("Reading settlement page 3 of 6 · 12 attachments
// queued · 1:42", "Interrupted at page 3", "Page 9 of 17 (operating
// statement), run 2: the AI took longer than 100 s").

const PAGE_KINDS = ['settlement', 'statement', 'toll_bill', 'repair_invoice', 'delivery_receipt', 'fuel_receipt', 'other', 'unknown'];
const CAUSES = ['timeout', 'cut_off', 'busy', 'unreadable', 'refused', 'service', 'worker_stopped'];

export function pageKindLabel(kind: string, t: TFunction): string {
  return t(`importJobs.pageKind.${PAGE_KINDS.includes(kind) ? kind : 'unknown'}`);
}

export function jobFailureText(failure: ImportJobProgress['failed'][number], totalPages: number, t: TFunction): string {
  const cause = CAUSES.includes(failure.type) ? failure.type : 'service';
  return t('importJobs.failure.page', {
    page: failure.page,
    total: totalPages,
    kind: pageKindLabel(failure.kind, t),
    run: failure.run,
    cause: t(`importJobs.cause.${cause}`, { seconds: failure.timeoutMs ? Math.round(failure.timeoutMs / 1000) : 100 }),
  });
}

export function jobProgressText(view: JobProgressView, t: TFunction): string {
  switch (view.state) {
    case 'starting':
      return t('importJobs.progress.starting', { elapsed: formatElapsed(view.elapsedSec) });
    case 'whole':
      return t('importJobs.progress.whole', { total: view.totalPages, elapsed: formatElapsed(view.elapsedSec) });
    case 'classifying':
      return t('importJobs.progress.classifying', { total: view.totalPages, elapsed: formatElapsed(view.elapsedSec) });
    case 'reading':
      return view.attachmentsQueued > 0 && view.role === 'content'
        ? t('importJobs.progress.readingWithQueue', {
            kind: pageKindLabel(view.kind, t),
            position: view.position,
            total: view.total,
            queued: view.attachmentsQueued,
            elapsed: formatElapsed(view.elapsedSec),
          })
        : t('importJobs.progress.reading', { kind: pageKindLabel(view.kind, t), position: view.position, total: view.total, elapsed: formatElapsed(view.elapsedSec) });
    case 'attachments':
      return t('importJobs.progress.attachments', { done: view.done, total: view.done + view.queued, elapsed: formatElapsed(view.elapsedSec) });
    case 'between_runs':
      return t('importJobs.progress.betweenRuns', { done: view.contentDone, total: view.contentTotal, elapsed: formatElapsed(view.elapsedSec) });
    case 'waiting':
      return t('importJobs.progress.waiting', { elapsed: formatElapsed(view.elapsedSec) });
    case 'question':
      return t('importJobs.progress.question', { total: view.totalPages, cap: view.cap });
    case 'interrupted':
      return view.page != null ? t('importJobs.progress.interrupted', { page: view.page }) : t('importJobs.progress.interruptedNoPage');
    case 'ready':
      return view.attachmentsQueued > 0 ? t('importJobs.progress.readyAttachmentsQueued', { count: view.attachmentsQueued }) : t('importJobs.status.ready');
    case 'failed':
      return view.failure ? jobFailureText(view.failure, view.totalPages, t) : t('importJobs.genericFailure');
  }
}

export function jobStatusLabel(job: ImportJob, view: JobProgressView, t: TFunction): string {
  if (view.state === 'interrupted') return t('importJobs.status.interrupted');
  switch (job.status) {
    case 'waiting_to_retry':
      return t('importJobs.status.waitingToRetry');
    case 'needs_decision':
      return t('importJobs.status.needsDecision');
    case 'paused':
      return t('importJobs.status.processing');
    default:
      return t(`importJobs.status.${job.status}`);
  }
}
