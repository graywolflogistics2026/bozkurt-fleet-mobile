# Accountant Categories

> Category taxonomy and classification: canonical categories, unified classification path, the 16 accountant categories.
> Origin rule: only out-of-pocket rows may receive an `accountant_category`.
> Includes §67 retroactive re-classification (applied, owner confirmed 2026-10-13) and §75 mapping.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- FULL PARITY WITH WEB v2026.08.05-K, PART A — CATEGORY TAXONOMY (owner
  decision 2026-08-05, accounting-correctness + accountant-package pass —
  see PARTS B-G below for the rest of this multi-part pass).
  `app/src/import/category.ts` `CANONICAL_CATEGORIES` gains 6 new
  categories (Fuel Additives, Truck Parts, Major Repairs & Overhauls,
  Truck Wash & Detailing, Warranty & Service Contracts, Lumper Fees) and
  renames `Professional Services` → `Legal & Professional Services`
  (Schedule C Line 17's official wording) — old rows saved under either
  that or the even-older `Legal & Accounting Fees` are re-classified by a
  one-time SQL migration (docs/PENDING_SQL.md §40), a deliberate change
  from this taxonomy's previous "free text, no migration, old rows just
  display as-is" convention: the new Accountant Package groups/subtotals
  by EXACT category string, so a stale string would silently create an
  orphaned second bucket instead of rolling up with its renamed
  successor. The same migration folds the ORIGINAL single-user web app's
  `Fixed`/`Variable` 3-bucket classification into `Misc` — the CURRENT
  canonical `Other` catch-all is deliberately left untouched, since it's
  a distinct, valid, still-in-use category (CLAUDE.md invariant #14), not
  a legacy string being retired.
  CRITICAL BUG FIX: `supabase/functions/ai-import/index.ts`'s settlement
  deductions schema had a STALE, SHORTER category enum baked into its
  JSON-schema example string — 7 old values (`Software & Subscriptions|
  Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|
  Other`) that didn't even match the current `CANONICAL_CATEGORIES` the
  app's own picker reads from, meaning the AI could return (and did
  return) a category string the app doesn't recognize. Replaced with
  `CATEGORY_ENUM_STRING`, generated from the same canonical list
  (manually kept in sync — this Deno function can't import a TS module
  from `app/`, same constraint as every other "keep in sync" comment in
  that file; docs/INDUSTRY_TAXONOMY.md §B is the source of truth to check
  first).
  SETTLEMENT-LINE CLASSIFIER: a real device statement's unmapped
  chargeback codes (EXTEND WR PURCH, ACCOUNTING SERV, FED HWY TAX, QUAL/
  GEO RENTAL, EZ FAST LN, PRIME POINT-OF-SALE, COMPANY STORE, WIRE
  CHARGE, STATEMENT PREPARATION, ADV FOR OUTSIDE LUMPER) were all landing
  in "Misc" with zero accountant-usable detail — an $18k Misc pile on one
  real account. `classifySettlementLine()` (`category.ts`) is now the ONE
  ordered rule list `mapExtraction.ts`'s `mapSettlement()` reads a
  settlement-withheld deduction's category from, replacing the previous
  inline 3-branch ternary chain (isRestaurantPurchase → isEscrowDeposit →
  isInsuranceChargeback) with a fuller ordered list, checked ahead of the
  AI's own `chargebackType` and the older loose `category` string (both
  remain as fallbacks). ORDER MATTERS, and is now directly tested
  (`category.test.ts`): a LUMPER-shaped advance ("ADV FOR OUTSIDE
  LUMPER") is checked BEFORE the generic advance rule so the bare word
  "ADV" doesn't misclassify it as a repayment; a plain/generic `ADVANCE`
  line wins over the warranty rule (the ORIGINAL "EXTEND WR PURCH" line —
  the actual purchase — is a real deductible expense, but a LATER
  "ADVANCE" line repaying it in installments is not a new expense).
  Also added: `isFuelAdditive()`, `isTruckPart()` (a CONSUMED part —
  alternator, belts, filters — distinct from `Tools & Equipment`'s
  reusable TOOL), `isTruckWash()` (word-boundary-guarded so "windshield
  washer fluid" never false-hits), `isWarrantyService()`, `isLumperFee()`,
  `isGenericAdvance()`, `isMajorRepairOverhaul(text, amount)` (requires
  BOTH the >$2,500 threshold AND a major-component keyword — applied at
  `mapExtraction.ts`'s `mapPurchase()` call site, which has both a
  description and an amount, rather than inside `guessCategory()`, whose
  signature has no amount param), and `isLodging()` (extended for inn/
  lodge/Airbnb/truck-parking reservations, guarded so "Inner tube" never
  matches `\binn\b`). `guessCategory()` also gained a shop-invoice-with-
  labor rule (→ Maintenance & Repairs) and reclassified GPS/load-board
  brands (Garmin, DAT, Truckstop.com, "load board") from Software &
  Subscriptions to ELD & Communications per the spec's explicit "ELD/GPS/
  load board" grouping.
  SCHEDULE C LINE: `SCHEDULE_C_LINE`/`scheduleCLineFor()` (`category.ts`)
  maps every canonical category to a Schedule C line for the Accountant
  Package (informational only, CLAUDE.md invariant #8) — `Major Repairs &
  Overhauls` shares numeric line 21 with `Maintenance & Repairs` but
  carries its own footnoted `'21*'` value rather than silently blending
  into routine repairs; `Insurance—Health`/`Meals (per diem covered)`/
  `Advance Repayment`/`Escrow & Deposits` map to `null` (not a Schedule C
  line at all, or excluded entirely).
  Tests: `category.test.ts` gained coverage for every new detection
  function, `scheduleCLineFor()` across every canonical category, and
  `classifySettlementLine()`'s full code list plus both ORDER MATTERS
  cases (lumper-beats-generic-advance, generic-advance-beats-warranty).
  Full suite passes; `tsc --noEmit` clean. No new user-facing i18n
  strings were needed for this part — category names are domain values
  that stay English in every locale (CLAUDE.md invariant #11).

- UNIFIED CLASSIFICATION PATH + RETROACTIVE RE-CLASSIFICATION (owner
  decision, direct follow-up to the previous pass — "you found
  classifySettlementLine() and guessCategory() disagreeing... unify them
  into ONE classification path"). Full audit, not just the two named
  categories: read `app/src/import/category.ts` end to end and found the
  ELD/IRP divergence the owner reported was one of FIVE — Permits,
  Licenses & Road Taxes and ELD & Communications (the two named) plus
  three more nobody had reported yet: Tolls & Scales (guessCategory only
  matched "cat scale," missing classifySettlementLine's own bare
  `\bscale\b`), Bank & Merchant Fees (guessCategory had two extra terms,
  "overdraft"/"nsf fee," classifySettlementLine lacked), and Legal &
  Professional Services (classifySettlementLine's own ACCOUNTING_SERVICE_RE
  was deliberately much narrower than guessCategory's full legal/
  accounting term list).
  **UNIFICATION**: 4 of the 5 are now fully unified — each shared category
  gets exactly ONE exported detector function (`isPermitsOrRoadTax`/
  `isEldOrCommunications`/`isTollsOrScales`/`isBankOrMerchantFee`, each
  the UNION of whatever terms either function previously recognized on
  its own, so neither function loses coverage the other one already had)
  that BOTH `classifySettlementLine()` and `guessCategory()` now call —
  following the exact same `isXxx(text): boolean` pattern this file
  already used for `isInsuranceChargeback`/`isRestaurantPurchase`/
  `isWarrantyService`/`isLumperFee` (already correctly shared before this
  pass). This class of divergence — one function recognizing a term, the
  other silently not — cannot recur for any of these four.
  **THE ONE DELIBERATE, DOCUMENTED EXCEPTION**: Legal & Professional
  Services is NOT fully unified, and the reason was caught by this file's
  own existing test suite the instant the naive full unification was
  tried — `isLegalOrProfessionalServices()`'s broader guessCategory-side
  regex includes the bare words "accountant"/"accounting," and Prime
  Inc's own carrier-specific chargeback code is the literal text
  "ACCOUNTING SERV" (docs/CARRIER_CODES.md) — unifying the two functions
  naively made `classifySettlementLine('ACCOUNTING SERV')` return "Legal
  & Professional Services" instead of `null`, a direct violation of this
  file's own hard CARRIER ISOLATION invariant (a carrier's own internal
  abbreviated code text must never be recognized by the generic
  classifier — that's `carrier_code_maps`' job, scoped to the carrier
  that actually issued the statement). Fixed by keeping TWO functions:
  `isLegalOrProfessionalServices()` (unchanged, still used by
  `guessCategory()` — a standalone imported document CAN legitimately be
  titled "ABC Accounting Services") and a new
  `isLegalOrProfessionalServicesSettlementSafe()` (every term from the
  first EXCEPT "accountant"/"accounting," used ONLY by
  `classifySettlementLine()`). This is documented in `category.ts` itself
  as a genuine, deliberate exception — not a leftover divergence — since
  every OTHER shared category has no such carrier-code collision and IS
  fully unified.
  **TEST** (the explicit ask — "add a test asserting both entry points
  resolve the same description to the same category"):
  `src/import/__tests__/category.test.ts` gained a new "UNIFIED
  CLASSIFICATION PATH" describe block — 8 realistic descriptions (IRP,
  IFTA quarterly filing, HVUT payment, Form 2290, ELD FEE, Weigh station
  fee, Merchant fee, Bookkeeping service), each chosen to be unambiguous
  under BOTH functions' own different rule orderings, asserting
  `classifySettlementLine(desc) === guessCategory(desc, undefined) ===`
  the expected category for every one — plus a dedicated regression case
  reproducing the exact reported bug (`classifySettlementLine('IRP')`
  used to be `null` while `guessCategory('IRP', undefined)` was already
  correct; both now agree). The CARRIER ISOLATION regression this test
  run caught (`classifySettlementLine('ACCOUNTING SERV')` briefly
  resolving instead of staying `null`) is itself proof this test suite
  does what it's supposed to — it failed loudly the moment the wrong
  unification was tried, before it could ship.
  **RETROACTIVE RE-CLASSIFICATION** (the explicit third ask — "add a
  one-time migration that re-classifies existing rows currently sitting
  in Misc"): docs/PENDING_SQL.md §67 (mirrored as `pending_67.sql` at the
  repo root, **NOT YET APPLIED**) — a one-time DATA repair, no schema
  change. Hand-translates the same corrected regexes into PostgreSQL
  POSIX-ERE syntax (`\b` → `\y` for word boundaries) as one ordered CASE
  WHEN chain, scoped to `source = 'settlement' AND (category is null or
  category = 'Misc') AND description is not null` — deliberately narrow:
  never touches a row that already has a real category (including a
  DIFFERENT one the AI already got right the first time, or one a user
  manually corrected), and never touches an out-of-pocket 'Misc' row
  (those go through `guessCategory()`'s vendor/store-aware logic at
  import time, a different classifier this migration doesn't retroactively
  re-run). Includes a read-only PREVIEW query (old_category →
  new_category, row counts, dollar totals) to run and review BEFORE the
  actual UPDATE, and is safe to re-run — the UPDATE's own WHERE clause
  carries an `is distinct from category` guard so a second run finds
  nothing left to change. HONESTLY FLAGGED, same standing limitation as
  every other SQL migration in this codebase's history: assembled by
  hand-translating JS regexes into Postgres syntax, NOT executed against
  a live database in this environment (no service_role/db credentials
  here) — review the PREVIEW output carefully before running the UPDATE.
  Full suite: 118 suites / 3,036 tests pass (+9 new: 8 parity cases + 1
  regression case); `tsc --noEmit` clean. No Edge Function changes —
  every code fix in this pass is pure client-side JS/TS. Ships via a
  normal `eas update`; §67 itself needs to be run manually via the
  Supabase SQL Editor (PREVIEW first, then UPDATE) whenever convenient —
  it's a data-quality improvement for already-imported history, not
  something the app depends on to function correctly going forward.

- MAP EXISTING OUT-OF-POCKET DEDUCTIONS INTO THE 16 ACCOUNTANT CATEGORIES
  (owner decision 2026-09-17, "CRITICAL ACCURACY TASK," docs/PENDING_SQL.md
  §75, NOT YET APPLIED). A two-phase task, gated by an explicit owner
  review of the full mapping table BEFORE any code was written — the
  approved mapping below is final and binding.
  **THE ORIGIN RULE, the single most important constraint in this task,
  stated in the owner's own words and enforced literally**: a row is
  ONLY eligible for an `accountant_category` and ONLY eligible to ever
  appear on the "For Prime Inc Drivers" report if it is genuinely
  out-of-pocket. Category name and origin are two independent checks —
  origin is checked FIRST, alone, on every single row, no exceptions. A
  settlement-withheld "Truck Wash & Detailing" row must never receive an
  `accountant_category`, even though that category name maps to "Truck &
  Trailer Wash" below. Enforced by ONE function,
  `app/src/primeDriverExpenses/categoryMapping.ts`'s
  `isEligibleForAccountantReport(source)` — deliberately the exact same
  check `src/stats/accountantPackage.ts`'s own `matchesAccountantScope(
  origin, 'outOfPocket')` already established for its own out-of-pocket
  scope, proven identical by a dedicated test rather than merely
  described as such, so the two definitions of "out-of-pocket" can never
  silently drift apart. Per the owner's own explicit instruction, this
  is the VERY FIRST test in the new test suite
  (`src/primeDriverExpenses/__tests__/categoryMapping.test.ts`'s "THE
  ORIGIN RULE" describe block, its first `it()`): two rows both
  categorized "Truck Wash & Detailing" — one `source: 'settlement'`, one
  `source: 'manual'` — proving only the out-of-pocket one is ever
  eligible, before any other assertion in the file.
  **The approved mapping** (`CANONICAL_TO_ACCOUNTANT_CATEGORY`, one
  exported constant, every one of the 38 real `CANONICAL_CATEGORIES`
  values covered explicitly — even the unmapped ones, as `null`, so a
  future new canonical category with no corresponding entry is a
  detectable test failure, never a silent fallthrough):
  Fuel & DEF→Cash Fuel · Fuel Additives→Oil & Additives · Maintenance &
  Repairs/Major Repairs & Overhauls/Truck Parts/Tires→Repairs · Truck
  Wash & Detailing→Truck & Trailer Wash · Tolls & Scales→Cash
  Tolls/Parking Fees · Parking & Lodging→Lodging · ELD &
  Communications→Communication · Office & Admin→Office Supplies ·
  Safety Gear & Workwear→Safety/Weather Gear · Truck Supplies &
  Equipment/Tools & Equipment/Electronics/Comfort & Sleeper→Equipment/
  Operating Supplies · Lumper Fees→Lumpers · Bank & Merchant
  Fees→Bank/ATM Fees · Advertising→Advertising · Misc/Other→Misc ·
  everything else (Truck/Trailer Payments, Insurance—Truck,
  Insurance—Health, Permits Licenses & Road Taxes, Software &
  Subscriptions, Dispatch & Factoring Fees, Legal & Professional
  Services, Warranty & Service Contracts, Contract Labor (1099), Wages &
  Payroll Taxes (W-2), Training & Education, Association Dues, Lease &
  Rent, Utilities & Subscriptions, Meals (per diem covered), Advance
  Repayment, Escrow & Deposits) → unmapped (`null`). "Scales" and
  "Laundry/Showers" — 2 of the 16 accountant categories — have no
  canonical source mapping to them at all; reachable only via manual
  re-categorization or a direct `prime_driver_expenses` entry.
  **`deductions.accountant_category`** (new nullable column, §75) is a
  REPORTING LABEL ONLY — the exact same isolation guarantee §74 already
  established for `prime_driver_expenses`, extended to cover this field
  explicitly: never read by `computeKpis()`/`sumCanonicalExpenses()`/
  `calcCanonicalCpm()`/`buildTruckComparison()`/`buildLineItems()`
  (Accountant Package)/`calcTaxEstimate()`, proven by
  `primeDriverExpenses.test.ts`'s extended "CANONICAL ISOLATION" block —
  a live before/after test setting/changing `accountant_category` on
  real deduction rows and proving every canonical total stays byte-
  identical, plus the same source-file grep now also checking for the
  literal string `accountant_category` across every canonical file
  (widened to include `src/tax/perDiem.ts` too, for item 8 below).
  **AUTO-SUGGEST FOR EXISTING HISTORY, ALWAYS EDITABLE** (a deliberate,
  SCOPED exception to this codebase's own standing "never auto-assign,
  always a deliberate user choice" convention — the owner explicitly
  asked for accurate automatic placement across history, correctable
  afterward, not a blank slate): `findAccountantCategoryBackfillCandidates()`
  never touches a row that already has a non-null `accountant_category`
  (whether auto-set by an earlier run or manually corrected), and always
  re-checks origin first — safe to run any number of times, surfaced as
  a "🔄 Auto-fill N category suggestion(s)" button on the report itself
  whenever candidates exist. **New entries going forward** get the same
  suggestion applied immediately at save time (`suggestAccountantCategory()`,
  the ONE function every out-of-pocket deduction-insert call site uses):
  the settlement-withheld batch insert in `aiImportSave.ts` is
  deliberately NEVER touched by this (the origin rule's own "never set
  this field at all" for a withheld row); the standalone-purchase,
  generic-fallback, and financial-doc insert paths, plus Deductions'
  own manual add flow (a best-effort follow-up update, same precedent as
  that flow's existing receipt-attachment follow-up), all get it.
  **ZERO DUPLICATION** (item 5): the report's monthly view is the plain
  concatenation (`mergePrimeDriverExpenseRows()`) of two structurally
  DISJOINT sources — `prime_driver_expenses` rows (always manual, no
  origin concept) and eligible `deductions` rows
  (`eligibleDeductionRowsForReport()`, the origin check applied a SECOND
  time here as the report's own last line of defense even though every
  write path already enforces it) — there is no shared identity between
  the two tables for a real collision to occur, so "never both for the
  same real-world expense" is satisfied by clear UI labeling ("from
  Deductions, {{date}}" vs. a silent direct entry) rather than a
  de-duplication algorithm. **Delete consistency** (item 6): a
  deduction-sourced row's delete action on this screen calls the EXACT
  SAME path Deductions' own screen uses (`useDeleteDeduction` +
  `cleanupOrphanedDocument()` for its linked document, the linked
  `capital_transactions` row cascading automatically per CLAUDE.md
  invariant #5) — never a parallel, thinner delete — so it disappears
  from both screens immediately, live-read, no caching; a
  `prime_driver_expenses`-only row uses that table's own existing
  delete and only ever affects this report. **Category picker on this
  screen** (item 7) is the 16-value `PRIME_DRIVER_EXPENSE_CATEGORIES`
  list ONLY for a deduction-sourced row, never the 38-value canonical
  picker — editing it writes ONLY `accountant_category`, the real
  Schedule-C `category` is completely untouched (the edit sheet hides
  date/amount/note entirely for a deduction-sourced row, since those are
  managed on Deductions' own screen, this report only ever reads them).
  **DAYS AWAY FROM HOME OVERRIDE** (item 8): new `profiles.
  prime_driver_days_override` jsonb column, keyed `"YYYY-MM"` — the
  SAME "per-period user correction, one jsonb column" shape
  `profiles.cf_periodic_overrides` (§57) already established, reused
  rather than a dedicated table. Display-only for THIS report alone —
  `buildPrimeDriverExpenseMonth()`'s new optional 5th parameter is the
  ONLY way this value ever reaches anything, and neither
  `calcPerDiemDays()` nor `buildPerDiemBlock()` (Tax Estimator/the
  Accountant Package's own per-diem block) has any parameter to receive
  it at all — proven by the same source-grep (now covering
  `src/tax/perDiem.ts` too) plus a dedicated live-before/after isolation
  test. When unset, the auto-computed month figure shows with no
  indicator; when set, a small "✎ manually set" indicator plus a one-tap
  "↺ Reset to calculated value" action (clearing the key from the jsonb
  map) appears. `reset-data`'s `PROFILE_DATA_RESET` gained this new
  field in its CLEARED bucket (CLAUDE.md invariant #24's own rule: an
  unlisted new `profiles` column is silently KEPT, the wrong default for
  a per-report override tied to business data).
  Tests: `categoryMapping.test.ts` (new, 12 tests — the origin-rule test
  FIRST as instructed, the full 38-category mapping table pinned
  verbatim, the backfill's never-overwrite and idempotent-re-run
  guarantees). `primeDriverExpenses.test.ts` extended (8 new tests — the
  days-override display/flag behavior, `eligibleDeductionRowsForReport()`'s
  own origin enforcement, the zero-duplication union proof, the
  accountant_category isolation proof, the days-override isolation
  proof). Full suite: 136 suites / 3614 tests pass (+19); `tsc --noEmit`
  clean; all 7 locales confirmed key-parity (7 new
  `primeDriverExpenses.*` keys — es/ru/tr/hi/ar fully translated, uk as
  an untranslated English copy per invariant #11; glossary test
  re-passed clean). `docs/PENDING_SQL.md` §75 (mirrored as
  `pending_75.sql` at the repo root) is **NOT YET APPLIED** — until it's
  run, `accountant_category`/`prime_driver_days_override` writes fail
  cleanly against columns that don't exist yet (no crash — every write
  site already wraps its own best-effort follow-up in try/catch, same
  established convention as every other optional post-save enrichment in
  this codebase). No Edge Function was touched — no redeploy needed for
  `ai-import`/`ai-advisor`/`reset-data`(config-only column-list
  change)/`delete-account`/`referral-sync`. No new native dependency —
  ships via a normal `eas update` once §75 has been run.
