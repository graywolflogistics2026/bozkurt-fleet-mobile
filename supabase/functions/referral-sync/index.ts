// supabase/functions/referral-sync/index.ts
//
// Deno Edge Function — REFERRAL PROGRAM (owner decision 2026-08-24, PART
// 1). Evaluates whether the CALLING user's own incoming referral (i.e. a
// row in `referrals` where `referred_user_id` = the caller) has become
// "qualified" (confirmed email, completed onboarding, imported a
// document, 7+ days since signup — docs/PENDING_SQL.md §50's own writeup)
// and, if so, grants the referred person's 14-day welcome credit and
// checks whether the REFERRER just crossed a new multiple-of-3 threshold
// (granting them 60 days). This is a cross-user write (the referrer's own
// account_credits/referrals rows get updated in response to a DIFFERENT
// user's activity), which is exactly why this needs service_role — a
// normal RLS-scoped client call from the referred person could never
// write to the referrer's rows.
//
// TRIGGER MODEL (deliberately lazy, not a real cron — this sandboxed dev
// environment has no way to configure/verify a live Supabase scheduled
// function): called opportunistically from the app (the referral screen's
// own mount, plus a lightweight once-per-session call from Home — see
// app/src/data/referral.ts) rather than on a fixed schedule. This means a
// referred person who never opens the app again after meeting all 4
// criteria will never actually get evaluated — flagged here as a known,
// honest limitation; a real cron-triggered version of this same function
// would close that gap and is a documented follow-up
// (docs/ADMIN_RUNBOOK.md).
//
// The qualification/reward/self-referral/masking LOGIC below intentionally
// mirrors app/src/referral/{qualification,reward,maskLabel}.ts's pure,
// unit-tested functions field-for-field (same "every Edge Function is
// self-contained, duplicates small helpers rather than importing app/src
// code" convention as delete-account/reset-data's own deleteStorageFolder()
// precedent — Deno can't import a TS module from app/ anyway).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REFERRALS_PER_REWARD = 3;
const REFERRER_REWARD_DAYS = 60;
const REFERRED_WELCOME_CREDIT_DAYS = 14;
const MIN_DAYS_SINCE_SIGNUP = 7;
const MAX_REWARDED_REFERRALS_PER_REFERRER = 25;

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Mirrors app/src/referral/maskLabel.ts's buildMaskedReferralLabel().
function buildMaskedLabel(ownerName: string | null, signupCreatedAt: string): string {
  const trimmed = ownerName?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const initials = parts.map((p) => `${p[0].toUpperCase()}.`).join(" ");
    if (initials) return initials;
  }
  const date = new Date(signupCreatedAt);
  const month = date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return `New member (${month})`;
}

// Mirrors app/src/referral/reward.ts's computeNewRewardGrants().
function computeNewRewardGrants(before: number, after: number): number {
  if (after <= before) return 0;
  return Math.floor(after / REFERRALS_PER_REWARD) - Math.floor(before / REFERRALS_PER_REWARD);
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
    // Is the caller someone's REFERRED person, with a still-pending row?
    const { data: incoming, error: incomingError } = await admin
      .from("referrals")
      .select("id, referrer_id, status, created_at")
      .eq("referred_user_id", userId)
      .maybeSingle();
    if (incomingError) throw new Error(`Failed reading incoming referral: ${incomingError.message}`);

    if (!incoming || incoming.status !== "pending") {
      // Nothing to evaluate — either the caller was never referred, or
      // their referral already resolved (qualified/rewarded) on a
      // previous call. Idempotent no-op, not an error.
      return new Response(JSON.stringify({ success: true, evaluated: false }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Gather the 4 qualification signals for the caller (the REFERRED person).
    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
    if (authUserError || !authUser?.user) throw new Error("Could not read the caller's own auth record.");
    const emailConfirmed = !!authUser.user.email_confirmed_at;
    const signupCreatedAt = authUser.user.created_at;

    const { data: profileRow, error: profileError } = await admin
      .from("profiles")
      .select("onboarding_completed_at, owner_name")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) throw new Error(`Failed reading profile: ${profileError.message}`);
    const onboardingCompleted = !!profileRow?.onboarding_completed_at;

    const { count: documentCount, error: docError } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (docError) throw new Error(`Failed counting documents: ${docError.message}`);
    const hasImportedDocument = (documentCount ?? 0) > 0;

    const daysSinceSignup = Math.floor((Date.now() - new Date(signupCreatedAt).getTime()) / 86400000);

    const qualifies =
      emailConfirmed && onboardingCompleted && hasImportedDocument && daysSinceSignup >= MIN_DAYS_SINCE_SIGNUP;

    if (!qualifies) {
      return new Response(JSON.stringify({ success: true, evaluated: true, qualified: false }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // CAP CHECK (spec item D2's "cap qualified referrals per referrer") —
    // count the referrer's own already-qualified-or-better, non-flagged
    // referrals BEFORE this one.
    const { count: referrerQualifiedBefore, error: capError } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", incoming.referrer_id)
      .in("status", ["qualified", "rewarded"])
      .eq("flagged_for_review", false);
    if (capError) throw new Error(`Failed checking referrer cap: ${capError.message}`);
    const qualifiedCountBefore = referrerQualifiedBefore ?? 0;
    const overCap = qualifiedCountBefore >= MAX_REWARDED_REFERRALS_PER_REFERRER;

    const maskedLabel = buildMaskedLabel(profileRow?.owner_name ?? null, signupCreatedAt);
    const nowIso = new Date().toISOString();

    const { error: updateError } = await admin
      .from("referrals")
      .update({
        status: "qualified",
        qualified_at: nowIso,
        referred_label: maskedLabel,
        flagged_for_review: overCap,
        flag_reason: overCap ? "referrer_cap_reached" : null,
      })
      .eq("id", incoming.id);
    if (updateError) throw new Error(`Failed marking referral qualified: ${updateError.message}`);

    // The referred person's own welcome credit — unconditional on the cap
    // (they did nothing wrong; the cap only limits the REFERRER's reward).
    const { error: welcomeCreditError } = await admin.from("account_credits").insert({
      user_id: userId,
      days: REFERRED_WELCOME_CREDIT_DAYS,
      reason: "referral_welcome",
      source_referral_id: incoming.id,
      granted_at: nowIso,
    });
    if (welcomeCreditError) throw new Error(`Failed granting welcome credit: ${welcomeCreditError.message}`);

    let referrerGrantsCreated = 0;
    if (!overCap) {
      const qualifiedCountAfter = qualifiedCountBefore + 1;
      const newGrants = computeNewRewardGrants(qualifiedCountBefore, qualifiedCountAfter);
      if (newGrants > 0) {
        const rowsToReward = newGrants * REFERRALS_PER_REWARD;
        const { data: oldestUnrewarded, error: oldestError } = await admin
          .from("referrals")
          .select("id")
          .eq("referrer_id", incoming.referrer_id)
          .eq("status", "qualified")
          .eq("flagged_for_review", false)
          .order("qualified_at", { ascending: true })
          .limit(rowsToReward);
        if (oldestError) throw new Error(`Failed selecting referrals to reward: ${oldestError.message}`);

        const idsToReward = (oldestUnrewarded ?? []).map((r: { id: string }) => r.id);
        if (idsToReward.length > 0) {
          const { error: rewardUpdateError } = await admin
            .from("referrals")
            .update({ status: "rewarded", rewarded_at: nowIso })
            .in("id", idsToReward);
          if (rewardUpdateError) throw new Error(`Failed marking referrals rewarded: ${rewardUpdateError.message}`);
        }

        for (let i = 0; i < newGrants; i++) {
          const { error: rewardCreditError } = await admin.from("account_credits").insert({
            user_id: incoming.referrer_id,
            days: REFERRER_REWARD_DAYS,
            reason: "referral_reward",
            source_referral_id: incoming.id,
            granted_at: nowIso,
          });
          if (rewardCreditError) throw new Error(`Failed granting referrer reward: ${rewardCreditError.message}`);
        }
        referrerGrantsCreated = newGrants;
      }
    }

    return new Response(
      JSON.stringify({ success: true, evaluated: true, qualified: true, referrerGrantsCreated, overCap }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
});
