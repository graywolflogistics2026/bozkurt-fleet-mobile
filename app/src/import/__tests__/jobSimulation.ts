// A simulated Supabase Edge Function world for the resumable import job
// engine (supabase/functions/ai-import/jobEngine.ts): a virtual clock, a
// platform that stops any worker at its 150 s wall clock (Free plan), a
// fake import_jobs row with the same lease / per-page / "never overwrite a
// finished page" rules as the §78 SQL functions, and a fake model whose
// per-page durations are ESTIMATES (see PAGE_READ_MS below) — not
// measurements. Not a test file itself (no .test.ts): imported by
// jobEngine.test.ts and jobEngineScale.test.ts.
import {
  CLASSIFY_WINDOW_MAX_BYTES,
  FREE_PLAN_WALL_CLOCK_MS,
  limitsFor,
  newImportPlan,
  runJobStep,
  type ClassifiedPage,
  type ClassifyOutcome,
  type JobDeps,
  type JobPlan,
  type JobRowFields,
  type ModelOutcome,
  type PageKind,
  type PageResult,
  type StepResult,
  type UsageCallType,
} from '../../../../supabase/functions/ai-import/jobEngine';
import { mergeChunkedExtractions, type ChunkExtraction } from '../../../../supabase/functions/ai-import/chunking';
import { scrubBankDigits } from '../../../../supabase/functions/ai-import/bankDigits';

// ---------------------------------------------------------------------
// Estimates (NOT measurements): how long the model takes per page kind.
// The only real measurements on record are 24-40 s per settlement page
// (2026-08-03 function logs, before the statement-line prompt).
// ---------------------------------------------------------------------
export const PAGE_READ_MS: Record<PageKind, number> = {
  settlement: 35_000,
  statement: 45_000,
  toll_bill: 80_000,
  repair_invoice: 40_000,
  delivery_receipt: 25_000,
  fuel_receipt: 25_000,
  other: 35_000,
  unknown: 35_000,
};
export const CLASSIFY_BASE_MS = 4_000;
export const CLASSIFY_PER_PAGE_MS = 1_500;
// pdf-lib's in-memory object model, as a multiple of the file size (estimate).
export const PDF_PARSE_FACTOR = 2;

export type PageSpec = {
  kind: PageKind;
  bytes: number;
  readMs?: number;
  tcf?: boolean;
  extraction?: unknown;
  // 'always_timeout': every read times out; 'parse_failed': every read
  // returns an unreadable reply; 'timeout_once': the first read times out.
  fail?: 'always_timeout' | 'parse_failed' | 'timeout_once';
};

export type DocSpec = {
  carrier: string | null;
  pages: PageSpec[];
  // Whole-document call duration (only used for <= 8 pages / 8 MB).
  wholeDocMs?: number;
  classifyFails?: boolean;
};

export type SimOptions = {
  wallClockMs?: number;
  // Stop a given invocation at this many ms after it started (a platform
  // stop earlier than the wall clock, e.g. memory or CPU).
  killAt?: { invocation: number; afterMs: number }[];
  // The app's backup restart: resume an interrupted job this long after
  // its last heartbeat (AUTO_RESUME_AFTER_MS in src/import/importJobs.ts).
  autoResumeAfterMs?: number;
  // When the self-invoke request is lost (never arrives).
  dropSelfInvoke?: boolean;
  answerPageCap?: 'read_first' | 'cancel' | null;
  // Start two invocations at the same moment (two chains).
  doubleStart?: boolean;
  maxSimMs?: number;
  // Save the week (as the app does) as soon as the job is ready.
  saveWhenReady?: boolean;
};

export type FakeRow = {
  status: string;
  plan: JobPlan;
  results: Record<string, PageResult>;
  progress: unknown;
  resultJson: unknown;
  documentId: string | null;
  errorMessage: string | null;
  errorStep: string | null;
  errorPage: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  heartbeatAt: number;
  pagesTotal: number | null;
};

type InvocationLog = { id: number; startMs: number; endMs: number | null; killed: boolean; result: StepResult | null };

export type SimResult = {
  row: FakeRow;
  readyAtMs: number | null;
  finishedAtMs: number;
  invocations: InvocationLog[];
  modelCalls: { whole: number; classify: number; content: number; attachment: number; total: number };
  pageCalls: Map<number, number>;
  writes: string[];
  usage: { callType: UsageCallType; success: boolean }[];
  violations: string[];
  peakMemoryBytes: number;
};

class VirtualClock {
  now = 0;
  private timers: { at: number; seq: number; resolve: () => void; tag: string }[] = [];
  private seq = 0;
  sleep(ms: number, tag: string): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.now + Math.max(0, ms), seq: this.seq++, resolve, tag }));
  }
  nextAt(): number | null {
    return this.timers.length === 0 ? null : Math.min(...this.timers.map((t) => t.at));
  }
  fireDue(): boolean {
    this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const due = this.timers.filter((t) => t.at <= this.now);
    if (due.length === 0) return false;
    this.timers = this.timers.filter((t) => t.at > this.now);
    for (const t of due) t.resolve();
    return true;
  }
  drop(tag: string): void {
    this.timers = this.timers.filter((t) => t.tag !== tag);
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function defaultExtraction(spec: PageSpec, page: number, carrier: string | null): unknown {
  if (spec.extraction) return spec.extraction;
  return {
    docType: 'settlement',
    summary: `page ${page}`,
    confidence: 'high',
    settlement: {
      carrier: page === 1 ? carrier ?? '' : '',
      weekEnding: page === 1 ? '2026-08-21' : '',
      grossRevenue: page === 1 ? 1000 : 0,
      deductions: spec.kind === 'settlement' ? [{ code: 'X', desc: `line on page ${page}`, amount: 10 }] : [],
      maintenance: spec.kind === 'repair_invoice' ? [{ desc: `repair page ${page}`, total: 100 }] : [],
      tolls: { ezpass: { total: 0, items: spec.kind === 'toll_bill' ? [{ desc: `toll page ${page}`, amount: 5 }] : [] } },
    },
  };
}

export function mergePages(pages: { page: number; extraction: unknown }[], base: unknown | null): unknown | null {
  const sorted = [...pages].sort((a, b) => a.page - b.page).map((p) => p.extraction as ChunkExtraction);
  const all = base ? [base as ChunkExtraction, ...sorted] : sorted;
  if (all.length === 0) return null;
  return all.length === 1 ? { ...all[0] } : mergeChunkedExtractions(all);
}

export async function simulateImport(doc: DocSpec, opts: SimOptions = {}): Promise<SimResult> {
  const wallClockMs = opts.wallClockMs ?? FREE_PLAN_WALL_CLOCK_MS;
  const limits = limitsFor(wallClockMs);
  const clock = new VirtualClock();
  const fileBytes = doc.pages.reduce((s, p) => s + p.bytes, 0);
  const row: FakeRow = {
    status: 'queued',
    plan: newImportPlan('application/pdf', doc.pages.length, fileBytes),
    results: {},
    progress: null,
    resultJson: null,
    documentId: null,
    errorMessage: null,
    errorStep: null,
    errorPage: null,
    leaseOwner: null,
    leaseUntil: null,
    heartbeatAt: 0,
    pagesTotal: null,
  };
  const writes: string[] = [];
  const usage: SimResult['usage'] = [];
  const violations: string[] = [];
  const modelCalls = { whole: 0, classify: 0, content: 0, attachment: 0, total: 0 };
  const pageCalls = new Map<number, number>();
  const timeoutsSeen = new Map<number, number>();
  const invocations: InvocationLog[] = [];
  const queue: number[] = [0];
  if (opts.doubleStart) queue.push(0);
  let readyAtMs: number | null = null;
  let peakMemoryBytes = 0;
  const killed = new Set<string>();
  const running = new Map<number, { owner: string; done: boolean; startMs: number; killAtMs: number }>();
  let nextId = 1;

  const record = (what: string, value: unknown) => writes.push(`${what}:${JSON.stringify(value)}`);
  const leaseOk = (owner: string) => row.leaseOwner === owner && row.leaseUntil != null && row.leaseUntil > clock.now && !killed.has(owner);

  function memoryEstimate(inFlightBase64: number): number {
    return fileBytes + PDF_PARSE_FACTOR * fileBytes + 2 * inFlightBase64;
  }

  function buildDeps(id: number, owner: string, startMs: number): JobDeps {
    let inFlightBase64 = 0;
    const checkStart = (timeoutMs: number, what: string) => {
      const elapsed = clock.now - startMs;
      if (elapsed + timeoutMs + limits.startMarginMs > limits.callEndLimitMs) {
        violations.push(`run ${id}: ${what} started at ${elapsed} ms with timeout ${timeoutMs} ms`);
      }
    };
    const hold = async <T,>(base64: number, ms: number, fn: () => T): Promise<T> => {
      inFlightBase64 += base64;
      peakMemoryBytes = Math.max(peakMemoryBytes, memoryEstimate(inFlightBase64));
      await clock.sleep(ms, owner);
      inFlightBase64 -= base64;
      return fn();
    };
    return {
      owner,
      limits,
      elapsedMs: () => clock.now - startMs,
      nowMs: () => clock.now,
      sleep: (ms) => clock.sleep(ms, owner),
      store: {
        async claim(o, leaseMs) {
          if (killed.has(o)) return false;
          if (row.leaseUntil == null || row.leaseUntil <= clock.now || row.leaseOwner === o) {
            row.leaseOwner = o;
            row.leaseUntil = clock.now + leaseMs;
            row.heartbeatAt = clock.now;
            return true;
          }
          return false;
        },
        async load() {
          return { plan: JSON.parse(JSON.stringify(row.plan)), results: JSON.parse(JSON.stringify(row.results)), documentId: row.documentId, startedAt: new Date(0).toISOString() };
        },
        async savePlan(o, plan, fields: JobRowFields) {
          if (!leaseOk(o)) return false;
          row.plan = JSON.parse(JSON.stringify(plan));
          record('plan', plan);
          row.heartbeatAt = clock.now;
          if (fields.progress) row.progress = fields.progress;
          if (fields.status) row.status = fields.status;
          if (fields.status === 'ready' && readyAtMs == null) readyAtMs = clock.now;
          if (fields.errorMessage !== undefined) row.errorMessage = fields.errorMessage;
          if (fields.errorStep !== undefined) row.errorStep = fields.errorStep;
          if (fields.errorPage !== undefined) row.errorPage = fields.errorPage;
          if (fields.pagesTotal !== undefined) row.pagesTotal = fields.pagesTotal;
          if (fields.resultJson !== undefined && (!fields.resultOnlyIfUnsaved || row.documentId == null)) {
            row.resultJson = fields.resultJson;
            record('result_json', fields.resultJson);
          }
          if (fields.errorMessage) record('error_message', fields.errorMessage);
          if (opts.saveWhenReady && row.status === 'ready' && row.documentId == null && row.resultJson) {
            // The app saves the week, then calls import_job_saved().
            row.documentId = 'doc-1';
            row.resultJson = null;
            row.status = 'processing';
            row.results = Object.fromEntries(Object.entries(row.results).filter(([, r]) => r.role === 'attachment'));
          }
          return true;
        },
        async putPage(o, page, result) {
          if (!leaseOk(o)) return false;
          if (row.results[String(page)]?.status === 'done') return false;
          row.results[String(page)] = JSON.parse(JSON.stringify(result));
          record('page_result', result);
          row.heartbeatAt = clock.now;
          return true;
        },
        async release(o) {
          if (row.leaseOwner === o) {
            row.leaseOwner = null;
            row.leaseUntil = null;
          }
        },
        async loadBaseDocument() {
          return { docType: 'settlement', summary: 'saved week', settlement: { carrier: doc.carrier ?? '', grossRevenue: 1000, deductions: [] } };
        },
      },
      model: {
        async wholeDocument(timeoutMs): Promise<ModelOutcome> {
          checkStart(timeoutMs, 'whole document');
          modelCalls.whole++;
          modelCalls.total++;
          const ms = doc.wholeDocMs ?? doc.pages.reduce((s, p) => s + (p.readMs ?? PAGE_READ_MS[p.kind]) / 3, 0);
          return hold((fileBytes * 4) / 3, Math.min(ms, timeoutMs), () =>
            ms > timeoutMs
              ? { errorType: 'timeout' as const, message: 'timed out' }
              : { extraction: mergePages(doc.pages.map((p, i) => ({ page: i + 1, extraction: defaultExtraction(p, i + 1, doc.carrier) })), null) }
          );
        },
        async classifyWindow(start, maxEnd, timeoutMs): Promise<ClassifyOutcome> {
          checkStart(timeoutMs, `classify ${start}-${maxEnd}`);
          let end = maxEnd;
          const windowBytes = (a: number, b: number) => doc.pages.slice(a - 1, b).reduce((s, p) => s + p.bytes, 0);
          while (windowBytes(start, end) > CLASSIFY_WINDOW_MAX_BYTES && end > start) end = start + Math.floor((end - start + 1) / 2) - 1;
          if (end - start + 1 > 20) violations.push(`classify window ${start}-${end} has more than 20 pages`);
          if (windowBytes(start, end) > CLASSIFY_WINDOW_MAX_BYTES) return { errorType: 'oversized', message: 'page too large' };
          modelCalls.classify++;
          modelCalls.total++;
          const ms = CLASSIFY_BASE_MS + CLASSIFY_PER_PAGE_MS * (end - start + 1);
          return hold((windowBytes(start, end) * 4) / 3, Math.min(ms, timeoutMs), (): ClassifyOutcome => {
            if (ms > timeoutMs) return { errorType: 'timeout', message: 'timed out' };
            if (doc.classifyFails) return { errorType: 'parse_failed', message: 'unreadable classification' };
            const pages: ClassifiedPage[] = [];
            for (let p = start; p <= end; p++) pages.push({ page: p, kind: doc.pages[p - 1].kind, hasTotalCashFlow: !!doc.pages[p - 1].tcf });
            const hasSettlement = pages.some((p) => p.kind === 'settlement' || p.kind === 'statement');
            return { pages, carrier: hasSettlement ? doc.carrier : null, windowEnd: end };
          });
        },
        async readPage(page, kind, timeoutMs): Promise<ModelOutcome> {
          checkStart(timeoutMs, `page ${page}`);
          const spec = doc.pages[page - 1];
          modelCalls.total++;
          if (kind === 'toll_bill' || kind === 'repair_invoice') modelCalls.attachment++;
          else modelCalls.content++;
          pageCalls.set(page, (pageCalls.get(page) ?? 0) + 1);
          const seenTimeouts = timeoutsSeen.get(page) ?? 0;
          let ms = spec.readMs ?? PAGE_READ_MS[spec.kind];
          if (spec.fail === 'always_timeout' || (spec.fail === 'timeout_once' && seenTimeouts === 0)) ms = Number.POSITIVE_INFINITY;
          return hold((spec.bytes * 4) / 3, Math.min(ms, timeoutMs), (): ModelOutcome => {
            if (ms > timeoutMs) {
              timeoutsSeen.set(page, seenTimeouts + 1);
              return { errorType: 'timeout', message: `timed out on page ${page}` };
            }
            if (spec.fail === 'parse_failed') return { errorType: 'parse_failed', message: 'unreadable reply' };
            return { extraction: defaultExtraction(spec, page, doc.carrier) };
          });
        },
      },
      merge: mergePages,
      scrub: scrubBankDigits,
      isPrimeCarrier: (c) => !!c && c.toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim() === 'PRIME INC',
      logUsage: async (callType, success) => {
        usage.push({ callType, success });
      },
      consumeCreditIfOverAllowance: async () => {},
      continueInNewInvocation: async () => {
        if (!opts.dropSelfInvoke) queue.push(clock.now + 1_000);
      },
      startHeartbeat: () => () => {},
      log: () => {},
    };
  }

  function startInvocation(): void {
    const id = nextId++;
    const owner = `run-${id}`;
    const startMs = clock.now;
    const kill = opts.killAt?.find((k) => k.invocation === id);
    const entry = { owner, done: false, startMs, killAtMs: startMs + (kill ? kill.afterMs : wallClockMs) };
    running.set(id, entry);
    const log: InvocationLog = { id, startMs, endMs: null, killed: false, result: null };
    invocations.push(log);
    runJobStep(buildDeps(id, owner, startMs)).then(
      (result) => {
        if (killed.has(owner)) return;
        entry.done = true;
        log.endMs = clock.now;
        log.result = result;
      },
      () => {
        entry.done = true;
        log.endMs = clock.now;
      }
    );
  }

  const maxSimMs = opts.maxSimMs ?? 3 * 60 * 60 * 1000;
  for (let guard = 0; guard < 200_000; guard++) {
    await flush();
    await flush();
    for (const [id, r] of [...running]) {
      if (r.done) running.delete(id);
    }
    // Start queued invocations that are due.
    queue.sort((a, b) => a - b);
    while (queue.length > 0 && queue[0] <= clock.now) {
      queue.shift();
      startInvocation();
    }
    await flush();
    await flush();
    for (const [id, r] of [...running]) if (r.done) running.delete(id);

    if (running.size === 0 && queue.length === 0) {
      const pendingWork =
        ['queued', 'processing', 'paused', 'waiting_to_retry'].includes(row.status) ||
        (row.status === 'ready' && row.plan.phase !== 'done' && row.plan.pages.some((p) => p.role === 'attachment' && !['done', 'failed'].includes(row.results[String(p.page)]?.status ?? '')));
      if (row.status === 'needs_decision' && opts.answerPageCap) {
        if (opts.answerPageCap === 'cancel') {
          row.status = 'failed';
          row.errorStep = 'cancelled';
          break;
        }
        row.plan = { ...row.plan, phase: 'pages', pageCap: { cap: row.plan.pageCap?.cap ?? 40, answer: 'read_first' } };
        row.status = 'queued';
        queue.push(clock.now + 5_000);
        opts = { ...opts, answerPageCap: null };
        continue;
      }
      if (pendingWork) {
        // The app's backup restart, once the heartbeat is old enough.
        queue.push(Math.max(clock.now, row.heartbeatAt + (opts.autoResumeAfterMs ?? 180_000)));
        continue;
      }
      break;
    }

    // Kill workers that reach their stop time.
    const nextKill = Math.min(...[...running.values()].map((r) => r.killAtMs), Number.POSITIVE_INFINITY);
    const nextTimer = clock.nextAt() ?? Number.POSITIVE_INFINITY;
    const nextQueued = queue.length > 0 ? Math.min(...queue) : Number.POSITIVE_INFINITY;
    const next = Math.min(nextKill, nextTimer, nextQueued);
    if (!Number.isFinite(next)) break;
    if (next > maxSimMs) break;
    clock.now = Math.max(clock.now, next);
    for (const [id, r] of [...running]) {
      if (!r.done && r.killAtMs <= clock.now) {
        killed.add(r.owner);
        clock.drop(r.owner);
        const log = invocations.find((l) => l.id === id)!;
        log.killed = true;
        log.endMs = clock.now;
        running.delete(id);
      }
    }
    clock.fireDue();
  }

  return { row, readyAtMs, finishedAtMs: clock.now, invocations, modelCalls, pageCalls, writes, usage, violations, peakMemoryBytes };
}

// ---------------------------------------------------------------------
// Synthetic documents
// ---------------------------------------------------------------------
const KB = 1024;
export const TEXT_PAGE_BYTES = 60 * KB; // a native text page (estimate)
export const SCAN_PAGE_BYTES = 450 * KB; // a scanned attachment page (estimate)

// A Prime week: `settlementPages` + 2 statement pages (TOTAL CASH FLOW on
// the second), then `attachments` in the given kind order.
export function primeDoc(settlementPages: number, attachments: PageKind[]): DocSpec {
  const pages: PageSpec[] = [];
  for (let i = 0; i < settlementPages; i++) pages.push({ kind: 'settlement', bytes: TEXT_PAGE_BYTES });
  pages.push({ kind: 'statement', bytes: TEXT_PAGE_BYTES });
  pages.push({ kind: 'statement', bytes: TEXT_PAGE_BYTES, tcf: true });
  for (const kind of attachments) pages.push({ kind, bytes: SCAN_PAGE_BYTES });
  return { carrier: 'Prime Inc.', pages };
}

// N attachment kinds cycling toll bill, repair invoice, delivery receipt.
export function attachmentMix(n: number): PageKind[] {
  const cycle: PageKind[] = ['toll_bill', 'repair_invoice', 'delivery_receipt'];
  return Array.from({ length: n }, (_, i) => cycle[i % cycle.length]);
}

export function unknownCarrierDoc(totalPages: number): DocSpec {
  return { carrier: 'Acme Freight', pages: Array.from({ length: totalPages }, () => ({ kind: 'settlement' as PageKind, bytes: TEXT_PAGE_BYTES })) };
}
