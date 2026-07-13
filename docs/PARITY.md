# PARITY.md — Legacy vs. Mobile Parity Audit

Session 9b, part 9 (final item of the Session 9b scope). This is the
authoritative parity audit promised by PROMPTS.md's "Parity Checklist"
(owner, 2026-07-09, binding scope commitment): **the mobile app must
reach full parity with legacy's 22-section sidebar, every section
present AND functional, not just a placeholder route.**

Audited against `docs/FEATURE_INVENTORY.md` (the legacy contract) as of
2026-07-12, commit `d1324be` (Session 9b part 8, wide-screen sidebar).
Every screen was read in full and checked against its specific legacy
row (§1), the relevant business-logic rules (§3), and the relevant
known legacy bugs (§4) — not just spot-checked.

**Bottom line: 0 of 22 sections are missing.** As of the 2026-07-12
parity-gap closure pass, 15 are at full parity or better and 7 remain
partial, each with a specific, itemized gap below — none of the gaps
are "screen doesn't exist," all are "screen exists, missing one
sub-feature." See "Genuine gaps to prioritize" at the bottom for
what's still open and why.

Legend: ✅ full parity (or better) · 🟡 partial (gap listed) · ❌ missing.
"Parity+" means the mobile app does something legacy didn't or fixes a
documented legacy bug (§4) — noted so it's never mistaken for a gap in
a future audit.

---

## Summary table

| # | Section | Group | Status | Mobile screen |
|---|---------|-------|--------|----------------|
| 1 | Dashboard | Overview | 🟡 | `app/(tabs)/index.tsx` |
| 2 | Loads | Revenue | ✅ | `more/loads.tsx` |
| 3 | Settlements | Revenue | ✅ | `more/settlements.tsx` |
| 4 | Reimbursements | Revenue | ✅ | `more/reimbursements.tsx` |
| 5 | Fuel | Expenses | ✅ | `more/fuel.tsx` |
| 6 | Maintenance | Expenses | ✅ | `more/maintenance.tsx` |
| 7 | Tolls & Fees | Expenses | ✅ | `more/tolls.tsx` |
| 8 | Deductions | Expenses | ✅ | `(tabs)/deductions.tsx` |
| 9 | Assets | Business | 🟡 | `more/trucks.tsx` (mapped, see below) |
| 10 | Capital Account | Business | ✅ | `more/capital-account.tsx` |
| 11 | Operating P&L | Business | ✅ parity+ | `more/operating-pnl.tsx` |
| 12 | Truck Health | Intelligence | ✅ parity+ | `(tabs)/truck-health.tsx` |
| 13 | Cash Flow | Intelligence | 🟡 | `more/cash-flow.tsx` |
| 14 | Scorecard | Intelligence | ✅ | `more/scorecard.tsx` |
| 15 | Loan Center | Intelligence | ✅ parity+ | `more/loans.tsx` |
| 16 | Credit Cards | Intelligence | ✅ | `more/credit-cards.tsx` |
| 17 | Bank Statement | Intelligence | 🟡 | `more/bank-statements.tsx` |
| 18 | Asset Register | Tools | 🟡 | `more/asset-register.tsx` |
| 19 | Accountant Pkg | Tools | 🟡 | `more/accountant-package.tsx` |
| 20 | AI Advisor | Tools | ✅ parity+ | `more/ai-advisor.tsx` |
| 21 | Tax Estimator | Tools | ✅ parity+ | `more/tax-estimator.tsx` |
| 22 | Settings | System | 🟡 | `more/settings.tsx` |
| — | Universal AI Import overlay | n/a | ✅ parity+ | `import/index.tsx` |

This table supersedes PROMPTS.md's Parity Checklist table (lines
439-462), which was last updated before Session 9a and is now stale —
see the note at the end of this file about updating PROMPTS.md.

---

## Overview

### 1. Dashboard — 🟡 partial
Has all 3 legacy stat rows (revenue/deductions/net/miles; per-diem
days/$/weeks-in-service/avg-net-per-week; business balance/RPM/CPM/PPM),
the tax row (estimate/quarterly countdown/weekly reserve/effective
rate), a clickable Capital Account strip, Recent Loads, and a truck
mini-card — plus beyond-legacy additions (S-corp preview, 1099-NEC
reminders, fleet/driver overview, customizable card layout, invariant
#17).
- **Missing**: the Revenue-vs-Expenses trend chart (legacy `rChart()`,
  Chart.js) — no chart library is used on this screen at all.
- **Missing**: the "Last Settlement" breakdown card that legacy shows
  directly on the Dashboard — that detail now only lives on the
  Settlements screen (one tap away, not literally absent from the app).

## Revenue

### 2. Loads — ✅ full parity
Total loads, loaded miles, rev/mile stat row; full load table with
delete. Matches legacy exactly.

### 3. Settlements — ✅ full parity (RESOLVED 2026-07-12)
History table + delete (server-side cascade per invariant #5) match
legacy. Top stat row now shows Gross/Reimbursed/Deductions/Net, matching
legacy's `rSett()` exactly (reimb/ded scoped to settlement-linked rows,
same scoping as the per-settlement detail sheet).

### 4. Reimbursements — ✅ full parity
`tagFor()` ports legacy's exact `/warranty/i` and `/fuel/i` regexes
verbatim. Total, table, add form all present.

## Expenses

### 5. Fuel — ✅ full parity
Tractor and reefer tracked as fully separate ledgers (separate stat
cards, separate lists, `fuel_type` filter), discounts, net cost = gross
− discount. Matches §2.1's `DB.fuel.tr[]`/`.re[]` split.

### 6. Maintenance — ✅ full parity (RESOLVED 2026-07-12)
History table with edit/delete, add form, all 17 legacy service types
(confirmed exact count in `src/truck/categories.ts`). AI Insights card
present (Session 9b addition, beyond legacy). Health sync is an
automatic reactive recompute rather than a manual "Sync to Truck
Health" button — an architectural improvement, not a gap. Now shows
legacy's 3-way stat split (Total repairs / Warranty-covered /
Out-of-pocket) — warranty-covered is read from linked reimbursements
(the `"Warranty — "` description prefix both manual entry and
ai-import's `mapMaintenance()` already write), since
`maintenance_records` has no dedicated warranty-covered column.
- **Correctly not ported**: legacy's Ali-specific "Load Prime Unit
  830157 History (56 records)" bulk-seed button — excluded per
  CLAUDE.md's multi-tenant mandate (new users start with zero data, no
  owner-specific defaults). Not a gap, a deliberate exclusion.

### 7. Tolls & Fees — ✅ full parity (generalized)
Legacy hardcodes exactly two toll networks (EZ-Pass/DriveWyze); mobile
keeps both explicitly and adds a generic third "other" network — a
superset that still shows legacy's same two named stat tiles plus a
total. A reasonable generalization since toll-network names are
regional/carrier-specific, not universal.

### 8. Deductions — ✅ full parity
Two-table split (out-of-pocket / withheld) with explicit net-pay-model
labels (invariant #1); edit modal + manual-add form both use the
canonical+custom category picker (invariant #19); personal-payment →
capital-contribution confirm-and-sync flow (invariant #2) wired on both
add and edit paths, matching `syncContributionForDeduction()`'s
create/update/remove semantics.

## Business

### 9. Assets — 🟡 partial / parity+ (by design)
Legacy's "Assets" (§1 row 9) is a **read-only** tractor-identity card
(unit#/year/make/model/VIN/odometer) — distinct from "Asset Register"
(row 18, the EQUIP-deductions ledger, which the mobile app has built
separately and correctly). No dedicated read-only card exists in the
mobile app; the Wide-Screen Sidebar (Session 9b part 8) maps this
sidebar slot to `more/trucks.tsx` as the closest functional
equivalent — a superset (editable unit#/VIN/year/make/model/engine/
odometer, plus full multi-truck list/retire/reactivate that legacy,
being single-truck-only, has no equivalent of). List rows show
unit#/year-make-model/odometer but not VIN (VIN is visible only inside
edit). This was a documented, deliberate scope decision made during the
sidebar session, not an oversight.

### 10. Capital Account — ✅ full parity
`calcCapitalAccount()` is a cited, verbatim port of legacy `rCapital()`
(clamped-at-0 display matches). Screen has: contributed/draws(or
distributions for S-corp)/tax-free-remaining stat row, business balance
card, Record Draw/Distribution, Update Business Balance, and a unified
chronological history (draws red+deletable, contributions
green+🔗-linked, edit-only-via-the-source-deduction enforced exactly as
legacy intends).
- **Correctly absent, not missing**: legacy's "Clean Up Orphaned
  Contributions" and "Clean Up False Duplicate Warnings" repair
  buttons. Both existed to patch a bug class — contributions surviving
  their deleted parent deduction — that invariant #5's unconditional
  cascade (every delete removes its linked `capital_transactions` row)
  makes structurally impossible here. There is nothing to clean up.

### 11. Operating P&L — ✅ full parity+
`buildProfitLoss()` is a cited verbatim port of `rOper()`'s math
(expenses = ALL deductions including settlement-withheld, same figure
as Dashboard CPM). The file explicitly addresses FEATURE_INVENTORY §4
bug #7 (the ambiguous "two different expense totals" naming problem)
by naming this one `totalExpenses`/`ProfitLossRollup`, distinctly from
the tax engine's out-of-pocket-only figure — exactly the fix bug #7
recommended. Adds an optional "Carrier YTD" reference card
(`documents.parsed_json.settlement.operating`) shown as reference-only,
never silently overriding computed totals — stricter than legacy's
`DB.op.x || computed` override behavior, an intentional improvement.

## Intelligence

### 12. Truck Health — ✅ full parity+
`calcTruckHealth()` is a cited verbatim port of `rHealth()`/
`applyMaintToHealth()`, confirmed highest-odometer/hours-wins baseline
logic, and the 10%-of-interval / flat-200-hour warning thresholds
ported verbatim with citation comments. No owner-specific magic-number
fallbacks (§4 bug #6) exist anywhere — a `no_data` status is used
instead, exactly matching CLAUDE.md invariant #4's documented fix. The
session-added "Mark as Done" quick action (confirm sheet: date/reading/
cost/note) is present. No separate "Recalculate"/"Calculate" buttons —
health recomputes reactively from live `maintenance_records` on every
render, collapsing legacy's two-step manual flow into one always-
current view (parity+, not missing).
- **Minor**: no explicit synthetic-vs-conventional fluid-type dropdown
  for Transmission/Differential — the user enters the raw mileage value
  directly instead, which is a functional superset (any value, not just
  legacy's two presets) but loses the preset-toggle convenience.
- `truck_health_config.overrides` still has no editing UI — an
  already-documented, deliberate deferral (CLAUDE.md invariant #4), not
  a new finding.

### 13. Cash Flow — 🟡 partial
Has the Weekly Net Pay Trend (bar chart, gross vs. net — verbatim port
of `rWeeklyTrend()`) and Load Profitability best/worst-5-by-RPM
(verbatim port of `rLoadProfit()`).
- **Missing**: the manual weekly-budget input form (bank balance,
  weekly revenue, truck payment, fuel, insurance, other, tax-reserve %)
  → 30-day forecast + weekly tax reserve $ is entirely absent.
- **Missing**: bank-balance / 30-day-revenue / net-cash stat tiles.
- **Missing**: the 4-week balance timeline table.

### 14. Scorecard — ✅ full parity
`calcScorecard()` is a verbatim, threshold-exact port of `rScore()`
(revenue/mile, fuel/mile, and net/mile bands, +15 flat, capped at 100,
same grade cutoffs). Screen adds CPM and Fleet MPG beyond legacy —
documented app additions, not gaps.

### 15. Loan Center — ✅ full parity+ (fixes legacy bug #1)
Full add/edit/delete form (name, lender, original amount, balance,
payment, frequency, APR, next due), total balance + estimated monthly
payment (monthly-freq + weekly×4.33 + biweekly×2.17). One unified
`loans` table backs both manual entry AND AI-extracted settlement loan
data (`app/src/import/mapExtraction.ts` maps `s.loans` into the same
`LoanInsert` shape the screen reads) — legacy's `DB.loans` vs. `LOANS`
dead-store split (§4 bug #1) does not exist in the mobile port.

### 16. Credit Cards — ✅ full parity (RESOLVED 2026-07-12)
Balance/limit/APR/due-day fields, full add/edit/delete. Now has an
aggregate portfolio-utilization stat tile, and both the per-card and
aggregate utilization highlight match legacy's exact >30% orange
threshold (previously a different, per-row-only 70% red highlight).

### 17. Bank Statement — 🟡 partial, plus one undocumented behavior change
Two-tab structure (checking/card) via `account_type`, view-only
transaction list, no deduction creation (matches legacy's "never writes
to the deduction ledger" rule).
- **Missing**: the category-breakdown card and the cross-check-vs-
  settlements comparison panel, on both tabs.
- **Behavior change, not decided anywhere**: legacy's checking-
  statement render silently overwrites `gw_bizbal` with the latest
  closing balance every time it's viewed (§2.6). The mobile screen
  never writes to `business_balance` at all — not preserved as
  automatic, and not turned into the explicit-confirm action that §4
  bug #11 suggested as the better alternative either. It was simply
  dropped, with no substitute reconciliation path. Worth an explicit
  decision (see "Genuine gaps to prioritize" below) rather than staying
  an accidental omission.

## Tools

### 18. Asset Register — 🟡 partial
Total/value/warranty stats, add form (name/category/store/payment/
date/cost/business-use%/warranty-years/notes).
- **Missing**: legacy's category-breakdown card (Tools/Comfort/
  Electronics/Supplies/Safety) and the filterable table — the mobile
  list has no filter UI and no per-category totals.
- **Missing**: an edit modal — rows support add + delete but not edit.
- **Business-use% (§4 bug #4)**: correctly NOT silently discarded like
  legacy — it's captured into the row's `tags` field as a visible note
  — but it still doesn't multiply the booked deduction amount (100%
  booked either way, same net financial effect as legacy). This is a
  deliberate, transparent choice (the value is recorded, not lost) —
  worth being explicit that it's a conscious call, not a blind bug port.

### 19. Accountant Package — 🟡 partial (core is solid, fixes legacy bug #3)
Schedule C rollup (deductions + maintenance + fuel + estimated loan
interest, with the reimbursement-vs-income offset), per diem summary,
other income, JSON export, PDF export, and the mandatory disclaimer are
all present. Its asset summary correctly sources from the same EQUIP-
coded-deduction bucket the real Asset Register uses — §4 bug #3 (the
permanently-broken, always-empty `ASSETS2`-backed "Assets by category"
card) is genuinely fixed, not silently re-ported.
- **Missing**: a dedicated "Assets by category" breakdown card (assets
  ARE included in the Schedule C total, just not broken out
  separately).
- **Missing**: a "Loans & Cards summary" card — loan interest is folded
  into the Schedule C total silently; raw loan/card balances aren't
  shown on this screen.

### 20. AI Advisor — ✅ full parity+
Real multi-turn chat, forwards the full running message history,
server-side via the `ai-advisor` Edge Function — never a client-side
API key, unlike legacy's architecture (§3.6's flagged flaw). A genuine
improvement, not just parity.

CEO Mode (`more/ceo-mode.tsx`, a beyond-legacy addition functioning as
legacy's `aiCtx()`-equivalent weekly briefing): weekly revenue/profit,
goal tracking, NEEDS-REVIEW count, maintenance/compliance alert counts,
all composed server-side from the user's own account data only
(invariant #22 compliant).

### 21. Tax Estimator — ✅ full parity+
Full 2026 federal + SE tax calculation, filing status, all 4 entity
types (sole_prop/smllc/multi_member_llc+ownership_pct/scorp+salary+
payroll-handled), household income as a real list (replacing legacy's
single spouse-income field), SEP-IRA/health-insurance inputs, full
quarterly breakdown. No manual "Sync from Data" button exists because
none is needed — the estimate auto-derives from live settlements/
deductions on every render (net-pay model), which is functionally
superior to legacy's manual-click sync.

## System

### 22. Settings — 🟡 partial
Present: business profile (company/DOT#/MC#/home-state/entity-type),
language picker, Legal (ToS/Privacy links), Delete Account
(double-confirm + type-DELETE), Import Legacy Backup link.

**Correctly absent** (legacy architecture superseded, not a gap): API
Key field, Google Drive OAuth connect/disconnect, Auto-Organize local-
download fallback — all replaced by the server-side Edge Function +
Supabase Storage architecture (CLAUDE.md, §3.6's flagged
client-side-API-key flaw).

**Genuinely missing**:
1. No full-data Backup/Export JSON or "Reset Financial Data Only"
   utility (legacy `exportData()`/`clearFinancialData()`) — the
   Accountant Package's export is a Schedule C rollup, not a full raw
   data dump, so there's currently no user-facing way to get a complete
   JSON export of one's own account (Delete Account is the only
   "everything" operation, and it's destructive).
2. No data-stats card (settlement/loads/fuel counts).
3. ~~No View-Only Mode equivalent~~ — **RESOLVED 2026-07-12**: formally
   retired, not a gap. Owner decision (CLAUDE.md invariant #23): legacy's
   device-local `gw_readonly` flag is obsolete under the multi-tenant
   model (every user already has their own RLS-scoped account). Its
   future replacement — an accountant/spouse read-only share link — is
   tracked in PROMPTS.md's Backlog, a new feature, not a resurrection of
   the old toggle.
4. Email/phone/EIN/address fields from legacy's business-info form
   aren't collected anywhere in the mobile app.

---

## Genuine gaps to prioritize

Ranked by how much a real owner-operator would notice/miss them —
none of these block a store submission by themselves, but they're the
honest remainder of the Session 9b Parity Checklist commitment:

1. **Settings: no full-account JSON export.** Every other "get my data
   out" path either goes through Delete Account (destructive) or the
   Accountant Package (a curated Schedule C rollup, not a raw dump).
   Worth adding a plain "Export All My Data" action mirroring legacy's
   `exportData()`, independent of the Accountant Package's tax framing.
2. **Bank Statement: the closing-balance → business-balance
   reconciliation was silently dropped**, not decided. Needs an
   explicit choice: reinstate as automatic (matching legacy), add as an
   explicit confirm action (the fix §4 bug #11 already recommended), or
   formally document "not reconciled, use Update Business Balance
   manually" as the intended behavior.
3. **Cash Flow: the 30-day manual-budget forecast is the single
   biggest missing sub-feature in this audit** — bank balance, weekly
   recurring costs, tax-reserve % → forecast, plus the 4-week timeline.
   Everything else on that screen (trend chart, load profitability) is
   done; this input form/output block is the one substantial hole.
4. ~~Settings: no View-Only Mode equivalent.~~ **RESOLVED 2026-07-12** —
   formally retired (CLAUDE.md invariant #23); accountant/spouse
   read-only share link tracked in PROMPTS.md Backlog as its replacement.
5. **Dashboard: no revenue-vs-expense trend chart.** Every other
   Dashboard tile is done; this is the one visual legacy had that
   mobile doesn't.
6. ~~Smaller items: Settlements' top-row reimb/ded aggregate,
   Maintenance's warranty/out-of-pocket stat split, Credit Cards'
   aggregate utilization tile + 30% threshold match~~ — **RESOLVED
   2026-07-12**. Still open: Asset Register's category-breakdown card +
   filter + edit modal, Accountant Package's assets/loans summary
   cards, Bank Statement's category-breakdown + cross-check panel.

## Deliberately not ported (by design, not oversight)

- Legacy's Ali-specific "Load Prime Unit 830157 History" bulk-seed
  button (Maintenance) — excluded per CLAUDE.md's multi-tenant mandate.
- Client-side Anthropic API key, Google Drive OAuth, browser-download
  auto-organize fallback (Settings, AI Advisor, Import) — superseded by
  server-side Edge Functions + Supabase Storage.
- "Clean Up Orphaned Contributions" / "Clean Up False Duplicate
  Warnings" (Capital Account) — the underlying bug class is
  structurally impossible under invariant #5's unconditional cascade.
- Assets (Business group)'s literal read-only tractor card — mapped to
  the Trucks screen instead, a documented decision from the Session 9b
  wide-screen-sidebar work (part 8).

## Note for PROMPTS.md

PROMPTS.md's own "Parity Checklist" table (lines 439-462) still shows
most sections as "⬜ not started" — it was last updated before Session
9a landed and was never revisited since. This file (`docs/PARITY.md`)
is now the authoritative, current status; PROMPTS.md's table should be
updated to point here rather than be maintained as a second copy.
