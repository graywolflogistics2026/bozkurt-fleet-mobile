// RE-READ RULES (owner decision 2026-11-03, 07/17 import loop). The job
// layer (src/data/jobVerdictRunner.ts, mounted with ImportJobsChip) runs the
// ONE gate (settlementGate.ts) on a finished job's reading and posts this to
// the job (ai-import mode 'job_verdict'), which decides pass / re-read /
// final failure and persists it on the job row. The review card never
// decides a re-read; it renders only for a FINAL job.
import type { CarrierCode } from './carrierCodes';
import { evaluateSettlementGate, rereadRequestFor } from './settlementGate';
import { blockDiagnosisLine, diagnosePrimeBlocks } from './primeStatementTemplate';
import type { Extraction } from './types';
import type { JobReviewState } from './importJobs';

export type JobVerdict = {
  readNo: number;
  status: 'pass' | 'fail';
  reason?: string;
  failures?: string[];
  details?: { check: string; printed: number | string; read: number | string }[];
  pages?: number[] | null;
  // PRIORITY OF EVIDENCE (owner 2026-11-03): a saveable week whose block
  // lines do not add up — its block pages are read ONCE more first.
  lineReread?: { pages: number[]; reason: string } | null;
};

export function verdictOfReading(
  extraction: Extraction | null | undefined,
  readNo: number,
  options: { importDate: string; carrierCodes?: CarrierCode[] }
): JobVerdict {
  // Not a settlement (receipt, fuel, ...): nothing to gate.
  if (!extraction || extraction.docType !== 'settlement' || !extraction.settlement) return { readNo, status: 'pass' };
  const gate = evaluateSettlementGate(extraction, options);
  // needs_date passes: the card asks the one date question.
  if (!gate) return { readNo, status: 'pass' };
  if (gate.status !== 'fail') {
    if (gate.lineDetails !== 'mismatch') return { readNo, status: 'pass' };
    // Line details differ: name the blocks (template) and read their pages
    // once more; the job keeps this reading if that comes back worse.
    const blocks = diagnosePrimeBlocks(extraction);
    const pages = [...new Set(blocks.flatMap((b) => b.pages))].sort((a, b) => a - b);
    const details = blocks.map((b) => ({ check: `block_${b.section}`, printed: b.printed ?? 'not read', read: b.read }));
    if (pages.length === 0) return { readNo, status: 'pass', ...(details.length > 0 ? { details } : {}) };
    return { readNo, status: 'pass', details, lineReread: { pages, reason: blocks.map(blockDiagnosisLine).join(' · ').slice(0, 190) } };
  }
  const request = rereadRequestFor(gate, extraction);
  return {
    readNo,
    status: 'fail',
    reason: gate.reason,
    failures: gate.failures,
    details: gate.details ?? [],
    pages: request?.pages ?? null,
  };
}

// The last re-read triggers, one line each, for the Send report.
export function triggerReportLines(
  triggers: { readNo: number; check: string; printed: number | string | null; value: number | string | null; reason: string }[] | null | undefined,
  limit = 3
): string[] {
  return (triggers ?? []).slice(-limit).map((tr) => `Re-read after read ${tr.readNo}: ${tr.check} printed ${tr.printed ?? '-'}, read ${tr.value ?? '-'} (${tr.reason})`);
}

export type VerdictResponse = { jobId: string; action: 'final' | 'reread' | 'ignored'; review?: JobReviewState };

// A server answer the app cannot use, named by what is missing or wrong.
export class VerdictAnswerError extends Error {
  constructor(public readonly field: string) {
    super(`server answer missing: ${field}`);
  }
}

export function parseVerdictResponse(data: unknown): VerdictResponse {
  if (!data || typeof data !== 'object') throw new VerdictAnswerError('body');
  const action = (data as { action?: unknown }).action;
  if (action !== 'final' && action !== 'reread' && action !== 'ignored') throw new VerdictAnswerError('action');
  return data as VerdictResponse;
}

// Retry delays for a verdict call that did not get a usable answer.
export const VERDICT_RETRY_MS = [5_000, 15_000, 30_000, 60_000];
export function verdictRetryDelay(attempt: number): number {
  return VERDICT_RETRY_MS[Math.min(Math.max(attempt, 0), VERDICT_RETRY_MS.length - 1)];
}
