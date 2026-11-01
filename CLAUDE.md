# CLAUDE.md — BOZKA TRUCKING AI mobile app (standing rules)

> **KEEP THIS FILE SMALL (owner decision 2026-10-13).** Target 65-70k
> chars; `app/src/lib/__tests__/claudeMdSize.test.ts` fails above 80k.
> Dated per-task entries go to `docs/CHANGELOG.md` (newest first, max ~10
> lines each) — NEVER to this file. Long design rationale goes to
> `docs/decisions/<topic>.md`. Add a rule here only if every session needs
> it, in a few lines, pointing at its decision file by plain path. Never
> use `@` imports in this file (they load at launch and defeat the point).
> The pre-split 847k-char original is in git history: `git show
> 947e643:CLAUDE.md`.

## Project

Mobile (Expo / React Native) port of the single-file web app
`legacy/index.html`, for owner-operator truckers: settlement import (AI
extraction), deductions, fuel, maintenance, Truck Health, Capital Account,
tax estimates, Cash Flow, Accountant Package, AI Coach. Multi-tenant (every
user starts with zero data), multi-truck, optional drivers.

Stack: Expo SDK 54 + React Native 0.81 + expo-router; TypeScript strict;
`@tanstack/react-query` (persisted); i18next/react-i18next (7 locale files);
Supabase (Postgres + RLS, Storage, Deno Edge
Functions); Anthropic API called ONLY from Edge Functions; EAS Build + EAS
Update (expo-updates); Jest 29 + ts-jest for pure modules.

## Folder map

- `app/` — the Expo app; run `npx`/`eas` commands here.
  - `app/app/` — expo-router screens: `(tabs)/` (Home, Transactions,
    Import, Deductions, Truck Health) and `(tabs)/more/*` (everything else).
  - `app/src/stats/` — KPI engine (`kpi.ts` `computeKpis()`), CPM, true
    profit, Cash Flow forecast/monthly, profit analysis.
  - `app/src/tax/` — tax estimate, per diem, driver payroll, depreciation.
  - `app/src/import/` — extraction mapping, carrier codes, date guard,
    category classification, needs-review, duplicate check.
  - `app/src/data/` — Supabase hooks, `aiImportSave.ts`,
    `queryInvalidation.ts`, `exportAllData.ts`, `legacyImport/`.
  - `app/src/i18n/` — locales, `config.ts`, `format.ts`, glossary test.
  - `app/CLAUDE.md` -> `app/AGENTS.md` — Expo-version notice; keep both.
- `supabase/functions/` — `ai-import`, `ai-advisor`, `reset-data`,
  `delete-account`, `referral-sync`. `supabase/migrations/` — baseline.
- `docs/` — `PENDING_SQL.md` (log of every live-DB change), `SCHEMA.sql`
  (static baseline, not updated after §61 — PENDING_SQL wins),
  `DATA_FLOW.md`, `DEPLOY_FUNCTIONS.md`, `I18N_GLOSSARY.md`,
  `CARRIER_CODES.md`, `CHANGELOG.md`, `decisions/`, policy drafts.
- `legacy/index.html` — business-logic source of truth (see first rule).
- `PROMPTS.md` — session plan + backlog (not loaded at launch; its
  Session-0 invariant list is historical, the list below is binding).
- `pending_NN.sql` (repo root) — scratch mirrors of unapplied SQL.

## Commands

Owner runs Windows PowerShell. Each command gets its own code block with
the `cd` line first. `eas` runs from `app/`; `supabase` runs from the repo
root.

Typecheck:
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
npx tsc --noEmit
```

Tests (a test in a new `src/` dir must be added to `testMatch` in
`app/jest.config.js` or it never runs):
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
npx jest
```

Ship JS/TS/asset-only changes over the air:
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
eas update --branch preview --message "<what changed>"
```

Native build (needed for a new native module, an `app.config.js`
plugin/permission/`updates` change, or a `version` bump):
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
eas build --profile preview --platform android
```

OTA diagnostics:
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
eas update:list --branch preview --limit 5
```
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
eas build:list --platform android --limit 3
```
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
eas channel:view preview
```

Deploy an Edge Function (one of the five above):
```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile"
supabase functions deploy ai-import --project-ref mbzonnoglreoeqihzfce
```
Secrets, dashboard alternative and JWT notes: `docs/DEPLOY_FUNCTIONS.md`
(same steps for all five functions).

EAS Update facts (confirmed from config, 2026-08-28):
- `runtimeVersion: { policy: 'appVersion' }` in `app/app.config.js`;
  `version` is `1.1.0` (bumped from 1.0.0 on 2026-10-31 for the batch E
  document scanner, a NATIVE module — that change needs `eas build`, not
  `eas update`; 1.0.0 binaries no longer receive new updates). An update
  only reaches a build with the same runtime version.
  Full: `docs/decisions/document-scanner.md`.
- `app/eas.json` channels: `development`, `preview`, `production`. Builds
  made with `--profile preview` listen on channel `preview`; publish with
  `--branch preview`. The channel->branch mapping lives on Expo's servers
  (`eas channel:view preview`).
- A build made before `updates.url`/`runtimeVersion` existed can never
  receive OTA updates — it needs a rebuild. Dev-client/Expo Go builds have
  channel `null` and never receive OTA updates.
- expo-updates checks on COLD START, not resume. Settings' footer shows
  version, update id, channel and runtime (`app/src/lib/buildInfo*.ts`);
  Settings has a manual "Check for update now" button. Both reach a device
  only once it runs a native build that has them.
- Full diagnosis history: `docs/decisions/eas-update-delivery.md`.

## PENDING_SQL workflow

Claude never runs SQL against the live database; the owner runs it in the
Supabase SQL Editor. `docs/PENDING_SQL.md` is the permanent log.
1. **Write**: append `## N. TITLE (owner decision YYYY-MM-DD) — NOT YET
   APPLIED` with the full SQL (idempotent: `if not exists`/`create or
   replace`), a read-only PREVIEW/verification query where data changes,
   and a `- [ ] N run` checklist line. Mirror the runnable SQL as
   `pending_N.sql` at the repo root for copy-paste.
2. **Ship safely**: client code must degrade gracefully before the SQL
   runs (an unknown-column write no-ops; nothing crashes). Edge Functions
   that depend on the new schema are redeployed AFTER it runs. A new
   `profiles` column must be sorted into invariant #24's CLEARED/KEPT
   bucket; a new table follows the new-table checklist below.
3. **Mark applied** (only after the owner confirms it ran): header ->
   `— ✅ APPLIED YYYY-MM-DD`, checkbox -> `[x]`, and the mirror line ->
   "Mirror file `pending_N.sql` removed after the owner confirmed it was
   run (date)". Before deleting `pending_N.sql`, make sure its SQL is
   inlined in the section (some sections only pointed at the file). Delete
   the file in the same commit ("Mark §N (...) applied, remove
   pending_N.sql") and update "Current state" below.
4. If anything in PENDING_SQL disagrees with the live DB, the live DB wins.

## Working rules (owner, 2026-10-13)

1. **Report before fixing.** When a bug's cause isn't proven yet, trace it
   and report the root cause with `file:line` references first. Change
   code only after that report — unless the owner says "just fix".
2. **Mapping/design table first.** Before implementing anything that
   classifies, maps or reshapes data (categories, carrier codes, report
   columns, backfills, migrations), show the mapping or design table and
   wait for the owner's approval.
3. **Null never beats a number.** A missing, zero or empty value must
   never overwrite a real value — in merges, guards, backfills,
   re-imports and multi-page extraction. A missing expense source must
   fail loudly (error or needs-review), never quietly sum to $0.
4. **Passing tests are not "done".** Every report states what was
   verified on real data, what could NOT be verified here (device, live
   DB, real PDFs, EAS servers), and exactly what the owner must run.
5. **Scope discipline.** A change requested for one screen, carrier or
   category stays there. If it needs files outside that scope, stop and
   ask first.
6. **Every task ends with a ship list**: PENDING_SQL sections to run (or
   "none"), Edge Functions to redeploy (or "none"), and whether it ships
   via `eas update` or needs a native `eas build`.
7. **Commands for the owner**: Windows PowerShell, each command in its
   own code block with the `cd` line first; `supabase functions deploy`
   from the repo root, `eas` from `app/`.
8. **Device symptoms**: before diagnosing a symptom the owner sees on the
   tablet, confirm the Settings version line shows a build or update that
   contains the fix. "Embedded build" means OTA updates are not reaching
   the device, and the symptom may come from old code.

## Core rules promoted from dated entries

**One KPI engine.** Every KPI (gross, net, expenses total/fixed/variable,
miles, RPM, CPM, net/mile, per diem days) on every screen comes from
`computeKpis()` (`app/src/stats/kpi.ts`), given an explicit `truckScope`
and `DateWindow` (`null` = all-time). It filters rows once by window, then
composes the tested primitives (`calcCanonicalCpm`, `calcMiles`,
`sumCanonicalExpenses`, `calcPerDiemDays`, `buildTruckComparison`). No
screen keeps its own copy of a KPI formula; the same week + scope must
show identical numbers everywhere. A new KPI is added to `computeKpis()`,
never to a screen. Full: `docs/decisions/kpi-consistency.md`.

**Accounting: two layers + the origin rule.** Layer 1 (source of record):
every row keeps its origin — `source` (`settlement`|`import`|`manual`) +
`settlement_id` on deductions/maintenance_records/tolls; fuel_purchases
use nullable `settlement_id`; carrier lives on `settlements.carrier` and
is inherited via `settlement_id`. Layer 2 (general ledger): grand totals
(`computeKpis`, `sumCanonicalExpenses`, `calcTrueProfit`,
`buildProfitAnalysis`) never filter by source — every expense counts once;
the only exclusion is the double-count guard for settlement-linked fuel.
Origin rule: out-of-pocket vs settlement-withheld is checked FIRST, alone,
on every row; only out-of-pocket rows can get an `accountant_category` or
appear on "For Prime Inc Drivers" (sole exception: Prime withheld lumper
lines, read-only). Tax side: invariant #1. Full:
`docs/decisions/accounting-model.md`, `docs/decisions/prime-lumper.md`.

**Golden settlement (profit oracle).** Reimbursements OFFSET expenses
(never revenue, every carrier); the duplicate-fuel guard is per row;
settlement-linked fuel/reimbursements follow their settlement's week;
the truck fixed-cost estimate is in CPM/PPM only, never in profit.
`app/src/data/__tests__/goldenPrimeSettlement.test.ts` asserts the real
Prime week (profit 2,534.36) on every profit screen — it must stay green.
Second golden week `goldenPrimeSettlement0814.test.ts` (W/E 8/14, profit
4,987.74, prior week balance forward 1,202.92-) must stay green too.
Full: `docs/decisions/golden-settlement.md`.

**Prime statement as source; profit is never the deposit.** A Prime week
whose Statement of Income and Expense passed its GATE (every check inside
the statement + statement week ending; 2026-10-17) counts from
that statement (`settlements.statement`, §77); its linked rows are detail
only. The bank deposit and the amount owed to the carrier are READ from
the statement, never computed, and never labeled profit.
Full: `docs/decisions/prime-statement-source.md`.

**Simple import flow (batch D2, 2026-10-31).** A settlement shows only
READING / CHECK AND CERTIFY / COULD NOT READ. ONE pass/fail gate
(`app/src/import/settlementGate.ts` `evaluateSettlementGate()`), used by
the card AND `saveExtraction()`; no override, no "Save anyway". A fail
re-reads automatically up to 2 times, then COULD NOT READ (nothing saved).
Line details that disagree with the passed statement: the week saves
without line rows (`statement.linesNotSaved`). Certify and add is one step;
certify is the LAST write. The only week status is "Certified on <date>" /
"Not certified [Certify]" — no Verified/Unverified labels, no review
lists. Full: `docs/decisions/simple-import-flow.md`.

**Printed dates; held by carrier (2026-10-29).** The model never
interprets a date: ai-import returns dates as printed and
`app/src/import/printedDates.ts` parses them (Prime: YY/MM/DD settlement
and statement dates, M/D/YY print date, MMDD lines take the week ending's
year). Any gate failure blocks Save until the owner answers the one-line
question; nothing before 2020 is saved. What a carrier holds is its
PRINTED balance as of the newest statement (`heldByCarrier()`), never a
sum of escrow deductions; deposits count one per statement. Full:
`docs/decisions/printed-dates-and-held.md`.

**Import jobs: 150 s, resumable.** Never assume more than the Free-plan
150 s per Edge Function invocation. Background PDF imports are chains of
short runs that store each page as it finishes and resume at the first
unfinished page (`supabase/functions/ai-import/jobEngine.ts`, §78). Full:
`docs/decisions/settlement-import-chunking.md` ("Resumable jobs").

**Carrier isolation.** A carrier payroll/settlement code ("DH", "BT",
"AP") means something only at the carrier that issued the statement. Code
maps (`carrier_code_maps`, global, service_role-written; Prime Inc is the
only seeded carrier, `docs/CARRIER_CODES.md`) apply only when the
settlement's own extracted `settlements.carrier` verifiably matches
(`normalizeCarrierKey`/`isPrimeCarrier`/`findCarrierCodeMatch`). Unknown
carrier -> the generic description classifier, never another carrier's
meanings, never a guess from the profile or past imports. Same isolation
for Prime-only reconciliation (operating statement) and Prime-only
screens/labels ("For Prime Inc Drivers" uses an explicit allowlist).
Full: `docs/decisions/carrier-scoped-codes.md`.

**NULL-truck rows.** `truck_id IS NULL` = a fleet-level row (insurance,
permits, most deductions). The fleet view includes every row; a
specific-truck scope — ALWAYS the case for a single-truck account (n=1
shortcut, invariant #7) — must match `truck_id = X OR truck_id IS NULL`,
never plain equality (SQL `=` and JS `===` both drop NULL rows). Choke
points: `entityHooks.ts` `applyFilters()`, `loadsScope.ts`
`filterLoadsByTruckScope()`, `computeKpis()`'s scoped branch. This bug was
reintroduced once already — every new scoped filter needs a NULL-truck
test. Full: `docs/decisions/null-truck-exclusion.md`.

**Dates and numbers from text.** A stored date-only value (`YYYY-MM-DD`)
is a local calendar day: parse/format/bucket it only through
`app/src/lib/dateOnly.ts` (never `new Date(str)` or
`toISOString().slice(0, 10)`). Every number read from text (AI output,
statements, backups, form inputs) goes through `app/src/lib/number.ts`
`num`/`numOrNull` (never `Number(text)`/`parseFloat`). Both have source
checks. Full: `docs/decisions/master-plan-2026-10.md` (batch 0b).

**Shared description rule.** One module, `app/src/lib/descriptionText.ts`,
for every deduction description / expense note written or shown. Text
counts only if it has a letter or digit (blank, spaces, "/", "-", ":",
" — ", "()" are missing); pieces join only when both sides are real;
fallback is "<category> — <M/D>", never a bare separator. Precedence:
saved -> linked/extracted -> vendor -> category + date -> label (mirrors
`resolveDocumentTitle()`). Writes go through `withSafeDescription()`/
`ensureDescription`, displays through `describeDeduction()`; never render
`description ?? '—'`. Full: `docs/decisions/shared-description-rule.md`.

**New-table checklist.** A new user-data table ships with ALL of: RLS
enabled + `user_id = auth.uid()` policies; a place in BOTH
`TABLES_IN_DELETION_ORDER` lists (`supabase/functions/reset-data` and
`delete-account`, children before parents — redeploy both); an entry in
`AFFECTED_TABLES` (`app/src/data/queryInvalidation.ts`, regression-guarded
by its test); an entry in `EXPORT_TABLES` (`app/src/data/exportAllData.ts`);
its row in `docs/DATA_FLOW.md`; FKs that a reset/delete can satisfy (`on
delete set null`/`cascade`); a PENDING_SQL section. New `profiles` column:
invariant #24's buckets.

**i18n.** Binding text: invariants #11 (see its ⚑ marker for the 5
enabled locales), #15, #16 below. Every key goes into all 7 locale files,
`en.json` first; glossary terms stay English (`glossary.test.ts`). Full:
`docs/decisions/i18n-languages.md`.

## Standing rules and invariants (verbatim from the original CLAUDE.md)

Lines starting with ⚑ are amendment markers added 2026-10-13; the text
under each is unchanged original wording.

- `legacy/index.html` is the source of truth for business logic. When in doubt,
  match its behavior and cite the function name you ported. It is NOT a
  source of truth for identity — `legacy/index.html` bakes in one specific
  owner's name, company, and truck as a matter of it being a single-file,
  single-user app; the mobile app is a clean multi-tenant product (owner
  decision 2026-07-09, PRODUCT DECISION). New users start with ZERO data
  and no owner-specific defaults anywhere: no hardcoded company name
  ("BOZKA TRUCKING AI" the product brand is fine; "Graywolf Logistics LLC"
  as a value is not), no hardcoded truck (unit number, year/make/model —
  the legacy-backup importer reads truck identity FROM the backup file's
  `DB.assets.tr`, never a specific truck), no non-zero business-balance/
  capital default. The legacy-backup importer (`app/src/data/legacyImport/`)
  is a generic migration feature for any web-app user, not an Ali-specific
  one-off — including numeric fields, not just names: its `ensureTruck()`
  used to fall back `fleet_mpg` to `8.9` (the original owner's actual MPG)
  when a backup's health data omitted it, which is exactly the identity
  leak this rule forbids (bug fixed 2026-07-30) — a missing value falls
  back to `null`, never a specific owner's number. The same class of bug
  existed in the Cash Flow 30-day forecast (`app/src/stats/
  cashFlowForecast.ts`, `app/app/(tabs)/more/cash-flow.tsx`): its budget
  inputs (truck payment, fuel, other weekly expenses) defaulted to the
  original owner's own numbers ($1145/$1800/$500) directly in the
  calculation whenever `profiles.cf_*` was null — so even a perfect Reset
  All Data (invariant #24) silently "came back" because the FORM/MATH
  refilled them, not the database. Every Cash Flow budget input now
  contributes exactly `$0` when unset; the 25% tax reserve is the one
  field allowed to appear as a labeled UI suggestion
  (`taxReservePctSuggestion`) but is never applied to the math unless the
  user actually enters it. Any future numeric default sourced from
  `legacy/index.html` (a form placeholder, a `||`/`??` fallback, a seeded
  constant) must be checked against this rule before being ported: legacy
  business LOGIC (formulas, thresholds, tax math) is fair game to port
  verbatim per the rule above, but a legacy DATA VALUE (this owner's
  actual truck payment, MPG, balance, truck unit) is never a valid
  fallback for another user's empty field. A first-launch onboarding
  wizard (PROMPTS.md Session 9b) is the
  only place a user's own company/truck/balance get set.
- Never weaken these invariants:
  1. Settlement-withheld deductions are never counted as tax deductions
     (net-pay model: income = net settlement pay; expenses = out-of-pocket only
     + per diem $64/day).
  2. Payment methods are exactly 9 generic values: Business Checking,
     Business Credit Card, Personal Checking, Personal Credit Card, Cash,
     Venmo, Cash App, Zelle Personal, Zelle Business (see
     app/src/import/paymentMethods.ts) — never a bank-brand string like
     "BofA Business"; map any legacy/free-text value into one of these 9.
     isPersonal = NOT /business/i AND /personal|cash|venmo|zelle/i (the
     NOT-business guard is why "Zelle Business" correctly reads as
     business-paid despite matching /zelle/i). A personal-payment purchase
     creates/updates an id-linked capital contribution ONLY after an
     explicit confirmation dialog (asked once per receipt, not per line
     item) — declining saves the deduction with no contribution. Deleting or
     editing a deduction that DOES have a linked contribution still syncs it
     (add/update/remove — never duplicate); this sync rule is unconditional,
     the confirmation gate only applies to creating a NEW contribution at
     import time.
  3. Store purchases book qty × unit price per item. NO separate "Sales tax
     & fees" row and NO separate service/add-on row: sales tax, shipping/
     handling, and any add-on/service/protection-plan line (any name —
     "Add-on services", "... service (for X)", "Walmart Protection Plan",
     "installation/delivery service", etc.) fold into the REAL items' costs
     PROPORTIONALLY (any remainder cent goes to the largest item) so the
     booked total always equals the receipt's grand total to the cent — no
     dollar is silently lost, and none of it is left sitting in its own
     line either. If a fee/service line names its parent via "(for X)" (or
     the item name otherwise makes the parent obvious), fold it directly
     into that item instead of the proportional split. Each item's
     description gets an "(incl. $X tax/fees/services)" suffix showing how
     much of its booked cost is folded-in tax/fees/services. If a receipt
     contains ONLY service/fee lines (no real item to fold into), keep them
     as their own row(s), each description prefixed "NEEDS REVIEW: ".
  4. Truck Health intervals are per-truck, user-editable settings, not code
     constants — every truck is different and each owner tunes their own
     service schedule in Settings. The legacy values (oil 50,000 mi fixed;
     fuel filter bundled with oil; DPF mpg-based; transmission 500k synthetic
     / 250k conventional; differential 500k synthetic / 100k conventional;
     air filter 100k; air dryer 250k; chassis 30k; APU every 2,000 engine
     hours; coolant extender 300k / full replace 600k; DEF filter 300k) are
     SEED DEFAULTS copied into `maintenance_intervals` when a truck is
     created (see docs/SCHEMA.sql) — not permanent constants to hard-code.
     Disabling a category (`enabled=false`) hides it from Truck Health.
     Session 8 scope decisions: the health math lives ONLY in
     `app/src/truck/health.ts`'s `calcTruckHealth()` — a pure, unit-tested
     TS port of legacy's `rHealth()`/`applyMaintToHealth()`, same "every
     calculation is a tested app/src/ function, never a SQL view" pattern
     as CPM/per diem/tax estimate/driver payroll. The `truck_health` SQL
     view in `supabase/migrations/0001_init.sql` is NOT used by the app —
     it predates this invariant and stays in the schema unused rather than
     being dropped, but no screen may query it; a `0` baseline (no record,
     no override) would render a false "OVERDUE" on a brand-new truck with
     real existing mileage, which `calcTruckHealth()` avoids via a
     `'no_data'` status (neutral "no records yet" prompt) that the SQL
     view has no equivalent for. `truck_health_config.overrides` (manual
     baseline entry) has no editing UI yet — deliberately deferred, since
     the seeded-intervals-plus-no_data-prompt empty state already satisfies
     the "clean, not broken-looking" requirement for a fresh truck.
  5. Every delete cascades: linked capital contributions, document records
     (duplicate detection), fuel purchases (ON DELETE CASCADE from
     settlements — matches legacy deleteSett()'s hard-delete of that week's
     fuel rows, not a soft/orphaning detach), and maintenance-derived health
     values.
  6. NO tax constant may live in app code — no bracket table, standard
     deduction, SE-tax rate, per diem rate, quarterly deadline, or state tax
     table is ever hardcoded or bundled into a TypeScript module. Every one
     of them is read (and cached offline) from the server-side
     `tax_year_data` table (docs/SCHEMA.sql) — NOT user-scoped, one row per
     tax year, readable by all authenticated users, writable only by
     service_role (an admin seeds/updates it — docs/ADMIN_RUNBOOK.md). This
     is what makes the tax engine product-ready, not single-user, and lets
     a new tax year or a corrected figure ship with no app release
     (tax_config table on the user side: tax_year, filing_status, state,
     include_state_tax, entity_type, scorp_salary,
     scorp_payroll_tax_handled — see docs/SCHEMA.sql). If the current tax
     year's row is missing or unpublished, fall back to the latest
     published year and show a banner — never silently compute with an
     empty/default bracket table. The 2026 federal bracket tables and
     SE-tax math seeded into `tax_year_data` are the verbatim port of
     legacy calcTax() (including that legacy uses the same bracket table
     for 'single' and 'hoh' — do not "fix" that).
     entity_type='sole_prop' and 'smllc' MUST share the identical
     computation path (smllc is a UI label only, never a math branch);
     'scorp' is the only entity_type that branches SE tax (applies to
     scorp_salary only, not full net profit) and relabels Capital Account
     draws as distributions. entity_type gained a 4th value,
     'multi_member_llc' (owner decision 2026-07-10, PRODUCT DECISION,
     docs/PENDING_SQL.md §18) — scopes the whole estimate to just that
     member's `ownership_pct` (0-100, `tax_config.ownership_pct`) share of
     net profit before AGI/SE-tax/brackets ever apply
     (`calcTaxEstimate.ts`'s `ownerShareOfProfit`); `netProfit` itself stays
     the full LLC profit, unscoped, so a fleet-wide dashboard figure is
     never silently altered by one member's ownership %. 'scorp' also
     gained an employer-payroll-tax estimate this pass: unless
     `scorp_payroll_tax_handled` is true (the owner attests a payroll
     provider already accounts for it), the engine estimates the
     employer-side FICA cost of `scorp_salary` from
     `tax_year_data.se_tax.employer_fica` and subtracts it from
     `ownerShareOfProfit` as a real business expense — this is what "the
     existing reasonable-salary preview promoted to full flow with
     owner-salary W-2 treatment" means. `tax_year_data` gained two more
     server-sourced constants this pass (docs/PENDING_SQL.md §17), same
     "never hardcode, never silently compute empty" rule as every other
     constant here: `se_tax.employer_fica` (7.65% employer-side FICA match,
     used for both the scorp owner-salary estimate above and driver W-2
     "true cost of employee") and `nec_1099` (`{threshold, filing_deadline}`
     — the IRS 1099-NEC $600/Jan-31 filing rule; see invariant #7's driver
     compensation-types extension for how this drives the Dashboard
     reminder). Both are optional/graceful-fallback fields (same pattern as
     `per_diem.full_daily_rate`) since they gate an informational banner,
     not a computed tax AMOUNT, until docs/PENDING_SQL.md §17 has run.
  7. No code path may assume a single truck. truck_id flows through every
     query (settlements, fuel, maintenance, health, notifications); a
     single-truck account is just the n=1 presentation of the exact same
     fleet-wide logic (active-truck context hides the picker and any
     fleet-only UI when count===1), never a separate code path that has to
     be kept in sync with the multi-truck one. Users may add unlimited
     trucks (2nd, 3rd, ...Nth), each seeding its own maintenance_intervals
     on creation (Truck Health stays per-active-truck; a fleet-wide
     aggregation view is separate, gated on 2+ trucks). Drivers (owner
     decision 2026-07-09, PRODUCT DECISION) extend this the same way but
     are OPTIONAL, not mandatory like trucks: the `drivers` table
     (docs/PENDING_SQL.md §13) and `driver_id` on settlements/loads/
     fuel_purchases/withheld-deductions (§14) exist so payroll can be
     auto-routed, but an account with zero driver rows — or a settlement
     with no driver name extracted — behaves exactly as before, `driver_id`
     staying null, no picker ever forced (`app/src/import/driverMatch.ts`
     `resolveDriverMatch()`, deliberately less aggressive than
     `resolveTruckMatch()`). Payroll auto-routing: the ai-import settlement
     schema carries `unit` (the truck's unit number — existing since the
     Session 6 fleet-scalability work) and `driverName`; on import, `unit`
     is matched against `trucks.unit_number` (exact) and `driverName`
     against `drivers.name` (case-insensitive, trimmed) to auto-tag the
     settlement and all its rows. No match on either → the import preview
     shows a picker to choose an existing truck/driver OR create one
     inline (`app/app/(tabs)/import/index.tsx`) — the newly created row
     persists normally, so it auto-matches on every future import without
     any separate alias/memory mechanism. Driver compensation types (owner
     decision 2026-07-10, PRODUCT DECISION, extends this invariant):
     `drivers.compensation_type` is one of `w2_employee` / `1099_contractor`
     / `team_split` / `trainee` (docs/PENDING_SQL.md §15); `pay_type`/
     `pay_rate` are informational display fields only — the tax engine
     (`app/src/tax/driverPayroll.ts`) NEVER derives an amount from them,
     only from actual recorded `driver_payments` rows (§16, `on delete
     cascade` from `drivers` — unlike every other `driver_id`, which is `on
     delete set null` — because a payment record has no meaning without the
     driver it paid). `sumDeductibleDriverPayroll()` reduces the owner's net
     profit by `gross_pay + employer_taxes` uniformly across all four
     compensation types (1099 = "Contract Labor", W-2 = wages + employer
     FICA = "true cost of employee", team_split/trainee = the driver's
     settlement share) — `employer_taxes` defaults to 0 and is only ever
     populated for `w2_employee` payments, which is what keeps this one
     formula instead of a type-specific branch. A driver's YTD 1099 total
     crossing the IRS $600 threshold (`tax_year_data.nec_1099`, §17) surfaces
     a Dashboard reminder to file a 1099-NEC (`calcContractLaborYtd()`).
     team_split/trainee: the import preview shows a "driver's share of this
     settlement" input whenever the resolved/selected driver has that
     compensation_type (`app/app/(tabs)/import/index.tsx`
     `showsDriverSplitInput`) — entering an amount creates a `driver_payment`
     linked to the new settlement; re-importing that settlement replaces it
     (CLAUDE.md invariant #10's re-import-replace behavior extends to this
     row too, not just settlement/loads/fuel/reimbursements/deductions).
  8. This app provides ESTIMATES, not tax/legal/financial advice.
     (a) Every screen showing tax figures (Dashboard tax cards, tax
     estimator, S-Corp preview, quarterly payments, per diem) must include a
     persistent small-print line: "Estimates only — not tax advice. Verify
     with your CPA." (b) UI copy must always say "Estimated" / "~" before
     tax figures — never present a tax number as definitive. (c) AI Advisor
     responses get an automatic footer: "General information, not
     professional tax advice." (d) `profiles.tos_accepted_at`/`tos_version`
     (docs/SCHEMA.sql, D12) gate all data entry on first launch until Terms
     of Use are accepted, and re-prompt whenever `tos_version` changes
     (PROMPTS.md Session 3) — see docs/TERMS_OF_USE_DRAFT.md (attorney-review
     draft, not itself legal advice) and Settings > Legal (PROMPTS.md
     Session 10) for the paired Privacy Policy.
  ⚑ #9 AMENDED 2026-07-30 by invariant #25: per diem days are now stored per settlement (`per_diem_days` 0-7, smart default from miles, user-editable) and `calcPerDiemDays()` SUMS them (MIN on a duplicate `week_ending`) — no longer a flat 7 x distinct weeks. "Never derive from load pickup/delivery dates" still binds.
  9. Per diem days are DETERMINISTIC: 7 × the number of distinct settlement
     weeks (deduped by `week_ending`) — `app/src/tax/perDiem.ts`
     `calcPerDiemDays()` takes only `week_ending` values, nothing else.
     Never derive per diem from AI-extracted load `pickup_date`/
     `delivery_date` — those columns stay in `loads` (docs/PENDING_SQL.md
     §8) and keep being populated for possible future use, but re-running
     the same extraction can produce different dates run to run, which
     would make the tax engine's own output non-reproducible.
  ⚑ #10 AMENDED 2026-08-02 then 2026-08-27: the `business_balance` clause changed twice — re-import first credited only the net-pay DELTA (`settlements.business_balance_credit`, §37/§38, PRE-LAUNCH HARDENING), then balance tracking was removed outright (client never writes it; columns left inert; §72 server side UNCONFIRMED) — docs/decisions/balance-removal.md. Replace, match-key and date rules still bind.
  10. Re-importing a settlement for a `week_ending` that already exists
      REPLACES that week's batch-tagged rows (settlement, loads, fuel,
      reimbursements, withheld deductions — all keyed off the stable
      `settlement_id` from the settlement match) instead of duplicating
      them (`app/src/data/aiImportSave.ts`, owner decision 2026-07-09,
      mirrors the web app's v2026.07.09-A behavior). Maintenance/tolls/
      loans are NOT part of this replace. A replace must not re-credit
      `business_balance` with that week's net pay a second time. The match
      key is `(user_id, week_ending, truck_id)` — NOT `(user_id,
      week_ending)` alone (bug fixed 2026-07-30, docs/PENDING_SQL.md §34):
      a fleet with 2+ trucks routinely has every truck settle on the same
      `week_ending`, and matching without `truck_id` silently replaced one
      truck's settlement with another's. `findExistingSettlement()`
      (`aiImportSave.ts`) is the one shared lookup for this match — used
      both by the actual save/replace decision and by the import preview's
      "this week is already imported, saving will replace it" banner, so
      the two can never disagree. A settlement with no resolvable
      `week_ending` must never silently save under an empty-string match
      key (two such settlements would collide with each other) — the save
      throws instead, since the preview's date field already requires the
      user to see/set this value. DATE HARDENING round 3 (bug fixed
      2026-07-30, root cause of "every settlement replaces the last one"):
      the ai-import extraction prompt's round-2 "prefer the near-today
      reading" instruction (for resolving a year/day-order ambiguity in a
      date that IS printed on the document) was being over-applied to
      INVENT a `weekEnding` when the real one couldn't be found at all,
      landing every settlement on ~today and making them all collide on
      the replace match key. The prompt now has an explicit, settlement-
      specific addition forbidding that: `weekEnding` must come only from
      the document's own printed week-ending/settlement-date text, never
      from today's date, and must be left `""` (never guessed) when
      genuinely absent. Client-side, `app/src/import/dateGuard.ts`'s
      `isSettlementWeekEndingMissing()` renders the preview's date field as
      a prominent, required "Week Ending" field for settlements and blocks
      Save until the user has confirmed a value — this is what actually
      enforces the invariant on-device even if a future prompt regression
      lets the model guess again. Carrier-portal filename false-duplicates
      (e.g. Prime exports every week under one fixed filename) are also
      excluded from the duplicate-import warning for settlements
      specifically (`app/src/import/duplicateCheck.ts`) — only a genuine
      content match (docType + `week_ending` + amount) flags a settlement
      as a possible duplicate, a filename match alone never does. DATE
      HARDENING round 4 — settlement date anchor (owner decision
      2026-07-30, DEFINITIVE FIX, owner's own field diagnosis): carrier
      statements print an unambiguous header print date ("DATE:",
      commonly M/D/YY) about a day before the ambiguous "SETTLEMENTS
      DATE:" (commonly YY/MM/DD, = weekEnding). `settlement.printDate` is
      now extracted alongside weekEnding; `app/src/import/dateGuard.ts`'s
      `resolveWeekEndingWithAnchor(printDate, weekEndingCandidate)`
      deterministically picks whichever digit-order reading of weekEnding
      (as extracted, or year/day-swapped per `trySwapYearAndDay()`) falls
      within `[printDate, printDate+7 days]` — a window tight enough that
      only the correct reading can ever land inside it — and takes
      priority over round 2's "closest to today" heuristic in
      `sanitizeExtractionDates()` whenever printDate is present. Returns
      null (never a guess) when printDate is missing or neither reading
      fits, same as every other rule in this list.
  ⚑ #11 AMENDED (LANGUAGE PICKER pass, undated, ~2026-08-27): v1 ships `ENABLED_LOCALES` = en, es, ru, tr, hi (`app/src/i18n/config.ts`); ar and uk are DISABLED (files, parity and glossary tests kept; no RTL surface ships in v1). All 7 files still get every key — docs/decisions/i18n-languages.md.
  11. Multi-language support (owner decision 2026-07-09, PRODUCT DECISION,
      binding; Hindi/Ukrainian added same-day addendum): target languages
      are English (default), Spanish, Russian, Arabic, Turkish, Hindi, and
      Ukrainian (7 total; only Arabic is RTL) —
      `app/src/i18n/locales/{en,es,ru,ar,tr,hi,uk}.json`, `en.json` is the
      source of truth (every new key is added there first, then
      translated into the other six — `app/src/i18n/index.ts` has a
      static parity check script pattern; keep all 7 files' key sets
      identical). `hi.json`/`uk.json` currently ship as untranslated
      copies of `en.json` (selectable, structurally complete, English
      text) — real translation is PROMPTS.md's Session 9c, not to be done
      piecemeal; when doing it, Ukrainian and Russian are distinct
      languages and must be translated independently, never by adapting
      `ru.json`. NO hardcoded user-facing string may ship in a screen —
      every string goes through `useTranslation()`'s `t()` (or, outside a
      component, the default `i18n` export's `i18n.t()`, e.g.
      `app/src/lib/confirmOwnerContribution.ts`). First-launch: the app
      opens in the device's OS language when it's one of the 7 supported
      (Arabic in RTL); anything else falls back to English
      (`resolveInitialLocale()`). A manual choice in Settings > Language is
      cached locally (`app/src/i18n/localeStorage.ts`) AND written to
      `profiles.locale`, and always wins over the device language
      afterwards, on every device the user signs into (synced in
      `AuthContext.fetchProfile()`). Arabic requires RTL: use logical
      style properties (`marginStart`/`marginEnd`/`start`/`end`), never
      `marginLeft`/`marginRight`/absolute `left`/`right` — `I18nManager.
      forceRTL()` only takes effect after a native reload, so switching
      to/from Arabic in Settings shows a "restart required" prompt
      (`app/src/i18n/rtl.ts`). Every session's verification step includes
      an RTL smoke-check (switch to Arabic, confirm no clipped/overlapping
      layout) — see PROMPTS.md. What does NOT get translated: user data
      (deduction descriptions, store names, notes), AI-extracted content,
      the enumerated domain values that CLAUDE.md invariant #2/payment
      methods and the deduction category list rely on regex/exact-string
      matching against (their pill labels stay English on purpose — see
      `app/app/(tabs)/deductions.tsx`), and legal documents (Terms of Use
      stays English-only until attorney review, docs/TERMS_OF_USE_DRAFT.md).
  12. NO LOCATION (owner decision 2026-07-10, PRODUCT DECISION, binding):
      this app does not collect or track user location. No location
      permission (`expo-location` or any equivalent) is ever requested, no
      GPS reading is ever taken, and no location-derived value (lat/long,
      geofence, route trace, mileage-by-GPS) is ever stored in any table —
      `loads.loaded_miles`/`empty_miles` and `settlements.miles` come
      exclusively from AI-extracted settlement documents (odometer/carrier-
      reported figures), never a device sensor. This must be reflected in
      the Session 10 privacy policy ("we do not collect location") and in
      the app's own permission manifest (no `NSLocationWhenInUseUsageDescription`/
      `ACCESS_FINE_LOCATION` entries). A future opt-in IFTA mile tracker
      using real GPS is explicitly OUT OF SCOPE for now — parked in
      PROMPTS.md's backlog as a v2+, explicitly-opt-in-only feature that
      would need its own separate owner decision and permission prompt,
      never silently bundled into an existing feature.
  13. USER DATA IS PRIVATE (owner decision 2026-07-10, PRODUCT DECISION,
      binding): each user's financial data (settlements, deductions, loads,
      fuel, capital account, everything RLS-scoped to `auth.uid()`) is
      private to that user. The operator (BOZKA TRUCKING AI / whoever runs
      the Supabase project) does not access an individual user's data
      except (a) with that user's explicit consent, given for a specific
      support request, or (b) where legally required (e.g. a valid
      subpoena). This is an operational/access-policy invariant, not a
      schema one — every table already has RLS (invariant below) that
      technically prevents user-to-user access; this invariant is about
      what the OPERATOR (who has service_role access) may do, and must be
      stated plainly in the Session 10 privacy policy ("your financial data
      is yours — we don't look at it without your permission"). Only
      aggregate, anonymized product metrics (user counts, feature-usage
      counts, import volumes, error rates — never a query scoped to one
      user's own rows for product-analytics purposes) may be collected for
      operations; any analytics/telemetry integration added in a future
      session must be audited against this invariant before being wired
      in, not after.
  14. UNIVERSAL AI CAPTURE — every routing rule (owner decision 2026-07-10,
      PRODUCT DECISION, binding): every business income & expense document
      must be capturable by photo/PDF and auto-routed to the right ledger
      with minimal user effort. Every captured document ends up as exactly
      one of: an income row / an expense (deduction) row / a capital
      transaction / an informational archive-only entry — with the
      original file in Storage and the full raw extraction in
      `documents.parsed_json` (D3 audit trail) regardless of which bucket
      it lands in. Settlement extraction is carrier-agnostic — the AI
      extracts generic fields (carrier, week, gross, deductions, net,
      miles, loads, driver/unit) from ANY carrier's settlement layout, no
      single carrier's format is ever assumed
      (`supabase/functions/ai-import/index.ts`'s
      "carrier-agnostic settlement extraction" addition). docTypes are
      added incrementally as new document categories become common enough
      to warrant their own routing (`driver_payment` → `driver_payments`
      table, never `deductions`; `insurance`/`lease_rent`/
      `factoring_statement`/`utility_subscription` → `deductions` via
      `mapFinancialDocDeduction()`; `government_or_misc_income` is INCOME
      with no dedicated ledger yet — archived only, no financial row
      created, same treatment as `w2`, until a real income ledger exists —
      see PROMPTS.md's "Supported document types" backlog table for
      current status per type). An unknown-but-clearly-financial document
      NEVER gets silently dropped or silently guessed into the wrong
      ledger — it falls back to docType `'other'` with an AI-suggested
      category (`suggestedCategory`) and is saved as a deduction prefixed
      `"NEEDS REVIEW: "` (extending invariant #3's NEEDS REVIEW convention
      from line items to whole documents), always with `confidence:"low"`.
      Every extraction carries a top-level `confidence:"high"|"low"` flag
      (`app/src/import/types.ts` `Extraction.confidence`); the import
      preview surfaces a review banner whenever it's `"low"`, prompting the
      user to confirm fields before saving rather than trusting a guess.
      Full coverage of every docType is a POST-LAUNCH v1.x track, not a
      Session 10 blocker — the launch-blocking core set is settlements
      (any carrier), store receipts, fuel, maintenance, W-2, bank/card
      statements, and driver payments (PROMPTS.md). Every new docType still
      obeys every other invariant unmodified: no separate tax/service rows
      (#3), the 9 payment methods + personal-payment confirmation (#2),
      accountant-readable naming, warranty extraction, per-truck/driver
      routing (#7) — universal capture is additive routing breadth, never
      a second set of rules.
  15. LOCALE-AWARE FORMATTING (owner decision 2026-07-10, PRODUCT DECISION,
      binding — personalization & onboarding package, item 3): every date,
      currency, and number displayed anywhere in the app follows the user's
      selected locale (invariant #11's 7 supported locales), via the
      standard `Intl` APIs (`toLocaleString()`/`toLocaleDateString()`) —
      never a hardcoded `'en-US'`. USD stays the CURRENCY (this app never
      converts an amount to another currency); only its FORMATTING
      localizes (symbol position, decimal/thousands separators, digit
      script). `app/src/i18n/format.ts` is the ONE shared module for this —
      `useFormatters()` inside a component (`money()`/`number()`/`date()`/
      `dateTime()`, all bound to the current `i18n.language`), or the plain
      `formatMoney()`/`formatNumber()`/`formatDate()`/`formatDateTime()`
      functions (which take an explicit `locale` argument) for a non-
      component call site — never a screen-local `money()` helper hardcoding
      a locale again. Scope decision (2026-07-10 pass): this invariant
      governs values that already go through explicit `Intl`-style
      formatting (currency amounts, and call sites that were already
      calling `toLocaleString()`/`toLocaleDateString()`); it does NOT
      retroactively wrap every raw stored date string (e.g. a deduction's
      `ded_date`) in `Intl.DateTimeFormat` — that's a larger, separate
      per-screen pass, not done this session. AI-generated free-text
      (docType `summary`, AI Advisor replies) is covered by invariant #16
      below, not this one — that's a translation concern (what LANGUAGE the
      text is in), this invariant is a formatting concern (how a number/
      date/currency figure is DISPLAYED).
  ⚑ #16 AMENDED 2026-08-27 (SIMPLIFICATION PASS item 4): the separate AI Advisor screen was deleted; its multi-turn chat now lives in CEO Mode ("Ask a Question", `app/(tabs)/more/ceo-mode.tsx`), still via `callAiAdvisor()` and the unchanged `ai-advisor` function, which still takes `locale` — docs/decisions/retired.md.
  16. AI IN USER'S LANGUAGE (owner decision 2026-07-10, PRODUCT DECISION,
      binding — personalization & onboarding package, item 4): `ai-import`
      and `ai-advisor` (Edge Functions) accept an optional `locale` in
      their request body and, when it's one of invariant #11's 6 non-
      English supported locales, instruct the model to write free-text it
      composes itself (a document's `summary`, an AI Advisor reply) in that
      language — standard financial/trucking terms may stay English when
      there's no natural equivalent (e.g. "per diem", "ELD", "IFTA"). This
      NEVER applies to enum-like fields (`docType`, `category`,
      `chargebackType`, `incomeType`, `serviceType`, `paymentMethod`) or to
      text copied verbatim from the source document (vendor names, item
      names) — only to text the model generates in its own words, same
      "don't translate the domain values invariant #11 already carves out"
      principle. `app/src/data/aiImportCall.ts`'s `callAiImport()` forwards
      the app's current `i18n.language`; `app/(tabs)/import/index.tsx`'s
      call sites pass it. `ai-advisor` accepts the same `locale` field as
      groundwork — no app screen calls it yet (PROMPTS.md Session 9b "AI
      Advisor"), that screen just has to pass `i18n.language`/
      `profiles.locale` when it's built, no further server-side work.
      i18n TERMINOLOGY RULE (owner decision, extends this invariant's
      "standard terms may stay English" into a binding glossary rather
      than a case-by-case judgment call): `docs/I18N_GLOSSARY.md` is the
      canonical DO-NOT-TRANSLATE list (per diem, coolant, DPF, DEF, ELD,
      IFTA, IRP, HVUT/2290, settlement(s), linehaul, fuel surcharge,
      detention, layover, lumper, bobtail, deadhead, reefer, APU, CDL,
      DOT, MC number, escrow, factoring, Schedule C, 1099, W-2, K-1,
      S-Corp, LLC) — every term on it stays in English (Latin script
      embedded in the sentence) in every locale's UI strings AND in
      AI-generated free text, no exceptions. Enforced by
      `app/src/i18n/__tests__/glossary.test.ts`, which asserts every
      glossary term found in `en.json` also appears in the corresponding
      key of every other locale file — a translation pass that
      accidentally translates a glossary term fails `npx jest`, not just
      review. Binding on PROMPTS.md Session 9c (Hindi/Ukrainian real
      translation) same as every other locale.
  ⚑ #17 RETIRED 2026-08-02 (DASHBOARD SIMPLIFICATION): Home is a fixed layout; the Customize Dashboard screen and its code are deleted. Struck-through original kept below — docs/decisions/retired.md.
  17. ~~CUSTOMIZABLE DASHBOARD~~ — RETIRED (owner decision 2026-08-02, see
      the DASHBOARD SIMPLIFICATION decision block below). Home is now a
      FIXED layout; this invariant no longer binds. Kept here, struck
      through, for history — do not re-implement any part of it without a
      fresh owner decision superseding the retirement.
      Original text follows, historical only:
      CUSTOMIZABLE DASHBOARD (owner decision 2026-07-10, PRODUCT DECISION,
      binding, not yet implemented — PROMPTS.md Session 9a): every
      dashboard card (the full parity set + Capital strip + any future
      card) must support drag-to-reorder, show/hide, and rename (a user's
      custom label overrides the i18n default; clearing it restores the
      i18n default — the override is never a replacement string baked over
      the translation, so switching app language still re-translates a
      card whose label the user never customized). Layout persists in
      `profiles.dashboard_layout` (docs/PENDING_SQL.md §19) per user, with
      a "Reset to default" action (`dashboard_layout = null`). No code path
      may hardcode the Dashboard's card list/order as the only possible
      arrangement once this ships — the default order becomes just that,
      a default, same spirit as invariant #7's "single truck is just the
      n=1 presentation" rule.
  18. ROLE-BASED APP MODE (owner decision 2026-07-10, PRODUCT DECISION,
      binding, not yet implemented — PROMPTS.md Session 9b, expanded
      onboarding wizard supersedes the earlier shorter spec):
      `profiles.role` (docs/PENDING_SQL.md §20) is one of `owner_operator`
      / `company_driver_w2` / `contractor_1099` / `trainee` /
      `lease_operator` (5th value, docs/PENDING_SQL.md §31, device
      feedback round 2, owner decision 2026-07-13), set during onboarding.
      `company_driver_w2` is the only value that changes rendering: it
      hides owner-only modules (Schedule C deductions, Capital Account,
      S-Corp election) and centers per-diem/W-2 tracking instead;
      `contractor_1099`/`trainee`/`owner_operator`/`lease_operator` all get
      the full Schedule C experience unchanged. `lease_operator` (leases a
      truck from another operator/carrier rather than owning it) is kept
      as its own distinct value rather than folded into `owner_operator`
      so a future carrier-lease-specific feature has something to key off
      without another migration — but it must never be treated as
      `company_driver_w2`. `role = null` (skipped the wizard, or a
      pre-existing account) MUST behave identically to `owner_operator` —
      never a third, undocumented behavior.
  19. CUSTOM CATEGORIES + TAX SAFETY RAIL (owner decision 2026-07-10,
      PRODUCT DECISION, binding): users may create their own income and
      expense categories beyond `CANONICAL_CATEGORIES`
      (docs/INDUSTRY_TAXONOMY.md §B) via `user_categories`
      (docs/PENDING_SQL.md §21 — entirely optional/additive, zero rows
      means every picker just shows the canonical list, same "n=0/1 is
      just the default presentation" spirit as invariant #7). Every
      category picker (deduction edit, manual add, import preview —
      PROMPTS.md Session 9a) must show canonical + the user's own active
      categories together, with an inline "+ New category" option — never
      two separate, un-mergeable lists. A custom EXPENSE category can NEVER
      silently fall out of the P&L/tax estimate: creating one requires a
      `schedule_c_bucket` mapping (defaults to `"Misc"` when the user
      doesn't pick one, `app/src/data/userCategories.ts`
      `applyScheduleCDefault()`), enforced by a DB check constraint too,
      not just app-level validation. A custom INCOME category has no
      bucket — it rolls straight into gross income, there is no Schedule C
      expense line for income. AI classification may suggest a user's
      custom categories too — `ai-import` accepts `customCategories` in
      its request body and instructs the model to pick from that exact
      list rather than inventing a new custom name itself (never let the
      AI silently create categories the user never defined).
  20. NO ARBITRARY USER-DEFINED SCHEMA COLUMNS (owner decision 2026-07-10,
      PRODUCT DECISION, binding — flexible fields instead of free-form
      columns): a user may never add their own ad-hoc column to any table.
      Every financial record already carries a system description
      (`description`/`note(s)`) plus an optional `tags` text field
      (docs/PENDING_SQL.md §22) for the user's own ad-hoc labeling/
      filtering — between custom categories (#19), `tags`, and `notes`,
      there is no legitimate need this app has ever hit that isn't already
      covered by one of these three, additive mechanisms. Why this is a
      hard invariant, not just a preference: a free-form user-defined
      column would have no place in the tax engine's fixed field list
      (CLAUDE.md invariant #6's tax constants, `calcTaxEstimate.ts`'s
      fixed input shape) or the Accountant Package's Schedule C rollup
      (PROMPTS.md Session 9b) — either the column gets silently ignored by
      every report (defeating the point of adding it) or every report
      would need to special-case an open-ended, per-user schema (breaking
      invariant #6's "no tax constant lives in app code, one shared
      constant, not a hundred user-specific ones" principle). `tags` is
      deliberately a single free-text field, not a normalized tags table
      or array column, to keep it that simple.
  21. COMPLIANCE TRACKER (owner decision 2026-07-10, PRODUCT DECISION,
      binding — AI feature package): `compliance_items`
      (docs/PENDING_SQL.md §23) covers 8 categories (medical card, annual
      DOT inspection, IRP registration, HVUT 2290, IFTA quarterly filings,
      insurance policy renewals, CDL expiry, drug-consortium enrollment);
      5 of them (`medical_card`, `annual_inspection`, `irp_registration`,
      `hvut_2290`, `insurance_policy`) auto-populate from matching
      ai-import docTypes — extracting a due/expiry date finds-or-updates
      the ONE matching row per `(user_id, type)` rather than duplicating
      it on every re-scan (`app/src/import/mapExtraction.ts`
      `mapCompliance()`). The AI never guesses a due date — a document
      with no visible expiration/due date is still archived (D3 audit
      trail) but creates no compliance item, same "never guess, flag
      instead" spirit as every other extraction rule. `ifta_filing`/`cdl`/
      `drug_consortium` have no extracting docType yet — manual-entry only
      until a real source document type is identified (v1.x if ever).
  ⚑ #22 AMENDED 2026-08-27: "AI Advisor" in this list now means the CEO Mode chat (separate screen deleted, see the #16 marker). The no-external-data rule is unchanged.
  22. NO EXTERNAL-DATA FEATURES (owner decision 2026-07-10, PRODUCT
      DECISION, binding — AI feature package, CEO Mode item): every AI/
      insight feature in this app (CEO Mode briefing, Profit Analysis,
      Maintenance Pattern Insights, AI Advisor) is composed ONLY from data
      the user's own account already holds — settlements, deductions,
      maintenance, compliance items, etc. NO live ELD integration, NO
      fuel-price feeds, NO inventory tracking, and no other pull from a
      third-party API for these features — not now, not as backlog, not
      without a fresh, explicit owner decision that supersedes this one.
      Profit Analysis's industry-benchmark comparison (PROMPTS.md Session
      9a) is the one adjacent case worth spelling out: it compares against
      PUBLISHED, static benchmark ranges (a `benchmarks` table with source
      + year, clearly labeled "industry reference, not peer data" in the
      UI) — never live anonymized peer data pulled from other users of
      this app. True anonymized peer benchmarking is deliberately deferred
      to v2+, once a real user base exists, and even then must be designed
      against invariant #13 (user data is private) from day one — never
      retrofitted onto data collected before that design existed.
  23. VIEW-ONLY MODE IS RETIRED (owner decision 2026-07-12, PRODUCT
      DECISION, binding — Session 9b parity-gap decision #4): legacy's
      `gw_readonly` device-local read-only toggle (FEATURE_INVENTORY.md
      §3.9 — intended for a spouse/other device to view a shared JSON
      backup without editing it) has NO equivalent in this app and never
      will as a device-local flag. It is formally obsolete under the
      multi-tenant model: every user already has their own
      `auth.uid()`-scoped account with RLS enforcing invariant #13, so
      "give someone read-only access to MY data" is a cross-account
      sharing problem, not a local UI lock. Its future replacement (an
      accountant/spouse read-only share link, scoped to one recipient,
      revocable, read-only by construction not by a client-side flag) is
      PROMPTS.md Backlog — a genuinely new feature requiring its own
      schema/RLS design, not a resurrection of `gw_readonly`. No mobile
      screen should ever gain a "View-Only Mode" toggle again without a
      fresh owner decision superseding this one.
  ⚑ #24 AMENDED (several passes, 2026-08-04 to 2026-08-28): balance tracking was removed 2026-08-27 but `business_balance` is still reset to 0. CLEARED grew: `cf_insurance_weekly`, `cf_income_override`, `cf_fixed_override`, `cf_variable_override`, `cf_periodic_overrides` (§57), `cf_recurring_charges` (§66), `nudge_state` (§49), `role_prompt_dismissed_at`, `ai_weekly_review*` (§65/§68), `accountant_package_exported_at` (§69). KEPT gained `tutorial_seen_at`. Source of truth: `PROFILE_DATA_RESET` in `supabase/functions/reset-data/index.ts`.
  24. RESET ALL DATA — exact kept/cleared list (owner decision
      2026-07-30, tablet-testing fix, binding): `supabase/functions/
      reset-data/index.ts` wipes every business-data table (settlements,
      deductions, fuel, maintenance, loads, trucks, drivers, documents,
      etc. — `TABLES_IN_DELETION_ORDER`) plus the matching Storage files,
      but never deletes the `profiles` row or the `auth.users` account
      itself (unlike Delete Account). Within `profiles`, exactly two
      buckets:
      - CLEARED (`PROFILE_DATA_RESET`): `business_balance`,
        `initial_capital` (both reset to `0`, not null — they're
        always-a-number balances, never "unset"); `weekly_goal`; every
        Cash Flow forecast budget input (`cf_bank_balance`,
        `cf_weekly_revenue`, `cf_truck_payment`, `cf_fuel_weekly`,
        `cf_insurance_monthly` — deprecated (docs/PENDING_SQL.md §39,
        owner decision 2026-08-04), cleared anyway for tidiness —
        `cf_insurance_weekly`, `cf_other_weekly`, `cf_tax_reserve_pct`,
        docs/PENDING_SQL.md §29); `dashboard_layout`;
        `dashboard_sections_collapsed`.
      - KEPT (never touched by the reset, on purpose): `company_name`,
        `owner_name`, `home_state`, `dot_number`, `mc_number`, `locale`,
        `role`, `tos_accepted_at`/`tos_version`,
        `onboarding_completed_at`. `entity_type`/`filing_status`/every
        other tax-profile field lives on `tax_config`, a table this
        function has never touched (see its own file-header comment) —
        nothing to keep-or-clear there, it's simply out of scope by
        table, same as it always was.
      `onboarding_completed_at` moved from CLEARED to KEPT this pass —
      before 2026-07-30 it was deliberately nulled so the onboarding
      wizard could be re-tested without a fresh account; it's now treated
      as an identity/prefs field like the rest of that list, so Reset All
      Data no longer forces the wizard to run again. Any FUTURE new
      `profiles` column must be explicitly sorted into one of these two
      buckets before shipping — there is no default; an unlisted column
      is silently KEPT (an `.update()` with an explicit field list never
      touches columns it doesn't name), which is exactly how
      `dashboard_layout`/`dashboard_sections_collapsed` were missed and
      kept reappearing after a reset until this pass added them. The
      client mirror (`app/src/data/queryInvalidation.ts`'s
      `invalidateFinancialData()`) must invalidate every react-query key
      that reads a CLEARED field — `'profile'` (the full-row
      `useProfile()` fetch, distinct from AuthContext's own narrower one)
      and `'dashboard-layout'` are both required there for the same
      reason: a correct server-side reset with a stale client cache still
      *looks* like the bug to the user.
  25. PER DIEM INTELLIGENCE + ASSET PURCHASE & FINANCING (owner decision
      2026-07-30, PRODUCT DECISION, mega-pass parts B/C): per diem is no
      longer a flat 7 days × distinct settlement weeks — every settlement
      carries its own `per_diem_days` (0-7, `docs/PENDING_SQL.md` §35),
      smart-defaulted at import/save time from miles
      (`app/src/tax/perDiem.ts` `defaultPerDiemDaysForMiles()`: 0 miles ->
      0 days "home week," else 7) and freely editable on both the import
      preview and the settlement detail screen afterward.
      `calcPerDiemDays()` SUMS whatever's stored per settlement — it never
      re-derives from miles itself, so a user's edit always sticks — and
      dedupes a repeated `week_ending` (a multi-truck fleet settling every
      truck the same week) by taking the MIN value among the duplicates,
      never summing them (the same calendar week can't count as
      away-from-home twice). Every asset (truck, trailer, or unlimited
      "other equipment" via the new `equipment` table, docs/PENDING_SQL.md
      §36) carries its own `purchase_price`/`purchase_date`/`financing`
      (`'cash'|'loan'`) — a trailer's financing is independent of its
      tractor's even though both live in the same `trucks` row (mirrors
      the existing `trailer_*` fold-in pattern). A loan links via
      `loan_id`/`trailer_loan_id`/`equipment.loan_id` to the SAME `loans`
      table every other Loan Center entry already uses — payments keep
      flowing through the existing principal/interest logic unchanged,
      this is only the asset-side pointer to "which loan financed this."
      Populated either by uploading a financing document (ai-import
      docType `loan_agreement` — extracts lender/amount/apr/payment/
      frequency/nextDue/assetType/assetName, always creates the Loan
      Center row unconditionally) or by manual entry
      (`app/src/components/AssetFinancingFields.tsx`, shared by the Trucks
      and Equipment screens). Asset linking from an import is
      auto-matched by assetName against unit_number/trailer_unit_number/
      equipment.name (`app/src/import/loanAssetMatch.ts`
      `resolveLoanAssetMatch()`) and — same "less aggressive than truck/
      driver match, never forces a picker" spirit as `driverMatch.ts` —
      the loan is ALWAYS created in Loan Center regardless of whether a
      match is found; linking is a bonus, never a blocking extra step.
      `loan_id`/`trailer_loan_id`/`equipment.loan_id` are `on delete set
      null` (never a plain FK) because Reset All Data and Delete Account
      both delete `loans` before `trucks`/`equipment` in their deletion
      order — a plain FK would make either flow fail outright.
      `"equipment"` was added to both Edge Functions'
      `TABLES_IN_DELETION_ORDER` and to `queryInvalidation.ts`'s
      `AFFECTED_TABLES` in the same pass (see invariant #24 and the data-
      flow audit below) — a new table wired into Reset without also being
      wired into invalidation is exactly the class of bug that audit
      exists to catch.
- DATA-FLOW CONSISTENCY (owner decision 2026-07-30, mega-pass part A):
  `docs/DATA_FLOW.md` maps every mutation (import new/replace, manual
  add/edit/delete per entity, Mark-as-Done, capital tx, budget save,
  Reset, Delete Account) to every screen/stat that must reflect it — the
  reference to check before assuming a screen "just doesn't update."
  That audit found and fixed two concrete gaps: (1) 8 tables Reset All
  Data wipes (`trucks`, `drivers`, `driver_payments`, `household_income`,
  `household_members`, `compliance_items`, `maintenance_intervals`,
  `truck_health_config`) were silently missing from
  `queryInvalidation.ts`'s `AFFECTED_TABLES`, so those screens kept
  showing pre-reset data — `app/src/data/__tests__/queryInvalidation.test.ts`
  now regression-guards this by mirroring `TABLES_IN_DELETION_ORDER`; (2)
  Cash Flow's "Weekly Revenue" forecast input had zero connection to the
  `settlements` table at all (a manually-typed budget number only), so it
  stayed $0 after every import — `trailingWeeklyRevenueAverage()`
  (`app/src/stats/cashFlowForecast.ts`) now fills it from the trailing
  4-week actual settlement gross average, labeled "from your settlements"
  in the UI, whenever the user hasn't entered their own number; a manual
  entry always overrides it, and the SAVED value still persists `null`
  when empty so the average keeps recomputing live from the latest
  imports rather than freezing.
- The UI never shows a raw internal doc-type code (e.g. `'amazon'`) — always
  go through `useDocTypeMeta()`'s human label (e.g. "Store/Amazon Purchase"),
  never the old `DOC_TYPE_META` constant name (renamed — icons are locale-
  independent and live in `DOC_TYPE_ICON`, label/route text is localized).
- All Anthropic API calls happen server-side (Supabase Edge Functions).
  The mobile app never holds the API key.
- The AI extraction prompt in legacy/index.html is battle-tuned. Port it
  verbatim; do not rewrite it.
- Every table has Row Level Security. Every query filters by authenticated user.
- Supabase Storage paths (buckets `documents` and `backups`) always start with
  `{user_id}/` — this is what the storage.objects RLS policies key off of
  (see supabase/migrations/0001_init.sql). Build paths as:
    documents bucket: {user_id}/{month}/Payroll/Week-N/{filename}
                       {user_id}/{month}/Equipment-Deductions/{store}/{filename}
                       {user_id}/{month}/{Category}/{filename}   (fuel, maintenance,
                         tolls, loans, bank/checking statements — see
                         buildDocFolderParts()/orgFolderName() in legacy/index.html
                         for the exact category-folder mapping)
    backups bucket:    {user_id}/backups/{timestamped filename}
  Never write to a bucket path that doesn't start with the current user's
  auth.uid() — the RLS policy will reject it.
- TypeScript strict mode; no `any` in the data layer.
- Dark theme colors (owner decision 2026-07-10, Session 9e-B10, "BOZKA AI"
  design language — SUPERSEDES the earlier rule below): `app/src/theme.ts`'s
  `colors` constant is deeper blacks (`bg:#08080c`, `side:#101015`,
  `card:#16161d`, `card2:#1c1c26`, `border:#26262f`, `text:#f0f0f5`,
  `muted:#8a8a99`) with a blue-600 accent (`accent:#2563eb`, the
  `#2563eb` family). The 4 semantic signal colors (green/red/orange/
  purple) are UNCHANGED. `theme.ts`'s own header comment carries the
  original legacy-CSS-variable values for history; no other file may
  hardcode a color from that old palette going forward — always import
  from `theme.ts`. (Superseded rule, kept for context: dark theme colors
  used to come verbatim from the CSS variables in legacy/index.html.)

## Standing rules moved out of this file (still binding — read before touching the area)

- Chart language (every trend chart uses `app/src/stats/chartHelpers.ts`),
  nav parity (`app/src/navigation/navRegistry.ts` is the only route list),
  runtime visibility (`app/src/lib/buildInfo.ts`):
  `docs/decisions/ui-conventions.md`.
- Feature flags — hide a feature without deleting it via one
  `FEATURE_FLAGS` key (`app/src/config/featureFlags.ts`) gated at the
  single registry/import choke point, never per-screen conditionals; Bank
  Statement + Credit Cards are off (`bankCreditCards: false`), Capital
  Account is never gated: `docs/decisions/ui-conventions.md`.
- Customize Dashboard diagnostics + crash-on-mount fix (retired with
  invariant #17; `ScreenErrorBoundary` stays reusable):
  `docs/decisions/retired.md`.

## Current state (2026-10-31)

- **Code**: `main` after batch D2 (owed-to-carrier read from the latest
  statement; simple import flow + certify). Before it: batch E (scanner),
  batch D (profit explainer, estimates-
  only notice + acknowledgment gate), pushed. Ships via `eas update --branch preview`. Plan progress:
  `docs/decisions/master-plan-2026-10.md`.
- **Database** (`docs/PENDING_SQL.md`, 83 sections): everything is applied
  except:
  - §71 usage analytics — NOT applied, on purpose (analytics deferred).
    `pending_71.sql` kept.
  - §72 remove business-balance tracking — status UNCONFIRMED.
    `pending_72.sql` kept; a read-only check query is in §72. The client
    is safe either way.
  - (§2 needed no SQL. §67 was applied — owner confirmed 2026-10-13,
    `pending_67.sql` removed, its SQL inlined in §67. §77 and §78 were
    applied and ai-import redeployed — owner confirmed 2026-10-17, their
    mirror files removed, SQL inlined. §79, §80, §81 applied — owner
    confirmed 2026-10-30, mirror files removed, SQL inlined. §82 and §83
    applied — owner confirmed 2026-10-31, mirror files removed, SQL
    inlined; the batch C ai-import redeploy (milesLines) is not tracked
    here.)
- **Native build**: batch E (document scanner, version 1.1.0) needs
  `eas build --profile preview --platform android`; OTA updates published
  after it only reach 1.1.0 builds. Earlier: the owner's device reported "embedded build (no OTA
  update)" on 2026-08-28. A new native build (`eas build --profile
  preview`) is NOT yet installed. Until it is, OTA-only fixes may not be
  on that device; the build adds the channel/runtime footer and the
  "Check for update now" button.
- **Edge Functions**: deployed state isn't tracked in the repo. When a
  task changes `supabase/functions/*`, its ship list must say so.

## Index of moved files (plain paths, not imports)

- `docs/CHANGELOG.md` — every dated per-task entry, newest first.
- `docs/decisions/accounting-model.md` — two-layer accounting model.
- `docs/decisions/kpi-consistency.md` — `computeKpis()` engine.
- `docs/decisions/null-truck-exclusion.md` — NULL-truck scoping.
- `docs/decisions/multi-truck-model.md` — fleet scope selector, per-truck
  profitability, CPM/PPM.
- `docs/decisions/carrier-scoped-codes.md` — carrier isolation, Prime
  operating statement.
- `docs/decisions/shared-description-rule.md` — description text rule.
- `docs/decisions/accountant-categories.md` — category taxonomy,
  unified classification, 16 accountant categories.
- `docs/decisions/prime-oop-tracker.md` — "For Prime Inc Drivers" screen.
- `docs/decisions/prime-lumper.md` — Prime lumper handling.
- `docs/decisions/prime-statement-source.md` — Prime statement route,
  line table, self-check, source labels, read deposit, audit ledger.
- `docs/decisions/golden-settlement.md` — golden Prime settlement,
  reimbursement offset, per-row fuel guard, import totals checks, real
  Prime operating-statement layout, profit bridge.
- `docs/decisions/cash-flow-forecast.md` — Cash Flow auto-fill,
  forecast, recurring-charge classifier.
- `docs/decisions/balance-removal.md` — business balance removal (§72).
- `docs/decisions/referral-and-credits.md` — referrals, credits, lifetime
  accounts.
- `docs/decisions/usage-limits.md` — AI cost control, usage limits,
  credit packs.
- `docs/decisions/usage-analytics.md` — privacy-safe analytics (§71).
- `docs/decisions/settlement-import-chunking.md` — multi-page extraction,
  resumable page-by-page import jobs.
- `docs/decisions/printed-dates-and-held.md` — printed dates, date gate,
  held by carrier, one deposit per statement.
- `docs/decisions/eas-update-delivery.md` — OTA delivery diagnosis.
- `docs/decisions/document-scanner.md` — on-device document scanner,
  library check, multi-page PDF, privacy/store notes.
- `docs/decisions/estimate-notice.md` — estimates-only banner, exports,
  acknowledgment gate (DRAFT, attorney list).
- `docs/decisions/i18n-languages.md` — language picker, AI language.
- `docs/decisions/ui-conventions.md` — charts, nav registry, build info.
- `docs/decisions/retired.md` — retired features and screens.
- Other references: `docs/PENDING_SQL.md`, `docs/DATA_FLOW.md`,
  `docs/DEPLOY_FUNCTIONS.md`, `docs/I18N_GLOSSARY.md`,
  `docs/CARRIER_CODES.md`, `docs/SCHEMA.sql`, `PROMPTS.md`.
