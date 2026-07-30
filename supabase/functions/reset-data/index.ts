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
  "drivers",
  "driver_payments",
  "household_income",
  "household_members",
  "user_categories",
  "compliance_items",
  "misc_income",
  "documents",
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
  cf_insurance_monthly: null,
  cf_other_weekly: null,
  cf_tax_reserve_pct: null,
  dashboard_layout: null,
  dashboard_sections_collapsed: null,
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STORAGE_BUCKETS = ["documents", "backups"];

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Same recursive one-level-deep Storage listing as delete-account's own
// helper (duplicated rather than shared — each Edge Function in this repo
// is self-contained).
async function deleteStorageFolder(admin: ReturnType<typeof createClient>, bucket: string, userId: string) {
  const { data: files, error: listError } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
  if (listError || !files || files.length === 0) return;
  const allPaths: string[] = [];
  for (const entry of files) {
    if (entry.id === null) {
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

    // Last step — reset the profile's data fields only after every row
    // and file is gone, so a failure earlier leaves data half-cleared but
    // never a profile silently reset ahead of its underlying rows.
    const { error: profileError } = await admin.from("profiles").update(PROFILE_DATA_RESET).eq("user_id", userId);
    if (profileError) throw new Error(`Failed resetting profile data fields: ${profileError.message}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});
