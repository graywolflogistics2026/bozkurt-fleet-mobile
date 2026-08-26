-- supabase/migrations/0003_consolidated_pending_sql_37_62.sql
--
-- SCHEMA CONSOLIDATION, PART 2 (P1 fix, FULL SYSTEM AUDIT, owner decision
-- 2026-08-26/27): continues directly from
-- supabase/migrations/0002_consolidated_pending_sql.sql (docs/PENDING_SQL.md
-- §1-36) — that file's own header comment explicitly flagged that §37/§38
-- were applied AFTER it was assembled and never folded in ("Fold both into
-- this file, or as their own 0003 file, the next time this snapshot gets
-- revisited"). This file picks up exactly there and covers §37 through §62.
--
-- STATUS OF WHAT'S COVERED: §37 through §60 are marked "✅ APPLIED" in
-- docs/PENDING_SQL.md — confirmed live on the production Supabase project
-- (§37-58 were previously applied one at a time via individual pending_*.sql
-- files; §59-60 were applied together via pending_59_60.sql during the P0
-- audit-fix pass). §61 and §62 are marked "NOT YET RUN" as of this file's
-- writing — they are INCLUDED here anyway, because the whole point of this
-- snapshot is to let a FRESH Supabase project be provisioned with the
-- CURRENT schema the app code actually depends on, not just what happens to
-- be live today — but each of their own section header comments below says
-- so explicitly, so nobody mistakes this file's existence as proof they've
-- been run. Confirm their real status in docs/PENDING_SQL.md before relying
-- on them being live anywhere.
--
-- IDEMPOTENCY: every statement below follows the EXACT same conventions
-- 0002 established (read that file first for the full rationale) — `create
-- table if not exists`, `add column if not exists`, drop-then-recreate for
-- policies/triggers, named indexes with `if not exists`, constraint adds
-- wrapped in a `do $$ ... exception when duplicate_object then null; end
-- $$` block. This file is SAFE TO RUN AGAINST EITHER: (a) a fresh, empty
-- Supabase project (run 0001_init.sql, then 0002, then this file, in
-- order); or (b) the current live project, where §37-60 are already
-- applied — every already-applied statement becomes a no-op, and only §61/
-- §62 (plus any genuinely still-missing piece) actually changes anything.
--
-- REAL DISCREPANCIES FOUND WHILE TRANSCRIBING (fixed here, not present in
-- the raw docs/PENDING_SQL.md fenced blocks if copied naively):
--   1. §37's original `apply_business_balance_delta()` function body is
--      immediately superseded by §38's own replacement (adds an `if not
--      found then raise exception` guard) — both sections describe it as
--      two separate applied changes, but transcribing §37's intermediate
--      version would be pure churn since `create or replace function` is
--      idempotent regardless. §37's column addition IS included; its
--      function body is skipped in favor of going straight to §38's final
--      version, which is what a fresh run needs anyway.
--   2. §51/§52's raw INSERT statements for `ai_usage_config`/`service_status`
--      seed rows already had `on conflict ... do nothing` in the original
--      docs/PENDING_SQL.md text (kept as-is) — but §52's 205-row PRIME INC
--      seed INSERT and §53's 8-row bridge-code INSERT did NOT have any
--      `on conflict` clause at all in the original text, meaning a second
--      run would have thrown a duplicate-key error (the table's own
--      `unique (carrier, code, sub_code)` constraint) instead of safely
--      no-op'ing. Both gained `on conflict (carrier, code, sub_code) do
--      nothing` here.
--   3. §56's `alter table import_jobs drop constraint import_jobs_status_check;`
--      had no `if exists` guard in the original text — a second run against
--      an already-migrated project would fail with "constraint does not
--      exist." Fixed to `drop constraint if exists`.
--   4. §58's `alter table profiles drop constraint profiles_plan_check;`
--      had the same missing-`if exists` gap, plus its `add constraint` had
--      no duplicate-object guard — fixed with the same `drop constraint if
--      exists` + `do $$ ... exception when duplicate_object` pattern 0002
--      already established for §18/§31's own constraint changes.
--   5. §59's `alter table ai_credit_purchases add constraint
--      ai_credit_purchases_remaining_le_granted check (...)` had no
--      duplicate-object guard in the original text — wrapped in the same
--      `do $$ ... exception when duplicate_object` block.
--   6. §50's `alter table profiles add column referral_code text unique,
--      add column referred_by text;` and similar multi-column ADD COLUMN
--      statements throughout §37-62 are split/rewritten with `if not
--      exists` on every individual column, matching 0002's own convention
--      of never assuming a specific starting point.
--
-- NOT VERIFIED HERE BEYOND WHAT'S NOTED IN THIS FILE'S OWN ASSEMBLY REPORT:
-- table/column existence for §37-60 was spot-checked against the live
-- project via read-only `information_schema` queries at assembly time (see
-- the commit/PR this file shipped in for the exact tables/columns checked
-- and what matched) — this is NOT a guarantee of byte-for-byte correctness
-- for every single column across all 26 sections. Treat docs/PENDING_SQL.md
-- as the source of truth for the full narrative/rationale behind each
-- change, and review against the real Supabase dashboard schema before
-- trusting this file for anything destructive.

-- ============================================================
-- PENDING_SQL.md §37: settlements.business_balance_credit + apply_business_balance_delta() RPC (pre-launch hardening, owner decision 2026-08-02) — ✅ APPLIED
-- ============================================================
-- Tracks how much of THIS settlement's net pay has actually been applied
-- to profiles.business_balance so far (0 for a settlement that's never
-- contributed, e.g. its net was <= 0). The function body from this
-- section is deliberately SKIPPED here — §38 immediately below replaces
-- it with the final version (adds a zero-row-update guard); transcribing
-- the intermediate version would be pure churn.
alter table settlements
  add column if not exists business_balance_credit numeric(12,2) not null default 0;

-- ============================================================
-- PENDING_SQL.md §38: apply_business_balance_delta() raises on zero-row update (pre-launch hardening, owner decision 2026-08-02, "settlement imports failing frequently" audit) — ✅ APPLIED
-- ============================================================
-- FOUND is a PL/pgSQL built-in reflecting whether the most recent
-- statement affected any rows — a 0-row UPDATE now raises a real,
-- visible error instead of silently returning NULL with no indication
-- the balance update never happened.
create or replace function apply_business_balance_delta(p_user_id uuid, p_delta numeric)
returns numeric
language plpgsql
security invoker
as $$
declare
  new_balance numeric;
begin
  update profiles
  set business_balance = coalesce(business_balance, 0) + p_delta
  where user_id = p_user_id and user_id = auth.uid()
  returning business_balance into new_balance;
  if not found then
    raise exception 'apply_business_balance_delta: no profiles row updated for user %', p_user_id
      using errcode = 'P0002';
  end if;
  return new_balance;
end;
$$;

grant execute on function apply_business_balance_delta(uuid, numeric) to authenticated;

-- ============================================================
-- PENDING_SQL.md §39: profiles.cf_insurance_weekly (Cash Flow auto-fill fix, owner decision 2026-08-04, device report) — ✅ APPLIED
-- ============================================================
-- ADDS a new column rather than reinterpreting cf_insurance_monthly (§29)
-- in place — a user's already-saved MONTHLY figure must never be silently
-- reread as a WEEKLY one (a 4.33x error). cf_insurance_monthly is left in
-- place, unused, going forward.
alter table profiles
  add column if not exists cf_insurance_weekly numeric(12,2);

-- ============================================================
-- PENDING_SQL.md §40: Category taxonomy rename migration (FULL PARITY pass, owner decision 2026-08-05) — ✅ APPLIED
-- ============================================================
-- Naturally idempotent — each UPDATE only touches rows still carrying the
-- OLD string; re-running after the first successful pass is a no-op. The
-- canonical 'Other' catch-all is deliberately NOT touched — a distinct,
-- valid category from 'Misc' (CLAUDE.md invariant #14), not a legacy
-- string being retired.
update deductions set category = 'Legal & Professional Services'
  where category in ('Professional Services', 'Legal & Accounting Fees');
update deductions set category = 'Insurance—Truck' where category = 'Insurance';
update deductions set category = 'Permits, Licenses & Road Taxes' where category = 'Licensing & Permits';
update deductions set category = 'Truck Supplies & Equipment' where category = 'Truck Supplies';
update deductions set category = 'Safety Gear & Workwear' where category = 'Safety Equipment';
update deductions set category = 'Misc' where category in ('Fixed', 'Variable');

update user_categories set schedule_c_bucket = 'Legal & Professional Services'
  where schedule_c_bucket in ('Professional Services', 'Legal & Accounting Fees');
update user_categories set schedule_c_bucket = 'Insurance—Truck' where schedule_c_bucket = 'Insurance';
update user_categories set schedule_c_bucket = 'Permits, Licenses & Road Taxes' where schedule_c_bucket = 'Licensing & Permits';
update user_categories set schedule_c_bucket = 'Truck Supplies & Equipment' where schedule_c_bucket = 'Truck Supplies';
update user_categories set schedule_c_bucket = 'Safety Gear & Workwear' where schedule_c_bucket = 'Safety Equipment';
update user_categories set schedule_c_bucket = 'Misc' where schedule_c_bucket in ('Fixed', 'Variable');

-- ============================================================
-- PENDING_SQL.md §41: capital_transactions.business_balance_applied (FULL PARITY pass, owner decision 2026-08-05, spec item E.3 "equity moves cash, not tax") — ✅ APPLIED
-- ============================================================
-- Tracks exactly how much of THIS transaction has been applied so far
-- (signed: positive for a contribution, negative for a draw) so an edit
-- or delete can reverse the EXACT applied amount with no drift.
alter table capital_transactions
  add column if not exists business_balance_applied numeric(12,2) not null default 0;

-- ============================================================
-- PENDING_SQL.md §42: One-time date repair migration (FULL PARITY pass, owner decision 2026-08-05, spec item D.1) — ✅ APPLIED
-- ============================================================
-- repair_implausible_date() mirrors app/src/import/dateGuard.ts's
-- trySwapYearAndDay() exactly — swaps year/day digits within the same
-- century, only applying the swap if the result is BOTH a real calendar
-- date AND itself falls inside the plausible window. The DO block below
-- is naturally idempotent — every UPDATE's own WHERE clause only matches
-- rows still outside [year_floor, year_ceiling], so a row already
-- repaired (or never implausible) is never touched again.
create or replace function repair_implausible_date(d date, year_floor int, year_ceiling int)
returns date
language plpgsql
as $$
declare
  yr int := extract(year from d)::int;
  mo int := extract(month from d)::int;
  dy int := extract(day from d)::int;
  century int := (yr / 100) * 100;
  swapped_year int := century + dy;
  swapped_day int := yr % 100;
  candidate date;
begin
  if yr >= year_floor and yr <= year_ceiling then
    return d; -- already plausible, no repair needed
  end if;
  if swapped_day < 1 or swapped_day > 31 then
    return d; -- can't form a valid day-of-month from the swap — leave as-is
  end if;
  begin
    candidate := make_date(swapped_year, mo, swapped_day);
  exception when others then
    return d; -- not a real calendar date (e.g. day 31 in April) — leave as-is
  end;
  if swapped_year < year_floor or swapped_year > year_ceiling then
    return d; -- the swapped reading is ALSO implausible — leave as-is
  end if;
  return candidate;
end;
$$;

do $$
declare
  y_floor int := 2020;
  y_ceiling int := extract(year from current_date)::int + 1;
begin
  update settlements set week_ending = repair_implausible_date(week_ending, y_floor, y_ceiling)
    where week_ending is not null and (extract(year from week_ending) < y_floor or extract(year from week_ending) > y_ceiling);

  update loads set pickup_date = repair_implausible_date(pickup_date, y_floor, y_ceiling)
    where pickup_date is not null and (extract(year from pickup_date) < y_floor or extract(year from pickup_date) > y_ceiling);
  update loads set delivery_date = repair_implausible_date(delivery_date, y_floor, y_ceiling)
    where delivery_date is not null and (extract(year from delivery_date) < y_floor or extract(year from delivery_date) > y_ceiling);
  update loads set load_date = repair_implausible_date(load_date, y_floor, y_ceiling)
    where load_date is not null and (extract(year from load_date) < y_floor or extract(year from load_date) > y_ceiling);

  update deductions set ded_date = repair_implausible_date(ded_date, y_floor, y_ceiling)
    where ded_date is not null and (extract(year from ded_date) < y_floor or extract(year from ded_date) > y_ceiling);

  update reimbursements set reimb_date = repair_implausible_date(reimb_date, y_floor, y_ceiling)
    where reimb_date is not null and (extract(year from reimb_date) < y_floor or extract(year from reimb_date) > y_ceiling);

  update fuel_purchases set purchase_date = repair_implausible_date(purchase_date, y_floor, y_ceiling)
    where purchase_date is not null and (extract(year from purchase_date) < y_floor or extract(year from purchase_date) > y_ceiling);

  update maintenance_records set service_date = repair_implausible_date(service_date, y_floor, y_ceiling)
    where service_date is not null and (extract(year from service_date) < y_floor or extract(year from service_date) > y_ceiling);

  update tolls set toll_date = repair_implausible_date(toll_date, y_floor, y_ceiling)
    where toll_date is not null and (extract(year from toll_date) < y_floor or extract(year from toll_date) > y_ceiling);
end $$;

-- ============================================================
-- PENDING_SQL.md §43: maintenance_records.source / tolls.source (Accountant Package ORIGIN RULE, owner decision 2026-08-05, FULL PARITY pass item B.1) — ✅ APPLIED
-- ============================================================
-- Backfill UPDATEs below have no WHERE clause on purpose — they
-- deterministically recompute `source` for every row every time, which is
-- safe to re-run (same inputs always produce the same output).
alter table maintenance_records
  add column if not exists source text not null default 'import'
    check (source in ('settlement', 'import', 'manual'));

alter table tolls
  add column if not exists source text not null default 'import'
    check (source in ('settlement', 'import', 'manual'));

update maintenance_records m
  set source = case
    when exists (
      select 1 from documents d
      where d.id = m.document_id and d.parsed_json ->> 'docType' = 'maintenance'
    ) then 'import'
    else 'settlement'
  end;

update tolls
  set source = case when network in ('ezpass', 'drivewyze') then 'settlement' else 'import' end;

-- ============================================================
-- PENDING_SQL.md §44: trucks.manual_total_miles_override (FULL PARITY follow-up, owner decision 2026-08-05, spec item B.3) — ✅ APPLIED (2026-08-23)
-- ============================================================
alter table trucks
  add column if not exists manual_total_miles_override numeric(12,2);

-- ============================================================
-- PENDING_SQL.md §45: trucks cost basis (FULL PARITY follow-up, owner decision 2026-08-05, spec item C.1) — ✅ APPLIED (2026-08-23)
-- ============================================================
-- purchase_price (§36) is reused as-is for the 'paid' mode's spread
-- calculation. All nullable — an unconfigured truck computes a $0
-- contribution, never a guess.
alter table trucks
  add column if not exists cost_basis_ownership_mode text check (cost_basis_ownership_mode in ('paid','loan','lease')),
  add column if not exists cost_basis_loan_monthly_payment numeric(12,2),
  add column if not exists cost_basis_paid_spread_months integer,
  add column if not exists cost_basis_warranty_cost numeric(12,2),
  add column if not exists cost_basis_warranty_term_months integer;

-- ============================================================
-- PENDING_SQL.md §46: trucks depreciation election (FULL PARITY follow-up, owner decision 2026-08-05, spec item E) — ✅ APPLIED (2026-08-23)
-- ============================================================
-- Tractor and trailer depreciation elections are independent of each
-- other, same "trailer's financing is independent of its tractor's"
-- pattern as CLAUDE.md invariant #25. A separate TAX concept from §45's
-- cost-basis fields (economic CPM spread, not tax-deductible depreciation).
alter table trucks
  add column if not exists depreciation_method text check (depreciation_method in ('full','macrs','spread','ask')),
  add column if not exists depreciation_year_placed_in_service integer,
  add column if not exists depreciation_spread_years integer,
  add column if not exists trailer_depreciation_method text check (trailer_depreciation_method in ('full','macrs','spread','ask')),
  add column if not exists trailer_depreciation_year_placed_in_service integer,
  add column if not exists trailer_depreciation_spread_years integer;

-- ============================================================
-- PENDING_SQL.md §47: category_learning_rules (FULL PARITY follow-up, owner decision 2026-08-05, spec item G) — ✅ APPLIED (2026-08-23)
-- ============================================================
-- Every manual re-categorization of a deduction stores a normalized
-- keyword->category rule (per user), applied before the built-in category
-- guesser with fuzzy matching, and sent to ai-import as plain-text "USER
-- CORRECTIONS" prompt hints (app/src/import/categoryLearning.ts).
-- PROMPT-CONTEXT ONLY — no model is ever fine-tuned or retrained on this
-- data.
create table if not exists category_learning_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  keyword      text not null,
  category     text not null,
  hit_count    int not null default 1,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, keyword)
);

alter table category_learning_rules enable row level security;
drop policy if exists "category_learning_rules_owner_all" on category_learning_rules;
create policy "category_learning_rules_owner_all" on category_learning_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- PENDING_SQL.md §48: profiles.tutorial_seen_at (FULL PARITY follow-up, owner decision 2026-08-05, spec item I) — ✅ APPLIED (2026-08-23)
-- ============================================================
-- The 6-slide illustrated walkthrough shown after ToS acceptance and
-- before the onboarding wizard. Null means never seen/skipped, same "null
-- = never done, set once" pattern as onboarding_completed_at (§28).
alter table profiles
  add column if not exists tutorial_seen_at timestamptz;

-- ============================================================
-- PENDING_SQL.md §49: Smart alerts + proactive AI Coach state (NEXT PASS, owner decision 2026-08-24, items D + E) — ✅ APPLIED (confirmed live 2026-08-26 during the P0 audit-fix pass via a live information_schema.columns query)
-- ============================================================
alter table profiles
  add column if not exists nudge_state jsonb not null default '{}'::jsonb,
  add column if not exists role_prompt_dismissed_at timestamptz,
  add column if not exists ai_weekly_review text,
  add column if not exists ai_weekly_review_generated_at timestamptz,
  add column if not exists ai_weekly_review_week_ending text;

-- ============================================================
-- PENDING_SQL.md §50: Referral program + lifetime/complimentary accounts (owner decision 2026-08-24) — ✅ APPLIED
-- ============================================================
-- PART 1 — referral program
alter table profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by text;

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the REFERRER cascades their own referral history away.
  -- Deleting the REFERRED person's account must NEVER retroactively wipe
  -- a reward the referrer already earned — "on delete set null" keeps
  -- this row (and the referrer's already-granted credit / qualified
  -- count) intact, just with referred_user_id nulled out.
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid references auth.users(id) on delete set null,
  referred_label text, -- masked identity, see app/src/referral/maskLabel.ts — set by referral-sync, never a raw name/email
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded')),
  flagged_for_review boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  unique (referred_user_id) -- a person can only ever be credited to ONE referrer; NULLs (post-deletion) never conflict with each other
);

create index if not exists referrals_referrer_id_idx on referrals(referrer_id);

alter table referrals enable row level security;
-- SELECT only — no insert/update/delete policy for regular users AT ALL.
-- Every write comes from handle_new_user() (security definer, bypasses
-- RLS) or the referral-sync Edge Function (service_role, always bypasses
-- RLS).
drop policy if exists "referrals_select_own" on referrals;
create policy "referrals_select_own" on referrals
  for select using (referrer_id = auth.uid() or referred_user_id = auth.uid());

create table if not exists account_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  days integer not null check (days > 0),
  reason text not null,
  source_referral_id uuid references referrals(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists account_credits_user_id_idx on account_credits(user_id);

alter table account_credits enable row level security;
-- Same "SELECT only, service_role writes" pattern as referrals above.
drop policy if exists "account_credits_select_own" on account_credits;
create policy "account_credits_select_own" on account_credits
  for select using (user_id = auth.uid());

-- Mirrors app/src/referral/selfReferral.ts's normalizeEmail() EXACTLY
-- (same "every trigger/Edge Function is self-contained" convention as
-- delete-account/reset-data's own deleteStorageFolder() precedent) —
-- gmail/googlemail dot+tag stripping, +tag stripping elsewhere.
create or replace function normalize_email_for_referral(p_email text)
returns text language plpgsql immutable as $$
declare
  v_local text;
  v_domain text;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if position('@' in v_email) = 0 then
    return v_email;
  end if;
  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  return v_local || '@' || v_domain;
end;
$$;

-- Mirrors app/src/referral/referralCode.ts's format exactly (BOZKA-XXXX,
-- no 0/O/1/I). Bounded retry loop against the real unique constraint.
create or replace function generate_unique_referral_code()
returns text language plpgsql as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
  i int;
begin
  loop
    v_code := 'BOZKA-';
    for i in 1..4 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from profiles where referral_code = v_code);
    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'could not generate a unique referral code after 20 attempts';
    end if;
  end loop;
  return v_code;
end;
$$;

-- Extends the EXISTING handle_new_user() trigger (0001_init.sql) rather
-- than adding a second trigger. Self-referral is checked here, at
-- creation time, so a blocked self-referral simply never creates a
-- referrals row at all.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_referrer_id uuid;
  v_referrer_email text;
  v_referred_by_code text := new.raw_user_meta_data ->> 'referred_by_code';
  v_is_self boolean := false;
begin
  v_code := generate_unique_referral_code();

  if v_referred_by_code is not null and length(trim(v_referred_by_code)) > 0 then
    select user_id into v_referrer_id
      from profiles
      where referral_code = upper(trim(v_referred_by_code));

    if v_referrer_id is not null then
      select email into v_referrer_email from auth.users where id = v_referrer_id;
      if v_referrer_email is not null
         and normalize_email_for_referral(v_referrer_email) = normalize_email_for_referral(new.email) then
        v_is_self := true;
      end if;
    end if;
  end if;

  insert into public.profiles (user_id, referral_code, referred_by)
    values (new.id, v_code, v_referred_by_code)
    on conflict (user_id) do nothing;

  if v_referrer_id is not null and not v_is_self then
    insert into public.referrals (referrer_id, referred_user_id, status)
      values (v_referrer_id, new.id, 'pending')
      on conflict (referred_user_id) do nothing;
  end if;

  return new;
end;
$$;

-- PART 2 — lifetime / complimentary accounts
alter table profiles
  add column if not exists plan text not null default 'free_trial' check (plan in ('free_trial', 'paid', 'lifetime', 'complimentary')),
  add column if not exists plan_note text,
  add column if not exists plan_granted_at timestamptz;

-- profiles ALREADY has a broad "owner can update their own row" policy —
-- RLS itself can't scope write access down to just THESE three columns on
-- the same row, so a BEFORE UPDATE trigger is what actually enforces "the
-- user can read their own plan but never write it."
--
-- ALLOWED WRITERS, both checked (a client request never satisfies
-- either): (1) auth.role() = 'service_role'; (2) current_user = 'postgres'
-- — a human admin running SQL directly in the Supabase Dashboard's SQL
-- Editor connects as the `postgres` role with NO request.jwt.claims set
-- at all, so auth.role() alone would NOT reliably read back
-- 'service_role' in that context.
create or replace function protect_profile_plan_fields()
returns trigger language plpgsql as $$
begin
  if auth.role() is distinct from 'service_role' and current_user <> 'postgres' then
    if new.plan is distinct from old.plan
       or new.plan_note is distinct from old.plan_note
       or new.plan_granted_at is distinct from old.plan_granted_at then
      raise exception 'plan fields can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_plan_fields on profiles;
create trigger trg_protect_profile_plan_fields
  before update on profiles
  for each row execute function protect_profile_plan_fields();

-- ============================================================
-- PENDING_SQL.md §51: AI cost control + usage limits + credit packs (owner decision 2026-08-24, FIVE ADDITIONS pass, PARTS 4 + 5) — ✅ APPLIED
-- ============================================================
-- Four new tables, none touched by Reset All Data or Delete Account's own
-- explicit deletion loops (account-level, not business data) —
-- ai_usage_log/ai_credit_purchases still disappear automatically on a
-- real account deletion via their user_id ... on delete cascade FK.
create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('ai_import', 'ai_advisor')),
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_user_month_idx on ai_usage_log(user_id, call_type, created_at);

alter table ai_usage_log enable row level security;
drop policy if exists "ai_usage_log_select_own" on ai_usage_log;
create policy "ai_usage_log_select_own" on ai_usage_log
  for select using (user_id = auth.uid());
drop policy if exists "ai_usage_log_insert_own" on ai_usage_log;
create policy "ai_usage_log_insert_own" on ai_usage_log
  for insert with check (user_id = auth.uid());
-- No update/delete policy — append-only audit log, by design.

create table if not exists ai_usage_config (
  id boolean primary key default true check (id),
  imports_per_truck_per_month integer not null default 60,
  account_ceiling integer,
  updated_at timestamptz not null default now()
);

alter table ai_usage_config enable row level security;
drop policy if exists "ai_usage_config_select_all" on ai_usage_config;
create policy "ai_usage_config_select_all" on ai_usage_config
  for select using (true);
-- No write policy for authenticated users — service_role/admin only.

insert into ai_usage_config (id) values (true) on conflict (id) do nothing;

create table if not exists service_status (
  service text primary key check (service in ('ai_import', 'ai_advisor')),
  status text not null default 'ok' check (status in ('ok', 'degraded', 'down')),
  message text,
  updated_at timestamptz not null default now()
);

alter table service_status enable row level security;
drop policy if exists "service_status_select_all" on service_status;
create policy "service_status_select_all" on service_status
  for select using (true);
-- No write policy for authenticated users — service_role/admin only.

insert into service_status (service, status) values
  ('ai_import', 'ok'),
  ('ai_advisor', 'ok')
on conflict (service) do nothing;

create table if not exists ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_type text not null check (pack_type in ('pack_25', 'pack_100', 'pack_300', 'catchup_year')),
  credits_granted integer not null check (credits_granted > 0),
  credits_remaining integer not null check (credits_remaining >= 0),
  granted_at timestamptz not null default now(),
  expires_at timestamptz -- null for the 3 fixed packs; set (granted_at + 90 days) for catchup_year
);

create index if not exists ai_credit_purchases_user_idx on ai_credit_purchases(user_id);

alter table ai_credit_purchases enable row level security;
drop policy if exists "ai_credit_purchases_select_own" on ai_credit_purchases;
create policy "ai_credit_purchases_select_own" on ai_credit_purchases
  for select using (user_id = auth.uid());
-- The self-service UPDATE policy this table originally shipped with here
-- (`ai_credit_purchases_update_own`) is DELIBERATELY NOT recreated — §59
-- below drops it as a P0 security fix (it let any authenticated user grant
-- themselves unlimited credits directly via the REST API). Running this
-- file top-to-bottom on a fresh project never creates the vulnerable
-- policy in the first place; running it against the live project (where
-- it may already exist from before §59) removes it via §59's own DROP.
-- No insert/delete policy for authenticated users — a purchase (or grant)
-- is always recorded by an admin via SQL (docs/ADMIN_RUNBOOK.md).

-- ============================================================
-- PENDING_SQL.md §52: Carrier-scoped payroll/settlement codes (owner decision, CARRIER-SCOPED PAYROLL CODES pass) — ✅ APPLIED
-- ============================================================
-- Global reference data, one row per carrier+code, admin-maintained like
-- tax_year_data (CLAUDE.md invariant #6's "never hardcode, always
-- server-sourced" pattern). Seeded with PRIME INC's full 205-row code
-- list, reconciled by hand from an owner-provided reference sheet — see
-- docs/CARRIER_CODES.md for the human-readable mirror. Every OTHER
-- carrier starts with ZERO seeded rows.
create table if not exists carrier_code_maps (
  id uuid primary key default gen_random_uuid(),
  carrier text not null,
  code text not null,
  sub_code text,
  label text not null,
  description text,
  -- Canonical category (docs/INDUSTRY_TAXONOMY.md §B) or null — null means
  -- "leave this code to the generic description-based classifier."
  category text,
  -- null = not an expense line at all (income/administrative); true/false
  -- only meaningful when category is set.
  is_deductible boolean,
  income_or_chargeback text check (income_or_chargeback in ('income', 'chargeback')),
  notes text,
  created_at timestamptz not null default now(),
  unique (carrier, code, sub_code)
);

create index if not exists carrier_code_maps_carrier_idx on carrier_code_maps(carrier);

alter table carrier_code_maps enable row level security;
drop policy if exists "carrier_code_maps_select_all" on carrier_code_maps;
create policy "carrier_code_maps_select_all" on carrier_code_maps
  for select using (true);
-- No write policy for authenticated users — service_role/admin only, same
-- pattern as tax_year_data/ai_usage_config/service_status.

alter table settlements
  add column if not exists carrier text;

alter table category_learning_rules
  add column if not exists carrier text;

-- IDEMPOTENCY FIX (this file, not present in the original docs/PENDING_SQL.md
-- text): the raw §52 INSERT below had NO on conflict clause — a second run
-- would fail against the table's own unique (carrier, code, sub_code)
-- constraint instead of safely no-op'ing. Added here.
insert into carrier_code_maps (carrier, code, sub_code, label, description, category, is_deductible, income_or_chargeback, notes) values
  ('PRIME INC', 'AL', 'MISC 50', '401K LOAN PAYMT', 'Repay a loan against a 401k', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'AD', 'OIL 03', 'ADDITIVES', 'Engine additives and other fluids', 'Fuel Additives', true, 'chargeback', null),
  ('PRIME INC', 'AF', null, 'AGENT FEE', 'A broker fee used to procure freight outside of Prime''s sales department', 'Dispatch & Factoring Fees', true, 'chargeback', null),
  ('PRIME INC', 'AG', null, 'AGT FEE GUR RFD', 'An adjustment made to add agent fee back to an operator on flat method to keep him at 80 cent guarantee', null, null, 'income', null),
  ('PRIME INC', 'AP', null, 'APU RENTAL PYMT', 'Rental of A/C unit', 'Lease & Rent', true, 'chargeback', null),
  ('PRIME INC', 'AS', 'MISC 16', 'ACCOUNTING SERVICE', 'Cost of using Perryman & Associates & includes the cost of the operating statement', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'BC', 'BASC 01', 'BASS COUNTRY CAFE', 'Purchase of food or other items at the cafe located at the Bass Country Inn', 'Meals (per diem covered)', false, 'chargeback', null),
  ('PRIME INC', 'BF', 'MISC 07', 'BALFWD TRANSFER', 'Move a negative balance from a lease operator or owner that has become a company driver to his company side of payroll', null, null, null, 'Administrative balance transfer, not a real expense.'),
  ('PRIME INC', 'BF', 'ADJ 98', 'BALANCE PASSMORE', null, null, null, null, 'Source scan unclear on full description — verify against Prime documentation.'),
  ('PRIME INC', 'BL', null, 'BONUS LAYOVER', 'Layover after the initial 1 for the wk', null, null, 'income', null),
  ('PRIME INC', 'BS', null, 'BONUS TX REIMB', 'Reimbursement of the additional cost of taxes paid by an operator if he has a company driver that gets a sign on bonus or longevity pay', 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'BT', null, 'BTDH INSURANCE', 'Bobtail / deadhead insurance as listed in your contract', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'BW', null, 'BONUS WC REIMB', 'Reimburses the additional cost of work comp paid by an operator if he has a company driver that gets a sign on bonus or longevity pay', 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'CB', 'ADV 05', 'CABCARD', 'Charge to load money to cabcard for e-mail & phone usage', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'CC', 'CRGO 01', 'CARGO CLAIMS', 'Any cost associated with a claim for cargo loss or damage', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'CD', null, 'CLAIMS DOWNTIME', 'Accident downtime caused by another party', null, null, 'income', null),
  ('PRIME INC', 'CH', 'LCTR 01', 'CHILD CARE', 'Costs associated with Prime Learning Center', 'Misc', false, 'chargeback', 'Personal expense, not a business deduction.'),
  ('PRIME INC', 'CM', 'MOTL 03', 'CAMPUS MOTEL', 'Charge for staying at Bass Country Motel', 'Parking & Lodging', true, 'chargeback', null),
  ('PRIME INC', 'CO', 'MISC 02', 'COMDATA', 'Cover the $2 charge to cash a Comcheck', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'CP', null, 'CLAIMS PAYMENTS', 'Set cargo or liability claim into payments', null, null, null, 'Administrative — sets a claim into a payment plan, not itself a new cost.'),
  ('PRIME INC', 'CS', 'STOR 01', 'COMPANY STORE', 'Purchases made in the company store', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'CT', null, 'CARTAGE', 'Costs paid to an outside contractor for services such as storage or moving of freight or preloading trailers', 'Dispatch & Factoring Fees', true, 'chargeback', null),
  ('PRIME INC', 'CW', null, 'CARRYOV''R WARNTY', 'Warranty for driveline repairs on previously leased trucks', null, null, null, 'Warranty credit/administrative — verify treatment against actual statement.'),
  ('PRIME INC', 'CY', null, 'LCI PAYOUT', 'Lease completion payout', null, null, 'income', null),
  ('PRIME INC', 'D1', null, 'DRVLINE <= $500', 'Driveline repairs <= $500 deducted from lease completion incentive at 100%', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'D2', null, 'DRVLINE > $500', 'Driveline repairs > $500 deducted from lease completion incentive at 50%, charged at 100%', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'D3', null, 'DRVLINE > $500', '50% of driveline repairs over $500 covered by Prime', null, null, 'income', 'A credit from Prime, not a driver cost.'),
  ('PRIME INC', 'DA', 'AWRD 01', 'DRIVER AWARD', 'Atta boy for a good job', null, null, 'income', null),
  ('PRIME INC', 'DB', 'MISC 04', 'DRV FINAL B/FWD', 'Wage dump charge for driver''s negative balance; credited next week', null, null, null, null),
  ('PRIME INC', 'DC', 'LAYOV', 'DRIVER CAB/TAXI', 'Reimburse the cost of taxi use', null, null, 'income', null),
  ('PRIME INC', 'DD', null, 'DEALER DOWNTIME', 'Downtime because of disrepair of the tractor and is not the fault of the operator', null, null, 'income', null),
  ('PRIME INC', 'DE', null, 'DRIVER EXPENSE', 'Only used for Wiltrans driver advances & net pay charges to truck', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'DF', null, 'WG/DF FICA DRV', null, 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'DG', null, 'DRUMMING', 'Empty last gallons of load into barrels', null, null, 'income', null),
  ('PRIME INC', 'DH', 'SEE DETAIL', 'DEADHEAD', 'Extra ordinary miles to pickup load or other long distance work not related to a load', null, null, 'income', null),
  ('PRIME INC', 'DI', null, 'DENTAL INSURANCE', 'Dental Insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'DJ', 'STOP', 'JOB SITE DELVRY', 'Job site delivery similar to stop pay', null, null, 'income', null),
  ('PRIME INC', 'DL', null, 'TRANSIT DELAY', 'Additional time spent on trip when delayed at stops and additional time is expended on load', null, null, 'income', null),
  ('PRIME INC', 'DM', 'MOTL 02', 'DRIVER MOTEL', 'Springfield motel stays', 'Parking & Lodging', true, 'chargeback', null),
  ('PRIME INC', 'DP', null, 'DRV PRE B/FWD', 'Wage dump credit for driver''s previous week''s negative balance charge', null, null, null, null),
  ('PRIME INC', 'DR', 'ADV 04', 'DRV ADJUSTMENTS', 'Charge for negative driver balance to lease truck or other items', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'DS', 'WASH 01', 'DETAIL SHOP', 'Cost of cleaning the truck after turn-in or any time the truck gets detailed', 'Truck Wash & Detailing', true, 'chargeback', null),
  ('PRIME INC', 'DT', null, 'DETENTION', 'Detained at shipper or receiver longer than necessary for loading and unloading purposes', null, null, 'income', null),
  ('PRIME INC', 'DU', null, 'DRV UNEMP TAX', 'Charge for federal unemployment taxes & state unemployment taxes on company driver', 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'DX', 'DRYC 02', 'MAIL ROOM POSTAGE', 'Cost of postage or items mailed from Prime', 'Office & Admin', true, 'chargeback', null),
  ('PRIME INC', 'DY', 'DRYC 01', 'DRY CLEANING', 'Dry cleaning at Prime', 'Misc', false, 'chargeback', 'Personal expense.'),
  ('PRIME INC', 'EA', null, 'BAD APPT', 'Truck detained by an appt error', null, null, 'income', null),
  ('PRIME INC', 'EB', null, 'OTHER LAYOVER', 'Truck detained due to mechanical issues/weather', null, null, 'income', null),
  ('PRIME INC', 'EF', null, 'EMERGENCY FUND', 'Used to contribute or deduct from emergency fund', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'EM', null, 'EMPTY MILES', 'For company drivers in the Walmart Ded division', null, null, 'income', null),
  ('PRIME INC', 'EP', 'XPAY', 'EXTRA PAY', 'Work not related to load hauled by the mile or percentage of revenue billed', null, null, 'income', null),
  ('PRIME INC', 'EQ', null, 'EQUILIZATION PAY', 'Short hauls for company drivers, adj done by fleet manager', null, null, 'income', null),
  ('PRIME INC', 'ER', 'MISC 01', 'EQUIP RENTAL', 'Rental of certain equipment such as forklifts etc.', 'Lease & Rent', true, 'chargeback', null),
  ('PRIME INC', 'ET', null, 'EZ PASS TOLL', '28% derived from EZPass toll charges (see two-digit code "TO" for out-of-pocket based tolls)', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'EZ', null, 'EZ FAST LN TOLL', 'Charge for EZ Pass tolls, created using transponder in truck to get thru toll booth without stopping', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'FA', null, 'FLATBED ACCESSRYS', 'Charge for flatbed accessories', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'FB', 'FUELB', 'FUEL BONUS CODR', 'Bonus''s paid to company drivers for good fuel usage', null, null, 'income', null),
  ('PRIME INC', 'FC', 'MISC 15', 'FUEL CARD CHG', '$1.00 weekly Comdata charge for use of fuel card', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'FE', null, 'FLATBED EQUIMT', 'Flatbed equipment, tarps, chains, binders, etc', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'FG', null, 'FUEL SURCG GUAR', 'Prime guarantee to cover increased cost of fuel if not billed to customer', null, null, 'income', null),
  ('PRIME INC', 'FL', 'FINE 01', 'FINES', 'Citations and other fines incurred on the road', 'Misc', false, 'chargeback', 'Fines are generally non-deductible.'),
  ('PRIME INC', 'FJ', null, 'FUEL ADJUSTMENT', 'Additional fuel cost separated from linehaul, billed as a separate item on the invoice', null, null, 'income', null),
  ('PRIME INC', 'FN', null, 'FORGIVEN PAYMNT', 'Forgiven truck payment earned for years of service', null, null, 'income', null),
  ('PRIME INC', 'FR', null, 'REEFER FUEL SURCG', 'Additional reefer fuel cost charged to customer', null, null, 'income', null),
  ('PRIME INC', 'FS', null, 'FUEL REVENUE', 'Added revenue billed to cover cost of fuel', null, null, 'income', null),
  ('PRIME INC', 'FX', 'PHON 03', 'TANKER FAX REIMB', 'Reimburse faxes for tankers', null, null, 'income', null),
  ('PRIME INC', 'G1', 'AHC 91', 'GAP INSURANCE', 'Single interim insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'G2', 'AHC 92', 'GAP INSURANCE', 'Associate and spouse interim insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'G3', 'AHC 93', 'GAP INSURANCE', 'Associate and child interim insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'G4', 'AHC 94', 'GAP INSURANCE', 'Associate and family interim insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'GA', 'GARN 31', 'GARNISHMENT', 'Child support and other garnishments', 'Misc', false, 'chargeback', 'Personal legal obligation, not a business expense.'),
  ('PRIME INC', 'GF', 'GARN 99', 'CH SUPP/GAR FEE', 'Administrative fee for child supports and other garnishments', 'Misc', false, 'chargeback', null),
  ('PRIME INC', 'GO', 'GUARO', 'WKLY GUAR OP SH', 'Used to pay co-driver weekly guarantee, cost charged to the operator (at operator fault)', null, null, 'chargeback', null),
  ('PRIME INC', 'GP', 'GUARO', 'WKLY GUAR PR SH', 'Used to pay co-driver weekly guarantee, cost stays as Prime expense', null, null, 'income', null),
  ('PRIME INC', 'GR', 'REPR 04', 'GLASS RACK REPAIR', 'Used to cover the cost to fix glass racks used by flatbed trucks', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'GU', null, 'GUARANTY ADVANCE', 'Weekly settlement adjustment for guarantee', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'H1', 'SEE DETAIL', 'HLTH INS SINGLE', 'Single insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H2', 'SEE DETAIL', 'HLTH INS AS/SPO', 'Associate & spouse insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H3', 'SEE DETAIL', 'HLTH INS AS + CHILD', 'Associate & child insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H4', 'SEE DETAIL', 'HLTH INS FAMILY', 'Family insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H5', 'SEE DETAIL', 'LC HL INS AS/SP', 'Low cost associate & spouse insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H6', 'SEE DETAIL', 'LC HL INS AS/CH', 'Low cost associate & child insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H7', 'SEE DETAIL', 'LC HL INS FAMILY', 'Low cost family insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'H8', 'SEE DETAIL', 'LC HL INS SINGLE', 'Low cost single insurance premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'HC', 'WASH 03', 'HEEL CHARGE', 'Clean out product left in tanker trailer', 'Truck Wash & Detailing', true, 'chargeback', null),
  ('PRIME INC', 'HH', null, 'HOSE HOOK/UNHK', 'Pay to hookup and unhook hoses on tanker loads if billed to customer', null, null, 'income', null),
  ('PRIME INC', 'HI', null, 'HEALTH INSURANCE', 'Health insurance, wage dump only', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'HL', null, 'HEALTH LIFE', 'Wage dump for life insurance on drivers, leasor''s portion', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'HT', null, 'HIGHWAY TOLLS', 'Tolls billed to customer, balance credited by either PO or electronic toll billing', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'IA', 'AWRD 02', 'INSPECTION AWRD', 'Award for 100% clean DOT inspection', null, null, 'income', null),
  ('PRIME INC', 'IB', 'AWRD 03', 'TUITION REIMB', 'Tuition reimbursement award', null, null, 'income', 'Source scan for this code letter was unclear — verify against Prime documentation.'),
  ('PRIME INC', 'ID', null, 'PASSMO DENTAL', 'Passmore Dental Premium', 'Insurance—Health', true, 'chargeback', 'Source scan for this row was unclear/merged with an adjacent cell — verify against Prime documentation.'),
  ('PRIME INC', 'IE', null, 'PASSMO HLTH INS', 'Passmore Health Ins Premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'IH', null, 'INTEREST EXPENSE', 'Interest on E-Fund, PB & tire fund less any previous week''s negative balance', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'II', null, 'INTEREST INCOME', null, null, null, 'income', null),
  ('PRIME INC', 'IM', 'FDEX 02', 'IMAGE TRIPS', 'Charge for truck stop scanning', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'IO', null, 'PASSMO AFTX INS', 'Passmore Hlth Ins Premium Aftertax', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'IP', null, 'INT/PRIN-NOTES', 'Charges for note-principle & interest payments', 'Truck/Trailer Payments', true, 'chargeback', null),
  ('PRIME INC', 'IS', null, 'PASSMO SUPL INS', 'Passmore Supplemental Ins. Premium', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'LA', null, 'LH-FUEL SRCHG ADJ', 'Est fuel srchg between dotted line not paid as fuel surcharge, paid at contract rate as linehaul', null, null, 'income', null),
  ('PRIME INC', 'LC', 'MISC 21', 'LIABILITY CLAIM', 'Liable damage done to personal property by leasor', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'LD', 'LOAD', 'DRIVER LOAD', null, null, null, 'income', null),
  ('PRIME INC', 'LF', null, 'FED HWY TAX', 'Federal Highway Use Tax, $550 annual fee', 'Permits, Licenses & Road Taxes', true, 'chargeback', null),
  ('PRIME INC', 'LI', 'SEE DETAIL', 'LIFE INSURANCE', null, 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'LL', 'PART 03', 'LOAD LOCKS', null, 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'LM', 'LMPR', 'OUTSIDE LUMPER', 'Payment to pay operator for cost of lumper used instead of loading or unloading himself', 'Lumper Fees', true, 'chargeback', null),
  ('PRIME INC', 'LO', 'LAYOV', 'LAYOVER PAY', 'Payment if no load for operators, paid after the first 24 hours', null, null, 'income', null),
  ('PRIME INC', 'LP', 'PRMT 01', 'LICENSE/PERMITS', 'License & permits', 'Permits, Licenses & Road Taxes', true, 'chargeback', null),
  ('PRIME INC', 'LR', 'bonus', 'LONGEVITY REV', 'Additional per-mile pay after 6/8 continuous years of association', null, null, 'income', null),
  ('PRIME INC', 'LS', 'LMPR', 'LUMPER UNLOAD', 'For company drivers, Ls'' pulls to the reimb section of their payroll', 'Lumper Fees', true, 'chargeback', null),
  ('PRIME INC', 'LT', 'TRANS', 'LOAD TRANSFER', 'Transfer cargo from one trailer to another', null, null, 'income', null),
  ('PRIME INC', 'LU', 'LOAD', 'LD/UNLD TRLR', 'Paid to operator for loading or unloading at the customer''s dock', null, null, 'income', null),
  ('PRIME INC', 'LW', null, 'LTD WORK COMP', 'Added coverage in addition to occupational accident insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'MB', 'MISC 17', 'MAIL BOX', 'Prime mail box charge (.75/wk small box, 1.25/wk large box)', 'Office & Admin', true, 'chargeback', null),
  ('PRIME INC', 'MC', 'MISC 06', 'MERRY CHRISTMAS', 'Merry Christmas bonus', null, null, 'income', null),
  ('PRIME INC', 'MD', 'MISC 04', 'MAIL BX DEPOSIT', '$10 key deposit for Prime mailbox', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'ME', 'MISC 04', 'MISC EXPENSES', 'Charges for misc. expenses such as business cards, truck recovery fees or other items not specifically covered under codes', 'Misc', true, 'chargeback', null),
  ('PRIME INC', 'MF', 'MISC 18', 'MARKET FEE', 'Fee paid by operator to enter produce markets', 'Permits, Licenses & Road Taxes', true, 'chargeback', null),
  ('PRIME INC', 'MG', null, 'MILEAGE CHARGE', 'Per mile charge in addition to truck payment, part of lease payment', 'Truck/Trailer Payments', true, 'chargeback', null),
  ('PRIME INC', 'MI', null, 'MILES INCENTIVE', 'Quarterly bonus paid to the operator for high team miles processed', null, null, 'income', null),
  ('PRIME INC', 'ML', 'PU/DRP', 'LODED TL', 'Generally 72% of $50 paid for local delivery less than 100 miles', null, null, 'income', null),
  ('PRIME INC', 'MO', 'MOTL 01', 'MOTEL', 'Over the road motel', 'Parking & Lodging', true, 'chargeback', null),
  ('PRIME INC', 'MP', 'XPAY', 'LOCAL PU/DROP', 'Extra pay for local pickup or drop', null, null, 'income', null),
  ('PRIME INC', 'MR', 'REPR 01', 'HUB RECALL', 'Credit for repair of tractor axle hubs', null, null, 'income', null),
  ('PRIME INC', 'NB', null, 'NEGATIVE BAL PY', 'Negative balance set up in payments', null, null, null, null),
  ('PRIME INC', 'NC', null, 'NPI CLEARING', 'Prime clearing account', null, null, null, null),
  ('PRIME INC', 'NP', null, 'TRUCK PAYMENT', 'Lease truck payment', 'Truck/Trailer Payments', true, 'chargeback', null),
  ('PRIME INC', 'NT', null, 'CUR TIRE FUND', 'Per mile charge for current tire fund', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'NU', null, 'PRI TIRE FUND', 'Value based on used tread of previously leased vehicles', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'NX', null, 'EXCESS MILES', 'Applies to miles over a weekly average as determined by contract, lease trucks only', 'Truck/Trailer Payments', true, 'chargeback', null),
  ('PRIME INC', 'OA', null, 'OPER WORK COMP', 'Operator workmen''s comp insurance', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'OC', null, 'O/O CLOSING B/FWD', 'Owner operator balance forward - closing', null, null, null, null),
  ('PRIME INC', 'OE', 'PART 03', 'OTHER EQUIPMENT', 'Added options allowed (e.g. refrigerators) but paid for by operator', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'OF', null, 'O/O FED HWY TAX', 'Hwy tax charges for owners', 'Permits, Licenses & Road Taxes', true, 'chargeback', null),
  ('PRIME INC', 'OS', null, 'OPER STMT COST', 'Charge to produce operating statement', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'OT', 'LMPR 01', 'OVERTIME LD/ULD', 'Money paid to a shipper or receiver to come in early or stay late to load or unload a trailer', null, null, 'income', null),
  ('PRIME INC', 'OW', null, 'OWNER OCCUP ACC', 'Occupational accident insurance - primary coverage', 'Insurance—Health', true, 'chargeback', null),
  ('PRIME INC', 'PA', 'PLTS 01', 'PALLETS', 'Pallet purchases or reimbursements', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'PB', null, 'P/B ADJUSTMENT', '$1000 (Leasors) or $1500 (Owner Operators) collected for performance guarantee', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'PC', 'MISC 01', 'PETTY CASH REIM', 'Fax, holiday meal, misc reimb', null, null, 'income', null),
  ('PRIME INC', 'PD', null, 'PHY DAM INS PYM', 'Payment for physical damage insurance premium', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'PF', null, 'PAYROLL FEE', 'Payroll processing fee for company driver when they receive income', 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'PG', null, 'PUMPING', 'Pay for using operator''s pumps to load or unload product, billed accessorially to customer', null, null, 'income', null),
  ('PRIME INC', 'PH', 'PHON 01', 'PHONE CALLS', 'Telephone calls', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'PI', null, 'PASSENGER INSURANCE', 'Optional insurance for purchase', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'PM', 'PRMT 01', 'PERMITS', 'Permits purchased to operate the truck', 'Permits, Licenses & Road Taxes', true, 'chargeback', null),
  ('PRIME INC', 'PN', null, 'TRK PYMNT REIMB', 'Reimbursement for truck payment', null, null, 'income', null),
  ('PRIME INC', 'PO', 'PPOS 01', 'POINT OF SALE', 'Driver charge at North Star Grill', 'Meals (per diem covered)', false, 'chargeback', null),
  ('PRIME INC', 'PS', 'STOP', 'PICKUP/STOP PAY', 'Pay for additional picks and stops other than initial pickup and stop', null, null, 'income', null),
  ('PRIME INC', 'PT', null, 'PHY DAM CHG TRL', 'Deductible charge for damage to trailer', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'PU', 'MISC 20', 'PHY DAM CL-UNIT', 'Deductible charge for damage to truck', 'Insurance—Truck', true, 'chargeback', null),
  ('PRIME INC', 'PW', null, 'PASS WEIGHT STN', 'Weigh station transponder green-light charge', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'PY', null, 'PREV/NTBL TRL DM', 'Charge for damage to a trailer', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'QM', 'PHON 02', 'QC EXCESS MSGS', 'Charge for excess Qualcomm messages beyond the covered allotment', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'QR', null, 'QUALCOMM RENTAL', 'Owner operator charge for Qualcomm rental', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'QU', null, 'QUALCOMM UNIT', 'Qualcomm unit charges', 'ELD & Communications', true, 'chargeback', null),
  ('PRIME INC', 'RB', 'REFRL', 'REFERRAL BONUS', 'Paid first week after driver is dispatched, ongoing per-mile referral pay', null, null, 'income', null),
  ('PRIME INC', 'RC', null, 'RECONCILE', 'Prime guarantees a minimum revenue per mile per 100,000 miles, rate depends on contract', null, null, 'income', null),
  ('PRIME INC', 'RD', null, 'REEF FUEL DSCNT', 'Discount on the purchase of reefer fuel', null, null, 'income', null),
  ('PRIME INC', 'RF', 'FUEL 02', 'REEFER FUEL', 'Fuel for reefer unit only', 'Fuel & DEF', true, 'chargeback', null),
  ('PRIME INC', 'RH', null, 'PRE H LINEHAUL', 'Adjustment of tarp and unloading pay for pre-"H"-version contracts', null, null, 'income', null),
  ('PRIME INC', 'RN', 'RETN', 'START RIGHT PAY', 'Beginning 3 weeks guarantee for new driver', null, null, 'income', null),
  ('PRIME INC', 'RO', 'OIL 02', 'REEFER OIL', 'Oil for reefer unit only', 'Fuel & DEF', true, 'chargeback', null),
  ('PRIME INC', 'TN', null, 'TRK PYM-CONTEST', 'Reimbursement of truck payment used by recruiting contest', null, null, 'income', null),
  ('PRIME INC', 'TO', 'TOLL 01', 'TOLLS', 'Applies to highway tolls', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'TO', null, 'TOLLS', 'Payment for Prime''s portion of the toll expense, out-of-pocket costs paid by operator (see code "ET" for electronic tolls)', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'TP', null, 'TARP', 'Tarp and untarp loads', 'Truck Supplies & Equipment', true, 'chargeback', null),
  ('PRIME INC', 'TR', 'REPR 02', 'TRAILER REPAIR', 'Repairs done to the trailer only, not the reefer unit', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'TS', 'MISC 48', 'TRAINING SCHOOL', 'Balance due of meals & lodging or any school expense when a company driver leases a truck', 'Training & Education', true, 'chargeback', null),
  ('PRIME INC', 'TT', 'TIRE 02', 'TRAILER TIRE', 'Purchase or repair of trailer tires on the road', 'Tires', true, 'chargeback', null),
  ('PRIME INC', 'TW', 'WASH 05', 'TRAILER WASH', 'Wash the outside of trailer', 'Truck Wash & Detailing', true, 'chargeback', null),
  ('PRIME INC', 'TX', 'FDEX 01', 'TRIP XPRESS CHG', 'UPS, FedEx or TripPak charge', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'UD', null, 'TRAC FUEL DSCNT', 'Tractor fuel discount at pump', null, null, 'income', null),
  ('PRIME INC', 'UE', 'FUEL 03', 'TRACTOR DEF', 'Tractor DEF', 'Fuel & DEF', true, 'chargeback', null),
  ('PRIME INC', 'UF', 'FUEL 01', 'TRACTOR FUEL', 'Tractor fuel only', 'Fuel & DEF', true, 'chargeback', null),
  ('PRIME INC', 'UL', null, 'UNIT TIRE LABOR', 'Cost of labor to repair or replace tractor tires', 'Tires', true, 'chargeback', null),
  ('PRIME INC', 'UM', 'RULE 02', 'UNAUTH MILES', 'Cost charged to a truck for going out of route to drop a load', 'Misc', true, 'chargeback', null),
  ('PRIME INC', 'UO', 'OIL 01', 'TRACTOR OIL', 'Oil for tractor only', 'Fuel & DEF', true, 'chargeback', null),
  ('PRIME INC', 'UR', 'REPR 01', 'TRACTOR REPAIR', 'Tractor repairs done over the road or outside of Prime', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'UT', 'TIRE 01', 'TRACTOR TIRE', 'Used for the purchase or repair of tractor tires', 'Tires', true, 'chargeback', null),
  ('PRIME INC', 'UW', 'WASH 01', 'TRACTOR WASH', 'Tractor wash', 'Truck Wash & Detailing', true, 'chargeback', null),
  ('PRIME INC', 'VS', null, 'SERV INC V SOLO', 'Added pay for no service failures during last 13 weeks (solo)', null, null, 'income', null),
  ('PRIME INC', 'VT', null, 'SERV INC V TEAM', 'Added pay for no service failures during last 13 weeks (team)', null, null, 'income', null),
  ('PRIME INC', 'W1', null, 'WRNTY DL <=$500', 'If warranty $ comes back for a repair originally <=$500 out of drivetrain, this code puts the $ back in the D1 account', null, null, 'income', null),
  ('PRIME INC', 'W2', null, 'WRNTY DL >$500', 'If warranty $ comes back for a repair originally >$500 out of drivetrain, this code puts the $ back in the D2 account', null, null, 'income', null),
  ('PRIME INC', 'WA', 'ADV 01', 'ADVANCE', 'Pay given in advance of settlement', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'WA', 'ADV 97', 'WKLY PYMT OF ADV', null, 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'WA', 'ADV 98', 'WKLY PYMT OF ADV', null, 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'WA', 'ADV 99', 'ADV IN PYMTS', null, 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'WC', null, 'WORK COMP COST', 'Worker''s Compensation charges to cover cost of company driver', 'Wages & Payroll Taxes (W-2)', true, 'chargeback', null),
  ('PRIME INC', 'WD', null, 'WAGE DUMP ITEMS', 'Items charged through the wage dump section to cover the cost of a lease or owner''s company driver', null, null, null, null),
  ('PRIME INC', 'WE', 'ADV 06', 'TRIP ESTIMATE', 'An advance for a trip that delivers too late to pay the current week, charged back the following week when the trip pays', 'Advance Repayment', false, 'chargeback', null),
  ('PRIME INC', 'WI', 'WASH 02', 'WASH INTERIOR', 'Wash the inside of trailer', 'Truck Wash & Detailing', true, 'chargeback', null),
  ('PRIME INC', 'WO', 'MISC 13', 'WO OPER BAL FWD', 'Used if a lease operator leaves Prime with a negative balance', null, null, null, null),
  ('PRIME INC', 'WP', 'ADV 01', 'WIRE PAYCHECK', 'To send a paycheck via Comcheck', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'WR', null, 'WARRANTY', 'Credit to the operator for repairs or parts that get warranty money back on', null, null, 'income', null),
  ('PRIME INC', 'WS', 'PART 06', 'DR WEIGHRTE DEP', 'Deposit for Weighrite system, an onboard air pressure weighing system', 'Escrow & Deposits', false, 'chargeback', null),
  ('PRIME INC', 'WT', 'WGT 01', 'WEIGHT TICKETS', 'Cost of weighing the truck', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'XL', 'RPLAB', 'DRIVER REPAIR LBR', 'Pay operator to make minor trailer repairs (lights)', null, null, 'income', null),
  ('PRIME INC', 'XP', 'PART 07', 'DRVR REPR PARTS', 'Reimb to a driver who has paid out of pocket for trailer parts', null, null, 'income', null),
  ('PRIME INC', 'XT', 'REPR 02', 'DROPPED TRL REPAIR', 'Money charged for dropping a trailer in disrepair & another truck has to wait to get it repaired', 'Maintenance & Repairs', true, 'chargeback', null),
  ('PRIME INC', 'XW', 'XPAY', 'WAIT 4 TRL REPR', '$25 per hour up to 3 hrs to wait for trailer to be repaired, that was another driver''s responsibility', null, null, 'income', null),
  ('PRIME INC', 'YS', null, 'SAFTY INCV SOLO', 'Added pay for no preventable accidents during last 13 weeks (solo)', null, null, 'income', null),
  ('PRIME INC', 'YT', null, 'SAFTY INCV TEAM', 'Added pay for no preventable accidents during last 13 weeks (team)', null, null, 'income', null),
  ('PRIME INC', 'YW', 'YARDW', 'YARD WORK W/C', null, null, null, 'income', null)
on conflict (carrier, code, sub_code) do nothing;

-- ============================================================
-- PENDING_SQL.md §53: Carrier-scoped bridge codes for real-world text variants (owner decision 2026-08-24, cleanup of the pre-existing generic-classifier leak flagged in CLAUDE.md's CARRIER-SCOPED PAYROLL/SETTLEMENT CODES entry) — ✅ APPLIED
-- ============================================================
-- Bridges real-world-observed text forms (seen verbatim on an actual
-- device import) that don't exactly match the spelling of the already-
-- seeded §52 reference-sheet rows. IDEMPOTENCY FIX (this file): the raw
-- original text had no on conflict clause here either.
insert into carrier_code_maps (carrier, code, sub_code, label, description, category, is_deductible, income_or_chargeback, notes) values
  ('PRIME INC', 'EXTEND WR PURCH', null, 'Extended Warranty Purchase', 'Real-world code text observed verbatim on an actual statement — no existing §52 reference-sheet row covers an extended-warranty PURCHASE (only the unrelated income codes W1/W2/WR, which credit money back for a repair, not a purchase).', 'Warranty & Service Contracts', true, 'chargeback', null),
  ('PRIME INC', 'ACCOUNTING SERV', null, 'Accounting Service (abbreviated)', 'Bridges the already-seeded AS/MISC 16 "ACCOUNTING SERVICE" row''s fuller spelling to this shorter real-world form.', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'EZ FAST LN', null, 'EZ Fast Lane Toll', 'Bridges the already-seeded EZ row''s label "EZ FAST LN TOLL" — observed verbatim without the trailing "TOLL" suffix.', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'WIRE CHARGE', null, 'Wire Charge', 'Distinct from the already-seeded WP/ADV 01 "WIRE PAYCHECK" row (sending a paycheck via Comcheck) — this is a bank wire fee, a different charge.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'FUEL CARD CHARGE', null, 'Fuel Card Charge (spelled out)', 'Bridges the already-seeded FC/MISC 15 "FUEL CARD CHG" row''s abbreviation to this spelled-out real-world form.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'TRIP XPRESS', null, 'Trip Xpress Charge', 'Bridges the already-seeded TX/FDEX 01 "TRIP XPRESS CHG" row — observed verbatim without the trailing "CHG" suffix.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'STATEMENT PREPARATION', null, 'Statement Preparation Fee', 'Bridges the already-seeded OS "OPER STMT COST" row (same real charge, different real-world wording) — category matches OS''s own "Legal & Professional Services", not a new bucket.', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'POINT-OF-SALE', null, 'Point of Sale Purchase (hyphenated)', 'Bridges the already-seeded PO/PPOS 01 "POINT OF SALE" row (spaced) to this hyphenated real-world form (e.g. "PRIME POINT-OF-SALE") — the un-hyphenated spaced form already matches via the existing row''s own label.', 'Meals (per diem covered)', false, 'chargeback', null)
on conflict (carrier, code, sub_code) do nothing;

-- ============================================================
-- PENDING_SQL.md §54: import_jobs table (BACKGROUND IMPORT, owner decision 2026-08-24) — ✅ APPLIED
-- ============================================================
-- Created with the ORIGINAL 4-value status constraint here (matching
-- real history); §56 below widens it to add 'waiting_to_retry'. A fresh
-- run ends up with the correct final constraint either way, since §56's
-- own ALTER runs unconditionally right after.
create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Reserved for a future save-time linkage — not populated by this pass,
  -- nothing reads it yet.
  document_id uuid references documents(id) on delete set null,
  storage_path text not null,
  media_type text not null,
  file_name text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  pages_done integer not null default 0,
  pages_total integer,
  result_json jsonb,
  error_message text,
  error_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists import_jobs_user_id_idx on import_jobs(user_id, created_at desc);

alter table import_jobs enable row level security;
drop policy if exists "import_jobs_select_own" on import_jobs;
create policy "import_jobs_select_own" on import_jobs
  for select using (auth.uid() = user_id);
drop policy if exists "import_jobs_insert_own" on import_jobs;
create policy "import_jobs_insert_own" on import_jobs
  for insert with check (auth.uid() = user_id);
drop policy if exists "import_jobs_update_own" on import_jobs;
create policy "import_jobs_update_own" on import_jobs
  for update using (auth.uid() = user_id);
drop policy if exists "import_jobs_delete_own" on import_jobs;
create policy "import_jobs_delete_own" on import_jobs
  for delete using (auth.uid() = user_id);

-- ============================================================
-- PENDING_SQL.md §55: reviewed_at columns + compliance_items expansion (owner decision 2026-08-24, device testing round) — ✅ APPLIED
-- ============================================================
alter table deductions
  add column if not exists reviewed_at timestamptz;

alter table documents
  add column if not exists reviewed_at timestamptz;

alter table compliance_items
  add column if not exists issue_date date,
  add column if not exists reminder_lead_days integer,
  add column if not exists note text,
  add column if not exists truck_id uuid references trucks(id) on delete set null,
  add column if not exists driver_id uuid references drivers(id) on delete set null,
  add column if not exists applies_to text check (applies_to in ('truck', 'trailer', 'driver', 'business'));

-- ============================================================
-- PENDING_SQL.md §56: ai_rate_limit_state table + import_jobs 'waiting_to_retry' status (owner decision 2026-08-24, "Edge Function returned a non-2xx status code" bug fix pass, items 1+3) — ✅ APPLIED
-- ============================================================
-- Single GLOBAL row (every user shares ONE Anthropic API key, server-side
-- only) — a real 429 is an account-wide "pause the queue" signal.
create table if not exists ai_rate_limit_state (
  id boolean primary key default true check (id),
  limited_until timestamptz,
  last_reason text,
  updated_at timestamptz not null default now()
);

alter table ai_rate_limit_state enable row level security;
drop policy if exists "ai_rate_limit_state_select_all" on ai_rate_limit_state;
create policy "ai_rate_limit_state_select_all" on ai_rate_limit_state
  for select using (true);
-- No write policy for authenticated users — written only by ai-import's
-- own service-role client.

insert into ai_rate_limit_state (id) values (true) on conflict (id) do nothing;

-- IDEMPOTENCY FIX (this file): the raw original text dropped this
-- constraint with no `if exists` guard — a second run against an
-- already-migrated project would fail with "constraint does not exist."
alter table import_jobs drop constraint if exists import_jobs_status_check;
alter table import_jobs add constraint import_jobs_status_check
  check (status in ('queued', 'processing', 'waiting_to_retry', 'ready', 'failed'));

-- ============================================================
-- PENDING_SQL.md §57: Cash Flow forecast overrides (owner decision, "build it from the user's own data" pass) — ✅ APPLIED
-- ============================================================
-- cf_weekly_revenue/cf_truck_payment/cf_fuel_weekly/cf_insurance_weekly/
-- cf_other_weekly (§29/§39) are DEPRECATED by this pass — left in place
-- as harmless unused columns. An override always wins over the computed
-- average and persists independently of it.
alter table profiles
  add column if not exists cf_income_override numeric(12,2),
  add column if not exists cf_fixed_override numeric(12,2),
  add column if not exists cf_variable_override numeric(12,2),
  add column if not exists cf_periodic_overrides jsonb not null default '{}'::jsonb;

-- ============================================================
-- PENDING_SQL.md §58: profiles.plan gains 'owner' (owner/dev account flag, owner decision) — ✅ APPLIED (confirmed live 2026-08-26 via a live pg_constraint query)
-- ============================================================
-- IDEMPOTENCY FIX (this file): the raw original text dropped this
-- constraint with no `if exists` guard, and added the replacement with
-- no duplicate-object guard — both fixed here, same pattern 0002 already
-- established for §18/§31's own constraint changes.
alter table profiles drop constraint if exists profiles_plan_check;
do $$ begin
  alter table profiles add constraint profiles_plan_check
  check (plan in ('free_trial', 'paid', 'lifetime', 'complimentary', 'owner'));
exception when duplicate_object then null;
end $$;

-- ============================================================
-- PENDING_SQL.md §59: AI credit self-grant RLS hole (P0 SECURITY FIX, FULL SYSTEM AUDIT, owner decision 2026-08-26) — ✅ APPLIED
-- ============================================================
-- Closes a genuine RLS hole: ai_credit_purchases_update_own (§51) let any
-- authenticated user PATCH their own row's credits_remaining directly via
-- the REST API, permanently bypassing the entire cost-control system. Also
-- closes the P1 TOCTOU race in the old client-side select-then-update
-- credit-consumption logic.
drop policy if exists "ai_credit_purchases_update_own" on ai_credit_purchases;

-- IDEMPOTENCY FIX (this file): the raw original text had no
-- duplicate-object guard on this constraint add.
do $$ begin
  alter table ai_credit_purchases
    add constraint ai_credit_purchases_remaining_le_granted
    check (credits_remaining <= credits_granted);
exception when duplicate_object then null;
end $$;

-- Atomic, row-locked, auth.uid()-scoped credit consumption — security
-- definer so it can write despite the now-absent UPDATE policy, but
-- derives the user EXCLUSIVELY from auth.uid() internally, never a
-- parameter.
create or replace function consume_ai_import_credit()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_pack_id uuid;
begin
  if v_user_id is null then
    raise exception 'consume_ai_import_credit: no authenticated user' using errcode = '28000';
  end if;

  -- Soonest-expiring usable pack first, never-expiring packs last
  -- ("use it or lose it").
  select id into v_pack_id
  from ai_credit_purchases
  where user_id = v_user_id
    and credits_remaining > 0
    and (expires_at is null or expires_at > now())
  order by (expires_at is null) asc, expires_at asc
  for update
  limit 1;

  if v_pack_id is null then
    return null;
  end if;

  update ai_credit_purchases
  set credits_remaining = credits_remaining - 1
  where id = v_pack_id;

  return v_pack_id;
end;
$$;

grant execute on function consume_ai_import_credit() to authenticated;

-- ============================================================
-- PENDING_SQL.md §60: Balance-ledger atomicity — 4 sites (P0 MONEY-CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision 2026-08-26) — ✅ APPLIED
-- ============================================================
-- Four new RPCs folding a row write and its business_balance delta
-- application into ONE atomic transaction each — either both happen or
-- neither does. No schema (column/table) changes in this section, only
-- functions (already idempotent via `create or replace`).
create or replace function record_manual_capital_transaction(
  p_user_id uuid,
  p_tx_type text,
  p_amount numeric,
  p_tx_date date,
  p_note text,
  p_linked_deduction_id uuid default null
)
returns capital_transactions
language plpgsql
security invoker
as $$
declare
  v_row capital_transactions;
  v_delta numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'record_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'record_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  v_delta := case when p_tx_type = 'contribution' then p_amount else -p_amount end;

  insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id, business_balance_applied)
  values (p_user_id, p_tx_type, p_amount, p_tx_date, p_note, p_linked_deduction_id, v_delta)
  returning * into v_row;

  if v_delta <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) + v_delta
    where user_id = p_user_id and user_id = auth.uid();
    if not found then
      raise exception 'record_manual_capital_transaction: no profiles row updated for user %', p_user_id
        using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function record_manual_capital_transaction(uuid, text, numeric, date, text, uuid) to authenticated;

create or replace function update_manual_capital_transaction(
  p_id uuid,
  p_user_id uuid,
  p_tx_type text,
  p_amount numeric,
  p_tx_date date,
  p_note text
)
returns capital_transactions
language plpgsql
security invoker
as $$
declare
  v_row capital_transactions;
  v_previous_delta numeric;
  v_new_delta numeric;
  v_adjustment numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'update_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'update_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  select business_balance_applied into v_previous_delta
  from capital_transactions
  where id = p_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'update_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
  end if;

  v_new_delta := case when p_tx_type = 'contribution' then p_amount else -p_amount end;
  v_adjustment := v_new_delta - coalesce(v_previous_delta, 0);

  update capital_transactions
  set amount = p_amount, tx_date = p_tx_date, note = p_note, business_balance_applied = v_new_delta
  where id = p_id
  returning * into v_row;

  if v_adjustment <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) + v_adjustment
    where user_id = p_user_id and user_id = auth.uid();
    if not found then
      raise exception 'update_manual_capital_transaction: no profiles row updated for user %', p_user_id
        using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function update_manual_capital_transaction(uuid, uuid, text, numeric, date, text) to authenticated;

create or replace function delete_manual_capital_transaction(
  p_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_delta numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'delete_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;

  select business_balance_applied into v_delta
  from capital_transactions
  where id = p_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'delete_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
  end if;

  if v_delta <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) - v_delta
    where user_id = p_user_id and user_id = auth.uid();
    if not found then
      raise exception 'delete_manual_capital_transaction: no profiles row updated for user %', p_user_id
        using errcode = 'P0002';
    end if;
  end if;

  -- Only now — the reversal has already committed within this SAME
  -- transaction — does the row itself get removed. If anything above
  -- raised, this line never runs and the whole transaction rolls back, so
  -- the row is NEVER deleted without its reversal having succeeded.
  delete from capital_transactions where id = p_id;
end;
$$;

grant execute on function delete_manual_capital_transaction(uuid, uuid) to authenticated;

create or replace function apply_settlement_business_balance_credit(
  p_settlement_id uuid,
  p_user_id uuid,
  p_new_credit numeric
)
returns numeric
language plpgsql
security invoker
as $$
declare
  v_previous_credit numeric;
  v_delta numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'apply_settlement_business_balance_credit: user mismatch' using errcode = '28000';
  end if;

  select business_balance_credit into v_previous_credit
  from settlements
  where id = p_settlement_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'apply_settlement_business_balance_credit: no settlement % for user %', p_settlement_id, p_user_id
      using errcode = 'P0002';
  end if;

  v_delta := p_new_credit - coalesce(v_previous_credit, 0);

  update settlements
  set business_balance_credit = p_new_credit
  where id = p_settlement_id;

  if v_delta <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) + v_delta
    where user_id = p_user_id and user_id = auth.uid();
    if not found then
      raise exception 'apply_settlement_business_balance_credit: no profiles row updated for user %', p_user_id
        using errcode = 'P0002';
    end if;
  end if;

  return v_delta;
end;
$$;

grant execute on function apply_settlement_business_balance_credit(uuid, uuid, numeric) to authenticated;

-- ============================================================
-- PENDING_SQL.md §61: maintenance_records/tolls gain settlement_id (P1 CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision) — NOT YET RUN as of this file's writing; confirm real status in docs/PENDING_SQL.md before relying on this being live
-- ============================================================
-- Fixes a real duplicate-expense bug: re-importing the same settlement PDF
-- twice doubled maintenance/toll rows, because neither table had a
-- settlement_id column to scope "old rows for THIS settlement" by (unlike
-- loads/fuel_purchases/reimbursements/withheld deductions, which already
-- did). A row from anywhere OTHER than a settlement import leaves this
-- column null, exactly like fuel_purchases.settlement_id already does for
-- a standalone fuel receipt.
alter table maintenance_records
  add column if not exists settlement_id uuid references settlements on delete cascade;

alter table tolls
  add column if not exists settlement_id uuid references settlements on delete cascade;

create index if not exists maintenance_records_settlement_id_idx on maintenance_records(settlement_id);
create index if not exists tolls_settlement_id_idx on tolls(settlement_id);

-- ============================================================
-- PENDING_SQL.md §62: Deduction edit/add + contribution sync made atomic (P1 CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision) — NOT YET RUN as of this file's writing; confirm real status in docs/PENDING_SQL.md before relying on this being live
-- ============================================================
-- Folds a deduction row write and its linked capital_transactions
-- contribution sync into ONE atomic RPC transaction each, closing a
-- network-drop-between-two-awaits gap that could leave a deduction saved
-- with a stale/missing/orphaned linked contribution. No schema (column/
-- table) changes in this section, only functions.
create or replace function update_deduction_with_contribution_sync(
  p_deduction_id uuid,
  p_user_id uuid,
  p_category text,
  p_payment_method text,
  p_amount numeric,
  p_tax_deductible boolean,
  p_sync_action text,
  p_contribution_id uuid default null,
  p_contribution_amount numeric default null,
  p_contribution_note text default null,
  p_contribution_date date default null
)
returns deductions
language plpgsql
security invoker
as $$
declare
  v_row deductions;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'update_deduction_with_contribution_sync: user mismatch' using errcode = '28000';
  end if;
  if p_sync_action not in ('noop', 'create', 'update', 'remove') then
    raise exception 'update_deduction_with_contribution_sync: invalid sync_action %', p_sync_action;
  end if;

  update deductions
  set category = p_category, payment_method = p_payment_method, amount = p_amount, tax_deductible = p_tax_deductible
  where id = p_deduction_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'update_deduction_with_contribution_sync: no deduction % for user %', p_deduction_id, p_user_id
      using errcode = 'P0002';
  end if;

  if p_sync_action = 'create' then
    insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id)
    values (p_user_id, 'contribution', p_contribution_amount, p_contribution_date, p_contribution_note, p_deduction_id);
  elsif p_sync_action = 'update' then
    update capital_transactions
    set amount = p_contribution_amount, note = p_contribution_note, tx_date = p_contribution_date
    where id = p_contribution_id and user_id = p_user_id;
  elsif p_sync_action = 'remove' then
    delete from capital_transactions where id = p_contribution_id and user_id = p_user_id;
  end if;

  return v_row;
end;
$$;

grant execute on function update_deduction_with_contribution_sync(uuid, uuid, text, text, numeric, boolean, text, uuid, numeric, text, date) to authenticated;

create or replace function insert_deduction_with_contribution_sync(
  p_user_id uuid,
  p_description text,
  p_category text,
  p_payment_method text,
  p_amount numeric,
  p_ded_date date,
  p_source text,
  p_tax_deductible boolean,
  p_create_contribution boolean default false,
  p_contribution_note text default null
)
returns deductions
language plpgsql
security invoker
as $$
declare
  v_row deductions;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'insert_deduction_with_contribution_sync: user mismatch' using errcode = '28000';
  end if;

  insert into deductions (user_id, description, category, payment_method, amount, ded_date, source, tax_deductible)
  values (p_user_id, p_description, p_category, p_payment_method, p_amount, p_ded_date, p_source, p_tax_deductible)
  returning * into v_row;

  if p_create_contribution then
    insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id)
    values (p_user_id, 'contribution', p_amount, coalesce(p_ded_date, current_date), p_contribution_note, v_row.id);
  end if;

  return v_row;
end;
$$;

grant execute on function insert_deduction_with_contribution_sync(uuid, text, text, text, numeric, date, text, boolean, boolean, text) to authenticated;
