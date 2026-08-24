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
