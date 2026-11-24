# For Prime Inc Drivers sheet: the user picks the line, never an automatic Misc (2026-11-24)

Status: PROPOSAL. Read-only investigation: no code, SQL or deploy was changed.

## Owner request (summary)

On the For Prime Inc Drivers sheet (the Abacus-format monthly out-of-pocket sheet opened from Accountant Package), an expense whose app category has no matching sheet line must NOT be put into Misc silently.

- The expense keeps its normal app category everywhere else: Deductions, profit, KPIs and tax do not change.
- On the sheet the user sees a notice and picks the line by hand. Nothing goes to Misc automatically.

The owner's example is a Repair/Maintenance bill. Requested: today's mapping with file:line, where a manual choice can be stored, a notification design, which numbers change, a read-only SELECT, and how this interacts with the new import Yes/No.

## Short answer

1. **Repair example: there is a Repairs line.**
   - Deductions in "Maintenance & Repairs", "Major Repairs & Overhauls" or "Truck Parts" already map to Repairs automatically (`app/src/primeDriverExpenses/categoryMapping.ts:28-30`).
   - What the owner most likely saw is different: a repair bill imported as a **maintenance document** is saved in `maintenance_records`, not `deductions`. The sheet never reads `maintenance_records`, `fuel_purchases` or `tolls` at all, so that bill is **missing** from the sheet. It is not in Misc.
2. **Silent Misc today comes from exactly one route.** It is a deduction whose app category is "Misc" or "Other" (`categoryMapping.ts:65-66`).
   - The most common source is a store or receipt item that the keyword guesser does not recognise. It falls back to the app category "Misc" (`app/src/import/category.ts:702`), and that maps straight to the sheet's Misc line.
3. **Other expenses are silently left off the sheet, not put in Misc:**
   - app categories mapped to `null` (Insurance, Permits, Software, Dispatch, Legal, Contract Labor, Wages, Training, Association Dues, Lease, Meals, Advance Repayment, Escrow, Truck/Trailer Payments);
   - custom user categories;
   - vehicle purchase and registration rows (`categoryMapping.ts:172-186`);
   - all maintenance, fuel and toll table rows.

   The first two groups are excluded on purpose (owner decision 2026-09-23). The table rows are a gap the owner should decide on (section 6).

## 1. How the sheet works today

### Sheet lines

There are 16 fixed lines, in English in every language (`app/src/primeDriverExpenses/categories.ts:17-34`):

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

The same 16 values are a CHECK constraint on `deductions.accountant_category` and on `prime_driver_expenses.category` (`docs/PENDING_SQL.md` §75, around line 4451; §74).

### App category to sheet line

From `CANONICAL_TO_ACCOUNTANT_CATEGORY`, `categoryMapping.ts:25-67`:

| App category | Sheet line |
| --- | --- |
| Fuel & DEF | Cash Fuel |
| Fuel Additives | Oil & Additives |
| Maintenance & Repairs, Major Repairs & Overhauls, Truck Parts | Repairs |
| Truck Wash & Detailing | Truck & Trailer Wash |
| Tolls & Scales | Cash Tolls/Parking Fees |
| Parking & Lodging | Lodging |
| ELD & Communications, Utilities & Subscriptions | Communication |
| Office & Admin | Office Supplies |
| Safety Gear & Workwear | Safety/Weather Gear |
| Truck Supplies & Equipment, Tools & Equipment, Electronics, Comfort & Sleeper | Equipment/Operating Supplies |
| Lumper Fees | Lumpers |
| Bank & Merchant Fees | Bank/ATM Fees |
| Advertising | Advertising |
| **Misc and Other** | **Misc (automatic)** |
| Tires, Warranty & Service Contracts | No automatic line ("ambiguous"). Listed in the existing "needs an accountant category" list with a suggested Repairs (`categoryMapping.ts:157-160`, `206-218`). |
| Every other app category, and custom categories | `null`: not on the sheet at all (`categoryMapping.ts:181-186`). |

Scales and Laundry/Showers have no source category. They are only reachable by a manual pick or by a direct sheet entry (`categoryMapping.ts:69-73`).

### Who writes `accountant_category`

`suggestAccountantCategory()` (`categoryMapping.ts:97-101`) is called:

- by every out-of-pocket import insert: financial documents at `app/src/data/aiImportSave.ts:1019`, store and Amazon lines at `:1086`, and the generic fallback at `:1202`;
- by the lumper companion row (`app/src/import/mapExtraction.ts:366`);
- by manual add on Deductions (`app/app/(tabs)/deductions.tsx:755-758`).

On the sheet screen (`app/app/(tabs)/more/prime-driver-expenses.tsx`) it is written by:

- the "Auto-fill" backfill button (`:249-270`, `findAccountantCategoryBackfillCandidates()`, `categoryMapping.ts:138-146`). It fills only blank values, and Misc/Other rows become Misc.
- an automatic, silent fill of Utilities to Communication (`:278-297`);
- the needs list pick (`:311-320`) and the row edit (`:561-582`).

The last two offer to sync the Deductions category through `offerCanonicalCategorySync()`. That sync is never silent.

### Rows on the sheet

`eligibleDeductionRowsForReport()` (`app/src/stats/primeDriverExpenses.ts:79-102`) keeps a deduction only if all of these hold:

- it is not from a settlement and passes the same own-expense rule as Home (`isOwnExpenseRow`);
- it has an `accountant_category`;
- its app category is in scope.

Direct sheet entries (`prime_driver_expenses` table) are added on top (`primeDriverExpenses.ts:144-146`). A deduction with no `accountant_category` is never shown and never counted. The only exception is the Tires/Warranty needs list, which is shown but not counted.

### Totals and exports

- **Totals:** `buildPrimeDriverExpenseMonth()` (`primeDriverExpenses.ts:151-188`) builds one section per line (all 16, even at $0). Each subtotal is the sum of that month's rows by `ded_date`/`exp_date`, and the grand total is the sum of the 16 subtotals. "Lumpers through settlement" is a separate read-only block, outside every total.
- **PDF and Excel:** both come from one HTML builder, `buildPrimeDriverExpenseReportHtml()` (`app/src/stats/primeDriverExpenseReport.ts:51-110`).
  - PDF: `Print.printToFileAsync`, at `prime-driver-expenses.tsx:657-658`.
  - Excel: the same HTML saved as `.xls`, at `:679-680`.
  - File names come from `buildPrimeDriverExpenseReportFilename()` (`:42-45`).
- **Isolation:** the sheet never feeds `computeKpis`, true profit, CPM, Truck Comparison, the Accountant Package line items or the tax estimate (header comment `primeDriverExpenses.ts:12-29`, and the "CANONICAL ISOLATION" test).

### Tests that pin this

- `app/src/primeDriverExpenses/__tests__/categoryMapping.test.ts`:
  - the full mapping table, including `Misc: 'Misc'` and `Other: 'Misc'` at lines 114-115;
  - backfill rules (from about line 120);
  - scope and vehicle-registration exclusions (around lines 400-460);
  - the needs list.
- `app/src/primeDriverExpenses/__tests__/categorySync.test.ts`: the reverse sync.
- `app/src/primeDriverExpenses/__tests__/categories.test.ts`: the 16 lines.
- `app/src/stats/__tests__/primeDriverExpenses.test.ts`: sections, totals and isolation; Misc is section 16, at line 52.
- `app/src/stats/__tests__/primeDriverExpenseReport.test.ts`: the HTML and file names.
- `app/src/data/__tests__/aiImportSave.primeLumperReport.test.ts`, `aiImportSave.lumperReimbursement.test.ts`, `primeSheetSettlementLumpers.test.ts`: lumpers.
- `app/src/data/__tests__/aiImportSave.expenseDecision.test.ts`: the pinned Yes row's `accountant_category` "Equipment/Operating Supplies".

Three tests read the screen file `prime-driver-expenses.tsx` as text:

- `app/src/legal/__tests__/estimateNotice.test.ts:107`, `:118`: the estimates banner and the PDF notice;
- `app/src/lib/__tests__/descriptionText.test.ts:132`, `:141`: no raw `description ?? ''`;
- `app/src/scan/__tests__/scanCore.test.ts:213`: the scanner wiring.

## 2. Where the manual choice is stored

**The line choice: the existing column `deductions.accountant_category`. No SQL needed.**

- It is already per expense and already editable on the sheet.
- The change is only that the app stops filling Misc by itself.
- `suggestAccountantCategory()` returns `null` for app categories Misc and Other, the same way it already does for Tires and Warranty.
- Such a row then appears in the existing "needs an accountant category" list (`findRowsNeedingAccountantCategory`) until the user picks a line, Misc included if they want.

**"Not on this sheet" as an answer needs SQL.** A user may want to answer "this does not belong on the sheet at all" for a Misc row. The column cannot hold that today, because the CHECK allows only the 16 lines. Options:
- Add one allowed value such as `'Not on sheet'` to the CHECK: a small PENDING_SQL section, and the sheet skips it.
- Store skipped ids in a `profiles` jsonb field: SQL, and it goes in the CLEARED bucket of Reset (invariant #24).
- Recommended: the CHECK value, since it is one row-level fact.

**Remembering the choice per category or vendor** (a suggestion, never applied silently):
- It needs new storage: a small table `prime_line_memory(user_id, key_kind 'category'|'vendor', key, line)` with RLS, or a `profiles.prime_line_memory` jsonb.
  - The table route must follow the full new-table checklist: both deletion lists, AFFECTED_TABLES, EXPORT_TABLES, DATA_FLOW and a PENDING_SQL section.
  - The jsonb route needs one PENDING_SQL line and the CLEARED bucket.
- On the next matching row, the needs list pre-selects "Your choice last time: Office Supplies". The row is written only when the user taps it.
- It is applied only in the app and never sent to the AI. The AI consent text does not change.

**Expenses already auto-assigned to Misc** are unchanged unless the owner decides otherwise.
- **The app cannot tell an auto-Misc from a Misc the user picked on purpose.** Nothing records who set the value.
- Option A (recommended): leave them. Offer a one-time "Check your Misc items (N)" filter on the sheet. Picking a line or confirming Misc ends it; the reviewed state is kept on the device.
- Option B: a PENDING_SQL backfill setting `accountant_category = null` where `accountant_category = 'Misc'` and the app category is Misc, Other or empty.
  - Every such row moves to the needs list and every past Misc subtotal drops.
  - It also erases deliberate Misc picks. Not recommended.

## 3. Notification design

1. **Featured card in Accountant Package** (`app/app/(tabs)/more/accountant-package.tsx:744-751`). Today its badge is the fixed text "Prime Inc". It becomes a count when items wait, e.g. "3 need your choice", in orange. It needs the deductions and settlements queries the screen already has. Cost: small.
2. **Banner at the top of the sheet.** Extend the existing needs list (`prime-driver-expenses.tsx:758-790`) to Misc and Other rows. Each item shows date, amount, description, its Deductions category and, later, the remembered suggestion. Tapping one opens the existing picker sheet (`:1066+`) with the 16 lines, plus "Not on this sheet" if that value is added. Cost: small, mostly reuse.
3. **Bell / Daily Tips.** Optional, later. Add a nudge to `app/src/alerts/missingDataNudges.ts` when items wait, with the usual frequency rules. Cost: small to medium.
4. **Exports while items are unassigned.** Options:
   - (a) Block the export until everything is answered. This is the safest, but the user cannot send a partial month.
   - (b) Warn and continue: one alert, "3 expenses ($212.40) still need a line. Export anyway?" Cheap, but the file itself shows nothing.
   - (c) Recommended: (b) plus an **"Unassigned — needs your choice"** block printed in the PDF and Excel under the 16 lines. It lists each item with its amount and is shown **outside** the grand total. It is labeled so totals never drop silently and the accountant can see what is pending. Cost: small, in the HTML builder and its test.

**Recommendation:** items 1, 2 and 4(c) now; the CHECK value "Not on sheet" if the owner wants that answer; memory (section 2) and the bell later as separate commits.

## 4. Which numbers change for existing data

- **With option A for old rows (recommended): no number changes for existing data.** Old Misc rows stay where they are.
- **Going forward:**
  - A new out-of-pocket expense in app category Misc or Other no longer adds to the Misc line until the user picks a line.
  - Until then, that month's **Misc subtotal and the grand total are lower by that amount**, and the item is listed as unassigned on the screen and in the export.
  - After the pick, the amount sits in the chosen line's subtotal.
- **Nothing outside the sheet changes:** Deductions, Home, profit, KPIs, CPM, Cash Flow, Profit Audit, Tax Estimator, the Accountant Package line items and the Schedule C totals (isolation, section 1).
- **With option B (null backfill),** every past month's Misc subtotal and grand total drop until the user re-picks.

### Read-only SELECT for one user

Review it first, replace `<USER_UUID>` (Supabase > Authentication > Users), then run it in the SQL Editor. It writes nothing.

```sql
-- READ-ONLY. Out-of-pocket deductions that land in the sheet's Misc line
-- today, for ONE user. Same filters as the sheet: not settlement-sourced,
-- not linked to a settlement, not saved from a settlement's document.
with u as (select '<USER_UUID>'::uuid as uid),
settlement_docs as (
  select document_id from settlements, u
  where user_id = u.uid and document_id is not null
)
select d.ded_date,
       d.amount,
       d.category      as app_category,
       d.accountant_category,
       d.source,
       d.store,
       d.description,
       case when coalesce(d.category, '') in ('Misc', 'Other', '')
            then 'auto Misc possible (app category Misc/Other/empty)'
            else 'Misc chosen for a mapped category (manual change)' end as how_it_got_there
from deductions d, u
where d.user_id = u.uid
  and d.accountant_category = 'Misc'
  and coalesce(d.source, '') <> 'settlement'
  and d.settlement_id is null
  and (d.document_id is null or d.document_id not in (select document_id from settlement_docs))
order by d.ded_date desc;
```

Notes on the result:
- It does not apply the vehicle-registration text filter (`categoryMapping.ts:165-170`). A row describing a registration, title or plate is in the result but not on the sheet.
- Each row's month on the sheet is its `ded_date` month.
- The "how_it_got_there" column is a hint only. As said above, the app cannot know for sure who set Misc.

Optional companion query, read-only, for the gap in section 6: out-of-pocket maintenance, fuel and toll rows that never reach the sheet.

```sql
with u as (select '<USER_UUID>'::uuid as uid)
select 'maintenance' as tbl, service_date as dt, cost as amount, vendor as who, description
  from maintenance_records, u where user_id = u.uid and settlement_id is null and coalesce(source, '') <> 'settlement'
union all
select 'fuel', purchase_date, amount, null, null
  from fuel_purchases, u where user_id = u.uid and settlement_id is null
union all
select 'toll', toll_date, amount, null, null
  from tolls, u where user_id = u.uid and settlement_id is null and coalesce(source, '') <> 'settlement'
order by 2 desc;
```

## 5. Interaction with the new import review (Yes/No + category)

The import card (commits e2a6efa and 4bf1c01) decides the row's app category and whether a deduction row exists at all.

- **No:** no deduction row. Nothing can reach the sheet and nothing is unassigned.
- **Yes with a category that has a sheet line:** `accountant_category` is set as today (`aiImportSave.ts:1019`, `:1086`, `:1202`). It lands on that line; no question is asked.
- **Yes with app category Misc or Other:** this includes a store item the guesser did not recognise, and the "other" document's own category. With this proposal the row is saved with `accountant_category = null`, so it appears in the sheet's "needs your choice" list instead of silently in Misc.
- **Yes with a `null`-mapped or custom category** (Insurance, Permits, ...): not on the sheet, as today.
- **Optional later:** a third control on the import card for users who use the sheet, "Line on the For Prime Inc Drivers sheet", shown only for Misc/Other rows. Not recommended now: it lengthens the card for every user, and the sheet's own list does the same job where the sheet is used.

## 6. Open owner decisions

1. **Old Misc rows:** option A (leave them, offer a one-time review) or B (null backfill).
2. **Add "Not on sheet" as an answer?** It needs a PENDING_SQL CHECK change.
3. **Remembered choices:** jsonb on profiles or a new table, or not at all.
4. **Maintenance, fuel and tolls tables never reach the sheet.** A repair bill imported as a maintenance document, a fuel receipt or a toll receipt is missing from the sheet entirely today. Should they appear?
   - Bringing them in needs an `accountant_category` column on those tables (SQL) and the same needs list.
   - Or they could be shown read-only with an automatic line (Repairs, Cash Fuel, Cash Tolls/Parking Fees). That contradicts "never automatic" only if the owner sees those as uncertain.
   - Settlement-linked rows stay out in every case (origin rule).
5. **Export behaviour:** recommendation 4(c), warn plus an "Unassigned" block outside the total.

## Cost and risk summary

- **Recommended core** (stop auto-Misc for Misc/Other, extend the needs list, card badge, export warning plus Unassigned block):
  - Cost: small to medium (about 4 files, i18n in 7 locales, tests).
  - Risk: low. Existing numbers do not change; new Misc items wait visibly instead of counting.
  - Tests that change: `categoryMapping.test.ts:114-115` (Misc/Other become `null`) and the backfill cases that expect Misc; `primeDriverExpenseReport.test.ts` gains the Unassigned block; `primeDriverExpenses.test.ts` gains unassigned-not-in-total.
- **"Not on sheet" value:** one PENDING_SQL section (CHECK change, idempotent). Low risk; the client must tolerate the CHECK not being applied yet.
- **Remembered choices:** small to medium, plus SQL. Low risk if it only pre-selects.
- **Maintenance, fuel and tolls on the sheet:** medium to high (SQL on three tables, a mapping, a needs list). The risk is double counting against the settlement-linked rows, so it needs its own design.

Ship list for this document: none (docs only; no SQL, no Edge Function, no OTA).
