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
| `escrow_reserve` | Escrow/reserve account contribution |
| `lease_purchase_payment` | Truck lease-purchase payment (owner-operators leasing FROM the carrier) |
| `trailer_fee` | Trailer rental fee charged BY the carrier |
| `cash_advance` | A cash advance, deducted back |
| `loan_payment` | A loan payment routed through the settlement |
| `drug_consortium` | DOT drug/alcohol testing consortium fee |
| `tolls_transponder` | Toll transponder fee/rental |
| `admin_processing_fee` | Generic administrative/processing fee |
| `factoring_fee` | Factoring company's fee/discount |
| `dispatch_fee` | Dispatch service fee |
| `other_chargeback` | Anything else clearly a chargeback that doesn't fit above |

---

## B. Canonical expense category taxonomy (Schedule-C aligned)

`CANONICAL_CATEGORIES` (`app/src/import/category.ts`) — the ONE shared
constant every screen/dropdown/guesser reads from. Supersedes the smaller
pre-2026-07-10 list; old category strings already saved on existing rows
are left as-is (free text, no migration) and still display fine.

| Category | Deductibility note |
|---|---|
| Fuel & DEF | Fully deductible |
| Maintenance & Repairs | Fully deductible |
| Tires | Fully deductible |
| Truck/Trailer Payments | Loan **interest** deductible, principal is NOT; a lease payment is 100% deductible (leases and loans are different — a lease payment is never split) |
| Insurance—Truck | Fully deductible (liability, physical damage, cargo, bobtail, occ/acc) |
| Insurance—Health | Health/medical insurance premiums — handled specially by the tax engine (`TaxEstimateInputs.healthInsurancePremiums`), not a flat Schedule-C line item |
| Permits, Licenses & Road Taxes | IFTA, IRP, UCR, HVUT/Form 2290, BOC-3, CDL, DOT physical, state-specific permits (KYU, NY-HUT, NM-WDT, OR weight-mile tax) — fully deductible |
| Tolls & Scales | Fully deductible |
| Parking & Lodging | Fully deductible |
| ELD & Communications | ELD/e-log device + cab communications (phone, radio) — fully deductible |
| Software & Subscriptions | Fully deductible |
| Dispatch & Factoring Fees | Fully deductible |
| Professional Services | CPA, attorney, drug/alcohol testing consortium — fully deductible |
| Office & Admin | Fully deductible |
| Safety Gear & Workwear | Fully deductible for OTR-specific gear; see non-deductible traps below for everyday clothing |
| Truck Supplies & Equipment | Fully deductible |
| Tools & Equipment | Fully deductible |
| Electronics | Fully deductible (OTR sleeper-cab rule — CLAUDE.md's ported OTR-deductibility instruction) |
| Comfort & Sleeper | Fully deductible (same OTR sleeper-cab rule) |
| Contract Labor (1099) | Fully deductible — feeds the 1099-NEC YTD tracker (`app/src/tax/driverPayroll.ts`) |
| Wages & Payroll Taxes (W-2) | Wages + employer-side payroll taxes fully deductible (`calcTrueCostOfEmployee()`) |
| Bank & Merchant Fees | Fully deductible |
| Advertising | Fully deductible |
| Training & Education | Fully deductible |
| Association Dues | Fully deductible (e.g. OOIDA membership) |
| Lease & Rent | Fully deductible (truck/trailer lease, parking, office) |
| Utilities & Subscriptions | Fully deductible |
| Misc | Fully deductible — catch-all for a real business expense that doesn't fit a more specific category |
| Other | Manual-entry / low-confidence catch-all (see docType `'other'`, CLAUDE.md invariant #14) — NEVER auto-assigned by `guessCategory()`, only ever a manual pick or an AI `suggestedCategory` string that happens not to match a canonical name |

Old app categories fold in as follows (renamed, not duplicated):
`Insurance` → `Insurance—Truck` · `Licensing & Permits` → `Permits, Licenses
& Road Taxes` · `Legal & Accounting Fees` → `Professional Services` ·
`Truck Supplies` → `Truck Supplies & Equipment` · `Safety Equipment` →
`Safety Gear & Workwear` · `Factoring Fees` (added 2026-07-10, universal AI
capture pass) → `Dispatch & Factoring Fees`. `Lease & Rent` and `Utilities &
Subscriptions` (also added 2026-07-10) match the canonical name exactly, no
rename needed.

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
