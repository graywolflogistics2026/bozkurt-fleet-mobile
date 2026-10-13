// RESUMABLE PAGE-BY-PAGE IMPORT JOBS (owner decision 2026-10-13, "17-page
// stall" redesign A-H + amendments + the scale-to-any-page-count add-on;
// docs/decisions/settlement-import-chunking.md, PENDING_SQL §78).
//
// Why: a 17-page Prime PDF stalled at "Page 2 of 17" four times in a row.
// The background job spent 120 s on a doomed whole-document call, then
// read pages in the leftover seconds until Supabase stopped the worker at
// its 150 s wall clock (Free plan) — no code ran after that, so the job
// was never marked failed, and every retry started again from page 1.
//
// This module is the job's decision logic, with ZERO Deno APIs and ZERO
// imports (same convention as chunking.ts) so the app's Jest suite can run
// it against a simulated clock, a fake model and a fake job row. index.ts
// supplies the real dependencies (Anthropic calls, pdf-lib, Supabase).
//
// Rules it enforces:
//   - Every step obeys ONE documented constant, the Free-plan wall clock
//     (150 s): a model call starts only if elapsed + its timeout + 15 s
//     <= 140 s, and the worker exits by 130 s. A job spans as many
//     invocations as it needs; each one claims a lease first, so two
//     chains (the worker's self-invoke and the app's restart) can never
//     run the same page twice.
//   - Each page's result is stored on the job row the moment it finishes
//     (bank digits removed first); a resumed job starts at the first page
//     without a stored result and never redoes a finished page.
//   - Whole-document reading only for PDFs of at most 8 pages and 8 MB; if
//     it times out, the page plan continues in a NEW invocation.
//   - Prime: a cheap classification call (windows of at most 20 pages /
//     8 MB, extended only until the statement boundary is found) decides
//     where the settlement + operating statement end. Pages up to that
//     boundary are always read, in physical order. Later toll bills and
//     repair invoices are read last (max 12) and never block the
//     settlement; delivery receipts and everything else stay stored,
//     unread, listed by page.
//   - No boundary (unknown carrier, classifier failed, no statement):
//     physical order, one page per call, at most 40 pages — above that
//     the user is asked first; unread pages are listed, never dropped.

// ---------------------------------------------------------------------
// Limits (one documented constant; everything else derives from it)
// ---------------------------------------------------------------------

// Supabase Edge Functions: a worker may run 150 s on the Free plan (400 s
// on paid plans) — supabase.com/docs/guides/functions/limits. The owner's
// org is on Free; index.ts reads AI_IMPORT_WALL_CLOCK_MS only as an
// explicit plan setting and otherwise uses this.
export const FREE_PLAN_WALL_CLOCK_MS = 150_000;

export type StepLimits = {
  wallClockMs: number;
  // A model call must END by this point (wall clock - 10 s).
  callEndLimitMs: number;
  // Headroom kept after a call's own timeout (writes, merge, response).
  startMarginMs: number;
  // The worker starts nothing new after this point (wall clock - 20 s).
  exitByMs: number;
};

export function limitsFor(wallClockMs: number = FREE_PLAN_WALL_CLOCK_MS): StepLimits {
  return { wallClockMs, callEndLimitMs: wallClockMs - 10_000, startMarginMs: 15_000, exitByMs: wallClockMs - 20_000 };
}

// The lease outlives the longest possible invocation, so a stopped
// worker's lease always expires before anyone else may take the job over.
export function leaseMsFor(limits: StepLimits): number {
  return limits.wallClockMs + 5_000;
}

// The timeout a call starting NOW may use: the preferred timeout, cut to
// what still fits before callEndLimitMs - startMarginMs; null when not even
// `minMs` fits (the call is not started at all).
export function callTimeoutNow(limits: StepLimits, elapsedMs: number, preferredMs: number, minMs: number): number | null {
  if (elapsedMs >= limits.exitByMs) return null;
  const room = limits.callEndLimitMs - limits.startMarginMs - elapsedMs;
  const timeout = Math.min(preferredMs, room);
  return timeout >= minMs ? timeout : null;
}

export const PAGE_TIMEOUT_MS = 100_000;
export const MIN_PAGE_TIMEOUT_MS = 45_000;
export const WHOLE_DOC_TIMEOUT_MS = 100_000;
export const WHOLE_DOC_MAX_PAGES = 8;
export const WHOLE_DOC_MAX_BYTES = 8 * 1024 * 1024;
export const CLASSIFY_TIMEOUT_MS = 60_000;
export const CLASSIFY_WINDOW_PAGES = 20;
export const CLASSIFY_WINDOW_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENT_READS = 12;
export const UNKNOWN_LAYOUT_PAGE_CAP = 40;
export const MAX_IMPORT_PAGES = 150;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGE_ATTEMPTS = 2;
export const PAGE_CONCURRENCY = 2;
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;
// Runaway guard only: a 150-page Prime file needs about 10 runs.
export const MAX_RUNS_PER_JOB = 40;
export const HEARTBEAT_EVERY_MS = 20_000;

// Hard input limits, stated and enforced before anything is read (owner
// add-on: "no page count may make a job hang"). Over a limit the import is
// refused with a message that explains the way forward.
export type ImportLimitRefusal = { code: 'oversized' | 'too_many_pages'; message: string };

export function checkImportLimits(totalPages: number, fileBytes: number): ImportLimitRefusal | null {
  if (fileBytes > MAX_IMPORT_FILE_BYTES) {
    return {
      code: 'oversized',
      message: `This file is ${(fileBytes / (1024 * 1024)).toFixed(1)} MB; the limit is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB per import. Export or scan it at a lower resolution, or split it into smaller files (for example the settlement pages on their own), and import each one.`,
    };
  }
  if (totalPages > MAX_IMPORT_PAGES) {
    return {
      code: 'too_many_pages',
      message: `This file has ${totalPages} pages; the limit is ${MAX_IMPORT_PAGES} pages per import. Split it into smaller files (for example the settlement pages on their own) and import each one.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type PageKind =
  | 'settlement'
  | 'statement'
  | 'toll_bill'
  | 'repair_invoice'
  | 'delivery_receipt'
  | 'fuel_receipt'
  | 'other'
  | 'unknown';
export const PAGE_KINDS: PageKind[] = ['settlement', 'statement', 'toll_bill', 'repair_invoice', 'delivery_receipt', 'fuel_receipt', 'other', 'unknown'];

// content: read, blocks "ready to review". attachment: read last, in the
// background, never blocks. stored: kept in the stored PDF, not read.
export type PageRole = 'content' | 'attachment' | 'stored';
export type PlanPage = { page: number; role: PageRole; kind: PageKind };

export type PageErrorType = 'timeout' | 'cut_off' | 'busy' | 'unreadable' | 'refused' | 'service' | 'worker_stopped';

export type PageResult = {
  status: 'done' | 'failed' | 'pending';
  role: PageRole;
  kind: PageKind;
  attempts: number;
  run: number;
  extraction?: unknown;
  error?: { type: PageErrorType; message: string; timeoutMs?: number };
  finishedAt?: string;
  // Set while a model call for this page is running. A page still marked
  // in flight when a later run starts was cut off by a stopped worker: that
  // counts as an attempt ('worker_stopped'), so a page that keeps stopping
  // the worker ends as failed instead of looping forever.
  inFlight?: boolean;
};

export type ClassifiedPage = { page: number; kind: PageKind; hasTotalCashFlow: boolean };

export type JobPhase = 'start' | 'whole' | 'classify' | 'pages' | 'awaiting_decision' | 'done' | 'failed';

export type JobPlan = {
  version: 2;
  kind: 'import' | 'read_pages';
  mediaType: string;
  totalPages: number;
  fileBytes: number;
  phase: JobPhase;
  runs: number;
  wholeDocument?: { outcome: 'timeout' | 'cut_off' } | null;
  classification?: {
    nextStart: number;
    windows: [number, number][];
    pages: ClassifiedPage[];
    carrier: string | null;
    isPrime: boolean | null;
    boundary: number | null;
    failed: string | null;
  } | null;
  layout?: 'prime_statement' | 'physical' | null;
  pages: PlanPage[];
  pageCap?: { cap: number; answer: 'read_first' | null } | null;
  readyAt?: string | null;
  retryAt?: number | null;
  baseDocumentId?: string | null;
};

export type PageMapEntry = {
  page: number;
  kind: PageKind;
  role: PageRole;
  status: 'read' | 'failed' | 'unread' | 'pending';
  cause?: PageErrorType;
};

export type JobProgress = {
  phase: JobPhase;
  run: number;
  totalPages: number;
  contentTotal: number;
  contentDone: number;
  contentFailed: number;
  // Pages being read right now, with their kind ("Reading settlement page
  // 3 of 6"); `position` is the page's place among the content pages.
  current: { page: number; kind: PageKind; role: PageRole; position: number }[];
  // Where "Resume from page N" starts: the first page without a result.
  resumePage: number | null;
  attachmentsQueued: number;
  attachmentsDone: number;
  storedPages: number[];
  failed: { page: number; kind: PageKind; type: PageErrorType; run: number; timeoutMs?: number }[];
  question: { kind: 'page_cap'; totalPages: number; cap: number } | null;
  startedAt: string;
  readyAt: string | null;
};

export type ModelErrorType =
  | 'timeout'
  | 'truncated'
  | 'rate_limited'
  | 'parse_failed'
  | 'model_refusal'
  | 'billing_exhausted'
  | 'internal'
  | 'bad_request'
  | 'oversized';
export type ModelFailure = { errorType: ModelErrorType; message: string; retryAfterSeconds?: number };
export type ModelOutcome = { extraction: unknown } | ModelFailure;
export type ClassifyOutcome = { pages: ClassifiedPage[]; carrier: string | null; windowEnd: number } | ModelFailure;

export function isFailure(o: unknown): o is ModelFailure {
  return !!o && typeof o === 'object' && 'errorType' in (o as Record<string, unknown>);
}

export type JobSnapshot = {
  plan: JobPlan;
  results: Record<string, PageResult>;
  documentId: string | null;
  startedAt: string;
};

export type JobRowFields = {
  status?: 'processing' | 'paused' | 'waiting_to_retry' | 'needs_decision' | 'ready' | 'failed';
  progress?: JobProgress;
  errorMessage?: string | null;
  errorStep?: string | null;
  errorPage?: number | null;
  pagesTotal?: number;
  resultJson?: unknown | null;
  // Write result_json only while the week is not saved yet (document_id
  // null) — after Save the job row keeps attachment results only.
  resultOnlyIfUnsaved?: boolean;
  completed?: boolean;
};

export interface JobStore {
  claim(owner: string, leaseMs: number): Promise<boolean>;
  load(): Promise<JobSnapshot>;
  // Writes only while `owner` holds the lease; false = lease lost.
  savePlan(owner: string, plan: JobPlan, fields: JobRowFields): Promise<boolean>;
  // Atomic per-page write; refuses to overwrite a page already 'done'.
  putPage(owner: string, page: number, result: PageResult): Promise<boolean>;
  release(owner: string): Promise<void>;
  // documents.parsed_json of the saved week (re-reading pages after Save).
  loadBaseDocument(documentId: string): Promise<unknown | null>;
}

export interface JobModel {
  wholeDocument(timeoutMs: number): Promise<ModelOutcome>;
  // Classifies pages start..(at most) maxEnd; the implementation may use a
  // shorter window to stay under CLASSIFY_WINDOW_MAX_BYTES and reports the
  // window it used in `windowEnd`.
  classifyWindow(start: number, maxEnd: number, timeoutMs: number): Promise<ClassifyOutcome>;
  readPage(page: number, kind: PageKind, timeoutMs: number): Promise<ModelOutcome>;
}

export type UsageCallType = 'ai_import' | 'ai_import_classify' | 'ai_import_pages';

export type JobDeps = {
  owner: string;
  limits: StepLimits;
  // Milliseconds since THIS invocation started (the platform's clock).
  elapsedMs(): number;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  store: JobStore;
  model: JobModel;
  // Per-page extractions (page order) merged into one extraction, on top
  // of `base` (the saved week) when re-reading pages after Save.
  merge(pages: { page: number; extraction: unknown }[], base: unknown | null): unknown | null;
  scrub<T>(value: T): T;
  isPrimeCarrier(carrier: string | null | undefined): boolean;
  logUsage(callType: UsageCallType, success: boolean, reason?: string): Promise<void>;
  consumeCreditIfOverAllowance(): Promise<void>;
  // Starts the next invocation of this job (fire, then this one exits).
  continueInNewInvocation(): Promise<void>;
  startHeartbeat(): () => void;
  log(message: string): void;
};

export type StepResult = {
  kind: 'not_owner' | 'lease_lost' | 'continued' | 'ready' | 'done' | 'failed' | 'awaiting_decision';
  modelCalls: number;
};

// ---------------------------------------------------------------------
// Plan building (pure)
// ---------------------------------------------------------------------

export function newImportPlan(mediaType: string, totalPages: number, fileBytes: number): JobPlan {
  return { version: 2, kind: 'import', mediaType, totalPages, fileBytes, phase: 'start', runs: 0, pages: [] };
}

// Re-reading chosen pages of an already-saved document ("Read the missing
// pages", "Read this page"): those pages only, as content, merged onto the
// saved extraction.
export function newReadPagesPlan(
  totalPages: number,
  fileBytes: number,
  pages: { page: number; kind: PageKind }[],
  baseDocumentId: string
): JobPlan {
  const unique = [...new Map(pages.filter((p) => p.page >= 1 && p.page <= totalPages).map((p) => [p.page, p])).values()].sort(
    (a, b) => a.page - b.page
  );
  return {
    version: 2,
    kind: 'read_pages',
    mediaType: 'application/pdf',
    totalPages,
    fileBytes,
    phase: 'pages',
    runs: 0,
    pages: unique.map((p) => ({ page: p.page, role: 'content', kind: p.kind })),
    baseDocumentId,
    layout: 'physical',
  };
}

export function choosesWholeDocument(plan: Pick<JobPlan, 'mediaType' | 'totalPages' | 'fileBytes'>): boolean {
  if (plan.mediaType.startsWith('image/')) return true;
  return plan.totalPages <= WHOLE_DOC_MAX_PAGES && plan.fileBytes <= WHOLE_DOC_MAX_BYTES;
}

// The statement boundary from what has been classified so far: the last
// page that is part of the operating statement (TOTAL CASH FLOW, or a page
// classified as statement). Null while it can't be known yet.
export function statementBoundary(pages: ClassifiedPage[], windowEnd: number, totalPages: number): number | null {
  const statementPages = pages.filter((p) => p.kind === 'statement' || p.hasTotalCashFlow).map((p) => p.page);
  if (statementPages.length === 0) return null;
  const last = Math.max(...statementPages);
  const hasTcf = pages.some((p) => p.hasTotalCashFlow);
  // The statement may continue on the next window's first page unless it
  // printed TOTAL CASH FLOW or a non-statement page follows it.
  const followedByOther = pages.some((p) => p.page > last && p.kind !== 'statement');
  if (hasTcf || followedByOther || windowEnd >= totalPages) return last;
  return null;
}

// Prime layout: everything up to the boundary is content (physical
// order); after it, toll bills and repair invoices are read last (at most
// MAX_ATTACHMENT_READS), a settlement/statement page is still content
// (never skipped silently), everything else is stored unread.
export function primePagePlan(totalPages: number, classified: ClassifiedPage[], boundary: number): PlanPage[] {
  const kindOf = new Map(classified.map((p) => [p.page, p.kind]));
  const out: PlanPage[] = [];
  let attachments = 0;
  for (let page = 1; page <= totalPages; page++) {
    const kind = kindOf.get(page) ?? 'unknown';
    if (page <= boundary || kind === 'settlement' || kind === 'statement') {
      out.push({ page, role: 'content', kind });
    } else if ((kind === 'toll_bill' || kind === 'repair_invoice') && attachments < MAX_ATTACHMENT_READS) {
      attachments++;
      out.push({ page, role: 'attachment', kind });
    } else {
      out.push({ page, role: 'stored', kind });
    }
  }
  return out;
}

// No boundary: physical order, the first `cap` pages read as content, the
// rest stored unread (listed by page).
export function physicalPagePlan(totalPages: number, classified: ClassifiedPage[], cap: number = UNKNOWN_LAYOUT_PAGE_CAP): PlanPage[] {
  const kindOf = new Map(classified.map((p) => [p.page, p.kind]));
  const out: PlanPage[] = [];
  for (let page = 1; page <= totalPages; page++) {
    out.push({ page, role: page <= cap ? 'content' : 'stored', kind: kindOf.get(page) ?? 'unknown' });
  }
  return out;
}

function settled(r: PageResult | undefined): boolean {
  return !!r && (r.status === 'done' || r.status === 'failed');
}

export function buildPageMap(plan: JobPlan, results: Record<string, PageResult>): PageMapEntry[] {
  if (plan.pages.length === 0) {
    return Array.from({ length: plan.totalPages }, (_, i) => ({ page: i + 1, kind: 'unknown' as PageKind, role: 'content' as PageRole, status: 'read' as const }));
  }
  return plan.pages.map((p) => {
    const r = results[String(p.page)];
    if (p.role === 'stored') return { page: p.page, kind: p.kind, role: p.role, status: 'unread' as const };
    if (r?.status === 'done') return { page: p.page, kind: p.kind, role: p.role, status: 'read' as const };
    if (r?.status === 'failed') return { page: p.page, kind: p.kind, role: p.role, status: 'failed' as const, cause: r.error?.type };
    return { page: p.page, kind: p.kind, role: p.role, status: 'pending' as const };
  });
}

export function buildProgress(
  plan: JobPlan,
  results: Record<string, PageResult>,
  inFlight: number[],
  startedAt: string
): JobProgress {
  const content = plan.pages.filter((p) => p.role === 'content');
  const attachments = plan.pages.filter((p) => p.role === 'attachment');
  const at = (p: PlanPage) => results[String(p.page)];
  const byPage = new Map(plan.pages.map((p) => [p.page, p]));
  const current = [...inFlight]
    .sort((a, b) => a - b)
    .map((page) => {
      const p = byPage.get(page);
      const list = p?.role === 'attachment' ? attachments : content;
      return { page, kind: p?.kind ?? ('unknown' as PageKind), role: p?.role ?? ('content' as PageRole), position: Math.max(1, list.findIndex((x) => x.page === page) + 1) };
    });
  const failed = plan.pages
    .filter((p) => at(p)?.status === 'failed')
    .map((p) => ({ page: p.page, kind: p.kind, type: at(p)!.error?.type ?? 'service', run: at(p)!.run, timeoutMs: at(p)!.error?.timeoutMs }));
  return {
    phase: plan.phase,
    run: plan.runs,
    totalPages: plan.totalPages,
    contentTotal: content.length,
    contentDone: content.filter((p) => at(p)?.status === 'done').length,
    contentFailed: content.filter((p) => at(p)?.status === 'failed').length,
    current,
    resumePage: resumePage(plan, results),
    attachmentsQueued: attachments.filter((p) => !settled(at(p))).length,
    attachmentsDone: attachments.filter((p) => at(p)?.status === 'done').length,
    storedPages: plan.pages.filter((p) => p.role === 'stored').map((p) => p.page),
    failed,
    question:
      plan.phase === 'awaiting_decision' && plan.pageCap
        ? { kind: 'page_cap', totalPages: plan.totalPages, cap: plan.pageCap.cap }
        : null,
    startedAt,
    readyAt: plan.readyAt ?? null,
  };
}

function pageErrorType(e: ModelErrorType): PageErrorType {
  switch (e) {
    case 'timeout':
      return 'timeout';
    case 'truncated':
      return 'cut_off';
    case 'rate_limited':
      return 'busy';
    case 'parse_failed':
    case 'bad_request':
    case 'oversized':
      return 'unreadable';
    case 'model_refusal':
      return 'refused';
    default:
      return 'service';
  }
}

const KIND_TEXT: Record<PageKind, string> = {
  settlement: 'settlement',
  statement: 'operating statement',
  toll_bill: 'toll bill',
  repair_invoice: 'repair invoice',
  delivery_receipt: 'delivery receipt',
  fuel_receipt: 'fuel receipt',
  other: 'attachment',
  unknown: 'page',
};

const CAUSE_TEXT: Record<PageErrorType, string> = {
  timeout: 'the AI took longer than its time limit',
  cut_off: 'the AI reply was cut off',
  busy: 'the AI service was busy',
  unreadable: 'the AI reply could not be read',
  refused: 'the AI declined to read it',
  service: 'the AI service had an error',
  worker_stopped: 'the server stopped while reading it',
};

// English fallback stored in import_jobs.error_message; the app renders
// the same facts from `progress.failed` in the user's language.
export function describePageFailure(f: { page: number; kind: PageKind; type: PageErrorType; run: number; timeoutMs?: number }, totalPages: number): string {
  const limit = f.type === 'timeout' && f.timeoutMs ? ` (${Math.round(f.timeoutMs / 1000)} s)` : '';
  return `Page ${f.page} of ${totalPages} (${KIND_TEXT[f.kind]}), run ${f.run}: ${CAUSE_TEXT[f.type]}${limit}. Resume from page ${f.page}.`;
}

// The first page a resume starts at: the first content page (then
// attachment page) in plan order without a finished result.
export function resumePage(plan: JobPlan, results: Record<string, PageResult>): number | null {
  const next =
    plan.pages.find((p) => p.role === 'content' && results[String(p.page)]?.status !== 'done') ??
    plan.pages.find((p) => p.role === 'attachment' && results[String(p.page)]?.status !== 'done');
  return next ? next.page : null;
}

// A resume (Retry / "Resume from page N") makes failed pages runnable
// again with fresh attempts — finished pages are never touched.
export function resetFailedPages(results: Record<string, PageResult>): Record<string, PageResult> {
  const out: Record<string, PageResult> = {};
  for (const [k, r] of Object.entries(results)) out[k] = r.status === 'failed' ? { ...r, status: 'pending', attempts: 0 } : r;
  return out;
}

// ---------------------------------------------------------------------
// One invocation of a job ("step")
// ---------------------------------------------------------------------

class LeaseLost extends Error {}

type Signal = 'again' | 'exit_continue' | 'stop';

export async function runJobStep(d: JobDeps): Promise<StepResult> {
  if (!(await d.store.claim(d.owner, leaseMsFor(d.limits)))) return { kind: 'not_owner', modelCalls: 0 };
  const snap = await d.store.load();
  // A stray run (a duplicate next-run request, a late restart) on a job
  // that already finished or failed changes nothing. Only a user's Resume
  // (which resets the phase first) restarts a failed job.
  if (snap.plan.phase === 'done' || snap.plan.phase === 'failed') {
    await d.store.release(d.owner);
    return { kind: snap.plan.phase === 'done' ? 'done' : 'failed', modelCalls: 0 };
  }
  const plan: JobPlan = { ...snap.plan };
  const results: Record<string, PageResult> = { ...snap.results };
  const inFlight = new Set<number>();
  let modelCalls = 0;
  let outcome: StepResult['kind'] = 'continued';
  plan.runs += 1;
  const stopHeartbeat = d.startHeartbeat();

  const progress = () => buildProgress(plan, results, [...inFlight], snap.startedAt);
  async function save(fields: JobRowFields = {}): Promise<void> {
    const ok = await d.store.savePlan(d.owner, plan, { progress: progress(), ...fields });
    if (!ok) throw new LeaseLost();
  }
  async function failJob(rawMessage: string, step: string, page: number | null): Promise<Signal> {
    const message = d.scrub(rawMessage);
    plan.phase = 'failed';
    await save({ status: 'failed', errorMessage: message, errorStep: step, errorPage: page, completed: true });
    await d.logUsage(plan.kind === 'import' ? 'ai_import' : 'ai_import_pages', false, `${step}: ${message}`);
    outcome = 'failed';
    return 'stop';
  }

  try {
    if (plan.runs > MAX_RUNS_PER_JOB) {
      await failJob(`This import needed more than ${MAX_RUNS_PER_JOB} server runs and was stopped.`, 'too_many_runs', null);
      return { kind: 'failed', modelCalls };
    }

    // A rate limit from an earlier run: wait it out here if it fits.
    if (plan.retryAt && plan.retryAt > d.nowMs()) {
      const wait = plan.retryAt - d.nowMs();
      if (wait <= RATE_LIMIT_MAX_WAIT_MS && d.elapsedMs() + wait < d.limits.exitByMs - MIN_PAGE_TIMEOUT_MS) {
        await save(plan.readyAt ? {} : { status: 'waiting_to_retry' });
        await d.sleep(wait);
      } else {
        await save(plan.readyAt ? {} : { status: 'waiting_to_retry' });
        return await exitAndContinue();
      }
    }
    plan.retryAt = null;
    await recoverInterruptedPages();
    if (!plan.readyAt && plan.phase !== 'awaiting_decision') await save({ status: 'processing', pagesTotal: plan.totalPages });

    for (;;) {
      let signal: Signal;
      if (plan.phase === 'start') {
        if (plan.kind === 'read_pages') plan.phase = 'pages';
        else if (choosesWholeDocument(plan)) plan.phase = 'whole';
        else startClassification();
        signal = 'again';
      } else if (plan.phase === 'whole') signal = await stepWhole();
      else if (plan.phase === 'classify') signal = await stepClassify();
      else if (plan.phase === 'pages') signal = await stepPages();
      else if (plan.phase === 'awaiting_decision') {
        await save({ status: 'needs_decision' });
        outcome = 'awaiting_decision';
        signal = 'stop';
      } else {
        signal = 'stop';
      }
      if (signal === 'again') continue;
      if (signal === 'exit_continue') return await exitAndContinue();
      return { kind: outcome, modelCalls };
    }
  } catch (err) {
    if (err instanceof StopRun) return { kind: 'failed', modelCalls };
    if (err instanceof LeaseLost) {
      d.log(`lease lost in run ${plan.runs} — another chain owns this job now`);
      return { kind: 'lease_lost', modelCalls };
    }
    d.log(`unexpected error in run ${plan.runs}: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await failJob(`Something went wrong on our end (run ${plan.runs}). Resume to continue from where it stopped.`, 'unexpected', null);
    } catch {
      // nothing more we can do; the heartbeat goes stale and the app offers Resume
    }
    return { kind: 'failed', modelCalls };
  } finally {
    stopHeartbeat();
    await d.store.release(d.owner);
  }

  async function exitAndContinue(): Promise<StepResult> {
    if (!plan.readyAt && plan.phase !== 'failed') await save({ status: plan.retryAt ? 'waiting_to_retry' : 'paused' });
    else await save();
    // release happens in `finally`; the next invocation claims the lease
    // only after it has been released or has expired.
    await d.store.release(d.owner);
    await d.continueInNewInvocation();
    return { kind: 'continued', modelCalls };
  }

  // Pages a stopped worker left "in flight" count one attempt each.
  async function recoverInterruptedPages(): Promise<void> {
    for (const [key, r] of Object.entries(results)) {
      if (!r.inFlight || r.status === 'done') continue;
      const attempts = r.attempts + 1;
      const next: PageResult = {
        ...r,
        inFlight: false,
        attempts,
        status: attempts >= MAX_PAGE_ATTEMPTS ? 'failed' : 'pending',
        error: { type: 'worker_stopped', message: 'The server stopped while this page was being read.' },
      };
      if (!(await d.store.putPage(d.owner, Number(key), next))) throw new LeaseLost();
      results[key] = next;
    }
  }

  function startClassification(): void {
    plan.phase = 'classify';
    plan.classification = { nextStart: 1, windows: [], pages: [], carrier: null, isPrime: null, boundary: null, failed: null };
  }

  function choosePlan(): void {
    const c = plan.classification!;
    if (c.isPrime && c.boundary != null) {
      plan.layout = 'prime_statement';
      plan.pages = primePagePlan(plan.totalPages, c.pages, c.boundary);
    } else {
      plan.layout = 'physical';
      plan.pages = physicalPagePlan(plan.totalPages, c.pages);
      if (plan.totalPages > UNKNOWN_LAYOUT_PAGE_CAP && plan.pageCap?.answer !== 'read_first') {
        plan.pageCap = { cap: UNKNOWN_LAYOUT_PAGE_CAP, answer: null };
        plan.phase = 'awaiting_decision';
        return;
      }
    }
    plan.phase = 'pages';
  }

  async function handleRateLimit(f: ModelFailure): Promise<Signal> {
    const waitMs = Math.max(1_000, (f.retryAfterSeconds ?? 30) * 1000);
    plan.retryAt = d.nowMs() + waitMs;
    return 'exit_continue';
  }

  async function stepWhole(): Promise<Signal> {
    const timeout = callTimeoutNow(d.limits, d.elapsedMs(), WHOLE_DOC_TIMEOUT_MS, WHOLE_DOC_TIMEOUT_MS);
    if (timeout == null) return 'exit_continue';
    for (let p = 1; p <= plan.totalPages; p++) inFlight.add(p);
    await save();
    const r = await d.model.wholeDocument(timeout);
    modelCalls++;
    inFlight.clear();
    if (!isFailure(r)) {
      return finalizeReady([{ page: 1, extraction: r.extraction }]);
    }
    if (r.errorType === 'rate_limited') return handleRateLimit(r);
    const splittable = !plan.mediaType.startsWith('image/') && plan.totalPages > 1;
    if (splittable && (r.errorType === 'timeout' || r.errorType === 'truncated' || r.errorType === 'internal')) {
      // Decision B: the page plan continues in a NEW invocation, never in
      // this worker's leftover seconds.
      plan.wholeDocument = { outcome: r.errorType === 'truncated' ? 'cut_off' : 'timeout' };
      startClassification();
      return 'exit_continue';
    }
    if (r.errorType === 'billing_exhausted') return failJob(r.message, r.errorType, null);
    return failJob(r.message, r.errorType, null);
  }

  async function stepClassify(): Promise<Signal> {
    const c = plan.classification!;
    const timeout = callTimeoutNow(d.limits, d.elapsedMs(), CLASSIFY_TIMEOUT_MS, CLASSIFY_TIMEOUT_MS);
    if (timeout == null) return 'exit_continue';
    const maxEnd = Math.min(c.nextStart + CLASSIFY_WINDOW_PAGES - 1, plan.totalPages);
    await save();
    let r: ClassifyOutcome;
    try {
      r = await d.model.classifyWindow(c.nextStart, maxEnd, timeout);
    } catch (err) {
      r = { errorType: 'internal', message: err instanceof Error ? err.message : String(err) };
    }
    modelCalls++;
    if (isFailure(r)) {
      await d.logUsage('ai_import_classify', false, `${r.errorType}: ${d.scrub(r.message)}`);
      if (r.errorType === 'rate_limited') return handleRateLimit(r);
      // Advisory only: a failed classification falls back to physical order.
      c.failed = r.errorType;
      choosePlan();
      return 'again';
    }
    await d.logUsage('ai_import_classify', true);
    const windowEnd = Math.max(c.nextStart, Math.min(r.windowEnd, maxEnd));
    c.windows.push([c.nextStart, windowEnd]);
    const fresh = r.pages.filter((p) => p.page >= c.nextStart && p.page <= windowEnd && PAGE_KINDS.includes(p.kind));
    c.pages = [...c.pages.filter((p) => !fresh.some((f) => f.page === p.page)), ...fresh].sort((a, b) => a.page - b.page);
    if (c.carrier == null && r.carrier) c.carrier = r.carrier;
    // Carrier gate: a null or unknown carrier never selects the Prime layout.
    c.isPrime = d.isPrimeCarrier(c.carrier);
    if (!c.isPrime) {
      choosePlan();
      return 'again';
    }
    c.boundary = statementBoundary(c.pages, windowEnd, plan.totalPages);
    if (c.boundary == null && windowEnd < plan.totalPages) {
      c.nextStart = windowEnd + 1;
      return 'again';
    }
    choosePlan();
    return 'again';
  }

  async function stepPages(): Promise<Signal> {
    for (;;) {
      const pending = (role: PageRole) => plan.pages.filter((p) => p.role === role && !settled(results[String(p.page)]));
      const content = pending('content');
      if (content.length === 0 && !plan.readyAt) {
        const s = await finalizeReady(null);
        if (s === 'stop' && plan.phase === 'failed') return 'stop';
      }
      const attachments = pending('attachment');
      if (content.length === 0 && attachments.length === 0) return finalizeDone();
      // Attachments are read last, only after every content page settled.
      const queue = content.length > 0 ? content : attachments;
      const attempted = await readPool(queue);
      if (plan.retryAt) return 'exit_continue';
      if (attempted === 0) return 'exit_continue';
      if (d.elapsedMs() >= d.limits.exitByMs) {
        // Content may have just finished: publish "ready" before exiting.
        if (pending('content').length === 0 && !plan.readyAt) await finalizeReady(null);
        return 'exit_continue';
      }
    }
  }

  async function readPool(queue: PlanPage[]): Promise<number> {
    let cursor = 0;
    let attempted = 0;
    const state: { fatal: ModelFailure | null } = { fatal: null };
    async function worker(): Promise<void> {
      while (cursor < queue.length && !plan.retryAt && !state.fatal) {
        const timeout = callTimeoutNow(d.limits, d.elapsedMs(), PAGE_TIMEOUT_MS, MIN_PAGE_TIMEOUT_MS);
        if (timeout == null) return;
        const p = queue[cursor++];
        attempted++;
        const f = await readOne(p, timeout);
        if (f) state.fatal = f;
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, queue.length) }, () => worker()));
    if (state.fatal) {
      await failJob(state.fatal.message, state.fatal.errorType, null);
      throw new StopRun();
    }
    return attempted;
  }

  // Returns a failure only when the whole job cannot continue (billing).
  async function readOne(p: PlanPage, timeoutMs: number): Promise<ModelFailure | null> {
    const key = String(p.page);
    const prev = results[key];
    inFlight.add(p.page);
    const marker: PageResult = prev
      ? { ...prev, inFlight: true, run: plan.runs }
      : { status: 'pending', role: p.role, kind: p.kind, attempts: 0, run: plan.runs, inFlight: true };
    if (!(await d.store.putPage(d.owner, p.page, marker))) throw new LeaseLost();
    results[key] = marker;
    await save();
    let r: ModelOutcome;
    try {
      r = await d.model.readPage(p.page, p.kind, timeoutMs);
    } catch (err) {
      r = { errorType: 'internal', message: err instanceof Error ? err.message : String(err) };
    }
    modelCalls++;
    inFlight.delete(p.page);
    const attemptsBefore = prev?.attempts ?? 0;
    let next: PageResult;
    if (!isFailure(r)) {
      next = { status: 'done', role: p.role, kind: p.kind, attempts: attemptsBefore + 1, run: plan.runs, extraction: d.scrub(r.extraction), finishedAt: new Date(d.nowMs()).toISOString() };
    } else if (r.errorType === 'billing_exhausted') {
      return r;
    } else if (r.errorType === 'rate_limited') {
      plan.retryAt = d.nowMs() + Math.max(1_000, (r.retryAfterSeconds ?? 30) * 1000);
      next = { status: 'pending', role: p.role, kind: p.kind, attempts: attemptsBefore, run: plan.runs, error: { type: 'busy', message: d.scrub(r.message) } };
    } else if (r.errorType === 'timeout' && timeoutMs < PAGE_TIMEOUT_MS) {
      // Cut short by this run's remaining time: not counted as an attempt,
      // the next run tries it again with the full timeout.
      next = { status: 'pending', role: p.role, kind: p.kind, attempts: attemptsBefore, run: plan.runs, error: { type: 'timeout', message: d.scrub(r.message), timeoutMs } };
    } else {
      const attempts = attemptsBefore + 1;
      next = {
        status: attempts >= MAX_PAGE_ATTEMPTS ? 'failed' : 'pending',
        role: p.role,
        kind: p.kind,
        attempts,
        run: plan.runs,
        error: { type: pageErrorType(r.errorType), message: d.scrub(r.message), timeoutMs: r.errorType === 'timeout' ? timeoutMs : undefined },
      };
    }
    if (!(await d.store.putPage(d.owner, p.page, next))) throw new LeaseLost();
    results[key] = next;
    await save();
    return null;
  }

  function donePages(roles: PageRole[]): { page: number; extraction: unknown }[] {
    return plan.pages
      .filter((p) => roles.includes(p.role) && results[String(p.page)]?.status === 'done')
      .map((p) => ({ page: p.page, extraction: results[String(p.page)].extraction }));
  }

  async function mergedResult(pages: { page: number; extraction: unknown }[], base: unknown | null): Promise<unknown | null> {
    const merged = d.merge(pages, base) as Record<string, unknown> | null;
    if (!merged) return null;
    merged.pageMap = buildPageMap(plan, results);
    merged.pagesTotal = plan.totalPages;
    return d.scrub(merged);
  }

  // "Ready to review": every content page settled. Attachments may still
  // be queued; they never block this.
  async function finalizeReady(wholeDocument: { page: number; extraction: unknown }[] | null): Promise<Signal> {
    const pages = wholeDocument ?? donePages(['content', 'attachment']);
    if (pages.length === 0) {
      const first = buildProgress(plan, results, [], snap.startedAt).failed[0];
      const message = first ? describePageFailure(first, plan.totalPages) : 'No page of this document could be read.';
      return failJob(message, first?.type ?? 'unreadable', first?.page ?? null);
    }
    const base = plan.kind === 'read_pages' && plan.baseDocumentId ? await d.store.loadBaseDocument(plan.baseDocumentId) : null;
    const result = await mergedResult(pages, base);
    if (!result) return failJob('No page of this document could be read.', 'unreadable', null);
    plan.readyAt = new Date(d.nowMs()).toISOString();
    if (wholeDocument) plan.phase = 'done';
    await save({ status: 'ready', resultJson: result, completed: true, errorMessage: null, errorStep: null, errorPage: null });
    if (plan.kind === 'import') {
      await d.logUsage('ai_import', true);
      await d.consumeCreditIfOverAllowance();
    } else {
      await d.logUsage('ai_import_pages', true);
    }
    outcome = 'ready';
    return wholeDocument ? 'stop' : 'again';
  }

  // Every content and attachment page settled.
  async function finalizeDone(): Promise<Signal> {
    plan.phase = 'done';
    const attachments = donePages(['attachment']);
    const fresh = await d.store.load();
    if (fresh.documentId) {
      // The week was saved while attachments were still being read: offer
      // them for review on top of the saved week (Save replaces the week).
      if (attachments.length > 0) {
        const base = await d.store.loadBaseDocument(fresh.documentId);
        const result = await mergedResult(attachments, base);
        await save({ status: 'ready', resultJson: result, completed: true });
      } else {
        const failedPages = plan.pages.filter((p) => p.role === 'attachment').map((p) => p.page);
        await save({
          status: 'failed',
          errorMessage: `Attachment pages ${failedPages.join(', ')} could not be read. The week is saved without them.`,
          errorStep: 'attachments',
          errorPage: failedPages[0] ?? null,
          completed: true,
        });
      }
    } else {
      const result = await mergedResult(donePages(['content', 'attachment']), null);
      await save({ resultJson: result, resultOnlyIfUnsaved: true, completed: true });
    }
    outcome = 'done';
    return 'stop';
  }
}

class StopRun extends Error {}
