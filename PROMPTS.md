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

## Multi-language support (owner decision 2026-07-09, PRODUCT DECISION — binding; Hindi/Ukrainian added same-day addendum)

```
Target languages: English (default), Spanish, Russian, Arabic, Turkish,
Hindi, Ukrainian (7 total). Hindi and Ukrainian are both LTR — no RTL
work needed for either.

Infrastructure landed this session: i18next + react-i18next +
expo-localization, app/src/i18n/{index.ts,config.ts,rtl.ts,localeStorage.ts}
+ locales/{en,es,ru,ar,tr,hi,uk}.json (en.json is the source of truth —
every new key goes there first). Every currently-implemented screen was
migrated off hardcoded strings onto useTranslation()'s t() (or i18n.t()
outside a component, e.g. confirmOwnerContribution.ts). FROM THIS POINT
ON, NO new screen/component may ship with a hardcoded user-facing string
— add the key to all 7 locale files (parity-checked; see the check
script pattern used this session) in the same PR that introduces the
string.

hi.json and uk.json currently ship as UNTRANSLATED COPIES of en.json
(placeholder — English text under the hi/uk locale codes) so the
languages are selectable and structurally complete without blocking on
translation work. Real translation is a dedicated future pass —
**Session 9c — Hindi/Ukrainian localization** (below), not to be done
piecemeal. es/ru/ar/tr were fully translated this session and are NOT
placeholders.

First-launch rule: device OS language wins when it's one of the 7
supported (Arabic → RTL layout, the other 6 LTR), else English. A manual
override in Settings > Language is cached locally AND written to
profiles.locale (docs/PENDING_SQL.md §12), and always wins afterwards, on
every device.

RTL: use marginStart/marginEnd/start/end, never marginLeft/marginRight or
absolute left/right (I18nManager doesn't auto-flip those logical-unaware
properties). I18nManager.forceRTL() only takes effect after a native
reload — switching to/from Arabic shows a "restart required" prompt.

RTL SMOKE-CHECK (binding, every session from Session 8 onward): before
marking a session's UI work done, switch the simulator/device to Arabic
in Settings, restart, and confirm the new screen(s) render with no
clipped/overlapping/mis-mirrored layout. Record any RTL bug found and fix
it in the same session — don't defer to a later cleanup pass.

What does NOT get translated: user data (deduction descriptions, store
names, notes), AI-extracted content, the payment-method/category enum
pill labels (English on purpose — CLAUDE.md invariant #2 regex-matches
their exact text), and legal documents (ToS stays English-only until
attorney review).
```

## Session 9c — Hindi/Ukrainian localization

```
Translate hi.json and uk.json from their current English-copy placeholder
state into real Hindi and Ukrainian, key-for-key against en.json (use the
parity-check script pattern from the multi-language session above to
verify no key is missing/extra afterward).

CRITICAL: Ukrainian and Russian are distinct languages — translate uk.json
independently from scratch (or from en.json), never by copying/adapting
ru.json. Machine-transliterating Russian into Ukrainian produces text a
Ukrainian speaker would immediately recognize as wrong (surzhyk), not a
shortcut worth taking.

Also: spot-check Hindi/Devanagari and Ukrainian/Cyrillic text rendering on
both iOS and Android (font fallback, line-wrapping on the longest strings)
since neither script has been exercised in the app before this pass.
```

## Personalization & onboarding package (owner decision 2026-07-10, PRODUCT DECISION — binding)

```
1. Customizable dashboard — SCHEMA RECORDED THIS PASS (docs/PENDING_SQL.md
   §19, profiles.dashboard_layout jsonb; CLAUDE.md invariant #17), UI
   implementation is Session 9a item 8 above. Every card (16-card parity
   set + Capital strip + any future card) gets drag-to-reorder, show/hide,
   and rename (user override beats the i18n default; clearing it restores
   the default — store the override string, not a translation-key swap).
   "Reset to default" = dashboard_layout = null.

2. Expanded onboarding wizard — SCHEMA RECORDED THIS PASS
   (docs/PENDING_SQL.md §20, profiles.role; CLAUDE.md invariant #18), UI
   implementation stays Session 9b item 7 (rewritten above, supersedes the
   2026-07-09 spec). Company Name → Home State → DOT/MC (optional) → ROLE
   (owner_operator/company_driver_w2/contractor_1099/trainee — the one
   step that changes what renders elsewhere) → Truck info → Trailer info
   → current odometer → maintenance schedule confirm/adjust → opening
   business balance → tax year confirm.

3. Locale-aware formatting — IMPLEMENTED THIS PASS (CLAUDE.md invariant
   #15): dates/currency/numbers follow the selected locale everywhere via
   Intl APIs (app/src/i18n/format.ts — useFormatters() hook + plain
   formatMoney/formatNumber/formatDate/formatDateTime functions). Removed
   4 duplicated screen-local money() helpers hardcoding 'en-US' (Dashboard,
   Deductions, Capital Account, Import preview) and 2 toLocaleString()/
   toLocaleDateString() calls with no explicit locale (Settings' ToS-
   accepted date, Import Legacy's exported-at timestamp) — all now bound
   to i18n.language. USD stays the currency; only its formatting
   localizes. Scope decision: this does NOT retroactively wrap every raw
   stored date string (e.g. a deduction's ded_date, shown as-is) in Intl
   formatting — only call sites that were already doing explicit
   Intl-style formatting. A full per-screen raw-date-string audit is
   future work, not this pass.

4. AI in user's language — GROUNDWORK IMPLEMENTED THIS PASS (CLAUDE.md
   invariant #16): ai-import and ai-advisor Edge Functions accept an
   optional locale in the request body; when it's one of the 6 non-
   English supported locales, the model is instructed to write free-text
   it composes itself (a document's summary, an AI Advisor reply) in that
   language — standard financial terms (e.g. "per diem") may stay English.
   app/src/data/aiImportCall.ts's callAiImport() forwards i18n.language
   now; the import screen's two call sites pass it. ai-advisor has no app
   caller yet (Session 9b "AI Advisor" screen) — it accepts locale as
   groundwork so that screen only has to pass it through, no further
   server-side work needed then.

5. Recorded in CLAUDE.md invariants #15-18 and here. tsc, tests, commit,
   push.
```

## Industry knowledge base (owner decision, researched 2026-07-10, PRODUCT DECISION — binding)

```
1. docs/INDUSTRY_TAXONOMY.md (NEW, IMPLEMENTED THIS PASS) is the single
   source of truth for the trucking document/category universe — change
   it there first, then propagate to the ai-import prompt / category.ts.
   Nothing in it requires a DB migration: deductions.category (and every
   settlement-deduction row's category) is free text, no check constraint.

2. Settlement anatomy classification (IMPLEMENTED THIS PASS): settlement
   revenueItems gain incomeType (linehaul/fuel_surcharge/accessorial/
   reimbursement/bonus/trailer_rent/ifta_refund/other_income); settlement
   deductions (chargebacks) gain chargebackType (fuel_advance/
   insurance_bobtail/insurance_physical_damage/insurance_occ_acc/
   insurance_cargo/insurance_workers_comp/eld_communications/
   plates_permits/escrow_reserve/lease_purchase_payment/trailer_fee/
   cash_advance/loan_payment/drug_consortium/tolls_transponder/
   admin_processing_fee/factoring_fee/dispatch_fee/other_chargeback).
   chargebackType maps to a display category on the saved withheld-
   deduction row (mapSettlement(), category.ts CHARGEBACK_CATEGORY_LABEL)
   — still never re-counted as a tax deduction (net-pay model unchanged).
   incomeType is extraction-only for now (audit-trailed in
   documents.parsed_json) — revenueItems has no dedicated table yet, same
   "extraction now, ledger later" pattern as government_or_misc_income;
   Session 9b's Accountant Package rollup (above) is where it gets a real
   consumer.

3. CANONICAL_CATEGORIES (IMPLEMENTED THIS PASS, app/src/import/
   category.ts, renamed from DED_CATEGORIES): the full 29-category
   Schedule-C-aligned list from docs/INDUSTRY_TAXONOMY.md §B. Old
   categories renamed (Insurance → Insurance—Truck, Licensing & Permits →
   Permits/Licenses & Road Taxes, Legal & Accounting Fees → Professional
   Services, Truck Supplies → Truck Supplies & Equipment, Safety Equipment
   → Safety Gear & Workwear, Factoring Fees → Dispatch & Factoring Fees);
   Lease & Rent / Utilities & Subscriptions (added in the universal-AI-
   capture pass) already matched the canonical name, no rename needed. No
   migration — old saved rows keep their old category string as free text.
   guessCategory() expanded with brand hints (DAT/Truckstop → Software,
   Comdata/EFS → Fuel & DEF, PrePass/EZPass/Drivewyze → Tolls & Scales,
   OOIDA → Association Dues, Gusto/ADP/Paychex → Wages & Payroll Taxes,
   Triumph/RTS → Dispatch & Factoring Fees) checked ahead of the older,
   more generic legacy branches so an unambiguous brand name never gets
   swallowed by a broader regex.

4. ai-import prompt (IMPLEMENTED THIS PASS): compact classification
   section (incomeType/chargebackType enums, brand hints, non-deductible-
   traps flagging as "PERSONAL — REVIEW: ", reimbursement-vs-income rule)
   appended to APPROVED_ADDITIONS_SUFFIX; settlement revenueItems/
   deductions schemas patched to carry the two new fields.

5. Recorded in docs/INDUSTRY_TAXONOMY.md (the source of truth itself) and
   here. Session 9b's Accountant Package item (above) extended with the
   per-category Schedule C rollup + reimbursement-offset consumer — not
   built this pass. tsc, tests, commit, push. ai-import Edge Function MUST
   be redeployed — the extraction prompt changed again.
```

## Universal AI capture (owner decision 2026-07-10, PRODUCT DECISION — binding)

```
1. ai-import is carrier-agnostic (IMPLEMENTED THIS PASS): the settlement
   extraction prompt now explicitly instructs the model not to assume any
   single carrier's layout — extract the generic fields (carrier, week,
   gross, deductions, net, miles, loads, driver/unit) from ANY carrier's
   settlement (supabase/functions/ai-import/index.ts, "carrier-agnostic
   settlement extraction" addition). The schema itself was already generic
   (no carrier-specific field names); this pass added the explicit
   instruction plus the assets/operating/tolls/loans sub-sections being
   optional (leave at defaults when a carrier's settlement lacks them).

2. Six new docTypes added (IMPLEMENTED THIS PASS — schema/prompt/save-
   routing groundwork; see the "Supported document types" table below for
   what's fully wired vs. archive-only):
   - driver_payment → routes to driver_payments (NOT deductions) —
     mapDriverPayment(), app/src/data/aiImportSave.ts. The import preview
     forces a driver pick for this docType even with 0 drivers on file or
     no name extracted (driver_payments.driver_id is NOT NULL, unlike a
     settlement's optional driver — app/app/(tabs)/import/index.tsx).
   - insurance / lease_rent / factoring_statement / utility_subscription →
     share one ExtractedFinancialDoc shape, all route to deductions via
     mapFinancialDocDeduction() with 3 new categories (Lease & Rent,
     Factoring Fees, Utilities & Subscriptions — app/src/import/category.ts
     DED_CATEGORIES).
   - government_or_misc_income → INCOME (detention, layover, FEMA,
     referral bonuses), taxDeductible always false. No dedicated income
     ledger exists yet — archived only (document + parsed_json audit
     trail), no financial row created, same treatment as w2. The import
     preview shows an explicit "no ledger yet, record manually" note
     rather than silently dropping it or mis-booking it as an expense.
     Building a real misc-income table/screen is v1.x backlog, not this
     pass.

3. Confidence & review (IMPLEMENTED THIS PASS): every extraction carries a
   top-level confidence:"high"|"low" flag (Extraction.confidence,
   app/src/import/types.ts). The import preview shows a review banner
   whenever it's "low". docType "other" (unknown-but-clearly-financial
   documents) always sets confidence:"low" and a suggestedCategory — the
   NEEDS REVIEW convention (previously line-item only, e.g. an unreadable
   purchase-item name) now extends to whole documents:
   mapGenericDeduction() prefixes the description "NEEDS REVIEW: " and
   uses suggestedCategory as the deduction category for docType 'other',
   never silently defaulting to a generic bucket without flagging it.

4. Rolling backlog table — see "Supported document types" in the Backlog
   section below. Full per-type coverage (dedicated income ledger for
   government_or_misc_income, richer per-type preview/edit UI, etc.) is a
   POST-LAUNCH v1.x track. NOT a Session 10 blocker — the launch-blocking
   core set (settlements any-carrier, store receipts, fuel, maintenance,
   W-2, bank/card statements, driver payments) was already fully wired
   before this pass or is completed by it.

5. Recorded in CLAUDE.md invariant #14 (new) and here. Every new docType
   obeys every existing invariant unchanged: no separate tax/service rows
   (#3), 9 payment methods + personal-payment confirmation (#2),
   accountant-readable naming, warranty extraction, per-truck/driver
   routing (#7) — this is additive routing breadth, not a parallel set of
   rules. tsc, tests (mapExtraction.test.ts additions), commit, push.
   ai-import Edge Function MUST be redeployed from the Supabase dashboard
   — the extraction prompt changed (new docTypes, confidence flag,
   carrier-agnostic instruction).
```

## Driver compensation types + entity selection (owner decision 2026-07-10, PRODUCT DECISION — binding)

```
1. Drivers gain compensation_type (w2_employee/1099_contractor/team_split/
   trainee) + pay_type/pay_rate (PENDING_SQL.md §15, informational display
   only — the engine reads recorded driver_payments, never pay_rate).

2. NEW driver_payments table (PENDING_SQL.md §16, on delete cascade from
   drivers — unlike every other driver_id, which is on delete set null —
   a payment has no meaning without the driver it paid; settlement_id is
   on delete set null, invariant #5's cascades must not delete what was
   actually paid). app/src/data/driverPayments.ts (entityHooks factory,
   same pattern as trucks.ts/drivers.ts) built this pass; the
   driver-management screen's log/add form is Session 8 item 0b above.

3. Tax treatment — IMPLEMENTED THIS PASS (app/src/tax/driverPayroll.ts):
   sumDeductibleDriverPayroll() reduces net profit by gross_pay +
   employer_taxes uniformly across all four compensation_types (employer_
   taxes defaults 0, only ever populated for w2_employee — this is what
   keeps it one formula, no type branch). calcContractLaborYtd() tracks
   1099_contractor YTD per driver; crossing tax_year_data.nec_1099.
   threshold ($600 fallback until PENDING_SQL.md §17 runs) surfaces a
   Dashboard reminder card (app/app/(tabs)/index.tsx, before the isScorp
   card). W-2 true-cost-of-employee = calcTrueCostOfEmployee(gross_pay,
   employer_taxes); employer_taxes at entry time = calcW2EmployerTaxes()
   × tax_year_data.se_tax.employer_fica (7.65%, PENDING_SQL.md §17) — that
   entry UI is Session 8 item 0b, not this pass. team_split/trainee:
   the import preview (app/app/(tabs)/import/index.tsx
   showsDriverSplitInput) shows a "driver's share of this settlement ($)"
   field whenever the resolved/selected driver has that compensation_type
   — entering an amount creates a driver_payment linked to the new
   settlement (aiImportSave.ts); re-importing that settlement replaces the
   prior payment the same way it replaces loads/fuel/reimbursements/
   deductions (invariant #10 extended to cover this row too). No AI
   extraction of a second driver's name/split was added this pass — the
   owner's own message described "entering/confirming" the split, which
   this manual field satisfies without a speculative new ai-import schema
   field; revisit if settlement PDFs turn out to print a real per-driver
   split the AI could extract directly.

4. Entity selection — SCHEMA + ENGINE BRANCHES IMPLEMENTED THIS PASS,
   SCREEN UI IS SESSION 9b item 8 above. tax_config.entity_type gains a
   4th value, multi_member_llc (PENDING_SQL.md §18 — Postgres has no ALTER
   TYPE for a plain check constraint, so it's a drop+recreate); ownership_
   pct added alongside it. Scope decision: the owner's message said
   "Entity choice stored in profiles (entity_type exists; add
   ownership_pct)" — entity_type already lives on tax_config, not
   profiles (see D7/D8), so ownership_pct was added there instead of
   introducing a second, disconnected entity concept on profiles.
   calcTaxEstimate.ts: multi_member_llc scopes ownerShareOfProfit (and the
   SE-tax base) to ownershipPct of the full LLC profit — netProfit itself
   stays unscoped, so no fleet-wide figure is silently alterable by one
   member's %; s_corp now also estimates the employer-side FICA cost of
   scorp_salary (tax_year_data.se_tax.employer_fica) as a real business
   expense reducing ownerShareOfProfit, unless scorp_payroll_tax_handled
   says a payroll provider already accounts for it (no double-counting).
   sole_prop/smllc are completely unaffected (employerPayrollTax always 0
   for them). The disclaimers/footnotes themselves (K-1 "each member files
   their own", S-Corp "requires a payroll provider") render on the Session
   9b screen, not before — the engine has no UI strings to carry them yet.

5. Recorded in CLAUDE.md invariants #6 (tax constants: employer_fica,
   nec_1099, entity_type's 4th value) and #7 (drivers: compensation_type,
   driver_payments, split-entry) and here. Nothing Ali-specific anywhere
   (per the 2026-07-09 clean-product decision) — no seed data, no
   hardcoded names/rates outside tax_year_data.
```

## Multi-truck fleet + drivers + payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION — binding)

```
1. Trucks: unlimited (2nd, 3rd, ...Nth). Truck management UI (add/edit/
   retire, each add seeding maintenance_intervals) is Session 8, item 0
   above — not this pass.

2. NEW drivers entity (docs/PENDING_SQL.md §13): drivers table (id,
   user_id, name, phone, license, active, default_truck_id, RLS owner-
   scoped). Driver management UI is Session 8, item 0b above. settlements/
   loads/fuel_purchases/withheld-deductions gain driver_id (docs/
   PENDING_SQL.md §14, nullable, on delete set null — never cascade,
   retiring/removing a driver must not delete financial history).

3. Payroll auto-routing — IMPLEMENTED THIS PASS: the ai-import settlement
   schema gains driverName (supabase/functions/ai-import/index.ts,
   SETTLEMENT_SCHEMA_BEFORE/AFTER patch); the truck's unit number was
   already extracted as settlement.unit since the Session 6 fleet-
   scalability work, no schema rename needed there. On import: unit is
   matched against trucks.unit_number (exact, resolveTruckMatch()) and
   driverName against drivers.name (case-insensitive, trimmed,
   resolveDriverMatch(), app/src/import/driverMatch.ts). Match found on
   either → tagged automatically, no picker. No match → the import
   preview (app/app/(tabs)/import/index.tsx) shows a picker of existing
   trucks/drivers PLUS a "+ New Truck"/"+ New Driver" inline-create
   field — creating one persists it normally, so future imports of the
   same unit/name auto-match with no separate alias table needed ("then
   remembers it" = ordinary relational persistence, not a fuzzy-matching
   memory system). All per-truck screens (Truck Health, fleet dashboard
   aggregation) are unaffected — still keyed off truck_id exactly as
   before.

4. Dashboard: existing per-truck Fleet Overview card is unaffected. Per-
   driver breakdown is Session 9a item 7 above — not this pass.

5. Recorded in CLAUDE.md invariant #7 (extended with drivers) and here.
   Nothing Ali-specific anywhere (per the 2026-07-09 clean-product
   decision) — driverMatch.ts/truckMatch.ts/the drivers table are all
   fully generic, no seed data, no hardcoded names.
```

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
0. Truck management screen (NEW, owner decision 2026-07-09 — multi-truck
   fleet + drivers + payroll auto-routing, PRODUCT DECISION): add/edit/
   retire a truck (unit number, VIN, year/make/model, engine, odometer).
   Adding a truck seeds its maintenance_intervals the same way the
   legacy-backup importer's ensureTruck() and the new import-preview
   "+ New Truck" inline-create already do (DB trigger, CLAUDE.md
   invariant #4) — this screen is a third entry point to the same path,
   not a new one. Retiring sets is_active=false (never delete a truck
   with financial history attached).
0b. Driver management screen (same session, same PRODUCT DECISION):
   add/edit a driver (name, phone, license, active flag, default truck),
   uses app/src/data/drivers.ts (already built — see PENDING_SQL.md §13).
   No delete from the UI (drivers can have settlement history); "active"
   toggle is the retire equivalent, same as trucks. Also edit the driver
   compensation fields added 2026-07-10 (PENDING_SQL.md §15): a
   compensation_type picker (w2_employee/1099_contractor/team_split/
   trainee) plus pay_type (per_mile/percent/flat) and pay_rate — both
   informational display only, the tax engine never derives an amount
   from them (app/src/tax/driverPayroll.ts reads actual driver_payments
   rows exclusively). Also lands here: a driver_payments log/add form
   (date, gross_pay, notes, optional settlement link) using
   app/src/data/driverPayments.ts (already built — see PENDING_SQL.md
   §16) — the "true cost of employee" display (calcTrueCostOfEmployee())
   for w2_employee drivers.

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
7. Per-driver dashboard breakdown (NEW, owner decision 2026-07-09 — multi-
   truck fleet + drivers + payroll auto-routing, PRODUCT DECISION): same
   pattern as the existing per-truck Fleet Overview card (gated on 2+
   trucks) — a per-driver revenue/net breakdown, gated on 2+ drivers on
   the account (an account with 0-1 drivers never sees it, same n≤1
   shortcut as everywhere else fleet-scalability applies). Aggregates
   settlements.driver_id the same way Fleet Overview aggregates truck_id
   (fetchFleetStats() pattern, app/src/data/dashboardStats.ts) — no new
   calculation engine, just a driver_id-scoped query variant.
8. Customizable dashboard (NEW, owner decision 2026-07-10 — personalization
   & onboarding package, PRODUCT DECISION, CLAUDE.md invariant #17): every
   Dashboard card (the full parity set above + Capital strip + any future
   card — Revenue, Profit, Fuel, MPG, Maintenance, Taxes, IFTA, Cash Flow,
   ...) gets drag-to-reorder, a show/hide toggle, and a rename field (the
   user's custom label overrides the i18n default; clearing it restores
   the default — store the override string itself, not a translation-key
   swap, so it survives a language change untouched while an un-renamed
   card keeps re-translating normally). Persist to profiles.dashboard_layout
   (docs/PENDING_SQL.md §19 — already added, not yet run). Add a "Reset to
   default" action (sets dashboard_layout back to null). Needs a stable
   per-card id (not the i18n key) for each of the ~20 cards so a saved
   layout survives future relabeling.
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
   (Tools). Include a per-category Schedule C rollup driven by
   docs/INDUSTRY_TAXONOMY.md's CANONICAL_CATEGORIES (owner decision
   2026-07-10, industry knowledge base): sum `deductions` by category, PLUS
   fold in `maintenance_records` (→ Maintenance & Repairs), `fuel_purchases`
   (→ Fuel & DEF), and `loans` (→ Truck/Trailer Payments, interest portion
   only — principal is not deductible, docs/INDUSTRY_TAXONOMY.md §B) into
   the same rollup rather than leaving them in separate tables/screens with
   no unified tax view. Apply the reimbursement-vs-income rule
   (docs/INDUSTRY_TAXONOMY.md §D): a settlement revenueItems line with
   incomeType 'reimbursement' offsets its matching expense category in the
   rollup; incomeType 'ifta_refund' is income, never netted against an
   expense. This is also where settlement revenueItems finally gets a real
   consumer (currently extraction-only/audit-trail-only — see
   docs/INDUSTRY_TAXONOMY.md's Wiring status) — decide then whether that
   still needs its own persisted table or can be recomputed from
   `documents.parsed_json` at export time.
4. AI Advisor (Tools)
5. Tax Estimator screen — wraps the calc engine Session 5 already built
   (`useTaxEstimate`, `calcTaxEstimate`) in its own dedicated screen; the
   Dashboard's tax row already surfaces the headline numbers, this is the
   full breakdown/detail view (Tools)
6. Settings: profile/business info, view-only mode per device, export JSON
   (System — the Settings screen itself already exists; this is filling in
   the remaining fields)
7. EXPANDED first-launch ONBOARDING wizard (owner decision 2026-07-10,
   PRODUCT DECISION — personalization & onboarding package, SUPERSEDES the
   2026-07-09 wizard spec below it was originally paired with; new users
   still start with ZERO data and no owner-specific defaults). After
   sign-up + ToS acceptance, walk the user through, in order:
   1. Company Name
   2. Home State (feeds the state tax module — tax_config.state)
   3. DOT/MC numbers (optional)
   4. ROLE (NEW, profiles.role, docs/PENDING_SQL.md §20, CLAUDE.md
      invariant #18): owner_operator | company_driver_w2 |
      contractor_1099 | trainee. company_driver_w2 hides owner-only
      modules (Schedule C deductions, Capital Account, S-Corp election)
      and centers per-diem/W-2 tracking instead; contractor_1099 (and
      trainee/owner_operator) get the full Schedule C experience. This is
      the one step that changes what the REST of the app renders — every
      screen gated by role must treat role=null identically to
      owner_operator (never a third behavior).
   5. Truck info (unit number, year/make/model, odometer — this insert is
      what fires trg_seed_maintenance_intervals, seeding that truck's
      maintenance_intervals rows per CLAUDE.md invariant #4)
   6. Trailer info (NEW — no dedicated trailers table exists yet; decide
      at implementation time whether this needs one or folds into the
      truck's own row/settings)
   7. Current odometer (may overlap with step 5 — reconcile at
      implementation time rather than asking twice)
   8. Maintenance schedule — accept the seeded defaults or adjust now
      (same per-truck maintenance_intervals editor Session 8 already
      builds, surfaced here as an onboarding step instead of requiring a
      separate trip to Truck Health)
   9. Opening business balance (default 0, i.e. skippable)
   10. Tax year confirm
   Until onboarding completes, every screen shows its normal clean empty
   state (no placeholder Graywolf/Ali data anywhere) rather than blocking
   navigation outright — unchanged from the original spec.
8. Entity selection screen (owner decision 2026-07-10, PRODUCT DECISION —
   Settings > Business Profile, new): a picker for tax_config.entity_type —
   sole_prop / smllc / multi_member_llc / s_corp. The engine branches
   (calcTaxEstimate.ts) already exist (this pass, 2026-07-10) for all four;
   this screen is just the UI to choose one and, for multi_member_llc,
   enter ownership_pct (0-100, tax_config.ownership_pct) with a persistent
   "each member files their own K-1 — this only estimates your share, get
   a CPA" disclaimer (CLAUDE.md invariant #8). smllc reads as disregarded/
   same as sole_prop (label only). s_corp promotes the existing Dashboard
   S-Corp Savings Preview into the full flow: scorp_salary input,
   scorp_payroll_tax_handled checkbox (already on the Dashboard, moves or
   is mirrored here), and a footnote "S-Corp payroll requires a payroll
   provider — verify with your CPA" (CLAUDE.md invariant #6/#8).
Then a full audit session: run through docs/FEATURE_INVENTORY.md and produce
PARITY.md marking each legacy feature done/partial/missing.
```

## Session 10 — Store readiness (when you're ready to ship)

```
Prepare for TestFlight/Play internal testing:
- EAS build config for iOS and Android
- App icons + splash from the wolf theme
- Privacy policy page (data stored in Supabase, receipts processed by
  Anthropic API, no data sold) and in-app link. Per CLAUDE.md invariants
  #12/#13 (owner decision 2026-07-10, PRODUCT DECISION), the policy MUST
  state plainly:
    - "We do not collect or track your location." (no location permission
      requested on either platform, no GPS reading ever taken; verify the
      built app's iOS/Android permission manifest has no location entry as
      part of this session's checklist, not just at code-review time)
    - "Your financial data is yours — we don't access it without your
      permission." (the operator does not view an individual user's
      settlements/deductions/etc. except with that user's explicit consent
      for support, or where legally required; only aggregate, anonymized
      product metrics — user counts, feature usage, import volumes, error
      rates — are collected for operations)
- Crash reporting (sentry-expo) — audit whatever crash-reporting/analytics
  SDK is chosen against invariant #13 before wiring it in: no per-user
  financial data or PII in crash breadcrumbs/error context, aggregate-only
  telemetry.
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
- [ ] **Fresh-account walkthrough (owner, 2026-07-09 — binding, blocks
      store submission):** sign up with a brand-new account (not the dev
      seed account) and verify every screen starts empty with no Graywolf/
      Ali Bozkurt/Unit 830157 remnants anywhere — company name blank until
      set, business balance $0, no truck until onboarding creates one, no
      pre-filled AI Advisor context beyond neutral "the owner-operator"/
      "this fleet" labels.
- [ ] **Full RTL pass (owner, 2026-07-09 — binding, blocks store
      submission):** switch to Arabic in Settings, restart, and walk every
      screen in the app (not just the ones touched this session) checking
      for clipped/overlapping/mis-mirrored layout. Also spot-check Spanish,
      Russian, Turkish, Hindi, and Ukrainian for text overflow/truncation
      on the longest translated strings (German-length problem, but for
      these 5) — requires Session 9c (Hindi/Ukrainian localization) done
      first, otherwise hi/uk are still English-copy placeholders and this
      check is meaningless for them.
- [ ] **Privacy checklist (owner, 2026-07-10 — binding, blocks store
      submission):** confirm the built app requests zero location
      permissions on both iOS and Android (no `NSLocationWhenInUseUsageDescription`
      in the iOS Info.plist, no `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`
      in the Android manifest — CLAUDE.md invariant #12), and that the
      published Privacy Policy states both "we do not collect location"
      and "your financial data is yours — we don't access it without your
      permission" (invariant #13) in plain language, not just in this repo's
      internal docs.
```

## Backlog (parked features — do not start without a separate, explicit owner decision)

```
- Opt-in IFTA mile tracker (noted 2026-07-10, alongside the NO LOCATION
  privacy decision, CLAUDE.md invariant #12): a v2+ feature that would use
  real GPS to auto-log miles-by-state for IFTA reporting. Explicitly OUT OF
  SCOPE today — CLAUDE.md invariant #12 says the app collects zero
  location data. If ever built, it needs its own separate, explicit owner
  decision; must be strictly opt-in (off by default, a dedicated toggle in
  Settings, its own permission-request flow triggered only by that
  toggle — never bundled into an existing permission prompt or enabled
  silently by another feature); and needs its own Privacy Policy update
  before shipping, since the current policy states no location collection
  at all.
```

## Supported document types (rolling status — universal AI capture, owner decision 2026-07-10)

Every business income/expense document must eventually be photo/PDF-
capturable and auto-routed (CLAUDE.md invariant #14). This table is the
single source of truth for what's actually wired vs. still backlog — update
it whenever a docType's routing changes. "Launch core" = blocks Session 10;
everything else is a POST-LAUNCH v1.x track.

| docType | Routes to | Status | Launch core? |
|---|---|---|---|
| settlement | settlements/loads/fuel/deductions/maintenance/reimbursements/tolls/loans (carrier-agnostic) | ✅ wired | Yes |
| fuel | fuel_purchases | ✅ wired | Yes |
| maintenance | maintenance_records (+ reimbursement for warranty credit) | ✅ wired | Yes |
| amazon / store | deductions (line-item, proportional tax/fee fold-in) | ✅ wired | Yes |
| toll | deductions (generic fallback) | ✅ wired | Yes |
| loan | deductions (generic fallback) | ✅ wired | Yes |
| w2 | archive-only (no row — income, no household_income screen yet) | ✅ wired (archive) | Yes |
| driver_payment | driver_payments | ✅ wired (this pass) | Yes |
| insurance | deductions (category: Insurance) | ✅ wired (this pass) | No |
| lease_rent | deductions (category: Lease & Rent) | ✅ wired (this pass) | No |
| factoring_statement | deductions (category: Factoring Fees) | ✅ wired (this pass) | No |
| utility_subscription | deductions (category: Utilities & Subscriptions) | ✅ wired (this pass) | No |
| government_or_misc_income | archive-only (no row — INCOME, no ledger yet) | 🚧 archive-only, needs a real income table/screen (v1.x) | No |
| other (unknown financial doc) | deductions, "NEEDS REVIEW: " prefix, AI suggestedCategory, always confidence:"low" | ✅ wired (this pass) | Yes (fallback safety net) |
| bank/card statements | bank_statements/bank_transactions | ✅ wired (Session 4 legacy importer; live AI-import path not yet built) | Yes |

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
