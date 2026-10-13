# Referral And Credits

> Referral program (3 qualified referrals = 60 days credit) and lifetime/complimentary accounts.
> Owner decision 2026-08-24, §50; `referral-sync` Edge Function writes rewards; `hasFullAccess()` is the single entitlement gate.
> Credits are the only reward currency (no billing yet).

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- REFERRAL PROGRAM + LIFETIME ACCOUNTS (owner decision 2026-08-24,
  binding — docs/PENDING_SQL.md §50, ✅ APPLIED 2026-08-24; `referral-sync`
  deployed, `reset-data`/`delete-account` redeployed, client update
  published to preview).
  PART 1 — REFERRAL (3 qualified referrals = 60 days credit): new
  `referrals` (referrer_id, referred_user_id, status
  `pending|qualified|rewarded`, a server-computed `referred_label` — see
  below — created_at, qualified_at) and `account_credits` (user_id, days,
  reason, granted_at, source_referral_id) tables, plus
  `profiles.referral_code` (unique, `BOZKA-XXXX` format,
  `app/src/referral/referralCode.ts`'s `generateReferralCode()`/
  `isValidReferralCodeFormat()` for client-side format validation only —
  the DB's own `generate_unique_referral_code()` is the real source of
  truth, called from `handle_new_user()`) and `profiles.referred_by`.
  Credits are the ENTIRE reward currency for now, matching this app's
  standing "billing doesn't exist yet" reality — `account_credits` is
  designed so a future subscription flow consumes this balance
  automatically rather than needing a redesign (PROMPTS.md Session 10 now
  requires whatever billing provider is picked to honor both this balance
  and `profiles.plan`, see PART 2).
  MASKING, enforced server-side not by RLS alone: the referrer's own RLS
  policy on `referrals` only ever lets them read rows where
  `referrer_id = auth.uid()`, but that row's `referred_label` column is
  written ONCE by the `referral-sync` Edge Function (service_role, the
  only thing with access to the referred person's real `profiles` row) —
  `app/src/referral/maskLabel.ts`'s `buildMaskedReferralLabel()` (initials
  "A. B." if a name exists, else "New member (Month Year)") is mirrored
  inline in the Edge Function (Deno can't import `app/src` TS, same
  standing convention as every other Edge Function in this repo). The
  referrer's client query never touches the referred person's real
  `profiles` row at all — there is no view/RPC exposing it, masked or
  not.
  QUALIFICATION (anti-abuse, a bare signup earns nothing):
  `app/src/referral/qualification.ts`'s `resolveQualification()` requires
  ALL FOUR of email confirmed, onboarding completed, at least one
  document imported, AND 7+ days since signup
  (`MIN_DAYS_SINCE_SIGNUP`) — evaluated lazily/opportunistically (no real
  cron in this sandboxed environment; same limitation already accepted
  for the weekly AI review feature) from two trigger points: the Referral
  screen's own mount and once per session from Home
  (`useReferralSyncOnce()`, `app/src/data/referral.ts` — a module-level
  `syncedThisSession` flag prevents a redundant call on every remount).
  Self-referral is blocked via `app/src/referral/selfReferral.ts`'s
  `isLikelySelfReferral()` — email-normalization heuristic (strips
  `+tag`, strips dots, and unifies `gmail.com`/`googlemail.com` as one
  canonical domain, since Google truly treats those as the same mailbox
  space) checked inside `referral-sync`; a device-id cross-check was
  explicitly considered (would have needed `expo-application`/
  `expo-device`, a new native dependency) and deliberately deferred
  rather than added, flagged here rather than silently skipped.
  `MAX_REWARDED_REFERRALS_PER_REFERRER = 25` caps how many of one
  referrer's referrals can ever count toward a reward; anything past the
  cap is left `pending` for manual review rather than silently
  discarded or auto-granted.
  REWARD MATH: `app/src/referral/reward.ts`'s
  `computeNewRewardGrants(before, after) = floor(after/3) -
  floor(before/3)` — a stateless floor-division formula chosen
  specifically over a separate mutable counter so it stays correct even
  under batch/out-of-order evaluation (proven by dedicated tests: 2→5
  grants once, 2→7 grants twice, 0→6 grants twice). Every 3rd qualified
  referral grants the referrer 60 days (`REFERRER_REWARD_DAYS`); the
  referred user gets 14 days (`REFERRED_WELCOME_CREDIT_DAYS`) the moment
  their own referral qualifies, so sharing isn't one-sided.
  DELETE SAFETY, the spec's own explicit requirement ("deleting an
  account must NOT wipe the referrer's earned credits"): enforced by FK
  design, not application code — `referrals.referred_user_id` is `on
  delete set null` (the row survives, only that column nulls; the
  referrer's own history and already-granted `account_credits` rows are
  completely untouched) while `referrals.referrer_id` is `on delete
  cascade` (a referrer's own OUTGOING referral history disappears with
  their own account, which is correct/expected) and
  `account_credits.source_referral_id` is `on delete set null`. Both
  `reset-data`/`delete-account` Edge Functions additionally run one
  bespoke `delete().eq('referrer_id', userId)` on `referrals` (it has no
  single `user_id` column, so it can't join the standard per-table
  deletion loop) — scoped to `referrer_id` only, never
  `referred_user_id`, so a user resetting/deleting their OWN account
  never touches a row where they're the REFERRED party (that row, and
  whatever it already earned someone else, belongs to that other
  person's history). `account_credits` (a normal `user_id`-scoped table)
  rides the standard deletion loop in both functions.
  UI (`app/(tabs)/more/referral.tsx`, Menu → Tools → "Invite & earn" —
  `app/src/navigation/navRegistry.ts`'s one shared registry, same NAV
  PARITY pattern as every other route): progress ("2 of 3 qualified — 1
  more for 2 free months" via `computeReferralProgress()`), the user's
  code with 4 share actions (native system sheet, WhatsApp, SMS, copy —
  `app/src/referral/referralShare.ts`, deliberately built as plain
  `Linking`/`Share`/`expo-clipboard` calls rather than reusing
  `useShareCapture`/`ShareCardModal`, which are built around image
  capture this feature doesn't need) with a pre-written message in the
  user's own language (`app/src/referral/shareMessage.ts`, `t()`-sourced
  body), the invite list (masked label + status + a one-line "what does
  qualified mean" explainer), and total credit earned with an explicit
  "applies automatically when paid plans launch" note (this app has no
  billing yet — CLAUDE.md's own top-level product-decisions list, PART 2
  below). SIGNUP SIDE: `app/app/(auth)/sign-up.tsx` gained an optional
  referral-code field, prefilled from a deep link's `?ref=` query param
  (`app/app/(tabs)/more/referral.tsx`'s own share deep link is built as
  `buildAuthRedirectUrl('sign-up')?ref=...` — NOT
  `'(auth)/sign-up'`, since expo-router's parenthesized route GROUPS are
  invisible in the actual runtime URL, only in `useSegments()`), format-
  validated client-side via `isValidReferralCodeFormat()` with a friendly
  inline error before ever reaching the server; `AuthContext.signUp()`
  passes it through `supabase.auth.signUp()`'s own `data:
  {referred_by_code}` field, consumed by `handle_new_user()`.
  PART 2 — LIFETIME / COMPLIMENTARY ACCOUNTS (owner-granted, no self-
  service upgrade path exists or is planned here): `profiles.plan`
  (`'free_trial'|'paid'|'lifetime'|'complimentary'`, default
  `'free_trial'`), `profiles.plan_note` (free text — "family", "beta
  tester", "accountant partner"), `profiles.plan_granted_at`. RLS lets a
  user SELECT their own `plan`/`plan_note`/`plan_granted_at` but there is
  NO insert/update/delete policy permitting a client to write them at
  all — the actual enforcement (since `profiles` otherwise has a normal
  client-writable UPDATE policy for every other column, e.g. company
  name/locale) is a new `protect_profile_plan_fields()` `BEFORE UPDATE`
  trigger, a genuinely new pattern for this repo (prior "admin-only"
  precedents, like `tax_year_data`, were table-level; this is
  column-level on an otherwise-client-writable table) — it raises unless
  `auth.role() = 'service_role'` OR `current_user = 'postgres'`. The
  `postgres`-role allowance is deliberate and was caught BEFORE it could
  ship as a bug: the Supabase Dashboard's own SQL Editor connects as the
  `postgres` Postgres role with no `request.jwt.claims` set at all, so
  `auth.role()` never evaluates to `'service_role'` there — without the
  `current_user` escape hatch, the ADMIN's OWN manual grant-a-plan-by-
  email recipe (docs/ADMIN_RUNBOOK.md's new "Lifetime / Complimentary
  Accounts" section) would have been blocked by its own protection
  trigger.
  ONE ENTITLEMENT HELPER: `app/src/entitlement/hasFullAccess.ts`'s
  `hasFullAccess(profile)` — true for `'lifetime'`, `'complimentary'`, OR
  `'paid'` — is the SINGLE gate every feature-paywall/upsell surface must
  read going forward; `isOwnerGrantedPlan(profile)` (true only for
  `'lifetime'`/`'complimentary'`) is the narrower check Settings' own
  badge uses to decide which of the two badge strings to show. Session
  10's eventual billing integration plugs into `hasFullAccess()` with NO
  feature-code changes required elsewhere, by design. Settings
  (`app/(tabs)/more/settings.tsx`) shows a small "Lifetime access" /
  "Complimentary access" badge (with the owner's own `plan_note`) reading
  `useProfile()`'s FULL row (not AuthContext's narrower `profile`, which
  doesn't carry `plan`). AUDIT NOTE, stated plainly rather than claimed
  complete: this app currently has NO paywalls, upgrade prompts, trial
  countdowns, or renewal nags anywhere yet (there is no billing feature
  to gate in the first place, confirmed by a repo-wide search before
  writing this) — `hasFullAccess()`/`isOwnerGrantedPlan()` exist now as
  the ONE place any FUTURE such surface must check, per the spec's own
  explicit ask, not because an existing surface needed auditing away.
  Referral rewards still accrue normally for lifetime/complimentary users
  (the qualification/reward pipeline has no plan check at all) — the
  spec's "UI must not imply they need them" is satisfied by there being
  no such UI to mislead them, not by suppressing the Referral screen for
  these users.
  ADMIN_RUNBOOK.md gained 3 copy-paste SQL recipes (grant a plan by
  email, list every non-paying account, revoke back to `'free_trial'`)
  plus a "Known Limitation: No Real Cron Yet" section for the referral
  qualification pipeline, recommending a real Supabase Scheduled Function
  as the eventual fix and providing a spot-check SQL query in the
  meantime.
  DELIVERABLES: 88 suites / 2053 tests pass (qualification state machine,
  reward-at-exactly-3, self-referral blocked including the gmail/
  googlemail equivalence case, credits accumulate correctly across
  batched/out-of-order evaluation, a lifetime user's `hasFullAccess()`
  always returns true regardless of credits/plan-adjacent state, and a
  plain authenticated client cannot change its own `plan` — proven at the
  trigger-logic level via `protect_profile_plan_fields()`'s own
  documented condition, this repo has no live Postgres to run an actual
  RLS-bypass integration test against); `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`nav.referral`, the full `referral.*`
  block, `auth.referralCodePlaceholder`/`errorInvalidReferralCode`,
  `settings.lifetimeAccessBadge`/`complimentaryAccessBadge` — hi/uk as
  untranslated English copies per invariant #11). `referral-sync` (a
  BRAND NEW Edge Function), `reset-data`, and `delete-account` (both
  MODIFIED this pass) have all been deployed/redeployed;
  `ai-import`/`ai-advisor` were NOT touched, no redeploy needed for
  either. No native rebuild was needed — every change in this pass is
  pure JS/TS plus SQL/Edge Function work, no new native dependency was
  added (the device-id self-referral check that would have needed one
  was deliberately deferred, see above) — the client side shipped via a
  normal `eas update`, published to preview. `referral.tnc` is a
  placeholder T&C line
  (PROMPTS.md's Session 10 entry flags it, same "DRAFT, not attorney-
  reviewed" status as the rest of this app's legal copy) pending real
  legal review, same as Terms of Use/Privacy Policy.
