// THE READER'S RUN LOOP (owner decision 2026-11-13). One server run of a
// reader job: range -> one content read (or the fallback split) -> the one
// gate -> attachments, saving after every model call, until the job is
// final or the run's time is up (then the next run continues). Pure: every
// effect (model call, PDF subset, job row write, usage log) is injected by
// the Edge Function (supabase/functions/ai-import/reader/server.ts), so the
// whole loop is tested here with simulated replies.
import type { Extraction } from '@/src/import/types';
import { costEntry, ROLE_EFFORT, ROLE_MODEL, type CostEntry, type ReaderRole, type Usage } from './cost';
import {
  afterAttachment,
  afterContent,
  afterGeneral,
  afterRange,
  afterSplitSettlement,
  afterSplitStatement,
  pendingAttachments,
  startContentRead,
  type CallOutcome,
  type JobStatus,
  type ReaderProgress,
  type Transition,
} from './machine';
import { ATTACHMENT_PROMPT, CONTENT_PROMPT, RANGE_PROMPT, SETTLEMENT_PART_PROMPT, STATEMENT_PART_PROMPT } from './prompt';
import { contentRange, pagesUpTo, RANGE_WINDOW_PAGES } from './range';
import {
  ATTACHMENT_SCHEMA,
  CONTENT_SCHEMA,
  RANGE_SCHEMA,
  SETTLEMENT_PART_SCHEMA,
  STATEMENT_PART_SCHEMA,
  type AttachmentReply,
  type ContentReading,
  type JsonSchema,
  type RangeReply,
  type SettlementPart,
  type StatementPart,
} from './schema';

// Preferred / minimum call timeouts. A call that cannot get its minimum in
// this run is not started; the next run does it.
export const CALL_TIMEOUTS: Record<ReaderRole | 'general', { preferredMs: number; minMs: number; maxTokens: number }> = {
  range: { preferredMs: 60_000, minMs: 30_000, maxTokens: 8_000 },
  content: { preferredMs: 240_000, minMs: 90_000, maxTokens: 32_000 },
  split_settlement: { preferredMs: 200_000, minMs: 75_000, maxTokens: 24_000 },
  split_statement: { preferredMs: 200_000, minMs: 75_000, maxTokens: 24_000 },
  attachment: { preferredMs: 45_000, minMs: 20_000, maxTokens: 8_000 },
  general: { preferredMs: 180_000, minMs: 60_000, maxTokens: 16_000 },
};
// A chain of runs that never ends is stopped (each run makes progress or
// waits for time; 12 runs is far beyond one 21-page file).
export const MAX_READER_RUNS = 12;

export type ModelRequest = {
  role: ReaderRole;
  model: string;
  effort: 'low' | 'medium';
  // Pages of the ORIGINAL file, sent as one PDF in this order.
  pages: number[];
  system: string;
  userText: string;
  schema: JsonSchema;
  timeoutMs: number;
  maxTokens: number;
};
export type ModelReply = { outcome: CallOutcome<unknown>; usage: Usage | null; ms: number };

export type RunLimits = { exitByMs: number; callEndLimitMs: number; startMarginMs: number };

export type ReaderIO = {
  limits: RunLimits;
  elapsedMs(): number;
  call(req: ModelRequest): Promise<ModelReply>;
  // The general (non-settlement) reader on the whole file: the existing
  // extraction prompt, one call.
  general(timeoutMs: number): Promise<ModelReply>;
  // Writes the job row (lease-checked). false = this run lost the job.
  save(t: { progress: ReaderProgress; status: JobStatus; extraction?: Extraction | null; final?: boolean }): Promise<boolean>;
  // One ai_usage_log row per import: success when the job first reaches
  // ready / needs_input, failure when it fails (and the credit, if over).
  logImport(success: boolean, reason?: string): Promise<void>;
  continueInNextRun(): Promise<void>;
  log(message: string): void;
};

export type RunResult = { kind: 'final' | 'continued' | 'lease_lost' | 'idle'; calls: number };

class LeaseLost extends Error {}

function timeoutFor(io: ReaderIO, role: ReaderRole | 'general'): number | null {
  const c = CALL_TIMEOUTS[role];
  const elapsed = io.elapsedMs();
  if (elapsed >= io.limits.exitByMs) return null;
  const room = io.limits.callEndLimitMs - io.limits.startMarginMs - elapsed;
  const timeout = Math.min(c.preferredMs, room);
  return timeout >= c.minMs ? timeout : null;
}

const isFinal = (p: ReaderProgress) => p.state !== 'reading';

export async function runReader(start: { progress: ReaderProgress; extraction: Extraction | null }, io: ReaderIO): Promise<RunResult> {
  let p: ReaderProgress = { ...start.progress, runs: (start.progress.runs ?? 0) + 1 };
  let extraction: Extraction | null = start.extraction;
  let calls = 0;
  const importDate = p.importDate;

  async function save(next: Transition | { progress: ReaderProgress; status: JobStatus }, final = false): Promise<void> {
    const wasReading = p.state === 'reading';
    p = next.progress;
    if ('extraction' in next && next.extraction) extraction = next.extraction;
    const ok = await io.save({ progress: p, status: next.status, ...('extraction' in next && next.extraction ? { extraction: next.extraction } : {}), final });
    if (!ok) throw new LeaseLost();
    if (wasReading && (p.state === 'ready' || p.state === 'needs_input')) await io.logImport(true);
    if (wasReading && p.state === 'failed') await io.logImport(false, `${p.failure?.reason ?? 'failed'}${p.failure?.error ? `: ${p.failure.error}` : ''}`);
  }
  const status = (): JobStatus => (p.state === 'reading' ? 'processing' : p.state === 'ready' ? 'ready' : p.state === 'needs_input' ? 'needs_decision' : 'failed');
  function withCost(role: ReaderRole, req: { model: string }, reply: ModelReply, page?: number): CostEntry {
    const entry = costEntry(role, req.model, reply.usage, reply.ms, reply.outcome.ok ? 'ok' : reply.outcome.error, page);
    io.log(`COST role=${role} model=${req.model}${page != null ? ` page=${page}` : ''} in=${entry.inputTokens} cacheW=${entry.cacheWriteTokens} cacheR=${entry.cacheReadTokens} out=${entry.outputTokens} usd=${entry.usd} ms=${entry.ms} outcome=${entry.outcome}`);
    return entry;
  }
  async function ask<T>(role: ReaderRole, pages: number[], system: string, userText: string, schema: JsonSchema, timeoutMs: number, page?: number): Promise<CallOutcome<T>> {
    const req: ModelRequest = { role, model: ROLE_MODEL[role], effort: ROLE_EFFORT[role], pages, system, userText, schema, timeoutMs, maxTokens: CALL_TIMEOUTS[role].maxTokens };
    const reply = await io.call(req);
    calls++;
    p = { ...p, cost: [...p.cost, withCost(role, req, reply, page)] };
    return reply.outcome as CallOutcome<T>;
  }
  async function later(): Promise<RunResult> {
    await save({ progress: p, status: status() });
    await io.continueInNextRun();
    return { kind: 'continued', calls };
  }

  try {
    if (p.runs > MAX_READER_RUNS && p.state === 'reading') {
      await save(
        { progress: { ...p, state: 'failed', step: 'done', failure: { reason: 'too_many_runs' } }, status: 'failed' },
        true
      );
      return { kind: 'final', calls };
    }
    if (p.state === 'reading') await save({ progress: p, status: 'processing' });

    // ---- reading ----
    while (p.state === 'reading') {
      if (p.step === 'range') {
        const timeout = timeoutFor(io, 'range');
        if (timeout == null) return await later();
        const window = Math.min(p.pagesTotal, RANGE_WINDOW_PAGES);
        const reply = await ask<RangeReply>('range', pagesUpTo(window), RANGE_PROMPT, `This file is pages 1-${window} of a ${p.pagesTotal}-page PDF.`, RANGE_SCHEMA, timeout);
        const t = afterRange(p, reply.ok ? { ok: true, value: contentRange(reply.value, p.pagesTotal) } : reply);
        await save(t, isFinal(t.progress));
        continue;
      }
      if (p.step === 'content' && p.range && !p.range.isSettlement) {
        const timeout = timeoutFor(io, 'general');
        if (timeout == null) return await later();
        const started = startContentRead(p);
        if (!started) break;
        await save({ progress: started, status: 'processing' });
        const reply = await io.general(timeout);
        calls++;
        p = { ...p, cost: [...p.cost, withCost('content', { model: 'general' }, reply)] };
        const t = afterGeneral(p, reply.outcome as CallOutcome<Extraction>);
        await save(t, isFinal(t.progress));
        continue;
      }
      if (p.step === 'content') {
        const timeout = timeoutFor(io, 'content');
        if (timeout == null) return await later();
        const started = startContentRead(p);
        if (!started) {
          await save({ progress: { ...p, state: 'failed', step: 'done', failure: { reason: 'model_failed' } }, status: 'failed' }, true);
          break;
        }
        // The read counts before the call (a stopped worker's read counts).
        await save({ progress: started, status: 'processing' });
        const last = p.range!.lastContentPage;
        const reply = await ask<ContentReading>('content', pagesUpTo(last), CONTENT_PROMPT, `This file is pages 1-${last} of the settlement PDF.`, CONTENT_SCHEMA, timeout);
        const t = afterContent(p, reply, { importDate });
        await save(t, isFinal(t.progress));
        continue;
      }
      if (p.step === 'split_settlement') {
        const timeout = timeoutFor(io, 'split_settlement');
        if (timeout == null) return await later();
        const last = p.range!.statementFirst! - 1;
        const reply = await ask<SettlementPart>('split_settlement', pagesUpTo(last), SETTLEMENT_PART_PROMPT, `This file is pages 1-${last} of the settlement PDF.`, SETTLEMENT_PART_SCHEMA, timeout);
        const t = afterSplitSettlement(p, reply);
        await save(t, isFinal(t.progress));
        continue;
      }
      if (p.step === 'split_statement') {
        const timeout = timeoutFor(io, 'split_statement');
        if (timeout == null) return await later();
        const first = p.range!.statementFirst!;
        const last = p.range!.lastContentPage;
        const reply = await ask<StatementPart>('split_statement', pagesUpTo(last, first), STATEMENT_PART_PROMPT, `This file is pages ${first}-${last} of the settlement PDF.`, STATEMENT_PART_SCHEMA, timeout);
        // The reply numbers this file's pages from 1: back to the original.
        const fixed: CallOutcome<StatementPart> = reply.ok
          ? { ok: true, value: { statement: { ...reply.value.statement, rows: reply.value.statement.rows.map((r) => ({ ...r, page: r.page + first - 1 })) } } }
          : reply;
        const t = afterSplitStatement(p, fixed, { importDate });
        await save(t, isFinal(t.progress));
        continue;
      }
      break;
    }

    // ---- attachments (P5: after the card, never gating) ----
    for (const page of pendingAttachments(p)) {
      if (!extraction) break;
      const timeout = timeoutFor(io, 'attachment');
      if (timeout == null) return await later();
      const reply = await ask<AttachmentReply>('attachment', [page], ATTACHMENT_PROMPT, `This file is page ${page} of the settlement PDF.`, ATTACHMENT_SCHEMA, timeout, page);
      const next = afterAttachment(p, extraction, page, reply);
      await save({ progress: next.progress, status: status(), extraction: next.extraction });
    }
    if (p.state !== 'reading') {
      const total = p.cost.reduce((s, e) => s + e.usd, 0);
      io.log(`READER final state=${p.state} reads=${p.readsStarted} calls=${p.cost.length} usd=${Math.round(total * 10000) / 10000}${p.failure ? ` reason=${p.failure.reason}` : ''}`);
      await save({ progress: p, status: status() }, true);
      return { kind: 'final', calls };
    }
    return { kind: 'idle', calls };
  } catch (err) {
    if (err instanceof LeaseLost) {
      io.log('lease lost — another run owns this job now');
      return { kind: 'lease_lost', calls };
    }
    throw err;
  }
}

