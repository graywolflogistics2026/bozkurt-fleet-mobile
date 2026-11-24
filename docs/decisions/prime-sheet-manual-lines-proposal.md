# For Prime Inc Drivers sheet: manual line choice instead of automatic Misc (proposal, 2026-11-24)

Status: PROPOSAL / DESIGN ONLY. Read-only investigation. No source code, SQL or deploy was changed. Revised 2026-11-24 to the owner's second, more detailed request; replaces the first version of this file.

## Owner's rule (in his words, summarized)

When an expense (for example a repair bill from a receipt) has an app category with NO matching line on the For Prime Inc Drivers sheet, the app must NOT silently put it in Misc. The user sees a notice and picks the correct sheet line manually.

The expense keeps its normal category everywhere else: Deductions, Home, Profit Analysis, Tax Estimator and the general Accountant Package. Only the placement on the Prime sheet is affected.

Hard constraints:
- No existing number anywhere changes unless the owner approves it after reading this.
- The Texas owner's numbers stay identical.
- Older app versions keep working.

---

## 1. Current mapping

### 1.1 The sheet lines

These are the lines exactly as the app defines them, in `app/src/primeDriverExpenses/categories.ts`, `PRIME_DRIVER_EXPENSE_CATEGORIES`, lines 17-34. They are fixed English text in every language.

1. Lumpers
2. Cash Tolls/Parking Fees
3. Scales
4. Equipment/Operating Supplies
5. Safety/Weather Gear
6. Cash Fuel
7. Oil & Additives
8. Truck & Trailer Wash
9. Repairs
10. Communication
11. Advertising
12. Office Supplies
13. Lodging
14. Laundry/Showers
15. Bank/ATM Fees
16. Misc

The database accepts only these 16 values in `deductions.accountant_category`, through a CHECK constraint (`docs/PENDING_SQL.md` §75). Direct entries on the sheet (`prime_driver_expenses.category`, §74) use the same list.

### 1.2 Repairs: verified from code

Repairs IS a real line (number 9). Three app categories map to it automatically (`app/src/primeDriverExpenses/categoryMapping.ts`, `CANONICAL_TO_ACCOUNTANT_CATEGORY`, lines 28-30):
- Maintenance & Repairs
- Major Repairs & Overhauls
- Truck Parts

So a repair bill saved as a deduction in one of those categories lands on Repairs today, not Misc.

A repair bill can still be missing from the sheet. If it was imported as a maintenance document, it is saved in the `maintenance_records` table, not in `deductions`, and the sheet never reads that table. Fuel receipts (`fuel_purchases`) and toll receipts (`tolls`) behave the same way. Those rows are absent from the sheet, not in Misc. See section 2.4.

### 1.3 Every app expense category and its sheet line today

The app's categories are `CANONICAL_CATEGORIES` in `app/src/import/category.ts`, lines 21-103. The mapping is `CANONICAL_TO_ACCOUNTANT_CATEGORY` in `categoryMapping.ts`, lines 25-67.

1. Fuel & DEF: Cash Fuel
2. Fuel Additives: Oil & Additives
3. Maintenance & Repairs: Repairs
4. Major Repairs & Overhauls: Repairs
5. Truck Parts: Repairs
6. Tires: no automatic line. It is "ambiguous": it waits in the sheet's existing "needs an accountant category" list with Repairs as the suggestion (`categoryMapping.ts` lines 157-160 and 206-218). It is not counted until the user picks a line.
7. Truck Wash & Detailing: Truck & Trailer Wash
8. Truck/Trailer Payments: none (not on the sheet)
9. Insurance—Truck: none
10. Insurance—Health: none
11. Permits, Licenses & Road Taxes: none
12. Tolls & Scales: Cash Tolls/Parking Fees
13. Parking & Lodging: Lodging
14. ELD & Communications: Communication
15. Software & Subscriptions: none
16. Dispatch & Factoring Fees: none
17. Legal & Professional Services: none
18. Office & Admin: Office Supplies
19. Safety Gear & Workwear: Safety/Weather Gear
20. Truck Supplies & Equipment: Equipment/Operating Supplies
21. Tools & Equipment: Equipment/Operating Supplies
22. Electronics: Equipment/Operating Supplies
23. Comfort & Sleeper: Equipment/Operating Supplies
24. Warranty & Service Contracts: no automatic line; ambiguous, like Tires (suggestion Repairs)
25. Lumper Fees: Lumpers
26. Contract Labor (1099): none
27. Wages & Payroll Taxes (W-2): none
28. Bank & Merchant Fees: Bank/ATM Fees
29. Advertising: Advertising
30. Training & Education: none
31. Association Dues: none
32. Lease & Rent: none
33. Utilities & Subscriptions: Communication
34. Meals (per diem covered): none
35. Advance Repayment: none
36. Escrow & Deposits: none
37. **Misc: Misc (automatic fallback)**
38. **Other: Misc (automatic fallback)**
39. A user's own custom category: none (it is not in the map, so it is not on the sheet)

Two lines have no source category at all: Scales and Laundry/Showers. They can only be reached by a manual pick or by a direct sheet entry (`categoryMapping.ts` lines 69-73).

"None" means the row is NOT on the sheet and not in Misc. `isInAccountantReportScope()` (`categoryMapping.ts` lines 181-186) drops it. This was the owner's own scope decision of 2026-09-23. Vehicle purchase, registration, title and plate rows are also dropped by description, even in Misc/Other (lines 162-170).

### 1.4 Which categories fall into Misc by fallback, and the code path

Only two app categories: **Misc** and **Other**. There is no other fallback into the Misc line.

How rows get there:

1. **Upstream, the app category itself falls back to Misc or Other.**
   - `guessCategory()` (`app/src/import/category.ts` line 621) ends with `return 'Misc'` (line 702) for any store or receipt item it does not recognise. This is the main source of Misc rows from receipts.
   - `mapGenericDeduction()` (`app/src/import/mapExtraction.ts`) uses "Other" for an unknown document with no suggested category, and for loan statements.
2. **The category becomes the sheet line.**
   - `suggestAccountantCategory(category, source)` (`categoryMapping.ts` lines 97-101) looks the category up in the map. Misc and Other return the line "Misc".
   - Its callers:
     - `saveExtraction()` in `app/src/data/aiImportSave.ts`: financial documents at about line 1019, store/Amazon lines at about 1086, the generic fallback at about 1202;
     - the lumper companion row in `mapExtraction.ts` (about line 366);
     - manual add on Deductions (`app/app/(tabs)/deductions.tsx` about lines 755-758).
3. **Old rows can get it through the backfill.** The "Auto-fill" button on the sheet (`app/app/(tabs)/more/prime-driver-expenses.tsx` lines 249-270) uses `findAccountantCategoryBackfillCandidates()` (`categoryMapping.ts` lines 138-146). It fills a blank `accountant_category`, so Misc/Other rows become Misc. It never overwrites a value that is already set.
4. **The sheet shows them under Misc.**
   - `eligibleDeductionRowsForReport()` (`app/src/stats/primeDriverExpenses.ts` lines 79-102) keeps out-of-pocket rows that have an `accountant_category`.
   - `buildPrimeDriverExpenseMonth()` (same file, lines 151-188) puts each row in its line and sums the 16 subtotals into the grand total.

Settlement rows never reach the sheet, in any category. This is the origin rule: `isEligibleForAccountantReport()` and `isOwnExpenseRow()`.

---

## 2. Impact if Misc/Other rows no longer went to Misc

### 2.1 What changes, for the two fallback categories

- **The sheet on screen:** Misc/Other rows without a picked line would be listed under "Needs your choice" instead of the Misc line. The Misc subtotal and the grand total would no longer include them until a line is picked. After a pick, the amount sits in the picked line.
- **The PDF and Excel export** (both are one HTML from `buildPrimeDriverExpenseReportHtml()`, `app/src/stats/primeDriverExpenseReport.ts` lines 51-110): same as the screen. To keep anything from disappearing, the export would print an "Unassigned — needs your choice" block under the 16 lines, outside the grand total (section 4).

### 2.2 Option (a): only rows created from now on

- Old rows keep their current line, Misc included. Nothing in the database is touched.
- **No existing number changes** on the sheet, in the PDF/Excel or anywhere else. The Texas owner's existing months stay identical.
- What changes going forward:
  - a NEW Misc/Other out-of-pocket expense is held out of its month's Misc subtotal and grand total until the user picks a line;
  - it is listed under "Needs your choice" and in the export's Unassigned block;
  - once picked, the chosen line's subtotal rises by that amount.

### 2.3 Option (b): all rows, old ones show "needs your choice" until picked

- Every old row with app category Misc or Other whose line is Misc would be shown as needing a choice.
- **Numbers change.** Every past month's Misc subtotal and grand total on the sheet and in the PDF/Excel drop by those amounts until each row is re-picked. That includes already-exported months, so a re-export would differ from what the accountant already has.
- **It cannot be done safely.** The app cannot tell an automatic Misc from a Misc the user picked on purpose: nothing records who set the value. Option (b) would also reopen deliberate choices.
- A softer variant (b'): show old Misc/Other rows with a "check this line" marker but KEEP them counted in Misc until the user changes them. No number changes, but it adds review work for old data.

### 2.4 Outside the sheet

Neither option changes anything outside the sheet. The sheet is isolated by design (`app/src/stats/primeDriverExpenses.ts` header, lines 12-29, and its CANONICAL ISOLATION test). Deductions, Home, KPIs/CPM, Profit Analysis, Cash Flow, Profit Audit, Tax Estimator and the general Accountant Package line items never read `accountant_category`.

### 2.5 Related gap, not part of either option

Maintenance, fuel and toll TABLE rows are never on the sheet. Bringing them in would ADD amounts to Repairs, Cash Fuel and Cash Tolls/Parking Fees and raise sheet totals. It needs its own owner decision, its own SQL on three tables and a double-count design against settlement-linked rows. It is listed here only so it is not mistaken for this change.

### 2.6 Recommendation: option (a)

- It is the only option that changes no existing number, so the Texas owner's sheet stays identical.
- It does not reopen deliberate choices the app cannot recognise.
- New items are never silent: they are counted nowhere on the sheet until picked, and listed both on screen and in the export.
- Variant (b') can be added later as a voluntary "check old Misc items" filter that changes nothing until the user acts.

---

## 3. Data model

### Where the choice is stored

In the existing column `deductions.accountant_category`. No new column is needed for the line itself, and the column already holds per-expense manual picks today.

### Default value and meaning

- **New Misc/Other out-of-pocket rows:** NULL. The change is in `suggestAccountantCategory()`: Misc and Other return null instead of "Misc", the same way Tires and Warranty already return null.
- **NULL on an in-scope out-of-pocket row means "needs your choice".** This is already how Tires and Warranty work (`findRowsNeedingAccountantCategory()`, `categoryMapping.ts` lines 206-218); the list is extended to Misc and Other.
- **Old rows:** keep their stored value (option a). An old row that is still NULL today shows up as "needs your choice". That is not a number change: a NULL row is not counted on today's sheet either.

### Older app versions

- **An older build that imports a new Misc/Other receipt** still writes "Misc" itself, because the old `suggestAccountantCategory()` does. That row is counted in Misc, exactly as today. This is a safe fallback, not a crash.
- **An older build that opens the sheet:** rows with a NULL line are not shown and not counted, exactly as old NULL rows behave today.
  - Its "Auto-fill" button WOULD fill such rows with Misc if the user taps it. That only fills blanks and is the old behaviour.
  - The new build shows the count and the list, so a NULL is never lost on a new build.
- **No column or constraint changes,** so nothing can fail on an old build.

### Migration

No SQL is needed for option (a).

Optional later, each needing its own PENDING_SQL section and owner approval:
1. **A "Not on this sheet" answer.** Add one allowed value to the CHECK constraint on `deductions.accountant_category`. The sheet would skip such rows on purpose, and the list stops asking.
2. **A record of who set the line.** A new nullable text column on `deductions`, for example `accountant_category_set_by`, with values `auto` or `user`; null for old rows means "unknown, treat as before". This would make a future (b') review exact. It is not needed for (a).
3. **Remember the user's last pick per app category or vendor,** as a pre-selected suggestion only. Store it either in a jsonb field on `profiles` (sorted into the CLEARED bucket of Reset All Data) or in a small new table that follows the full new-table checklist in CLAUDE.md. Never sent to the AI.

---

## 4. UX

### Where the notice appears

1. **The For Prime Inc Drivers page, top: "Needs your choice (N)".**
   - The existing needs list (`prime-driver-expenses.tsx` about lines 758-790), extended from Tires/Warranty to Misc and Other.
   - Each item shows its date, amount, description and Deductions category, with "Tap to choose a line".
   - It lists all months until picked.
2. **The featured For Prime Inc Drivers card on Accountant Package** (`app/app/(tabs)/more/accountant-package.tsx` lines 744-751). The fixed badge "Prime Inc" becomes an orange count ("3 need your choice") while items wait.
3. **The Deductions list.** Rows already show a chip with their sheet line (`app/app/(tabs)/deductions.tsx` lines 172-174). A row waiting for a choice gets an orange chip, "Prime sheet: needs a line". Tapping it opens the For Prime Inc Drivers page.
4. **The import review card after Yes.** A one-line note under the category, shown only when the chosen category is Misc or Other: "This will need a line on the For Prime Inc Drivers sheet."

### What the picker lists

Only the 16 real sheet lines from `PRIME_DRIVER_EXPENSE_CATEGORIES`, Misc included as a deliberate choice. Optionally "Not on this sheet" (needs the CHECK change). It reuses the existing picker sheet (`prime-driver-expenses.tsx` about line 1066 onward). Picking writes only `accountant_category`. The Deductions category is offered for sync only through the existing `offerCanonicalCategorySync()`, which asks first and never changes it silently.

### What the sheet shows for unpicked rows

- **On screen:** the "Needs your choice" block at the top, and a line under the grand total: "Not included: N expenses, $X, waiting for a line."
- **In the PDF/Excel:** an "Unassigned — needs your choice" block after the 16 lines listing each item with its amount. It is printed outside the grand total and clearly labeled, so the accountant sees what is pending and nothing disappears silently.
- **On export:** while items wait, one alert first: "3 expenses ($212.40) still need a line. Export anyway?" The answers are "Choose now" and "Export anyway".

### Required at import, or later?

**Recommendation: later, not required before Save.**
- The sheet is only used by Prime drivers. Asking every user for a Prime line on every Misc receipt would lengthen the import card for everyone.
- The new Yes/No step is already required. Adding another blocking choice makes blind taps more likely.
- Nothing is lost by deciding later: the row is listed, counted on the badge, and printed as Unassigned until picked.

The import card shows only the informational note from item 4 above.

---

## 5. Read-only SELECT (do NOT run before review)

It counts, per app category, the existing rows that currently land in Misc by fallback for the user with email alicembozkurt@gmail.com, with their total amount. The filters match the sheet: out-of-pocket only, not settlement-linked, not saved from a settlement's document. It writes nothing.

```sql
-- READ-ONLY. Review before running in the Supabase SQL Editor.
with u as (
  select id as uid from auth.users where email = 'alicembozkurt@gmail.com'
),
settlement_docs as (
  select s.document_id
  from settlements s, u
  where s.user_id = u.uid and s.document_id is not null
)
select coalesce(nullif(trim(d.category), ''), '(empty)') as app_category,
       count(*)                                          as rows_in_misc,
       round(sum(coalesce(d.amount, 0))::numeric, 2)      as total_amount
from deductions d, u
where d.user_id = u.uid
  and d.accountant_category = 'Misc'
  and coalesce(nullif(trim(d.category), ''), 'Misc') in ('Misc', 'Other')
  and coalesce(d.source, '') <> 'settlement'
  and d.settlement_id is null
  and (d.document_id is null or d.document_id not in (select document_id from settlement_docs))
group by 1
order by total_amount desc;
```

Notes:
- It does not apply the vehicle registration/title/plate text filter (`categoryMapping.ts` lines 162-170). A row whose description is a registration, title or plate is counted here but is not on the sheet. The difference is usually zero or small.
- **It cannot separate automatic Misc from Misc the user picked on purpose.** Nothing records that.
- Rows whose app category is mapped to a real line but whose line was changed to Misc by hand are excluded on purpose, since they are not fallbacks.
- If `auth.users` returns no row for that email, the query returns nothing (no error).

---

## 6. Plan

### Files that would change (option a)

1. `app/src/primeDriverExpenses/categoryMapping.ts`
   - `CANONICAL_TO_ACCOUNTANT_CATEGORY`: Misc and Other become null.
   - Add Misc and Other to the "needs a line" set next to `AMBIGUOUS_ACCOUNTANT_CATEGORIES`, with no suggestion, so `isInAccountantReportScope()` keeps them in scope.
   - `findAccountantCategoryBackfillCandidates()` then never proposes Misc for them.
2. `app/src/stats/primeDriverExpenses.ts`: `buildPrimeDriverExpenseMonth()` also returns the month's unassigned rows and their sum, outside `grandTotal`.
3. `app/src/stats/primeDriverExpenseReport.ts`: the Unassigned block in the shared PDF/Excel HTML.
4. `app/app/(tabs)/more/prime-driver-expenses.tsx`: the extended "Needs your choice" list (no suggestion line for Misc/Other), the "Not included" line under the total, and the export alert.
5. `app/app/(tabs)/more/accountant-package.tsx`: the count badge on the featured card.
6. `app/app/(tabs)/deductions.tsx`: the orange "needs a line" chip.
7. `app/app/(tabs)/import/index.tsx` or `app/src/components/ExpenseDeductibleChoice.tsx`: the one-line note after Yes for Misc/Other.
8. The 7 locale files.

No change in `aiImportSave.ts` itself: it already calls `suggestAccountantCategory()`. No Edge Function and no SQL.

### Tests

- **Change:**
  - `app/src/primeDriverExpenses/__tests__/categoryMapping.test.ts`: the mapping table at lines 114-115 (Misc/Other to null), the backfill expectations and the needs-list cases.
  - Any import test expecting `accountant_category` "Misc" on a Misc row. The pinned Yes row in `aiImportSave.expenseDecision.test.ts` is Equipment/Operating Supplies and stays unchanged.
- **Add:**
  - Old rows already in Misc keep their line and every subtotal/grand total is byte-identical. This is a golden month built from fixtures, the proof for "no existing number changes".
  - A new Misc/Other row is NULL, listed as needing a choice, and outside the grand total.
  - After a pick it is counted in the picked line.
  - The export HTML contains the Unassigned block, outside the grand total.
  - Settlement and settlement-document rows never appear in the needs list (origin rule).
  - Vehicle registration rows stay excluded.
- **Must stay green:** the screen-reading tests `estimateNotice.test.ts`, `descriptionText.test.ts` and `scanCore.test.ts`; the CANONICAL ISOLATION test; the golden settlement tests.

### i18n keys (all 7 locales; es/ru/tr/hi translated, ar/uk English)

Sheet line names stay English everywhere (fixed template text).

1. `primeDriverExpenses.needsCategory.title` / `body`: reworded to cover Misc/Other ("needs a line on this sheet"); existing keys.
2. `primeDriverExpenses.unassigned.totalNote`: "Not included: {{count}} expenses, {{amount}}, waiting for a line"
3. `primeDriverExpenses.unassigned.exportTitle`: "Unassigned — needs your choice"
4. `primeDriverExpenses.unassigned.exportWarnTitle` / `exportWarnBody` / `chooseNow` / `exportAnyway`
5. `accountantPackage.primeDriversNeedsChoice`: "{{count}} need your choice"
6. `deductions.primeLineNeeded`: "Prime sheet: needs a line"
7. `importScreen.deductChoice.primeLineNote`: "This will need a line on the For Prime Inc Drivers sheet."

### Risks

- **An older build** writes Misc for new Misc/Other rows, and its Auto-fill button can fill NULL rows with Misc. This is the old behaviour and harmless, but not "never Misc" until every phone runs the new build.
- **A new receipt's amount moves out of the Misc subtotal** until it is picked. This is intended and visible, but it changes the CURRENT month's sheet compared with today's logic. It is a forward-looking change; no existing row is affected.
- **Wrong scope filter:** if the needs list did not use the same origin rule as the sheet, a settlement row could appear. The tests above cover it.
- **The maintenance/fuel/toll table gap stays** until a separate decision (section 2.5).

### Stage plan (small commits, each checkable on the phone)

Each stage: tsc, full jest, its own ship list, `eas update` only.

1. **Mapping and needs list.** Misc/Other become NULL for new rows; the list on the For Prime Inc Drivers page shows them; the golden "old months identical" test. Phone: import one unknown-item receipt, answer Yes, and see it under Needs your choice and not in Misc. Old months unchanged.
2. **Totals and export.** The "Not included" line and the Unassigned block in the PDF/Excel. Phone: export a month with one waiting item; the block is outside the total.
3. **Notices elsewhere.** The featured-card count badge, the Deductions chip and the import-card note. Phone: see the badge count fall after picking.
4. **Optional, each only after an owner decision:** the "Not on this sheet" answer (PENDING_SQL CHECK change); remembered picks (PENDING_SQL); the (b') old-Misc review filter; the maintenance/fuel/toll design.

Ship list for this document: none (docs only; no SQL, no Edge Function, no eas update).
