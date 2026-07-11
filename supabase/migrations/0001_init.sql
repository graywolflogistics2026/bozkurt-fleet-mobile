-- ============================================================================
-- Bozkurt Fleet OS — Initial schema migration
-- Source of truth: docs/SCHEMA.sql (human-reviewed, FINAL — DECISIONS D1-D6
-- at its bottom are owner-approved) and docs/FEATURE_INVENTORY.md.
--
-- Every table/relationship/check-constraint/enum below matches docs/SCHEMA.sql
-- EXACTLY (including decision D6 there). This migration only ADDS the
-- infrastructure the draft explicitly deferred to "the migration":
--   1. Row Level Security + owner-only policies on every table (draft header:
--      "RLS enabled, user_id = auth.uid() policies (added in migration)")
--   2. created_at/updated_at on every table (several tables in the draft only
--      had created_at, or neither — normalized to both everywhere, plus a
--      shared trigger so updated_at actually advances on UPDATE, not just once
--      at INSERT time)
--   3. `on delete cascade` added to every `user_id references auth.users`
--      column (the draft left this unspecified everywhere except `profiles`,
--      which already had it explicitly — this just applies that same rule
--      uniformly so a deleted auth user's data doesn't strand orphaned rows
--      or block the auth.users delete with an FK error)
--   4. The maintenance_intervals seed trigger on trucks (owner decision
--      2026-07-03, per docs/SCHEMA.sql's comment on that table)
--   5. The truck_health view (per DECISION D2)
--   6. Storage buckets + owner-only policies (per DECISION D5 and the
--      `documents`/`backups` bucket requirement)
--   7. A standard Supabase `handle_new_user` bootstrap trigger on auth.users
--      that creates the matching `profiles` row on signup — not called for
--      explicitly, but without it there is no way to satisfy profiles' RLS
--      insert policy from the client; this is Supabase's own documented
--      pattern for this exact situation.
--
-- Owner decisions (2026-07-03, amends docs/SCHEMA.sql — see D6 there):
--   - fuel_purchases.settlement_id is `on delete cascade` (not `set null` as
--     first drafted) — matches legacy's deleteSett(), which hard-deletes that
--     week's fuel rows along with the settlement, since deleting a settlement
--     means "this import was wrong, remove everything it created." Orphaned
--     fuel rows under `set null` would double-count in fuel totals and CPM.
--   - Storage path convention `{user_id}/{month}/Payroll/Week-N/...` /
--     `{user_id}/{month}/Equipment-Deductions/{store}/...` is approved as
--     the standing convention — also recorded in CLAUDE.md for later sessions.
--
-- FILE STRUCTURE — fixes a "relation \"public.profiles\" does not exist"
-- error from an earlier version of this file, where a bootstrap statement
-- referencing `profiles` sat ahead of tables/functions/triggers for other
-- objects in file order. The file is now six strictly ordered sections, each
-- referencing ONLY objects created in an earlier section:
--   1. CREATE TABLE  — every table, dependency-ordered (a table appears only
--      after every table its own foreign keys point to)
--   2. CREATE INDEX  — all indexes (their tables already exist per §1)
--   3. Functions + triggers — touch_updated_at, handle_new_user,
--      seed_maintenance_intervals, and every per-table updated_at trigger.
--      (Function bodies are plpgsql, so Postgres does not check the table
--      names *inside* them until the function actually runs — but the
--      CREATE TRIGGER statements that attach these functions to a table DO
--      need that table to exist right now, which §1 already guarantees.)
--   4. The truck_health view — needs maintenance_records,
--      maintenance_intervals, trucks, and truck_health_config, all from §1.
--   5. RLS enable + owner-only policy for every table.
--   6. Storage buckets + policies.
-- Mentally executing top-to-bottom: no statement below references an object
-- defined later in this same file.
-- ============================================================================

-- pgcrypto: gen_random_uuid() is core in the Postgres versions Supabase runs,
-- but crypt()/gen_salt() (used by supabase/seed.sql to create a dev user) are
-- not — this makes the extension's presence explicit rather than assumed.
create extension if not exists "pgcrypto";

-- ============================================================================
-- §1. TABLES (dependency-ordered)
-- ============================================================================

-- ---------- Identity & profile ----------
-- auth.users comes from Supabase Auth. profiles extends it.
create table profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  company_name text,                         -- blank until set in onboarding/Settings
  owner_name   text,
  locale       text,                         -- app UI language override (en/es/ru/ar/tr); null = follow device
  home_state   text default 'TX',
  filing_status text default 'mfj',          -- tax estimator default
  business_balance numeric(12,2) default 0,  -- was gw_bizbal; 0 until owner sets a starting balance
  initial_capital  numeric(12,2) default 0,  -- was CAPITAL.contribution; 0 until owner sets a starting balance
  settings     jsonb default '{}',           -- autosave, view_only, etc.
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Trucks (multi-truck ready; you have 1 today, "2. asset" gelince hazır) ----------
create table trucks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  unit_number  text,                          -- '830157'
  vin          text,
  year int, make text, model text,            -- 2023 International LT
  engine       text,                          -- 'A26 12.4L'
  current_odometer int,
  fleet_mpg    numeric(4,1) default 8.9,
  apu_hours    int,                           -- TriPac Evolution
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Drivers (NEW, owner decision 2026-07-09 — multi-truck fleet +
-- drivers + payroll auto-routing, PRODUCT DECISION). A driver is optional:
-- an account with zero driver rows behaves exactly as before (settlements
-- just have a null driver_id). default_truck_id is a soft hint for future
-- UI convenience (e.g. pre-selecting a truck when adding a driver's next
-- settlement) — never required, never enforced by a trigger.
-- compensation_type/pay_type/pay_rate added retroactively (driver
-- compensation types, owner decision 2026-07-10, PENDING_SQL.md §15) —
-- pay_rate is informational display only; the tax engine only ever reads
-- actual recorded driver_payments rows below, never derives from pay_rate.
create table drivers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  name             text not null,
  phone            text,
  license          text,
  active           boolean default true,
  default_truck_id uuid references trucks on delete set null,
  compensation_type text not null default 'w2_employee'
                    check (compensation_type in ('w2_employee', '1099_contractor', 'team_split', 'trainee')),
  pay_type         text check (pay_type in ('per_mile', 'percent', 'flat')),
  pay_rate         numeric(10,4),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ---------- Documents (archive + duplicate detection; was DB.docs) ----------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  filename     text,
  doc_type     text,                          -- settlement|fuel|maintenance|store|toll|loan|bankstmt|checking|other
  doc_date     date,                          -- the document's OWN date
  amount       numeric(12,2),
  storage_path text,                          -- Supabase Storage: {user_id}/{month}/Payroll/Week-2/...
  parsed_json  jsonb,                         -- D3: full raw AI extraction (audit trail, re-processable)
  imported_at  timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Compliance items (NEW, owner decision 2026-07-10 — AI feature
-- package, compliance tracker, PRODUCT DECISION). Optional/additive; type
-- covers all 8 categories named in the spec, only 5 auto-populate via
-- ai-import (mapCompliance()) — ifta_filing/cdl/drug_consortium are
-- manual-entry only for now. See PENDING_SQL.md §23.
create table compliance_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users on delete cascade,
  type                text not null check (type in (
                        'medical_card', 'annual_inspection', 'irp_registration',
                        'hvut_2290', 'ifta_filing', 'insurance_policy', 'cdl',
                        'drug_consortium', 'other'
                      )),
  label               text not null,
  due_date            date not null,
  recurrence          text check (recurrence in ('none', 'annual', 'biennial', 'quarterly')),
  source_document_id  uuid references documents on delete set null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ---------- Settlements (was DB.sett) ----------
create table settlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  truck_id     uuid references trucks,
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14 (payroll auto-routing)
  document_id  uuid references documents,
  week_ending  date not null,
  gross        numeric(12,2) not null default 0,
  net          numeric(12,2) not null default 0,
  miles        int default 0,
  tags         text,  -- added retroactively, PENDING_SQL.md §22 (flexible fields, owner decision
                       -- 2026-07-10) — user's own ad-hoc labeling, separate from any AI/system
                       -- description; same rationale on every other table below that gets this.
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, week_ending)               -- one settlement per week
);

-- ---------- Driver payments (NEW, owner decision 2026-07-10 — driver
-- compensation types). What the owner actually paid a driver — the tax
-- engine's sole source for driver payroll expense. on delete cascade from
-- drivers (unlike driver_id elsewhere, which is on delete set null) — a
-- payment record has no meaning without the driver it paid; settlement_id
-- IS on delete set null (CLAUDE.md invariant #5 cascades still must not
-- delete what was actually paid). See PENDING_SQL.md §16.
create table driver_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  driver_id      uuid not null references drivers on delete cascade,
  settlement_id  uuid references settlements on delete set null,
  date           date not null,
  gross_pay      numeric(12,2) not null default 0,
  employer_taxes numeric(12,2) not null default 0,  -- only populated for w2_employee, from tax_year_data.se_tax.employer_fica
  notes          text,
  tags           text,  -- PENDING_SQL.md §22
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index on driver_payments (user_id, driver_id, date);

-- ---------- Loads (was DB.loads; feeds best/worst lane analysis) ----------
create table loads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  settlement_id uuid references settlements on delete cascade,
  driver_id     uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14
  load_date     date,
  order_number  text,
  origin        text,
  destination   text,
  loaded_miles  int default 0,
  empty_miles   int default 0,
  revenue       numeric(12,2) default 0,
  tags          text,  -- PENDING_SQL.md §22
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ---------- Fuel (was DB.fuel.tr / DB.fuel.re; +state = IFTA-ready) ----------
create table fuel_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  settlement_id uuid references settlements on delete cascade,  -- D6: matches legacy deleteSett()
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14
  fuel_type    text not null check (fuel_type in ('tractor','reefer')),
  purchase_date date,
  location     text,
  state        text,                          -- NEW: 2-letter code → IFTA quarterly report
  gallons      numeric(8,3),
  amount       numeric(12,2),
  discount     numeric(12,2) default 0,
  tags         text,  -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- User categories (NEW, owner decision 2026-07-10 — custom
-- categories, PRODUCT DECISION). Entirely optional/additive — an account
-- with zero rows here behaves exactly as today (pickers show just
-- CANONICAL_CATEGORIES). Tax safety rail enforced at the DB level: a
-- kind='expense' row MUST carry schedule_c_bucket (app defaults to "Misc"
-- when the user doesn't pick one) so a custom expense category can never
-- silently fall out of the P&L/tax estimate; kind='income' rows have no
-- bucket — custom income categories roll straight into gross income. See
-- PENDING_SQL.md §21.
create table user_categories (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  name              text not null,
  kind              text not null check (kind in ('income', 'expense')),
  schedule_c_bucket text,
  active            boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (user_id, name),
  check (kind = 'income' or schedule_c_bucket is not null)
);

-- ---------- Deductions (was DB.ded — the tax heart) ----------
create table deductions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  settlement_id uuid references settlements on delete cascade,  -- set for withheld items
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14 (withheld deductions only — see payroll auto-routing note)
  document_id  uuid references documents on delete set null,
  ded_date     date,
  code         text,                          -- EQUIP|LEGAL|INS|LIC|OTHER|...
  description  text,
  amount       numeric(12,2) not null,
  category     text,                          -- Software & Subscriptions | Legal & Accounting Fees | ...
  store        text,
  payment_method text,                        -- Business Credit|Business Debit|Personal Card|Cash|Settlement Withheld
  source       text default 'manual'          -- settlement|import|manual
                check (source in ('settlement','import','manual')),
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
-- Tax rule (net-pay model): deductible = rows where source != 'settlement'.
-- Withheld rows are display-only; already reflected in settlements.net.

-- ---------- Capital transactions (UNIFIED: was CAPITAL.draws + extraContributions) ----------
create table capital_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  tx_type      text not null check (tx_type in ('contribution','draw')),
  amount       numeric(12,2) not null,
  tx_date      date not null,
  note         text,
  linked_deduction_id uuid references deductions on delete cascade,
  -- ^ personal-payment purchases: contribution auto-created, cascades on delete.
  --   Postgres FK does the cascade the web app had to hand-code. NULL for manual draws.
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
-- Tax-free remaining = profiles.initial_capital + sum(contributions) - sum(draws)

-- ---------- Maintenance (was DB.maint; feeds Truck Health) ----------
create table maintenance_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  truck_id     uuid references trucks,
  document_id  uuid references documents on delete set null,
  service_date date,
  service_type text,                          -- oil|fuel|dpf|def|coolant_ext|coolant|trans|diff|airfilter|airdryer|chassis|apu|valve|general|repair
  description  text,
  odometer     int,
  engine_hours int,                           -- APU services
  cost         numeric(12,2) default 0,
  vendor       text,
  invoice_number text,
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Maintenance intervals (per-truck, user-editable — NEW, owner decision 2026-07-03) ----------
-- Every truck is different; each owner tunes their own service schedule. The legacy
-- JS constants (oil 50,000 mi fixed; fuel filter bundled with oil; DPF mpg-tiered;
-- trans 500k synthetic/250k conventional; diff 500k synthetic/100k conventional;
-- air filter 100k; air dryer 250k; chassis 30k; APU 2,000 engine hrs; coolant extender
-- 300k / full replace 600k; DEF filter 300k) become SEED DEFAULTS copied into this table
-- when a truck row is created (via the seed_maintenance_intervals trigger in §3 below).
-- From then on every row is a plain user-editable setting; there are no interval
-- constants left in application code.
create table maintenance_intervals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  truck_id      uuid not null references trucks on delete cascade,
  category      text not null,                 -- oil|fuel|dpf|def|coolant_ext|coolant|trans|diff|airfilter|airdryer|chassis|apu|valve|general
  tracking_mode text not null default 'miles'
                check (tracking_mode in ('miles','hours','mpg_based')),
  interval_miles int,                           -- used when tracking_mode in ('miles','mpg_based')
  interval_hours int,                           -- used when tracking_mode = 'hours' (APU only, today)
  bundled_with_category text,                   -- e.g. the 'fuel' row has bundled_with_category='oil':
                                                 -- always serviced together, so its baseline also
                                                 -- advances from 'oil' maintenance_records even when
                                                 -- no 'fuel' record was ever logged (was
                                                 -- MAINT_BUNDLE_MAP in legacy JS)
  enabled       boolean not null default true,  -- false hides the category from Truck Health
                                                 -- entirely (e.g. an owner who doesn't track Valve Lash)
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (truck_id, category)
);
-- Seed defaults for a new truck (ported 1:1 from legacy/index.html, mpg_based rows resolved
-- against the truck's fleet_mpg at creation time using the same tiers as legacy dpfMi()):
--   oil          miles  50000
--   fuel         miles  50000   bundled_with_category='oil'
--   dpf          mpg_based  350000/500000/600000 (mpg <5.5 / <6.5 / >=6.5 at creation time)
--   def          miles  300000
--   coolant_ext  miles  300000
--   coolant      miles  600000
--   trans        miles  500000  (synthetic default; owner edits to 250000 if conventional)
--   diff         miles  500000  (synthetic default; owner edits to 100000 if conventional)
--   airfilter    miles  100000
--   airdryer     miles  250000
--   chassis      miles  30000
--   apu          hours  2000    tracking_mode='hours'
-- Fluid-type (synthetic/conventional) is no longer a separate stored flag — it's just
-- reflected directly in whatever interval_miles the owner sets for trans/diff.

-- ---------- Truck health config (was gw_health; MANUAL BASELINE overrides only) ----------
-- Interval LENGTHS now live entirely in maintenance_intervals (above) — this table no
-- longer stores anything interval-related (no fluid-type flag, no interval overrides).
-- It exists only for a manual "I know this was actually last serviced at odometer X /
-- hour Y" baseline override when no matching maintenance_records row exists to derive
-- it from (e.g. legacy's hardcoded chassis-lube floor at a specific odometer reading —
-- that becomes one explicit override row here instead of a code constant).
create table truck_health_config (
  truck_id     uuid primary key references trucks on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  overrides    jsonb default '{}',            -- { "<category>": { "odometer": n } | { "hours": n } }
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Tolls (was DB.tolls.ez / DB.tolls.dw) ----------
create table tolls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  network      text check (network in ('ezpass','drivewyze','other')),
  toll_date    date,
  amount       numeric(12,2),
  plaza        text,
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Reimbursements (was DB.reimb) ----------
create table reimbursements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  reimb_date   date,
  description  text,
  reference    text,
  amount       numeric(12,2),
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Loans & credit cards (was LOANS / CARDS) ----------
create table loans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  name         text, lender text,
  original_amount numeric(12,2), balance numeric(12,2),
  payment      numeric(12,2), frequency text, apr numeric(5,2),
  next_due     date,
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table credit_cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  name         text, last_four text,
  credit_limit numeric(12,2), balance numeric(12,2),
  apr numeric(5,2), due_day int,
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Bank & checking statements (was BANK_STMTS / CHK_STMTS, normalized) ----------
create table bank_statements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  account_type text check (account_type in ('card','checking')),
  statement_month text,                       -- 'June 2026'
  document_id  uuid references documents on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, account_type, statement_month)   -- month-level duplicate guard
);

create table bank_transactions (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references bank_statements on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  tx_date      date,
  description  text,
  category     text,
  tx_type      text check (tx_type in ('charge','payment','deposit','withdrawal')),
  amount       numeric(12,2),
  deductible   boolean default false,
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ============================================================================
-- §2. INDEXES (all target tables already exist per §1)
-- ============================================================================

create index on documents (user_id, doc_type, doc_date, amount);  -- duplicate check
create index on documents (user_id, doc_date);                    -- plain date-range lookups
create index on compliance_items (user_id, due_date);
create index on loads (user_id, load_date);
create index on fuel_purchases (user_id, purchase_date);
create index on deductions (user_id, ded_date);
create index on capital_transactions (user_id, tx_date);
create index on maintenance_records (user_id, service_date);
create index on maintenance_records (truck_id, service_type, odometer);  -- truck_health baseline lookups
create index on tolls (user_id, toll_date);
create index on reimbursements (user_id, reimb_date);
create index on bank_transactions (user_id, tx_date);

-- ============================================================================
-- §3. FUNCTIONS + TRIGGERS
-- (their target tables all exist per §1; plpgsql bodies aren't checked for
-- object existence until they actually run, but that's irrelevant here since
-- every table they touch already exists by this point anyway)
-- ============================================================================

-- ---------- Shared: updated_at auto-touch ----------
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Bootstrap: create a profiles row on signup ----------
-- Standard Supabase pattern. security definer + pinned search_path because
-- this fires from auth.users during signup, outside a normal authenticated
-- request context.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Seed maintenance_intervals for every new truck ----------
-- Runs with the inserting user's own privileges (not security definer) —
-- trucks' own RLS insert policy (§5) already guarantees new.user_id =
-- auth.uid() by the time this fires, so the inserts below satisfy
-- maintenance_intervals' RLS normally.
create or replace function seed_maintenance_intervals()
returns trigger
language plpgsql
as $$
declare
  v_dpf_miles int;
begin
  v_dpf_miles := case
    when coalesce(new.fleet_mpg, 8.9) >= 6.5 then 600000
    when coalesce(new.fleet_mpg, 8.9) >= 5.5 then 500000
    else 350000
  end;

  insert into maintenance_intervals
    (user_id, truck_id, category, tracking_mode, interval_miles, interval_hours, bundled_with_category)
  values
    (new.user_id, new.id, 'oil',         'miles',     50000,        null, null),
    (new.user_id, new.id, 'fuel',        'miles',     50000,        null, 'oil'),
    (new.user_id, new.id, 'dpf',         'mpg_based', v_dpf_miles,  null, null),
    (new.user_id, new.id, 'def',         'miles',     300000,       null, null),
    (new.user_id, new.id, 'coolant_ext', 'miles',     300000,       null, null),
    (new.user_id, new.id, 'coolant',     'miles',     600000,       null, null),
    (new.user_id, new.id, 'trans',       'miles',     500000,       null, null),
    (new.user_id, new.id, 'diff',        'miles',     500000,       null, null),
    (new.user_id, new.id, 'airfilter',   'miles',     100000,       null, null),
    (new.user_id, new.id, 'airdryer',    'miles',     250000,       null, null),
    (new.user_id, new.id, 'chassis',     'miles',     30000,        null, null),
    (new.user_id, new.id, 'apu',         'hours',     null,         2000, null);

  return new;
end;
$$;

create trigger trg_seed_maintenance_intervals
  after insert on trucks
  for each row execute function seed_maintenance_intervals();

-- ---------- Per-table updated_at triggers ----------
create trigger trg_touch_updated_at before update on profiles
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on trucks
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on drivers
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on documents
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on compliance_items
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on settlements
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on driver_payments
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on loads
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on fuel_purchases
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on user_categories
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on deductions
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on capital_transactions
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on maintenance_records
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on maintenance_intervals
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on truck_health_config
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on tolls
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on reimbursements
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on loans
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on credit_cards
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on bank_statements
  for each row execute function touch_updated_at();
create trigger trg_touch_updated_at before update on bank_transactions
  for each row execute function touch_updated_at();

-- ============================================================================
-- §4. TRUCK HEALTH VIEW (DECISION D2)
-- Computes remaining-life per (truck, category): highest-odometer/hours-wins
-- baseline from maintenance_records (with bundled_with_category cascading,
-- e.g. an 'oil' record also advances the 'fuel' baseline), falling back to a
-- manual truck_health_config.overrides entry only when NO maintenance record
-- exists for that category (own or bundled) — then interval_miles/hours from
-- maintenance_intervals minus miles/hours consumed since that baseline.
-- security_invoker so the view is subject to the SAME RLS as its base tables
-- for whichever user queries it (not the view owner's privileges).
-- Depends on: maintenance_records, maintenance_intervals, trucks,
-- truck_health_config — all created in §1.
-- ============================================================================
create view truck_health
with (security_invoker = true) as
with baselines as (
  select truck_id, service_type,
         max(odometer) as max_odo,
         max(engine_hours) as max_hours
  from maintenance_records
  where service_type is not null
  group by truck_id, service_type
),
computed as (
  select
    mi.id                    as interval_id,
    mi.user_id,
    mi.truck_id,
    mi.category,
    mi.tracking_mode,
    mi.interval_miles,
    mi.interval_hours,
    mi.bundled_with_category,
    t.current_odometer,
    t.apu_hours,
    coalesce(
      greatest(b_own.max_odo, b_bundle.max_odo),
      (thc.overrides -> mi.category ->> 'odometer')::int,
      0
    ) as baseline_odometer,
    coalesce(
      b_own.max_hours,
      (thc.overrides -> mi.category ->> 'hours')::int,
      0
    ) as baseline_hours
  from maintenance_intervals mi
  join trucks t on t.id = mi.truck_id
  left join truck_health_config thc on thc.truck_id = mi.truck_id
  left join baselines b_own
    on b_own.truck_id = mi.truck_id and b_own.service_type = mi.category
  left join baselines b_bundle
    on mi.bundled_with_category is not null
   and b_bundle.truck_id = mi.truck_id and b_bundle.service_type = mi.bundled_with_category
  where mi.enabled = true
),
with_remaining as (
  select *,
    case
      when tracking_mode = 'hours'
        then interval_hours - (coalesce(apu_hours, 0) - baseline_hours)
      else interval_miles - (coalesce(current_odometer, 0) - baseline_odometer)
    end as remaining
  from computed
)
select
  interval_id, user_id, truck_id, category, tracking_mode,
  interval_miles, interval_hours, baseline_odometer, baseline_hours, remaining,
  case
    when remaining < 0 then 'overdue'
    when tracking_mode = 'hours' and remaining < 200 then 'due_soon'
    when tracking_mode <> 'hours' and interval_miles is not null
         and remaining < interval_miles * 0.1 then 'due_soon'
    else 'ok'
  end as status
from with_remaining;

grant select on truck_health to authenticated, service_role;

-- ============================================================================
-- §5. ROW LEVEL SECURITY — enable + owner-only policy per table
-- ============================================================================

alter table profiles enable row level security;
create policy "profiles_owner_all" on profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table trucks enable row level security;
create policy "trucks_owner_all" on trucks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table drivers enable row level security;
create policy "drivers_owner_all" on drivers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table documents enable row level security;
create policy "documents_owner_all" on documents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table compliance_items enable row level security;
create policy "compliance_items_owner_all" on compliance_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table settlements enable row level security;
create policy "settlements_owner_all" on settlements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table driver_payments enable row level security;
create policy "driver_payments_owner_all" on driver_payments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table loads enable row level security;
create policy "loads_owner_all" on loads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table fuel_purchases enable row level security;
create policy "fuel_purchases_owner_all" on fuel_purchases
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table user_categories enable row level security;
create policy "user_categories_owner_all" on user_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table deductions enable row level security;
create policy "deductions_owner_all" on deductions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table capital_transactions enable row level security;
create policy "capital_transactions_owner_all" on capital_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table maintenance_records enable row level security;
create policy "maintenance_records_owner_all" on maintenance_records
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table maintenance_intervals enable row level security;
create policy "maintenance_intervals_owner_all" on maintenance_intervals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table truck_health_config enable row level security;
create policy "truck_health_config_owner_all" on truck_health_config
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table tolls enable row level security;
create policy "tolls_owner_all" on tolls
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table reimbursements enable row level security;
create policy "reimbursements_owner_all" on reimbursements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table loans enable row level security;
create policy "loans_owner_all" on loans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table credit_cards enable row level security;
create policy "credit_cards_owner_all" on credit_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table bank_statements enable row level security;
create policy "bank_statements_owner_all" on bank_statements
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table bank_transactions enable row level security;
create policy "bank_transactions_owner_all" on bank_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- §6. STORAGE BUCKETS (DECISION D5 + documents archive)
-- Both buckets are private; objects MUST be stored under a `{auth.uid()}/...`
-- path prefix — the policies below key off the first path segment, matching
-- Supabase's standard per-user storage convention. So documents.storage_path
-- (and any backup filename) should be written as e.g.
--   {user_id}/{month}/Payroll/Week-2/2026-06-27_Payroll-Settlement_Prime-Inc.pdf
--   {user_id}/backups/graywolf-backup-2026-06-28T10-15-00.json
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

create policy "documents_bucket_owner_all" on storage.objects
  for all
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "backups_bucket_owner_all" on storage.objects
  for all
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
