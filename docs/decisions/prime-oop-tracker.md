# Prime Oop Tracker

> "For Prime Inc Drivers" out-of-pocket expense tracker (owner decision 2026-09-17, §74).
> Utilities mapping, the "needs a category" list, and the explicit screen-scope allowlist.
> Carrier-isolated: Prime-only screen and labels.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner decision
  2026-09-17, docs/PENDING_SQL.md §74, NOT YET APPLIED). A brand-new,
  standalone screen — `app/(tabs)/more/prime-driver-expenses.tsx`, nav
  label "For Prime Inc Drivers" (`nav.primeDriverExpenses`, Tools group,
  `navRegistry.ts`) — that exists ONLY to match the exact monthly
  out-of-pocket expense report format the user's accountant already
  works from. This is deliberately NOT a change to Deductions/Schedule-C
  — it's independent manual entry into a brand-new table, `src/stats/
  primeDriverExpenses.ts`'s own header comment carries the full
  isolation guarantee.
  **Schema**: `prime_driver_expenses` (`id`, `user_id ... on delete
  cascade`, `exp_date date not null`, `amount numeric(12,2) not null`,
  `category text not null check (category in (<16 fixed values>))`,
  `note`, `document_id ... on delete set null`, `created_at`) — RLS
  owner-only on all 4 operations, same pattern every other user-scoped
  table in `docs/SCHEMA.sql` already uses. `category` is one of 16
  FIXED, accountant-mandated values (`app/src/primeDriverExpenses/
  categories.ts`'s `PRIME_DRIVER_EXPENSE_CATEGORIES` — Lumpers / Cash
  Tolls-Parking Fees / Scales / Equipment-Operating Supplies /
  Safety-Weather Gear / Cash Fuel / Oil and Additives / Truck and
  Trailer Wash / Repairs / Communication / Advertising / Office
  Supplies / Lodging / Laundry-Showers / Bank-ATM Fees / Misc) — a
  deliberately SEPARATE vocabulary from `CANONICAL_CATEGORIES`, never
  merged with it. These 16 labels stay in plain English in every locale
  (never `t()`-driven) — same "domain values stay English" treatment as
  the 9 fixed payment-method strings, since an accountant working from a
  fixed English template needs the exact same words regardless of the
  app's own display language.
  **Isolation (item 6, the hard requirement), proven three ways** —
  `src/stats/__tests__/primeDriverExpenses.test.ts`'s "CANONICAL
  ISOLATION" block: (1) a literal source-grep of `kpi.ts`/`trueProfit.ts`/
  `cpm.ts`/`truckComparison.ts`/`accountantPackage.ts`/`taxEstimate.ts`
  confirming zero references to `prime_driver_expenses`/
  `PrimeDriverExpense`/`primeDriverExpenses` by name — a real regression
  guard, not a comment: a future edit that wires this table into any of
  those files fails this test immediately; (2) a realistic settlement+
  deduction dataset run through `computeKpis()`/`sumCanonicalExpenses()`/
  `calcCanonicalCpm()`/`buildTruckComparison()` proven BYTE-IDENTICAL
  before and after several hundred dollars of `prime_driver_expenses`
  rows "exist" on the same account (they're never fetched into any of
  those functions' own input arrays — there's no mechanism to); (3) a
  TYPE-LEVEL proof — a `@ts-expect-error` directive asserting that
  `KpiInputs` (the sealed input shape `computeKpis()` takes) has no field
  for this data TODAY; if a future edit ever widened `KpiInputs` to
  accept it, the directive itself would become an "unused ts-expect-error"
  compile error, failing the test — a structurally enforced guarantee,
  not an assumption.
  **Monthly view**: `src/stats/primeDriverExpenses.ts`'s
  `buildPrimeDriverExpenseMonth(rows, settlements, year, month)` — all 16
  categories render as their own section, in the fixed order, EVEN WHEN
  a category has zero entries that month (a real, tested $0 subtotal,
  never a hidden row — matches the accountant's own blank-template
  layout). "Days Away From Home" reads the EXISTING per-diem day count
  (`src/tax/perDiem.ts`'s `calcPerDiemDays()`, CLAUDE.md invariant #9's
  own deterministic day-counting rule) scoped to the selected month's own
  settlement weeks — never a second, independently-computed day count,
  and read-only on this screen by construction (this function has no way
  to write back to `settlements.per_diem_days`). Editing a row's
  `exp_date` "moves it to the correct month automatically" because the
  month view is always derived LIVE from each row's own date, never a
  per-month cache — proven directly by a dedicated test moving a row
  across a June/July boundary and confirming both months' totals update
  correctly.
  **Export**: `src/stats/primeDriverExpenseReport.ts`'s
  `buildPrimeDriverExpenseReportHtml()` + `buildPrimeDriverExpenseReportFilename()`
  — a SEPARATE, standalone module from `accountantPackageReport.ts`'s own
  `buildAccountantReportHtml()`/`buildAccountantReportFilename()`, never
  modifying or calling into that module, but mirroring its established
  conventions exactly: one shared HTML template for both the PDF
  (`expo-print`) and Excel (`.xls`-extension trick) exports so the two can
  never visually disagree, pure/zero-React/Expo/i18next (every string
  already resolved by the caller via `t()`), money/date passed in as
  plain formatter functions. Filenames follow the same fixed-English-
  month-slug convention (`prime-driver-expenses-june-2026.pdf`) for the
  same "a shared/downloaded file's name stays portable across locales"
  reason. No new native dependency — reuses the exact `expo-print`/
  `Sharing`/`expo-file-system` pattern the Accountant Package screen
  already has.
  **Legal disclaimer (item 7)**: a NEW, deliberately different
  disclaimer from the existing tax-estimate one (invariant #8's
  "Estimates only — not tax advice" is about a computed TAX FIGURE; this
  one is about RECORD-KEEPING ACCURACY) — `primeDriverExpenses.disclaimer`,
  all 7 locales: "This tool is provided to help organize your own
  records. It does not verify, audit, or guarantee the accuracy of any
  entry — you're solely responsible for what you enter here and for how
  it's used in your tax filings. This is not accounting, tax, or legal
  advice — consult a qualified CPA or tax professional." Rendered via the
  EXISTING `LegalFootnote` component (`src/components/ui.tsx`), which
  already accepted a `children` override before this pass (confirmed by
  reading it first, no prop addition needed) — shown near the top of the
  screen and repeated verbatim in both exports.
  **Attachment**: `app/src/primeDriverExpenses/attachment.ts`'s
  `buildPrimeDriverExpenseAttachmentPath()` + `app/src/data/
  primeDriverExpenseAttachment.ts`'s `uploadPrimeDriverExpenseAttachment()`
  mirror the Deductions manual-attachment pattern (SIMPLIFICATION PASS,
  above) exactly — its own `{user_id}/PrimeDriverExpenses/...` Storage
  folder, kept separate from Deductions' own `Receipts` folder so the two
  screens' attachments never collide.
  **The standing 4-point new-table checklist**: `reset-data`'s
  `TABLES_IN_DELETION_ORDER` (explicit entry needed — it never deletes
  the auth user); `queryInvalidation.ts`'s `AFFECTED_TABLES`;
  `exportAllData.ts`'s `EXPORT_TABLES` (this is genuinely real,
  user-entered financial data, unlike `ai_usage_log`/`import_jobs`,
  which are deliberately excluded as transient telemetry/job state).
  `delete-account` needs NO explicit entry — `user_id ... on delete
  cascade` handles it automatically (same `import_jobs`/
  `ai_credit_purchases` precedent). Also added to `src/alerts/
  dailyTips.ts`'s `DAILY_TIP_SCREEN_COVERAGE` map as `'intentionalNone'`
  (a niche, accountant-specific tool with nothing to nudge about day to
  day, same treatment as Referral/Data Cleanup) — this codebase's own
  existing coverage-completeness test would otherwise fail the moment
  this route exists.
  Tests: `src/primeDriverExpenses/__tests__/categories.test.ts` (the
  fixed 16-value list, order, and the `isPrimeDriverExpenseCategory()`
  guard — `jest.config.js`'s `testMatch` gained a new
  `src/primeDriverExpenses/**/*.test.ts` entry, previously unlisted,
  same class of gap this codebase has hit for `analytics`/`launch`/
  `onboarding` before); `src/stats/__tests__/primeDriverExpenses.test.ts`
  (monthly grouping/subtotal/$0-never-hidden, grand total, Days Away
  From Home, the edit-moves-month proof, and the full 3-part canonical
  isolation block above); `src/stats/__tests__/primeDriverExpenseReport.test.ts`
  (header identity, all 16 sections present even when empty, the grand
  total, the disclaimer text, HTML-escaping, and the filename builder).
  Full suite: 135 suites / 3595 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (es/ru/tr/hi/ar fully translated, uk as an
  untranslated English copy per invariant #11 — the 16 category labels
  themselves are plain English literals in every locale, never
  translation keys, per this entry's own "domain values stay English"
  note above; glossary test re-passed clean).
  **Stated limitation**: `docs/PENDING_SQL.md` §74 (mirrored as
  `pending_74.sql` at the repo root) is **NOT YET APPLIED** — inserts
  will fail against a table that doesn't exist yet until it's run via
  the Supabase SQL Editor. No Edge Function was touched this pass — no
  redeploy needed for `ai-import`/`ai-advisor`/`reset-data`/
  `delete-account`/`referral-sync` (this is a pure manual-entry feature,
  no AI extraction involved). No new native dependency — ships via a
  normal `eas update` once §74 has been run.

- "FOR PRIME INC DRIVERS" — UTILITIES MAPPING + "NEEDS A CATEGORY" LIST
  (owner decision 2026-09-23, scoped to this screen and accountant_category
  only). 'Utilities & Subscriptions' -> 'Communication' in
  CANONICAL_TO_ACCOUNTANT_CATEGORY; existing blank out-of-pocket Utilities
  rows are filled automatically the first time the screen sees them (never
  overwriting a hand-set value). Note the mapping is shared: the importer
  (aiImportSave.ts) and the Deductions screen's Add also call
  suggestAccountantCategory() at insert, so NEW Utilities rows get
  'Communication' too — still only accountant_category, which nothing but
  this report reads. findRowsNeedingAccountantCategory() lists every
  out-of-pocket row with no accountant_category whose canonical category has
  no mapping (incl. custom/null categories), across all months, on every
  visit until one of the 16 is picked (a one-tap picker that writes ONLY
  accountant_category). Mapped-but-blank rows stay the Auto-fill button's
  job. The Deductions screen, deductions.category, and every
  profit/tax/CPM/Accountant Package number are untouched (canonical source
  audit in primeDriverExpenses.test.ts still guards this).

- "FOR PRIME INC DRIVERS" SCREEN SCOPE — EXPLICIT ALLOWLIST (owner decision
  2026-09-23; SUPERSEDES the broad "needs a category" list in the entry
  above). The screen is a cash expense record for exactly two things:
  out-of-pocket expenses that genuinely belong in the 16 accountant
  categories, and Prime settlement lumpers (report-only exception,
  untouched). AMBIGUOUS_ACCOUNTANT_CATEGORIES (categoryMapping.ts) is the
  ONLY source of "needs a category" rows: Tires -> suggest Repairs, Warranty
  & Service Contracts -> suggest Repairs; neither is auto-mapped (Tires was
  Repairs before; existing Tires rows already holding Repairs keep it —
  never overwritten). isInAccountantReportScope(): a deduction row reaches
  the report or the needs list only if its canonical category is auto-mapped
  or allowlisted AND its description isn't a vehicle purchase
  (isVehiclePurchaseOneOff) or registration/title/plate fee (those are
  Asset Register items). Everything else — Insurance, Permits, Software,
  Dispatch, Legal, Contract Labor, Wages, Training, Association Dues, Lease,
  Meals, Advance Repayment, Escrow, Truck/Trailer Payments, custom and
  missing categories — is never shown on this screen, even with an
  accountant_category already set. Direct prime_driver_expenses rows (the
  screen's own Add Expense) are not filtered. Still writes only
  accountant_category; Deductions and all canonical numbers untouched.
