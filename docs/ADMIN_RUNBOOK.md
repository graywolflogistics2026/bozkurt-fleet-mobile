# Admin Runbook — Tax Year Data

This is the only place tax constants live (CLAUDE.md invariant: no tax
constant may live in app code). Updating a year's figures or rolling over to
a new tax year is a SQL edit against `tax_year_data`, run directly in the
Supabase SQL editor — no app release required. Users on any app version pick
up the change on their next launch (offline-cached copies refresh then too).

## Yearly checklist (every November, ahead of the new tax year)

1. Gather the new IRS figures for the upcoming `tax_year`:
   - Federal income tax brackets (MFJ, single, HoH) and standard deductions
   - SE-tax rate/factor and the new Social Security wage base
   - Per diem rate (currently $64/day, 100%-in-expenses per the net-pay
     model — confirm this hasn't changed)
   - The four quarterly estimated-tax deadline dates
   - Any state tax rate/bracket changes for the states already covered in
     `state_tax` — AND whether a state's classification itself has changed
     (flat vs. progressive-bracket). This isn't hypothetical: the 2026
     verification below found Georgia and North Carolina had both moved to
     flat-rate taxation since this app's state-tax design was first drafted
     (which had assumed them as "bracket" states). Don't assume last year's
     no_tax/flat/bracket bucketing still holds — re-check each covered
     state's current law, not just its rate.
2. Insert the new row using the template below with `published = false`
   first, so you can review it before it goes live.
3. Sanity-check the new row against a couple of known net-profit figures
   (e.g. re-run the numbers from last year's row through the same formula
   and confirm the app's dashboard matches by hand for a test user with
   `tax_config.tax_year` pointed at the new year).
4. Flip `published = true` when ready. The app will start using it for any
   user whose `tax_config.tax_year` equals the new year (typically after
   they roll over on Jan 1 — see PROMPTS.md Session 5's year-rollover
   behavior) and will keep showing the fallback banner for anyone still
   pointed at the new year before you publish it.
5. Do NOT delete or edit a published prior year's row — it's the audit
   trail for any estimate a user saw/relied on that year. Add a new row
   instead; only correct a live row's `notes`/typo-level fields, not its
   numbers, once it's been published and used.

## INSERT template

Replace every `<...>` placeholder with the confirmed IRS/state figure for
that year before running. Numeric values marked `<verify>` are real-world
figures this runbook cannot supply reliably — confirm them against the
actual IRS/state publication for that year before publishing.

```sql
insert into tax_year_data (
  tax_year, federal_brackets, standard_deduction, se_tax, per_diem,
  quarterly_deadlines, state_tax, published, notes
) values (
  <year>,
  '{
    "mfj":    [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]],
    "single": [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]],
    "hoh":    [[0, <b1_hi>, 0.10], [<b1_hi>, <b2_hi>, 0.12], [<b2_hi>, <b3_hi>, 0.22], [<b3_hi>, <b4_hi>, 0.24], [<b4_hi>, <b5_hi>, 0.32], [<b5_hi>, <b6_hi>, 0.35], [<b6_hi>, null, 0.37]]
  }'::jsonb,
  '{"mfj": <std_mfj>, "single": <std_single>, "hoh": <std_hoh>}'::jsonb,
  '{"rate": 0.153, "factor": 0.9235, "ss_wage_base": <verify>}'::jsonb,
  '{"daily_rate": 64, "deductible_pct": 100}'::jsonb,
  '[["Q1", "<year>-04-15"], ["Q2", "<year>-06-15"], ["Q3", "<year>-09-15"], ["Q4", "<year_plus_1>-01-15"]]'::jsonb,
  '{
    "no_tax": ["TX","FL","TN","WA","NV","SD","WY","AK","NH"],
    "flat": {"<state>": <verify — ALWAYS a bare rate number, never a nested object, even for a state with an exemption or surtax>},
    "flat_adjustments": {"<state>": <verify — only for flat-rate states whose law isn't a single bare rate, e.g. {"exempt_below": N} or {"surtax_rate": R, "surtax_over": N}; applied AFTER the flat rate, never in place of it>},
    "bracket": {"<state>": <verify — only for states genuinely still using progressive brackets that year; re-check this every year, don't carry a state over from last year's list>},
    "fallback_effective_rate": <verify>
  }'::jsonb,
  false,
  'Seeded <date>; brackets/std-deduction/SS-wage-base per IRS Rev. Proc. for <year>; state figures per each state''s revenue dept. Reviewed by: <name>.'
);

-- After review, publish it:
-- update tax_year_data set published = true where tax_year = <year>;
```

## 2026 row — verified reference example

The 2026 row is a special case in two ways: its federal brackets, standard
deduction, SE-tax rate/factor, and per diem are ported VERBATIM from legacy
`calcTax()`, not gathered fresh from an IRS publication (they already went
through that process when the legacy app was built) — and it's the first
row ever verified and published, so it doubles as the worked example for
every future year's checklist above. Verified and published 2026-07-03; the
applied SQL is in `docs/PENDING_SQL.md` §3.

**Federal (verbatim from legacy calcTax, unchanged from seed):**
- `standard_deduction`: `{mfj: 30000, single: 15000, hoh: 22500}`
- `se_tax`: `{rate: 0.153, factor: 0.9235, ss_wage_base: 184500}` — the
  `ss_wage_base` is recorded for future-proofing only; legacy's math applies
  SE tax UNCAPPED (no wage-base cutoff), so this figure does not change the
  2026 computation. Don't start applying the cap without an explicit,
  separate owner decision to do so.
- `per_diem`: `{daily_rate: 64, deductible_pct: 100}`
- `quarterly_deadlines`: `[["Q1","2026-04-15"],["Q2","2026-06-15"],["Q3","2026-09-15"],["Q4","2027-01-15"]]`

**State tax (verified 2026-07-03, source: Tax Foundation 2026 for flat
states, official FTB 2025 Schedule X/Y/Z for CA):**
- `no_tax`: `["TX","FL","TN","WA","NV","SD","WY","AK","NH"]` (unchanged)
- `flat` — always BARE rate numbers, never a nested object, for every state
  in this map:
  - `NC`: 3.99%
  - `GA`: 4.99% — **reclassified from bracket to flat this cycle**; Georgia
    completed its move to a flat individual income tax
  - `UT`: 4.45%
  - `OH`: 2.75% (its exemption lives in `flat_adjustments`, not here — see
    below)
  - `IL`: 4.95% — verified this pass (was wrongly left off as a "bracket"
    state in the original design; it's flat in reality)
  - `PA`: 3.07% — verified this pass (same correction as IL)
  - `NC`/`GA`/`IL`/`PA` were ALL "bracket" states in the original design
    (PROMPTS.md Session 5's "CA, GA, IL, NC, PA" list) — that list was
    written before checking current law and turned out wrong for four of
    the five. PROMPTS.md has been corrected. Treat any such list as a
    starting point to re-verify every year, never as settled.
- `flat_adjustments` — a SEPARATE object, keyed by state, for flat-rate
  states whose real law isn't just a single bare rate. Applied AFTER the
  state's `flat` rate is computed, as a second pass — never folded into
  `flat` itself. Live shape:
  - `OH`: `{"exempt_below": 26050}` — 0% on income below $26,050, then the
    flat 2.75% above it.
  - `MA`: `{"surtax_rate": 0.04, "surtax_over": 1000000}` — an additional
    4% on income over $1,000,000, on top of MA's own `flat` rate entry.
    (MA's own bare `flat` rate isn't itemized in this pass yet — add it
    when MA is fully verified; don't assume a number for it.)
  - This resolves what used to be an open question about how a state like
    Ohio, which doesn't fit a single bare rate, should be represented: it
    does NOT get a nested object inside `flat`. It gets a `flat` entry
    (bare rate) plus a `flat_adjustments` entry (the exemption/surtax
    logic). The state-tax module must apply `flat_adjustments` for a state
    as a second pass over the flat-rate result, not as a replacement.
- `bracket`:
  - `CA`: the LIVE 2026 row holds the full numeric official FTB Schedule X
    (single) / Y (MFJ) / Z (HoH) bracket arrays — confirmed present and
    correctly shaped (verified directly against the live row, not this
    runbook) — the ONLY state, as of 2026, that's still genuinely
    progressive. California's brackets range from 1% to 12.3% (plus a
    separate 1% Mental Health Services surcharge above $1M that the app
    does not yet model). This runbook deliberately does NOT reproduce the
    exact thresholds here — they're inflation-indexed and shift slightly
    every year, so for any FUTURE year, transcribe them fresh from the live
    `tax_year_data` row or the FTB publication rather than copying last
    year's numbers (from here or anywhere else) forward.
- `fallback_effective_rate`: 0.045 — the generic approximation used for
  every state not explicitly listed above.

Use this row as the template for what "verified" should look like for any
future year: every rate sourced and cited, every state's flat-vs-bracket
classification re-checked rather than carried over, and any state whose law
doesn't fit the common shape (Ohio's exemption, Massachusetts' surtax)
represented via `flat_adjustments` instead of silently squeezed into
`flat` or skipped.

## Email Confirmation + Redirect URLs (owner decision 2026-08-24, NEXT PASS item B2)

The app now has a full email-confirmation flow (`app/app/(auth)/check-email.tsx`,
`app/app/confirm-email.tsx`) and a forgot-password flow
(`app/app/(auth)/forgot-password.tsx`, `app/app/reset-password.tsx`) — both
are already wired in the CODE and require exactly these Supabase Dashboard
steps to actually activate/work against the live project (no SQL, no app
release needed for this part):

1. **Enable "Confirm email"**: Supabase Dashboard → **Authentication →
   Providers → Email** (sometimes **Authentication → Sign In / Providers**
   depending on dashboard version) → toggle **Confirm email** ON. Until
   this is enabled, `supabase.auth.signUp()` grants a session immediately
   and the app's `confirmation_required` code path (check-email.tsx) is
   simply never reached — this is expected, not a bug, per
   `src/auth/signUpFlow.ts`'s own documented "two legitimate outcomes"
   comment.
2. **Add both deep-link redirect URLs to the allowlist**: Supabase
   Dashboard → **Authentication → URL Configuration → Redirect URLs** —
   add:
   - `bozkurtfleetos://confirm-email`
   - `bozkurtfleetos://reset-password`

   This step is NOT optional — Supabase Auth rejects/ignores an
   `emailRedirectTo`/`redirectTo` value that isn't on this allowlist and
   silently falls back to the project's default Site URL instead, which
   would NOT deep-link back into the app at all. Both URLs use the app's
   existing custom `scheme` (`app.config.js`'s `scheme: 'bozkurtfleetos'`,
   unchanged by this pass) — no native rebuild needed for this step
   itself, since the scheme was already registered in prior builds.
3. **Existing accounts are not affected**: Supabase auto-sets
   `email_confirmed_at` at signup time whenever "Confirm email" is off,
   so every account created before step 1 already has it set and will
   never see the app's new confirmation gate (`needsEmailConfirmation`,
   `src/auth/profileGates.ts`) — only accounts created AFTER this toggle
   flips will be asked to confirm.
4. **Test end to end** before considering this done: sign up a fresh
   test account, confirm the confirmation email arrives, tap its link on
   a device with the app installed, and confirm it opens the app at
   `confirm-email.tsx` and clears the gate (rather than opening a browser
   or a Supabase-hosted generic page). Repeat for a password-reset email
   via `forgot-password.tsx`.
5. **Product-email channel note** (owner ask, Session 10 backlog item):
   once "Confirm email" is on, every confirmed email address is also a
   verified channel for OCCASIONAL product emails (release notes, major
   feature announcements) — NOT transactional spam, and always with a
   working opt-out. This is a genuinely NEW capability this pass enables,
   not something already built: no opt-in/opt-out preference field, email
   template, or sending mechanism exists yet anywhere in this codebase.
   Flagged here as a Session 10 backlog item requiring its own explicit
   owner decision (a new `profiles` opt-out column, an actual sending
   pipeline — Supabase Auth's own SMTP is for AUTH emails only, a separate
   provider integration would be needed for arbitrary product emails) —
   not something to build speculatively ahead of that decision.

## Custom SMTP (owner decision 2026-08-05, FULL PARITY follow-up item J)

By default, Supabase Auth sends every system email (signup confirmation,
password reset, magic link) FROM its own shared sender
(`noreply@mail.app.supabase.io`) — this works, but it's rate-limited (a
few emails/hour on the free tier) and doesn't carry the app's own brand
or support address. Once real user volume justifies it, switch to a
custom SMTP provider so these emails come from
`SUPPORT_EMAIL` (`app/src/brand.ts`, currently `bozkatruckingai@gmail.com`)
or a proper `noreply@<yourdomain>` once a domain exists. Exact dashboard
steps (Supabase Dashboard, not a SQL/code change):

1. Pick an SMTP provider (Resend, Postmark, SendGrid, or even a Google
   Workspace account if `bozkatruckingai@gmail.com` is upgraded to one —
   plain consumer Gmail SMTP works for low volume but Google actively
   throttles/flags automated sends from a free Gmail account, so a real
   transactional-email provider is the durable choice once volume grows).
2. In the provider's own dashboard, generate SMTP credentials (host,
   port, username, password) and verify sender-domain ownership (SPF/
   DKIM DNS records) for whatever "from" address/domain you'll use.
3. Supabase Dashboard → **Project Settings → Authentication → SMTP
   Settings** (sometimes labeled **Auth → Emails → SMTP Provider**
   depending on dashboard version) → toggle **Enable Custom SMTP**.
4. Fill in: **Sender email** (the "from" address, e.g. `SUPPORT_EMAIL` or
   a domain-based noreply address), **Sender name** (the brand's display
   name, `app/src/brand.ts`'s `BRAND_NAME`), **Host**, **Port**,
   **Username**, **Password** from step 2.
5. Save, then use the dashboard's own "Send test email" action to confirm
   delivery before relying on it for real signups.
6. Optionally customize the email TEMPLATES (Authentication → Emails →
   Templates) — the subject/body HTML for confirmation/reset/magic-link
   emails — to reference the brand name and `SUPPORT_EMAIL` instead of
   Supabase's generic default copy.
7. No app code change is required for any of this — the mobile app never
   sends these emails itself, it only triggers them via
   `supabase.auth.signUp()`/`resetPasswordForEmail()`, which always go
   through whatever SMTP config is active in the dashboard.

## Lifetime / Complimentary Accounts (owner decision 2026-08-24, PART 2)

`profiles.plan` (docs/PENDING_SQL.md §50) is read-only from the client —
enforced by a `BEFORE UPDATE` trigger (`protect_profile_plan_fields()`),
not just app-level convention. The trigger explicitly allows a query run
directly in the Supabase Dashboard's **SQL Editor** (it connects as the
`postgres` role) as well as the `service_role` key — you do NOT need to
go through any Edge Function to grant/revoke a plan; the three recipes
below are meant to be copy-pasted straight into the SQL Editor.

**1. Grant a plan by email** (`lifetime` or `complimentary` —
`plan_note` is a short freeform reason shown back to the user in
Settings, e.g. "family", "beta tester", "accountant partner"):

```sql
update profiles
set plan = 'lifetime', -- or 'complimentary'
    plan_note = 'family',
    plan_granted_at = now()
where user_id = (select id from auth.users where email = 'someone@example.com');
```

**2. List every non-paying account** (everything except a real `'paid'`
subscription — includes `free_trial` and both owner-granted plans, so
you can see at a glance who's on what):

```sql
select
  u.email,
  p.plan,
  p.plan_note,
  p.plan_granted_at,
  p.created_at as signed_up_at
from profiles p
join auth.users u on u.id = p.user_id
where p.plan <> 'paid'
order by p.created_at desc;
```

**3. Revoke back to `free_trial`** (clears the note/grant timestamp too
— a half-cleared plan with a stale note would be confusing in Settings):

```sql
update profiles
set plan = 'free_trial',
    plan_note = null,
    plan_granted_at = null
where user_id = (select id from auth.users where email = 'someone@example.com');
```

Every gated feature reads `app/src/entitlement/hasFullAccess.ts`'s
`hasFullAccess(profile)` — never `profile.plan` directly — so granting/
revoking here takes effect everywhere at once, with no other app change
needed. As of this writing there is no billing provider yet (PROMPTS.md
Session 10 backlog); `'paid'` exists in the schema now specifically so
that integration can plug into this same column/helper without a second
migration.

## Owner/Dev Account (owner decision, docs/PENDING_SQL.md §58)

`plan = 'owner'` is a 5th value on the SAME `profiles.plan` column as
Lifetime/Complimentary above, protected by the exact same
`protect_profile_plan_fields()` trigger (a client can never set it
either) — but it means something different: it's YOUR OWN account, for
heavy testing, and it behaves differently in three specific ways the
others don't:

1. **Bypasses the monthly AI-import allowance entirely**
   (`checkAiImportUsageAllowed()`/`consumeOneCreditIfOverAllowance()` in
   `supabase/functions/ai-import/index.ts` both check this FIRST, before
   any counting query) — no counter, no 80% soft-limit notice, no hard
   limit, no credit-pack prompt, anywhere.
2. **Excluded from usage analytics and per-user cost reporting by
   default** — every aggregate query below that reports usage/cost across
   multiple users filters `p.plan is distinct from 'owner'` so your own
   testing never skews the numbers used for pricing decisions. Every one
   of those recipes has a commented-out line showing exactly how to
   REMOVE that filter when you specifically want the TRUE infrastructure
   cost including your own usage.
3. **Still fully subject to the shared rate-limit cooldown** — deliberately
   NOT bypassed; that's the same Anthropic API key every real user draws
   from (`getRateLimitCooldownMs()`/`ai_rate_limit_state`), and letting an
   owner account skip it could genuinely hurt real users mid-cooldown.

Everywhere else, an owner account is a completely ordinary full-access
account — `hasFullAccess()` returns `true` for it exactly like `'paid'`/
`'lifetime'`/`'complimentary'`, so there is no separate dev-only code path
anywhere else in the app that could hide a bug a real user would hit
(Settings shows a small "🛠️ Owner account" badge instead of the lifetime/
complimentary one, purely cosmetic).

**1. Grant the owner plan by email:**

```sql
update profiles
set plan = 'owner',
    plan_note = 'dev/testing account',
    plan_granted_at = now()
where user_id = (select id from auth.users where email = 'you@example.com');
```

**2. Revoke back to `free_trial`** (same recipe as Lifetime/Complimentary
above):

```sql
update profiles
set plan = 'free_trial',
    plan_note = null,
    plan_granted_at = null
where user_id = (select id from auth.users where email = 'you@example.com');
```

**3. Check which accounts currently have the owner flag** (should
normally be a very short list — your own account(s) only):

```sql
select u.email, p.plan_note, p.plan_granted_at
from profiles p
join auth.users u on u.id = p.user_id
where p.plan = 'owner';
```

## Referral Program — Known Limitation: No Real Cron Yet (owner decision 2026-08-24, PART 1)

`supabase/functions/referral-sync/index.ts` evaluates whether a referral
has qualified — but it's only ever triggered by the app itself (the
"Invite & Earn" screen's own mount, plus one opportunistic call from
Home per session), never on a fixed schedule. This means a referred
person who meets every qualification criterion but never reopens the app
again will never actually get evaluated, and their referrer's reward
will never fire. **Recommended fix, not yet done**: add a Supabase
[Scheduled Function](https://supabase.com/docs/guides/functions/schedule-functions)
(pg_cron calling `referral-sync` — or a small wrapper that loops every
`referrals` row with `status = 'pending'` and calls the same evaluation
logic for each `referred_user_id`, since the current function only
evaluates the CALLER's own single row) running daily. Until that's set
up, a referral that's gone quiet can be manually nudged along by asking
the referred user to simply open the app.

**Spot-check a specific referral's status:**

```sql
select r.id, r.status, r.flagged_for_review, r.flag_reason, r.created_at, r.qualified_at, r.rewarded_at,
       ru.email as referrer_email, iu.email as referred_email
from referrals r
join auth.users ru on ru.id = r.referrer_id
left join auth.users iu on iu.id = r.referred_user_id
where ru.email = 'referrer@example.com'
order by r.created_at desc;
```

## AI Import Reliability — "non-2xx never leaks raw" pass (owner decision 2026-08-24)

Fixes the raw "Edge Function returned a non-2xx status code" SDK string
reaching users (root cause: `ai-import`'s Deno.serve handler had no
top-level try/catch, so an uncaught exception bypassed every one of its
own structured JSON error responses and let Deno's own non-JSON default
error page through instead — see the function's own TOP-LEVEL TRY/CATCH
comment). Every failure now returns real JSON with one of 6 machine codes
(`billing_exhausted`, `rate_limited`, `timeout`, `oversized`,
`invalid_document`, `internal`) plus a safe message — the client never
shows a raw string regardless.

**1. Owner diagnostic — see every non-2xx with its real cause:**

```sql
select l.created_at, l.call_type, l.success, l.failure_reason, u.email
from ai_usage_log l
join auth.users u on u.id = l.user_id
where l.success = false and l.created_at >= now() - interval '1 hour'
order by l.created_at desc;
```

`failure_reason` is now `"{errorType}: {the real server-side message}"`
(e.g. `"internal: Anthropic API returned HTTP 500."`) — the machine code
alone used to be all that was stored; the actual cause is queryable here
now too, not just in `supabase functions logs ai-import` (which still has
the FULL, untruncated detail — raw Anthropic HTTP status + response body
— for every failure, via `console.error`, searchable there when this
column's 400-char truncation isn't enough).

**2. Breakdown of failure causes over a period** (which of the 6 codes is
actually happening most, e.g. to decide whether a rate-limit issue is
real or rare) — excludes the owner/dev account by default (owner decision,
docs/PENDING_SQL.md §58, item 2) so your own testing never makes a rare
failure type look more common than it really is for real users; comment
out the `and p.plan is distinct from 'owner'` line to include it:

```sql
select
  split_part(l.failure_reason, ':', 1) as error_type,
  count(*) as occurrences
from ai_usage_log l
join profiles p on p.user_id = l.user_id
where l.call_type = 'ai_import' and l.success = false
  and l.created_at >= now() - interval '7 days'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by 1
order by 2 desc;
```

**3. Check/clear the shared rate-limit cooldown** (`ai_rate_limit_state`,
docs/PENDING_SQL.md §56 — one GLOBAL row, since every user shares ONE
Anthropic API key; BATCH BACK-PRESSURE pass, item 3):

```sql
-- Is the cooldown currently active, and why was it set?
select limited_until, last_reason, updated_at,
       greatest(0, extract(epoch from (limited_until - now())))::int as seconds_remaining
from ai_rate_limit_state where id = true;

-- Manually clear it (e.g. you know the underlying Anthropic issue is
-- already resolved and don't want to wait out the automatic cooldown)
update ai_rate_limit_state set limited_until = null, updated_at = now() where id = true;
```

**4. Concurrency (`AI_IMPORT_BATCH_CONCURRENCY`) and Anthropic rate
limits — answered plainly (item 4):** this environment has no credentials
to query the Anthropic Console for this account's actual usage tier, so
the real per-minute/per-token ceiling for THIS account is genuinely
unknown from here — check
[console.anthropic.com](https://console.anthropic.com)'s own Limits page
for the authoritative numbers (Anthropic's published tiers scale
requests-per-minute, input-tokens-per-minute, and output-tokens-per-minute
together with account spend history; a brand-new/low-spend account sits
on the lowest tier, which can be a genuinely small number of concurrent
requests). Given that uncertainty, `AI_IMPORT_BATCH_CONCURRENCY` is left
at its existing default of **2** by this pass, not raised — the same
"prefer a small, evidence-based increase over a speculative jump" caution
the SPEED UP SETTLEMENT IMPORT pass already established (CLAUDE.md), now
reinforced by two NEW safety nets this pass adds regardless of whatever
the number turns out to be: the GLOBAL rate-limit cooldown (§3 above,
recipe 3) means one 429 anywhere pauses every other in-flight/about-to-
start call across every user's job, and background jobs now back off and
retry automatically instead of failing outright. **Recommended next
step**: after this deploys, watch recipe #2 above for a week of real
multi-document usage. If `rate_limited` never (or rarely) appears, raise
`AI_IMPORT_BATCH_CONCURRENCY` to 3 in the Edge Function's environment
variables (Supabase Dashboard → Edge Functions → ai-import → Settings —
no redeploy needed, it's read fresh via `Deno.env.get()` on every
invocation) and watch again before going any higher. For a 10-document
batch specifically: each document is its own independent background job
(docs/PENDING_SQL.md §54) — `AI_IMPORT_BATCH_CONCURRENCY` only bounds how
many PAGES of ONE document run at once, not how many of the 10 documents
run at once (all 10 jobs start and run concurrently, each internally
respecting the page-level concurrency limit) — the global cooldown gate
is what actually keeps 10 simultaneous jobs from independently hammering
Anthropic if any one of them gets rate-limited.

## AI Cost Control (owner decision 2026-08-24, FIVE ADDITIONS pass, PART 4)

**1. See ai-import/ai-advisor failures in the last hour:**

```sql
select l.created_at, l.call_type, l.success, l.failure_reason, u.email
from ai_usage_log l
join auth.users u on u.id = l.user_id
where l.success = false and l.created_at >= now() - interval '1 hour'
order by l.created_at desc;
```

**2. Post (or clear) a real outage banner** — shows on Home and Import
instantly, no app release needed:

```sql
-- Post an outage message
update service_status
set status = 'down', message = 'AI reading is temporarily unavailable while we investigate. You can still add entries manually.', updated_at = now()
where service = 'ai_import';

-- Clear it once resolved
update service_status
set status = 'ok', message = null, updated_at = now()
where service = 'ai_import';
```

`status` also accepts `'degraded'` for a lighter-weight "may be slow"
notice with your own custom `message` text.

**3. Review AI usage/cost per user** (last 30 days, both call types) —
excludes the owner/dev account by default (owner decision, docs/
PENDING_SQL.md §58, item 2) so heavy personal testing never skews the
per-user numbers you'd use for pricing decisions; comment out the
`and p.plan is distinct from 'owner'` line (or remove it) to see the TRUE
infrastructure cost including your own usage:

```sql
select u.email,
       count(*) filter (where l.call_type = 'ai_import') as ai_import_calls,
       count(*) filter (where l.call_type = 'ai_import' and l.success) as ai_import_successes,
       count(*) filter (where l.call_type = 'ai_advisor') as ai_advisor_calls,
       count(*) filter (where l.call_type = 'ai_advisor' and l.success) as ai_advisor_successes
from ai_usage_log l
join auth.users u on u.id = l.user_id
join profiles p on p.user_id = l.user_id
where l.created_at >= now() - interval '30 days'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by u.email
order by ai_import_calls desc;
```

## AI Usage Limits + Credit Packs (owner decision 2026-08-24, FIVE ADDITIONS pass, PART 5)

**1. Adjust the AI-import allowance without a release** (the default is 60
imports per active truck per month, with an optional flat account
ceiling):

```sql
update ai_usage_config
set imports_per_truck_per_month = 75, updated_at = now()
where id = true;

-- Or cap a specific big account at a flat ceiling regardless of truck count
update ai_usage_config
set account_ceiling = 1000, updated_at = now()
where id = true;
```

Note: `ai_usage_config` is currently a single global row (one setting for
every account) — a genuinely PER-ACCOUNT override isn't built yet; that
would need its own `user_id`-scoped table if a specific customer ever
needs a different number than everyone else.

**2. Grant a credit pack by email** (same "billing isn't built yet, record
purchases as owner-granted entries" pattern as lifetime plans, §L4
above). `pack_type` is one of `pack_25` (25 credits) / `pack_100` (100) /
`pack_300` (300) / `catchup_year` (1,000 credits, expires in 90 days):

```sql
-- A standard, never-expiring pack
insert into ai_credit_purchases (user_id, pack_type, credits_granted, credits_remaining)
select id, 'pack_100', 100, 100
from auth.users where email = 'someone@example.com';

-- The Catch-Up Year pack (expires 90 days from now)
insert into ai_credit_purchases (user_id, pack_type, credits_granted, credits_remaining, expires_at)
select id, 'catchup_year', 1000, 1000, now() + interval '90 days'
from auth.users where email = 'someone@example.com';
```

**3. Check a user's current usage + credit balance:**

```sql
select
  u.email,
  (select count(*) from ai_usage_log l where l.user_id = u.id and l.call_type = 'ai_import' and l.success
     and l.created_at >= date_trunc('month', now())) as imports_used_this_month,
  (select coalesce(sum(credits_remaining), 0) from ai_credit_purchases c
     where c.user_id = u.id and (c.expires_at is null or c.expires_at > now())) as credits_remaining
from auth.users u
where u.email = 'someone@example.com';
```

## Usage Analytics (owner decision, docs/PENDING_SQL.md §71) — privacy-safe, owner-only

`app_usage_events` records ONLY the bare event — which screen was opened
or which action was started/completed, a timestamp, and the user id.
Never a financial value, description, or document content. Nobody can
read this table through the app itself (no SELECT policy at all) — only
these recipes, run here as the `postgres`/service_role, can. Every
recipe below excludes the owner/dev account by default (same `p.plan is
distinct from 'owner'` pattern as AI Cost Control above) so your own
testing never skews the numbers you'd use to decide what to simplify —
remove that line to include your own activity.

**1. Screens ranked by unique users and by total opens** (last 30 days):

```sql
select e.name as screen,
       count(distinct e.user_id) as unique_users,
       count(*) as total_opens
from app_usage_events e
join profiles p on p.user_id = e.user_id
where e.kind = 'screen'
  and e.created_at >= now() - interval '30 days'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by e.name
order by unique_users desc, total_opens desc;
```

**2. Screens never opened by anyone** — SQL has no way to know the app's
own route table dynamically, so this diffs against a pasted-in list of
every screen as of this writing (`app/src/navigation/navRegistry.ts`'s
`RAW_NAV_GROUPS` — update this list whenever a screen is added/removed
there, same "no automatic way to stay in sync" caveat every other
hand-maintained list in this file already carries):

```sql
with known_screens(name) as (
  values
    ('/(tabs)'), ('/(tabs)/transactions'),
    ('/(tabs)/import'), ('/(tabs)/more/loads'), ('/(tabs)/more/settlements'),
    ('/(tabs)/more/reimbursements'), ('/(tabs)/more/other-income'),
    ('/(tabs)/more/fuel'), ('/(tabs)/more/maintenance'), ('/(tabs)/more/tolls'), ('/(tabs)/deductions'),
    ('/(tabs)/more/asset-register'), ('/(tabs)/more/accountant-package'), ('/(tabs)/more/ai-advisor'),
    ('/(tabs)/more/tax-estimator'), ('/(tabs)/more/share-profit'), ('/(tabs)/more/compliance'),
    ('/(tabs)/more/documents'), ('/(tabs)/more/category-learning'), ('/(tabs)/more/referral'),
    ('/(tabs)/more/data-cleanup'),
    ('/(tabs)/more/trucks'), ('/(tabs)/more/truck-comparison'), ('/(tabs)/more/truck-assignments'),
    ('/(tabs)/more/equipment'), ('/(tabs)/more/drivers'), ('/(tabs)/more/capital-account'),
    ('/(tabs)/more/operating-pnl'),
    ('/(tabs)/truck-health'), ('/(tabs)/more/cash-flow'), ('/(tabs)/more/scorecard'), ('/(tabs)/more/loans'),
    ('/(tabs)/more/credit-cards'), ('/(tabs)/more/bank-statements'), ('/(tabs)/more/profit-analysis'),
    ('/(tabs)/more/ceo-mode'),
    ('/(tabs)/more/settings')
)
select k.name as never_opened_screen
from known_screens k
left join app_usage_events e on e.name = k.name and e.kind = 'screen'
where e.name is null
order by k.name;
```

**3. Actions started vs. completed** (drop-off rate, all time):

```sql
select e.name as action,
       count(*) filter (where e.status = 'started') as started,
       count(*) filter (where e.status = 'completed') as completed,
       count(*) filter (where e.status = 'started') - count(*) filter (where e.status = 'completed') as abandoned
from app_usage_events e
join profiles p on p.user_id = e.user_id
where e.kind = 'action'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by e.name
order by started desc;
```

**4. The same two breakdowns, split by account age** (new accounts —
under 30 days old — vs. established ones, to see if a screen/action is a
new-user onboarding thing or an everyone-uses-it thing):

```sql
-- Screens, by account age bucket
select e.name as screen,
       case when u.created_at >= now() - interval '30 days' then 'new (<30d)' else 'established' end as account_age,
       count(distinct e.user_id) as unique_users,
       count(*) as total_opens
from app_usage_events e
join auth.users u on u.id = e.user_id
join profiles p on p.user_id = e.user_id
where e.kind = 'screen'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by e.name, account_age
order by e.name, account_age;

-- Actions started vs completed, by account age bucket
select e.name as action,
       case when u.created_at >= now() - interval '30 days' then 'new (<30d)' else 'established' end as account_age,
       count(*) filter (where e.status = 'started') as started,
       count(*) filter (where e.status = 'completed') as completed
from app_usage_events e
join auth.users u on u.id = e.user_id
join profiles p on p.user_id = e.user_id
where e.kind = 'action'
  and p.plan is distinct from 'owner' -- remove this line to include your own testing
group by e.name, account_age
order by e.name, account_age;
```

## Business Balance Ledger Reconciliation (owner decision, device report: business_balance grew by an unexplained amount)

`profiles.business_balance` starts at 0 and is ONLY ever moved by two atomic
mechanisms: a settlement's own `business_balance_credit` (applied on save/
re-import, reversed automatically on delete via the `AFTER DELETE` trigger,
docs/PENDING_SQL.md §70) and a manual `capital_transactions` row's own
`business_balance_applied` (§60 — a LINKED contribution's own value is
always 0). That means the CURRENT balance should always exactly equal the
sum of every currently-existing settlement's own credit plus every
currently-existing manual transaction's own applied delta — this query
reconstructs that expected total and flags any account where it disagrees
with what's actually stored (the same reconciliation the app itself now
shows on Capital Account's own "🔍 Verify Balance" action, so the two can
never disagree about the arithmetic):

```sql
select
  u.email,
  p.business_balance as stored_balance,
  coalesce((select sum(s.business_balance_credit) from settlements s where s.user_id = u.id), 0) as settlements_total,
  coalesce((select sum(c.business_balance_applied) from capital_transactions c where c.user_id = u.id), 0) as manual_transactions_total,
  coalesce((select sum(s.business_balance_credit) from settlements s where s.user_id = u.id), 0)
    + coalesce((select sum(c.business_balance_applied) from capital_transactions c where c.user_id = u.id), 0) as expected_balance,
  p.business_balance -
    (coalesce((select sum(s.business_balance_credit) from settlements s where s.user_id = u.id), 0)
     + coalesce((select sum(c.business_balance_applied) from capital_transactions c where c.user_id = u.id), 0)) as drift
from auth.users u
join profiles p on p.user_id = u.id
where p.plan is distinct from 'owner' -- remove this line to include your own testing
having abs(p.business_balance -
    (coalesce((select sum(s.business_balance_credit) from settlements s where s.user_id = u.id), 0)
     + coalesce((select sum(c.business_balance_applied) from capital_transactions c where c.user_id = u.id), 0))) > 0.01
group by u.email, p.business_balance, u.id
order by abs(drift) desc;
```

An empty result means every account's tracked balance exactly matches its
own ledger — a nonzero `drift` for a specific account is the real number to
chase (double-tapped Reconcile/contribution, a retried import that somehow
double-applied, etc.) — narrow to one account with `and u.email =
'someone@example.com'`.
