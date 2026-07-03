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
  baselines from maintenance_records with highest-odometer-wins semantics;
  only overrides live in truck_health_config.overrides
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
```

## Session 5 — Dashboard

```
Implement the Dashboard tab to match legacy pg-dash:

- Stat cards: Net Income YTD, Miles, Per Diem days/amount ($64/day), Weeks
- Business Balance, Revenue/Mile, Cost/Mile, Profit/Mile (green >$0.50)
- Tax row: Est. Total Tax (2026 MFJ brackets — port calcTax verbatim),
  Quarterly Payment with deadline countdown (Apr 15 / Jun 15 / Sep 15 /
  Jan 15 2027; orange ≤30 days, red ≤14)
- Capital Account strip (tap → Capital screen): contributed, draws,
  tax-free remaining, latest contribution note
- Recent loads list + truck card
All figures must reproduce the web app's numbers from the same data — write
unit tests for calcTax, per-diem day counting, and CPM math using fixtures
extracted from legacy logic.
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
```

## Session 8 — Truck Health + Maintenance

```
Port Truck Health and Maintenance:

- All 12 categories with the legacy intervals VERBATIM (oil fixed 50,000mi;
  fuel filter bundled with oil via MAINT_BUNDLE_MAP; DPF by MPG; transmission
  Eaton Fuller synthetic 500k default with conventional option; differential
  synthetic 500k; APU by engine hours 2,000h; chassis 30k; etc). Do not
  change any interval — the owner tuned these.
- Maintenance log list + add form (15+ service types, odometer, hours for
  APU, cost, vendor, invoice)
- applyMaintToHealth / syncHealthFromMaint / rebuildMaintDerivedHealth logic:
  highest-odometer-wins, deleting a record recomputes from remaining records
- Progress bars with the same green/orange/red thresholds
- Push notification scaffolding (expo-notifications): schedule alerts when a
  category drops under 3,000 mi (or 200 APU hours, or 30 days to a tax
  deadline). Local notifications are fine for v1.
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
  4. Truck Health intervals are owner-tuned constants. Do not change them.
  5. Every delete cascades (contributions, document records, derived health).
- All Anthropic API calls happen server-side (Edge Functions). The mobile app
  never holds the API key.
- Every table has RLS. Every query filters by the authenticated user.
- TypeScript strict mode; no `any` in the data layer.
```
