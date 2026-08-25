import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { getSignedDocumentUrl } from '@/src/data/documentViewer';
import { useAuth } from '@/src/context/AuthContext';
import { sanitizeExtractionDates } from '@/src/import/dateGuard';
import { sanitizeExtractionMiles } from '@/src/import/milesGuard';
import { isActiveJob, runBatchWithConcurrency, type ImportJob, type ImportJobStatus } from '@/src/import/importJobs';
import type { Extraction } from '@/src/import/types';

// BACKGROUND IMPORT (owner decision 2026-08-24, docs/PENDING_SQL.md §54)
// — the network/storage half; app/src/import/importJobs.ts holds the
// pure, tested lifecycle/display logic this file's hooks feed into.

type ImportJobRow = {
  id: string;
  status: ImportJobStatus;
  pages_done: number;
  pages_total: number | null;
  file_name: string | null;
  media_type: string;
  error_message: string | null;
  error_step: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const IMPORT_JOB_COLUMNS =
  'id, status, pages_done, pages_total, file_name, media_type, error_message, error_step, created_at, updated_at, completed_at';

function mapRow(row: ImportJobRow): ImportJob {
  return {
    id: row.id,
    status: row.status,
    pagesDone: row.pages_done,
    pagesTotal: row.pages_total,
    fileName: row.file_name,
    mediaType: row.media_type,
    errorMessage: row.error_message,
    errorStep: row.error_step,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export const IMPORT_JOBS_QUERY_KEY = ['import_jobs'];

// POLLING (owner decision 2026-08-24 — "poll or subscribe," polling
// chosen over a Realtime channel subscription for simplicity/
// reliability: no channel lifecycle to manage, and it behaves identically
// whether the screen reading it was just mounted or has been open for an
// hour, which is exactly the "resuming after backgrounding" property this
// feature needs). Fast (3s) while anything is queued/processing so
// progress feels live; slows to a lazy 30s once every job is terminal —
// still catches a job someone retried from another device without
// hammering the DB for a screen that's just sitting idle. This hook is
// safe to mount from MULTIPLE places at once (the persistent chip AND the
// jobs list screen, say) — react-query dedupes by query key, so it's
// still just one real poll, not one per mounted component.
const ACTIVE_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

export function useImportJobs() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery<ImportJob[]>({
    queryKey: IMPORT_JOBS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_jobs')
        .select(IMPORT_JOB_COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    enabled: !!userId,
    refetchInterval: (query) => {
      const jobs = query.state.data as ImportJob[] | undefined;
      return (jobs ?? []).some(isActiveJob) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    // Keep polling even while the query "looks" fresh — the whole point
    // is picking up server-side progress the client had no hand in.
    staleTime: 0,
  });
}

// One job, for the review screen (app/(tabs)/import?reviewJobId=...) —
// a plain one-shot fetch, not polled (a 'ready' job's result_json never
// changes again once terminal).
export function useImportJob(jobId: string | null) {
  return useQuery<ImportJob | null>({
    queryKey: ['import_job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase.from('import_jobs').select(IMPORT_JOB_COLUMNS).eq('id', jobId).maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as ImportJobRow) : null;
    },
    enabled: !!jobId,
  });
}

// Fetches the raw result_json for a 'ready' job and sanitizes it exactly
// like a live extraction (DATE HARDENING/MILES TRAP — see aiImportCall.ts)
// so "Review now" behaves identically to a synchronous import's own
// result, regardless of which path produced it.
export async function fetchImportJobResult(jobId: string): Promise<Extraction | null> {
  const { data, error } = await supabase.from('import_jobs').select('result_json').eq('id', jobId).maybeSingle();
  if (error) throw error;
  const raw = data?.result_json as Extraction | undefined;
  if (!raw) return null;
  return sanitizeExtractionMiles(sanitizeExtractionDates(raw));
}

// "Review now" (owner decision 2026-08-24, item 3) — same sanitized
// extraction as fetchImportJobResult() above, plus the file name the
// preview screen's existing duplicate-check/save flow already expects as
// a second argument (afterExtraction(data, fileName, ...)), plus
// storagePath/mediaType for downloadImportJobFileToLocal() below (Save
// itself still needs a LOCAL file to re-upload to its own final,
// category-organized storage path).
export async function fetchImportJobForReview(
  jobId: string
): Promise<{ extraction: Extraction; fileName: string | undefined; storagePath: string; mediaType: string } | null> {
  const { data, error } = await supabase.from('import_jobs').select('result_json, file_name, status, storage_path, media_type').eq('id', jobId).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'ready' || !data.result_json) return null;
  const raw = data.result_json as Extraction;
  return {
    extraction: sanitizeExtractionMiles(sanitizeExtractionDates(raw)),
    fileName: (data.file_name as string | null) ?? undefined,
    storagePath: data.storage_path as string,
    mediaType: data.media_type as string,
  };
}

// CRITICAL for "Review now" to actually be able to Save: saveExtraction()
// (aiImportSave.ts) reads bytes from a LOCAL file URI and re-uploads them
// to its own final, category-organized storage path — it has no notion
// of an already-uploaded remote path. The ORIGINAL local file the user
// picked from (a device cache URI, set in fileMeta by pickPdf/
// processImage) may well no longer exist by the time a background job is
// reviewed — possibly a different app session entirely after a restart —
// so this downloads the job's own already-uploaded copy from Storage back
// into a fresh local temp file, giving saveExtraction() a real local URI
// to work with, completely unchanged.
//
// BACKGROUND IMPORT CRASH FIX (owner decision 2026-08-24, device report:
// "undefined is not a function" on completion): the ORIGINAL implementation
// called `supabase.storage.from('documents').download(storagePath)` and
// then `data.arrayBuffer()` on the resulting Blob — but React Native's
// built-in `Blob` (node_modules/react-native/Libraries/Blob/Blob.js) never
// implements `arrayBuffer()` (only `slice()`/`size`/`type`), so that call
// threw every single time "Review now" was opened for a background-
// imported job — a genuinely nonexistent method on this platform, not a
// permissions/availability issue. This is the ONLY place in the entire
// codebase that ever called `.arrayBuffer()` on a Storage download (grepped
// before writing this fix), which is exactly why it went untested against
// the real RN runtime. Fixed by reusing the SAME signed-URL +
// `File.downloadFileAsync()` pattern documentViewer.ts's own
// `shareDocumentFile()` already uses successfully in production — a native
// download straight to a local file, no Blob/ArrayBuffer conversion at all.
export async function downloadImportJobFileToLocal(storagePath: string, fileName: string | undefined): Promise<string> {
  const signedUrl = await getSignedDocumentUrl(storagePath);
  const safeName = (fileName ?? storagePath.split('/').pop() ?? 'import-file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const destination = new File(Paths.cache, `review-${Date.now()}-${safeName}`);
  if (destination.exists) destination.delete();
  const file = await File.downloadFileAsync(signedUrl, destination);
  return file.uri;
}

function jobStagingPath(userId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${userId}/import-jobs/${Date.now()}-${safeName}`;
}

// FIRE-AND-FORGET FLOW (owner decision 2026-08-24, item 1) — uploads the
// raw file to the SAME `documents` Storage bucket every other upload in
// this app already uses (CLAUDE.md's {user_id}/... storage-path
// convention), under a staging `import-jobs/` prefix (distinct from
// buildStoragePath()'s final, category-organized layout — that mapping
// needs extraction data this job doesn't have yet). The storage_path this
// returns is what makes RETRY possible without re-picking the file later.
async function uploadFileForJob(userId: string, fileUri: string, mediaType: string, fileName: string): Promise<string> {
  const storagePath = jobStagingPath(userId, fileName);
  const bytes = await new File(fileUri).bytes();
  const { error } = await supabase.storage.from('documents').upload(storagePath, bytes, { contentType: mediaType, upsert: true });
  if (error) throw error;
  return storagePath;
}

export type StartImportJobParams = {
  fileUri: string;
  mediaType: string;
  fileName: string;
  docHint?: string;
  locale?: string;
  customCategories?: string[];
  learningRules?: { keyword: string; category: string }[];
  carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
};

// Shared by both useStartImportJob() (one file, the common case) and
// useStartImportJobsBatch() (multi-select) — a plain async function rather
// than a hook's own mutationFn so the batch hook can run several of these
// concurrently via runBatchWithConcurrency() without nesting hooks.
async function startOneImportJob(userId: string, params: StartImportJobParams): Promise<{ jobId: string }> {
  const storagePath = await uploadFileForJob(userId, params.fileUri, params.mediaType, params.fileName);
  const { data, error } = await supabase.functions.invoke('ai-import', {
    body: {
      mode: 'job',
      storagePath,
      mediaType: params.mediaType,
      fileName: params.fileName,
      docHint: params.docHint,
      locale: params.locale,
      customCategories: params.customCategories,
      learningRules: params.learningRules,
      carrierCodeMaps: params.carrierCodeMaps,
    },
  });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      try {
        const body = await ctx.json();
        if (body?.error?.message) throw new Error(body.error.message as string);
      } catch {
        // fall through to the generic message below
      }
    }
    throw new Error(error.message || 'Could not start the import job.');
  }
  return data as { jobId: string };
}

export function useStartImportJob() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: StartImportJobParams) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('Not signed in.');
      return startOneImportJob(userId, params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// MULTI-FILE BACKGROUND IMPORT (owner decision, "batch enqueue" pass,
// spec item 1) — "the picker allows selecting MULTIPLE documents at once
// ... each becomes its own import_job, processed with the existing
// controlled concurrency; the user returns to the app immediately." Starts
// every file's own job with a modest client-side concurrency cap (mirrors
// the server's own PAGES_PER_BATCH-style caution, CLAUDE.md's SPEED UP
// SETTLEMENT IMPORT entry — a small, bounded number of concurrent
// uploads/invocations rather than firing all N (or the risk end of that
// history) or fully serial (slow)). "A failed item never blocks the
// others" (spec item 5) is what runBatchWithConcurrency's own
// per-item try/catch guarantees — one file's upload/invoke failure never
// stops or skips any other file's own attempt.
const BATCH_START_CONCURRENCY = 3;

export type BatchStartResult = { fileName: string; jobId?: string; error?: string };

export function useStartImportJobsBatch() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (paramsList: StartImportJobParams[]): Promise<BatchStartResult[]> => {
      const userId = session?.user.id;
      if (!userId) throw new Error('Not signed in.');
      const outcomes = await runBatchWithConcurrency(paramsList, BATCH_START_CONCURRENCY, (params) => startOneImportJob(userId, params));
      return outcomes.map((o) => ({
        fileName: o.item.fileName,
        jobId: o.result?.jobId,
        error: o.error ? (o.error instanceof Error ? o.error.message : String(o.error)) : undefined,
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// RETRY (owner decision 2026-08-24, item 5) — reuses the FAILED job's own
// already-uploaded storage_path server-side; the client never re-reads or
// re-uploads the file, "never make the user pick it again."
export function useRetryImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { jobId: string; docHint?: string; locale?: string; customCategories?: string[]; learningRules?: { keyword: string; category: string }[]; carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[] }) => {
      const { data, error } = await supabase.functions.invoke('ai-import', {
        body: { mode: 'retry_job', retryJobId: params.jobId, ...params },
      });
      if (error) throw new Error(error.message || 'Could not retry the import job.');
      return data as { jobId: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// Dismiss a TERMINAL (ready/failed) job from the list — a plain delete;
// RLS scopes it to the caller's own rows. Deliberately not offered for an
// active (queued/processing) job (nothing in the UI calls this for one).
export function useDismissImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.from('import_jobs').delete().eq('id', jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}
