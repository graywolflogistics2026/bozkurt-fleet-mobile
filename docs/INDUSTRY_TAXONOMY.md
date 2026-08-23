# Industry Taxonomy — trucking document/category knowledge base

Single source of truth for the full trucking document/category universe
(owner decision, researched 2026-07-10, PRODUCT DECISION — binding). This
is what the AI classifies against and what the app's own category constant
(`app/src/import/category.ts` `CANONICAL_CATEGORIES`) is derived from. When
either the ai-import prompt or the app's category list needs to change,
change it here FIRST, then propagate — this file is the contract, not a
description of what happens to exist in code today.

Nothing here creates a DB migration by itself — `deductions.category` (and
every settlement-deduction row's category) is free text (no check
constraint), so every rename/addition below is purely an app+prompt-level
convention. Old rows keep whatever category string they were saved with.

---

## A. Settlement anatomy (carrier-agnostic)

Every carrier's settlement differs in layout, but all of them share the
same underlying shape: a period/week, a truck unit #, a driver name, a set
of load rows (origin → destination, miles loaded/empty, rate), a set of
INCOME lines, and a set of CHARGEBACK lines. `ai-import` extracts the
generic fields regardless of carrier (CLAUDE.md invariant #14) and
classifies each income/chargeback line with the enums below.

**Net-pay invariant is unchanged (CLAUDE.md invariant #1):** chargebacks are
informational categorization only — settlement-withheld amounts are NEVER
re-counted as an out-of-pocket tax deduction. `income_type`/
`chargeback_type` classify WHAT a line is, they never change WHETHER it's
double-counted.

### income_type

| Value | Meaning |
|---|---|
| `linehaul` | Base line-haul revenue for a load |
| `fuel_surcharge` | FSC — fuel price pass-through on top of linehaul |
| `accessorial` | Detention, layover, stop pay, tarp pay, hand-unload, extra stop, hazmat premium |
| `reimbursement` | Carrier reimbursing an expense the driver already paid — tolls, scales, washout, lumper, permits |
| `bonus` | Safety bonus, referral bonus, sign-on bonus, fuel-efficiency bonus |
| `trailer_rent` | Carrier paying the owner-operator for use of their own trailer |
| `ifta_refund` | IFTA quarterly refund — this is INCOME, not an expense offset (see rule D below) |
| `other_income` | Anything else clearly income that doesn't fit above |

### chargeback_type

| Value | Meaning |
|---|---|
| `fuel_advance` | A fuel advance the carrier fronted, deducted back |
| `insurance_bobtail` | Bobtail/non-trucking-use insurance |
| `insurance_physical_damage` | Physical damage insurance on the tractor |
| `insurance_occ_acc` | Occupational accident insurance |
| `insurance_cargo` | Cargo insurance |
| `insurance_workers_comp` | Workers' compensation |
| `eld_communications` | ELD/e-log device fee |
| `plates_permits` | Plates/permits — often amortized weekly (e.g. an 18-week plate payback schedule) |
| `escrow_reserve` | Performance bond / escrow reserve / tire fund / emergency fund / maintenance reserve — a REFUNDABLE DEPOSIT the carrier holds on the driver's behalf, not an expense (owner decision 2026-08-02) — maps to category `Escrow & Deposits` below. Also matched client-side on OCR-damaged spellings (e.g. "PERFORMNCE BOND") via `isEscrowDeposit()` (`app/src/import/category.ts`) as a safety net when the AI misses this classification |
| `lease_purchase_payment` | Truck lease-purchase payment (owner-operators leasing FROM the carrier) |
| `trailer_fee` | Trailer rental fee charged BY the carrier |
| `cash_advance` | A cash advance, deducted back |
| `loan_payment` | A loan payment routed through the settlement |
| `advance_repayment` | Repayment of a prior advance (e.g. extended-warranty or company-store advance) — loan principal, not an expense. If the line instead pays for a reimbursed service (matched by a corresponding `reimbursement` income line), classify it under that normal category/`income_type` instead, not this value (owner decision 2026-07-17, mirrors web v2026.07.17-D) |
| `drug_consortium` | DOT drug/alcohol testing consortium fee |
| `tolls_transponder` | Toll transponder fee/rental |
| `admin_processing_fee` | Generic administrative/processing fee |
| `factoring_fee` | Factoring company's fee/discount |
| `dispatch_fee` | Dispatch service fee |
| `other_chargeback` | Anything else clearly a chargeback that doesn't fit above |

---

## B. Canonical expense category taxonomy (Schedule-C aligned)

`CANONICAL_CATEGORIES` (`app/src/import/category.ts`) — the ONE shared
constant every screen/dropdown/guesser reads from. `SCHEDULE_C_LINE`/
`scheduleCLineFor()` (same file, owner decision 2026-08-05, FULL PARITY
pass) maps each category to a Schedule C line for the Accountant Package —
informational only (CLAUDE.md invariant #8, "estimates only, not tax
advice"), not a filing determination.

| Category | Schedule C line | Deductibility note |
|---|---|---|
| Fuel & DEF | 22 | Fully deductible |
| Fuel Additives | 22 | Fully deductible — anti-gel, diesel treatment, cetane booster, injector cleaner; distinct from Fuel & DEF (pump diesel/DEF only) |
| Maintenance & Repairs | 21 | Fully deductible |
| Major Repairs & Overhauls | 21* | Fully deductible, but flagged "may be a capital improvement, confirm with your CPA" — a single invoice over $2,500 rebuilding a major component (engine in-frame, transmission, differential, cab, repaint) |
| Truck Parts | 21 | Fully deductible — a CONSUMED part the owner installs himself (alternator, belts, filters, etc.), distinct from Tools & Equipment (a reusable tool) |
| Tires | 21 | Fully deductible |
| Truck Wash & Detailing | 21 | Fully deductible |
| Truck/Trailer Payments | 20a | Loan **interest** deductible, principal is NOT; a lease payment is 100% deductible (leases and loans are different — a lease payment is never split) |
| Insurance—Truck | 15 | Fully deductible (liability, physical damage, cargo, bobtail, occ/acc) |
| Insurance—Health | — (Form 1040) | Health/medical insurance premiums — handled specially by the tax engine (`TaxEstimateInputs.healthInsurancePremiums`), an above-the-line adjustment, not a Schedule-C line item |
| Permits, Licenses & Road Taxes | 23 | IFTA, IRP, UCR, HVUT/Form 2290, BOC-3, CDL, DOT physical, state-specific permits (KYU, NY-HUT, NM-WDT, OR weight-mile tax) — fully deductible |
| Tolls & Scales | 27a | Fully deductible |
| Parking & Lodging | 24a | Fully deductible |
| ELD & Communications | 25 | ELD/e-log device + cab communications (phone, radio) + GPS/load-board services (owner decision 2026-08-05) — fully deductible |
| Software & Subscriptions | 25 | Fully deductible |
| Dispatch & Factoring Fees | 10 | Fully deductible |
| Legal & Professional Services | 17 | Renamed from `Professional Services` (owner decision 2026-08-05, Schedule C Line 17's official wording) — CPA, attorney, drug/alcohol testing consortium — fully deductible |
| Office & Admin | 18 | Fully deductible |
| Safety Gear & Workwear | 22 | Fully deductible for OTR-specific gear; see non-deductible traps below for everyday clothing |
| Truck Supplies & Equipment | 22 | Fully deductible |
| Tools & Equipment | 22 | Fully deductible — a reusable TOOL kept after the job |
| Electronics | 22 | Fully deductible (OTR sleeper-cab rule — CLAUDE.md's ported OTR-deductibility instruction) |
| Comfort & Sleeper | 22 | Fully deductible (same OTR sleeper-cab rule) |
| Warranty & Service Contracts | 27a | Fully deductible — an extended-warranty/service-contract PURCHASE (settlement code "EXTEND WR PURCH") |
| Lumper Fees | 27a | Fully deductible — including a settlement line coded "ADV FOR OUTSIDE LUMPER" (stays deductible despite the "ADV" wording — see §A.4 classifier order below) |
| Contract Labor (1099) | 11 | Fully deductible — feeds the 1099-NEC YTD tracker (`app/src/tax/driverPayroll.ts`) |
| Wages & Payroll Taxes (W-2) | 26 | Wages + employer-side payroll taxes fully deductible (`calcTrueCostOfEmployee()`) |
| Bank & Merchant Fees | 27a | Fully deductible |
| Advertising | 8 | Fully deductible |
| Training & Education | 27a | Fully deductible |
| Association Dues | 27a | Fully deductible (e.g. OOIDA membership) |
| Lease & Rent | 20b | Fully deductible (truck/trailer lease, parking, office) |
| Utilities & Subscriptions | 25 | Fully deductible |
| Misc | 27a | Fully deductible — catch-all for a real business expense that doesn't fit a more specific category |
| Other | 27a | Manual-entry / low-confidence catch-all (see docType `'other'`, CLAUDE.md invariant #14) — NEVER auto-assigned by `guessCategory()`, only ever a manual pick or an AI `suggestedCategory` string that happens not to match a canonical name |
| Meals (per diem covered) | — (excluded) | NOT deductible — restaurant/cafe/food-purchase lines (including a carrier POINT-OF-SALE meal charge) are covered by the per diem deduction already (CLAUDE.md invariant #9); `deductions.tax_deductible` defaults to `false` for this category but is a smart default, freely user-editable (owner decision 2026-07-17, mirrors web v2026.07.17-D) |
| Advance Repayment | — (excluded) | NOT deductible — loan principal (repaying a prior advance), same smart-default/editable treatment as Meals above (owner decision 2026-07-17, mirrors web v2026.07.17-D) |
| Escrow & Deposits | — (excluded) | NOT deductible — a performance bond/escrow reserve/tire fund/emergency fund/maintenance reserve is a REFUNDABLE DEPOSIT the carrier holds, never a real business cost; excluded from true profit (`src/stats/trueProfit.ts`) the same way Meals/Advance Repayment are, and tracked as a running "held by carrier" balance (`src/stats/escrowBalance.ts`) on the Settlements screen (owner decision 2026-08-02) |

Old app categories fold in as follows (renamed via the one-time migration,
docs/PENDING_SQL.md §40, owner decision 2026-08-05 — NOT left as free text
this time, since the accountant report groups by exact category string):
`Insurance` → `Insurance—Truck` · `Licensing & Permits` → `Permits, Licenses
& Road Taxes` · `Legal & Accounting Fees` and `Professional Services` →
`Legal & Professional Services` · `Truck Supplies` → `Truck Supplies &
Equipment` · `Safety Equipment` → `Safety Gear & Workwear` · `Fixed` and
`Variable` (the original single-user web app's 3-bucket expense
classification) → `Misc`. `Factoring Fees` (added 2026-07-10, universal AI
capture pass) → `Dispatch & Factoring Fees`. `Lease & Rent` and `Utilities &
Subscriptions` (also added 2026-07-10) match the canonical name exactly, no
rename needed. The canonical `Other` catch-all (CLAUDE.md invariant #14,
"never auto-assigned, only a manual pick") is deliberately NOT touched by
this migration — it stays a distinct, valid category from `Misc`.

---

## C. AI classification hints (brand/keyword → category)

Non-exhaustive examples wired into `guessCategory()` and the ai-import
prompt — the regexes are the actual source of truth; this table is a
human-readable index into them.

| Brand/keyword | Category |
|---|---|
| DAT, Truckstop.com, load board | Software & Subscriptions |
| Comdata, EFS (fuel cards) | Fuel & DEF |
| PrePass, EZPass, Drivewyze | Tolls & Scales |
| OOIDA | Association Dues |
| Gusto, ADP, Paychex | Wages & Payroll Taxes (W-2) |
| Triumph, RTS (factoring companies) | Dispatch & Factoring Fees |
| Motive, KeepTruckin, Samsara, Omnitracs, PeopleNet, Qualcomm | ELD & Communications |
| Anthropic, Claude, OpenAI, ChatGPT, GitHub, Google Workspace, Dropbox, iCloud, Microsoft 365 | Software & Subscriptions |

### NON-DEDUCTIBLE traps — the AI must flag, never silently deduct

These are common mistakes a driver might photograph expecting a deduction,
but they are NOT (fully) deductible. The AI flags them as
`"PERSONAL — REVIEW: "` (extends the NEEDS REVIEW convention, CLAUDE.md
invariant #14) rather than silently booking a full deduction:

- **Standard mileage rate** — never valid for a semi-truck (actual-expense
  method only; a receipt/note mentioning a per-mile deduction rate is a
  red flag, not a valid deduction basis).
- **Everyday clothing** — regular clothes are not deductible even for an
  OTR driver (contrast with Safety Gear & Workwear above, which covers
  PPE/OTR-specific gear, not everyday wear).
- **Commuting** — normal home-to-work travel is never deductible.
- **Security deposits** — a deposit (equipment, lease, utility) is not an
  expense until/unless forfeited.
- **Principal portions of loan payments** — only the interest portion of a
  Truck/Trailer Payment is deductible; the AI should note when a payment
  breakdown shows a principal/interest split rather than booking the full
  payment.

---

## A.4. Settlement-line classifier (owner decision 2026-08-05, FULL PARITY pass)

`classifySettlementLine()` (`app/src/import/category.ts`) is the ONE
ordered rule list `mapExtraction.ts`'s `mapSettlement()` reads a
settlement-withheld deduction line's category from — checked ahead of the
AI's own `chargebackType` classification and the older loose `category`
string, both of which remain as fallbacks. Written after a real device
statement's unmapped chargeback codes (EXTEND WR PURCH, ACCOUNTING SERV,
FED HWY TAX, QUAL/GEO RENTAL, EZ FAST LN, COMPANY STORE, WIRE CHARGE,
STATEMENT PREPARATION, ADV FOR OUTSIDE LUMPER, ...) all landed in "Misc"
with zero accountant-usable detail — an $18k Misc pile on one real account.

**ORDER MATTERS** — checked top to bottom, first match wins:
1. A LUMPER-shaped advance ("ADV FOR OUTSIDE LUMPER") stays deductible
   `Lumper Fees` — checked BEFORE the generic advance rule so the bare word
   "ADV" doesn't swallow it.
2. A plain/generic `ADVANCE`/`ADV` line is `Advance Repayment`
   (non-deductible loan principal) — this wins over the warranty rule: the
   ORIGINAL "EXTEND WR PURCH" line (the actual warranty purchase) is a real
   deductible expense, but a LATER "ADVANCE" line repaying it in
   installments is not a new expense.
3. Escrow/deposit, warranty purchase, accounting/legal service, insurance
   chargeback, highway tax/permits, ELD rental/nav charges, tolls/scales,
   company store, bank/wire/card charges, statement preparation, then
   (widest net, checked last) a restaurant/carrier-POS meal charge.

---

## D. Reimbursement vs. income rule

- A **carrier reimbursement** (`income_type: 'reimbursement'` — tolls,
  scales, washout, lumper, permits paid by the driver and paid back by the
  carrier) OFFSETS the matching expense category in a Schedule-C rollup —
  it is not itself a separate income line for tax purposes, it just nets
  against what was already spent.
- An **IFTA refund** (`income_type: 'ifta_refund'`) is INCOME — it is not
  netted against a fuel expense category, since IFTA tax paid was never
  booked as its own deductible line to net against in the first place.

This rule is consumed by the Accountant Package's per-category Schedule C
rollup (PROMPTS.md Session 9b) — not yet built; recorded here so that
whoever builds it doesn't have to re-derive the rule from first principles.

---

## Wiring status

- ✅ `app/src/import/category.ts` — `CANONICAL_CATEGORIES` + expanded
  `guessCategory()` (this pass).
- ✅ `supabase/functions/ai-import/index.ts` — settlement schema gains
  `incomeType`/`chargebackType` per line; compact classification
  instructions + hints + non-deductible-traps flagging (this pass).
- ✅ Settlement-withheld deduction rows: `chargebackType` maps to a display
  category via `CHARGEBACK_CATEGORY_LABEL` (`mapExtraction.ts`, this pass).
- 🚧 Settlement income lines (`revenueItems`): `incomeType` is extracted and
  audit-trailed (`documents.parsed_json`) but there is no dedicated income
  table to persist each line into yet — same "extraction now, ledger later"
  pattern as `government_or_misc_income` (PROMPTS.md "Supported document
  types" table). Persisting revenue lines with their `incomeType` is v1.x
  backlog.
- 🚧 Accountant Package per-category Schedule C rollup (reading both
  `deductions` AND `maintenance_records`/`fuel_purchases`/`loans` into one
  rollup, applying the reimbursement-offset rule) — PROMPTS.md Session 9b,
  not built yet.
- ✅ Meals & advance repayments (owner decision 2026-07-17, mirrors web
  v2026.07.17-D): restaurant-purchase detection (`isRestaurantPurchase()`)
  and the `advance_repayment` chargeback type both default
  `deductions.tax_deductible` to `false` via `defaultTaxDeductible()` — a
  smart default, not a lock; excluded from the tax engine, Accountant
  Package, and Dashboard deduction totals (`tax_deductible !== false`
  filter), but NOT from the Operating P&L (`profitLoss.ts`), which
  intentionally counts every real cash outflow including non-deductible
  ones. See CLAUDE.md invariant #1 and `app/src/import/category.ts`.
