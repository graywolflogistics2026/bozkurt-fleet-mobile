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
  "driver_payments",
  "household_income",
  "household_members",
  "user_categories",
  "compliance_items",
  "misc_income",
  "documents",
  "tax_config",
  "profiles",
];

// Storage buckets that use a `{user_id}/...` path prefix (CLAUDE.md) —
// every file this user ever uploaded lives under one of these two.
const STORAGE_BUCKETS = ["documents", "backups"];

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function deleteStorageFolder(admin: ReturnType<typeof createClient>, bucket: string, userId: string) {
  const { data: files, error: listError } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
  if (listError || !files || files.length === 0) return;
  // list() only returns one level — recurse one directory deep, which is
  // as deep as this app's storage paths ever go (CLAUDE.md:
  // {user_id}/{month}/{Category}/{filename} or {user_id}/backups/{file}).
  const allPaths: string[] = [];
  for (const entry of files) {
    if (entry.id === null) {
      // A "directory" placeholder — list one level deeper.
      const { data: nested } = await admin.storage.from(bucket).list(`${userId}/${entry.name}`, { limit: 1000 });
      for (const nestedEntry of nested ?? []) {
        if (nestedEntry.id === null) {
          const { data: nested2 } = await admin.storage.from(bucket).list(`${userId}/${entry.name}/${nestedEntry.name}`, { limit: 1000 });
          for (const f of nested2 ?? []) {
            if (f.id !== null) allPaths.push(`${userId}/${entry.name}/${nestedEntry.name}/${f.name}`);
          }
        } else {
          allPaths.push(`${userId}/${entry.name}/${nestedEntry.name}`);
        }
      }
    } else {
      allPaths.push(`${userId}/${entry.name}`);
    }
  }
  if (allPaths.length > 0) await admin.storage.from(bucket).remove(allPaths);
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

    for (const bucket of STORAGE_BUCKETS) {
      await deleteStorageFolder(admin, bucket, userId);
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
