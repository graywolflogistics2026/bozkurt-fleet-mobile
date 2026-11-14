// supabase/functions/ai-import/jobEngine.ts — the limits shared by every
// background import job (the settlement reader, reader/server.ts).
//
// The old page-by-page reader that used to live here (classification,
// page plans, runJobStep, verdicts, re-reads; owner decision 2026-10-13)
// was removed 2026-11-13 (commit 6, after the 18-week device test passed
// with the new reader). What stays: the plan-aware worker budget, the
// stale-lease rule of a resume, and the hard input limits of an import.
//
// ZERO Deno APIs and ZERO imports, so the app's Jest suite can load it.

// ---------------------------------------------------------------------
// Limits (one documented constant; everything else derives from it)
// ---------------------------------------------------------------------

// Supabase Edge Functions: a worker may run 150 s on the Free plan and 400 s
// on paid plans (Pro and up) — supabase.com/docs/guides/functions/limits.
// PLAN-AWARE BUDGET (owner decision 2026-10-31): the default is ALWAYS the
// Free value; only the secret AI_IMPORT_SUPABASE_PLAN=pro switches a
// background job worker to the paid budget. The secret names a PLAN, never
// a number of seconds, so no setting can make the worker assume more than
// the documented limit minus the safety margin below.
export const FREE_PLAN_WALL_CLOCK_MS = 150_000;
export const PAID_PLAN_WALL_CLOCK_MS = 400_000;
// On a paid plan the worker starts nothing new after 300 s (100 s margin to
// the documented 400 s) and every model call ends by 310 s (90 s margin).
export const PAID_PLAN_EXIT_BY_MS = 300_000;
export const PLAN_SECRET_NAME = 'AI_IMPORT_SUPABASE_PLAN';
// Free: worker exits by wall clock - 20 s, calls end by wall clock - 10 s.
export const MIN_EXIT_MARGIN_MS = 20_000;
export const MIN_CALL_END_MARGIN_MS = 10_000;

export type SupabasePlanTier = 'free' | 'paid';

// Unset, empty or anything unrecognised -> Free (never a guess upward).
export function planTierFrom(raw: string | null | undefined): SupabasePlanTier {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'pro' || v === 'paid' || v === 'team' || v === 'enterprise' ? 'paid' : 'free';
}

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

// The job worker's limits for a plan. wallClockMs is always the
// DOCUMENTED platform limit (the lease below must outlive it); the budget
// the worker actually uses is exitByMs / callEndLimitMs.
export function limitsForPlan(tier: SupabasePlanTier): StepLimits {
  if (tier === 'paid') {
    return { wallClockMs: PAID_PLAN_WALL_CLOCK_MS, callEndLimitMs: PAID_PLAN_EXIT_BY_MS + 10_000, startMarginMs: 15_000, exitByMs: PAID_PLAN_EXIT_BY_MS };
  }
  return limitsFor(FREE_PLAN_WALL_CLOCK_MS);
}

// STALE LEASE (needed once a lease can outlive the app's 3-minute backup
// restart, i.e. on a paid plan: lease 405 s > 180 s). A live worker writes
// its heartbeat at least every 20 s; no heartbeat for 2 minutes means the
// worker was stopped, so a RESUME may release its lease. Safe even if the
// old worker were somehow alive: every job write requires lease_owner =
// that worker, so it loses the job at its next write.
export const STALE_LEASE_AFTER_MS = 120_000;
export function leaseIsStale(heartbeatAtMs: number | null, nowMs: number): boolean {
  return heartbeatAtMs == null || nowMs - heartbeatAtMs >= STALE_LEASE_AFTER_MS;
}

export const MAX_IMPORT_PAGES = 150;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

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

// ai_usage_log.call_type values ('ai_import_classify'/'ai_import_pages'
// were written by the old reader; old rows keep them).
export type UsageCallType = 'ai_import' | 'ai_import_classify' | 'ai_import_pages';
