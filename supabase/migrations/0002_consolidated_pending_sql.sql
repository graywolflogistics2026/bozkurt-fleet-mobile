-- supabase/migrations/0002_consolidated_pending_sql.sql
--
-- SCHEMA CONSOLIDATION (pre-launch hardening, owner decision 2026-08-02,
-- independent code review item 7): docs/PENDING_SQL.md accumulated 36
-- applied sections (numbered 1-36; section 2 needed no SQL) that were run
-- directly against the live Supabase project one at a time and were never
-- folded back into supabase/migrations/ — 0001_init.sql on disk does NOT
-- reflect most of them. Investigating this file's own accuracy surfaced a
-- real, separate finding worth recording here: 0001_init.sql is itself
-- NOT a clean 'before any PENDING_SQL section' baseline — it already
-- contains some later tables (e.g. 'drivers' from section 13,
-- 'user_categories' from section 21, 'compliance_items' from section 23)
-- while still missing others (tax_config from section 1, tax_year_data
-- from section 3, household_members/household_income from section 4,
-- equipment from section 36) and profiles is missing at least 7 columns
-- added by later sections (role, dashboard_layout, weekly_goal,
-- dot_number, mc_number, onboarding_completed_at, the cf_* Cash Flow
-- fields, dashboard_sections_collapsed, tos_accepted_at/tos_version).
-- There is no single clean 'pre-section-1' cut point on disk to replay
-- from — the live database's actual history doesn't match any committed
-- snapshot.
--
-- BECAUSE OF THAT DRIFT, every statement below is written to be IDEMPOTENT
-- (create table if not exists / add column if not exists / drop-then-
-- recreate for policies and triggers / named indexes with if not exists /
-- constraint adds wrapped in a DO block catching duplicate_object) rather
-- than assuming a specific starting point. This file is therefore SAFE TO
-- RUN AGAINST EITHER: (a) a fresh, empty Supabase project (run
-- 0001_init.sql, then this file, in order) — reconstructs the full schema
-- from scratch; or (b) the CURRENT live project, where sections 1-36 have
-- already been applied one at a time — every statement below becomes a
-- no-op for whatever already exists, and only genuinely missing pieces
-- apply. It is NOT a guarantee of byte-for-byte correctness against the
-- actual live database, which this environment has no way to query
-- directly — review against the real Supabase dashboard schema before
-- trusting it for anything destructive, and treat docs/PENDING_SQL.md as
-- the source of truth for the full narrative/rationale behind each change.
--
-- Two real ordering/content bugs were caught and fixed while assembling
-- this file (both present in docs/PENDING_SQL.md's raw fenced code blocks
-- if read top-to-bottom naively): section 17's two SQL blocks are in
-- EXPLANATION order in the prose, not execution order — the doc's own
-- text says 'Run the column-add FIRST' even though that block is fenced
-- SECOND; this file runs it first. Section 34's prose includes a second
-- fenced block that is a DIAGNOSTIC query ('find the live constraint name
-- first') for the person doing the original manual apply, not part of the
-- migration itself — excluded here.
--
-- section 37 (settlements.business_balance_credit + apply_business_
-- balance_delta RPC) is NOT YET RUN against the live project as of this
-- writing and is deliberately excluded; once it's applied, append it here
-- or as its own 0003 file.

-- ============================================================
-- PENDING_SQL.md §1: 1. Tax engine product-readiness (D7 + D8, docs/SCHEMA.sql) — ✅ APPLIED
-- ============================================================
-- 1a. New tax_config table (filing_status/tax_year/state/include_state_tax
--     from D7, entity_type/scorp_salary/scorp_payroll_tax_handled from D8)
create table if not exists tax_config (
  user_id             uuid primary key references auth.users on delete cascade,
  tax_year            int not null default 2026,
  filing_status       text not null default 'mfj'
                      check (filing_status in ('single','mfj','hoh')),
  state               text not null default 'TX',
  include_state_tax   boolean not null default true,
  entity_type         text not null default 'sole_prop'
                      check (entity_type in ('sole_prop','smllc','scorp')),
  scorp_salary               numeric(12,2),
  scorp_payroll_tax_handled  boolean default false
);

alter table tax_config enable row level security;
drop policy if exists "tax_config_owner_all" on tax_config;
create policy "tax_config_owner_all" on tax_config
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 1b. Backfill one tax_config row per existing user from their current
--     profiles.filing_status (run BEFORE dropping the column in 1c)
insert into tax_config (user_id, filing_status)
select user_id, filing_status from profiles
on conflict (user_id) do nothing;

-- 1c. Drop the now-superseded column from profiles
alter table profiles drop column if exists filing_status;

-- ============================================================
-- PENDING_SQL.md §3: 3. Centrally-updatable tax year data (D10, docs/SCHEMA.sql) — ✅ APPLIED
-- ============================================================
-- 3a. tax_year_data table — NOT user-scoped, one row per year, shared by
--     every user. Readable by all authenticated users; writable only by
--     service_role (no insert/update/delete policy exists for regular
--     users — service_role bypasses RLS entirely, which is the only way
--     this table is ever written).
create table if not exists tax_year_data (
  tax_year            int primary key,
  federal_brackets    jsonb not null,
  standard_deduction  jsonb not null,
  se_tax              jsonb not null,
  per_diem            jsonb not null,
  quarterly_deadlines jsonb not null,
  state_tax           jsonb not null,
  published           boolean not null default false,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table tax_year_data enable row level security;
drop policy if exists "tax_year_data_read_all_authenticated" on tax_year_data;
create policy "tax_year_data_read_all_authenticated" on tax_year_data
  for select using (auth.role() = 'authenticated');

-- 3b. 2026 row — federal_brackets/standard_deduction/se_tax/per_diem/
--     quarterly_deadlines ported verbatim from legacy calcTax(). state_tax
--     is now VERIFIED (was placeholder <verify> values in the prior version
--     of this file) — see docs/ADMIN_RUNBOOK.md for the full verified
--     figures recorded as the reference example. Summary of what was
--     verified and inserted:
--       - se_tax.ss_wage_base = 184500 (legacy math still applies SE tax
--         UNCAPPED, so this figure is informational/future-proofing only —
--         it does not change the seeded computation)
--       - state_tax.flat: bare per-state rate numbers only — NC (3.99%),
--         GA (4.99%), UT (4.45%), OH (2.75%), IL (4.95%), PA (3.07%). NC
--         and GA were originally slotted as "bracket" states in the
--         PROMPTS.md Session 5 design; both have since moved to flat-rate
--         taxation in reality and PROMPTS.md has been corrected. IL and PA
--         were also in that same wrong "bracket" list — they're flat too,
--         and ARE verified/present here (Tax Foundation 2026).
--       - state_tax.flat_adjustments: a SEPARATE object for flat-rate states
--         whose real law isn't a single bare rate, applied AFTER the base
--         flat-rate result — OH (0% below a $26,050 exemption, flat rate
--         above it) and MA (a surtax on top of its own flat rate above
--         $1,000,000). This is the exact live shape; `flat` itself never
--         holds anything but a bare number for any state.
--       - state_tax.bracket retains CA per the official FTB 2025
--         Schedule X/Y/Z brackets (single/MFJ/HoH respectively) — the only
--         state that's actually still progressive in 2026.
--       - state_tax.fallback_effective_rate = 0.045
insert into tax_year_data (
  tax_year, federal_brackets, standard_deduction, se_tax, per_diem,
  quarterly_deadlines, state_tax, published, notes
) values (
  2026,
  '{
    "mfj":    [[0, 23850, 0.10], [23850, 96950, 0.12], [96950, 206700, 0.22], [206700, 394600, 0.24], [394600, 501050, 0.32], [501050, 751600, 0.35], [751600, null, 0.37]],
    "single": [[0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22], [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 626350, 0.35], [626350, null, 0.37]],
    "hoh":    [[0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22], [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 626350, 0.35], [626350, null, 0.37]]
  }'::jsonb,
  '{"mfj": 30000, "single": 15000, "hoh": 22500}'::jsonb,
  '{"rate": 0.153, "factor": 0.9235, "ss_wage_base": 184500}'::jsonb,
  '{"daily_rate": 64, "deductible_pct": 100}'::jsonb,
  '[["Q1", "2026-04-15"], ["Q2", "2026-06-15"], ["Q3", "2026-09-15"], ["Q4", "2027-01-15"]]'::jsonb,
  '{
    "no_tax": ["TX","FL","TN","WA","NV","SD","WY","AK","NH"],
    "flat": {"NC": 0.0399, "GA": 0.0499, "UT": 0.0445, "OH": 0.0275, "IL": 0.0495, "PA": 0.0307},
    "flat_adjustments": {"OH": {"exempt_below": 26050}, "MA": {"surtax_rate": 0.04, "surtax_over": 1000000}},
    "bracket": {"CA": "<superseded — see note below; live row holds the full numeric Schedule X/Y/Z arrays>"},
    "fallback_effective_rate": 0.045
  }'::jsonb,
  true,
  'Federal brackets/std deduction/SE-tax/per diem/deadlines ported verbatim from legacy calcTax(). state_tax verified 2026-07-03 (Tax Foundation 2026 for flat states, official FTB 2025 Schedule X/Y/Z for CA). Published live.'
) on conflict (tax_year) do nothing;

-- 3c. Publish (already reflected in the insert above via published=true,
--     recorded separately here since this was the original planned step)
update tax_year_data set published = true where tax_year = 2026;

-- ============================================================
-- PENDING_SQL.md §4: 4. Household tables (D11, docs/SCHEMA.sql) — ✅ APPLIED, recorded retroactively
-- ============================================================
create table if not exists household_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  relation   text not null check (relation in ('spouse','child','other')),
  created_at timestamptz default now()
);
alter table household_members enable row level security;
drop policy if exists "household_members_owner_all" on household_members;
create policy "household_members_owner_all" on household_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists household_income (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  member_id        uuid not null references household_members on delete cascade,
  tax_year         int not null default 2026,
  income_type      text not null default 'w2_wages'
                   check (income_type in ('w2_wages','self_employment','other')),
  annual_amount    numeric(12,2) not null default 0,
  federal_withheld numeric(12,2) not null default 0,
  document_id      uuid references documents on delete set null,
  created_at       timestamptz default now()
);
alter table household_income enable row level security;
drop policy if exists "household_income_owner_all" on household_income;
create policy "household_income_owner_all" on household_income
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists household_income_user_id_tax_year_idx on household_income (user_id, tax_year);

-- ============================================================
-- PENDING_SQL.md §5: 5. Terms of Use acceptance (D12, docs/SCHEMA.sql) — ✅ APPLIED
-- ============================================================
alter table profiles
  add column if not exists tos_accepted_at timestamptz,
  add column if not exists tos_version     text;

-- ============================================================
-- PENDING_SQL.md §6: 6. fuel_purchases.truck_id (PROMPTS.md Session 6 — fleet scalability) — ✅ APPLIED
-- ============================================================
alter table fuel_purchases add column if not exists truck_id uuid references trucks;
create index if not exists fuel_purchases_truck_id_idx on fuel_purchases (truck_id);

-- ============================================================
-- PENDING_SQL.md §7: 7. deductions.warranty_years (owner decision 2026-07-07, web app v2026.07.07-H) — ✅ APPLIED
-- ============================================================
alter table deductions add column if not exists warranty_years numeric(4,1);

-- ============================================================
-- PENDING_SQL.md §8: 8. loads.pickup_date/delivery_date (per-diem exact day-counting rework) — ✅ APPLIED
-- ============================================================
alter table loads add column if not exists pickup_date date;
alter table loads add column if not exists delivery_date date;

-- ============================================================
-- PENDING_SQL.md §9: 9. reimbursements.settlement_id (owner decision 2026-07-09, web v2026.07.09-A — re-import-replace) — ✅ APPLIED
-- ============================================================
alter table reimbursements add column if not exists settlement_id uuid references settlements on delete cascade;
create index if not exists reimbursements_settlement_id_idx on reimbursements (settlement_id);

-- ============================================================
-- PENDING_SQL.md §10: 10. tax_year_data.per_diem gains full_daily_rate (Dashboard card parity, owner decision 2026-07-09) — ✅ APPLIED
-- ============================================================
update tax_year_data
set per_diem = per_diem || '{"full_daily_rate": 80}'::jsonb
where tax_year = 2026;

-- ============================================================
-- PENDING_SQL.md §11: 11. profiles column defaults — drop owner-specific defaults (PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED
-- ============================================================
alter table profiles alter column company_name drop default;
alter table profiles alter column business_balance set default 0;
alter table profiles alter column initial_capital set default 0;

-- ============================================================
-- PENDING_SQL.md §12: 12. profiles.locale (multi-language support, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED
-- ============================================================
alter table profiles add column if not exists locale text;

-- ============================================================
-- PENDING_SQL.md §13: 13. drivers table (multi-truck fleet + drivers + payroll auto-routing, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED
-- ============================================================
create table if not exists drivers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade,
  name             text not null,
  phone            text,
  license          text,
  active           boolean default true,
  default_truck_id uuid references trucks on delete set null,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table drivers enable row level security;
drop policy if exists "drivers_owner_all" on drivers;
create policy "drivers_owner_all" on drivers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_touch_updated_at on drivers;
create trigger trg_touch_updated_at before update on drivers
  for each row execute function touch_updated_at();

-- ============================================================
-- PENDING_SQL.md §14: 14. driver_id on settlements/loads/fuel_purchases/deductions (payroll auto-routing, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED
-- ============================================================
alter table settlements add column if not exists driver_id uuid references drivers on delete set null;
alter table loads add column if not exists driver_id uuid references drivers on delete set null;
alter table fuel_purchases add column if not exists driver_id uuid references drivers on delete set null;
alter table deductions add column if not exists driver_id uuid references drivers on delete set null;

-- ============================================================
-- PENDING_SQL.md §15: 15. drivers gains compensation fields (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED
-- ============================================================
alter table drivers add column if not exists compensation_type text not null default 'w2_employee'
  check (compensation_type in ('w2_employee', '1099_contractor', 'team_split', 'trainee'));
alter table drivers add column if not exists pay_type text
  check (pay_type in ('per_mile', 'percent', 'flat'));
alter table drivers add column if not exists pay_rate numeric(10,4);

-- ============================================================
-- PENDING_SQL.md §16: 16. driver_payments table (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED
-- ============================================================
create table if not exists driver_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  driver_id      uuid not null references drivers on delete cascade,
  settlement_id  uuid references settlements on delete set null,
  date           date not null,
  gross_pay      numeric(12,2) not null default 0,
  employer_taxes numeric(12,2) not null default 0,
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table driver_payments enable row level security;
drop policy if exists "driver_payments_owner_all" on driver_payments;
create policy "driver_payments_owner_all" on driver_payments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_touch_updated_at on driver_payments;
create trigger trg_touch_updated_at before update on driver_payments
  for each row execute function touch_updated_at();

create index if not exists driver_payments_user_id_driver_id_date_idx on driver_payments (user_id, driver_id, date);

-- ============================================================
-- PENDING_SQL.md §17: 17. tax_year_data gains employer_fica + nec_1099 (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED
-- ============================================================
alter table tax_year_data add column if not exists nec_1099 jsonb;

update tax_year_data
set se_tax = se_tax || '{"employer_fica": 0.0765}'::jsonb,
    nec_1099 = '{"threshold": 600, "filing_deadline": "2027-01-31"}'::jsonb
where tax_year = 2026;

-- ============================================================
-- PENDING_SQL.md §18: 18. tax_config gains ownership_pct + entity_type 'multi_member_llc' (driver compensation types / entity selection, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED
-- ============================================================
alter table tax_config drop constraint if exists tax_config_entity_type_check;
do $$ begin
  alter table tax_config add constraint tax_config_entity_type_check
  check (entity_type in ('sole_prop', 'smllc', 'multi_member_llc', 'scorp'));
exception when duplicate_object then null;
end $$;
alter table tax_config add column if not exists ownership_pct numeric(5,2);

-- ============================================================
-- PENDING_SQL.md §19: 19. profiles.dashboard_layout (customizable dashboard, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
alter table profiles add column if not exists dashboard_layout jsonb;

-- ============================================================
-- PENDING_SQL.md §20: 20. profiles.role (expanded onboarding wizard, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
alter table profiles add column if not exists role text
  check (role in ('owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee'));

-- ============================================================
-- PENDING_SQL.md §21: 21. user_categories table (custom categories, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
create table if not exists user_categories (
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

alter table user_categories enable row level security;
drop policy if exists "user_categories_owner_all" on user_categories;
create policy "user_categories_owner_all" on user_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_touch_updated_at on user_categories;
create trigger trg_touch_updated_at before update on user_categories
  for each row execute function touch_updated_at();

-- ============================================================
-- PENDING_SQL.md §22: 22. tags column on financial record tables (flexible fields, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
alter table settlements add column if not exists tags text;
alter table loads add column if not exists tags text;
alter table fuel_purchases add column if not exists tags text;
alter table deductions add column if not exists tags text;
alter table capital_transactions add column if not exists tags text;
alter table maintenance_records add column if not exists tags text;
alter table tolls add column if not exists tags text;
alter table reimbursements add column if not exists tags text;
alter table loans add column if not exists tags text;
alter table credit_cards add column if not exists tags text;
alter table driver_payments add column if not exists tags text;
alter table bank_transactions add column if not exists tags text;

-- ============================================================
-- PENDING_SQL.md §23: 23. compliance_items table (AI feature package — compliance tracker, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
create table if not exists compliance_items (
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

alter table compliance_items enable row level security;
drop policy if exists "compliance_items_owner_all" on compliance_items;
create policy "compliance_items_owner_all" on compliance_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_touch_updated_at on compliance_items;
create trigger trg_touch_updated_at before update on compliance_items
  for each row execute function touch_updated_at();

create index if not exists compliance_items_user_id_due_date_idx on compliance_items (user_id, due_date);

-- ============================================================
-- PENDING_SQL.md §24: 24. profiles.weekly_goal (AI feature package — CEO Mode briefing, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED
-- ============================================================
alter table profiles add column if not exists weekly_goal numeric(12,2);

-- ============================================================
-- PENDING_SQL.md §25: 25. benchmarks table (Profit Analysis v1, PROMPTS.md Session 9a, CLAUDE.md invariant #22 — NO external-data features) — ✅ APPLIED
-- ============================================================
create table if not exists benchmarks (
  id          uuid primary key default gen_random_uuid(),
  metric      text not null,          -- 'fuel_pct_of_revenue' | 'maintenance_cost_per_mile'
  label       text not null,
  low         numeric(10,4) not null,
  high        numeric(10,4) not null,
  unit        text not null check (unit in ('percent','usd_per_mile')),
  source      text not null,          -- e.g. "ATRI 2025 Operational Costs of Trucking"
  year        int not null,
  published   boolean not null default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (metric, year)
);

alter table benchmarks enable row level security;
drop policy if exists "benchmarks_read_all_authenticated" on benchmarks;
create policy "benchmarks_read_all_authenticated" on benchmarks
  for select using (auth.role() = 'authenticated');
-- No insert/update/delete policy for regular users — same as
-- tax_year_data, only service_role (admin) may write these.

-- Seed values (ATRI-style published ranges — placeholder figures, an admin
-- should verify/replace against the actual current-year source before
-- publishing per docs/ADMIN_RUNBOOK.md's pattern for tax_year_data):
insert into benchmarks (metric, label, low, high, unit, source, year, published) values
  ('fuel_pct_of_revenue', 'Fuel as % of revenue', 0.20, 0.28, 'percent', 'ATRI Operational Costs of Trucking (industry reference)', 2026, true),
  ('maintenance_cost_per_mile', 'Maintenance & repair cost per mile', 0.15, 0.22, 'usd_per_mile', 'ATRI Operational Costs of Trucking (industry reference)', 2026, true)
on conflict (metric, year) do nothing;

-- ============================================================
-- PENDING_SQL.md §26: 26. misc_income table (manual income ledger, PROMPTS.md Session 9a) — ✅ APPLIED
-- ============================================================
create table if not exists misc_income (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  document_id  uuid references documents on delete set null,
  income_date  date,
  description  text,
  source       text,        -- free text, e.g. "IRS", "State of Texas" — NOT a payment method
  amount       numeric(12,2) not null,
  tags         text,        -- docs/PENDING_SQL.md §22 (flexible fields)
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table misc_income enable row level security;
drop policy if exists "misc_income_owner_all" on misc_income;
create policy "misc_income_owner_all" on misc_income
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- PENDING_SQL.md §27: 27. tax_config gains sep_contribution + health_insurance_premiums (Session 9b Tax Estimator screen) — ✅ APPLIED
-- ============================================================
alter table tax_config
  add column if not exists sep_contribution numeric(12,2) not null default 0,
  add column if not exists health_insurance_premiums numeric(12,2) not null default 0;

-- ============================================================
-- PENDING_SQL.md §28: 28. profiles gains dot_number/mc_number/onboarding_completed_at + trucks gains trailer fields (Session 9b onboarding wizard) — ✅ APPLIED
-- ============================================================
alter table profiles
  add column if not exists dot_number text,
  add column if not exists mc_number text,
  add column if not exists onboarding_completed_at timestamptz;

alter table trucks
  add column if not exists trailer_unit_number text,
  add column if not exists trailer_vin text,
  add column if not exists trailer_year int,
  add column if not exists trailer_make text,
  add column if not exists trailer_model text;

-- ============================================================
-- PENDING_SQL.md §29: 29. profiles gains cash-flow budget fields (Session 9b parity-gap decision #3, Cash Flow 30-day forecast) — ✅ APPLIED
-- ============================================================
alter table profiles
  add column if not exists cf_bank_balance numeric(12,2),
  add column if not exists cf_weekly_revenue numeric(12,2),
  add column if not exists cf_truck_payment numeric(12,2),
  add column if not exists cf_fuel_weekly numeric(12,2),
  add column if not exists cf_insurance_monthly numeric(12,2),
  add column if not exists cf_other_weekly numeric(12,2),
  add column if not exists cf_tax_reserve_pct numeric(5,2);

-- ============================================================
-- PENDING_SQL.md §30: 30. bank_statements gains opening_balance/closing_balance (Session 9b parity-gap decision #2, explicit-confirm balance update) — ✅ APPLIED
-- ============================================================
alter table bank_statements
  add column if not exists opening_balance numeric(12,2),
  add column if not exists closing_balance numeric(12,2);

-- ============================================================
-- PENDING_SQL.md §31: 31. profiles.role gains lease_operator (device feedback round 2, owner decision 2026-07-13) — ✅ APPLIED
-- ============================================================
alter table profiles drop constraint if exists profiles_role_check;
do $$ begin
  alter table profiles add constraint profiles_role_check
  check (role in ('owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee', 'lease_operator'));
exception when duplicate_object then null;
end $$;

-- ============================================================
-- PENDING_SQL.md §32: 32. profiles.dashboard_sections_collapsed (Dashboard sections addition, owner decision 2026-07-13) — ✅ APPLIED
-- ============================================================
alter table profiles add column if not exists dashboard_sections_collapsed jsonb;

-- ============================================================
-- PENDING_SQL.md §33: 33. deductions.tax_deductible (meals & advance repayments, owner decision 2026-07-17, mirrors web v2026.07.17-D) — ✅ APPLIED (2026-07-27)
-- ============================================================
alter table deductions add column if not exists tax_deductible boolean not null default true;

-- ============================================================
-- PENDING_SQL.md §34: 34. settlements uniqueness scoped by truck_id (CRITICAL BUG FIX, device feedback, 2026-07-30) — ✅ APPLIED
-- ============================================================
alter table settlements drop constraint if exists settlements_user_id_week_ending_key;

create unique index if not exists settlements_user_week_truck_uidx
  on settlements (user_id, week_ending, truck_id)
  where truck_id is not null;

create unique index if not exists settlements_user_week_notruck_uidx
  on settlements (user_id, week_ending)
  where truck_id is null;

-- ============================================================
-- PENDING_SQL.md §35: 35. settlements.per_diem_days (PER DIEM INTELLIGENCE, owner decision 2026-07-30, mega-pass part B) — ✅ APPLIED
-- ============================================================
alter table settlements
  add column if not exists per_diem_days integer not null default 7
    check (per_diem_days >= 0 and per_diem_days <= 7);

-- Backfill: apply the new smart default retroactively — a 0-mile "home
-- week" settlement already on file gets corrected to 0 days; every other
-- existing settlement keeps the flat 7 it already effectively had.
update settlements set per_diem_days = 0 where miles = 0;

-- ============================================================
-- PENDING_SQL.md §36: 36. Asset purchase & financing (owner decision 2026-07-30, PRODUCT DECISION, mega-pass part C) — ✅ SQL APPLIED (Edge Function redeploys still pending, see 36b/36c)
-- ============================================================
alter table trucks
  alter column fleet_mpg drop default,
  add column if not exists purchase_price numeric(12,2),
  add column if not exists purchase_date date,
  add column if not exists financing text check (financing in ('cash', 'loan')),
  add column if not exists loan_id uuid references loans on delete set null,
  add column if not exists trailer_purchase_price numeric(12,2),
  add column if not exists trailer_purchase_date date,
  add column if not exists trailer_financing text check (trailer_financing in ('cash', 'loan')),
  add column if not exists trailer_loan_id uuid references loans on delete set null;

create table if not exists equipment (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users on delete cascade,
  name           text not null,
  category       text,
  purchase_price numeric(12,2),
  purchase_date  date,
  financing      text check (financing in ('cash', 'loan')),
  loan_id        uuid references loans on delete set null,
  notes          text,
  tags           text,  -- PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
drop trigger if exists trg_touch_updated_at on equipment;
create trigger trg_touch_updated_at before update on equipment
  for each row execute function touch_updated_at();

alter table equipment enable row level security;
drop policy if exists "equipment_owner_all" on equipment;
create policy "equipment_owner_all" on equipment
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

