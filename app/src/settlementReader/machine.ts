// THE READER'S STATE MACHINE (owner decision 2026-11-13, P4). Four states:
// reading, ready, needs_input, failed. The SERVER runs this (bundled into
// supabase/functions/ai-import/reader/core.gen.js) and persists the result
// in import_jobs.progress.reader; the app only renders it.
//   - At most MAX_CONTENT_READS content reads per job, counted when a read
//     STARTS (a killed worker's read counts too) and persisted.
//   - A read whose result is identical to an earlier read stops at once.
//   - No state loops: reading -> ready | needs_input | failed;
//     needs_input -> ready | failed (the owner's answers, no model call);
//     failed -> reading only through "Read again", only while reads remain.
// Pure: every function takes the progress and returns the next one.
import { evaluateSettlementGate, type SettlementGateResult } from '@/src/import/settlementGate';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { profitLinesToAsk, withTypedStatementLines } from '@/src/import/primeStatementTemplate';
import type { Extraction } from '@/src/import/types';
import type { CostEntry } from './cost';
import type { ContentRange, RangeResult } from './range';
import { combineParts, type AttachmentReply, type ContentReading, type SettlementPart, type StatementPart } from './schema';
import { cell, readingToExtraction } from './toExtraction';

export const READER_VERSION = 2;
export const MAX_CONTENT_READS = 2;

export type ReaderState = 'reading' | 'ready' | 'needs_input' | 'failed';
export type ReaderStep = 'range' | 'content' | 'split_settlement' | 'split_statement' | 'done';
export type JobStatus = 'queued' | 'processing' | 'ready' | 'needs_decision' | 'failed';

export type ModelError = 'timeout' | 'max_tokens' | 'refusal' | 'unreadable_reply' | 'busy' | 'api_error';
export type CallOutcome<T> = { ok: true; value: T } | { ok: false; error: ModelError; detail?: string };

export type ReaderFailureReason =
  | NonNullable<Extract<SettlementGateResult, { status: 'fail' }>['reason']>
  | 'range_not_found'
  | 'model_failed'
  | 'same_result'
  | 'old_reader'
  | 'too_many_runs';
export type ReaderFailure = {
  reason: ReaderFailureReason;
  // The model error behind model_failed / range failures.
  error?: ModelError;
  // The failing gate check: its name, what the statement printed and what
  // the other printed figures add up to (never bank digits).
  check?: string;
  printed?: number | string;
  read?: number | string;
  failures?: string[];
};

export type ReadRecord = { n: number; signature: string; outcome: 'ready' | 'needs_input' | 'failed' | 'model_failed'; reason?: string };
export type Question = { label: string; printed: string };

export type ReaderProgress = {
  v: typeof READER_VERSION;
  state: ReaderState;
  step: ReaderStep;
  pagesTotal: number;
  // The owner's local calendar day of the import (the date gate's "today").
  importDate: string;
  // Server runs of this job (a chain that never ends is stopped).
  runs: number;
  readsStarted: number;
  reads: ReadRecord[];
  range: ContentRange | null;
  // The first half of a fallback split, kept until the second half is read.
  splitSettlement: SettlementPart | null;
  failure: ReaderFailure | null;
  questions: Question[];
  attachments: { total: number; done: number[]; failed: number[]; notRead: number };
  cost: CostEntry[];
  // 'read_again' when the owner asked; 'auto' when the job read again itself.
  lastReadCause: 'first' | 'auto' | 'read_again';
};

// What the server writes next: the progress, the job status column and,
// when a reading finished, the contract Extraction for result_json.
export type Transition = { progress: ReaderProgress; status: JobStatus; extraction?: Extraction };

export function newReaderProgress(pagesTotal: number, importDate = ''): ReaderProgress {
  return {
    v: READER_VERSION,
    state: 'reading',
    step: 'range',
    pagesTotal,
    importDate,
    runs: 0,
    readsStarted: 0,
    reads: [],
    range: null,
    splitSettlement: null,
    failure: null,
    questions: [],
    attachments: { total: 0, done: [], failed: [], notRead: 0 },
    cost: [],
    lastReadCause: 'first',
  };
}

export function isReaderProgress(p: unknown): p is ReaderProgress {
  return !!p && typeof p === 'object' && (p as { v?: unknown }).v === READER_VERSION;
}

export function statusOf(state: ReaderState): JobStatus {
  return state === 'reading' ? 'processing' : state === 'ready' ? 'ready' : state === 'needs_input' ? 'needs_decision' : 'failed';
}

const t = (progress: ReaderProgress, extraction?: Extraction): Transition => ({ progress, status: statusOf(progress.state), ...(extraction ? { extraction } : {}) });

function failed(p: ReaderProgress, failure: ReaderFailure): ReaderProgress {
  return { ...p, state: 'failed', step: 'done', failure, splitSettlement: null };
}

// ---- range ----------------------------------------------------------------

export function afterRange(p: ReaderProgress, outcome: CallOutcome<RangeResult>): Transition {
  if (!outcome.ok) return t(failed(p, { reason: 'range_not_found', error: outcome.error }));
  if (!outcome.value.ok) return t(failed(p, { reason: 'range_not_found' }));
  const range = outcome.value.range;
  return t({
    ...p,
    range,
    step: 'content',
    attachments: { total: range.attachmentPages.length, done: [], failed: [], notRead: range.attachmentsNotRead },
  });
}

// ---- content --------------------------------------------------------------

// Called (and persisted) BEFORE the content call: the read counts even if
// the worker dies during the call. null = no read left.
export function startContentRead(p: ReaderProgress): ReaderProgress | null {
  if (p.state !== 'reading' || p.step !== 'content') return null;
  if (p.readsStarted >= MAX_CONTENT_READS) return null;
  return { ...p, readsStarted: p.readsStarted + 1 };
}

// A content call (or a split half) that failed: one more read when reads
// remain (P4: max 2), else failed with the model's error.
function readFailed(p: ReaderProgress, error: ModelError): Transition {
  const reads = [...p.reads, { n: p.readsStarted, signature: '', outcome: 'model_failed' as const, reason: error }];
  if (p.readsStarted < MAX_CONTENT_READS) return t({ ...p, reads, step: 'content', splitSettlement: null, lastReadCause: 'auto' });
  return t(failed({ ...p, reads }, { reason: 'model_failed', error }));
}

export type DecideContext = { importDate: string };

export function afterContent(p: ReaderProgress, outcome: CallOutcome<ContentReading>, ctx: DecideContext): Transition {
  if (outcome.ok) return decideReading(p, outcome.value, ctx);
  // P1: only a timeout or a cut-off reply splits the read in two.
  if ((outcome.error === 'timeout' || outcome.error === 'max_tokens') && p.range?.statementFirst != null) {
    return t({ ...p, step: 'split_settlement', splitSettlement: null });
  }
  return readFailed(p, outcome.error);
}

export function afterSplitSettlement(p: ReaderProgress, outcome: CallOutcome<SettlementPart>): Transition {
  if (!outcome.ok) return readFailed(p, outcome.error);
  return t({ ...p, step: 'split_statement', splitSettlement: outcome.value });
}

export function afterSplitStatement(p: ReaderProgress, outcome: CallOutcome<StatementPart>, ctx: DecideContext): Transition {
  if (!outcome.ok || !p.splitSettlement) return readFailed(p, outcome.ok ? 'api_error' : outcome.error);
  return decideReading({ ...p, splitSettlement: null }, combineParts(p.splitSettlement, outcome.value), ctx);
}

// Not a settlement (the range call said so): the general reader read the
// file in one call. A reply that IS a settlement means the range call was
// wrong: failed, never a settlement saved without the gate.
export function afterGeneral(p: ReaderProgress, outcome: CallOutcome<Extraction>): Transition {
  if (!outcome.ok) return readFailed(p, outcome.error);
  const e = outcome.value;
  const reads = [...p.reads, { n: p.readsStarted, signature: '', outcome: e.docType === 'settlement' ? ('failed' as const) : ('ready' as const) }];
  if (e.docType === 'settlement') return t(failed({ ...p, reads }, { reason: 'range_not_found' }));
  return t({ ...p, state: 'ready', step: 'done', reads, failure: null }, e);
}

// ---- the decision (server-side; the one gate) -----------------------------

// A stable fingerprint of what was read (identical results stop at once).
export function readingSignature(extraction: Extraction): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, stable((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  const text = JSON.stringify(stable(extraction.settlement ?? extraction));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type Verdict =
  | { state: 'ready' }
  | { state: 'needs_input'; questions: Question[] }
  | { state: 'failed'; failure: ReaderFailure };

// The one gate on the sanitized reading (dates parsed from the printed
// text, miles, statement check), then the profit lines the owner must type.
export function verdictOf(extraction: Extraction, ctx: DecideContext): Verdict {
  if (extraction.docType !== 'settlement' || !extraction.settlement) return { state: 'ready' };
  const sanitized = sanitizeExtraction(extraction);
  const gate = evaluateSettlementGate(sanitized, { importDate: ctx.importDate });
  if (!gate) return { state: 'ready' };
  if (gate.status === 'fail') {
    const d = gate.details?.[0];
    return {
      state: 'failed',
      failure: { reason: gate.reason, failures: gate.failures, ...(d ? { check: d.check, printed: d.printed, read: d.read } : {}) },
    };
  }
  const questions = profitLinesToAsk(sanitized).map((q) => ({ label: q.label, printed: q.printed }));
  return questions.length > 0 ? { state: 'needs_input', questions } : { state: 'ready' };
}

export function decideReading(p: ReaderProgress, reading: ContentReading, ctx: DecideContext): Transition {
  const range = p.range;
  const extraction = readingToExtraction(reading, {
    pagesTotal: p.pagesTotal,
    contentPages: range ? Array.from({ length: range.lastContentPage }, (_, i) => i + 1) : [],
    attachmentPages: range?.attachmentPages ?? [],
  });
  const signature = readingSignature(extraction);
  const same = p.reads.some((r) => r.signature === signature);
  const verdict = verdictOf(extraction, ctx);
  const record = (outcome: ReadRecord['outcome'], reason?: string): ReadRecord[] => [...p.reads, { n: p.readsStarted, signature, outcome, ...(reason ? { reason } : {}) }];
  if (verdict.state === 'ready') return t({ ...p, state: 'ready', step: 'done', reads: record('ready'), failure: null, questions: [] }, extraction);
  if (verdict.state === 'needs_input') {
    return t({ ...p, state: 'needs_input', step: 'done', reads: record('needs_input'), failure: null, questions: verdict.questions }, extraction);
  }
  const reads = record('failed', verdict.failure.reason);
  if (same) return t(failed({ ...p, reads }, { ...verdict.failure, reason: verdict.failure.reason }), extraction);
  if (p.readsStarted < MAX_CONTENT_READS) return t({ ...p, reads, step: 'content', lastReadCause: 'auto' }, extraction);
  return t(failed({ ...p, reads }, verdict.failure), extraction);
}

// ---- the owner's answers (needs_input; no model call) ---------------------

export function afterAnswers(p: ReaderProgress, extraction: Extraction, answers: { label: string; amount: number }[], ctx: DecideContext): Transition | null {
  if (p.state !== 'needs_input') return null;
  const typed = withTypedStatementLines(extraction, answers);
  const verdict = verdictOf(typed, ctx);
  if (verdict.state === 'ready') return t({ ...p, state: 'ready', questions: [], failure: null }, typed);
  if (verdict.state === 'needs_input') return t({ ...p, questions: verdict.questions }, typed);
  return t(failed(p, verdict.failure), typed);
}

// ---- Read again (failed only, counts toward the max) ----------------------

export function canReadAgain(p: ReaderProgress): boolean {
  return p.state === 'failed' && p.range != null && p.readsStarted < MAX_CONTENT_READS;
}

export function readAgain(p: ReaderProgress): Transition | null {
  if (!canReadAgain(p)) return null;
  return t({ ...p, state: 'reading', step: 'content', failure: null, lastReadCause: 'read_again' });
}

// ---- attachments (P5: after the card, best effort, never gating) ----------

export function pendingAttachments(p: ReaderProgress): number[] {
  if (p.state !== 'ready' && p.state !== 'needs_input') return [];
  const done = new Set([...p.attachments.done, ...p.attachments.failed]);
  return (p.range?.attachmentPages ?? []).filter((page) => !done.has(page));
}

export function afterAttachment(p: ReaderProgress, extraction: Extraction, page: number, outcome: CallOutcome<AttachmentReply>): { progress: ReaderProgress; extraction: Extraction } {
  const attachments = outcome.ok
    ? { ...p.attachments, done: [...p.attachments.done, page] }
    : { ...p.attachments, failed: [...p.attachments.failed, page] };
  const next = withAttachment(extraction, page, outcome.ok ? outcome.value : null);
  return { progress: { ...p, attachments }, extraction: next };
}

const cellText = (v: string) => (v ?? '').trim();
const money = (v: string): number | undefined => cell(v) ?? undefined;

// An attachment adds detail rows only (a repair invoice, toll items) and
// marks its page read; it never touches a total.
export function withAttachment(extraction: Extraction, page: number, reply: AttachmentReply | null): Extraction {
  const pageMap = (extraction.pageMap ?? []).map((m) => (m.page === page ? { ...m, status: reply ? ('read' as const) : ('failed' as const), kind: reply?.kind ?? m.kind } : m));
  const s = extraction.settlement;
  if (!s || !reply || reply.kind === 'other') return { ...extraction, pageMap };
  if (reply.kind === 'repair_invoice') {
    const r = reply.repair;
    const item = { invoice: cellText(r.invoice), unit: cellText(r.unit), desc: [cellText(r.shop), cellText(r.description)].filter(Boolean).join(' — '), odometer: money(r.odometer), total: money(r.total) };
    return { ...extraction, pageMap, settlement: { ...s, maintenance: [...(s.maintenance ?? []), item] } };
  }
  const key = /DRIVEWYZE/i.test(reply.tolls.agency) ? 'drivewyze' : 'ezpass';
  const prev = s.tolls?.[key] ?? {};
  const items = reply.tolls.items.map((i) => ({ date: cellText(i.date), plaza: cellText(i.plaza), location: cellText(i.location), amount: money(i.amount) }));
  const total = money(reply.tolls.total);
  return {
    ...extraction,
    pageMap,
    settlement: { ...s, tolls: { ...(s.tolls ?? {}), [key]: { total: (prev.total ?? 0) + (total ?? 0), items: [...(prev.items ?? []), ...items] } } },
  };
}

// A job row written by the old page-by-page reader: shown failed with
// Read again (a new job), never interpreted.
export function oldReaderFailure(): ReaderFailure {
  return { reason: 'old_reader' };
}
