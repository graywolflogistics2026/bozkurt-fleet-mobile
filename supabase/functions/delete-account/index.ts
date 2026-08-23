// supabase/functions/delete-account/index.ts
//
// Deno Edge Function — full account wipe (PROMPTS.md Session 9b Settings
// completion, "required pre-launch"). Deletes every row this user owns,
// their uploaded Storage files, then their auth.users row itself.
// Irreversible; the client gates this behind a double-confirm + type-to-
// confirm flow (app/(tabs)/more/settings.tsx) before ever calling here.
//
// POST body: {} (no fields — the user_id is ALWAYS derived from the
// caller's own JWT via supabase.auth.getUser(), never accepted from the
// request body, so a client bug/malicious payload can never request
// deletion of a different user's account).
// Auth: Supabase JWT in the Authorization header (required).
//
// SERVICE ROLE IS REQUIRED for two reasons: (1) auth.admin.deleteUser()
// is an admin-only API, no user can ever call it on themselves with a
// regular session; (2) using service_role for the row deletions too
// means this function doesn't depend on every table's RLS policy being
// exactly "delete using (user_id = auth.uid())" — it works regardless of
// each table's exact policy shape. SUPABASE_SERVICE_ROLE_KEY is
// auto-provided to every Edge Function by the platform (unlike
// ANTHROPIC_API_KEY, which is a manually-set secret) — no extra
// configuration needed beyond deploying this function.
//
// DELETION ORDER — derived directly from docs/SCHEMA.sql's actual FK
// clauses, not guessed:
//   - Most tables' `user_id` column has NO cascade from auth.users (only
//     profiles/tax_config/drivers/compliance_items/household_members/
//     household_income/driver_payments/user_categories/misc_income do),
//     so those tables are deleted explicitly here rather than relying on
//     auth.admin.deleteUser() to cascade them.
//   - settlements.truck_id, fuel_purchases.truck_id, and
//     maintenance_records.truck_id reference trucks with NO explicit
//     "on delete cascade/set null" — Postgres defaults to NO ACTION,
//     which would BLOCK deleting a truck row while any of those three
//     tables still reference it. So all three MUST be deleted before
//     trucks.
//   - settlements.document_id references documents with the same NO
//     ACTION default, so documents must be deleted after settlements
//     (and after deductions/maintenance_records, which reference
//     documents via ON DELETE SET NULL and are therefore order-safe, but
//     are cleared first anyway for clarity).
//   - Every other FK in this schema is either ON DELETE CASCADE or ON
//     DELETE SET NULL, so their relative order genuinely does not
//     matter — deleting a referenced row either cascades or nulls the
//     referencing column, never blocks. They're still ordered
//     children-before-parents below for readability, not correctness.
// If the live database has drifted from docs/SCHEMA.sql (this repo has
// hit that before — see docs/PENDING_SQL.md's own notes), re-verify this
// order against the actual live schema before relying on it in
// production; this function was written from the documented schema and
// has not been exercised against the live database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Order matters for the four tables noted above (settlements/
// fuel_purchases/maintenance_records before trucks; documents after
// settlements) — see the file-level comment. Every other table is
// listed children-before-parents for readability only.
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
  "driver_payments",
  "household_income",
  "household_members",
  "user_categories",
  "category_learning_rules",
  "compliance_items",
  "misc_income",
  "documents",
  "tax_config",
  "profiles",
];

// Storage buckets that use a `{user_id}/...` path prefix (CLAUDE.md) —
// every file this user ever uploaded lives under one of these two.
const STORAGE_BUCKETS = ["documents", "backups"];

function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(JSON.stringify({ error: { message, ...extra } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// STORAGE DELETION INTEGRITY (pre-launch hardening, owner decision
// 2026-08-02, independent code review finding): the old version ignored
// every list()/remove() error, hardcoded a 3-level-deep recursion (this
// app's paths are only ever 2-3 levels deep TODAY, but a fixed depth is a
// silent data-loss bug waiting for the day a path gets one segment
// longer), and never paginated past list()'s 1000-item page — an account
// with 1000+ files in one folder would silently leave the remainder
// behind. The caller now gets a real result it MUST check before ever
// reporting success:true — walking/removing is naturally idempotent
// (list() on an emptied folder returns [], remove() on an already-gone
// path is a no-op), so a partial failure is always safe to retry.
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

// Recurses the folder tree to whatever depth it actually goes — no
// hardcoded level count — collecting every failed list/remove into the
// shared result rather than silently swallowing it.
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
      // A "directory" placeholder — recurse, no depth limit.
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

  // First client: scoped to the caller's own JWT, ONLY to identify who
  // they are — never used for the actual deletion (that's the admin
  // client below).
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
    for (const table of TABLES_IN_DELETION_ORDER) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`Failed deleting from ${table}: ${error.message}`);
    }

    // STORAGE DELETION INTEGRITY: collect every bucket's failures before
    // deciding success — a partial failure must never be reported as
    // success:true, and must never proceed to delete the auth user (that
    // stays the deliberate last step; leaving the account intact is what
    // makes a retry safe — re-running this function is a no-op over
    // everything that already succeeded).
    const allFailedPaths: string[] = [];
    const allErrors: string[] = [];
    for (const bucket of STORAGE_BUCKETS) {
      const result = await deleteStorageFolder(admin, bucket, userId);
      allFailedPaths.push(...result.failedPaths);
      allErrors.push(...result.errors);
    }
    if (allErrors.length > 0 || allFailedPaths.length > 0) {
      return errorResponse(
        "Some files could not be removed — please try again.",
        502,
        { failedFileCount: allFailedPaths.length, storageErrors: allErrors.slice(0, 10) }
      );
    }

    // Last step, deliberately — every data row and file is already gone
    // by this point, so a failure here leaves an empty-shell account
    // (safe to retry) rather than an orphaned auth user with no data.
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw new Error(`Failed deleting auth user: ${deleteUserError.message}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});
