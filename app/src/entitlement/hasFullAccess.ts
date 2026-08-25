// LIFETIME / COMPLIMENTARY ACCOUNTS (owner decision 2026-08-24, PART 2) —
// the ONE entitlement helper every gated feature must read through. There
// is no billing/subscription system yet (Session 10 backlog) — this
// exists now specifically so that whatever billing provider gets chosen
// later plugs into the SAME helper with zero feature-code changes: a
// paywall/trial-countdown/upgrade-prompt component checks
// `hasFullAccess(profile)`, never `profile.plan === 'lifetime'` directly,
// so extending the logic later (e.g. "paid AND subscription not expired")
// only ever touches this one file.
//
// `profiles.plan` (docs/PENDING_SQL.md §50, extended §58) is a genuinely
// new profiles column — see that migration for the exact type/RLS (client
// can READ its own plan, can NEVER write it; only service_role sets it,
// enforced by a BEFORE UPDATE trigger, not just app-level convention —
// the trigger protects the whole `plan` column regardless of value, so
// 'owner' below is automatically covered by the exact same protection
// 'lifetime'/'complimentary' already had, no trigger change needed).
export type Plan = 'free_trial' | 'paid' | 'lifetime' | 'complimentary' | 'owner';

export function hasFullAccess(profile: { plan?: Plan | null } | null | undefined): boolean {
  const plan = profile?.plan;
  return plan === 'lifetime' || plan === 'complimentary' || plan === 'paid' || plan === 'owner';
}

// Distinguishes the two owner-granted, no-billing-ever plans from a real
// (future) paid subscription — used ONLY for UI copy (the Settings badge
// wording, "never show upgrade prompts" checks that specifically mean
// "granted for free, no renewal exists") — hasFullAccess() above is what
// every ACCESS-gating check should use instead, since a future 'paid'
// plan must pass those gates identically to lifetime/complimentary.
export function isOwnerGrantedPlan(profile: { plan?: Plan | null } | null | undefined): boolean {
  return profile?.plan === 'lifetime' || profile?.plan === 'complimentary';
}

// OWNER/DEV ACCOUNT FLAG (owner decision) — the app owner's/developer's
// own account, for heavy testing without hitting the AI-import allowance
// and without skewing usage/cost analytics. Deliberately a SEPARATE
// helper from isOwnerGrantedPlan() above, which despite the similar name
// means something different ("a plan the business owner GRANTED to a
// customer for free") — an 'owner' account gets its own distinct
// "Owner account" Settings badge (never the lifetime/complimentary
// wording) and, unlike those two, is also excluded from usage analytics
// (src/data/aiUsageDisplay.ts, docs/ADMIN_RUNBOOK.md's own cost-reporting
// queries) — a distinction lifetime/complimentary customers don't need.
// hasFullAccess() above already returns true for 'owner' — every OTHER
// access-gating check in the app keeps working identically, no hidden
// dev-only behavior (owner decision, item 5).
export function isOwnerAccount(profile: { plan?: Plan | null } | null | undefined): boolean {
  return profile?.plan === 'owner';
}
