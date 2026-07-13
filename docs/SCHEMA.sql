-- ============================================================================
-- Bozkurt Fleet OS — Draft Postgres Schema (for review BEFORE Session 1)
-- Derived 1:1 from the legacy localStorage model in legacy/index.html
-- Every table: RLS enabled, user_id = auth.uid() policies (added in migration)
-- ============================================================================

-- ---------- Identity & profile ----------
-- auth.users comes from Supabase Auth. profiles extends it.
create table profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  company_name text,                         -- blank until set in onboarding/Settings
  owner_name   text,
  locale       text,                         -- app UI language override (en/es/ru/ar/tr); null = follow device
  home_state   text default 'TX',
  business_balance numeric(12,2) default 0,  -- was gw_bizbal; 0 until owner sets a starting balance
  initial_capital  numeric(12,2) default 0,  -- was CAPITAL.contribution; 0 until owner sets a starting balance
  settings     jsonb default '{}',           -- autosave, view_only, etc.
  -- Terms of Use acceptance (added 2026-07-04, D12) — set on first-launch
  -- acceptance and re-set whenever tos_version changes (PROMPTS.md Session 3).
  -- NULL means "never accepted" and must block data entry.
  tos_accepted_at timestamptz,
  tos_version     text,
  -- Customizable dashboard (added retroactively, PENDING_SQL.md §19, owner
  -- decision 2026-07-10) — null until Session 9a's drag-to-reorder/show-
  -- hide/rename UI ships; see that section for the documented (unenforced)
  -- shape.
  dashboard_layout jsonb,
  -- Collapsible Dashboard sections (added retroactively, PENDING_SQL.md
  -- §32, owner decision 2026-07-13) — Record<SectionId, boolean>, true =
  -- collapsed; null/missing key both mean "expanded" (never assume
  -- collapsed just because this column is new for an existing user).
  dashboard_sections_collapsed jsonb,
  -- Expanded onboarding wizard (added retroactively, PENDING_SQL.md §20,
  -- owner decision 2026-07-10) — null/'owner_operator' both mean "full
  -- owner-operator experience" until Session 9b wires role-based module
  -- hiding for 'company_driver_w2'.
  -- lease_operator added retroactively (PENDING_SQL.md §31, device
  -- feedback round 2, owner decision 2026-07-13) — treated identically to
  -- owner_operator for every module/tax code path today.
  role text check (role in ('owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee', 'lease_operator')),
  -- CEO Mode briefing (added retroactively, PENDING_SQL.md §24, owner
  -- decision 2026-07-10 — AI feature package) — null until Session 9b's
  -- daily/weekly briefing ships; null means "no goal set", never treated
  -- as a goal of $0.
  weekly_goal numeric(12,2),
  -- dot_number/mc_number/onboarding_completed_at (added retroactively,
  -- PENDING_SQL.md §28, Session 9b onboarding wizard) — DOT/MC are
  -- optional identity fields; onboarding_completed_at null means the
  -- wizard has never been completed/skipped (same "null = never done"
  -- pattern as tos_accepted_at), set once and never reset.
  dot_number   text,
  mc_number    text,
  onboarding_completed_at timestamptz,
  -- Cash Flow 30-day forecast budget inputs (added retroactively,
  -- PENDING_SQL.md §29, Session 9b parity-gap decision #3) — legacy's
  -- own calcCF() form fields have no persistence either (recomputed on
  -- every oninput); these are nullable so the app can supply legacy's
  -- own placeholder defaults (1145/1800/0/500/25) client-side without a
  -- server-side default masquerading as a real user-entered value.
  cf_bank_balance       numeric(12,2),
  cf_weekly_revenue     numeric(12,2),
  cf_truck_payment      numeric(12,2),
  cf_fuel_weekly        numeric(12,2),
  cf_insurance_monthly  numeric(12,2),
  cf_other_weekly       numeric(12,2),
  cf_tax_reserve_pct    numeric(5,2),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- Tax config (NEW, owner decision 2026-07-03) ----------
-- filing_status moves here from profiles (see docs/DATA_MODEL.md) — the tax
-- engine is product-ready, not single-user: tax_year picks which row of
-- tax_year_data (below) this user's estimate is computed against, and the
-- state/include_state_tax pair drives that row's state_tax jsonb (see
-- PROMPTS.md Session 5) instead of assuming TX/no-state-tax for everyone.
-- entity_type (added 2026-07-03, D8; 'multi_member_llc' added retroactively
-- 2026-07-10, PENDING_SQL.md §18): 'sole_prop' and 'smllc' share the exact
-- legacy math (Schedule C net-pay model, 15.3% SE tax on full net profit,
-- tax-free draws up to basis) — smllc is a UI label only, never a branch in
-- the tax math. 'scorp' branches the model: SE tax applies only to
-- scorp_salary (via payroll, outside this app), remaining profit is
-- distributions with NO SE tax; federal income tax brackets still apply the
-- same way to total income. scorp_payroll_tax_handled is a plain
-- acknowledgement flag ("yes, my payroll provider files 941/940s") shown
-- next to the required "this app estimates, not files — get a CPA/payroll
-- provider" notice; when false the engine estimates the employer-side FICA
-- cost of scorp_salary itself (calcTaxEstimate.ts employerPayrollTax), when
-- true it trusts the provider's own accounting and does not double-count.
-- 'multi_member_llc' scopes the estimate to just this member's K-1 share —
-- ownership_pct is only meaningful for this entity_type (see
-- calcTaxEstimate.ts ownerShareOfProfit); null/ignored otherwise.
create table tax_config (
  user_id             uuid primary key references auth.users on delete cascade,
  tax_year            int not null default 2026,
  filing_status        text not null default 'mfj'
                       check (filing_status in ('single','mfj','hoh')),
  state                text not null default 'TX',
  include_state_tax    boolean not null default true,
  entity_type          text not null default 'sole_prop'
                       check (entity_type in ('sole_prop','smllc','multi_member_llc','scorp')),
  scorp_salary                numeric(12,2),        -- only meaningful when entity_type='scorp'
  scorp_payroll_tax_handled   boolean default false, -- owner-attested, not verified
  ownership_pct               numeric(5,2),          -- only meaningful when entity_type='multi_member_llc'
  -- sep_contribution/health_insurance_premiums (added retroactively,
  -- PENDING_SQL.md §27, Session 9b Tax Estimator screen) — feed
  -- calcTaxEstimate.ts's sepContribution/healthInsurancePremiums inputs,
  -- which existed since Session 5 but had no persisted value until now.
  sep_contribution             numeric(12,2) not null default 0,
  health_insurance_premiums    numeric(12,2) not null default 0
);

-- ---------- Tax year data (NEW, owner decision 2026-07-03, D10) ----------
-- Server-side, centrally-updatable source of truth for every tax constant —
-- REPLACES the earlier "app/src/tax/brackets/{year}.ts bundled in the app"
-- approach (see CLAUDE.md invariant: no tax constant may live in app code).
-- NOT user-scoped: one row per tax year, shared by every user. RLS is
-- readable by all authenticated users; writable ONLY by service_role (an
-- admin seeds/updates it via the Supabase SQL editor — see
-- docs/ADMIN_RUNBOOK.md). The app fetches the current year's row on launch,
-- caches it locally for offline use (PROMPTS.md Session 4), and falls back
-- to the latest published row if the current year is missing/unpublished.
create table tax_year_data (
  tax_year            int primary key,
  federal_brackets    jsonb not null,   -- {mfj:[[lo,hi,rate],...], single:[...], hoh:[...]}
  standard_deduction  jsonb not null,   -- {mfj:30000, single:15000, hoh:22500}
  se_tax              jsonb not null,   -- {rate:0.153, factor:0.9235, ss_wage_base:<verify each year>, employer_fica:0.0765 (added 2026-07-10, PENDING_SQL.md §17)}
  per_diem            jsonb not null,   -- {daily_rate:64, deductible_pct:100}
  quarterly_deadlines jsonb not null,   -- [["Q1","2026-04-15"],["Q2","2026-06-15"],...]
  state_tax           jsonb not null,   -- {no_tax:[...], flat:{...}, bracket:{...}, fallback_effective_rate:...}
  nec_1099            jsonb,            -- {threshold:600, filing_deadline:"2027-01-31"} — added retroactively, PENDING_SQL.md §17
  published           boolean not null default false,  -- app ignores unpublished rows (see fallback above)
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
-- 2026 seed values (verbatim from legacy calcTax): federal_brackets.mfj/single/hoh
-- use legacy's two bracket arrays (single === hoh, matching legacy's own
-- simplification — do not "fix" that here either); standard_deduction
-- {mfj:30000, single:15000, hoh:22500}; se_tax {rate:0.153, factor:0.9235} —
-- legacy applies this UNCAPPED (no ss_wage_base cutoff), so ss_wage_base is
-- carried in the schema for future years but must NOT change year-1 math
-- unless the owner explicitly asks for the cap to be applied;
-- per_diem {daily_rate:64, deductible_pct:100}; quarterly_deadlines the four
-- 2026 IRS dates already in legacy. LIVE STATUS (2026-07-03): the 2026 row
-- has been run, state_tax verified (SS wage base 184500; flat states incl.
-- NC 3.99%, GA 4.99%, UT 4.45%, OH 2.75%/$26,050 exemption; CA per official
-- FTB 2025 Schedule X/Y/Z; fallback_effective_rate 0.045), and published =
-- true. See docs/ADMIN_RUNBOOK.md for the verified figures as the reference
-- example, and docs/PENDING_SQL.md for the applied INSERT.

-- ---------- Trucks (multi-truck ready; you have 1 today, "2. asset" gelince hazır) ----------
create table trucks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  unit_number  text,                          -- '830157'
  vin          text,
  year int, make text, model text,            -- 2023 International LT
  engine       text,                          -- 'A26 12.4L'
  current_odometer int,
  fleet_mpg    numeric(4,1) default 8.9,
  apu_hours    int,                           -- TriPac Evolution
  is_active    boolean default true,
  -- Trailer info (added retroactively, PENDING_SQL.md §28, Session 9b
  -- onboarding wizard step 6) — no dedicated trailers table; folds into
  -- the truck's own row, 1:1, same shape as the tractor fields above.
  trailer_unit_number text,
  trailer_vin         text,
  trailer_year         int,
  trailer_make         text,
  trailer_model        text,
  created_at   timestamptz default now()
);

-- ---------- Drivers (NEW, owner decision 2026-07-09 — multi-truck fleet +
-- drivers + payroll auto-routing, PRODUCT DECISION). A driver is optional:
-- an account with zero driver rows behaves exactly as before (settlements
-- just have a null driver_id). default_truck_id is a soft hint for future
-- UI convenience (e.g. pre-selecting a truck when adding a driver's next
-- settlement) — never required, never enforced by a trigger.
-- compensation_type/pay_type/pay_rate added retroactively, PENDING_SQL.md
-- §15 (driver compensation types, owner decision 2026-07-10) — pay_rate is
-- informational display only, the tax engine never derives an amount from
-- it, only from actual recorded driver_payments rows (see below).
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
  created_at       timestamptz default now()
);

-- ---------- Documents (archive + duplicate detection; was DB.docs) ----------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  filename     text,
  doc_type     text,                          -- settlement|fuel|maintenance|store|toll|loan|bankstmt|checking|other
  doc_date     date,                          -- the document's OWN date
  amount       numeric(12,2),
  storage_path text,                          -- Supabase Storage: {month}/Payroll/Week-2/...
  parsed_json  jsonb,                         -- D3: full raw AI extraction (audit trail, re-processable)
  imported_at  timestamptz default now()
);
create index on documents (user_id, doc_type, doc_date, amount);  -- duplicate check

-- ---------- Compliance items (NEW, owner decision 2026-07-10 — AI feature
-- package, compliance tracker, PRODUCT DECISION). Optional/additive —
-- zero rows means an empty tracker, not an error state. type covers all 8
-- categories named in the spec; only 5 (medical_card/annual_inspection/
-- irp_registration/hvut_2290/insurance_policy) can be auto-populated by
-- ai-import's matching docTypes (app/src/import/mapExtraction.ts
-- mapCompliance()) — ifta_filing/cdl/drug_consortium are manual-entry
-- only for now. "auto-creates or updates the matching item" matches by
-- (user_id, type) only, NOT per-truck (v1 simplification — see
-- PENDING_SQL.md §23). recurrence is nullable, never auto-derived by the
-- AI (a document's own dates don't reliably state its own renewal
-- cadence) — set/edited on the Session 9b screen.
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
create index on compliance_items (user_id, due_date);

-- ---------- Household (NEW, owner decision 2026-07-03, D11) ----------
-- Supports the household side of the tax estimator (legacy calcTax's
-- "Spouse Income" field) in a multi-tenant-ready way, and pairs with the
-- ai-import 'w2' docType (supabase/functions/ai-import/index.ts): an
-- imported W-2 can be attached to a household_income row via document_id.
-- household_members holds each person in the filer's household whose
-- income feeds the estimate (today: mainly 'spouse', for MFJ households —
-- 'child'/'other' are allowed for future dependent-income edge cases but
-- aren't used by the estimator yet). household_income is one row per
-- member per tax_year per income source; income_type defaults to
-- 'w2_wages' (what the w2 docType produces) with 'self_employment'/'other'
-- for manual entries the estimator doesn't yet have a dedicated import for.
create table household_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  relation   text not null check (relation in ('spouse','child','other')),
  created_at timestamptz default now()
);

create table household_income (
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
create index on household_income (user_id, tax_year);

-- ---------- Settlements (was DB.sett) ----------
create table settlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  truck_id     uuid references trucks,
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14 (payroll auto-routing)
  document_id  uuid references documents,
  week_ending  date not null,
  gross        numeric(12,2) not null default 0,
  net          numeric(12,2) not null default 0,
  miles        int default 0,
  tags         text,  -- added retroactively, PENDING_SQL.md §22 (flexible fields, owner decision
                       -- 2026-07-10) — the user's own ad-hoc labeling, separate from any AI/system
                       -- description; same rationale on every other table below that gets this column.
  created_at   timestamptz default now(),
  unique (user_id, week_ending)               -- one settlement per week
);

-- ---------- Driver payments (NEW, owner decision 2026-07-10 — driver
-- compensation types). What the owner actually paid a driver — the tax
-- engine's sole source for driver payroll expense (never derived from
-- drivers.pay_rate). on delete cascade from drivers (unlike driver_id
-- elsewhere, which is on delete set null) — a payment record has no
-- meaning without the driver it paid; settlement_id IS on delete set null
-- (CLAUDE.md invariant #5 cascades still must not delete what was actually
-- paid). See PENDING_SQL.md §16.
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
  user_id       uuid not null references auth.users,
  settlement_id uuid references settlements on delete cascade,
  driver_id     uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14
  load_date     date,
  pickup_date   date,  -- added retroactively, PENDING_SQL.md §8 (per-diem exact day-counting)
  delivery_date date,  -- ditto — legacy calcPerDiemDays() sums (deliveryDate - pickupDate) per load
  order_number  text,
  origin        text,
  destination   text,
  loaded_miles  int default 0,
  empty_miles   int default 0,
  revenue       numeric(12,2) default 0,
  tags          text  -- PENDING_SQL.md §22
);

-- ---------- Fuel (was DB.fuel.tr / DB.fuel.re; +state = IFTA-ready) ----------
create table fuel_purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  truck_id     uuid references trucks,  -- added retroactively, PENDING_SQL.md §6 (Session 6 — an
                                         -- original oversight: settlements/maintenance_records both
                                         -- had truck_id from the start, fuel_purchases didn't)
  settlement_id uuid references settlements on delete cascade,  -- D6: matches legacy deleteSett()
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14
  fuel_type    text not null check (fuel_type in ('tractor','reefer')),
  purchase_date date,
  location     text,
  state        text,                          -- NEW: 2-letter code → IFTA quarterly report
  gallons      numeric(8,3),
  amount       numeric(12,2),
  discount     numeric(12,2) default 0,
  tags         text  -- PENDING_SQL.md §22
);

-- ---------- User categories (NEW, owner decision 2026-07-10 — custom
-- categories, PRODUCT DECISION). Entirely optional/additive — an account
-- with zero rows here behaves exactly as today (pickers just show
-- CANONICAL_CATEGORIES, docs/INDUSTRY_TAXONOMY.md §B). The tax safety
-- rail is enforced here at the DB level: a kind='expense' row MUST carry
-- schedule_c_bucket (defaults to "Misc" app-side when the user doesn't
-- pick one) so a custom expense category can never silently fall out of
-- the P&L/tax estimate; kind='income' rows have no bucket — custom
-- income categories roll straight into gross income. See
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
  user_id      uuid not null references auth.users,
  settlement_id uuid references settlements on delete cascade,  -- set for withheld items
  driver_id    uuid references drivers on delete set null,  -- added retroactively, PENDING_SQL.md §14 (withheld deductions only — see payroll auto-routing note)
  document_id  uuid references documents on delete set null,
  ded_date     date,
  code         text,                          -- EQUIP|LEGAL|INS|LIC|OTHER|...
  description  text,
  amount       numeric(12,2) not null,
  category     text,                          -- Software & Subscriptions | Legal & Accounting Fees | ...
  store        text,
  -- 9 generic values (owner decision 2026-07-07): Business Checking|
  -- Business Credit Card|Personal Checking|Personal Credit Card|Cash|
  -- Venmo|Cash App|Zelle Personal|Zelle Business — plus the synthetic
  -- 'Settlement Withheld' stamped onto settlement-withheld line items.
  -- Never a bank-brand string like "BofA Business" — see
  -- app/src/import/paymentMethods.ts.
  payment_method text,
  source       text default 'manual'          -- settlement|import|manual
                check (source in ('settlement','import','manual')),
  warranty_years numeric(4,1),                -- added retroactively, PENDING_SQL.md §7 — halves ok (e.g. 2.5)
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now()
);
-- Tax rule (net-pay model): deductible = rows where source != 'settlement'.
-- Withheld rows are display-only; already reflected in settlements.net.

-- ---------- Capital transactions (UNIFIED: was CAPITAL.draws + extraContributions) ----------
create table capital_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  tx_type      text not null check (tx_type in ('contribution','draw')),
  amount       numeric(12,2) not null,
  tx_date      date not null,
  note         text,
  linked_deduction_id uuid references deductions on delete cascade,
  -- ^ personal-payment purchases: contribution auto-created, cascades on delete.
  --   Postgres FK does the cascade the web app had to hand-code. NULL for manual draws.
  tags         text,                          -- PENDING_SQL.md §22
  created_at   timestamptz default now()
);
-- Tax-free remaining = profiles.initial_capital + sum(contributions) - sum(draws)

-- ---------- Maintenance (was DB.maint; feeds Truck Health) ----------
create table maintenance_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
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
  tags         text                           -- PENDING_SQL.md §22
);

-- ---------- Maintenance intervals (per-truck, user-editable — NEW, owner decision 2026-07-03) ----------
-- Every truck is different; each owner tunes their own service schedule. The legacy
-- JS constants (oil 50,000 mi fixed; fuel filter bundled with oil; DPF mpg-tiered;
-- trans 500k synthetic/250k conventional; diff 500k synthetic/100k conventional;
-- air filter 100k; air dryer 250k; chassis 30k; APU 2,000 engine hrs; coolant extender
-- 300k / full replace 600k; DEF filter 300k) become SEED DEFAULTS copied into this table
-- when a truck row is created (app-level insert or an AFTER INSERT trigger on trucks —
-- decide in Session 1). From then on every row is a plain user-editable setting; there
-- are no interval constants left in application code.
create table maintenance_intervals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users,
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
--   oil          miles  50000                              hrs:-
--   fuel         miles  50000   bundled_with_category='oil'
--   dpf          mpg_based  350000/500000/600000 (mpg <5.5 / <6.5 / >=6.5 at creation time)
--   def          miles  300000
--   coolant_ext  miles  300000
--   coolant      miles  600000
--   trans        miles  500000  (synthetic default; 250000 if the owner runs conventional fluid)
--   diff         miles  500000  (synthetic default; 100000 if conventional)
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
  user_id      uuid not null references auth.users,
  overrides    jsonb default '{}',            -- { "<category>": { "odometer": n } | { "hours": n } }
  updated_at   timestamptz default now()
);

-- ---------- Tolls (was DB.tolls.ez / DB.tolls.dw) ----------
create table tolls (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  network      text check (network in ('ezpass','drivewyze','other')),
  toll_date    date,
  amount       numeric(12,2),
  plaza        text,
  tags         text  -- PENDING_SQL.md §22
);

-- ---------- Reimbursements (was DB.reimb) ----------
create table reimbursements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  settlement_id uuid references settlements on delete cascade,  -- added retroactively,
                                -- PENDING_SQL.md §9 — batch tag for settlement re-import-replace
  reimb_date   date,
  description  text,
  reference    text,
  amount       numeric(12,2),
  tags         text  -- PENDING_SQL.md §22
);

-- ---------- Loans & credit cards (was LOANS / CARDS) ----------
create table loans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  name         text, lender text,
  original_amount numeric(12,2), balance numeric(12,2),
  payment      numeric(12,2), frequency text, apr numeric(5,2),
  next_due     date,
  tags         text  -- PENDING_SQL.md §22
);

create table credit_cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  name         text, last_four text,
  credit_limit numeric(12,2), balance numeric(12,2),
  apr numeric(5,2), due_day int,
  tags         text  -- PENDING_SQL.md §22
);

-- ---------- Bank & checking statements (was BANK_STMTS / CHK_STMTS, normalized) ----------
create table bank_statements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users,
  account_type text check (account_type in ('card','checking')),
  statement_month text,                       -- 'June 2026'
  document_id  uuid references documents on delete set null,
  -- opening_balance/closing_balance (added retroactively, PENDING_SQL.md
  -- §30, Session 9b parity-gap decision #2) — checking-statement only in
  -- practice (legacy CHK_STMTS); powers the Bank Statement screen's
  -- explicit-confirm "update business balance to $X" action, never a
  -- silent overwrite like legacy's own on-render behavior.
  opening_balance numeric(12,2),
  closing_balance numeric(12,2),
  unique (user_id, account_type, statement_month)   -- month-level duplicate guard
);

create table bank_transactions (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references bank_statements on delete cascade,
  user_id      uuid not null references auth.users,
  tx_date      date,
  description  text,
  category     text,
  tx_type      text check (tx_type in ('charge','payment','deposit','withdrawal')),
  amount       numeric(12,2),
  deductible   boolean default false,
  tags         text  -- PENDING_SQL.md §22
);

-- ============================================================================
-- DECISIONS (final — 2026-07-03, owner-approved):
--   D1. IFTA: fuel_purchases.state stays; AI import extracts state from fuel
--       receipts/settlement fuel lines from day one. IFTA quarterly report
--       becomes a Phase-3 feature reading this column.
--   D2. Truck health baselines are COMPUTED from maintenance_records
--       (highest-odometer-wins, with bundled_with_category cascading e.g.
--       oil → fuel) via a view/function; only baseline overrides with no
--       backing maintenance record live in truck_health_config.overrides.
--       Interval LENGTHS are per-truck, user-editable rows in
--       maintenance_intervals, seeded from the legacy constants when a truck
--       is created (owner decision 2026-07-03 — see that table's comment).
--       The health view/function reads: maintenance_intervals (enabled rows
--       only) joined to the computed maintenance_records baseline (falling
--       back to truck_health_config.overrides when no record exists) to
--       produce remaining-life per category. Single source of truth for
--       intervals; no interval constants remain in application code.
--   D3. documents.parsed_json (jsonb) stores the FULL raw AI extraction for
--       every import (settlements and all other types reference it via
--       document_id) — full audit trail, re-processable if logic improves.
--   D4. Multi-truck from day one: truck_id on settlements, maintenance,
--       fuel, health. UI shows a truck picker only when count > 1.
--   D5. Backups: JSON snapshots to a private Storage bucket `backups/`
--       (one per import + daily), NOT a database table.
--   D6. (added 2026-07-03, amends the original draft) fuel_purchases
--       .settlement_id is ON DELETE CASCADE, not SET NULL — matches legacy's
--       deleteSett(), which hard-deletes that week's fuel rows along with the
--       settlement ("this import was wrong, remove everything it created").
--       SET NULL would leave orphaned fuel rows that double-count in fuel
--       totals and CPM. Storage path convention is also finalized:
--       `{user_id}/{month}/Payroll/Week-N/...` and
--       `{user_id}/{month}/Equipment-Deductions/{store}/...` — see CLAUDE.md.
--   D7. (added 2026-07-03) Tax engine made product-ready, not single-user:
--       profiles.filing_status moves to a new tax_config table (tax_year,
--       filing_status, state, include_state_tax) so the estimator can be
--       re-run per year and against per-year data (see PROMPTS.md Session 5
--       and CLAUDE.md). Federal brackets/deadlines move out of
--       profiles/app code entirely into versioned per-year data — superseded
--       by D10 below, which moves that data server-side into tax_year_data
--       instead of an app-bundled module.
--   D8. (added 2026-07-03) tax_config gets entity_type (sole_prop|smllc|
--       scorp) + scorp_salary + scorp_payroll_tax_handled. sole_prop/smllc
--       are the SAME computation path (legacy math, unchanged) — smllc is
--       purely a UI label. scorp branches SE tax to apply only to
--       scorp_salary, with the remainder as SE-tax-free distributions; the
--       Capital Account page relabels draws as "Distributions" for scorp
--       users. See PROMPTS.md Sessions 5 & 7 and CLAUDE.md.
--   D9. (added 2026-07-03) Fleet scalability (1→100 trucks) needed NO schema
--       change — truck_id already flows through settlements, fuel,
--       maintenance, and health (D4). The gap was entirely in the app layer:
--       an active-truck context, per-truck vs. fleet-wide dashboard stats,
--       and truck matching during import. See PROMPTS.md Sessions 3/5/8 and
--       the new CLAUDE.md invariant (no code path may assume a single truck).
--   D10. (added 2026-07-03) Tax data made centrally updatable, supersedes the
--        "app/src/tax/brackets/{year}.ts bundled module" part of D7: a new
--        tax_year_data table (NOT user-scoped — one row per year, shared)
--        holds every tax constant (federal brackets, standard deduction,
--        SE-tax rate/factor, per diem, quarterly deadlines, state tax
--        tables), readable by all authenticated users, writable only by
--        service_role. An admin seeds/updates it directly in the Supabase
--        SQL editor (docs/ADMIN_RUNBOOK.md) — no app release needed to roll
--        over to a new tax year or correct a figure. The app fetches +
--        caches the current year's row and falls back to the latest
--        published year with a banner if the current year isn't published
--        yet (see PROMPTS.md Sessions 4/5 and CLAUDE.md).
--        LIVE (2026-07-03): the 2026 row has been run and published=true,
--        with state_tax verified (see docs/ADMIN_RUNBOOK.md for the figures
--        used as the reference example for future years).
--   D11. (added 2026-07-03, applied retroactively — the SQL had already been
--        run live before it was documented here) household_members +
--        household_income: supports the household side of the tax estimator
--        (legacy calcTax's "Spouse Income" field) and pairs with the
--        ai-import 'w2' docType. See that table's comment above (right
--        after `documents`, which household_income.document_id references)
--        and docs/DATA_MODEL.md.
--   D12. (added 2026-07-04) Legal disclaimers & Terms of Use: this app
--        produces ESTIMATES, not tax/legal/financial advice — every tax
--        figure surfaced anywhere in the UI must say so (CLAUDE.md).
--        profiles gets tos_accepted_at/tos_version so first-launch (PROMPTS.md
--        Session 3) can require scrolling + accepting Terms of Use before any
--        data entry, and re-prompt whenever tos_version changes. SQL applied
--        live 2026-07-04 — see docs/PENDING_SQL.md section 5.
--        See docs/TERMS_OF_USE_DRAFT.md (attorney-review draft) and
--        PROMPTS.md Session 10 (Settings > Legal pairs ToS + Privacy Policy).
-- ============================================================================
