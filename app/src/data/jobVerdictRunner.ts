// RE-READ RULES (owner decision 2026-11-03): the job layer, not the review
// card, decides what happens to a finished reading. Mounted once with
// ImportJobsChip (always on screen). For every job that finished reading and
// has no verdict for its current read, it runs the one gate and posts the
// verdict to the job (ai-import 'job_verdict'): the server persists
// ready_final / failed_final or starts the re-read itself, capped at 3 reads
// per job. The server ignores a verdict for an older read or a final job,
// so opening the jobs list or a restart can never start a read.
//
// NEVER A GENERIC FAILURE (owner decision 2026-11-03, "ready jobs show
// could not read"): before this fix, ANY error from the verdict call (an
// ai-import without 'job_verdict', a network error, an answer without
// `action`) was turned into a LOCAL failed_final with no reason, and the
// jobs list showed a bare "We couldn't read this statement" for a job the
// server had marked ready. Now an error never decides a failure: the job
// stays "Finishing up" and the call is retried (5 s, 15 s, 30 s, then every
// 60 s); the last problem is kept per job (verdictProblemOf) for the row and
// the report. Only a PASSING reading may be decided here when the server
// cannot take verdicts (the card shows; certify runs the same gate again).
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useCarrierCodeCategories } from '@/src/data/carrierCodeMaps';
import { fetchImportJobResult, IMPORT_JOBS_QUERY_KEY, useImportJobs } from '@/src/data/importJobs';
import { isAwaitingVerdict, markRereadRequested, readsOf, setLocalFinal } from '@/src/import/importJobs';
import { parseVerdictResponse, verdictOfReading, verdictRetryDelay, type JobVerdict, type VerdictResponse } from '@/src/import/jobVerdict';

export { parseVerdictResponse, VerdictAnswerError, verdictRetryDelay, VERDICT_RETRY_MS, type VerdictResponse } from '@/src/import/jobVerdict';
import { todayDateOnly } from '@/src/lib/dateOnly';

async function errorCode(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.status === 'number') {
    try {
      const body = (await ctx.json()) as { error?: { type?: unknown } } | null;
      const type = body?.error?.type;
      return typeof type === 'string' ? `http ${ctx.status} ${type}` : `http ${ctx.status}`;
    } catch {
      return `http ${ctx.status}`;
    }
  }
  return 'network';
}

export async function submitJobVerdict(jobId: string, verdict: JobVerdict): Promise<VerdictResponse> {
  const { data, error } = await supabase.functions.invoke('ai-import', { body: { mode: 'job_verdict', jobId, verdict } });
  if (error) throw new Error(await errorCode(error));
  return parseVerdictResponse(data);
}

const posted = new Set<string>();
const attempts = new Map<string, number>();
const problems = new Map<string, string>();

// The last problem with this job's verdict call ("http 400 bad_request",
// "server answer missing: action", ...), or null.
export function verdictProblemOf(jobId: string): string | null {
  return problems.get(jobId) ?? null;
}

// NEVER NOTHING (owner decision 2026-11-03, R5): after this many failed
// verdict calls for the job's current read, the screen shows an explicit
// waiting state with a [Check again] button instead of a silent spinner.
export const VERDICT_STUCK_AFTER = 3;
export function isVerdictStuck(jobId: string): boolean {
  let n = 0;
  for (const [key, count] of attempts) if (key.startsWith(`${jobId}:`)) n = Math.max(n, count);
  return n >= VERDICT_STUCK_AFTER && problems.has(jobId);
}

// [Check again]: post this job's verdict now instead of waiting for the
// next retry.
export function checkVerdictAgain(jobId: string, queryClient: { invalidateQueries: (f: { queryKey: readonly unknown[]; refetchType: 'all' }) => Promise<void> }): void {
  for (const key of [...posted]) if (key.startsWith(`${jobId}:`)) posted.delete(key);
  void queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
}

export function useJobVerdictRunner(): void {
  const { data: jobs } = useImportJobs();
  const codes = useCarrierCodeCategories();
  const queryClient = useQueryClient();
  const codesSettled = codes.isSuccess || codes.isError;
  useEffect(() => {
    if (!codesSettled) return;
    for (const job of jobs ?? []) {
      if (!isAwaitingVerdict(job)) continue;
      const readNo = readsOf(job);
      const key = `${job.id}:${readNo}`;
      if (posted.has(key)) continue;
      posted.add(key);
      const retryLater = (problem: string) => {
        problems.set(job.id, problem);
        const n = attempts.get(key) ?? 0;
        attempts.set(key, n + 1);
        setTimeout(() => {
          posted.delete(key);
          void queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
        }, verdictRetryDelay(n));
      };
      void (async () => {
        const extraction = await fetchImportJobResult(job.id).catch(() => null);
        if (!extraction) {
          retryLater('server answer missing: result_json');
          return;
        }
        const verdict = verdictOfReading(extraction, readNo, { importDate: todayDateOnly(), carrierCodes: codes.data ?? [] });
        try {
          const res = await submitJobVerdict(job.id, verdict);
          problems.delete(job.id);
          if (res.action === 'reread') markRereadRequested(job.id);
          // 'ignored' with the job still waiting: post again later.
          if (res.action === 'ignored') retryLater('server ignored the verdict');
        } catch (err) {
          const problem = err instanceof Error ? err.message : String(err);
          // A passing reading may go to the card without the server; a
          // failing one is NEVER decided here.
          if (verdict.status === 'pass' && /bad_request|answer missing/.test(problem)) {
            problems.delete(job.id);
            setLocalFinal(job.id, readNo, 'ready_final');
          } else {
            retryLater(problem);
          }
        }
        await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
      })();
    }
  }, [jobs, codesSettled, codes.data, queryClient]);
}
