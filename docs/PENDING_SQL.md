# Pending SQL — history of what's been run against the live Supabase DB

**STATUS (2026-07-12): sections 1-27 have all been run against the live DB.
Section 28 (added this pass, PROMPTS.md Session 9b onboarding wizard) is
NOT yet run — see its checklist below. Section 33 (added 2026-07-17, meals
& advance repayments) has been run (2026-07-27).**
Sections 11-24 were applied together in one transaction on 2026-07-11 via a
combined SQL block (generated from this file, run in the Supabase SQL
editor). This file started as a forward-looking "run this next" list; it's kept now
as the log of what actually landed, since Session 1 hasn't yet been
(re-)run to fold all of this into a proper follow-up migration file. When
that happens, this file should be cleared out in favor of the migration.

Section 4 (household tables) is recorded **retroactively** — that SQL was
already run live before it was ever written down here or in
`docs/SCHEMA.sql`. If anything below doesn't match what's actually live,
the live DB is the source of truth, not this file.

---

## 1. Tax engine product-readiness (D7 + D8, docs/SCHEMA.sql) — ✅ APPLIED

```sql
-- 1a. New tax_config table (filing_status/tax_year/state/include_state_tax
--     from D7, entity_type/scorp_salary/scorp_payroll_tax_handled from D8)
create table tax_config (
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
create policy "tax_config_owner_all" on tax_config
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 1b. Backfill one tax_config row per existing user from their current
--     profiles.filing_status (run BEFORE dropping the column in 1c)
insert into tax_config (user_id, filing_status)
select user_id, filing_status from profiles
on conflict (user_id) do nothing;

-- 1c. Drop the now-superseded column from profiles
alter table profiles drop column filing_status;
```

- [x] 1a run
- [x] 1b run (backfill)
- [x] 1c run (drop column)

## 2. Fleet scalability (D9, docs/SCHEMA.sql)

No SQL required — `truck_id` already exists on every table that needs it in
the live migration (D4 was already applied).

- [x] (none needed — confirmed no schema gap)

## 3. Centrally-updatable tax year data (D10, docs/SCHEMA.sql) — ✅ APPLIED

```sql
-- 3a. tax_year_data table — NOT user-scoped, one row per year, shared by
--     every user. Readable by all authenticated users; writable only by
--     service_role (no insert/update/delete policy exists for regular
--     users — service_role bypasses RLS entirely, which is the only way
--     this table is ever written).
create table tax_year_data (
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
);

-- 3c. Publish (already reflected in the insert above via published=true,
--     recorded separately here since this was the original planned step)
update tax_year_data set published = true where tax_year = 2026;
```

**Both flags previously raised here are now resolved (2026-07-03):**
1. OH's shape mismatch — resolved. The live DB confirms `flat` entries are
   ALWAYS bare rate numbers; Ohio's $26,050 exemption lives in the separate
   `flat_adjustments` object above, applied after the base flat-rate result.
   No design violation — the state-tax module was always meant to read
   `flat_adjustments` as a second pass, this file's earlier draft just
   hadn't caught up to that shape yet.
2. IL/PA verification gap — resolved. IL (0.0495) and PA (0.0307) ARE
   verified and present in the live `flat` map per Tax Foundation 2026 (now
   reflected above). The original PROMPTS.md Session 5 "CA, GA, IL, NC, PA
   are bracket states" list was simply wrong — corrected there too.
3. (added 2026-07-05) CA `bracket` placeholder — resolved. The literal
   INSERT shown above (this file is a historical log of what was run, not
   living documentation — see the STATUS note at the top) still shows the
   placeholder string used when this row was first seeded; the LIVE row
   was subsequently updated with the full numeric official FTB Schedule X
   (single) / Y (MFJ) / Z (HoH) bracket arrays and is confirmed correct —
   see docs/ADMIN_RUNBOOK.md. Don't take the snippet above as current fact;
   it's preserved as-is for the historical record per this file's own
   stated purpose.

Note: `flat_adjustments.MA` implies MA also has its own bare-rate entry in
`flat` (the surtax applies on top of it) — that entry isn't reproduced
above since MA's own rate wasn't part of this verification pass. Add it
when MA is fully verified, rather than assuming a number here.

- [x] 3a run (table + RLS)
- [x] 3b run (2026 seed, verified state_tax)
- [x] 3c run (`published = true`)

## 4. Household tables (D11, docs/SCHEMA.sql) — ✅ APPLIED, recorded retroactively

This SQL was run against the live DB before it was ever written down here —
it's being logged now for the historical record, not as a new pending step.

```sql
create table household_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  relation   text not null check (relation in ('spouse','child','other')),
  created_at timestamptz default now()
);
alter table household_members enable row level security;
create policy "household_members_owner_all" on household_members
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

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
alter table household_income enable row level security;
create policy "household_income_owner_all" on household_income
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index on household_income (user_id, tax_year);
```

- [x] household_members table + RLS run
- [x] household_income table + RLS + index run

## 5. Terms of Use acceptance (D12, docs/SCHEMA.sql) — ✅ APPLIED

```sql
alter table profiles
  add column tos_accepted_at timestamptz,
  add column tos_version     text;
```

No RLS change needed — `profiles` is already owner-scoped. `tos_accepted_at`
NULL means the user has never accepted (first-launch flow in PROMPTS.md
Session 3 must block all data entry until both columns are set); the app
re-prompts and overwrites both columns whenever the shipped `tos_version`
changes.

- [x] 5a run (add tos_accepted_at, tos_version to profiles)

## 6. fuel_purchases.truck_id (PROMPTS.md Session 6 — fleet scalability) — ✅ APPLIED

`docs/SCHEMA.sql`'s original draft gave `settlements` and `maintenance_records`
a `truck_id` column but left it off `fuel_purchases` — an oversight caught
while wiring Session 6's AI-import truck tagging, which PROMPTS.md Session 6
requires for all three tables ("settlements, fuel_purchases, and
maintenance_records rows created by an import must be tagged with
truck_id"). Without this column, fuel costs can never be attributed to a
specific truck in a multi-truck fleet, which conflicts with CLAUDE.md
invariant #7 (no code path may assume a single truck).

```sql
alter table fuel_purchases add column truck_id uuid references trucks;
create index on fuel_purchases (truck_id);
```

Nullable, no backfill needed for existing rows (same as `settlements`/
`maintenance_records`.truck_id) — a single-truck account can leave it null
or backfill it later; the app treats null the same as "unknown truck."

- [x] 6a run (add truck_id + index to fuel_purchases)

## 7. deductions.warranty_years (owner decision 2026-07-07, web app v2026.07.07-H) — ✅ APPLIED

Store-purchase items may carry a warranty length extracted by ai-import
(`warrantyYears` — halves allowed, e.g. 2.5). Persisted now by the mobile
import/save mapping (`app/src/import/mapExtraction.ts` `mapPurchase()`,
`app/src/types/db.ts` `Deduction.warranty_years`); surfacing it in the
Deductions UI can wait until Session 8+.

```sql
alter table deductions add column warranty_years numeric(4,1);
```

Nullable, no backfill needed — existing rows simply have no warranty info.

- [x] 7a run (add warranty_years to deductions)

## 8. loads.pickup_date/delivery_date (per-diem exact day-counting rework) — ✅ APPLIED

Needed to replace the `calcPerDiemDays()` "7 days × settlement count"
stopgap (`app/src/tax/perDiem.ts`) with legacy's real method — summing
(deliveryDate − pickupDate) per load, merged with a 7-day fallback for
settlement weeks whose loads have no date info at all. The `loads` table
only ever kept a single `load_date` column (see PROMPTS.md's 2026-07-05
implementation note, which flagged this exact gap and said a future
migration would need to add these two columns back). Not explicitly
requested this pass, but required to implement the per-diem rework for
real rather than as another approximation — flagging it here rather than
silently reintroducing a stopgap.

```sql
alter table loads add column pickup_date date;
alter table loads add column delivery_date date;
```

Nullable, no backfill needed for existing rows — `load_date` stays
populated for old rows and any display code that only reads it; new
imports populate all three (`app/src/import/mapExtraction.ts`
`mapSettlement()`).

- [x] 8a run (add pickup_date to loads)
- [x] 8b run (add delivery_date to loads)

## 9. reimbursements.settlement_id (owner decision 2026-07-09, web v2026.07.09-A — re-import-replace) — ✅ APPLIED

Mirrors the web app's new behavior: re-importing a settlement for a
`week_ending` that already exists REPLACES that week's batch-tagged rows
(settlement, loads, fuel, reimbursements, withheld deductions) instead of
duplicating them (`app/src/data/aiImportSave.ts`). `loads`/`fuel_purchases`/
withheld `deductions` already carry `settlement_id`; `reimbursements` never
did (it was only ever written from the standalone-maintenance
warranty-credit path, which has no settlement to tag). Settlement imports
now also map `settlement.reimbursementItems` into this table (legacy
saveImport(), legacy/index.html:2516 — a real gap, not previously ported),
so it needs the same batch tag to be replaceable.

```sql
alter table reimbursements add column settlement_id uuid references settlements on delete cascade;
create index on reimbursements (settlement_id);
```

Nullable — existing maintenance-warranty reimbursement rows have no
settlement to tag and stay null; the app treats null as "not tied to a
settlement import."

Run live as two separate statements (the combined block above was garbled
in the terminal when run together) — same DDL, same result:
`alter table reimbursements add column settlement_id uuid references
settlements on delete cascade;` then the `create index` statement. Column
name confirmed to match what the code writes/reads
(`app/src/data/aiImportSave.ts`).

- [x] 9a run (add settlement_id + index to reimbursements)

## 10. tax_year_data.per_diem gains full_daily_rate (Dashboard card parity, owner decision 2026-07-09) — ✅ APPLIED

The Dashboard's "Per Diem Deduction" card must show the legacy caption
"@$64/day (80% of $80)" — the $64 actually deducted is 80% of the $80 IRS
transportation-industry meal per diem. `daily_rate` (64) and
`deductible_pct` (100) already seeded in section 3 are exactly what
`calcPerDiemDeduction()` computes with and must NOT change (that stays
`days × 64 × 100%`, unchanged). `full_daily_rate` is a new, purely
informational key merged into the existing `per_diem` jsonb — the
Dashboard derives the caption's "80%" as `round(daily_rate /
full_daily_rate × 100)` from these two data-sourced numbers, never a
hardcoded percentage (CLAUDE.md invariant #6).

```sql
update tax_year_data
set per_diem = per_diem || '{"full_daily_rate": 80}'::jsonb
where tax_year = 2026;
```

Additive merge (`||`) — does not disturb the existing `daily_rate`/
`deductible_pct` keys. If this key is missing (not yet run), the Dashboard
card falls back to showing just "@$64/day" with no parenthetical, same
"never silently compute with missing data" spirit as invariant #6's
year-fallback banner.

- [x] 10a run (merge full_daily_rate into tax_year_data.per_diem for 2026)

---

## 11. profiles column defaults — drop owner-specific defaults (PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED

The mobile app is a clean product for other users; the `profiles` table's
column defaults were still the original owner's own values
(`company_name` defaulting to "Graywolf Logistics LLC", `business_balance`/
`initial_capital` defaulting to $60,000). Every new signup's `profiles` row
is created by `handle_new_user()` (`supabase/migrations/0001_init.sql`)
with no explicit values, so it inherited these defaults verbatim. This
section only changes the column DEFAULT for future inserts — it does not
touch any existing row's current value (the owner's own dev/test account
keeps whatever it currently has; this is a dev/test account now anyway).

```sql
alter table profiles alter column company_name drop default;
alter table profiles alter column business_balance set default 0;
alter table profiles alter column initial_capital set default 0;
```

- [x] 11a run (profiles column defaults — company_name/business_balance/initial_capital)

---

## 12. profiles.locale (multi-language support, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED

Manual language override (Settings → Language). NULL means "follow the
device's own OS language" (falling back to English if the device language
isn't one of the 5 supported). Once set, this value always wins over the
device language, on every device the user signs into (see
`app/src/context/AuthContext.tsx` fetchProfile()).

```sql
alter table profiles add column locale text;
```

- [x] 12a run (profiles.locale column)

---

## 13. drivers table (multi-truck fleet + drivers + payroll auto-routing, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED

New entity, entirely optional — an account with zero driver rows behaves
exactly as it does today (every `driver_id` added in section 14 stays
null, no picker is ever forced). `default_truck_id` is a soft UI
convenience hint for a future driver-management screen (PROMPTS.md
Session 8), never enforced.

```sql
create table drivers (
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
create policy "drivers_owner_all" on drivers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger trg_touch_updated_at before update on drivers
  for each row execute function touch_updated_at();
```

- [x] 13a run (create drivers table + RLS + trigger)

---

## 14. driver_id on settlements/loads/fuel_purchases/deductions (payroll auto-routing, PRODUCT DECISION, owner decision 2026-07-09) — ✅ APPLIED

Depends on section 13 (drivers must exist first). `on delete set null`
(not cascade) — removing/retiring a driver must never delete financial
history, it just un-attributes it. Deductions only need this for
settlement-withheld rows (`source='settlement'`) per the payroll
auto-routing scope — standalone out-of-pocket deductions from purchases
aren't part of a settlement and have no driver to attribute.

```sql
alter table settlements add column driver_id uuid references drivers on delete set null;
alter table loads add column driver_id uuid references drivers on delete set null;
alter table fuel_purchases add column driver_id uuid references drivers on delete set null;
alter table deductions add column driver_id uuid references drivers on delete set null;
```

- [x] 14a run (driver_id columns on settlements/loads/fuel_purchases/deductions)

---

## 15. drivers gains compensation fields (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED

Depends on section 13 (drivers must exist first). `compensation_type` drives
both the tax-engine treatment (`app/src/tax/driverPayroll.ts`) and, later,
the driver-management screen's pay fields (PROMPTS.md Session 8).
`pay_type`/`pay_rate` are informational display fields for that future
screen — the engine itself only ever reads recorded `driver_payments` rows
(section 16), never derives an amount from `pay_rate` × miles/percent, so a
driver with `pay_rate` set but no payments recorded contributes $0 to any
tax calculation (no silent estimation).

```sql
alter table drivers add column compensation_type text not null default 'w2_employee'
  check (compensation_type in ('w2_employee', '1099_contractor', 'team_split', 'trainee'));
alter table drivers add column pay_type text
  check (pay_type in ('per_mile', 'percent', 'flat'));
alter table drivers add column pay_rate numeric(10,4);
```

- [x] 15a run (drivers.compensation_type + pay_type + pay_rate)

---

## 16. driver_payments table (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED

Depends on section 13 (drivers) and section 15 (compensation_type, read by
the app to classify each payment for tax treatment — not enforced by a DB
constraint, since a driver's compensation_type can change over time while
past payments correctly keep whatever treatment applied when they were
paid; the app reads the driver's CURRENT compensation_type at query time,
per PROMPTS.md's decision notes). `settlement_id` is nullable — team_split/
trainee payments are typically tied to the settlement they were split from,
but a driver payment can also be recorded standalone (e.g. a monthly 1099
contractor invoice with no settlement). `employer_taxes` defaults to 0 and
is only ever populated for `w2_employee` payments (the app computes it from
`tax_year_data.se_tax.employer_fica` × gross_pay, see section 17) — for
every other compensation_type it stays 0, which is what lets
`sumDeductibleDriverPayroll()` treat `gross_pay + employer_taxes` as the
uniform deductible-expense formula across all four compensation types
without a type-specific branch.

```sql
create table driver_payments (
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
create policy "driver_payments_owner_all" on driver_payments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger trg_touch_updated_at before update on driver_payments
  for each row execute function touch_updated_at();

create index on driver_payments (user_id, driver_id, date);
```

`on delete cascade` from `drivers` (unlike `driver_id` on settlements/loads/
fuel/deductions, which is `on delete set null`) — a driver_payment has no
meaning without the driver it paid; deleting the driver's own record is a
deliberate "erase this driver" action, distinct from just un-attributing
their financial history from settlements. `settlement_id` IS `on delete set
null` — deleting a settlement (CLAUDE.md invariant #5, every delete
cascades) must not delete the payment record of what the owner actually
paid a driver, only un-link it from that settlement.

- [x] 16a run (create driver_payments table + RLS + trigger + index)

---

## 17. tax_year_data gains employer_fica + nec_1099 (driver compensation types, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED

CLAUDE.md invariant #6: no tax constant may live in app code. The W-2
employer-side FICA match (7.65% — Social Security 6.2% + Medicare 1.45%,
mirroring the employee-side rate already in `se_tax.rate`/`factor`) and the
1099-NEC $600 filing threshold are both exactly this kind of constant, so
both are merged into the existing 2026 `tax_year_data` row instead of being
hardcoded in `app/src/tax/driverPayroll.ts`. `employer_fica` is merged into
the existing `se_tax` jsonb (same object the SE-tax module already reads);
`nec_1099` is a new top-level key, same pattern as `per_diem`/
`quarterly_deadlines`. `filing_deadline` is Jan 31 of the year AFTER the tax
year (2027 for the 2026 row) — the IRS 1099-NEC filing deadline.

```sql
update tax_year_data
set se_tax = se_tax || '{"employer_fica": 0.0765}'::jsonb,
    nec_1099 = '{"threshold": 600, "filing_deadline": "2027-01-31"}'::jsonb
where tax_year = 2026;
```

Note: this requires `nec_1099` to exist as a column, not just a jsonb-merge
target — unlike `se_tax` (already a jsonb column being merged into), there
is no `nec_1099` column yet. Run the column-add FIRST:

```sql
alter table tax_year_data add column nec_1099 jsonb;
```

Both additive/nullable — the app's `driverPayroll.ts` falls back to a
hardcoded $600/no-deadline-shown behavior (documented in code, same
graceful-fallback spirit as `per_diem.full_daily_rate`, CLAUDE.md invariant
#6's "never silently compute with an empty/default... show a banner" for
brackets does NOT apply here since this isn't a bracket/rate/deduction
figure that changes the computed tax amount — it only gates whether an
informational reminder banner appears) until this migration runs.

- [x] 17a run (add tax_year_data.nec_1099 column)
- [x] 17b run (merge employer_fica into se_tax + set nec_1099 for tax_year 2026)

---

## 18. tax_config gains ownership_pct + entity_type 'multi_member_llc' (driver compensation types / entity selection, PRODUCT DECISION, owner decision 2026-07-10) — ✅ APPLIED

Scope decision: the owner's message said "Entity choice stored in profiles
(entity_type exists; add ownership_pct)" — `entity_type` actually already
lives on `tax_config`, not `profiles` (see section 1/D8), so `ownership_pct`
is added there too rather than introducing a second, disconnected entity
concept on `profiles`. `ownership_pct` is only meaningful when
`entity_type = 'multi_member_llc'` (a member's % share of the LLC, used to
scope the tax estimate to just that member's K-1 share — see
`calcTaxEstimate.ts`'s `ownerShareOfProfit`); null/ignored for every other
entity_type. Postgres has no `ALTER TYPE ... ADD VALUE` for a plain `check`
constraint — the constraint itself must be dropped and recreated.

```sql
alter table tax_config drop constraint tax_config_entity_type_check;
alter table tax_config add constraint tax_config_entity_type_check
  check (entity_type in ('sole_prop', 'smllc', 'multi_member_llc', 'scorp'));
alter table tax_config add column ownership_pct numeric(5,2);
```

The exact constraint name (`tax_config_entity_type_check`) is Postgres's
default auto-generated name for an unnamed inline `check` on the
`entity_type` column of `tax_config` — confirm with `\d tax_config` (or the
Supabase table editor's constraints tab) before running the `drop` if this
doesn't match what's actually live.

- [x] 18a run (drop + recreate tax_config.entity_type check constraint with multi_member_llc)
- [x] 18b run (add tax_config.ownership_pct column)

---

## 19. profiles.dashboard_layout (customizable dashboard, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

Schema groundwork only — the customizable-dashboard UI (drag-to-reorder,
show/hide, rename) is scheduled for PROMPTS.md Session 9a, not built this
pass. The column is unused (always null, app falls back to the default
card order/visibility/labels) until that session lands, same "schema now,
UI later" pattern as section 13's `drivers` table.

```sql
alter table profiles add column dashboard_layout jsonb;
```

Shape (documented here for whoever implements Session 9a, not enforced by
the DB): an ordered array of `{ id: string, visible: boolean, label:
string | null }` — `id` matches a stable per-card identifier (not the
i18n key, so relabeling the i18n default later doesn't orphan a saved
layout), `label` is the user's override (null = use the i18n default),
absence from the array or `visible:false` hides the card. "Reset to
default" is simply `dashboard_layout = null`.

- [x] 19a run (add profiles.dashboard_layout jsonb column)

---

## 20. profiles.role (expanded onboarding wizard, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

Schema groundwork only — the expanded onboarding wizard itself stays
scheduled for PROMPTS.md Session 9b (supersedes the earlier, shorter
wizard spec). The column is unused (every screen behaves as it does today,
defaulting to the full owner-operator experience) until that session wires
role-based module hiding.

```sql
alter table profiles add column role text
  check (role in ('owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee'));
```

Nullable, no default — an existing account (or one that skips this wizard
step) has `role = null`, which the app must treat identically to
`'owner_operator'` (the current, only behavior) until Session 9b adds the
actual branching. `company_driver_w2` is the one value that changes what
renders: it hides owner-only modules (Schedule C deductions, Capital
Account, S-Corp election) and centers per-diem/W-2 tracking instead;
`contractor_1099` gets the full Schedule C experience, same as
`owner_operator`/`trainee`.

- [x] 20a run (add profiles.role column)

## 21. user_categories table (custom categories, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

New entity, entirely optional/additive — an account with zero rows here
behaves exactly as today (every picker just shows `CANONICAL_CATEGORIES`,
docs/INDUSTRY_TAXONOMY.md §B). The tax safety rail (owner decision, item
2) is enforced at the DB level, not just in the app: a `kind='expense'`
row MUST have a `schedule_c_bucket` — a custom expense category can never
silently fall out of the P&L/tax estimate. `kind='income'` rows have no
bucket (custom income categories roll straight into gross income, there is
no Schedule C expense bucket for income).

```sql
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

alter table user_categories enable row level security;
create policy "user_categories_owner_all" on user_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger trg_touch_updated_at before update on user_categories
  for each row execute function touch_updated_at();
```

`schedule_c_bucket` is free text, not an enum — it should normally be one
of `docs/INDUSTRY_TAXONOMY.md`'s `CANONICAL_CATEGORIES` (the app defaults
it to `"Misc"` when creating an expense category without the user
explicitly picking a bucket, per the tax safety rail — matches this file's
existing "no DB migration/no check constraint on category strings" pattern
elsewhere), but nothing stops an admin/future feature from using a
different string, hence text not a foreign key/enum.

- [x] 21a run (create user_categories table + RLS + trigger)

---

## 22. tags column on financial record tables (flexible fields, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

Every record that already has a free-text field (`description`/`note`/
`notes`) for its own label ALSO gets an optional `tags` text field — the
user's own ad-hoc labeling/filtering, separate from (and not a replacement
for) the AI-populated/system description. Deliberately a single free-text
field, not a normalized tags table or array column — matches this owner's
explicit "no arbitrary user-defined schema columns" rule (CLAUDE.md): tags
is itself the one flexible field the schema offers instead of letting
users add their own columns, so it stays simple (comma-separated or
freeform, the UI's choice when it lands) rather than growing its own
relational structure.

```sql
alter table settlements add column tags text;
alter table loads add column tags text;
alter table fuel_purchases add column tags text;
alter table deductions add column tags text;
alter table capital_transactions add column tags text;
alter table maintenance_records add column tags text;
alter table tolls add column tags text;
alter table reimbursements add column tags text;
alter table loans add column tags text;
alter table credit_cards add column tags text;
alter table driver_payments add column tags text;
alter table bank_transactions add column tags text;
```

Nullable, no backfill needed — existing rows simply have no tags. Every
one of these ALTERs is independent (no ordering dependency between them).

- [x] 22a run (add tags column to settlements/loads/fuel_purchases/
      deductions/capital_transactions/maintenance_records/tolls/
      reimbursements/loans/credit_cards/driver_payments/bank_transactions)

## 23. compliance_items table (AI feature package — compliance tracker, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

New entity, entirely optional/additive — an account with zero rows here
just has an empty compliance tracker (Session 9b screen shows an empty
state). `type` covers all 8 categories named in the owner's spec; only 5
of them (`medical_card`, `annual_inspection`, `irp_registration`,
`hvut_2290`, `insurance_policy`) can be auto-populated by ai-import
(matching new docTypes — see `app/src/import/mapExtraction.ts`
`mapCompliance()`); `ifta_filing`/`cdl`/`drug_consortium` are manual-entry
only for now (no source document type extracts them yet — v1.x if that
changes). v1 simplification, documented here rather than silently
implied: matching for the "auto-creates or updates" behavior is by
`(user_id, type)` only, NOT per-truck — a multi-truck fleet needing
separate annual-inspection deadlines per truck is a gap the Session 9b
screen (or a future truck_id column) can address, not solved by this
schema pass.

```sql
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

alter table compliance_items enable row level security;
create policy "compliance_items_owner_all" on compliance_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger trg_touch_updated_at before update on compliance_items
  for each row execute function touch_updated_at();

create index on compliance_items (user_id, due_date);
```

`recurrence` is nullable and NOT auto-derived by the AI at import time —
a document's own dates don't reliably state its own renewal cadence, and
guessing would violate the same "never guess, flag for review" spirit as
every other extraction rule. The Session 9b screen sets/edits it (with
sensible per-`type` defaults chosen there, e.g. medical cards commonly
renew every 1-2 years, HVUT 2290 is always annual by Aug 31).

- [x] 23a run (create compliance_items table + RLS + trigger + index)

---

## 24. profiles.weekly_goal (AI feature package — CEO Mode briefing, owner decision 2026-07-10, PRODUCT DECISION) — ✅ APPLIED

Schema groundwork only — CEO Mode itself (the daily/weekly briefing that
reads this to show goal progress) is PROMPTS.md Session 9b, not built
this pass. Nullable/no default — CEO Mode must treat a null goal as "no
goal set yet" (omit the goal-progress line, or prompt the user to set one)
rather than silently comparing against 0.

```sql
alter table profiles add column weekly_goal numeric(12,2);
```

- [x] 24a run (add profiles.weekly_goal column)

---

## 25. benchmarks table (Profit Analysis v1, PROMPTS.md Session 9a, CLAUDE.md invariant #22 — NO external-data features) — ✅ APPLIED

NOT user-scoped — one row per metric/year, shared by every user, same
"admin-seeded, published-gates-visibility" pattern as `tax_year_data`
(section 1). These are PUBLISHED, STATIC industry reference ranges (source
+ year cited) — never live peer data pulled from other users of this app
(invariant #22 forbids that; true anonymized peer benchmarking is v2+
only). The UI must label every comparison "industry reference, not peer
data."

```sql
create table benchmarks (
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
```

App fallback (mirrors `tax_year_data`'s CLAUDE.md invariant #6 rule — never
silently compute against an empty/default table): until this has run (or a
metric's row is unpublished), Profit Analysis shows the computed ratio with
no benchmark comparison and no error, same "banner, not silent
default-zero" spirit as the tax-year fallback.

- [x] 25a run (create benchmarks table + RLS + seed the 2 metrics above)

---

## 26. misc_income table (manual income ledger, PROMPTS.md Session 9a) — ✅ APPLIED

Fills the gap CLAUDE.md invariant #14 flagged: docType
`government_or_misc_income` was archive-only with no financial row created
because no income ledger existed. This table is also the target of the
Session 9a "manual add income" form (legacy has no equivalent — a
user-entered row for things like a state tax refund credited to the
business, or detention pay paid outside a settlement). No category/bucket
column: unlike deductions, income never carries a Schedule C bucket
(invariant #19) — every row here rolls straight into gross income.

```sql
create table misc_income (
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
create policy "misc_income_owner_all" on misc_income
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Once this has run, `app/src/import/mapExtraction.ts`'s handling of
`government_or_misc_income` should be updated to insert a `misc_income` row
(same as the other financial docTypes) instead of archive-only — not done
this pass; tracked here so it isn't lost.

- [x] 26a run (create misc_income table + RLS)

---

## 27. tax_config gains sep_contribution + health_insurance_premiums (Session 9b Tax Estimator screen) — ✅ APPLIED

`calcTaxEstimate.ts`'s `TaxEstimateInputs.sepContribution`/
`healthInsurancePremiums` have existed since Session 5 but nothing ever
persisted a value for them — `useTaxEstimate()` never passed them at all,
so both silently defaulted to 0 for every user. The Tax Estimator screen
now has real inputs for both, so they need somewhere to live. Same table
as the rest of the entity/filing-status config (`tax_config`), not
`profiles` — these are tax-year-scoped estimate inputs, not identity
fields.

```sql
alter table tax_config
  add column sep_contribution numeric(12,2) not null default 0,
  add column health_insurance_premiums numeric(12,2) not null default 0;
```

No RLS change needed — `tax_config` is already owner-scoped.

- [x] 27a run (add sep_contribution + health_insurance_premiums to tax_config)

---

## 28. profiles gains dot_number/mc_number/onboarding_completed_at + trucks gains trailer fields (Session 9b onboarding wizard) — ✅ APPLIED

Expanded first-launch onboarding wizard (PROMPTS.md Session 9b item 7,
CLAUDE.md invariant #18): `onboarding_completed_at` gates whether the
wizard shows (null = show it, same "null means never done" pattern as
`tos_accepted_at`) — set once, on completion or explicit skip, never
reset. `dot_number`/`mc_number` are optional identity fields (step 3).
Trailer info (step 6) has no dedicated table — folds into the truck's own
row (1:1, simplest for v1; a truck already carries single-tractor values
the same way, so this matches the existing shape rather than introducing
a join table before multi-trailer-per-truck is ever asked for).

```sql
alter table profiles
  add column dot_number text,
  add column mc_number text,
  add column onboarding_completed_at timestamptz;

alter table trucks
  add column trailer_unit_number text,
  add column trailer_vin text,
  add column trailer_year int,
  add column trailer_make text,
  add column trailer_model text;
```

No RLS change needed — both tables are already owner-scoped.

- [x] 28a run (add profiles onboarding/DOT/MC columns + trucks trailer columns)

---

## 29. profiles gains cash-flow budget fields (Session 9b parity-gap decision #3, Cash Flow 30-day forecast) — ✅ APPLIED

Cash Flow's manual weekly-budget inputs (legacy `calcCF()`,
legacy/index.html:1960) — bank balance, weekly revenue, truck payment,
fuel, insurance (monthly), other, tax-reserve % — have no persistence in
legacy either (plain form fields, recomputed on every `oninput`), but a
mobile user closing the app would lose them every time with no
persistence at all, so this pass adds them as nullable `profiles`
columns, same "single-row-per-user settings scalar" pattern as
`weekly_goal` (§24) rather than a new table. All nullable/no default —
the app supplies legacy's own placeholder defaults (1145/1800/0/500/25)
client-side when a column is null, matching legacy's `||` fallback
behavior in `calcCF()`, never a server-side default that would silently
say "you set this" when the user never touched the field.

```sql
alter table profiles
  add column cf_bank_balance numeric(12,2),
  add column cf_weekly_revenue numeric(12,2),
  add column cf_truck_payment numeric(12,2),
  add column cf_fuel_weekly numeric(12,2),
  add column cf_insurance_monthly numeric(12,2),
  add column cf_other_weekly numeric(12,2),
  add column cf_tax_reserve_pct numeric(5,2);
```

No RLS change needed — `profiles` is already owner-scoped.

- [x] 29a run (add profiles cash-flow budget columns)

---

## 30. bank_statements gains opening_balance/closing_balance (Session 9b parity-gap decision #2, explicit-confirm balance update) — ✅ APPLIED

Legacy's checking-statement import (`CHK_STMTS`, FEATURE_INVENTORY.md
§2.6) captures `openingBalance`/`closingBalance` per statement but the
mobile `bank_statements` table never gained matching columns — the
legacy-backup importer (`app/src/data/legacyImport/importLegacyBackup.ts`
`importCheckingStatements()`) was silently dropping both fields. Adding
them here so the Bank Statement screen can offer legacy's closing-
balance reconciliation, but as an EXPLICIT confirm action (owner
decision 2026-07-12, Session 9b parity-gap decision #2) rather than
legacy's silent on-render overwrite of `gw_bizbal` — never automatic.

```sql
alter table bank_statements
  add column opening_balance numeric(12,2),
  add column closing_balance numeric(12,2);
```

No RLS change needed — `bank_statements` is already owner-scoped.

- [x] 30a run (add bank_statements opening_balance/closing_balance columns)

---

## 31. profiles.role gains lease_operator (device feedback round 2, owner decision 2026-07-13) — ✅ APPLIED

Onboarding's role step gains a 5th option: leases a truck from another
operator/carrier rather than owning it. Treated identically to
`owner_operator` for every module/tax code path today (CLAUDE.md
invariant #18: only `company_driver_w2` branches rendering, and
`lease_operator` is not that) — kept as its own distinct value, not
folded into `owner_operator`, so a future carrier-lease-specific feature
has something to key off without another migration.

```sql
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner_operator', 'company_driver_w2', 'contractor_1099', 'trainee', 'lease_operator'));
```

No RLS change needed — `profiles` is already owner-scoped.

- [x] 31a run (widen profiles.role check constraint to add lease_operator)

---

## 32. profiles.dashboard_sections_collapsed (Dashboard sections addition, owner decision 2026-07-13) — ✅ APPLIED

Collapsible titled sections on the Dashboard (OVERVIEW/MONEY/ON THE
ROAD/TAXES, mirroring the sidebar/menu-sheet grouping language at a
coarser grain) need their expand/collapse state remembered per user.
Nullable/no default (`{}` in the app when null) — same "degrade
gracefully to an empty object, never assume a section is collapsed
just because the column is new" pattern as `dashboard_layout` itself.

```sql
alter table profiles add column dashboard_sections_collapsed jsonb;
```

No RLS change needed — `profiles` is already owner-scoped.

- [x] 32a run (add profiles.dashboard_sections_collapsed column)

---

## 33. deductions.tax_deductible (meals & advance repayments, owner decision 2026-07-17, mirrors web v2026.07.17-D) — ✅ APPLIED (2026-07-27)

A settlement-withheld row (`source='settlement'`) is already excluded from
every tax total (CLAUDE.md invariant #1's net-pay model, `source !==
'settlement'` filter) — but a Meals or Advance Repayment line can also
arrive as an out-of-pocket/imported row (`source='import'`/`'manual'`,
e.g. a standalone restaurant receipt or a company-store advance repaid
via a tracked document), which that filter never catches. This column is
a SMART DEFAULT, not a lock: `guessCategory()`/the ai-import prompt set it
false for "Meals (per diem covered)"/"Advance Repayment" rows at save
time, but the user can flip it per row like any other field on the
Deductions screen, and the edit sticks (never re-overridden by a
migration or a re-import of the same document).

```sql
alter table deductions add column tax_deductible boolean not null default true;
```

No RLS change needed — `deductions` is already owner-scoped.

- [x] 33a run (add deductions.tax_deductible column)

---

## 34. settlements uniqueness scoped by truck_id (CRITICAL BUG FIX, device feedback, 2026-07-30) — ✅ APPLIED

**Symptom**: on a real device, importing settlements for two different
trucks that both happened to have the same `week_ending` caused the
second import to silently REPLACE the first — only one settlement ever
existed afterward. Root cause: the original `unique (user_id,
week_ending)` constraint (no `truck_id`) meant `.upsert(...,
{onConflict: 'user_id,week_ending'})` matched across trucks. The match
key must be `(user_id, week_ending, truck_id)` — with a null truck_id
still uniquely constrained against other null-truck rows, so a
single-truck/no-truck account keeps exactly the same one-settlement-per-
week behavior it always had (CLAUDE.md invariant #7: n=1 is just the
default presentation, never a separate code path). Two partial unique
indexes express this (a plain 3-column unique constraint would NOT work —
Postgres/Postgres-style NULL semantics treat every NULL truck_id as
distinct, which would silently un-guard the no-truck case).

App-side companion fix (`app/src/data/aiImportSave.ts`): the settlement
save path no longer uses `.upsert(..., {onConflict})` at all — an
explicit `findExistingSettlement(user_id, week_ending, truck_id)` select
(`.eq('truck_id', id)` when set, `.is('truck_id', null)` when not) decides
update-vs-insert instead, since a nullable third column can't be
expressed as a single onConflict column list anyway.

```sql
alter table settlements drop constraint settlements_user_id_week_ending_key;

create unique index settlements_user_week_truck_uidx
  on settlements (user_id, week_ending, truck_id)
  where truck_id is not null;

create unique index settlements_user_week_notruck_uidx
  on settlements (user_id, week_ending)
  where truck_id is null;
```

If `settlements_user_id_week_ending_key` isn't the live constraint's
actual name (Postgres auto-names an inline `unique (...)` this way, but
double-check in the Supabase dashboard's table constraints view before
running), find it first with:

```sql
select conname from pg_constraint where conrelid = 'settlements'::regclass and contype = 'u';
```

- [x] 34a run (drop old settlements unique constraint, add the two partial unique indexes)

---

## 35. settlements.per_diem_days (PER DIEM INTELLIGENCE, owner decision 2026-07-30, mega-pass part B) — ✅ APPLIED

**Symptom fixed**: per diem was a flat 7 days × distinct settlement weeks
(`app/src/tax/perDiem.ts`), so a "home week" settlement with 0 miles
(e.g. W/E 2026-07-25) still counted a full 7 per-diem days it never
earned. `per_diem_days` is now a real, per-settlement, editable column
(0-7) — editable on the settlement detail screen AND the import preview
before save. Smart default at import/save time
(`app/src/import/mapExtraction.ts` `mapSettlement()`): 0 total miles ->
0 days ("home week," user can override), miles > 0 -> 7 (matches the old
flat behavior for every settlement that actually represents time OTR).
`calcPerDiemDays()` now SUMS whatever's stored per settlement (never
re-derives from miles itself, so a manual edit always sticks), deduping
a repeated `week_ending` (a multi-truck fleet settling every truck the
same week) by taking the MIN value among the duplicates — the same
calendar week can't count as away-from-home twice just because 2 trucks
settled on it.

```sql
alter table settlements
  add column per_diem_days integer not null default 7
    check (per_diem_days >= 0 and per_diem_days <= 7);

-- Backfill: apply the new smart default retroactively — a 0-mile "home
-- week" settlement already on file gets corrected to 0 days; every other
-- existing settlement keeps the flat 7 it already effectively had.
update settlements set per_diem_days = 0 where miles = 0;
```

No RLS change needed — `settlements` is already owner-scoped.

- [x] 35a run (add settlements.per_diem_days + backfill 0-mile weeks to 0 days)

---

## 36. Asset purchase & financing (owner decision 2026-07-30, PRODUCT DECISION, mega-pass part C) — ✅ SQL APPLIED (Edge Function redeploys still pending, see 36b/36c)

Every asset (truck, trailer, or unlimited other equipment) can now record
its own purchase price/date and financing (cash or loan). A loan links
via `loan_id` to the SAME `loans` table every other Loan Center entry
already uses — payments keep flowing through the existing principal/
interest logic unchanged; this only adds the asset-side pointer to
"which loan financed this," populated either by uploading a financing
document (ai-import docType `loan_agreement`, auto-matched by asset
name/unit number — `app/src/import/loanAssetMatch.ts`) or by manual
entry on the Trucks/Equipment screens. `equipment` is a new, first-class
table for "unlimited other equipment" (generators, reefer units, tools
financed on their own note) — distinct from the lighter-weight Asset
Register (`app/src/stats/assetRegister.ts`, a view over booked deduction
line items with a warranty), which is unaffected.

`loan_id`/`trailer_loan_id`/`equipment.loan_id` are `on delete set null`
— Reset All Data and Delete Account both delete `loans` BEFORE
`trucks`/`equipment` in their deletion order, so a plain FK (no
`on delete set null`) would make either flow fail outright the moment a
linked asset still pointed at a loan row being deleted.

Found while here, same class of bug as the Cash Flow/legacy-import
numeric-default fix earlier this session: `trucks.fleet_mpg` still has a
DB-level `default 8.9` (the original owner's actual truck MPG) left over
from before the "no owner-specific defaults" rule existed — every truck
INSERT in the app already explicitly sets `fleet_mpg` itself (or leaves
it out and gets `null`, since it's an optional field on the manual
add-truck form), so this default has likely never actually fired through
the app, but it's still wrong to leave sitting on the live column.
Dropped in the same pass.

```sql
alter table trucks
  alter column fleet_mpg drop default,
  add column purchase_price numeric(12,2),
  add column purchase_date date,
  add column financing text check (financing in ('cash', 'loan')),
  add column loan_id uuid references loans on delete set null,
  add column trailer_purchase_price numeric(12,2),
  add column trailer_purchase_date date,
  add column trailer_financing text check (trailer_financing in ('cash', 'loan')),
  add column trailer_loan_id uuid references loans on delete set null;

create table equipment (
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
create trigger trg_touch_updated_at before update on equipment
  for each row execute function touch_updated_at();

alter table equipment enable row level security;
create policy "equipment_owner_all" on equipment
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Also add `"equipment"` to both `supabase/functions/reset-data/index.ts`'s
and `supabase/functions/delete-account/index.ts`'s
`TABLES_IN_DELETION_ORDER` (already done in the app-side source for this
pass — this SQL section is the DB-side companion; no further SQL needed
for that, it's just a reminder these two Edge Functions need
redeploying too since their source changed).

- [x] 36a run (trucks purchase/financing columns + new equipment table + RLS)
- [ ] 36b redeploy reset-data (TABLES_IN_DELETION_ORDER gained "equipment")
- [ ] 36c redeploy delete-account (TABLES_IN_DELETION_ORDER gained "equipment")

---

## 37. settlements.business_balance_credit + apply_business_balance_delta() RPC (pre-launch hardening, owner decision 2026-08-02) — ✅ APPLIED

Independent code review finding: re-importing a settlement with a
corrected net pay (e.g. a carrier statement that was mis-read the first
time, 2000 -> 2500) applied NOTHING to `profiles.business_balance` on a
re-import — the crediting code was gated on `!isReimport` entirely, so a
corrected week silently left the balance wrong forever. Also, the
ORIGINAL credit itself was a plain client-side select-then-update
(read-modify-write), not atomic — two concurrent imports could race.

Fixed both at once: `settlements.business_balance_credit` tracks how much
of THAT settlement's net pay has actually been applied to
`business_balance` so far (0 for a settlement that's never contributed,
e.g. its net was <= 0). Every save (new OR re-import) now computes
`newCredit = netPay > 0 ? netPay : 0`, reads `previousCredit` from the
settlement row (0 for a brand-new settlement, whatever's stored for a
re-import), and applies `delta = newCredit - previousCredit` via the new
`apply_business_balance_delta(p_user_id, p_delta)` RPC — a single atomic
`UPDATE ... SET business_balance = business_balance + p_delta` instead of
a JS read-modify-write. A brand-new settlement is just the delta=newCredit,
previousCredit=0 case, so this is one code path for both, not two.

```sql
alter table settlements
  add column business_balance_credit numeric(12,2) not null default 0;

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
  return new_balance;
end;
$$;

grant execute on function apply_business_balance_delta(uuid, numeric) to authenticated;
```

- [x] 37a run (settlements.business_balance_credit + the RPC function)
- [ ] 37b `supabase gen types` re-run to pick up the new column (app/src/types/db.ts already hand-edited ahead of this — see "Also still open" below)

---

## 38. apply_business_balance_delta() raises on zero-row update (pre-launch hardening, owner decision 2026-08-02, "settlement imports failing frequently" audit) — ✅ APPLIED

Independent audit of the §37 RPC found a real silent-failure gap: `update
profiles set ... returning business_balance into new_balance` leaves
`new_balance` as `NULL` (never assigned) when the `WHERE` clause matches
ZERO rows — a mismatched `p_user_id`/`auth.uid()`, or a profiles row that
somehow doesn't exist for that user. PL/pgSQL does NOT raise an error for
an UPDATE that matches 0 rows by default — the function just returned
`NULL` with `error: null`, so the CLIENT believed the balance update
succeeded when it silently never touched anything. This is a genuine
"the app said it worked but the business balance is wrong" bug class,
distinct from (and quieter than) the RPC actually throwing.

Fixed with a single `if not found then raise exception ...` check
immediately after the `UPDATE ... RETURNING INTO` — `FOUND` is a
PL/pgSQL built-in that reflects whether the most recent statement
affected any rows. Now a 0-row update is a REAL, visible Postgres error
(`errcode 'P0002'`, "no data found" — same code PL/pgSQL itself uses for
an analogous case) that the client's `SaveExtractionError` reports as
step `'balance-update'` instead of a quiet no-op.

```sql
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
```

`create or replace function` is idempotent — this safely replaces the
§37 version in place, no column/table changes, no data migration needed.

- [x] 38a run (replace apply_business_balance_delta with the `if not found` guard)

---

## 39. profiles.cf_insurance_weekly (Cash Flow auto-fill fix, owner decision 2026-08-04, device report) — ✅ APPLIED

Device report: a real carrier settlement withholds FOUR separate
insurance charges EVERY WEEK (bobtail/deadhead, physical damage,
occupational accident, cargo/workers comp) — not a monthly bill — so
§29's `cf_insurance_monthly` field was the wrong shape for what this
input actually needs to represent, and the Cash Flow forecast now
auto-fills it from the user's own trailing 4-week average of settlement-
withheld insurance deductions (same "from your settlements" pattern as
`cf_weekly_revenue`/`cf_fuel_weekly`/`cf_other_weekly`), which only makes
sense as a weekly figure.

ADDS a new column rather than renaming/reinterpreting `cf_insurance_monthly`
in place — a user who already saved a monthly figure there must never
have that same stored number silently reinterpreted as a WEEKLY one (a
4.33x error) the next time they open Cash Flow. `cf_insurance_monthly`
is left in place, unused going forward — same "harmless deprecated
column" precedent as `profiles.dashboard_layout` after the Customize
Dashboard retirement (CLAUDE.md).

```sql
alter table profiles
  add column cf_insurance_weekly numeric(12,2);
```

No RLS change needed — `profiles` is already owner-scoped.

- [x] 39a run (add profiles.cf_insurance_weekly)

---

## 40. Category taxonomy rename migration (FULL PARITY pass, owner decision 2026-08-05) — ✅ APPLIED

CLAUDE.md's category renames (`app/src/import/category.ts`
`CANONICAL_CATEGORIES`, docs/INDUSTRY_TAXONOMY.md §B) have historically
been display-only — old free-text category strings on existing rows were
left as-is, no migration, per that doc's own "no DB migration by itself"
note. This pass changes that on purpose: the new Accountant Package groups
and subtotals rows by EXACT category string (`app/src/stats/
accountantPackage.ts`), so a stale pre-rename string (`Professional
Services`, `Legal & Accounting Fees`, `Insurance`, `Licensing & Permits`,
`Truck Supplies`, `Safety Equipment`, or the original single-user web
app's `Fixed`/`Variable` 3-bucket classification) would silently create a
SECOND, orphaned bucket next to the current canonical one instead of
rolling up together. `deductions.category` and `user_categories.
schedule_c_bucket` (a custom category could have been pointed at the old
bucket name) both get the same rename. The canonical `Other` catch-all is
deliberately NOT touched — it's a distinct, valid category from `Misc`
(CLAUDE.md invariant #14), not a legacy string being retired.

```sql
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
```

No RLS change needed — both tables are already owner-scoped; these
`UPDATE`s only touch existing rows' `category`/`schedule_c_bucket` text.

- [x] 40a run (rename legacy category strings on deductions + user_categories)

---

## 41. capital_transactions.business_balance_applied (FULL PARITY pass, owner decision 2026-08-05, spec item E.3 "equity moves cash, not tax") — ✅ APPLIED

Recording a manual Draw or Contribution on the Capital Account screen
previously touched ONLY `capital_transactions` — `profiles.business_balance`
was left completely untouched by that action (only ever moved by settlement
import or the separate "Update Business Balance" manual-correction button).
That's wrong: a manual cash draw/contribution genuinely moves money into or
out of the business checking account the same way a settlement's net pay
does, and the Dashboard/Cash-Flow-starting-balance/Accountant-Package all
read `business_balance` as if it already reflected that.

Scope decision: this applies to MANUAL (non-linked) draws/contributions
only — a LINKED contribution (`linked_deduction_id` set, auto-synced from a
personally-paid deduction via `planContributionSync()`) represents equity
the owner built by paying a business expense out of pocket; no cash
actually moved into business checking for that event, so it must NOT also
credit `business_balance` (doing so would fabricate cash that was never
deposited). Manual contributions/draws are real bank-account movements the
owner is directly telling the app about — the same class of fact a
settlement import represents.

Same atomic-delta pattern as `settlements.business_balance_credit` (§37) —
reusing the EXISTING `apply_business_balance_delta(p_user_id, p_delta)` RPC,
no new function needed. `business_balance_applied` tracks exactly how much
of THIS transaction has been applied so far (signed: positive for a
contribution, negative for a draw) so an edit or delete can reverse the
EXACT applied amount with no drift, never re-derive it from the row's
current `amount`/`tx_type` (which could have already changed).

```sql
alter table capital_transactions
  add column business_balance_applied numeric(12,2) not null default 0;
```

No RLS change needed — `capital_transactions` is already owner-scoped, and
`apply_business_balance_delta` itself already checks `auth.uid()`.

- [x] 41a run (add capital_transactions.business_balance_applied)

---

## 42. One-time date repair migration (FULL PARITY pass, owner decision 2026-08-05, spec item D.1) — ✅ APPLIED

A one-time repair pass over every ALREADY-STORED date column, applying
the SAME year↔day-swap rule `app/src/import/dateGuard.ts`'s
`trySwapYearAndDay()`/`correctImplausibleDate()` already applies at
IMPORT time (client-side, before a new row is ever saved) — this closes
the gap for rows that were saved BEFORE that guard existed, or where the
guard's own "must land within a tight recent window" condition didn't
fire. A date is "implausible" here per the spec's own definition: before
2020, or beyond next year (computed dynamically off `current_date` at the
time this SQL actually runs — not a hardcoded year, so this migration
stays correct whenever it's actually applied). `repair_implausible_date()`
is a reusable PL/pgSQL function (same "one shared function, not N copies"
precedent as `apply_business_balance_delta`, §37): swap the year and day
digits within the same century (month untouched — mirrors
`trySwapYearAndDay()`'s own logic exactly), and only apply the swap if
the result is BOTH a real calendar date (invalid dates, e.g. day 31 in a
30-day month, are caught and left alone) AND itself falls inside the
plausible window — a genuinely old/future date that doesn't resolve to
anything plausible either way is left untouched (still implausible,
still flaggable by the app's own red-banner detection, spec item D.2 —
never silently "fixed" into a wrong date).

Covers every dated column named in the spec: `settlements.week_ending`,
`loads.pickup_date`/`delivery_date`/`load_date`, `deductions.ded_date`,
`reimbursements.reimb_date`, `fuel_purchases.purchase_date`,
`maintenance_records.service_date`, `tolls.toll_date`.

```sql
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
```

No RLS change needed — every `UPDATE` above targets existing rows via
their already-enforced owner-scoped RLS policies (run as the project
owner/service_role via the SQL editor, same as every other migration in
this doc).

- [x] 42a run (create repair_implausible_date() + repair every dated column)

---

## 43. maintenance_records.source / tolls.source (Accountant Package ORIGIN RULE, owner decision 2026-08-05, FULL PARITY pass item B.1) — ✅ APPLIED

The Accountant Package's Out-of-pocket/Settlement-withheld/Everything
scope filter needs to know whether a row came FROM a settlement import or
was captured standalone — `deductions.source` (`'settlement'|'import'|
'manual'`) already carries this. `fuel_purchases` gets it for free from
its existing nullable `settlement_id` (set when mapSettlement() extracts
it, null for a standalone fuel receipt). `maintenance_records` and
`tolls` have NO equivalent signal at all — this section adds the same
`source` column deductions already has, so the app can filter/tag rows
by origin exactly like every other financial table already does the
same three-way check.

BACKFILL for existing rows (best-effort, per the spec's own stated
default): `tolls` — a transponder toll (`network` in `'ezpass'`/
`'drivewyze'`) defaults to `'settlement'` (carrier statements
overwhelmingly report transponder tolls as a settlement line item); any
other network defaults to `'import'`. `maintenance_records` — a row
linked to a document whose `parsed_json->>'docType'` is `'maintenance'`
(a standalone maintenance-invoice import) is tagged `'import'`; every
other existing row (including one with no document at all, or one linked
to a settlement's own document) defaults to `'settlement'`, matching the
spec's literal "carrier shop invoices default to withheld unless a
payment method says otherwise" — maintenance_records has no payment-
method field to check otherwise against.

```sql
alter table maintenance_records
  add column source text not null default 'import'
    check (source in ('settlement', 'import', 'manual'));

alter table tolls
  add column source text not null default 'import'
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
```

No RLS change needed — both tables are already owner-scoped.

- [x] 43a run (add maintenance_records.source + tolls.source, backfill existing rows)

---

## 44. trucks.manual_total_miles_override (FULL PARITY follow-up, owner decision 2026-08-05, spec item B.3) — ✅ APPLIED (2026-08-23)

A user-entered odometer/ELD total that SUPERSEDES the app's own
settlement/loads-derived mile calculation (`app/src/stats/miles.ts`
`calcMiles()`) for CPM/RPM purposes — the spec's own explicit ask: "a
manual TOTAL override (odometer/ELD) that supersedes the weekly figures
— with a banner naming which source is in use and a one-tap 'use
settlements instead'." Lives on `trucks` (miles are inherently a
per-truck figure) — nullable, so "not set" (the default for every
existing truck) falls straight back to the calculated total with zero
behavior change.

```sql
alter table trucks
  add column manual_total_miles_override numeric(12,2);
```

No RLS change needed — `trucks` is already owner-scoped.

- [x] 44a run (add trucks.manual_total_miles_override)

---

## 45. trucks cost basis (FULL PARITY follow-up, owner decision 2026-08-05, spec item C.1) — ✅ APPLIED (2026-08-23)

The way real owner-operators think about their truck's fixed weekly
cost — replaces the previous CPM engine's "sum every Loan Center row
and multiply by settlement count" approach (a synthetic estimate that
produced $8.48/mi on web, spec item C.2). All nullable; a truck with no
cost basis configured yet computes a $0 contribution here and shows a
"not set" prompt (`app/src/stats/truckCostBasis.ts`
`calcTruckCostBasisWeekly()`), never a guess.

```sql
alter table trucks
  add column cost_basis_ownership_mode text check (cost_basis_ownership_mode in ('paid','loan','lease')),
  add column cost_basis_loan_monthly_payment numeric(12,2),
  add column cost_basis_paid_spread_months integer,
  add column cost_basis_warranty_cost numeric(12,2),
  add column cost_basis_warranty_term_months integer;
```

`purchase_price` (docs/PENDING_SQL.md §36) is reused as-is for the
'paid' mode's spread calculation — no new purchase-price column needed.
`cost_basis_loan_monthly_payment` is a FIXED figure the owner enters
directly (never re-derived from a Loan Center schedule, which may not
exist for this truck or may not reflect a refinance/payoff this module
has no way to reason about). No RLS change needed — `trucks` is already
owner-scoped.

- [x] 45a run (add trucks cost-basis columns)

---

## 46. trucks depreciation election (FULL PARITY follow-up, owner decision 2026-08-05, spec item E) — ✅ APPLIED (2026-08-23)

Purchased-truck depreciation election, tractor and trailer independent
of each other (same "trailer's financing is independent of its
tractor's" pattern as CLAUDE.md invariant #25) — a separate TAX concept
from §45's cost-basis fields, which are about economic CPM spread, not
the tax-deductible depreciation expense. See
`app/src/tax/depreciation.ts`.

```sql
alter table trucks
  add column depreciation_method text check (depreciation_method in ('full','macrs','spread','ask')),
  add column depreciation_year_placed_in_service integer,
  add column depreciation_spread_years integer,
  add column trailer_depreciation_method text check (trailer_depreciation_method in ('full','macrs','spread','ask')),
  add column trailer_depreciation_year_placed_in_service integer,
  add column trailer_depreciation_spread_years integer;
```

All nullable; an unconfigured truck contributes $0 to the tax estimate's
depreciation line with a "not set" prompt, never a guess. No RLS change
needed — `trucks` is already owner-scoped.

- [x] 46a run (add trucks depreciation-election columns)

---

## 47. category_learning_rules (FULL PARITY follow-up, owner decision 2026-08-05, spec item G) — ✅ APPLIED (2026-08-23)

CATEGORY LEARNING LAYER — every manual re-categorization of a deduction
stores a normalized keyword→category rule (per user), applied before the
built-in category guesser with fuzzy matching, and sent to `ai-import` as
plain-text "USER CORRECTIONS" prompt hints. See
`app/src/import/categoryLearning.ts`. PROMPT-CONTEXT ONLY — no model is
ever fine-tuned or retrained on this data.

```sql
create table category_learning_rules (
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
create policy "category_learning_rules_owner_all" on category_learning_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [x] 47a run (create category_learning_rules table + RLS policy)

---

## 48. profiles.tutorial_seen_at (FULL PARITY follow-up, owner decision 2026-08-05, spec item I) — ✅ APPLIED (2026-08-23)

FIRST-RUN TUTORIAL — the 6-slide illustrated walkthrough shown after ToS
acceptance and before the onboarding wizard (`app/app/tutorial.tsx`,
`app/src/navigation/rootRedirect.ts`). Null means never seen/skipped,
same "null = never done, set once" pattern as
`onboarding_completed_at` (§28).

```sql
alter table profiles
  add column tutorial_seen_at timestamptz;
```

No RLS change needed — `profiles` is already owner-scoped.

- [x] 48a run (add profiles.tutorial_seen_at)

---

## 49. Smart alerts + proactive AI Coach state (NEXT PASS, owner decision 2026-08-24, items D + E)

Five new nullable/defaulted columns on `profiles`, all additive:

- `nudge_state` (jsonb) — SMART ALERTS (item D3, frequency discipline):
  one entry per nudge topic ever shown/silenced,
  `Partial<Record<NudgeTopic, {lastShownAt, silencedAt}>>` — see
  `app/src/alerts/nudgeFrequency.ts`. Default `{}` means nothing shown or
  silenced yet, never a missing-column crash.
- `role_prompt_dismissed_at` (timestamptz) — the "what's your role?"
  ask-once prompt (item D1, `app/src/alerts/roleFilter.ts`
  `resolveRolePromptNeeded()`) — null means never dismissed without
  answering, same "null = never done, set once" pattern as
  `onboarding_completed_at` (§28) / `tutorial_seen_at` (§48).
- `ai_weekly_review` / `ai_weekly_review_generated_at` /
  `ai_weekly_review_week_ending` (text / timestamptz / text) — the
  proactive weekly settlement review (item E1), cached so it costs at
  most one `ai-advisor` call per user per week (spec's own explicit cap)
  — `ai_weekly_review_week_ending` tracks WHICH settlement week the
  cached text covers, so a genuinely new settlement (not just wall-clock
  time) is what triggers regeneration — see
  `app/src/stats/weeklyReview.ts`'s `shouldGenerateWeeklyReview()`.

```sql
alter table profiles
  add column nudge_state jsonb not null default '{}'::jsonb,
  add column role_prompt_dismissed_at timestamptz,
  add column ai_weekly_review text,
  add column ai_weekly_review_generated_at timestamptz,
  add column ai_weekly_review_week_ending text;
```

No RLS change needed — `profiles` is already owner-scoped. Reset All
Data (CLAUDE.md invariant #24): all five are sorted into the CLEARED
bucket — a reset should not leave stale nudge history/role-prompt-
dismissal/cached AI text behind for a "fresh" account. `supabase/
functions/reset-data/index.ts`'s `PROFILE_DATA_RESET` needs these five
field names added in the same pass that runs this migration.

- [ ] 49a run (add profiles nudge_state/role_prompt_dismissed_at/
      ai_weekly_review*)

---

## 50. Referral program + lifetime/complimentary accounts (owner decision 2026-08-24) — ✅ APPLIED

**PART 1 — REFERRAL PROGRAM.** `profiles.referral_code` (unique, e.g.
`BOZKA-7F2K`) is generated once per user by `handle_new_user()` at
signup — never client-generated for a real account (a client can't
safely guarantee DB-wide uniqueness on its own; `app/src/referral/
referralCode.ts`'s `generateReferralCode()` exists only for format
validation/tests, see that file's own header comment).
`profiles.referred_by` stores the raw CODE the user signed up with (an
audit-only denormalized string — the AUTHORITATIVE relationship, with
real user-id FKs and a status lifecycle, lives in the new `referrals`
table below). A referral becomes `qualified` only once the referred
person has confirmed their email, completed onboarding, imported a
document, and is still around 7+ days later
(`app/src/referral/qualification.ts` `resolveQualification()`) — a
signup alone earns nothing. Self-referral is blocked at signup time via
`normalize_email_for_referral()` (the SQL mirror of `app/src/referral/
selfReferral.ts`'s `isLikelySelfReferral()` — gmail/googlemail dot+tag
stripping, `+tag` stripping elsewhere; device-install-id matching is
explicitly OUT of this pass — neither `expo-application` nor
`expo-device` is an existing dependency, and adding either is a new
native module requiring a rebuild, not this OTA-safe pass). Every 3
qualified referrals grants 60 days of credit to the referrer (`app/src/
referral/reward.ts` `computeNewRewardGrants()`, derived from the raw
qualified count via floor division rather than a fragile separate
counter — see that file's own comment); the referred person gets 14
days on qualifying. Credits are recorded in the new `account_credits`
table (the currency for now, since billing doesn't exist yet — Session
10's billing provider consumes this balance automatically, see
PROMPTS.md). The referrer NEVER sees the referred person's real
identity — only a masked label (`app/src/referral/maskLabel.ts`
`buildMaskedReferralLabel()`: initials if a name exists, else "New
member (Month Year)") computed SERVER-SIDE (the `referral-sync` Edge
Function, the only thing with service_role access to the referred
person's real `owner_name`) and cached directly on the `referrals` row
— RLS on `profiles` already independently prevents the referrer from
reading the referred person's actual profile via any client-side join,
so this cached label is the only identity signal that ever reaches the
referrer.

**PART 2 — LIFETIME/COMPLIMENTARY ACCOUNTS.** `profiles.plan` (default
`'free_trial'`) plus `plan_note`/`plan_granted_at` — readable by the
owning user, but a `BEFORE UPDATE` trigger blocks ANY change to these
three columns unless the caller is `service_role` (an admin, via SQL —
see `docs/ADMIN_RUNBOOK.md`'s "Grant/List/Revoke a plan" recipes). This
is a genuinely NEW pattern for this codebase (every prior "admin-only"
column has been table-level — e.g. `tax_year_data`'s
service-role-write-only policy — Postgres RLS itself is row-level only,
it can't natively express "this column is user-read/admin-write while
these other columns on the SAME row are user-read/user-write," hence
the trigger). `app/src/entitlement/hasFullAccess.ts`'s `hasFullAccess()`
is the ONE helper every gated feature must read through — `lifetime`/
`complimentary`/`paid` all pass; Session 10's real billing provider
plugs into this same helper with zero feature-code changes once it
exists.

```sql
-- ============================================================
-- PART 1 — referral program
-- ============================================================

alter table profiles
  add column referral_code text unique,
  add column referred_by text;

create table referrals (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the REFERRER cascades their own referral history away (no
  -- one left to attribute rewards to — their account_credits rows are
  -- gone too via that table's own cascade). Deleting the REFERRED
  -- person's account, on the other hand, must NEVER retroactively wipe a
  -- reward the referrer already earned — "on delete set null" keeps this
  -- row (and therefore the referrer's already-granted credit, and their
  -- qualified/rewarded COUNT) intact, just with referred_user_id
  -- nulled out.
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

create index referrals_referrer_id_idx on referrals(referrer_id);

alter table referrals enable row level security;
-- SELECT only — no insert/update/delete policy for regular users AT ALL.
-- Every write comes from handle_new_user() (security definer, bypasses
-- RLS) or the referral-sync Edge Function (service_role, always bypasses
-- RLS) — a client literally cannot create/edit a referrals row itself.
create policy "referrals_select_own" on referrals
  for select using (referrer_id = auth.uid() or referred_user_id = auth.uid());

create table account_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  days integer not null check (days > 0),
  reason text not null,
  source_referral_id uuid references referrals(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz
);

create index account_credits_user_id_idx on account_credits(user_id);

alter table account_credits enable row level security;
-- Same "SELECT only, service_role writes" pattern as referrals above.
create policy "account_credits_select_own" on account_credits
  for select using (user_id = auth.uid());

-- Mirrors app/src/referral/selfReferral.ts's normalizeEmail() EXACTLY
-- (same "every trigger/Edge Function is self-contained, duplicates small
-- helpers rather than importing app/src code" convention as delete-account/
-- reset-data's own deleteStorageFolder() precedent) — gmail/googlemail
-- dot+tag stripping, +tag stripping elsewhere.
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
-- no 0/O/1/I). Bounded retry loop against the real unique constraint —
-- collision odds are astronomically low at any realistic user count, the
-- loop is defense-in-depth, not an expected path.
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
-- than adding a second trigger — one atomic place a new profiles row (and
-- now, optionally, a pending referrals row) gets created. Self-referral
-- is checked here, at creation time, so a blocked self-referral simply
-- never creates a referrals row at all (nothing to later un-qualify).
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

-- ============================================================
-- PART 2 — lifetime / complimentary accounts
-- ============================================================

alter table profiles
  add column plan text not null default 'free_trial' check (plan in ('free_trial', 'paid', 'lifetime', 'complimentary')),
  add column plan_note text,
  add column plan_granted_at timestamptz;

-- profiles ALREADY has a broad "owner can update their own row" policy
-- (company_name, locale, etc. all need normal user read/write) — RLS
-- itself can't scope write access down to just THESE three columns on
-- the same row, so a BEFORE UPDATE trigger is what actually enforces
-- "the user can read their own plan but never write it."
--
-- ALLOWED WRITERS, both checked (a client request never satisfies
-- either): (1) auth.role() = 'service_role' — the referral-sync/any
-- future admin Edge Function, called with the service_role key, whose
-- JWT claims literally say so; (2) current_user = 'postgres' — a human
-- admin running SQL directly in the Supabase Dashboard's SQL Editor
-- connects as the `postgres` role with NO request.jwt.claims set at
-- all, so auth.role() alone would NOT reliably read back 'service_role'
-- in that context — the ADMIN_RUNBOOK.md recipes below rely on this
-- second check to actually work.
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
```

No RLS change needed on `profiles` itself beyond the trigger above — it's
already owner-scoped (`profiles_owner_all`). Reset All Data (CLAUDE.md
invariant #24): `referral_code`/`referred_by`/`plan`/`plan_note`/
`plan_granted_at` are all deliberately KEPT (identity/entitlement-level,
same bucket as `company_name`/`role` — an unlisted column defaults to
KEPT per invariant #24's own rule, so no `reset-data` code change is
needed for these five specifically). `account_credits` (the resetting
user's OWN credit rows only) and `referrals` (rows where the resetting
user is `referrer_id` only — never `referred_user_id`, so someone else's
"who referred me" relationship is never touched by MY reset) ARE added
to `reset-data`'s explicit deletion list — see that Edge Function's own
updated file-header comment for the exact scoping.
`supabase/functions/delete-account/index.ts` needs the identical
`account_credits`/`referrals` scoping (own credits, own outgoing
referrals-as-referrer) added to its deletion list — the FK design above
(`referred_user_id on delete set null`) is what actually guarantees a
REFERRED person deleting their own account never wipes the REFERRER's
already-granted credit or qualified/rewarded count, independent of
whatever `delete-account`'s own explicit table list does or doesn't
touch.

- [x] 50a run (referral program: profiles.referral_code/referred_by,
      referrals table + RLS, account_credits table + RLS,
      normalize_email_for_referral(), generate_unique_referral_code(),
      updated handle_new_user())
- [x] 50b run (lifetime/complimentary: profiles.plan/plan_note/
      plan_granted_at, protect_profile_plan_fields() trigger)

---

## 51. AI cost control + usage limits + credit packs (owner decision 2026-08-24, FIVE ADDITIONS pass, PARTS 4 + 5) — ✅ APPLIED

Four new tables, none of them touched by Reset All Data or Delete Account's
own explicit deletion LOOPS (they're account-level, not business data —
spec item 8's "balances survive a reset of business data"); `ai_usage_log`/
`ai_credit_purchases` still disappear automatically on a REAL account
deletion via their `user_id ... on delete cascade` FK when
`delete-account`'s existing `auth.admin.deleteUser()` call removes the
`auth.users` row — no explicit entry needed in either Edge Function's
table list for that to work correctly.

**`ai_usage_log`** (PART 4 item 1 "log every ai-import/ai-advisor call" +
PART 5's actual enforcement source) — one row per call, success or
failure. Monthly usage is COUNT(*) of success rows this calendar month,
never a separately-maintained counter (no drift risk). Written by the
Edge Functions themselves via the caller's own JWT-scoped client (RLS
`user_id = auth.uid()` on INSERT — safe, since it's the SERVER doing the
insert on behalf of the authenticated caller, not something the app UI
can forge a row for on someone else's behalf).

**`ai_usage_config`** — one singleton row, service-role-write-only
(admin-adjustable ceiling "without a release," spec item 5.1).

**`service_status`** (PART 4 item 3) — one row per AI feature, everyone
reads, only service_role/admin writes (docs/ADMIN_RUNBOOK.md's own
set/clear recipe).

**`ai_credit_purchases`** (PART 5 items 4+6) — owner-granted rows for now
(same admin SQL recipe as lifetime plans); INSERT is admin-only (no
policy for authenticated users), but UPDATE is self-scoped so the
server-side consumption logic inside ai-import (running as the
authenticated caller's own JWT) can decrement `credits_remaining` without
needing service_role for that one operation.

```sql
create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('ai_import', 'ai_advisor')),
  success boolean not null,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index ai_usage_log_user_month_idx on ai_usage_log(user_id, call_type, created_at);

alter table ai_usage_log enable row level security;
create policy "ai_usage_log_select_own" on ai_usage_log
  for select using (user_id = auth.uid());
create policy "ai_usage_log_insert_own" on ai_usage_log
  for insert with check (user_id = auth.uid());
-- No update/delete policy — append-only audit log, by design.

create table ai_usage_config (
  id boolean primary key default true check (id),
  imports_per_truck_per_month integer not null default 60,
  account_ceiling integer,
  updated_at timestamptz not null default now()
);

alter table ai_usage_config enable row level security;
create policy "ai_usage_config_select_all" on ai_usage_config
  for select using (true);
-- No write policy for authenticated users — service_role/admin only
-- (docs/ADMIN_RUNBOOK.md's own "adjust the AI import allowance" recipe).

insert into ai_usage_config (id) values (true) on conflict (id) do nothing;

create table service_status (
  service text primary key check (service in ('ai_import', 'ai_advisor')),
  status text not null default 'ok' check (status in ('ok', 'degraded', 'down')),
  message text,
  updated_at timestamptz not null default now()
);

alter table service_status enable row level security;
create policy "service_status_select_all" on service_status
  for select using (true);
-- No write policy for authenticated users — service_role/admin only.

insert into service_status (service, status) values
  ('ai_import', 'ok'),
  ('ai_advisor', 'ok')
on conflict (service) do nothing;

create table ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_type text not null check (pack_type in ('pack_25', 'pack_100', 'pack_300', 'catchup_year')),
  credits_granted integer not null check (credits_granted > 0),
  credits_remaining integer not null check (credits_remaining >= 0),
  granted_at timestamptz not null default now(),
  expires_at timestamptz -- null for the 3 fixed packs; set (granted_at + 90 days) for catchup_year
);

create index ai_credit_purchases_user_idx on ai_credit_purchases(user_id);

alter table ai_credit_purchases enable row level security;
create policy "ai_credit_purchases_select_own" on ai_credit_purchases
  for select using (user_id = auth.uid());
create policy "ai_credit_purchases_update_own" on ai_credit_purchases
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No insert/delete policy for authenticated users — a purchase (or grant)
-- is always recorded by an admin via SQL (docs/ADMIN_RUNBOOK.md), never a
-- client-writable row; UPDATE is allowed self-scoped ONLY so the
-- server-side (still user-JWT-scoped) credit-consumption logic inside
-- ai-import/index.ts can decrement credits_remaining.
```

`app/src/usage/aiUsage.ts` is the pure client-side mirror of this
enforcement math (allowance calc, soft/hard limit thresholds, credit
consumption order, Catch-Up pack expiry) — `supabase/functions/
ai-import/index.ts`'s own inline copy (checkAiImportUsageAllowed /
consumeOneCreditIfOverAllowance / logAiUsage) is the actual, authoritative
server-side gate; the two are duplicated by necessity (Deno can't import
app/src TS) and cross-referenced by comment, same convention as every
other Edge Function in this repo.

- [x] 51a run (ai_usage_log table + RLS)
- [x] 51b run (ai_usage_config table + RLS + seed row)
- [x] 51c run (service_status table + RLS + seed rows)
- [x] 51d run (ai_credit_purchases table + RLS)

---

## Also still open (not part of any pass above)

- `supabase gen types` needs to be re-run against `app/src/types/db.ts` —
  this requires the project's own Supabase credentials/project ref, which
  this environment doesn't have (`npx supabase login` + `supabase link` +
  `supabase gen types typescript --linked > app/src/types/db.ts`, run by
  whoever has dashboard access). `db.ts` has been hand-maintained in step
  with every PENDING_SQL section as it shipped (all of tax_config,
  tax_year_data, household_members, household_income, equipment,
  misc_income, benchmarks, and settlements.business_balance_credit
  already have matching TS types) — this item is about catching any
  SILENT drift a hand-edit could have missed (a renamed/dropped column,
  a constraint that changed shape), not about missing types outright.
- MA's own `flat` rate entry (see the note at the end of section 3) —
  not yet part of a verification pass.
- ~~No follow-up migration file exists yet consolidating sections 1, 3,
  and 4~~ — RESOLVED 2026-08-02:
  `supabase/migrations/0002_consolidated_pending_sql.sql` replays every
  applied section (1, 3-36) as one idempotent file (see its own header for
  the full rationale, including two real ordering/content bugs the
  consolidation itself caught — §17's two SQL blocks were fenced in
  explanation order rather than execution order, and §34's second fenced
  block was a diagnostic query, not migration SQL). It was assembled from
  this file's own text, NOT verified against the live database (this
  environment has no credentials to do that) — review it against the
  actual Supabase dashboard schema before trusting it for anything
  destructive. Section 37 is the one applied section NOT yet folded into
  0002 (it was applied via `pending_37.sql`, run directly, after 0002 was
  assembled) — fold it into 0002 or a new 0003 file the next time this
  snapshot gets revisited.
