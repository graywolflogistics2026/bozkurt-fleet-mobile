# Pending SQL — history of what's been run against the live Supabase DB

**STATUS (2026-07-03): everything below has been run against the live DB.**
This file started as a forward-looking "run this next" list; it's kept now
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
    "bracket": {"CA": "see docs/ADMIN_RUNBOOK.md for the full Schedule X/Y/Z tables"},
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

---

## Also still open (not part of any pass above)

- `supabase gen types` needs to be re-run against `app/src/types/db.ts` to
  pick up `tax_config`, `tax_year_data`, `household_members`,
  `household_income`, and the dropped `profiles.filing_status` — nothing
  above ran this.
- MA's own `flat` rate entry (see the note at the end of section 3) —
  not yet part of a verification pass.
- No follow-up migration file exists yet consolidating sections 1, 3, and 4
  into `supabase/migrations/` — `0001_init.sql` on disk still does NOT
  reflect any of this (it's the live DB that's ahead of the repo's migration
  files, not the other way around). Worth doing before the next schema
  change, so this file can finally be retired.
