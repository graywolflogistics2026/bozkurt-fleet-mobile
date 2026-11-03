// RE-READ RULES (owner decision 2026-11-03): the job layer, not the review
// card, decides what happens to a finished reading. Mounted once with
// ImportJobsChip (always on screen). For every job that finished reading and
// has no verdict for its current read, it runs the one gate and posts the
// verdict to the job (ai-import 'job_verdict'): the server persists
// ready_final / failed_final or starts the re-read itself, capped at 3 reads
// per job. One post per (job, read number); the server ignores a verdict
// for an older read or a final job, so opening the jobs list or a restart
// can never start a read.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useCarrierCodeCategories } from '@/src/data/carrierCodeMaps';
import { fetchImportJobResult, IMPORT_JOBS_QUERY_KEY, useImportJobs } from '@/src/data/importJobs';
import { isAwaitingVerdict, markRereadRequested, readsOf, setLocalFinal, type JobReviewState } from '@/src/import/importJobs';
import { verdictOfReading, type JobVerdict } from '@/src/import/jobVerdict';
import { todayDateOnly } from '@/src/lib/dateOnly';

export type VerdictResponse = { jobId: string; action: 'final' | 'reread' | 'ignored'; review?: JobReviewState };

export async function submitJobVerdict(jobId: string, verdict: JobVerdict): Promise<VerdictResponse> {
  const { data, error } = await supabase.functions.invoke('ai-import', { body: { mode: 'job_verdict', jobId, verdict } });
  if (error) throw error;
  const res = data as VerdictResponse | null;
  if (!res || (res.action !== 'final' && res.action !== 'reread' && res.action !== 'ignored')) throw new Error('job_verdict not supported');
  return res;
}

const posted = new Set<string>();

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
      void (async () => {
        const extraction = await fetchImportJobResult(job.id).catch(() => null);
        if (!extraction) {
          posted.delete(key); // not stored yet: the next poll tries again
          return;
        }
        const verdict = verdictOfReading(extraction, readNo, { importDate: todayDateOnly(), carrierCodes: codes.data ?? [] });
        try {
          const res = await submitJobVerdict(job.id, verdict);
          if (res.action === 'reread') markRereadRequested(job.id);
        } catch {
          // An ai-import without 'job_verdict' (or no network): decided here
          // for this read only, never a re-read.
          setLocalFinal(job.id, readNo, verdict.status === 'pass' ? 'ready_final' : 'failed_final');
        }
        await queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
      })();
    }
  }, [jobs, codesSettled, codes.data, queryClient]);
}
