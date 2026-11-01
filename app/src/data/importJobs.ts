import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { getSignedDocumentUrl } from '@/src/data/documentViewer';
import { useAuth } from '@/src/context/AuthContext';
import { sanitizeExtraction } from '@/src/import/sanitizeExtraction';
import { hasPendingWork, runBatchWithConcurrency, type ImportJob, type ImportJobProgress, type ImportJobStatus } from '@/src/import/importJobs';
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
  progress?: ImportJobProgress | null;
  heartbeat_at?: string | null;
  error_page?: number | null;
  document_id?: string | null;
};

const IMPORT_JOB_BASE_COLUMNS =
  'id, status, pages_done, pages_total, file_name, media_type, error_message, error_step, created_at, updated_at, completed_at';
// RESUMABLE IMPORT JOBS (docs/PENDING_SQL.md §78). Before §78 runs these
// columns don't exist: the select falls back to the base columns.
const IMPORT_JOB_COLUMNS = `${IMPORT_JOB_BASE_COLUMNS}, progress, heartbeat_at, error_page, document_id`;
let resumableColumnsMissing = false;

function isUndefinedColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''));
}

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
    progress: row.progress ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    errorPage: row.error_page ?? null,
    documentId: row.document_id ?? null,
  };
}

async function selectJobs(): Promise<ImportJobRow[]> {
  if (!resumableColumnsMissing) {
    const { data, error } = await supabase.from('import_jobs').select(IMPORT_JOB_COLUMNS).order('created_at', { ascending: false });
    if (!error) return (data ?? []) as ImportJobRow[];
    if (!isUndefinedColumn(error)) throw error;
    resumableColumnsMissing = true;
  }
  const { data, error } = await supabase.from('import_jobs').select(IMPORT_JOB_BASE_COLUMNS).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ImportJobRow[];
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
    queryFn: async () => (await selectJobs()).map(mapRow),
    enabled: !!userId,
    refetchInterval: (query) => {
      const jobs = query.state.data as ImportJob[] | undefined;
      return (jobs ?? []).some(hasPendingWork) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
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
      const { data, error } = await supabase
        .from('import_jobs')
        .select(resumableColumnsMissing ? IMPORT_JOB_BASE_COLUMNS : IMPORT_JOB_COLUMNS)
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRow(data as unknown as ImportJobRow) : null;
    },
    enabled: !!jobId,
  });
}

// Fetches the raw result_json for a 'ready' job and sanitizes it exactly
// like a live extraction (dates, miles AND the Prime statement check —
// src/import/sanitizeExtraction.ts; the statement check was missing here
// until 2026-10-30)
// so "Review now" behaves identically to a synchronous import's own
// result, regardless of which path produced it.
export async function fetchImportJobResult(jobId: string): Promise<Extraction | null> {
  const { data, error } = await supabase.from('import_jobs').select('result_json').eq('id', jobId).maybeSingle();
  if (error) throw error;
  const raw = data?.result_json as Extraction | undefined;
  if (!raw) return null;
  return sanitizeExtraction(raw);
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
    extraction: sanitizeExtraction(raw),
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

async function invokeJobMode(body: Record<string, unknown>, fallbackMessage: string): Promise<{ jobId: string }> {
  const { data, error } = await supabase.functions.invoke('ai-import', { body });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    if (ctx instanceof Response) {
      const parsed = await ctx.json().catch(() => null);
      if (parsed?.error?.message) throw new Error(parsed.error.message as string);
    }
    throw new Error(fallbackMessage);
  }
  return data as { jobId: string };
}

// RESUME (owner decision 2026-10-13, replaces 2026-08-24's retry): the SAME
// job continues from its first page without a stored result — finished
// pages are never read again and the progress never goes back to 0.
// `retryFailed` (the user's own "Resume from page N") gives failed pages
// fresh attempts; the app's automatic restart of an interrupted job passes
// false. The file is never re-picked or re-uploaded.
export async function resumeImportJob(jobId: string, retryFailed: boolean): Promise<{ jobId: string }> {
  return invokeJobMode({ mode: 'resume_job', jobId, retryFailed }, 'Could not resume the import.');
}

export function useRetryImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { jobId: string }) => resumeImportJob(params.jobId, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// READ AGAIN (owner decision 2026-10-17, item 7): an unsaved, ready job's
// settlement + statement pages are read again with the current prompt, on
// the same job; attachments are kept in the file, not read.
export function useRereadImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      jobId: string;
      locale?: string;
      customCategories?: string[];
      learningRules?: { keyword: string; category: string }[];
      carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
    }) => invokeJobMode({ mode: 'reread_job', ...params }, 'Could not start reading again.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// "This file has N pages. Read the first 40 now?" — never read silently.
export async function answerImportJob(jobId: string, answer: 'read_first' | 'cancel'): Promise<{ jobId: string }> {
  return invokeJobMode({ mode: 'answer_job', jobId, answer }, 'Could not send your answer.');
}

export function useAnswerImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { jobId: string; answer: 'read_first' | 'cancel' }) =>
      invokeJobMode({ mode: 'answer_job', jobId: params.jobId, answer: params.answer }, 'Could not send your answer.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// "Read the missing pages" / "Read this page" on a saved week: a new job
// that reads only those pages of the stored PDF; when ready, the week is
// reviewed and saved again (Save replaces it).
export function useReadDocumentPages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      documentId: string;
      pages: number[];
      locale?: string;
      customCategories?: string[];
      learningRules?: { keyword: string; category: string }[];
      carrierCodeMaps?: { carrier: string; code: string; subCode: string | null; label: string; description: string | null }[];
    }) => invokeJobMode({ mode: 'read_pages', ...params }, 'Could not start reading those pages.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IMPORT_JOBS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// After Save (privacy, amendment 4): the job's stored extraction is deleted.
// If attachment pages are still being read, the job keeps only those (the
// server adds them to the saved week for review when done); otherwise the
// row is deleted. Before §78 the RPC doesn't exist: plain delete.
export async function markImportJobSaved(jobId: string, documentId: string | null): Promise<void> {
  if (documentId) {
    const { error } = await supabase.rpc('import_job_saved', { p_job_id: jobId, p_document_id: documentId });
    if (!error) return;
  }
  const { error } = await supabase.from('import_jobs').delete().eq('id', jobId);
  if (!error) return;
  // Last resort: never leave the extraction behind.
  await supabase.from('import_jobs').update({ result_json: null }).eq('id', jobId);
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
