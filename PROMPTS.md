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
```

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

## Session 7 — Deductions + Capital Account

```
Implement Deductions and Capital screens:

- Deductions: two sections exactly like legacy rDed — "Out-of-Pocket (tax
  deductible)" and "Withheld from Settlement (already in net pay, NOT
  re-deducted)". Row tap → edit sheet (category from DED_CATEGORIES incl.
  Software & Subscriptions, payment from the 4 standard methods, amount).
  Editing payment syncs the linked capital contribution (add/update/remove).
  Manual add form for non-PDF items (LLC fees, Anthropic subscription).
- Capital: stat row (total contributed / draws / tax-free remaining),
  breakdown card, unified history list (draws red with delete, contributions
  green with a link icon explaining they're edited via their deduction),
  record-draw action, update-business-balance action.
- Deleting anything cascades exactly like legacy (contribution removal,
  document-record cleanup so re-imports don't false-flag as duplicates).

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

## Session 9 — Remaining screens + polish

```
Port the remaining features from legacy in priority order:
1. Cash Flow (weekly net trend chart — victory-native or react-native-svg,
   best/worst lanes table)
2. Loans + Credit Cards
3. Bank/Checking statement import (reuses ai-import with the statement prompt)
4. Accountant Package export (JSON + a clean PDF summary via expo-print)
5. Settings: profile/business info, view-only mode per device, export JSON
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
