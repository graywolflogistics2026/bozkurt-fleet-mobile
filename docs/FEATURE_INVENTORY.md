# Feature Inventory — `legacy/index.html` ("Bozkurt Fleet OS")

This is the contract for the mobile rebuild. Everything below was read directly out of
`legacy/index.html` (single-file HTML/CSS/JS app, no build step, `localStorage`-backed).
Where a rule matters for correctness, the source function name is cited so it can be
ported (not reinvented) per `CLAUDE.md`.

The app belongs to **Ali Bozkurt / Graywolf Logistics LLC**, a single owner-operator
leased to **Prime Inc.**, one truck: **Unit 830157**, 2023 International LT (A26 12.4L
engine), VIN `3HSDZTZR4PN135369`, with a TriPac Evolution APU.

---

## 1. Pages / Screens

Navigation is a flat sidebar (`go(id, el)`), one `<div class="pg">` per page, each with a
render function called on tab switch (the `renders` map in `go()`). No sub-routing.

| # | Screen (nav id) | Render fn | What it shows |
|---|---|---|---|
| 1 | **Dashboard** (`dash`) | `rDash()` | 4 rows of stat tiles: Revenue/Deductions/Net/Miles; Per-diem days & $, Weeks in service, Avg net/week; Business balance, RPM, CPM, PPM; Est. total tax, quarterly payment + countdown, weekly tax reserve, effective rate; a clickable **Capital Account strip** (`goCapital()`); Revenue-vs-Expenses line chart (`rChart()`, Chart.js); "Last Settlement" breakdown card; "Recent Loads" (last 4, reversed); "Truck" mini-card (unit/odo). |
| 2 | **Loads** (`loads`) | `rLoads()` | Total loads, loaded miles, rev/mile; full load log table (order, date, shipper, from→to, miles, revenue, delete). |
| 3 | **Settlements** (`sett`) | `rSett()` | Gross/Reimbursed/Deductions/Net stat row; settlement history table (date, week, gross, reimb, ded, net, miles, delete — `deleteSett()` cascades, see §3.8). |
| 4 | **Reimbursements** (`reimb`) | `rReimb()` | Total reimbursed, warranty-tagged (regex `/warranty/i` on desc), fuel-tagged (regex `/fuel/i`); flat table. |
| 5 | **Fuel** (`fuel`) | `rFuel()` | Tractor fuel $, reefer fuel $, discounts, net cost; two side-by-side tables (tractor/reefer) — date, location, gallons, amount, discount, delete. |
| 6 | **Maintenance** (`maint`) | `rMaint()` | Total repairs, warranty-covered, out-of-pocket; full repair history table sorted newest-first; **"Load Prime Unit 830157 History"** button seeds 56 curated historical records (`loadPrimeHistory()`, see §2.9 — button label says "(53)", stale, see §4); **"Re-check Categorization"** (`reclassifyMaint()`); **"Sync to Truck Health"** (`syncHealthFromMaint()`); **"Import Invoice PDF"**; manual add-record form (date, odometer, hours [APU], 17 service-type dropdown, shop, invoice #, total, warranty-covered $, description) → `saveMaint()`. |
| 7 | **Tolls & Fees** (`tolls`) | `rTolls()` | EZ-Pass / DriveWyze / total; two simple list panels. |
| 8 | **Deductions** (`ded`) | `rDed()` | Tax-deductible (out-of-pocket) total, withheld-from-settlement total, combined total; **two separate tables**: "Out-of-Pocket — tax deductible" and "Withheld from Settlement — already reflected in net pay, NOT re-deducted" (core net-pay-model UI, §3.1); click category/payment cell → edit modal (`editDedItem()`/`saveDedItem()`); manual-add form (desc, category [10 options], payment method [4 options], date, amount) → `saveManualDed()`. |
| 9 | **Assets** (`assets`) | `rAssets()` | Read-only tractor card: unit #, year/make/model, VIN, odometer — sourced from `DB.assets.tr` (populated only by AI settlement extraction, no manual edit UI). |
| 10 | **Capital Account** (`capital`) | `rCapital()` | Total contribution base, YTD draws, tax-free remaining; breakdown card (initial $60K + additional contributions − draws = remaining); **"Record Owner's Draw"**, **"Update Business Balance"**, **"Clean Up Orphaned Contributions"**, **"Clean Up False Duplicate Warnings"** buttons; unified chronological history list of draws (red, deletable) and contributions (green, 🔗 linked-to-deduction, edit only via the deduction). |
| 11 | **Operating P&L** (`oper`) | `rOper()` | Revenue / Expenses / Net Income; revenue detail by settlement revenue-line description; expense detail grouped by deduction category/code (includes settlement-withheld — this is a *different* "expenses" figure than the tax estimator, see §4). |
| 12 | **Truck Health** (`health`) | `rHealth(h)` / `calcHealth()` | 12 interval tiles (Oil, Fuel Filter, DPF, DEF Filter, Coolant Extender, Coolant Replace, Transmission, Differential, Engine Air Filter, Air Dryer Cartridge, Chassis Lube, APU) each showing miles/hours remaining, color-coded, "OVERDUE"/"Due Soon"/"OK" badge; full schedule table; a large manual-setup form (current odometer, fleet MPG, "last serviced at X mi" per category, trans/diff fluid type dropdowns, APU hour meter + last-service hours, reference coolant date); **"Recalculate from Maintenance Log"** (`syncHealthFromMaint()`); **"Calculate"** (`calcHealth()`). See §3.3 for interval math. |
| 13 | **Cash Flow** (`cashflow`) | `calcCF()`, `rWeeklyTrend()`, `rLoadProfit()` | Bank balance / 30-day revenue / net cash tiles; manual weekly-budget inputs (bank balance, weekly revenue, truck payment, fuel, insurance [monthly], other, tax-reserve %) → 30-day forecast breakdown + weekly tax reserve $; 4-week balance timeline table; **Weekly Net Pay Trend** line chart (net vs. gross per settlement week, Chart.js); **Load Profitability** — best 5 / worst 5 lanes by $/loaded-mile computed from all imported loads. |
| 14 | **Scorecard** (`score`) | `rScore()` | 0–100 composite score (weighted: revenue/mile up to 25pts, fuel/mile up to 25pts, net/mile up to 25pts, +15 flat if any miles driven) with a letter-style grade (Excellent/Good/Average/Needs Work) and a KPI breakdown. |
| 15 | **Loan Center** (`loanc`) | `rLoanc()` | Total balance, weekly payments, monthly total (monthly = monthly-freq loans + weekly-freq loans × 4.33); loan table + add-loan form (name, lender, original amount, current balance, payment, frequency, APR, next due). Operates on the **global `LOANS`** array — **note:** this is a separate store from `DB.loans` used by AI import, see §4. |
| 16 | **Credit Cards** (`cards`) | `rCards()` | Total balance/limit/utilization %/min payments; card table (utilization >30% shown orange) + add-card form. |
| 17 | **Bank Statement** (`bankstmt`) | `rBankStmt()`, `rCheckingStmt()` | Two tabs (`bsTab('card'\|'checking')`): **BofA Business Card** — imports a monthly statement PDF (view-only, never creates deductions), shows category breakdown (Tools/Electronics/Comfort/Supplies/Personal) and a cross-check panel against settlement deduction totals; **Checking Account** — imports a statement PDF, shows opening/closing balance, deposits/withdrawals, and a categorized breakdown (Prime Deposit / Owner's Draw / BofA Payment / Loan Payment / Other Business) with a match-vs-settlements indicator; closing balance **overwrites** `gw_bizbal` on render. |
| 18 | **Asset Register** (`areg`) | `rAreg()` | Total items / total deductible / this-month $ / avg-per-item; category breakdown (Tools, Comfort, Electronics, Supplies, Safety, Total); filterable table (`arFilter()`) with edit/delete per row; add-asset form (name, category, store, payment method, date, cost, business-use %, notes) → `saveAsset()`. **Reads/writes `DB.ded` entries with `code==='EQUIP'`**, NOT a dedicated asset table — see §2.1 and §4. |
| 19 | **Accountant Package** (`acct`) | `rAcct()` | Gross revenue / expenses / net / settlement count; "Assets (by category)" card (**broken — reads dead `ASSETS2` store, always empty**, see §4); fuel expense summary; loans & cards summary; full expense-by-category breakdown including a synthesized "Per Diem (N days × $64)" line; **"Generate Accountant Package"** → downloads a JSON dump (`genPkg()`) with income summary, loans, cards, asset count, capital contributions/draws, and the full raw `DB`. |
| 20 | **AI Advisor** (`ai`) | n/a (chat) | Free-text chat calling Anthropic directly from the browser with a system prompt built from live financial totals (`aiCtx()`); 3 canned quick-questions; **calls `api.anthropic.com` directly from client-side JS with the user's own key — must move server-side per `CLAUDE.md`.** |
| 21 | **Tax Estimator** (`tax`) | `calcTax()`, `syncTax()` | 2026 federal + SE tax calculator: gross revenue, business expenses, spouse income, SEP IRA, health insurance, filing status (Single/MFJ/HoH) → net profit, SE tax (15.3%), SE tax deduction (50%), AGI, standard deduction, taxable income, bracket-by-bracket federal tax, total tax, quarterly (÷4) breakdown for Q1–Q4. **"Sync from Data"** (`syncTax()`) auto-fills from the net-pay model (§3.1). |
| 22 | **Settings** (`settings`) | `rSettings()` | Business info form (company, owner, email, phone, DOT#, MC#, EIN, address) → `saveBizInfo()`; **View-Only Mode** toggle (device-local, `setReadOnly()`); **API Key** management (Anthropic key, client-stored — must be removed in the server-side redesign); data stats (settlements/loads/fuel counts); **Backup & Restore** (Export JSON `exportData()`, Import Backup `importData()`, "Reset Financial Data Only" `clearFinancialData()`, "Clear All Data" `clearAll()`); **Google Drive** connect/disconnect (real OAuth, silent background upload); **Auto-Organize** local-download fallback toggle + instructions. |
| — | **Universal AI Import overlay** (`#pdfOv`) | `handleFile()`, `showPrev()`, `saveImport()` | Global modal (drag-drop or click-to-browse), triggered from 4 entry points (`openPDF()` main import, maintenance page's "Import Invoice PDF", `openBankPDF()`, `openCheckingPDF()`). Shows a fake step-by-step progress animation, then a rich preview card (icon, doc type, routing description, amount, date/vendor/amount/tax-deductible/type/summary, line items, duplicate warning) before the user confirms **"Save to System"**. See §3.6–§3.8. |

---

## 2. Data Entities (`localStorage`)

All keys are plain JSON (`gw_` prefix). There is **no schema versioning**; `loadDB()`
back-fills missing keys defensively on load (see migration comment at the top of the
script). Below, each top-level in-memory object and the localStorage key(s) backing it.

### 2.1 `DB` (`localStorage['gw_db']`, via `loadDB()`/`saveDB()`)

```
DB = {
  sett:  [],               // Settlements
  loads: [],                // Loads
  fuel:  { tr: [], re: [] }, // Fuel — tractor / reefer
  reimb: [],                // Reimbursements
  ded:   [],                // Deductions (out-of-pocket AND settlement-withheld, one array)
  maint: [],                // Maintenance records
  tolls: { ez: [], dw: [] }, // Tolls — EZ-Pass / DriveWyze
  loans: [],                 // ⚠️ separate from global LOANS — write-only, see §4
  assets: { tr: null, apu: null }, // ⚠️ apu is write-only, never rendered, see §4
  op:    {},                // Operating P&L overrides (ytdRevenue/ytdExpenses/ytdNet)
  docs:  []                 // Import log, used ONLY for duplicate detection
}
```

| Sub-array | Fields | Meaning |
|---|---|---|
| `DB.sett[]` | `id, date, weekEnding, carrier, gross, reimb, ded, net, miles, revenueItems[]` | One row per imported settlement PDF. `revenueItems: [{desc, order, amount}]`. `date` = the settlement/document date; `weekEnding` = Prime's stated pay-period end. |
| `DB.loads[]` | `id, date, pickupDate, deliveryDate, order, from, to, loadedMiles, emptyMiles, revenue, rate, shipper` | One row per load line inside a settlement. `pickupDate`/`deliveryDate` drive per-diem day counting (§3.4) — falls back to `date`/`d.date` if the AI didn't extract real load dates (in which case per-diem for that load is simply not counted; **no estimate is ever used**). |
| `DB.fuel.tr[]` / `.re[]` | `id, date, location, gallons, amount, discount` | Tractor fuel and reefer fuel are tracked as fully separate ledgers throughout the app (separate stat tiles, separate tables, separate accountant-package lines). |
| `DB.reimb[]` | `id, date, desc, ref, amount` | Reimbursements — warranty credits from maintenance imports (`m.warrantyCredit`) also land here, tagged `desc:'Warranty — <description>'`. |
| `DB.ded[]` | `id, date, code, desc, amount, category, store, payment, source` | **The central expense ledger** — see §3.1 for the two-class split. `code` ∈ `EQUIP`\|`LEGAL`\|`INS`\|`LIC`\|`MISC`\|`OTHER`\|(settlement's own code from the AI, e.g. an ELD line code). `category` ∈ the 10 `DED_CATEGORIES` (Software & Subscriptions, Legal & Accounting Fees, Insurance, Licensing & Permits, Tools & Equipment, Electronics, Comfort & Sleeper, Truck Supplies, Safety Equipment, Misc — plus legacy `Other`). `payment` ∈ `Business Credit`\|`Business Debit`\|`Personal Card`\|`Cash`\|`Settlement Withheld` (legacy values `Zelle/Venmo/Cash App/PayPal Personal` are normalized by `mapLegacyPayment()`). `source==='settlement'` marks settlement-withheld rows. **Asset Register items live here too**, tagged `code==='EQUIP'` (see §4 — this is why a separate `ASSETS2` store exists but is dead). |
| `DB.maint[]` | `id, date, odo, hours, type, shop, invoice, desc, total, covered, source?` | `type` is one of 17 values (see §3.3 table); `hours` is APU-only; `covered` = warranty $ (feeds both Maintenance page stats and, if extracted, a mirrored `DB.reimb` row); `source:'prime830157'` tags the 56 bulk-imported historical rows. |
| `DB.tolls.ez[]` / `.dw[]` | `id, date?, location, amount` | ⚠️ Items from settlement-PDF extraction have **no guaranteed `date`** — see §4 (cascade-delete gap). |
| `DB.loans[]` | `id, name, balance, nextDue, ...` | Populated only from `s.loans` inside settlement AI extraction. **Never rendered anywhere in the UI.** Do not confuse with the `LOANS` global (§2.2). |
| `DB.assets.tr` | `unit, year, make, model, vin, odometer, license?` | Tractor identity/odometer, shown on Dashboard + Assets page. Populated by AI extraction (`s.assets.tractor`); no manual-edit form exists. |
| `DB.assets.apu` | `unit, make, model, vin, hours, rental?` | Populated by AI extraction (`s.assets.apu`) but **never read/rendered anywhere.** |
| `DB.op` | `ytdRevenue, ytdExpenses, ytdNet` | Optional AI-extracted YTD figures from a settlement's own "operating summary" section; when present, **overrides** the locally-computed Operating P&L totals (`rOper()` prefers `DB.op.x || computed`). |
| `DB.docs[]` | `filename, date, docType, amount, savedAt` | Append-only import log. Used exclusively by `checkDuplicateImport()` (match by `docType+date+amount±0.01`, or by exact `filename`) and by `cleanupStaleDocs()` to drop entries whose underlying record no longer exists. Not shown in any UI list. |

### 2.2 `LOANS` (`localStorage['gw_loans']`)
Array, seeded on first load with one hardcoded entry:
`{name:'Initial Capital Contribution — Truck', lender:'Ali Bozkurt + Eş (3 banka kredisi)', original:60000, balance:60000, payment:0, freq:'Monthly', apr:0, due:''}`.
Fields per loan: `name, lender, original, balance, payment, freq ('Weekly'|'Monthly'), apr, due (date string)`. This is the array the **Loan Center** page actually uses (`rLoanc`, `saveLoan`, `delLoan`) — see §4 for the DB.loans split.

### 2.3 `CAPITAL` (in-memory; persisted as two keys)
```
CAPITAL = {
  contribution: 60000,                                          // fixed initial capital, not persisted separately
  draws: JSON.parse(localStorage['gw_draws'] || '[]'),           // {id, amount, date, note}
  extraContributions: JSON.parse(localStorage['gw_contributions'] || '[]') // {id, amount, date, note}
}
```
`extraContributions[].id` is **always the id of the deduction that generated it** — this is the id-link described in §3.2. Draws have their own independent `id` (`uid()`), generated when the owner records a draw; draws are never linked to any other record.

### 2.4 `CARDS` (`localStorage['gw_cards']`)
Array of `{name, balance, limit, apr, minpay, dueday}` — credit cards tracked for payoff visibility, not tied to the deduction ledger.

### 2.5 `BANK_STMTS` (`localStorage['gw_bankstmts']`)
Array of imported BofA business-card statement objects: `{month, statementTotal, transactions:[{date, merchant, amount, category, deductible, notes}], _fn}`. **View-only** — importing one never writes to `DB.ded`; it exists purely for the "Cross-Check with Settlements" comparison panel.

### 2.6 `CHK_STMTS` (`localStorage['gw_chkstmts']`)
Array of imported checking-account statement objects: `{month, openingBalance, closingBalance, transactions:[{date, description, category, type:'deposit'|'withdrawal', amount}], _fn}`. Categories: `Prime Deposit`, `Owner's Draw`, `BofA Payment`, `Loan Payment`, `Other Business`. Rendering **overwrites `gw_bizbal`** with the latest statement's `closingBalance` as a side effect (`rCheckingStmt()`).

### 2.7 `gw_health` (Truck Health config, JSON object — not an array)
```
{
  odo, mpg,
  lastOil, lastFuelFilter, lastDpf, lastDef, lastCoolExt, lastCoolant,
  lastTrans, transSynthetic, lastDiff, diffSynthetic,
  lastAirFilter, lastAirDryer, lastChassis,
  apuHours, lastApuHours, coolantDate
}
```
Every `last*` field is an **odometer reading** (miles) at which that service was last performed, except `apuHours`/`lastApuHours` which are **engine hours**. `coolantDate` is a reference-only date field, not used in any interval math. See §3.3 for how these combine with fixed intervals to produce "miles/hours remaining."

### 2.8 Misc single-value keys
| Key | Meaning |
|---|---|
| `gw_bizbal` | Current business checking balance (starts at `60000`, matching the initial capital contribution). Mutated by: settlement import (+net pay), settlement delete (−net pay reversal), manual "Update Business Balance", and checking-statement import (overwritten to statement's closing balance). |
| `gw_biz` | Business profile JSON: `company, owner, email, phone, dot, mc, ein, addr`. |
| `gw_apikey` | Anthropic API key (`sk-ant-...`), stored **client-side in the browser** — must not exist in the mobile app per `CLAUDE.md` (server-side Edge Function only). |
| `gw_readonly` | `'1'`/`'0'` — device-local "View-Only Mode" (see §3.9). |
| `gw_autosave` | `'1'`/`'0'` (default on) — whether imported PDFs auto-download to an organized local folder path when Google Drive isn't connected. |
| `gw_drive_connected` | `'1'` once the user completes Google OAuth. |
| `gw_drive_folders` | Cache of `{ "parentId/name": driveFolderId }` to avoid re-querying Drive for folders already created. |
| `gw_assets` | Backing store for `ASSETS2` — **dead/orphaned**, see §4. |

---

## 3. Core Business Logic Rules

### 3.1 Net-pay tax model (critical — invariant #1)
Two independent "how much did this cost" numbers coexist by design and must **not** be merged:

- **Operating cost-per-mile** (Dashboard CPM, `rDash()`): `totalCost = DB.ded.reduce(sum amount)` — i.e. **every** deduction, withheld or out-of-pocket, divided by settlement miles. This answers "what does it cost me to run this truck," which legitimately includes Prime's payroll withholdings (ELD, insurance, truck payment).
- **Taxable income** (`syncTax()`): `income = DB.sett.reduce(sum net)` (already net of Prime's withholdings) `+` `expenses = outOfPocketDeds() + perDiem`. Withheld deductions are **excluded** from `expenses` here because they were already subtracted before Prime paid out — re-subtracting them would double-count against taxable income.
- The split is made by `isSettlementDed(x)`: `x.source==='settlement' || x.payment==='Settlement Withheld'`. `outOfPocketDeds()` / `settlementDeds()` are simple filters over `DB.ded`. The Deductions page renders both groups as two visually distinct tables with explicit labels explaining why.
- A one-time migration at app boot (`window.addEventListener('load', ...)`) back-tags any legacy deduction with no `source`/`payment` whose date matches a known settlement date as `source:'settlement', payment:'Settlement Withheld'`.

### 3.2 Capital Account — id-linked owner contributions (invariant #2)
- `isPersonalPayment(payment)` = `/personal|cash|zelle|venmo/i.test(payment)` — true for `Personal Card`, `Cash`, and legacy `Zelle/Venmo/Cash App/PayPal Personal` payment-method strings.
- `syncContributionForDeduction(ded)` is the **single source of truth**, called after every create/edit of a deduction (manual, AI-imported, asset-register, or bank/checking-derived): if the deduction is personally-paid and `amount>0`, `addContribution(ded.id, ded.amount, ded.date, note)` upserts (filters out any existing entry with the same id, then pushes fresh) — **never duplicates**. If the payment method is changed away from personal, `removeContribution(ded.id)` deletes the linked contribution.
- Deleting the deduction (`deleteDed`, `deleteEquipItem`) or its parent settlement (`deleteSett`) explicitly calls `removeContribution(x.id)` for every affected deduction — this is the cascade half of invariant #5.
- `cleanupOrphanedContributions()` is a repair utility for contributions whose linked deduction no longer exists (pre-dates the cascade fix) — filters `CAPITAL.extraContributions` to only ids present in `DB.ded`.
- Tax-free remaining = `CAPITAL.contribution (60000) + sum(extraContributions) − sum(draws)`, floored at $0 for display; the underlying number is **not prevented from going negative** by the code — there is no hard cap that blocks recording a draw larger than remaining capital.
- Owner's Draw (`addOwnerDraw()`) and Business Balance update (`updateBizBalance()`) both use native `prompt()` dialogs — must become real form/modal UI on mobile.

### 3.3 Truck Health — intervals & highest-odometer-wins sync (invariant #4)
Fixed intervals (owner-tuned, **do not change**), computed in `oilMi/dpfMi/transMi/diffMi` and inlined constants in `rHealth()`:

| Category | Interval | Basis |
|---|---|---|
| Oil & Filter | 50,000 mi (fixed) | `oilMi(mpg, sampling)` always returns `50000` — parameters are vestigial/unused, kept fixed per owner decision |
| Fuel Filter | Same as oil (50,000 mi), **bundled**: replaced at every oil change even if not separately listed on the invoice | `MAINT_BUNDLE_MAP = {oil: ['fuel']}` |
| DPF Cleaning | MPG-tiered: ≥6.5 mpg → 600,000 mi; ≥5.5 → 500,000 mi; else → 350,000 mi | `dpfMi(mpg)`, International A26 spec card |
| DEF Filter | 300,000 mi (fixed) | A26 spec card |
| Coolant Extender | 300,000 mi (fixed) | A26 spec card |
| Coolant Full Replace | 600,000 mi (fixed) | A26 spec card |
| Transmission | 500,000 mi synthetic / 250,000 mi conventional | `transMi(synthetic)`, Eaton Fuller Heavy Duty Highway manual (TRSM0505/TRSM0525) |
| Differential | 500,000 mi synthetic / 100,000 mi conventional | `diffMi(synthetic)` |
| Engine Air Filter | 100,000 mi (fixed) | |
| Air Dryer Cartridge | 250,000 mi (fixed) | |
| Chassis Lube | 30,000 mi (fixed) | |
| APU Service | 2,000 **engine hours** (not miles) — TriPac | Prime's records don't include APU hour history; entered manually |

- Every category's "remaining" = `interval − (currentOdo − lastServiceOdo)`; status thresholds are `< 0` → red/OVERDUE, `< 10% of interval` → orange/Due Soon, else green/OK (APU uses a flat 200-hour warning band instead of 10%).
- **Highest-odometer-wins sync** (`applyMaintToHealth(rec)`): whenever a maintenance record is saved/imported (manual entry, invoice-PDF import, or a settlement PDF's embedded maintenance line), it updates `gw_health.<field>` **only if** the record's odometer is greater than what's already stored — so records can be imported in any order without regressing a category's baseline. `syncHealthFromMaint()` replays this over the entire `DB.maint` array (used by the "Recalculate from Maintenance Log" button and silently on every app load). `rebuildMaintDerivedHealth()` (used after a maintenance-record delete) wipes only the maintenance-*derived* fields and rebuilds from whatever records remain, so removing the newest oil-change record correctly falls back to the next-most-recent one — manually-set fields (current odometer, MPG, fluid type, APU hours) are left untouched.
- `detectMaintType(desc)` is a keyword-regex classifier used both for uncategorized/"general" records (`reclassifyMaint()`) and as a fallback when the AI import didn't set an explicit `serviceType`.
- The 56-row `PRIME_HISTORY_830157` constant is Unit 830157's real curated repair history (2023-01-19 through 2026-05-26), importable in one click; importing it also runs `applyMaintToHealth` for every row, so Truck Health baselines end up reflecting the actual latest real service dates.

### 3.4 Per diem, CPM/RPM/PPM, quarterly tax deadlines
- **Per diem**: `calcPerDiemDays()` sums `deliveryDate − pickupDate` (in whole days) across every load in `DB.loads` that has **both** real dates — no estimation/interpolation when dates are missing. Deduction = `days × $64` (documented in the UI as "80% of $80," i.e. the $80/day special transportation industry meal rate at the 80% deductible rate under IRC §274(n)). This figure is added into the Tax Estimator's `expenses` and appears standalone in the Accountant Package.
- **RPM** (revenue/mile) = gross settlement revenue ÷ total settlement miles.
- **CPM** (cost/mile) = `DB.ded` total (all deductions, withheld + out-of-pocket, see §3.1) ÷ total settlement miles.
- **PPM** (profit/mile) = RPM − CPM; UI colors it green above $0.50, orange 0–0.50, red negative — with the tile subtitle literally coaching "accept loads above CPM!"
- **Quarterly deadlines** (`syncTax()`): hardcoded 2026 IRS estimated-tax dates `Q1 2026-04-15, Q2 2026-06-15, Q3 2026-09-15, Q4 2027-01-15`; the Dashboard finds the next unmet deadline and shows a live countdown, colored red ≤14 days, orange ≤30 days.
- Full tax engine (`calcTax()`): net profit = max(0, revenue−expenses); SE tax base = net×0.9235; SE tax = base×15.3%; SE deduction = 50% of SE tax; AGI = net + spouse income − SE deduction − SEP IRA − health insurance (floored at 0); standard deduction is filing-status-dependent (`mfj: 30000, hoh: 22500, single: 15000` — 2026 figures); federal tax computed via full marginal brackets for MFJ and Single/HoH (7 brackets, 10%→37%); quarterly payment = total tax ÷ 4 (flat, not IRS's actual safe-harbor/annualized-income method).

### 3.5 Document filing structure (Google Drive / local fallback)
Every successful import is saved into a **document-date-derived** folder path, never upload-date:
- `monthFolder(dateStr)` → `YYYY-MM` from the document's own date.
- `buildDocFolderParts(docType, date, vendor)`:
  - `settlement` → `[Month, 'Payroll', 'Week-N']` where `weekOfMonth()` = `ceil(day-of-month / 7)`, capped at 5.
  - `amazon`/`store` (any store/receipt purchase) → `[Month, 'Equipment-Deductions', <StoreName>]` — one subfolder per vendor (Amazon, Home Depot, etc.), not a generic bucket.
  - everything else → `[Month, <Category>]` via `orgFolderName()` (`fuel→Fuel, maintenance→Maintenance, toll→Tolls, loan→Loans, bankstmt/checking→'Bank Statements'`).
- `buildDocFileName()` produces human-readable names, e.g. `2026-06-28_Home-Depot_Milwaukee-M18-Impact-Wrench.pdf` or `2026-06-27_Payroll-Settlement_Prime-Inc.pdf`.
- If Google Drive is connected (`driveConnected()`), the file is uploaded there (folders auto-created/cached via `driveFindOrCreateFolder`) under root folder `graywolflogistics2026 documents/`, and the local "Save As" flow is **skipped entirely**. If Drive isn't connected, the file downloads locally via a synthetic nested path (relies on the browser's "ask where to save" + a one-time manually-chosen Drive-synced folder) — a fallback that won't translate to mobile; the real target for the mobile app is Supabase Storage using the same folder-part scheme (already reflected in `docs/SCHEMA.sql`'s `documents.storage_path`).
- After every successful save, `autoBackupToDrive()` fires a fire-and-forget full JSON snapshot to `Backups/` in Drive, timestamped per run (not deduped per day despite the code comment claiming "one file per day").

### 3.6 AI import — extraction rules (port the prompt verbatim)
Single universal endpoint/prompt handles `settlement | fuel | maintenance | amazon (=any store) | toll | loan | other`, decided by the model itself (`docType` field). Rules embedded in the prompt that must survive verbatim per `CLAUDE.md`:
- **Vendor extraction**: must be the actual store/company name read off the document; never default to "Amazon" unless it truly is Amazon; if illegible, use `"Unknown Store"` rather than guessing.
- **Qty × unit price**: `price` is explicitly per-unit; `qty` must be read from small on-page indicators ("Qty: N"); a **self-check instruction** tells the model to verify `sum(price×qty) + tax + shipping === grand total` and re-read the document if not.
- **Tax capture**: `purchase.tax` is extracted explicitly; `purchase.total`/`totalAmount` must equal the invoice's grand total including tax/shipping.
- **Peer-to-peer payments** (Zelle/Venmo/Cash App/PayPal screenshots) are mapped onto the same `amazon` schema: vendor = recipient name, item name = the payment "Message" (or "Private party purchase"), `paymentMethod` tagged e.g. `"Zelle Personal"` so it's detected as a personal payment downstream.
- **100%-deductible OTR framing**: the prompt explicitly instructs the model that because Ali lives in the sleeper cab, tools/TV/PlayStation/cooking appliances/electronics/bedding are all 100% deductible; only groceries/medicine are personal.
- **Settlement deduction category enforcement**: bookkeeping/accounting/Abacus/registered-agent/legal-filing line items **must** be tagged `Legal & Accounting Fees`; ELD/e-log/GPS/maps/load-board/software fees **must** be tagged `Software & Subscriptions` — never left blank/generic.
- **Client-side execution today**: the fetch to `api.anthropic.com` happens directly from the browser with the user's own key in an `x-api-key` header — this is the piece that must move to a Supabase Edge Function (`ai-import`), per `CLAUDE.md` and `PROMPTS.md` Session 2. Model currently pinned: `claude-sonnet-4-6`.
- Bank/checking-statement imports use two **separate**, simpler prompts (`importBankStatement`, `importCheckingStatement`) that don't touch `DB.ded` at all — they're informational/cross-check only.

### 3.7 Invoice total reconciliation (invariant #3)
In `saveImport()`, for every store/Amazon-type purchase: each line item becomes its own `DB.ded` row (`qty × unit price`, `code:'EQUIP'`), then the code computes `extra = purchase.tax>0 ? purchase.tax : (grandTotal − sum(items) > 0.01 ? grandTotal − itemsSum : 0)` and — if positive — books **one more row** titled `"Sales tax & fees | <store> | <payment>"`. This guarantees `sum(DB.ded rows for this receipt) === invoice grand total` even if the AI under-extracted tax/shipping as a separate field. Each item row (and the tax/fee row) individually triggers `syncContributionForDeduction()` if personally paid, so a personal-card Amazon order with 3 items creates/updates up to 4 linked capital contributions.

### 3.8 Cascading deletes (invariant #5)
- `deleteSett(i)`: reverses the business balance (`bizbal -= net`), then removes the settlement plus every `DB.loads/fuel.tr/fuel.re/ded (+ its contributions)/reimb/maint/tolls.ez/tolls.dw/docs` row whose `date === settlement.date`.
- `deleteDed(i)` / `deleteEquipItem(i)`: removes the linked capital contribution (`removeContribution(x.id)`) before splicing the row, then re-runs `cleanupStaleDocs(true)` so a future re-import of the same document isn't falsely flagged as a duplicate.
- `deleteMaint(i)`: splices the record then calls `rebuildMaintDerivedHealth()` to recompute Truck Health from whatever remains (see §3.3).
- `deleteDraw(id)`: simple removal, no cascade needed (draws are leaf records).
- `cleanupOrphanedContributions()` / `cleanupStaleDocs()`: idempotent repair utilities, also run silently on every app boot and on backup-import (`importData()`), so the two "Clean Up" buttons on the Capital Account page are mostly a manual-trigger safety net.

### 3.9 View-Only Mode
`isReadOnly()` reads a **device-local** flag (`gw_readonly`); `guardReadOnly()` is called at the top of every state-mutating function (there are ~35 call sites) and short-circuits with an alert if on. It does not gate reads/renders — every dashboard/report remains fully visible. Intended workflow: owner exports a backup, spouse/other device imports it, then flips View-Only **on that device only**; it never touches the owner's own data or syncs across devices (there is no concept of shared/multi-user access — this is purely a local UI lock, not real authorization).

### 3.10 Other constants worth preserving exactly
- `PAYMENT_METHODS = ['Business Credit','Business Debit','Personal Card','Cash']` (the 4 canonical values everything normalizes to via `mapLegacyPayment()`).
- `DED_CATEGORIES` (10 canonical + legacy `'Other'`).
- Initial capital contribution: **$60,000** (also the seeded business balance and the seeded `LOANS[0]` "Initial Capital Contribution — Truck" entry — same number appears in 3 independent places at boot, worth collapsing to one config value in the rebuild).

---

## 4. Bugs / Inconsistencies Found

Ranked roughly by how much they'd matter if silently ported as-is.

1. **`DB.loans` is a dead, disconnected data store.** AI-extracted loan info from a settlement PDF (`s.loans`) is written into `DB.loans` (`saveImport()`), but the entire Loan Center screen (`rLoanc`, `saveLoan`, `delLoan`, the stat tiles) reads/writes the **separate global `LOANS`** array (`localStorage['gw_loans']`) instead. Any loan info the AI extracts from a settlement is captured and then never seen again. **For the mobile port:** decide up front whether AI-extracted loan data should merge into the same `loans` table `docs/SCHEMA.sql` already defines (recommended) — don't recreate two parallel stores.
2. **`DB.assets.apu` is write-only.** Populated from `s.assets.apu` during settlement import; there is no page, card, or field anywhere in the app that reads it. Either surface it (an APU identity card next to the Assets/tractor card) or drop the extraction.
3. **Accountant Package "Assets (by category)" card is permanently broken/empty.** It's driven by `ASSETS2`/`localStorage['gw_assets']` (`rAcct()` line iterating `ASSETS2.forEach`), but the real Asset Register feature (`saveAsset()`) writes assets as `DB.ded` rows tagged `code==='EQUIP'` — it never touches `ASSETS2`. `delAsset()` (which mutates `ASSETS2`) has **no caller anywhere in the UI** — confirmed via a full scan of every `onclick=` handler in the file. Net effect: no matter how many real assets exist in the Asset Register, the Accountant Package's asset-by-category section always shows "Add assets to Asset Register." Port the Accountant Package's asset summary from the same `EQUIP`-coded deduction source the real Asset Register uses.
4. **"Business Use %" and "Notes" fields on the Add Asset form are silently discarded.** `saveAsset()` reads `as-n, as-store, as-payment, as-c, as-cost, as-d` but never reads `as-biz` (Business Use %) or `as-notes` — they're cleared from the DOM at the end but never persisted anywhere. Every asset is booked at 100% business use regardless of what the owner types into that field, which happens to match the "100% deductible OTR sleeper cab" business rule (§3.6) — but the input control implies it does something, and it doesn't. Either wire it up (e.g. multiply the booked deduction by `bizPct/100`) or remove the misleading fields.
5. **Toll line items from settlement imports don't reliably carry a `date`, breaking the delete cascade.** Fuel and reimbursement items pushed from a settlement fall back to the settlement's own date (`date: f.date || d.date`), but tolls are pushed as `{id: uid(), ...t}` with **no fallback** (`saveImport()`, the `s.tolls?.ezpass?.items` / `drivewyze.items` lines) — and the AI prompt never even defines a per-item schema for toll items (`"items":[]` with no shape). `deleteSett()`'s cascade filters tolls by `x.date === s.date`; a toll item with no (or a mismatched) date will **survive** deletion of its parent settlement, directly violating invariant #5. Give toll items the same `date: t.date || d.date` fallback the fuel/reimbursement branches already use.
6. **Owner-truck-specific magic numbers hardcoded inside otherwise generic health functions.** `rHealth()` falls back to `apuHours: h.apuHours || 10054` and `lastApuHours: h.lastApuHours || 10050`; the chassis calc does `Math.max(h.lastChassis || 0, 299161)` with the inline comment "confirmed: chassis lube done, 25K mi remaining as of 304,161 odo." These are Unit 830157's real readings on the day this code was written, baked in as defaults rather than as an explicit one-time seed value. If the mobile app reuses this function shape for a *new* truck (or after a real data reset), it will silently show these specific numbers as if they were true baselines instead of "unknown." Model these as an explicit owner-entered baseline (nullable, no numeric fallback) instead of code constants.
7. **Two legitimately different "total expenses" figures share ambiguous naming.** Dashboard CPM and Operating P&L "Expenses" both sum **all** of `DB.ded` (withheld + out-of-pocket); the Tax Estimator's "Business Expenses" is out-of-pocket-only + per diem. Both are intentional and correct for their purpose (§3.1, §3.4) but nothing in the UI copy or code disambiguates them beyond a code comment. Worth explicit, differently-named fields/selectors in the mobile data layer (e.g. `totalOperatingCost` vs `taxDeductibleExpenses`) so it's impossible to accidentally wire the wrong one into a new screen.
8. **Per-diem day counting can double-count overlapping load date ranges.** `calcPerDiemDays()` sums `deliveryDate − pickupDate` per load independently; if load B's pickup date equals load A's delivery date (a same-day relay/turn), that calendar day is counted twice. Likely a rare edge case given real dispatch patterns, but worth a unit test with fixture data before trusting the ported per-diem number for the tax estimator.
9. **Maintenance records extracted from a settlement PDF are dated with the settlement's date, not the actual service date.** `saveImport()`'s settlement branch does `const rec={id:uid(), date:d.date, ...}` for every `s.maintenance[]` entry — so a repair that happened mid-week shows up in the Maintenance Log under the settlement's date/week-ending, unlike records from a direct "Import Invoice PDF" or manual entry (which get their own real date). The highest-odometer-wins health sync (§3.3) is unaffected (it's keyed by odometer, not date), but any date-based reporting/sorting on the Maintenance Log will be slightly wrong for settlement-sourced records.
10. **`monthNameToFolder()` parses a display string via the `Date` constructor, which is fragile.** `new Date(monthStr + ' 1')` on an input like `"June 2026"` produces `"June 2026 1"`, a format not reliably parsed across JS engines (likely `Invalid Date` in strict engines, silently falling through to the regex fallback `monthStr.replace(/\s+/g,'-')`). Use an explicit month-name lookup instead of relying on loose `Date` string parsing when porting.
11. **Dead code: `reconcileBalance(amount)`** is fully implemented (updates `gw_bizbal`, re-renders, alerts) but has zero callers anywhere in the file — no button wires to it. Likely a removed or never-finished "sync business balance to statement closing balance" action on the Checking tab (which currently does this automatically/silently instead, via `rCheckingStmt()` unconditionally overwriting `gw_bizbal`). Decide intentionally in the mobile app whether that overwrite should be automatic (as today) or an explicit confirm action (reviving this function's intent).
12. **Cosmetic:** the Maintenance page's "📦 Load Prime Unit 830157 History **(53)**" button label is stale — `PRIME_HISTORY_830157` actually contains **56** entries (confirmed by count). The runtime confirm/success dialogs use `.length` and correctly say 56; only the hardcoded label text is wrong.
13. **Two independent odometer readings that are never reconciled:** `DB.assets.tr.odometer` (AI-extracted, shown on the Assets page/Dashboard truck card) and `gw_health.odo` (manually entered or maintenance-derived, drives every Truck Health interval calc). They can drift apart with no warning. `docs/SCHEMA.sql`'s single `trucks.current_odometer` column already anticipates fixing this — make sure the app actually funnels both update paths through one column rather than reintroducing two.
14. **`updateBizBalance()` and `addOwnerDraw()` use native `prompt()`/`confirm()` dialogs** for data entry — not a logic bug, but called out because it's easy to port "the logic" and forget these are the *only* UI for two Capital Account actions; they need real form screens on mobile.
