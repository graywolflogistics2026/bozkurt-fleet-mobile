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

## 49. Smart alerts + proactive AI Coach state (NEXT PASS, owner decision 2026-08-24, items D + E) — ✅ APPLIED (confirmed live 2026-08-26 during the P0 audit-fix pass — see §59's own note; this file's own `[ ]` marker had simply never been updated after the migration was actually run)

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

- [x] 49a run (add profiles nudge_state/role_prompt_dismissed_at/
      ai_weekly_review*) — CONFIRMED via a live read-only
      `information_schema.columns` query against the linked project
      (`supabase db query --linked`) during the P0 audit-fix pass: all
      five columns exist on the live `profiles` table. The audit that
      flagged this as an open risk was correct to flag it (the doc's own
      marker really did say "not yet run," and Reset All Data's own
      column-dependent final step really would have failed had that been
      true) — it just turned out to already be applied; the marker had
      only never been updated.

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

## 52. Carrier-scoped payroll/settlement codes (owner decision, CARRIER-SCOPED PAYROLL CODES pass) — ✅ APPLIED

CARRIER ISOLATION IS A HARD INVARIANT (see CLAUDE.md's own dated entry) —
a two-letter settlement code means what it means AT THE CARRIER THAT
ISSUED THE STATEMENT ONLY. This section adds the data model for it:
`carrier_code_maps` (global reference data, one row per carrier+code,
admin-maintained like `tax_year_data` — CLAUDE.md invariant #6's "never
hardcode, always server-sourced" pattern extended to this new domain),
`settlements.carrier` (persists the AI's own extracted carrier text so
future screens/corrections can look it up without re-parsing the
document), and `category_learning_rules.carrier` (nullable — null means
"applies to any carrier," the existing behavior for every rule learned
before this column existed; a real carrier value scopes a rule to that
carrier only, so a correction learned on a Prime settlement can never
silently apply to a Landstar/Schneider/Werner document).

Seeded with PRIME INC's full code list this pass (205 rows, reconciled
by hand from an owner-provided reference sheet — see
`docs/CARRIER_CODES.md` for the human-readable mirror and the handful of
rows flagged "verify against Prime documentation" where the source scan
was unclear). Every OTHER carrier starts with ZERO seeded rows and
learns only from that carrier's own documents and that user's own
corrections — never copies another carrier's code meanings.

```sql
create table carrier_code_maps (
  id uuid primary key default gen_random_uuid(),
  carrier text not null,
  code text not null,
  sub_code text,
  label text not null,
  description text,
  -- Canonical category (docs/INDUSTRY_TAXONOMY.md §B) or null — null means
  -- "leave this code to the generic description-based classifier," used
  -- deliberately for income/bonus/administrative-balance codes that aren't
  -- an expense line at all, and for a handful of genuinely ambiguous rows
  -- (see docs/CARRIER_CODES.md's Notes column) rather than guessing.
  category text,
  -- null = not an expense line at all (income/administrative); true/false
  -- only meaningful when category is set.
  is_deductible boolean,
  income_or_chargeback text check (income_or_chargeback in ('income', 'chargeback')),
  notes text,
  created_at timestamptz not null default now(),
  unique (carrier, code, sub_code)
);

create index carrier_code_maps_carrier_idx on carrier_code_maps(carrier);

alter table carrier_code_maps enable row level security;
create policy "carrier_code_maps_select_all" on carrier_code_maps
  for select using (true);
-- No write policy for authenticated users — service_role/admin only,
-- same pattern as tax_year_data/ai_usage_config/service_status.

alter table settlements
  add column carrier text;

alter table category_learning_rules
  add column carrier text;

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
  ('PRIME INC', 'LU', 'LOAD', 'LD/UNLD TRLR', 'Paid to operator for loading or unloading at the customer’s dock', null, null, 'income', null),
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
  ('PRIME INC', 'XW', 'XPAY', 'WAIT 4 TRL REPR', '$25 per hour up to 3 hrs to wait for trailer to be repaired, that was another driver’s responsibility', null, null, 'income', null),
  ('PRIME INC', 'YS', null, 'SAFTY INCV SOLO', 'Added pay for no preventable accidents during last 13 weeks (solo)', null, null, 'income', null),
  ('PRIME INC', 'YT', null, 'SAFTY INCV TEAM', 'Added pay for no preventable accidents during last 13 weeks (team)', null, null, 'income', null),
  ('PRIME INC', 'YW', 'YARDW', 'YARD WORK W/C', null, null, null, 'income', null);
```

No RLS change needed on `category_learning_rules` beyond what already
exists (owner-scoped) — the new `carrier` column is just another
nullable field on an already user-owned row.

- [x] 52a run (carrier_code_maps table + RLS + PRIME INC seed, 205 rows)
- [x] 52b run (settlements.carrier, category_learning_rules.carrier)

---

## 53. Carrier-scoped bridge codes for real-world text variants (owner decision 2026-08-24, cleanup of the pre-existing generic-classifier leak flagged in CLAUDE.md's CARRIER-SCOPED PAYROLL/SETTLEMENT CODES entry) — ✅ APPLIED

The §52 pass added the carrier-isolation data model and a hard invariant,
but two PRE-EXISTING code paths that predate that invariant were left
carrying a handful of Prime Inc-specific chargeback-code fragments applied
GLOBALLY: `app/src/import/category.ts`'s generic `classifySettlementLine()`
classifier, and the `ai-import` Edge Function's own older
"settlement-line classifier" prompt text. Both are now cleaned up (see the
same-dated CLAUDE.md entry for the full account) — every carrier-specific
code fragment (Prime's own "EXTEND WR PURCH", "ACCOUNTING SERV",
"EZ FAST LN", "WIRE CHARGE", "FUEL CARD CHARGE", "TRIP XPRESS",
"STATEMENT PREPARATION", "PRIME POINT-OF-SALE") was removed from the
generic path and belongs ONLY in `carrier_code_maps`, scoped to
`'PRIME INC'`. The genuinely generic, carrier-neutral rules (spelled-out
"extended warranty"/"service contract" wording, bare "lumper", the literal
IRS term "Federal Highway Use Tax", third-party ELD/telematics vendor
brand names — Qualcomm/Geotab — and toll-transponder brands — PrePass/
Drivewyze/EZPass, and the generic "company store" concept) were
deliberately left in the generic classifier — see the CLAUDE.md entry for
why each of those is judged carrier-neutral rather than Prime-specific.

These 8 new rows bridge real-world-observed text forms (seen verbatim on
an actual device import) that don't exactly match the spelling of the
already-seeded §52 reference-sheet rows — `findCarrierCodeMatch()` only
matches a literal (word-boundary) substring in ONE direction (the stored
code/label must appear inside the description text), so e.g. the already-
seeded label "EZ FAST LN TOLL" does NOT match observed description text
"EZ FAST LN" (missing the "TOLL" suffix). No collision with any of the
205 already-seeded rows — every new `code` value here is a distinct
string. "IMAGE TRIPS" needed no new row — the existing `IM`/`FDEX 02` row
already carries that exact string as its own label, which the existing
label-fallback match already resolves. "ADV FOR OUTSIDE LUMPER" also
needed no new row — the existing `LM`/`LMPR` row's label "OUTSIDE LUMPER"
is already a literal substring of that description, and the generic
classifier's own bare "lumper" rule catches it for any carrier regardless.
"STATEMENT PREPARATION" is bridged to `'Legal & Professional Services'`
(not `'Office & Admin'`) to match the already-seeded `OS`/`OPER STMT COST`
row's own category exactly — the same real-world charge under one label.

```sql
insert into carrier_code_maps (carrier, code, sub_code, label, description, category, is_deductible, income_or_chargeback, notes) values
  ('PRIME INC', 'EXTEND WR PURCH', null, 'Extended Warranty Purchase', 'Real-world code text observed verbatim on an actual statement — no existing §52 reference-sheet row covers an extended-warranty PURCHASE (only the unrelated income codes W1/W2/WR, which credit money back for a repair, not a purchase).', 'Warranty & Service Contracts', true, 'chargeback', null),
  ('PRIME INC', 'ACCOUNTING SERV', null, 'Accounting Service (abbreviated)', 'Bridges the already-seeded AS/MISC 16 "ACCOUNTING SERVICE" row''s fuller spelling to this shorter real-world form.', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'EZ FAST LN', null, 'EZ Fast Lane Toll', 'Bridges the already-seeded EZ row''s label "EZ FAST LN TOLL" — observed verbatim without the trailing "TOLL" suffix.', 'Tolls & Scales', true, 'chargeback', null),
  ('PRIME INC', 'WIRE CHARGE', null, 'Wire Charge', 'Distinct from the already-seeded WP/ADV 01 "WIRE PAYCHECK" row (sending a paycheck via Comcheck) — this is a bank wire fee, a different charge.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'FUEL CARD CHARGE', null, 'Fuel Card Charge (spelled out)', 'Bridges the already-seeded FC/MISC 15 "FUEL CARD CHG" row''s abbreviation to this spelled-out real-world form.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'TRIP XPRESS', null, 'Trip Xpress Charge', 'Bridges the already-seeded TX/FDEX 01 "TRIP XPRESS CHG" row — observed verbatim without the trailing "CHG" suffix.', 'Bank & Merchant Fees', true, 'chargeback', null),
  ('PRIME INC', 'STATEMENT PREPARATION', null, 'Statement Preparation Fee', 'Bridges the already-seeded OS "OPER STMT COST" row (same real charge, different real-world wording) — category matches OS''s own "Legal & Professional Services", not a new bucket.', 'Legal & Professional Services', true, 'chargeback', null),
  ('PRIME INC', 'POINT-OF-SALE', null, 'Point of Sale Purchase (hyphenated)', 'Bridges the already-seeded PO/PPOS 01 "POINT OF SALE" row (spaced) to this hyphenated real-world form (e.g. "PRIME POINT-OF-SALE") — the un-hyphenated spaced form already matches via the existing row''s own label.', 'Meals (per diem covered)', false, 'chargeback', null);
```

- [x] 53a run (8 new PRIME INC carrier_code_maps bridge rows)

---

## 54. import_jobs table (BACKGROUND IMPORT, owner decision 2026-08-24) — ✅ APPLIED

The real fix for "an import feels slow" isn't more speed, it's not
making the user watch it happen. `import_jobs` is the one server-tracked
row a background settlement/document extraction lives in — created the
instant the user picks a file (after it's uploaded to Storage), updated
progressively as pages are processed by `ai-import`'s new job mode
(`EdgeRuntime.waitUntil()`-driven background work, see CLAUDE.md's own
dated entry for the full design), and read by the client via polling
(`app/src/data/importJobs.ts`) to drive a persistent status chip, a jobs
list, and a local "ready to review" notification. `result_json` holds
the RAW MERGED EXTRACTION only — nothing is ever auto-saved to the
ledger from a job; the user still confirms through the exact same
preview/reconciliation-guard/needs-review flow as a live import.
`storage_path` is what makes RETRY possible without re-picking the file
— a retry re-reads the same uploaded bytes and restarts processing on
the SAME job row.

```sql
create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Reserved for a future save-time linkage (once the user confirms and
  -- saves, the resulting documents.id could be written back here) — not
  -- populated by this pass, nothing reads it yet.
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

create index import_jobs_user_id_idx on import_jobs(user_id, created_at desc);

alter table import_jobs enable row level security;
create policy "import_jobs_select_own" on import_jobs
  for select using (auth.uid() = user_id);
create policy "import_jobs_insert_own" on import_jobs
  for insert with check (auth.uid() = user_id);
create policy "import_jobs_update_own" on import_jobs
  for update using (auth.uid() = user_id);
create policy "import_jobs_delete_own" on import_jobs
  for delete using (auth.uid() = user_id);
```

`user_id ... on delete cascade` means `delete-account` needs NO explicit
table-list entry (same precedent as `drivers` — `auth.admin.deleteUser()`
cleans it up automatically); `reset-data` DOES need one (it never deletes
the auth user) — added to `TABLES_IN_DELETION_ORDER` there. The raw
uploaded file lives under the EXISTING `documents` Storage bucket at
`{user_id}/import-jobs/...`, so both functions' already-recursive
`{user_id}/` storage-folder walk sweeps it up with no bucket-list change
needed. Deliberately NOT added to `exportAllData.ts`'s `EXPORT_TABLES` —
this is transient job/processing state, not a permanent financial record
a "export all my data" dump is for (same reasoning `ai_usage_log`/
`service_status` are excluded from that list).

- [x] 54a run (import_jobs table + RLS + index)

---

## 55. reviewed_at columns + compliance_items expansion (owner decision 2026-08-24, device testing round) — ✅ APPLIED

Three device-testing items, one schema pass:

**55a — NEEDS REVIEW WON'T CLEAR**: there was no "mark reviewed" action
anywhere in the app — a flagged deduction (description prefixed "NEEDS
REVIEW: ") or a flagged document/settlement (linked document's
`parsed_json.confidence === 'low'`) had no way to be dismissed, so it
stayed flagged forever regardless of the user reviewing it. `reviewed_at`
on both tables is the explicit override `src/import/needsReview.ts`'s
`isDeductionNeedsReview()`/`isDocumentNeedsReview()` now check — set once
by a new "Mark reviewed" action, never touched by AI import (which only
ever sets the ORIGINAL two signals, never this column). A deduction's own
"NEEDS REVIEW: " prefix is ALSO stripped from its description as a
cosmetic cleanup when marked reviewed (see aiImportSave.ts is untouched —
this happens client-side, in the mark-reviewed mutation, not at import
time), but `reviewed_at` is the CANONICAL signal every check actually
reads, so the flag clears reliably even if the description text doesn't
exactly match the expected prefix pattern for some edge-case reason.

**55b — compliance_items expansion**: manual entries need a much richer
field set than the 4 the add form currently has (type/label/due_date/
recurrence) — `issue_date`, `reminder_lead_days` (per-item override of
the previously-fixed 30-day due-soon threshold — null keeps the existing
30-day default, so every already-seeded row is unaffected), `note`,
`truck_id`/`driver_id` (optional, only meaningful when `applies_to` is
`'truck'`/`'driver'`), and `applies_to` (`'truck'|'trailer'|'driver'|
'business'` — nullable, existing AI-populated rows never set it, meaning
"unspecified" — 'trailer' has no FK of its own since this schema folds
trailer fields into `trucks` rather than a separate table, so it's a
label-only category). Attachments reuse the EXISTING `source_document_id`
column (already meant for "the document this compliance item is backed
by," previously only ever set by AI auto-population — a manually
uploaded photo/PDF now populates the exact same column via the same
Storage-upload-then-documents-row-insert pattern the rest of this app
already uses, not a new column).

```sql
alter table deductions
  add column reviewed_at timestamptz;

alter table documents
  add column reviewed_at timestamptz;

alter table compliance_items
  add column issue_date date,
  add column reminder_lead_days integer,
  add column note text,
  add column truck_id uuid references trucks(id) on delete set null,
  add column driver_id uuid references drivers(id) on delete set null,
  add column applies_to text check (applies_to in ('truck', 'trailer', 'driver', 'business'));
```

No RLS changes needed on any of the three tables — all new columns are
just additional fields on already row-level-secured, already user-scoped
tables.

- [x] 55a run (deductions.reviewed_at, documents.reviewed_at)
- [x] 55b run (compliance_items: issue_date, reminder_lead_days, note, truck_id, driver_id, applies_to)

---

## 56. ai_rate_limit_state table + import_jobs 'waiting_to_retry' status (owner decision 2026-08-24, "Edge Function returned a non-2xx status code" bug fix pass, items 1+3) — ✅ APPLIED

Two changes, both about making a real Anthropic rate limit a coordinated,
visible, recoverable event instead of every queued item independently
failing:

**`ai_rate_limit_state`** — a single GLOBAL row (every user of this app
shares ONE Anthropic API key, server-side only, CLAUDE.md's own standing
rule — a 429 from Anthropic is an account-wide signal, not a per-user
one). Written ONLY by `ai-import` itself via a NEW service-role client in
that function (matching delete-account/reset-data/referral-sync's own
established `SUPABASE_SERVICE_ROLE_KEY` precedent) the instant a real
Anthropic 429 comes back; read by EVERY call this function makes (image,
single-call PDF, every individual page, in every job, for every user)
before it ever calls Anthropic — this is the actual cross-job "pause the
queue" mechanism: once any one call gets rate-limited, every other
in-flight or about-to-start call anywhere immediately short-circuits to a
safe `rate_limited` result instead of also hammering Anthropic and also
failing independently.

```sql
create table ai_rate_limit_state (
  id boolean primary key default true check (id),
  limited_until timestamptz,
  last_reason text,
  updated_at timestamptz not null default now()
);

alter table ai_rate_limit_state enable row level security;
create policy "ai_rate_limit_state_select_all" on ai_rate_limit_state
  for select using (true);
-- No write policy for authenticated users — written only by ai-import's
-- own service-role client, same "everyone reads, only the server writes"
-- pattern as tax_year_data/ai_usage_config/service_status.

insert into ai_rate_limit_state (id) values (true) on conflict (id) do nothing;
```

**`import_jobs.status` gains `'waiting_to_retry'`** — a background job
that hits a rate limit now PAUSES (this status) and automatically retries
with exponential backoff (server-side, `runJobInBackground`'s
`withRateLimitBackoff()`) instead of immediately failing; the client's
jobs list/chip (`app/src/import/importJobs.ts`) renders this distinctly
from both "processing" and "failed" so it never looks stuck.

```sql
alter table import_jobs drop constraint import_jobs_status_check;
alter table import_jobs add constraint import_jobs_status_check
  check (status in ('queued', 'processing', 'waiting_to_retry', 'ready', 'failed'));
```

- [x] 56a run (ai_rate_limit_state table + RLS + seed row)
- [x] 56b run (import_jobs.status constraint — adds 'waiting_to_retry')

---

## 57. Cash Flow forecast overrides (owner decision, "build it from the user's own data" pass) — ✅ APPLIED

The 30-day Cash Flow forecast no longer requires manual weekly budget
entry — it classifies the user's own trailing settlements/deductions/
fuel/maintenance/tolls into recurring fixed charges, a variable $/mile
rate, and known periodic bills (`app/src/stats/cashFlowClassification.ts`/
`cashFlowPeriodic.ts`/`cashFlowForecast.ts`). `cf_weekly_revenue`/
`cf_truck_payment`/`cf_fuel_weekly`/`cf_insurance_weekly`/
`cf_other_weekly` (§29/§39) are DEPRECATED by this — left in place as
harmless unused columns, same precedent as `cf_insurance_monthly`
already sitting there. `cf_bank_balance`/`cf_tax_reserve_pct` are
unchanged (still the two manual inputs, neither derivable from the
user's own data).

Three new columns let the user override any ONE of the three computed
weekly figures (income/fixed/variable) — an override always wins over
the computed average and persists independently of it, so a later
import that changes the underlying data can never silently discard a
manual correction. A dated periodic item (HVUT 2290, IRP, insurance
renewal, inspection) is an individual event, not a weekly rate, so its
override is a flexible per-item jsonb map
(`compliance_items.id -> overridden dollar amount`) rather than a
normalized column — same "flexible per-key user state" pattern as
`profiles.nudge_state`.

```sql
alter table profiles
  add column cf_income_override numeric(12,2),
  add column cf_fixed_override numeric(12,2),
  add column cf_variable_override numeric(12,2),
  add column cf_periodic_overrides jsonb not null default '{}'::jsonb;
```

`reset-data`'s `PROFILE_DATA_RESET` was updated to clear all four new
columns (CLAUDE.md invariant #24's own rule: an unlisted new `profiles`
column is silently KEPT, not the safe default here — a "reset" account
must not retain a stale manual override). No new query-invalidation key
is needed — these are new fields on the already-invalidated `'profile'`
row, not a new table.

- [x] 57a run (profiles.cf_income_override/cf_fixed_override/cf_variable_override/cf_periodic_overrides)

---

## 58. profiles.plan gains 'owner' (owner/dev account flag, owner decision) — ✅ APPLIED (confirmed live 2026-08-26 — see §59's note)

`profiles.plan` (docs/PENDING_SQL.md §50) gains a 5th value, `'owner'` —
the app owner's/developer's own account, for heavy testing without
hitting the AI-import allowance (docs/PENDING_SQL.md §51) and without
skewing usage/cost analytics (docs/ADMIN_RUNBOOK.md's own reporting
queries, updated to exclude it by default). Same column-level protection
as `'lifetime'`/`'complimentary'` already had — `protect_profile_plan_fields()`
(§50) protects the whole `plan` column regardless of value (service_role
or the `postgres` role only), so a client can never set this value
either; no trigger change needed, only the CHECK constraint widens.

```sql
alter table profiles drop constraint profiles_plan_check;
alter table profiles add constraint profiles_plan_check
  check (plan in ('free_trial', 'paid', 'lifetime', 'complimentary', 'owner'));
```

See docs/ADMIN_RUNBOOK.md's "Owner/Dev Account" section for the grant/
revoke recipe (same style as the existing lifetime-plan recipe).

- [x] 58a run (profiles_plan_check widened to include 'owner') —
      CONFIRMED via a live `pg_constraint` query during the P0
      audit-fix pass: `profiles_plan_check` already includes `'owner'`
      on the live database.

---

## 59. AI credit self-grant RLS hole (P0 SECURITY FIX, FULL SYSTEM AUDIT, owner decision 2026-08-26) — ✅ APPLIED (run via pending_59_60.sql, ai-import redeployed, client update published to preview)

**The finding**: `ai_credit_purchases_update_own` (§51) grants every
authenticated user an unrestricted self-service UPDATE on their own
`ai_credit_purchases` row — `for update using (user_id = auth.uid())
with check (user_id = auth.uid())`, no column restriction at all. This
policy was written so the server-side consumption logic inside
`ai-import/index.ts` (running as the caller's own JWT-scoped client,
never service_role) could decrement `credits_remaining` — but RLS
cannot distinguish "the app's own trusted code path" from the same
user hitting the REST API directly with their own valid JWT. **Any
authenticated user could `PATCH` their own row to
`credits_remaining: 999999` and permanently bypass the entire
monthly-allowance/credit-pack cost-control system** — confirmed live
via `pg_policies` during the audit, not just read from this file.

Cross-checked every OTHER business-critical table for the same shape
("any value the business depends on — usage counters, plan, allowances,
referral status, account_credits, ai_usage_log — must be
server-controlled") by dumping every `INSERT`/`UPDATE`/`ALL` RLS policy
in the `public` schema against the live database. Result: **this table
was the only one with the hole.** `ai_usage_log` is insert-own-only, no
update/delete (a forged row can only ever push the forger's OWN usage
count UP, never down — self-limiting, not exploitable for gain).
`ai_usage_config`/`service_status`/`tax_year_data`/`carrier_code_maps`/
`benchmarks` have zero write policies for `authenticated` at all
(service-role-only by omission, correct). `referrals`/`account_credits`
are SELECT-only already — confirmed live, matching what this doc's own
§50 prose already claimed. `profiles.plan`/`plan_note`/`plan_granted_at`
are genuinely protected by the `protect_profile_plan_fields()` trigger
(§50) — traced for a bypass path, found none. The one other table with
any self-service UPDATE at all, `import_jobs` (`auth.uid() = user_id`,
§54), was reviewed and is NOT a fix target: a user tampering with their
own job's `status`/`result_json` can only ever inject fabricated
extraction data into THEIR OWN review-and-Save flow — the exact same
thing the app's own manual-entry forms already let them do freely — it
does not touch `ai_usage_log`/billing/allowance accounting at all
(logged separately, server-side, keyed off the real Anthropic call, not
off `import_jobs.status`), so there is no unearned value or
cost-control bypass available through it.

**The fix, two parts, closing the P1 TOCTOU race from the same audit at
the same time** (the old `consumeOneCreditIfOverAllowance()` did a
plain client-side `select` → sort → `update({credits_remaining: n -
1})` — a classic read-then-write race: two concurrent calls that both
read the same starting `credits_remaining` could both write back `n -
1`, losing a decrement and handing out a free credit, independent of
the RLS hole above):

1. Drop the vulnerable policy — users get SELECT-only on
   `ai_credit_purchases` from here on, matching the already-correct
   `referrals`/`account_credits` pattern.
2. A new `consume_ai_import_credit()` RPC does the ENTIRE "pick the
   best pack, lock it, decrement it" operation as one atomic
   transaction: `security definer` (so it can write despite the now-
   absent UPDATE policy — Supabase's migration-runner role owns it,
   which bypasses RLS the same way `protect_profile_plan_fields()`'s
   own header comment documents for the `postgres` role) but derives
   the user EXCLUSIVELY from `auth.uid()` internally — never a
   parameter, so it can't be tricked into consuming a different user's
   credit even in principle (same "derive identity from the JWT, never
   trust a caller-supplied id" precedent as `reset-data`/
   `delete-account`/`referral-sync`). `select ... for update` (no
   `skip locked` — a single user's own few rows are never a
   high-contention path, and BLOCKING is exactly what fixes the race:
   a second concurrent call waits for the first's transaction to
   commit, then sees the ALREADY-decremented value before applying its
   own decrement, instead of both starting from the same stale read).
   Returns the consumed pack's id, or `null` when no credit is
   available (a normal, non-error outcome the caller already handled).
3. `credits_remaining <= credits_granted` is now a real CHECK
   constraint — defense in depth against any future write path
   (including a human admin typo via the `docs/ADMIN_RUNBOOK.md` grant
   recipe) ever setting a pack above what it was actually granted.

```sql
-- 1. Close the hole.
drop policy if exists "ai_credit_purchases_update_own" on ai_credit_purchases;

-- 2. credits_remaining can never exceed what was actually granted.
alter table ai_credit_purchases
  add constraint ai_credit_purchases_remaining_le_granted
  check (credits_remaining <= credits_granted);

-- 3. Atomic, row-locked, auth.uid()-scoped credit consumption.
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
  -- ("use it or lose it") — same order app/src/usage/aiUsage.ts's
  -- planCreditConsumption() already established client-side for display.
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
```

`supabase/functions/ai-import/index.ts`'s `consumeOneCreditIfOverAllowance()`
now calls this RPC instead of doing its own select+sort+update — see
that file for the updated call site.

- [x] 59a run (drop the vulnerable ai_credit_purchases UPDATE policy,
      add the credits_remaining<=credits_granted constraint, create
      consume_ai_import_credit())

---

## 60. Balance-ledger atomicity — 4 sites (P0 MONEY-CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision 2026-08-26) — ✅ APPLIED (run via pending_59_60.sql; app/src/data/capitalTransactions.ts and aiImportSave.ts are pure client-side, no Edge Function redeploy needed for this section specifically — reset-data was separately redeployed the same pass for its own preflight fix; client update published to preview)

**The finding**: four separate call sites wrote a "this delta has been
applied" tracking column to a row (`capital_transactions.
business_balance_applied` in three places, `settlements.
business_balance_credit` in the fourth) in a SEPARATE client-side step
BEFORE calling `apply_business_balance_delta` (§37/§38) to actually
apply that delta to `profiles.business_balance`. If the RPC step ever
failed (network drop, transient DB error) after the row write had
already succeeded — genuinely possible, not hypothetical, since none of
these are wrapped in a database transaction — the row was left
PERMANENTLY claiming a delta that was never actually applied, with no
rollback and no reconciliation path:

- **Insert** (`useRecordManualCapitalTransaction`,
  `useReimburseMyself`): the row is created with the delta already
  recorded; if the RPC then fails, the delta is stuck-recorded-but-
  unapplied.
- **Update** (`useUpdateManualCapitalTransaction`): same shape.
- **Delete** (`useDeleteManualCapitalTransaction`) — the worst case: the
  row was deleted BEFORE the reversal RPC ran. If the RPC failed, the
  only record of what needed reversing was already gone — permanent,
  undiagnosable drift, unlike the other three which at least leave
  evidence behind.
- **Settlement import** (`aiImportSave.ts`) — worse still in a
  different way: `business_balance_credit` was written into the
  settlement row at INSERT/UPDATE time, before 6 batched child-table
  inserts, a loans-upsert loop, and (on re-import) 5 delete calls — ANY
  of which can throw. A retry after such a failure would then read its
  OWN stale `business_balance_credit` back as `previousCredit`, compute
  a delta of ZERO against itself, and skip the RPC entirely — the
  settlement's real net pay silently NEVER applied to the balance, even
  on a clean, fully-successful retry, with no error anywhere.

**The fix**: fold the row write and the balance-delta application into
ONE atomic RPC transaction per site — either both happen or neither
does, so a partial failure can never again leave a row and the balance
disagreeing. Every RPC computes its own delta INTERNALLY from a fresh,
row-locked read of the row's current state — never from a value the
client captured earlier and might be trusting stale (a second,
independent correctness improvement beyond pure atomicity: the OLD
`useUpdateManualCapitalTransaction` trusted a client-passed
`previousBalanceApplied` parameter that could theoretically be stale if
the client's local state hadn't refetched between two edits — the new
RPC reads it fresh, under a row lock, every time).

- **Insert**: `record_manual_capital_transaction()` — inserts the
  `capital_transactions` row (computing
  `business_balance_applied = case when tx_type='contribution' then
  amount else -amount end` itself, the exact same formula
  `app/src/stats/capitalAccount.ts`'s `manualTransactionBalanceDelta()`
  already documents — that JS function and its sibling
  `computeManualTransactionBalanceAdjustment()` are now DEAD CODE, no
  longer called from anywhere; deliberately NOT deleted in this pass to
  keep this fix's blast radius to exactly the atomicity bug — flagged as
  a P2 cleanup follow-up, not silently left unmentioned) and applies the
  delta to `profiles.business_balance`, atomically. `p_linked_deduction_id`
  (nullable) lets ONE function serve both `useRecordManualCapitalTransaction`
  (null) and `useReimburseMyself` (set) — a reimbursement is just a draw
  linked to the deduction its contribution came from, same dual-purpose
  `linked_deduction_id` column this codebase already established.
- **Update**: `update_manual_capital_transaction()` — row-locks the
  EXISTING row, reads its CURRENT `business_balance_applied` fresh
  (never trusts a client-passed value), computes the adjustment, updates
  both the row and the balance together.
- **Delete**: `delete_manual_capital_transaction()` — row-locks and
  reads the row FIRST, reverses the balance, and ONLY THEN deletes the
  row — inside one transaction, so if the reversal fails for any reason
  the whole transaction rolls back and the row is NEVER deleted. This is
  the literal fix for "delete is worst — the row must survive until the
  reversal succeeds."
- **Settlement import**: `apply_settlement_business_balance_credit()` —
  row-locks the settlement, reads its CURRENT `business_balance_credit`
  fresh, computes the delta against the NEW net pay, updates both the
  settlement row and the balance together. `app/src/data/aiImportSave.ts`
  no longer writes `business_balance_credit` at settlement insert/update
  time AT ALL — this RPC, called only after every child row and the
  re-import cleanup have already succeeded, is now the ONLY place that
  column ever changes, always in lockstep with the actual balance
  application.

All four are `security invoker` (run as the calling user, same pattern
as `apply_business_balance_delta` — RLS on both `capital_transactions`/
`settlements` (owner-scoped `ALL`) and `profiles` (owner-scoped `ALL`)
already permits everything each function does for its own row; no
elevated privilege needed), and every one derives the acting user from
an explicit `p_user_id` parameter cross-checked against `auth.uid()`
(never trusts the parameter alone), same defense-in-depth style as
`apply_business_balance_delta` itself.

```sql
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
  -- raised, this line never runs and the whole transaction rolls back,
  -- so the row is NEVER deleted without its reversal having succeeded.
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
```

`app/src/data/capitalTransactions.ts`'s four mutation hooks and
`app/src/data/aiImportSave.ts`'s settlement save path now call these
RPCs instead of doing their own two-step row-write-then-`apply_business_balance_delta`
— see those files for the updated call sites. `apply_business_balance_delta`
itself is UNCHANGED and stays in use elsewhere (it's a generic "just
apply this delta" primitive; these four new functions are specifically
about coupling a ROW write to a delta atomically, which
`apply_business_balance_delta` alone was never designed to do).

- [x] 60a run (record_manual_capital_transaction, update_manual_capital_transaction,
      delete_manual_capital_transaction, apply_settlement_business_balance_credit)

---

## 61. maintenance_records/tolls gain settlement_id (P1 CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision) — ✅ APPLIED (run via pending_61_62.sql, client update published to preview)

**The finding**: re-importing the same settlement PDF twice (CLAUDE.md
invariant #10's "re-import replaces, never duplicates" rule) correctly
replaced `loads`/`fuel_purchases`/`reimbursements`/withheld `deductions`
via a capture-old-ids-then-delete-after-insert step
(`aiImportSave.ts`'s `oldLoadIds`/`oldFuelIds`/`oldReimbIds`/`oldDedIds`)
— but `maintenance_records` and `tolls` had NO equivalent step at all,
because neither table had a `settlement_id` column to scope "which old
rows belong to THIS settlement" by. `maintenance_records` had
`document_id` (no help here — each import/re-import attempt uploads a
fresh document row, so a re-import's `documentId` never matches the
PREVIOUS attempt's), and `tolls` had neither `settlement_id` nor
`document_id` at all — confirmed by reading both tables' actual column
list, not assumed. Every re-import of the same PDF therefore doubled
that week's maintenance and toll rows, silently inflating true profit's
expense total, CPM, and the Accountant Package's category totals by
however many times the same statement was ever re-imported.

**The fix**: add `settlement_id` to both tables (nullable, `on delete
cascade`, same convention as `loads`/`fuel_purchases`/`reimbursements`/
withheld `deductions`' own `settlement_id` columns) so
`aiImportSave.ts` can apply the IDENTICAL capture-old-ids/insert-new/
delete-old pattern those four tables already use — see that file's own
updated settlement branch. A maintenance/toll row inserted from
anywhere OTHER than a settlement import (a standalone `docType:
'maintenance'` import, the manual-entry screens) simply leaves this
column `null`, exactly like `fuel_purchases.settlement_id` already
does for a standalone fuel receipt.

```sql
alter table maintenance_records
  add column if not exists settlement_id uuid references settlements on delete cascade;

alter table tolls
  add column if not exists settlement_id uuid references settlements on delete cascade;

create index if not exists maintenance_records_settlement_id_idx on maintenance_records(settlement_id);
create index if not exists tolls_settlement_id_idx on tolls(settlement_id);
```

- [x] 61a run (maintenance_records.settlement_id, tolls.settlement_id + indexes)

---

## 62. Deduction edit/add + contribution sync made atomic (P1 CORRECTNESS FIX, FULL SYSTEM AUDIT, owner decision) — ✅ APPLIED (run via pending_61_62.sql; app/app/(tabs)/deductions.tsx and app/src/data/deductionMutations.ts are pure client-side, no Edge Function redeploy needed for this section specifically — ai-import was separately redeployed the same pass for its own unawaited-handleJobStart/service-role-client fix; client update published to preview)

**The finding**: `deductions.tsx`'s `handleSaveEdit()`/`handleSaveAdd()`
each did `updateDeduction.mutateAsync(...)` (or `insertDeduction.mutateAsync(...)`)
THEN, as a SEPARATE `await`, `applyContributionSync(...)` — two independent
network round trips with no atomicity between them. A network drop
between the two awaits leaves the deduction saved with a stale/missing/
orphaned linked contribution: the amount changed but the linked
contribution's amount didn't (edit-update case), a personal-payment
purchase saved with no linked contribution at all (create case, silently
losing equity the owner actually put in), or a payment method switched to
business but the old personal-payment contribution row survives (remove
case, a phantom contribution never backed by an actual personal-payment
deduction anymore) — each one corrupts `taxFreeRemaining` on the Capital
Account screen.

**The fix**: fold the deduction write and its contribution sync into ONE
atomic RPC transaction, same pattern as §60 — either both happen or
neither does.

- `update_deduction_with_contribution_sync()` — updates the deduction row
  and, per `p_sync_action` (`'noop'|'create'|'update'|'remove'`, computed
  client-side by the EXISTING pure `planContributionSync()`, unchanged),
  creates/updates/removes the linked `capital_transactions` row, all
  inside one transaction.
- `insert_deduction_with_contribution_sync()` — inserts the new deduction
  row and, when `p_create_contribution` is true (the ADD flow's only
  possible sync outcome — a brand-new row can never have an EXISTING
  linked contribution to update/remove), creates the linked contribution
  in the same transaction.

Neither RPC touches `profiles.business_balance` — a LINKED contribution
never has (see `src/stats/capitalAccount.ts`'s own header comment: no
real cash moved into checking for that event, only equity was built by
paying a business expense out of pocket), unchanged from the previous
two-step `applyContributionSync()` behavior. Both are `security invoker`
(RLS on `deductions`/`capital_transactions`, owner-scoped `ALL`, already
permits everything each function does for its own rows).

```sql
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
```

`app/app/(tabs)/deductions.tsx`'s `handleSaveEdit()`/`handleSaveAdd()` now
call these RPCs instead of `updateDeduction.mutateAsync()`/
`insertDeduction.mutateAsync()` followed by a separate
`applyContributionSync()` call — see that file's own updated handlers.
`applyContributionSync()`/`fetchLinkedContributionId()`
(`app/src/data/deductionMutations.ts`) are UNCHANGED and stay in use by
`accountant-package.tsx`'s own category-edit flow, which does not touch
payment method/personal-payment sync at all (out of scope for this fix —
flagged, not silently left inconsistent) and by `documents.tsx`'s payment-
method quick-edit, which is a narrower single-field edit with the same
theoretical (much rarer) race — left as a documented follow-up rather
than expanding this fix's blast radius further.

- [x] 62a run (update_deduction_with_contribution_sync, insert_deduction_with_contribution_sync)

## 63. deductions.truck_id + tolls.truck_id (MULTI-TRUCK MODEL, owner decision) — ✅ APPLIED (run via pending_63.sql, client update published to preview)

Fleet-vs-per-truck scoping pass. Every table that can be operationally
tied to one truck already carries `truck_id` — `settlements`,
`fuel_purchases` (§6), `maintenance_records` — EXCEPT `deductions` and
`tolls`, which had none at all. This is what makes the new "Lists follow
the global scope selector, with the truck's unit number visible on every
row" requirement (settlements/loads/fuel/maintenance/tolls/deductions)
impossible for these two tables today, and it's also what the new
per-truck CPM's cost-allocation rule needs: a deduction/toll with
`truck_id` set is a DIRECT cost for that truck; one left `null` is a
FLEET-LEVEL cost (insurance, accounting fees, permits, ...) allocated
across trucks by miles for per-truck CPM purposes only (never for P&L/
tax, which stay unsplit) — see `app/src/stats/costAllocation.ts`/
`app/src/stats/truckComparison.ts`. Nullable on both — most deductions
stay fleet-level (`null`) by design, same "n=1/no-value is a legitimate
answer, not a broken one" spirit as every other optional column in this
schema; the import preview's new truck picker (see
`app/app/(tabs)/import/index.tsx`) offers "Not truck-specific" as an
explicit first-class choice, not just a fallback.

```sql
-- 63a. deductions.truck_id
alter table deductions add column truck_id uuid references trucks;
create index on deductions (truck_id);

-- 63b. Backfill: a settlement-withheld deduction inherits its own
-- settlement's truck_id (an out-of-pocket/manual deduction has no
-- settlement to inherit from and stays null, i.e. fleet-level, until a
-- user explicitly assigns one via the Deductions edit sheet or the new
-- Fix Truck Assignments screen).
update deductions d
set truck_id = s.truck_id
from settlements s
where d.settlement_id = s.id
  and d.truck_id is null
  and s.truck_id is not null;

-- 63c. tolls.truck_id (tolls had no truck attribution column at all —
-- not even a settlement-side one to filter through generically, since a
-- manually-entered toll has no settlement_id either)
alter table tolls add column truck_id uuid references trucks;
create index on tolls (truck_id);

-- 63d. Backfill: same rule as 63b, via each toll's own settlement_id
-- (docs/PENDING_SQL.md §61).
update tolls t
set truck_id = s.truck_id
from settlements s
where t.settlement_id = s.id
  and t.truck_id is null
  and s.truck_id is not null;
```

Both columns are plain `references trucks` with no explicit `on delete`
clause — matching `fuel_purchases.truck_id`'s own §6 precedent exactly
(not `on delete set null`), so this introduces no new deletion-safety
shape beyond what already exists for fuel/maintenance/settlements.

- [x] 63a run (add truck_id + index to deductions)
- [x] 63b run (backfill deductions.truck_id from settlement)
- [x] 63c run (add truck_id + index to tolls)
- [x] 63d run (backfill tolls.truck_id from settlement)

---

## 64. DELETE A TRUCK — truck_id FK cascade fix (owner decision) — ✅ APPLIED (verification query confirmed all 5 constraints read CASCADE)

Adversarial audit finding, cited directly in the owner's own request: five
`truck_id` foreign keys are plain `references trucks` with NO `on delete`
clause — Postgres's default action for that is `NO ACTION`, which behaves
exactly like `RESTRICT` (a `delete from trucks where id = X` fails with a
foreign-key-violation error the instant ANY row anywhere still points at
that truck). Two OTHER `truck_id` FKs already exist and are already
correct — `maintenance_intervals.truck_id`/`truck_health_config.truck_id`
are both already `on delete cascade` (per-truck SETTINGS rows, correctly
disappear with their truck) — and two more are deliberately NOT changed
by this section: `drivers.default_truck_id` and
`compliance_items.truck_id` are both `on delete set null` (a driver or a
compliance item is NOT "that truck's data" the way a settlement/fuel/
maintenance/deduction/toll row is — it should SURVIVE the truck's own
deletion, just lose the now-meaningless truck association, exactly the
behavior `set null` already gives it; out of scope for this section).

The 5 that must change, all currently RESTRICT: `settlements.truck_id`,
`fuel_purchases.truck_id` (§6), `maintenance_records.truck_id`,
`deductions.truck_id` (§63a), `tolls.truck_id` (§63c). None of these were
given an explicit constraint name at creation time, so Postgres
auto-generated one — rather than hardcode a name that could theoretically
have drifted, the migration below looks the ACTUAL constraint up
dynamically via `pg_constraint` (matched by "a foreign key on this table
whose target is `trucks`" — each of these 5 tables has exactly one such
FK, confirmed by re-reading every column definition in `docs/SCHEMA.sql`/
this file's own §6/§63 text, and asserted again at runtime below rather
than just assumed) and drops+recreates it under that SAME real name.

REWRITTEN after a real Supabase SQL Editor failure on the first version
(`ERROR: 42703: record "con" has no field "conrelid"`) — the original
loop's own `SELECT` only ever projected `conname` and `conrelid::regclass::
text as tbl` into the loop variable, then a LATER line referenced
`con.conrelid`, a field that plain SELECT never put on that record at all.
Root cause: aliasing `conrelid` away as `tbl` and then trying to read the
original name back off the same record. Fixed by selecting every field a
later line actually reads, under its own real name, and nothing else —
plus, per the follow-up request, restructured around a single
`foreach ... in array` loop over the 5 table names (simpler to read than
looping over constraint rows and cross-checking against a second query),
one shared original constraint name reused for the recreated constraint
(no separately-invented "fixed" name to keep track of), an explicit skip
when a table is already `ON DELETE CASCADE` (idempotent — safe to paste
and run again), and the whole block wrapped in one transaction so a
failure partway through — the exactly-one-FK assertion failing for some
table, say — rolls back every earlier change in that same run too: either
all 5 tables end up fixed, or none of them do.

Could not be executed against a live database from THIS environment (no
psql/postgres/docker available, checked directly) — only hand-traced
against Postgres's own documented `pg_constraint` columns/`PL/pgSQL`
syntax before being handed off. RUN AND VERIFIED (owner confirmation) —
the owner ran this against the live project and the verification
query's own 5 rows all read `delete_rule = 'CASCADE'`. A real truck
delete (`app/src/data/truckDeletion.ts`) is now unblocked.

```sql
begin;

do $$
declare
  target text;
  match_count int;
  fk_name text;
  fk_delete_type text;
begin
  foreach target in array array['settlements', 'fuel_purchases', 'maintenance_records', 'deductions', 'tolls']
  loop
    -- Exactly one FK from this table to trucks is expected — abort the
    -- whole transaction rather than silently touching the wrong
    -- constraint if that assumption doesn't hold on this database.
    select count(*) into match_count
    from pg_constraint
    where contype = 'f'
      and conrelid = target::regclass
      and confrelid = 'trucks'::regclass;

    if match_count <> 1 then
      raise exception 'Expected exactly one foreign key from % to trucks, found % — aborting, nothing changed', target, match_count;
    end if;

    select conname, confdeltype::text
    into fk_name, fk_delete_type
    from pg_constraint
    where contype = 'f'
      and conrelid = target::regclass
      and confrelid = 'trucks'::regclass;

    if fk_delete_type = 'c' then
      raise notice '%.% is already ON DELETE CASCADE — skipping', target, fk_name;
    else
      execute format('alter table %I drop constraint %I', target, fk_name);
      execute format(
        'alter table %I add constraint %I foreign key (truck_id) references trucks(id) on delete cascade',
        target, fk_name
      );
      raise notice 'Updated %.% (truck_id) to ON DELETE CASCADE', target, fk_name;
    end if;
  end loop;
end $$;

commit;

-- VERIFICATION — run separately, right after; every row should read
-- delete_rule = 'CASCADE'.
select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  case confdeltype
    when 'c' then 'CASCADE'
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else confdeltype::text
  end as delete_rule
from pg_constraint
where contype = 'f'
  and confrelid = 'trucks'::regclass
  and conrelid in (
    'settlements'::regclass, 'fuel_purchases'::regclass,
    'maintenance_records'::regclass, 'deductions'::regclass,
    'tolls'::regclass
  )
order by table_name;
```

DOWNSTREAM CASCADE, already correct, no change needed: `loads.settlement_id
on delete cascade` (already existed — deleting a settlement already took
its loads with it, D6/legacy `deleteSett()` parity) and
`capital_transactions.linked_deduction_id on delete cascade` (already
existed, PENDING_SQL.md's own D5/invariant #5 precedent) — so once
`settlements`/`deductions` cascade away from a deleted truck, their own
loads and any LINKED capital contributions cascade away automatically, a
second hop, with no further schema change required. `driver_payments.
settlement_id on delete set null` also needs no change — a driver's
payment record is compensation data, not truck data, and correctly
SURVIVES (losing only its now-meaningless settlement link) exactly as it
already does for a plain settlement delete today.

`documents` rows are NOT touched by this cascade at all (nothing in the
FK graph points FROM `trucks` TO `documents` — the direction is
`settlements.document_id -> documents`, the opposite way) — the app-level
delete flow (`app/src/data/truckDeletion.ts`) collects every
`document_id` referenced by the truck's settlements/maintenance_records/
deductions BEFORE deleting the truck, then calls the EXISTING
`cleanupOrphanedDocument()` (`app/src/data/deductionMutations.ts`, already
used by every other per-record delete flow in this app) once per
collected id AFTER the truck delete succeeds — it re-checks genuine
orphan status itself (a document shared with a still-live row elsewhere
is left alone) and removes both the Storage object and the `documents`
row. This is intentionally a SEPARATE, best-effort pass, not folded into
the same SQL transaction as the truck delete — Storage deletion is a
non-transactional API call that cannot be rolled back together with a SQL
statement anyway (same honest limitation `delete-account`/`reset-data`
already document for the identical reason); the DB-ROW deletion itself
(the truck plus every cascaded settlement/load/fuel/maintenance/toll/
deduction/linked-contribution row) IS a single atomic `delete from trucks
where id = $1` statement — Postgres guarantees that whole cascade commits
or none of it does, which is what "atomic: everything goes or nothing
does" means for the financial records themselves.

BUSINESS BALANCE, STATED PLAINLY (owner decision, per the request's own
"make it consistent" instruction): deleting a truck's settlements does
**NOT** reverse any of their `business_balance_credit` from
`profiles.business_balance` — the balance keeps reflecting the real cash
the carrier already paid into the business account; deleting the RECORD
of a settlement doesn't un-deposit that money. This matches the app's
own PRE-EXISTING, single precedent exactly: Settlements' own individual
delete action (`useDeleteSettlement`, a plain `useEntityDelete` with no
balance-reversal step at all) has never reversed `business_balance`
either — truck deletion is a bulk application of the identical, already-
shipped behavior, not a new rule invented for this feature. The Delete
Truck confirmation screen states this explicitly ("Your Business Balance
will not change — it reflects money already received"). Tax estimates and
the Capital Account summary need NO special handling at all: both are
computed LIVE from whatever `settlements`/`deductions`/`capital_transactions`
rows currently exist (CLAUDE.md invariant #6's own "no cached/stored
total" convention) — once the truck's rows are gone, the very next read
of either screen is automatically correct with zero extra code.

- [x] 64 run (drop + re-add all 5 existing RESTRICT-equivalent truck_id
      FKs, by their real names, as ON DELETE CASCADE — single
      transaction, idempotent) — verification query's 5 rows confirmed
      all read CASCADE

---

## 65. profiles.ai_weekly_review_locale (AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix, owner decision) — ✅ APPLIED (run directly; reset-data/ai-advisor/ai-import redeployed, client update published to preview — also independently confirmed live 2026-08-26 via a read-only PostgREST schema probe, see the checklist note below)

**The finding**: `profiles.ai_weekly_review` (§49) caches the AI-generated
weekly settlement review to cap `ai-advisor` usage at one call per user
per week — but the cache had no record of WHICH LANGUAGE the cached text
was actually generated in. `src/stats/weeklyReview.ts`'s
`shouldGenerateWeeklyReview()` only ever compared the cached
`week_ending` and a 7-day cooldown — switching the app's language (even
via the brand-new first-run language screen) never invalidated a review
that was generated under the OLD language, so a Turkish-speaking user
who had already gotten one English-language review before ever picking
Turkish would keep seeing that same English text, silently, forever
(the exact "not just Turkish — the text never goes through translation
at all" bug report this section fixes). A single new nullable column
closes the gap — no data migration needed, a null value is treated the
same as "never generated," which is already `shouldGenerateWeeklyReview()`'s
correct default.

```sql
alter table profiles add column if not exists ai_weekly_review_locale text;
```

That's the entire schema change — one idempotent `add column if not
exists`, safe to re-run. See CLAUDE.md's own dated entry for this pass
for the full client-side fix this column enables (locale-mismatch now
forces regeneration bypassing the 7-day cooldown; a mismatched/unverified
cached review is never shown — a deterministic, always-correctly-localized
template-based summary is shown instead while a fresh AI review is
pending).

- [x] 65 run (profiles gains ai_weekly_review_locale text, nullable,
      default null) — CONFIRMED via a live, read-only PostgREST request
      (`GET /rest/v1/profiles?select=ai_weekly_review_locale&limit=0`
      against the linked project, anon key, no session — a genuinely
      missing column returns HTTP 400 `42703 column ... does not exist`,
      sanity-checked directly against a deliberately-nonexistent column
      name; this column returned a clean HTTP 200, confirming it exists
      on the live `profiles` table). This environment still has no
      service_role/db-admin credentials to query `information_schema`
      directly, but a PostgREST 200-vs-400 response is an equally
      reliable existence signal for a single column and needs no
      elevated access.

---

## 66. profiles.cf_recurring_charges (CASH FLOW RECURRING CHARGES — SHOW AND LET ME CORRECT IT, owner decision) — ✅ APPLIED (reset-data/ai-advisor/ai-import redeployed, client update published to preview; confirmed live 2026-08-26 via the same read-only PostgREST schema probe as §65)

**The finding**: Cash Flow's own recurring-charge classifier
(`src/stats/cashFlowClassification.ts`) is a CONVENIENCE, not a source of
truth — device report: "Fixed expenses $0 · 0 recurring charges detected"
even though real weekly Insurance/Permits/ELD chargebacks existed in
every settlement. The classifier's own frequency/occurrence thresholds
were too strict for a young account (see CLAUDE.md's own dated entry for
this pass for the full instrumented diagnosis), but even a perfectly
tuned classifier can never be a source of truth for every real account's
own weekly commitments — a user must always be able to see exactly what
was detected and correct it (add a missed one, edit a wrong amount,
remove a false positive) without that correction being silently
overwritten by the next re-classification. `profiles.cf_periodic_overrides`
(§57) already established this exact "flexible per-key jsonb override"
pattern for periodic (dated) items — this is the same pattern for
recurring (weekly) fixed charges, keyed by CATEGORY instead of a
compliance-item id.

```sql
alter table profiles add column if not exists cf_recurring_charges jsonb not null default '{}'::jsonb;
```

One idempotent `add column if not exists`, safe to re-run. `{}` (the
default) means every recurring charge the Cash Flow screen shows is
exactly what the classifier itself detected, unedited — see CLAUDE.md's
own dated entry for this pass for the full client-side merge logic
(`mergeRecurringCharges()`) this column enables.

- [x] 66 run (profiles gains cf_recurring_charges jsonb, not null,
      default '{}'::jsonb) — CONFIRMED via the same live PostgREST probe
      described in §65's own note.

---

## 67. Re-classify existing "Misc" settlement-withheld deductions (UNIFIED CLASSIFICATION PATH, owner decision) — NOT YET APPLIED (ONE-TIME DATA REPAIR, not a schema change — no ALTER TABLE)

**The finding**: `classifySettlementLine()` (settlement-withheld deduction
lines) and `guessCategory()` (general document/purchase categorization)
each hand-rolled their OWN separate regex for the same shared category in
at least 5 places — confirmed to have already diverged for Permits,
Licenses & Road Taxes (one recognized IRP/IFTA/HVUT/2290, the other
didn't) and ELD & Communications, with the identical risk latent in Tolls
& Scales, Bank & Merchant Fees, and (a genuine, deliberate exception —
see below) Legal & Professional Services. Fixed in
`app/src/import/category.ts` by extracting each shared category's
matching logic into ONE exported detector function
(`isPermitsOrRoadTax`/`isEldOrCommunications`/`isTollsOrScales`/
`isBankOrMerchantFee`, the union of whatever terms either function
previously recognized) that BOTH `classifySettlementLine()` and
`guessCategory()` now call — this class of divergence cannot recur for
any of these five. **One deliberate, documented exception**: Legal &
Professional Services is NOT fully unified — `guessCategory()` keeps the
bare words "accountant"/"accounting" in its own broader
`isLegalOrProfessionalServices()` (a standalone document can legitimately
be titled "ABC Accounting Services"), but `classifySettlementLine()` uses
a narrower `isLegalOrProfessionalServicesSettlementSafe()` that excludes
those two words — Prime Inc's own carrier-specific chargeback code is the
literal text "ACCOUNTING SERV" (docs/CARRIER_CODES.md), and unifying the
broader regex briefly broke this file's own CARRIER ISOLATION hard
invariant (caught immediately by the existing test suite failing before
this could ship). `src/import/__tests__/category.test.ts` gained a new
"UNIFIED CLASSIFICATION PATH" describe block asserting
`classifySettlementLine()` and `guessCategory()` resolve the SAME
description to the SAME category for every one of the 5 shared
categories, plus a dedicated regression case reproducing the exact
reported bug (IRP).

**This section is the retroactive half of that fix**: a settlement
deduction row imported BEFORE this pass — which landed in "Misc" (or with
no category at all) purely because the OLD, narrower regex didn't
recognize its real chargeback type — stays wrong forever unless it's
re-run through the corrected rules once. `pending_67.sql` (mirrored at
the repo root) re-applies the corrected classification directly in SQL
(hand-translated from the same regexes above, `\b` → `\y` for Postgres's
word-boundary syntax), scoped to `source = 'settlement' AND (category is
null or category = 'Misc') AND description is not null` — never touching
a row that already has a real category, including a different one the AI
already got right the first time, and never touching an out-of-pocket
'Misc' row (those go through `guessCategory()`'s vendor/store-aware
logic at import time, a different classifier this migration doesn't
retroactively re-run). Includes a read-only PREVIEW query (old_category →
new_category, row counts, dollar totals) to run and review before the
actual UPDATE. Safe to re-run — the UPDATE's own WHERE clause only
matches rows where the corrected classification would actually change
the stored value, via an `is distinct from category` guard.

```sql
-- See pending_67.sql at the repo root for the full PREVIEW + UPDATE
-- script (too long to duplicate here without drifting out of sync —
-- keep pending_67.sql as the single source of truth for this section
-- until it's run, deleted, and this note is replaced with the final
-- SQL, matching this file's own established convention for every other
-- section).
```

**REVIEW BEFORE RUNNING**: assembled by hand-translating
`app/src/import/category.ts`'s JS regexes into PostgreSQL POSIX-ERE
syntax — NOT executed against a live database in this environment (no
service_role/db credentials here). Run the PREVIEW query first.

- [ ] 67 run (re-classifies deductions.category for source='settlement'
      rows currently 'Misc'/null, using the corrected, unified
      classification rules) — run `pending_67.sql`'s PREVIEW query first,
      review its output, then run the UPDATE.

---

## 68. profiles.ai_weekly_review_fingerprint (AI COACH — FIX STALE CACHE, owner decision) — ✅ APPLIED (reset-data redeployed, client update published to preview)

**The finding**: device report — every settlement was deleted and the AI
Coach kept showing the old weekly review, quoting dollar figures that no
longer existed. Root cause: the cache (`ai_weekly_review`/
`ai_weekly_review_week_ending`/`ai_weekly_review_generated_at`/
`ai_weekly_review_locale`) only ever tracked WHICH SETTLEMENT WEEK and
LOCALE a review covers — never whether the underlying FIGURES (revenue,
net, RPM, ...) it quotes are still what the account's real data currently
produces. Deleting every settlement correctly stopped
`shouldGenerateWeeklyReview()` from trying to regenerate (nothing to
review), but nothing ever stopped the STALE cached text from being
DISPLAYED — a separate, unguarded code path. This column stores a digest
of the exact figures a review was generated from
(`src/stats/weeklyReview.ts`'s `computeWeeklyReviewFingerprint()`) — a
mismatch against the account's CURRENT figures (from a settlement/
deduction/fuel/maintenance/toll insert, update, or delete; a truck
delete; a Reset All Data — anything that moves a KPI total) means the
cached text is never shown, and a fresh regeneration attempt is triggered
immediately, bypassing the normal 7-day cooldown, same treatment a locale
mismatch already got (see CLAUDE.md's own dated entry for this pass for
the full before/after).

```sql
alter table profiles add column if not exists ai_weekly_review_fingerprint text;
```

One idempotent `add column if not exists`, safe to re-run. Nullable —
`null` simply means "no fingerprint recorded yet," which
`isCachedReviewUsable()` already treats as "never trust this cache"
(a `null` current fingerprint, meaning nothing to review right now, can
never match a `null` OR any real cached fingerprint either).

- [x] 68 run (profiles gains ai_weekly_review_fingerprint text, nullable)

---

## 69. profiles.accountant_package_exported_at (REFERRAL NUDGE "surface at the right moments", owner decision) — ✅ APPLIED (reset-data redeployed, client update published to preview)

**The finding**: Part 2 of the AI Coach daily-tips request asks the
referral nudge to surface at 4 specific real moments, one of which is
"after their first accountant export" — this app had no existing signal
anywhere for "has this user ever exported the Accountant Package." Set
once, client-side, right after a successful PDF or Excel export
(`app/(tabs)/more/accountant-package.tsx`'s `recordExportedForReferralNudge()`,
called from both `handleExportPdf()`/`handleExportExcel()` after
`Sharing.shareAsync()` succeeds — fire-and-forget, never blocks the
export/share the user is already waiting on). The referral nudge
(`src/referral/referralNudge.ts`) only ever checks "is this non-null,"
never re-derives a count or a "first" vs. "Nth" distinction.

```sql
alter table profiles add column if not exists accountant_package_exported_at timestamptz;
```

One idempotent `add column if not exists`, safe to re-run. Nullable —
`null` simply means "never exported yet," which
`hasExportedAccountantPackage: !!profileQuery.data?.accountant_package_exported_at`
already treats correctly as "this moment hasn't happened."
`reset-data`'s `PROFILE_DATA_RESET` clears this back to `null` (a reset
account hasn't, as far as that fresh state is concerned, exported
anything yet).

- [x] 69 run (profiles gains accountant_package_exported_at timestamptz,
      nullable)

---

## 70. Settlement delete orphans — balance-reversal trigger + loan provenance (owner decision) — ✅ APPLIED (client update published to preview)

**The finding**: device report — deleting every settlement left
`profiles.business_balance` overstated by exactly the sum of the deleted
settlements' own `business_balance_credit` (never reversed anywhere),
and Loan Center kept showing loans extracted from those settlements with
no way to tell they were settlement-derived. Full audit in CLAUDE.md's
own dated entry for this pass.

**Part A — an `AFTER DELETE` trigger on `settlements`**, not a client-side
fix: a trigger is the only mechanism that covers BOTH a direct client
delete AND the truck-deletion cascade path (Postgres deletes a truck's
settlements directly via the `trucks.id -> settlements.truck_id` FK
cascade, entirely inside Postgres, never through app code). `SECURITY
DEFINER` — the trigger takes no caller-supplied parameters to validate
(`OLD.user_id`/`OLD.business_balance_credit` come from the real row
already being deleted), so there's no impersonation risk, and this is
what lets the reversal succeed uniformly whether the delete was issued
by a normal authenticated user or a service-role Edge Function (which
has no `auth.uid()` at all).

**Part B — loan provenance**: `loans.settlement_id` is `on delete set
null`, deliberately NOT cascade — a single loan is upserted-by-name
across many settlements over months (a real, standing obligation), so
cascading its delete from one settlement would destroy real financial
data. `loans.source` (`'settlement'|'import'|'manual'`) is the permanent
marker so a loan can always be identified as settlement-derived even
after its `settlement_id` clears to null.

```sql
create or replace function reverse_settlement_business_balance_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.business_balance_credit, 0) <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) - old.business_balance_credit
    where user_id = old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_reverse_settlement_business_balance_credit on settlements;
create trigger trg_reverse_settlement_business_balance_credit
after delete on settlements
for each row
execute function reverse_settlement_business_balance_credit();

alter table loans add column if not exists settlement_id uuid references settlements on delete set null;
alter table loans add column if not exists source text not null default 'manual';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loans_source_check'
  ) then
    alter table loans add constraint loans_source_check check (source in ('settlement','import','manual'));
  end if;
end $$;
create index if not exists loans_settlement_id_idx on loans(settlement_id);
```

- [x] 70 run (reverse_settlement_business_balance_credit() trigger on
      settlements; loans.settlement_id + loans.source)

---

## 71. Usage analytics — app_usage_events + opt-out (owner decision, privacy-safe, owner-only) — NOT YET APPLIED

**The ask**: "so I can learn which screens are actually used before
deciding what to simplify" — record which screens users open and which
actions they take (screen/action name, timestamp, user id), NO financial
values, no descriptions, no document contents, nothing beyond the event
itself. RLS so users can't read it, only the service role can. A plain
opt-out setting, disclosed in the privacy policy.

**Table shape**: `app_usage_events` — `kind` ('screen'|'action'), `name`
(the route or action name, e.g. `/(tabs)/more/loans` or
`document_import`), `status` (only for `kind='action'` — 'started'|
'completed', a CHECK constraint enforces this pairing so a screen-open row
can never accidentally carry a stray status). `user_id` is `on delete
cascade` from `auth.users` — same established precedent as `ai_usage_log`/
`ai_credit_purchases` (FIVE ADDITIONS pass): already cleaned up
automatically by `delete-account`'s existing `auth.admin.deleteUser()`
call, no explicit Edge Function table-list entry needed. Deliberately NOT
added to `reset-data`'s `TABLES_IN_DELETION_ORDER` either — this is
operational/telemetry data for product decisions, not user business data,
same reasoning `ai_usage_log`/`service_status` are excluded for.

**RLS, "only the service role can read"**: one INSERT policy
(`user_id = auth.uid()` AND a live re-check of
`profiles.usage_analytics_opt_out`), no SELECT/UPDATE/DELETE policy at all
— RLS defaults to deny once enabled, so a regular user can never read this
table back through the app, only insert their own rows. The Supabase SQL
Editor's own `postgres` role bypasses RLS as the table owner (no `FORCE
ROW LEVEL SECURITY` needed), and the `service_role` Postgres role has
`BYPASSRLS` by default — both can read every row for the admin recipes
below.

**Opt-out enforced twice**: client-side (`src/data/usageTracking.ts`
short-circuits before ever attempting the insert) AND server-side (the
INSERT policy's own `with check` re-reads the live `profiles` row on every
write) — the server-side check is the real guarantee, the client-side one
just avoids a wasted network call.

```sql
-- See pending_71.sql at the repo root for the full table + RLS policy +
-- profiles column (kept there, not duplicated here, until it's been run —
-- same convention as §70's own note).
```

- [ ] 71 run (app_usage_events table + RLS; profiles.usage_analytics_opt_out)

---

## 72. REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — NOT YET APPLIED

**The decision**: `profiles.business_balance` has been a recurring source
of drift/confusion across multiple prior passes (§37/§38/§59/§60/§70 all
exist specifically because this estimate kept getting out of sync with
reality). The owner has decided the app's own balance ESTIMATE adds no
value over the owner's own real bank balance — it is retired as a
displayed/computed feature everywhere, but every underlying column/table
stays in place, INERT, so this is fully reversible later without a data
migration. See CLAUDE.md's own dated entry for this pass for the full
client-side audit (every UI surface removed, every write path
neutralized).

**What this section does, SQL-side**: (a) drops the §70 `AFTER DELETE`
reversal trigger on `settlements` — since nothing writes
`business_balance_credit` anymore, a settlement carrying a STALE,
pre-this-pass credit value that later gets deleted must not still
decrement `business_balance` on the way out (the trigger FUNCTION itself
is left in place, `DROP TRIGGER` only — its `CREATE FUNCTION`/
`CREATE TRIGGER` statements are preserved verbatim in §70's own historical
entry above, so restoring this is a straight copy-paste, not a rewrite);
(b) `CREATE OR REPLACE`s the three §60 manual-capital-transaction RPCs to
drop their balance-delta half while keeping the `capital_transactions` row
write completely unchanged — draws, contributions, reimbursements, and
everything Capital Account's own four-flow summary/Net Position/
tax-free-remaining computation depends on are 100% unaffected (verified in
the client-side audit: `calcCapitalAccount()`/`summarizeCapitalFlows()`
compute directly from `capital_transactions` rows + `initial_capital`,
never from `business_balance`). Each RPC now writes
`business_balance_applied = 0` on every row (informational-only column,
nothing reads it anymore, but `0` is the honest value — "this transaction
did not move any tracked balance" — rather than leaving a stale nonzero
figure with nothing left to apply it). `apply_settlement_business_balance_credit()`
(§60) and `apply_business_balance_delta()` (§37) are BOTH left completely
untouched — the client no longer calls either one, so they're already
inert without any SQL change; leaving their definitions alone keeps this
section's own diff minimal and both fully restorable.

**NOT YET APPLIED** (no live DB access in this sandbox) — must be run by
the owner via the Supabase SQL Editor. The CLIENT code changes (no longer
calling the balance-touching parts) ship independently via `eas update`
and are safe to deploy before this SQL runs: `record_manual_capital_transaction`/
`update_manual_capital_transaction`/`delete_manual_capital_transaction`
would still also silently apply a now-invisible balance delta server-side
until this migration lands, which is harmless since nothing reads
`business_balance` anymore on the client. The settlement trigger drop is
the one piece with a real (if narrow) reason to run promptly: until it's
applied, deleting an OLD settlement that still carries a stale
`business_balance_credit` from before this pass will still silently move
`business_balance` one more time.

```sql
-- Part A — drop the §70 reversal trigger. The function itself
-- (reverse_settlement_business_balance_credit()) is intentionally left
-- defined — only the trigger binding is removed — so restoring this is
-- exactly the two-line `CREATE TRIGGER` statement already on file in
-- §70 above, no function rewrite needed.
drop trigger if exists trg_reverse_settlement_business_balance_credit on settlements;

-- Part B — the three manual capital-transaction RPCs, balance-delta
-- application removed, row write unchanged.
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
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'record_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'record_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id, business_balance_applied)
  values (p_user_id, p_tx_type, p_amount, p_tx_date, p_note, p_linked_deduction_id, 0)
  returning * into v_row;

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
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'update_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'update_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  update capital_transactions
  set amount = p_amount, tx_date = p_tx_date, note = p_note, business_balance_applied = 0
  where id = p_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'update_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
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
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'delete_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;

  delete from capital_transactions where id = p_id and user_id = p_user_id;

  if not found then
    raise exception 'delete_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function delete_manual_capital_transaction(uuid, uuid) to authenticated;
```

`app/src/data/capitalTransactions.ts`'s four mutation hooks call these
same three RPC names unchanged (only their SQL bodies differ) —
`app/src/data/aiImportSave.ts`'s settlement save path no longer calls
`apply_settlement_business_balance_credit` at all (confirmed by grep, no
SQL change needed for that RPC itself — it's simply unreferenced now).

- [ ] 72 run (drop trg_reverse_settlement_business_balance_credit;
      CREATE OR REPLACE record_manual_capital_transaction /
      update_manual_capital_transaction / delete_manual_capital_transaction)

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
