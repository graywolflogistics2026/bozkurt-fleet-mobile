# Claude Code Prompt Playbook — Bozkurt Fleet OS Mobile

How to use: run these prompts **one session at a time, in order**. Don't combine sessions.
After each session: review the diff, run the app/tests, commit, THEN move to the next.
Claude Code understands Turkish too — feel free to ask follow-ups in Turkish mid-session.

---

## Session 0 — Orientation (run once, first)

```
Read legacy/index.html carefully. It is a complete, working single-file fleet
management app for a Prime Inc. owner-operator (Graywolf Logistics LLC, one truck,
Unit 830157). It is the FULL PRODUCT SPEC for the mobile app we are building.

Produce docs/FEATURE_INVENTORY.md listing:
1. Every page/screen and what it shows
2. Every data entity stored in localStorage (DB.*, CAPITAL, LOANS, CARDS,
   BANK_STMTS, CHK_STMTS, gw_health) with all fields and their meaning
3. All business logic rules you find, especially:
   - Net-pay tax model (settlement-withheld deductions are NOT re-deducted)
   - Capital Account: personal payments become owner contributions, id-linked
   - Truck Health maintenance intervals and the highest-odometer-wins sync
   - Per diem ($64/day), CPM/RPM/PPM, quarterly tax deadlines
   - Google Drive folder structure (Month/Payroll/Week-N, Equipment-Deductions/Store)
   - AI import prompt rules (qty × unit price, tax capture, vendor extraction)
4. Anything that looks like a bug or inconsistency

Do NOT write any application code yet. This document is our contract.
```

## Session 1 — Supabase schema

```
Using docs/FEATURE_INVENTORY.md and docs/SCHEMA.sql (a human-reviewed, FINAL
schema — the DECISIONS block at the bottom is owner-approved), create the
initial Supabase migration in supabase/migrations/0001_init.sql.

Requirements:
- Follow the schema exactly; if you find a technical blocker, STOP and explain
  before changing anything
- Every table gets user_id uuid references auth.users, with Row Level Security
  enabled and policies: users can only CRUD their own rows
- created_at/updated_at timestamptz defaults everywhere
- documents.parsed_json stores the full raw AI extraction for every import
- capital_transactions is ONE table (type: contribution|draw) with optional
  linked_deduction_id ON DELETE CASCADE — the DB enforces what the web app
  hand-coded
- Truck health: create a SQL view (or function) computing per-category
  remaining life from maintenance_records baselines (highest-odometer-wins,
  with bundled_with_category cascading, e.g. oil → fuel) joined against each
  truck's maintenance_intervals rows; fall back to truck_health_config
  .overrides only when no maintenance record exists for a category
- Intervals are per-truck and user-editable, NOT constants (owner decision
  2026-07-03): add an AFTER INSERT trigger (or equivalent app-level call) on
  `trucks` that seeds one maintenance_intervals row per category from the
  legacy defaults in docs/SCHEMA.sql's comment block (oil 50,000 mi; fuel
  bundled with oil; DPF mpg-tiered off the truck's fleet_mpg at creation
  time; trans 500k synthetic/250k conventional; diff 500k synthetic/100k
  conventional; air filter 100k; air dryer 250k; chassis 30k; APU 2,000
  engine hrs; coolant extender 300k / full replace 600k; DEF filter 300k)
- Create private Storage buckets: `documents` (organized archive) and
  `backups` (JSON snapshots) with owner-only access policies
- Include helpful indexes: (user_id, date) on every dated table; the
  duplicate-check index on documents
- Write supabase/seed.sql that inserts the Prime Unit 830157 maintenance
  history found in legacy/index.html (PRIME_HISTORY constant) for the dev user

Then generate TypeScript types: supabase gen types output to app/src/types/db.ts
```

## Session 2 — AI import Edge Function (protects the API key)

```
Create supabase/functions/ai-import/index.ts (Deno Edge Function):

- POST accepts: { fileBase64, mediaType, docHint? } with a Supabase JWT
- Rejects unauthenticated calls; per-user rate limit of 30 imports/day
  (count rows in documents table for today)
- Calls Anthropic API (key from environment secret ANTHROPIC_API_KEY, never
  exposed to client) using claude-sonnet-4-6
- The extraction prompt: port it VERBATIM from legacy/index.html — it encodes
  months of tuning (docTypes, settlement deduction category enum with
  "Software & Subscriptions" ELD tagging, qty×unit-price self-check rule,
  vendor-name extraction rules, Zelle/Venmo personal-payment detection,
  OTR sleeper-cab 100% deductible rule). Do not "improve" it.
- ONE approved addition to the prompt (decision D1): fuel purchases must also
  extract the US state (2-letter code) from the station address/receipt —
  feeds fuel_purchases.state for future IFTA reporting.
- Returns parsed JSON; on model refusal/parse failure returns a structured
  error the app can show
- Add a second function ai-advisor/index.ts that proxies the AI Advisor chat
  with conversation history in the request body

Include a local test script with a sample base64 PDF.
```

## Session 3 — Expo app scaffold + auth

```
Scaffold the Expo app in app/ :

- Expo SDK (latest stable), TypeScript, expo-router for navigation
- Supabase JS client with secure token storage (expo-secure-store)
- Screens: (auth) sign-in/sign-up with email; (tabs) Dashboard, Import,
  Deductions, Truck Health, More
- Dark theme matching the legacy app: background #0b0f1a-ish cards, accent
  #4f7cff, green #22c55e, red #ef4444, orange #f59e0b — extract exact CSS
  variables from legacy/index.html into app/src/theme.ts
- More tab is a menu linking to: Capital Account, Cash Flow, Maintenance,
  Loans, Settings
- Empty placeholder screens are fine; navigation + auth must fully work

**Active-truck context (owner decision 2026-07-03 — fleet scalability,
1→100 trucks):** add an app-level active-truck context (selected truck id
in app state, e.g. a context/provider persisted to AsyncStorage) that every
other tab reads from. With exactly 1 truck the picker is hidden entirely and
the single truck is auto-selected — no UI difference from a single-truck
app. With 2+ trucks a truck switcher (unit number) appears in the header.
No screen should hardcode "the truck" — every truck-scoped query goes
through this context so Sessions 5/8 can add fleet-wide views later without
retrofitting this screen (CLAUDE.md invariant: no code path may assume a
single truck).

**Terms of Use acceptance (owner decision 2026-07-04, D12):** first launch
must show a full-scroll Terms of Use screen (content from
docs/TERMS_OF_USE_DRAFT.md once attorney-reviewed) that requires the user to
scroll to the bottom before an "Accept" button enables; this screen blocks
all other navigation — no data entry, no auth-skip, until accepted. On
accept, write `tos_accepted_at = now()` and `tos_version` (a constant bumped
whenever the Terms change) to `profiles`. On every subsequent launch, compare
the shipped `tos_version` against the stored one; if they differ (or either
column is null), re-show the same blocking screen before anything else. This
is a hard gate, not a dismissable banner — CLAUDE.md invariant #8.
```

## Session 4 — Data layer + one-time migration importer

```
Build the data layer in app/src/data/ :

- Typed query/mutation hooks per entity (settlements, deductions, maintenance,
  capital_transactions, fuel, loads, documents) using @tanstack/react-query
  over the Supabase client
- Offline-tolerant reads (react-query persistence to AsyncStorage) — a trucker
  is often out of coverage; writes can require connectivity for now
- Settings screen: "Import legacy backup (JSON)" — accepts the JSON file
  exported by the web app (buildBackupPayload shape in legacy/index.html:
  DB, loans, cards, capitalDraws, capitalContributions, health, bizBalance,
  bankStatements, checkingStatements) and inserts everything into Supabase
  idempotently (safe to run twice — match on natural keys like date+amount)
- After import, run the same consistency rules the web app runs on load:
  tag settlement-date deductions as source='settlement', remove orphaned
  contributions, rebuild maintenance-derived truck health

**Tax year data fetch + cache (owner decision 2026-07-03 — centrally
updatable tax data, D10):** add a query hook for the new, NOT user-scoped
`tax_year_data` table (docs/SCHEMA.sql) — readable by every authenticated
user, written only by an admin via service_role. On launch, fetch the row
for the user's tax_config.tax_year (defaulting to the current calendar
year); persist it to AsyncStorage the same way as the other offline-tolerant
reads above, since a trucker needs the estimator to work out of coverage. If
that year's row is missing or has `published=false`, query for the latest
row where `published=true` instead and set a flag the Dashboard (Session 5)
uses to show its fallback banner. This hook is the ONLY place any screen may
read tax constants from — no component fetches tax_year_data directly, and
nothing computes tax figures from a locally hardcoded bracket/rate (CLAUDE.md
invariant).
```

## Session 5 — Dashboard

```
Implement the Dashboard tab to match legacy pg-dash:

- Stat cards: Net Income YTD, Miles, Per Diem days/amount ($64/day), Weeks
- Business Balance, Revenue/Mile, Cost/Mile, Profit/Mile (green >$0.50) —
  computed for the active truck (from Session 3's truck context)
- Tax row: Est. Total Tax, Quarterly Payment with deadline countdown
  (orange ≤30 days, red ≤14)
- Capital Account strip (tap → Capital screen): contributed, draws (or
  "Distributions" — see entity_type below), tax-free remaining, latest
  contribution note
- Recent loads list + truck card

**Fleet scalability (owner decision 2026-07-03 — 1→100 trucks):** every stat
above must be computable two ways from the same underlying query: scoped to
the active truck, and fleet-wide (all of the user's trucks aggregated). With
exactly 1 truck these are identical and only the single view renders — don't
build a separate "fleet" code path that has to be kept in sync, derive both
from one aggregation function parameterized by truck_id-or-null. With 2+
trucks, add a "Fleet Overview" section: total fleet CPM/RPM/PPM, a per-truck
table ranked by profit/mile, and a flag (e.g. red badge) on the worst
performer. Truck Health alerts also roll up here as a fleet-wide count with
drill-down to the per-truck detail (full detail is Session 8).

**Tax engine (owner decision 2026-07-03 — product-ready, not single-user):**
- Read filing_status/tax_year/state/include_state_tax/entity_type from the
  tax_config table (docs/SCHEMA.sql), not a hardcoded MFJ/TX/sole-prop
  assumption.
- **Centrally-updatable tax data (owner decision 2026-07-03, D10 — replaces
  the earlier "bundled per-year module" design):** every tax constant comes
  from the `tax_year_data` row Session 4's hook fetched/cached — federal
  brackets (`federal_brackets.mfj/single/hoh`), `standard_deduction`,
  `se_tax` (rate/factor — apply the legacy net-profit × .9235 → ×.153 → half
  deductible math VERBATIM, including that legacy uses the same bracket
  table for 'single' and 'hoh'; do not alter the math or "fix" that quirk),
  `per_diem` (daily_rate/deductible_pct), `quarterly_deadlines`, and
  `state_tax`. NONE of these may be hardcoded, inlined, or duplicated into a
  local TypeScript module (CLAUDE.md invariant) — the whole point is an
  admin can correct a figure or roll over to a new year server-side with no
  app release.
- `state_tax` shape (corrected 2026-07-03 against the verified live row —
  see docs/ADMIN_RUNBOOK.md; this replaces an earlier draft of this section
  that wrongly assumed CA, GA, IL, NC, and PA were all progressive-bracket
  states):
  - `no_tax`: states that return 0 — TX, FL, TN, WA, NV, SD, WY, AK, NH.
  - `flat`: a per-state table of BARE rate numbers only (e.g.
    `{"NC":0.0399,"GA":0.0499,"UT":0.0445,"OH":0.0275,"IL":0.0495,"PA":0.0307}`).
    GA, IL, NC, and PA are ALL flat-rate states in reality — none of them
    belong in `bracket`.
  - `bracket`: as of 2026, only **CA** genuinely still uses progressive
    brackets — the official FTB Schedule X (single) / Y (MFJ) / Z (HoH)
    tables. Don't add a state here without re-confirming it's actually
    still progressive that year (states do convert to flat — GA and NC
    both did before this was caught).
  - `flat_adjustments`: a SEPARATE object, keyed by state, for flat-rate
    states whose real law isn't a single bare rate — applied AFTER the
    state's `flat` rate is computed, never folded into `flat` itself (a
    `flat` entry is always a bare number, full stop). Exact live shape:
    `{"OH":{"exempt_below":26050},"MA":{"surtax_rate":0.04,"surtax_over":1000000}}`
    — Ohio taxes $0 on income below the exemption then its flat rate above
    it; Massachusetts adds a surtax on top of its own flat rate for income
    over the threshold. The state-tax module must look up a state's
    `flat_adjustments` entry (if any) and apply it as a second pass over
    the base flat-rate result, not as a replacement for `flat`.
  - `fallback_effective_rate`: for every other state. When a state's
    estimate comes from this fallback, the UI must label it "estimate" so
    it isn't confused with a bracket-accurate figure.
  - Respect include_state_tax: false by just omitting the state line
    (federal estimate is unaffected).
- **Year fallback banner:** if Session 4's hook reports the current
  tax_config.tax_year is missing/unpublished and is using the latest
  published year instead, show a small dismissible-per-session banner, e.g.
  "2027 IRS figures not loaded yet — estimates use 2026 data." Year rollover
  (Jan 1) is automatic: the app just asks for the new calendar year on next
  launch and falls back the same way if that row isn't published yet — no
  code change needed to "turn on" a new year, only a new `tax_year_data` row
  (docs/ADMIN_RUNBOOK.md).
- **Entity type branch (owner decision 2026-07-03):** the estimator must
  branch on tax_config.entity_type:
  - 'sole_prop' and 'smllc' run the IDENTICAL legacy computation (SE tax on
    the full net profit, no payroll concept) — smllc only changes a UI
    label ("Single-Member LLC") and must not introduce a second code path.
  - 'scorp' changes the computation: SE tax (15.3%) applies only to
    scorp_salary; profit above that salary flows through as distributions
    with NO SE tax. Federal (and state) income tax brackets still apply to
    total income (salary + distributions) the same way. Show a prominent,
    non-dismissable-by-accident UI note: "S-Corp status requires a payroll
    provider (for the W-2 salary and 941/940 filings) and CPA guidance —
    this app estimates, it does not file." Reflect
    scorp_payroll_tax_handled as a simple attested checkbox next to that
    note; it doesn't change any number.
  - For sole_prop/smllc users, add an **"S-Corp savings preview" card**:
    given their current YTD net profit and an editable "reasonable salary"
    input, show the SE tax they'd save at that salary under an S-Corp
    election vs. their current SE tax — an educational/upsell card, not a
    filing recommendation. Do not show this card for entity_type='scorp'
    users (they've already made the election).

All figures must reproduce the web app's numbers from the same data — write
unit tests for calcTax (federal + SE tax) against a fixture `tax_year_data`
row, the entity_type branch (sole_prop/smllc parity, scorp
salary-vs-distribution split), the state tax module (one case per state
category: no-tax, flat, bracket, fallback-estimate, PLUS a flat_adjustments
case each for an exemption-floor state like OH and a surtax-above-threshold
state like MA — both must apply on top of the base flat-rate result, not
replace it), the year-fallback
banner (current year missing/unpublished → falls back to latest published),
per-diem day counting, and CPM math using fixtures extracted from legacy
logic.

**BINDING UX DECISION (owner, 2026-07-04) — Dashboard is the hub.** Every
stat card/section built above must be tappable and navigate to its detail
screen, not just display a number:
- Capital Account strip → Capital Account (already specified as tappable
  above — this generalizes it to every other card)
- Tax row cards (Est. Total Tax, Quarterly Payment, Weekly Tax Reserve,
  Effective Rate) → Tax Estimator
- Truck Health summary/alerts → Truck Health tab
- Recent loads list → Cash Flow (or a future Loads detail screen once
  built)
- Business Balance card → the bank/loans area (Cash Flow / Loan Center)
Add a visible chevron (›) affordance on every tappable card so it reads as
navigable, not just informational. This is deliberate: with the Dashboard
as a complete hub, most users should rarely need the More tab (see Session
3's tab bar and Session 9a's More-tab regrouping) — More exists for
completeness, not as the primary way to reach these screens.
```

**DASHBOARD ACCEPTANCE CHECKLIST (owner, 2026-07-09 — binding).** The
first screen after login must match the legacy web dashboard card-for-
card, same order, same empty-state hints. Implemented in
`app/app/(tabs)/index.tsx`:

- [x] 1. Total Revenue — hint "Import PDF to start"
- [x] 2. Total Deductions
- [x] 3. Net to Owner
- [x] 4. Miles Driven
- [x] 5. YTD Per Diem Days — hint "days on road", own card (deterministic
      7×distinct-weeks count, CLAUDE.md invariant #9 — not derived from
      load dates)
- [x] 6. Per Diem Deduction — hint "@$64/day (80% of $80)", rate AND the
      80%/$80 breakdown both sourced from `tax_year_data.per_diem`
      (`daily_rate`/`full_daily_rate`, docs/PENDING_SQL.md §10), own card
- [x] 7. Weeks in Service — hint "settlements imported", own card
- [x] 8. Avg Net/Week — hint "direct deposit avg" (`netRevenue /
      settlementCount`, `FleetStats.avgNetPerWeek` in
      `app/src/data/dashboardStats.ts`) — was missing, added 2026-07-09
- [x] 9. Business Balance — hint "checking account"
- [x] 10. Revenue/Mile — hint "gross ÷ total miles"
- [x] 11. Cost/Mile (CPM) — hint "all costs ÷ total miles"
- [x] 12. Profit/Mile — hint "accept loads above CPM!"
- [x] 13. Est. Total Tax — hint shows the user's actual filing status (not
      a hardcoded "MFJ") + "— SE + Federal"
- [x] 14. Quarterly Payment — countdown to the next deadline
- [x] 15. Weekly Tax Reserve — hint "set aside weekly" (orange)
- [x] 16. Effective Rate — hint "of net profit", plus the existing
      state-tax-estimate warning when applicable
- [x] Capital Account strip (contributed / draws-or-distributions /
      tax-free remaining / latest contribution note)
- [x] S-Corp savings preview card (sole_prop/smllc only) or the S-Corp
      payroll-provider notice (entity_type='scorp')
- [x] Recent Loads list
- [x] Truck card (+ Fleet Overview ranking when 2+ trucks)
- [x] CLAUDE.md invariant #8 disclaimers (`LegalFootnote` under the tax
      row and under the S-Corp preview)

Any future Dashboard change must keep every row above checked — this list
is the acceptance test for the first screen a user sees.

**Implementation note (2026-07-05, superseded 2026-07-07, superseded again
2026-07-09) — per diem day-counting is deterministic: 7 × distinct
settlement weeks.** Legacy's `calcPerDiemDays()` sums (deliveryDate −
pickupDate) per load from `DB.loads`. The Postgres `loads` table
originally only kept a single `load_date` column, not that pickup/delivery
pair, so this file used to approximate per diem as 7 days × settlement
count instead (one settlement = one full week OTR).

**2026-07-07 (owner decision, web app v2026.07.07-H, since reverted):**
briefly reworked to sum AI-extracted load pickup/delivery date ranges per
settlement week, falling back to the 7-day rule only for weeks with no
dated loads. `docs/PENDING_SQL.md` §8 added `pickup_date`/`delivery_date`
to `loads` for this.

**2026-07-09 (owner decision — CORRECTS 2026-07-07): reverted to a
deterministic rule on both platforms.** Deriving per diem from
AI-extracted load dates made the number non-deterministic — re-importing
the exact same settlement PDF could extract slightly different dates run
to run, producing a different per-diem total for identical input, which
is unacceptable for a tax figure. `app/src/tax/perDiem.ts`
`calcPerDiemDays()` now takes only settlement `week_ending` values: 7 ×
the count of DISTINCT weeks (deduped by `week_ending`), full stop — see
CLAUDE.md invariant #9. `loads.pickup_date`/`delivery_date` stay in the
schema and keep being populated by ai-import (possible future use, e.g. an
exact-days opt-in), but the tax engine must never read them again without
an explicit new owner decision.

**Settlement re-import-replace (owner decision 2026-07-09, web
v2026.07.09-A).** Previously, re-importing a settlement PDF for a
`week_ending` that already existed just appended a second copy of that
week's loads/fuel/deductions/reimbursements (the settlement row itself was
already upsert-safe, but nothing else was). Now `app/src/data/
aiImportSave.ts` checks whether the settlement already exists before the
upsert; if so, it deletes that week's previously-imported loads, fuel
purchases, reimbursements, and withheld (`source='settlement'`) deductions
— all scoped by the stable `settlement_id` — before inserting the fresh
mapped rows, and skips re-crediting `business_balance` with that week's
net pay a second time. Maintenance, tolls, and loans are intentionally NOT
part of this replace (out of scope for this pass). See CLAUDE.md invariant
#10. This also fixed a real, previously-unnoticed gap: settlement
`reimbursementItems` were extracted but never written to the
`reimbursements` table at all (legacy/index.html:2516) — they are now,
which is why `reimbursements` needed a `settlement_id` column
(`docs/PENDING_SQL.md` §9) to be part of the replace batch.

## Session 6 — Camera + AI import flow

```
Implement the Import tab — the killer feature:

- Three inputs: take photo (expo-camera), pick from gallery, pick PDF
  (expo-document-picker)
- Client compresses images (expo-image-manipulator, max ~1600px, jpeg 80)
- Sends to the ai-import Edge Function; shows a preview sheet identical in
  spirit to legacy showPrev: line items with qty ("2× ... @$159.99 each"),
  tax, TOTAL, detected payment method with the orange "(→ Capital
  Contribution)" badge for personal payments
- Duplicate check before save (same docType+date+amount, or same filename —
  port checkDuplicateImport)
- On confirm: writes rows exactly like legacy saveImport does (settlement →
  settlement+loads+fuel+deductions tagged source='settlement'; store purchase
  → one deduction per item, qty×unit price, plus Sales tax & fees line;
  personal payment → capital_transactions contribution linked by deduction id)
- Uploads the original file to Supabase Storage under the SAME folder scheme:
  {month}/Payroll/Week-{n}/ or {month}/Equipment-Deductions/{store}/ with
  the descriptive filename scheme from buildDocFileName
- Fire-and-forget JSON snapshot to a backups bucket after each import

**Truck tagging (owner decision 2026-07-03 — fleet scalability):**
settlements, fuel_purchases, and maintenance_records rows created by an
import must be tagged with truck_id. The ai-import prompt already extracts
the unit number (Session 2); match it against the user's trucks.unit_number
rows. If exactly one match, tag it automatically and silently. If zero or
more than one match (typo, new unit not yet added, ambiguous OCR), surface a
truck picker in the preview sheet before save — never guess and never leave
truck_id null when the user has more than one truck. With exactly 1 truck on
the account, skip the picker entirely and tag it automatically (same n=1
shortcut as Session 3's context).
```

## Parity Checklist (owner, 2026-07-09 — binding scope commitment)

**The mobile app must reach FULL parity with the legacy web sidebar —
every one of its 22 sections present AND functional, not just a
placeholder route.** This table is the authoritative map of section →
session; keep it in sync as sessions land. Sidebar grouping/order (the
`Overview / Revenue / Expenses / Business / Intelligence / Tools / System`
headers, and the exact item order within each) must reproduce legacy's
sidebar exactly on wide screens (Session 9a/9b's sidebar note below) —
Overview: Dashboard; Revenue: Loads, Settlements, Reimbursements;
Expenses: Fuel, Maintenance, Tolls & Fees, Deductions; Business: Assets,
Capital Account, Operating P&L; Intelligence: Truck Health, Cash Flow,
Scorecard, Loan Center, Credit Cards, Bank Statement; Tools: Asset
Register, Accountant Pkg, AI Advisor, Tax Estimator; System: Settings.
**Nothing ships to the store (Session 10) with an unimplemented sidebar
item** — see Session 10's pre-launch checklist.

| # | Section | Group | Session | Status |
|---|---------|-------|---------|--------|
| 1 | Dashboard | Overview | 5 | ✅ done (Dashboard acceptance checklist above) |
| 2 | Loads | Revenue | 9a | ⬜ not started (own screen — currently only a "Recent Loads" slice on Dashboard) |
| 3 | Settlements | Revenue | 9a | ⬜ not started |
| 4 | Reimbursements | Revenue | 9a | ⬜ not started |
| 5 | Fuel | Expenses | 9a | ⬜ not started |
| 6 | Maintenance | Expenses | 8 | 🚧 placeholder route exists, not implemented |
| 7 | Tolls & Fees | Expenses | 9a | ⬜ not started |
| 8 | Deductions | Expenses | 7 | ✅ done (list view Session 6/7, edit+delete with contribution sync Session 7) |
| 9 | Assets | Business | 9a | ⬜ not started |
| 10 | Capital Account | Business | 7 | ✅ done (stat row, record draw/distribution, update balance, history with source-deduction links) |
| 11 | Operating P&L | Business | 9a | ⬜ not started |
| 12 | Truck Health | Intelligence | 8 | 🚧 placeholder route exists, not implemented |
| 13 | Cash Flow | Intelligence | 9a | 🚧 placeholder route exists, not implemented |
| 14 | Scorecard | Intelligence | 9b | ⬜ not started |
| 15 | Loan Center | Intelligence | 9a | 🚧 placeholder route exists (`more/loans.tsx`), not implemented |
| 16 | Credit Cards | Intelligence | 9a | ⬜ not started |
| 17 | Bank Statement | Intelligence | 9a | ⬜ not started |
| 18 | Asset Register | Tools | 9b | ⬜ not started |
| 19 | Accountant Pkg | Tools | 9b | ⬜ not started |
| 20 | AI Advisor | Tools | 9b | ⬜ not started |
| 21 | Tax Estimator | Tools | 9b | 🚧 placeholder route exists, not implemented (data layer/calc engine already built and used by Dashboard) |
| 22 | Settings | System | 9b | ✅ mostly done (profile/sign-out); Legal sub-section still Session 10 |

Session 9's original single write-up is split below into **9a (money
screens)** — Revenue/Expenses/Business items plus the money-ledger
Intelligence items (Cash Flow, Loan Center, Credit Cards, Bank Statement)
— and **9b (intelligence + tools + settings)** — Scorecard (analytics, not
a ledger), the Tools group, and Settings.

## Session 7 — Deductions + Capital Account

```
Implement Deductions and Capital screens:

- Deductions: two sections exactly like legacy rDed — "Out-of-Pocket (tax
  deductible)" and "Withheld from Settlement (already in net pay, NOT
  re-deducted)". Row tap → edit sheet (category from DED_CATEGORIES incl.
  Software & Subscriptions, payment from the 9 standard methods — see
  CLAUDE.md invariant #2 — amount). Editing payment syncs the linked
  capital contribution (add/update/remove). Manual add form for non-PDF
  items (LLC fees, Anthropic subscription).
- Capital: stat row (total contributed / draws / tax-free remaining),
  breakdown card, unified history list (draws red with delete, contributions
  green with a link icon explaining they're edited via their deduction),
  record-draw action, update-business-balance action.
- Deleting anything cascades exactly like legacy (contribution removal,
  document-record cleanup so re-imports don't false-flag as duplicates).

**Implementation note (2026-07-09) — edit/delete + Capital Account
screen done; manual add form still open.** Deductions edit (category/
payment/amount via a pill-based sheet, `app/app/(tabs)/deductions.tsx`)
and delete (cascades the linked contribution via the DB's `ON DELETE
CASCADE`, plus `cleanupOrphanedDocument()` for the stale-document-record
case) are implemented, along with the Capital Account screen (stat row,
record draw/distribution, update business balance, unified history with
contributions linking back to Deductions). The confirmation-dialog rule
from the 2026-07-07 payment-method sync applies here too: editing a
deduction to a personal payment method only creates a NEW linked
contribution after `confirmOwnerContribution()` — updating or removing an
already-linked contribution (e.g. correcting the amount, or correcting the
payment method back to a business one) is unconditional, same as legacy
(`app/src/stats/contributionSync.ts` `planContributionSync()`, ported from
`syncContributionForDeduction()`). **Not done this pass:** the manual
"add a deduction" form (LLC fees, subscriptions not tied to any PDF) —
still open for a future pass.

**Entity-type branch (owner decision 2026-07-03):** read tax_config
.entity_type. For 'sole_prop'/'smllc' this screen is unchanged from legacy.
For 'scorp': relabel "Draws" as "Distributions" throughout (stat row,
history list, the record-draw action's button/sheet copy) and track stock
basis using the same underlying capital_transactions math (basis increases
with contributions, decreases with distributions — same arithmetic as
today's "tax-free remaining," just relabeled for an S-Corp's actual
terminology). No new table needed; this is a presentation branch on top of
the existing capital_transactions data.
```

## Session 8 — Truck Health + Maintenance

```
Port Truck Health and Maintenance:

- All 12 categories, reading their interval_miles/interval_hours/tracking_mode
  from each truck's maintenance_intervals rows — NOT hardcoded constants
  (owner decision 2026-07-03). A freshly created truck must show the exact
  legacy values as its starting point (oil fixed 50,000mi; fuel filter
  bundled with oil via bundled_with_category; DPF by MPG at creation time;
  transmission synthetic 500k default with conventional option; differential
  synthetic 500k; APU by engine hours 2,000h; chassis 30k; etc) because
  Session 1's trigger seeded them — but every value must be editable per
  truck from here on, and a disabled (`enabled=false`) category must not
  render on the Truck Health screen at all.
- **New: "Edit Intervals" settings sheet** on the Truck Health screen (one
  entry point, e.g. a gear icon in the header) — a row per category showing
  its label, tracking_mode, current interval (miles or hours), and an
  enable/disable toggle. Editing a row's interval writes straight to
  maintenance_intervals and the Truck Health tiles must re-render
  immediately from the new value. No app-level defaults or fallbacks beyond
  what's already seeded — if a row is missing, that's a seeding bug, not
  something to silently patch over with a constant.
- Maintenance log list + add form (15+ service types, odometer, hours for
  APU, cost, vendor, invoice)
- applyMaintToHealth / syncHealthFromMaint / rebuildMaintDerivedHealth logic:
  highest-odometer-wins, deleting a record recomputes from remaining records
- Progress bars with the same green/orange/red thresholds
- Push notification scaffolding (expo-notifications): schedule alerts when a
  category drops under 3,000 mi (or 200 APU hours, or 30 days to a tax
  deadline). Local notifications are fine for v1.

**Per-truck notifications (owner decision 2026-07-03 — fleet scalability):**
every health alert is scheduled and labeled per truck — include the unit
number in the notification title/body (e.g. "Unit 830157: Oil change due in
2,400 mi"), never a bare category name, so a multi-truck owner can tell
which truck needs attention without opening the app. This applies even with
1 truck (label it too, for consistency) — no separate single-truck
notification format to maintain.
```

## Session 9a — Money screens (Parity Checklist #2–5, 7, 9, 11, 13, 15–17)

```
Port the money/ledger screens from legacy in priority order (everything
that's a straight ledger/statement view over already-imported data —
Maintenance is Session 8, Deductions/Capital Account are Session 7):
1. Loads, Settlements, Reimbursements (Revenue group) — each its own
   screen; Loads/Settlements graduate from the Dashboard's "Recent Loads"
   slice into full history + detail.
2. Fuel, Tolls & Fees (Expenses group)
3. Assets, Operating P&L (Business group — a real P&L statement, not just
   the Dashboard's derived stat cards)
4. Cash Flow (weekly net trend chart — victory-native or react-native-svg,
   best/worst lanes table) — replaces the current placeholder
5. Loan Center + Credit Cards — replaces the current Loans placeholder
6. Bank/Checking statement import (reuses ai-import with the statement prompt)
```

**DESIGN NOTE (owner decision 2026-07-04, not implemented until this
session): responsive layout — phone bottom tabs, wide-screen sidebar.**
The (tabs) bottom bar (Session 3) is right for phones but wrong for tablet
landscape and web/desktop, where legacy/index.html uses a persistent
200px-wide left `#sidebar` (legacy/index.html:14,113-148). At a breakpoint
(e.g. `useWindowDimensions().width >= 768`, matching legacy's `#sidebar`
being a fixed-width flex sibling of `#main` rather than a bottom bar),
switch from the Tabs navigator to a left sidebar nav — keep the exact same
section grouping, order, and icon-to-item mapping as legacy's sidebar so
users who know the web app aren't relearning navigation:
- **Overview** — Dashboard (grid/four-squares icon)
- **Revenue** — Loads (truck/trailer icon), Settlements (file icon),
  Reimbursements (vertical-line/zigzag icon)
- **Expenses** — Fuel (fuel pump icon), Maintenance (wrench icon),
  Tolls & Fees (circle/line icon), Deductions (circle/line icon — legacy
  reuses the tolls icon here verbatim, not a typo)
- **Business** — Assets (building/shelves icon), Capital Account
  (circle/dollar icon), Operating P&L (bar-chart icon)
- **Intelligence** — Truck Health (heartbeat/zigzag icon), Cash Flow
  (vertical-line/zigzag icon — same icon as Reimbursements, verbatim),
  Scorecard (circle icon), Loan Center (card icon), Credit Cards (card
  icon — same as Loan Center, verbatim), Bank Statement (file-with-lines
  icon)
- **Tools** — Asset Register (building/shelves icon — same as Assets,
  verbatim), Accountant Pkg (file icon — same as Settlements, verbatim),
  AI Advisor (circle/chat-bubble icon), Tax Estimator (file icon)
- **System** — Settings (gear icon)

Port each icon from its inline SVG in legacy/index.html (react-native-svg
`<Path>` equivalents of the same `d`/shape attributes — don't redraw from
scratch) rather than substituting a different icon set, so the visual
vocabulary matches the legacy app exactly. The sidebar's own logo header
("🐺 Bozkurt Fleet OS / Graywolf Logistics LLC"), user footer (initials
avatar + name + company), and version string
(legacy/index.html:114,146-147) should appear at the top/bottom of the
wide-screen sidebar too. On phones, nothing changes from Session 3 — this
is purely an additional wide-screen presentation of the same route tree,
not a second set of screens to keep in sync (same invariant spirit as the
active-truck n=1 rule: one navigation data source, two presentations). The
phone tab bar's raised center Import button (below) is a phone-only
affordance — the sidebar has no equivalent raised button; Import just
appears as a normal Revenue-adjacent item in its ordered position (there
isn't one in legacy's own grouping above, since legacy has no separate
Import page — add it under **Revenue**, first item, since importing a
settlement/receipt is the highest-frequency action per the Session 3/5
decisions below).

**BINDING UX DECISIONS (owner, 2026-07-04) — carried over from Session 3
(tab bar, implemented) and Session 5 (Dashboard-as-hub), regrouping the
More tab as part of this session's polish pass:**
1. Tab bar: Dashboard · Deductions · **[+ Import]** (raised circular center
   button — importing receipts/documents is the most frequent action) ·
   Truck Health · More.
2. Dashboard is the hub: every stat card/section is tappable (chevron
   affordance) and navigates to its detail screen. Most users should
   rarely need the More tab.
3. More tab: replace the flat menu list from Session 3 with grouped,
   icon-labeled sections:
   - **Money** — Capital Account, Cash Flow, Loans
   - **Truck** — Maintenance
   - **System** — Settings, Legal (Terms of Use + Privacy Policy, Session
     10's Settings > Legal)
```

## Session 9b — Intelligence + Tools + Settings (Parity Checklist #14, 18–22)

```
Port the remaining Intelligence/Tools/System screens (the sidebar grouping
and wide-screen design note above cover this session too — same nav, no
separate design pass):
1. Scorecard — legacy's business-health/KPI score card (Intelligence group;
   the only Intelligence item not folded into Session 9a's money screens
   because it's an analytics rollup, not a ledger view)
2. Asset Register (Tools)
3. Accountant Package export — JSON + a clean PDF summary via expo-print
   (Tools)
4. AI Advisor (Tools)
5. Tax Estimator screen — wraps the calc engine Session 5 already built
   (`useTaxEstimate`, `calcTaxEstimate`) in its own dedicated screen; the
   Dashboard's tax row already surfaces the headline numbers, this is the
   full breakdown/detail view (Tools)
6. Settings: profile/business info, view-only mode per device, export JSON
   (System — the Settings screen itself already exists; this is filling in
   the remaining fields)
Then a full audit session: run through docs/FEATURE_INVENTORY.md and produce
PARITY.md marking each legacy feature done/partial/missing.
```

## Session 10 — Store readiness (when you're ready to ship)

```
Prepare for TestFlight/Play internal testing:
- EAS build config for iOS and Android
- App icons + splash from the wolf theme
- Privacy policy page (data stored in Supabase, receipts processed by
  Anthropic API, no data sold) and in-app link
- Crash reporting (sentry-expo)
- Empty-state onboarding: first-launch flow that offers "import legacy
  backup" or "start fresh"

**Settings > Legal (owner decision 2026-07-04, D12):** add a "Legal" section
to Settings showing both documents together — Terms of Use (the same
content shown/accepted at first launch, Session 3, sourced from
docs/TERMS_OF_USE_DRAFT.md once attorney-reviewed) and the Privacy Policy
page from this session — each as its own screen, plus the accepted
`tos_version`/`tos_accepted_at` timestamp for the user's own reference. This
is a read-only re-display, not a re-acceptance flow (re-acceptance only
triggers automatically on version bump, per Session 3).

**Pre-launch checklist:**
- [ ] Re-enable "Confirm email" in Supabase Auth settings (Authentication >
      Providers > Email). It was disabled during Session 3 development
      (2026-07-04) to unblock sign-up/sign-in testing after email
      rate-limiting corrupted a test auth user — this must be back on
      before real users can create accounts, otherwise anyone can sign up
      with an unowned email address.
- [ ] **Full sidebar parity gate (owner, 2026-07-09 — binding, blocks
      store submission):** every row in the Parity Checklist (above
      Session 7) is ✅ done — all 22 legacy sidebar sections present as a
      real, functional screen (not a `PlaceholderScreen`) and reachable
      from the wide-screen sidebar / phone More tab in the exact legacy
      grouping and order. Re-check the table immediately before this
      session starts; do not begin store prep with any row still ⬜/🚧.
```

---

## Standing rules (paste into CLAUDE.md at repo root — Claude Code reads it automatically)

```
- legacy/index.html is the source of truth for business logic. When in doubt,
  match its behavior and cite the function name you ported.
- Never weaken these invariants:
  1. Settlement-withheld deductions are never counted as tax deductions
     (net-pay model).
  2. Personal-payment purchases always create/update an id-linked capital
     contribution; deleting/editing the deduction syncs it.
  3. Store purchases book qty × unit price per item PLUS a tax/fees line so
     the booked total always equals the invoice grand total.
  4. Truck Health intervals are per-truck, user-editable settings, not code
     constants — the legacy values are only the seed defaults copied into
     maintenance_intervals when a truck is created.
  5. Every delete cascades (contributions, document records, derived health).
- All Anthropic API calls happen server-side (Edge Functions). The mobile app
  never holds the API key.
- Every table has RLS. Every query filters by the authenticated user.
- TypeScript strict mode; no `any` in the data layer.
```
