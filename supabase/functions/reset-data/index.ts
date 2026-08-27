// supabase/functions/reset-data/index.ts
//
// Deno Edge Function — "Reset All Data" (device feedback round 2,
// owner decision 2026-07-13). Wipes every business/data row this user
// owns and their uploaded Storage files, but — unlike delete-account —
// KEEPS the profiles row and the auth.users account itself, so the user
// can sign back in to a clean, zeroed account. Irreversible; the client
// gates this behind a type-to-confirm flow (app/(tabs)/more/settings.tsx)
// distinct from Delete Account's own confirm flow.
//
// POST body: {} (no fields — user_id is ALWAYS derived from the caller's
// own JWT via supabase.auth.getUser(), same pattern as delete-account,
// never accepted from the request body).
// Auth: Supabase JWT in the Authorization header (required).
//
// TABLE LIST — delete-account's TABLES_IN_DELETION_ORDER minus profiles
// and tax_config (kept: identity/settings, not "business data"), plus
// `drivers` added explicitly. drivers cascades from auth.users (so
// delete-account can safely omit it — auth.admin.deleteUser() cleans it
// up), but this function never deletes the auth user, so drivers would
// otherwise survive untouched. Order matters for the same reason it does
// in delete-account: settlements/fuel_purchases/maintenance_records
// before trucks (their truck_id FK has no cascade), documents after
// settlements (settlements.document_id FK has no cascade either).
const TABLES_IN_DELETION_ORDER = [
  "bank_transactions",
  "bank_statements",
  "credit_cards",
  "loans",
  "tolls",
  "reimbursements",
  "capital_transactions",
  "deductions",
  "loads",
  "fuel_purchases",
  "maintenance_records",
  "settlements",
  "maintenance_intervals",
  "truck_health_config",
  "trucks",
  "equipment",
  "drivers",
  "driver_payments",
  "household_income",
  "household_members",
  "user_categories",
  "category_learning_rules",
  "compliance_items",
  "misc_income",
  "documents",
  // REFERRAL PROGRAM (owner decision 2026-08-24, docs/PENDING_SQL.md
  // §50) — this resetting user's OWN earned/spent credit rows only
  // (fits the standard `user_id` loop below). `referrals` does NOT fit
  // this loop (no single `user_id` column — see the bespoke delete
  // right after the loop) and is handled separately, scoped to
  // `referrer_id` only, never `referred_user_id` — see that delete's
  // own comment for why.
  "account_credits",
  // BACKGROUND IMPORT (owner decision 2026-08-24, docs/PENDING_SQL.md
  // §54) — transient job/processing state (an in-progress or completed
  // background extraction, holding the same kind of raw financial data a
  // reset is meant to wipe). Needs an explicit entry here (unlike
  // delete-account, which never touches this table since
  // `user_id ... on delete cascade` handles it automatically when the
  // auth user itself is deleted) — same "drivers" precedent this file's
  // own header comment already documents.
  "import_jobs",
];

// profiles.* fields that hold actual business/financial DATA (a balance,
// a goal, a budget number, a saved dashboard layout) rather than account
// identity/settings — reset to their "never set" default instead of
// deleting the row (profiles has no meaningful "deleted" state; it's 1:1
// with auth.users and every screen assumes it always has a row).
//
// CLEARED (2026-07-30 tablet-testing fix — dashboard_layout/
// dashboard_sections_collapsed were missing here, so a reset-then-
// reopen-the-app still showed the old custom layout): business_balance,
// initial_capital, weekly_goal, every cf_* Cash Flow forecast budget
// input (PENDING_SQL.md §29), dashboard_layout, dashboard_sections_collapsed.
//
// KEPT (never touched by this object, so never touched by the .update()
// below) — see CLAUDE.md's reset-data invariant for the full rationale:
// company_name, owner_name, home_state, dot_number, mc_number, locale,
// role, tos_accepted_at/tos_version, onboarding_completed_at.
// onboarding_completed_at in particular is a DELIBERATE CHANGE this pass
// (owner decision 2026-07-30) — it used to be reset here specifically so
// the onboarding wizard could be re-tested without a fresh account; it's
// now treated as an identity/prefs field like the others, so Reset All
// Data no longer forces the wizard to run again. entity_type/filing
// status/etc. live on tax_config, which this function already never
// touches (see TABLES_IN_DELETION_ORDER's comment above) — nothing to
// change there.
const PROFILE_DATA_RESET = {
  business_balance: 0,
  initial_capital: 0,
  weekly_goal: null,
  cf_bank_balance: null,
  cf_weekly_revenue: null,
  cf_truck_payment: null,
  cf_fuel_weekly: null,
  cf_insurance_monthly: null, // deprecated (§39), cleared anyway for tidiness
  cf_insurance_weekly: null,
  cf_other_weekly: null,
  cf_tax_reserve_pct: null,
  // "BUILT FROM THE USER'S OWN DATA" pass (owner decision, docs/
  // PENDING_SQL.md §57) — the new Cash Flow forecast's own per-figure
  // overrides are budget inputs, same CLEARED bucket as every other
  // cf_* field above (CLAUDE.md invariant #24's own explicit rule: an
  // unlisted new profiles column is silently KEPT, not the safe default
  // here — a "reset" account must not keep a stale manual override).
  cf_income_override: null,
  cf_fixed_override: null,
  cf_variable_override: null,
  cf_periodic_overrides: {},
  dashboard_layout: null,
  dashboard_sections_collapsed: null,
  // SMART ALERTS + PROACTIVE AI COACH STATE (NEXT PASS, owner decision
  // 2026-08-24, docs/PENDING_SQL.md §49) — a "fresh" account should never
  // retain stale nudge-shown/silenced history, a dismissed role prompt, or
  // a cached AI weekly review from before the reset.
  nudge_state: {},
  role_prompt_dismissed_at: null,
  ai_weekly_review: null,
  ai_weekly_review_generated_at: null,
  ai_weekly_review_week_ending: null,
  // AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
  // (owner decision, docs/PENDING_SQL.md §65) — new sibling of the three
  // ai_weekly_review_* fields directly above; same CLEARED bucket.
  ai_weekly_review_locale: null,
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STORAGE_BUCKETS = ["documents", "backups"];

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: { message, ...extra } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// STORAGE DELETION INTEGRITY (pre-launch hardening, owner decision
// 2026-08-02, independent code review finding — identical fix to
// delete-account's own copy, duplicated rather than shared per this
// repo's "each Edge Function is self-contained" convention): the old
// version ignored every list()/remove() error, hardcoded a 3-level-deep
// recursion, and never paginated past list()'s 1000-item page. The
// caller now gets a real result it MUST check before ever reporting
// success:true — walking/removing is naturally idempotent, so a partial
// failure is always safe to retry.
type StorageFolderResult = { failedPaths: string[]; errors: string[] };

async function listAllEntries(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  folder: string
): Promise<{ entries: { id: string | null; name: string }[] | null; error: string | null }> {
  const entries: { id: string | null; name: string }[] = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit, offset });
    if (error) return { entries: null, error: error.message };
    if (!data || data.length === 0) break;
    entries.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return { entries, error: null };
}

async function walkAndDelete(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  folder: string,
  result: StorageFolderResult
): Promise<void> {
  const { entries, error } = await listAllEntries(admin, bucket, folder);
  if (error) {
    result.errors.push(`list ${bucket}/${folder}: ${error}`);
    return;
  }
  if (!entries || entries.length === 0) return;

  const filePaths: string[] = [];
  for (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (entry.id === null) {
      await walkAndDelete(admin, bucket, path, result);
    } else {
      filePaths.push(path);
    }
  }

  const REMOVE_BATCH = 1000;
  for (let i = 0; i < filePaths.length; i += REMOVE_BATCH) {
    const batch = filePaths.slice(i, i + REMOVE_BATCH);
    const { error: removeError } = await admin.storage.from(bucket).remove(batch);
    if (removeError) {
      result.errors.push(`remove ${bucket}/${folder}: ${removeError.message}`);
      result.failedPaths.push(...batch);
    }
  }
}

async function deleteStorageFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  userId: string
): Promise<StorageFolderResult> {
  const result: StorageFolderResult = { failedPaths: [], errors: [] };
  await walkAndDelete(admin, bucket, userId, result);
  return result;
}

// RESET-ALL-DATA PREFLIGHT (P0 FIX, FULL SYSTEM AUDIT owner decision
// 2026-08-26). Before this fix, a schema drift bug (a `profiles` column
// this function expects to write — e.g. a not-yet-run PENDING_SQL section
// — missing on the live database) meant: every business table gets wiped,
// every Storage file gets deleted, and ONLY THEN, on the very last step
// (the profiles.update()), Postgres returns a generic "column does not
// exist" error — after everything irreversible has already happened, with
// no indication of which step actually failed. This preflight is a
// READ-ONLY dry run of every write this function is about to make (a
// `select` with the identical `.eq()` predicate and, for `profiles`, the
// identical column list the real `.update()` will use) — if a table or
// column doesn't exist, PostgREST returns the same "does not exist" error
// here, harmlessly, before a single row has been touched. Cheap (one
// `limit(1)` select per table) relative to the cost of getting this wrong.
type PreflightIssue = { check: string; message: string };

async function preflightCheck(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  for (const table of TABLES_IN_DELETION_ORDER) {
    const { error } = await admin.from(table).select("user_id").eq("user_id", userId).limit(1);
    if (error) issues.push({ check: `table "${table}"`, message: error.message });
  }

  const { error: referralsError } = await admin.from("referrals").select("referrer_id").eq("referrer_id", userId).limit(1);
  if (referralsError) issues.push({ check: 'table "referrals"', message: referralsError.message });

  // Every column PROFILE_DATA_RESET is about to write, in one select — a
  // single missing column here is exactly the bug this preflight exists
  // to catch before it can cause any damage.
  const profileColumns = Object.keys(PROFILE_DATA_RESET).join(",");
  const { error: profileError } = await admin.from("profiles").select(profileColumns).eq("user_id", userId).limit(1);
  if (profileError) issues.push({ check: "profiles (PROFILE_DATA_RESET columns)", message: profileError.message });

  return issues;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("Only POST is supported.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Missing Authorization header.", 401);
  }

  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return errorResponse("Invalid or expired session.", 401);
  }
  const userId = userData.user.id;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return errorResponse("Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set.", 500);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  try {
    // STEP 0 — PREFLIGHT: refuse to start at all if the live schema
    // doesn't match what this function is about to write/delete. Nothing
    // below this point runs unless every check passes.
    const preflightIssues = await preflightCheck(admin, userId);
    if (preflightIssues.length > 0) {
      return errorResponse(
        "Reset All Data refused to start — the database schema doesn't match what this function expects. Nothing was touched; this is safe to leave and report.",
        409,
        { preflightIssues },
      );
    }

    // STEP 1 — the COLUMN-DEPENDENT update runs FIRST, before any
    // destructive delete (device-report/audit fix, owner decision
    // 2026-08-26): this is the step most likely to fail on a schema
    // mismatch the preflight above somehow missed (e.g. a column dropped
    // in the narrow window between the preflight read and this write) —
    // running it before anything irreversible means that residual failure
    // mode still leaves every business table and every Storage file
    // completely untouched, not "already destroyed with a generic error."
    // Both this update and every delete below are independently
    // idempotent (a no-op if already reset/already empty), so re-running
    // the whole function after ANY failure — here or later — is always
    // safe.
    const { error: profileError } = await admin.from("profiles").update(PROFILE_DATA_RESET).eq("user_id", userId);
    if (profileError) {
      return errorResponse(
        `Failed resetting profile data fields — this runs FIRST, so nothing else was touched. Safe to retry once fixed: ${profileError.message}`,
        500,
      );
    }

    // STEP 2 — table deletes. Every table is attempted (not aborted on the
    // first failure) so a partial failure reports EXACTLY which tables
    // succeeded and which didn't, instead of a generic error that leaves
    // the caller unable to tell how far the reset actually got.
    const tableResults: { table: string; success: boolean; error?: string }[] = [];
    for (const table of TABLES_IN_DELETION_ORDER) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      tableResults.push({ table, success: !error, error: error?.message });
    }

    // REFERRAL PROGRAM (owner decision 2026-08-24, docs/PENDING_SQL.md
    // §50) — deletes ONLY this user's own OUTGOING referrals (as
    // referrer_id). Deliberately does NOT touch any row where this user
    // is referred_user_id — that row belongs to a DIFFERENT person's
    // (their referrer's) history, and referrals.referred_user_id is
    // `on delete set null` specifically so that row (and whatever credit
    // it already earned the referrer) is never wiped by anything this
    // user does to their own account, reset or otherwise.
    const { error: referralsError } = await admin.from("referrals").delete().eq("referrer_id", userId);
    tableResults.push({ table: "referrals", success: !referralsError, error: referralsError?.message });

    const failedTables = tableResults.filter((r) => !r.success);

    // STEP 3 — Storage. Same "attempt everything, report exactly what
    // failed" spirit as the table loop above (STORAGE DELETION INTEGRITY,
    // pre-launch hardening, unchanged from before this pass).
    const allFailedPaths: string[] = [];
    const allErrors: string[] = [];
    for (const bucket of STORAGE_BUCKETS) {
      const result = await deleteStorageFolder(admin, bucket, userId);
      allFailedPaths.push(...result.failedPaths);
      allErrors.push(...result.errors);
    }

    if (failedTables.length > 0 || allErrors.length > 0 || allFailedPaths.length > 0) {
      return errorResponse(
        "Reset All Data partially completed — your profile fields were reset, but some data could not be cleared. Safe to retry: every step here is idempotent and will skip whatever already succeeded.",
        502,
        {
          profileReset: true,
          tablesSucceeded: tableResults.filter((r) => r.success).map((r) => r.table),
          tablesFailed: failedTables,
          storageFailedFileCount: allFailedPaths.length,
          storageErrors: allErrors.slice(0, 10),
        },
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});
