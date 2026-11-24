# Tax deductible is the user's decision, not the AI's — proposal (2026-11-24)

Status: SUPERSEDED BY THE OWNER'S DECISION, IMPLEMENTED 2026-11-24. The owner
chose "decide at import" instead of option B below: the import card asks a
required Yes/No (empty by default, apply-to-all + per-item override); Yes
saves today's deductible row, No writes no expense row at all (the file and
documents row stay in Documents). No pending state, no new column, no SQL.
Commits: e2a6efa (data layer + tests), 4bf1c01 (import card + i18n),
57a4fb2 (ai-import prompt, NOT deployed). Out of scope and unchanged:
settlement-derived rows, manual entry, fuel/maintenance/tolls, all existing
rows. Option B (pending state), B+ (remembered choices) and the
"For Prime Inc Drivers" change (Part B) remain designs only.
Deploy order for the prompt: code -> `eas update` -> phones updated (Settings
shows the update) -> ai-import via `scripts/deploy-ai-import.ps1`. Reason: an
older build shows its read-only "Deductible:" line as "No" when the field
is missing (cosmetic; its saved rows are unchanged).

Original proposal text follows.

Status (original): PROPOSAL. Read-only: no code, SQL or deploy was changed.

## Owner request (verbatim, summarized only where marked)

> Owner decision: when a receipt or expense is imported, the AI must NOT
> decide whether it is tax deductible; the USER decides. Explain, with
> file:line: where the AI sets or suggests deductibility today (ai-import
> prompt/schema, parsing, import review card, saved columns), how that
> flag flows into totals (Tax Estimator, Accountant Package, profit/KPIs,
> audit ledger, exports), and what existing rows hold. Propose a design:
> no AI value saved, an explicit "needs your decision" state, whether the
> user must choose before saving or can decide later (with a visible
> count of undecided items), whether the app may remember the USER's own
> earlier choice per category or vendor (Category Learning) and how that
> differs from an AI decision, how undecided items are counted in profit
> versus in deductible totals, and what happens to old rows (unchanged
> unless the owner says otherwise). List which Edge Functions change
> (ai-import redeploy order: SQL, OTA, phones updated, then function),
> what must change in the AI consent text / privacy data list, and which
> pinned tests change. Options with cost and risk and a recommendation.

---

## 1. Where deductibility is set today

### The AI (ai-import prompt and schema)

All references are in `supabase/functions/ai-import/index.ts`.

- **Every docType schema has a document-level `"taxDeductible":true`.**
  - Settlement, fuel, maintenance and store/amazon all carry it: base prompt line 110, and the patched schemas at lines 112, 126-128 and 205-219.
  - Store/amazon also carry `"bizPct":100`.
- **The meals rule** (line 314, "APPROVED ADDITION meals & advance repayments, 2026-07-17").
  - A restaurant receipt must be categorized "Meals (per diem covered)".
  - For a receipt that is ENTIRELY a restaurant, the AI must **set taxDeductible to false**.
  - This is the one place the AI actively decides deductibility.
- **The "non-deductible traps" rule** (line 304).
  - The AI prefixes a description with "PERSONAL — REVIEW: " for mileage-rate claims, regular clothing, commuting, deposits and loan principal.
  - It does not set a flag. It is a text marker only.
- **Category.** The AI also picks categories (store items; `suggestedCategory` for unknown documents). The category drives the app's default (below), so the AI influences deductibility indirectly as well.
- **The settlement reader** (`app/src/settlementReader/*`) has no deductibility field.

### Parsing and mapping (app)

- **The type:** `Extraction.taxDeductible?` and `bizPct?` (`app/src/import/types.ts:454-455`). `bizPct` is never used anywhere.
- **Store and amazon receipts** (`mapPurchase`):
  - `wholeReceiptIsMeal = d.taxDeductible === false` (`app/src/import/mapExtraction.ts:570`) forces every item into "Meals (per diem covered)" (`mapExtraction.ts:620-621`).
  - Each row then gets `tax_deductible: defaultTaxDeductible(category)` (`mapExtraction.ts:558`).
- **Unknown or other documents** (`mapGenericDeduction`): `tax_deductible: defaultTaxDeductible(category)`, where the category is the user's pick or else the AI's `suggestedCategory` (`mapExtraction.ts:789`, `802`).
- **`defaultTaxDeductible()`** (`app/src/import/category.ts:141-143`) returns false for the `NON_DEDUCTIBLE_CATEGORIES` (`category.ts:110`): Meals (per diem covered), Advance Repayment, and Escrow & Deposits. Everything else is true.
- **Settlement-import rows set by app rules, not by the AI:**
  - Settlement-withheld rows are always false (`mapExtraction.ts:241-278`; invariant #1). The same holds for `settlementReconciliation.ts:64` and the PR moved rows at `aiImportSave.ts:604`.
  - Lumper companion rows (out-of-pocket) are always true (`mapExtraction.ts:365`).
  - Carrier code maps can set `tax_deductible` on settlement lines (`app/src/import/carrierCodes.ts:155-169`, `settlementLineClass.ts:71`, `78`). These are admin-seeded, Prime only.
- **Fuel, maintenance and tolls** imported from receipts have **no deductibility column at all**. They are always counted as expenses and as deductible.

### The import review card

- `app/app/(tabs)/import/index.tsx:1644-1646` shows "Deductible: ✅ Yes / No" from the AI's `extraction.taxDeductible`. It cannot be edited.
- `index.tsx:1603-1608` shows the meals note when the AI set it false on a store or amazon receipt.

### Saved columns and editing

- **The column:** `deductions.tax_deductible boolean not null default true` (`docs/PENDING_SQL.md` §33, line 1051; `app/src/types/db.ts:330`).
- **Deductions screen:**
  - A "Non-deductible" tag (`app/app/(tabs)/deductions.tsx:167-170`).
  - Yes/No pills in edit (`deductions.tsx:1038-1042`) and in manual add (`727`).
  - Saving goes through RPCs that take `p_tax_deductible` (`app/src/data/deductionMutations.ts:120-161`; PENDING_SQL around lines 3313-3369).

## 2. How the flag flows into totals

The flag changes **profit**, not only tax.

- **`isDeductibleExpense(d)`** = `tax_deductible !== false` (`app/src/stats/trueProfit.ts:46-48`).
- **`reducesTrueProfit(d)`** (`trueProfit.ts:73-87`). A row is excluded from profit when:
  - its category is Meals / Advance Repayment / Escrow (`trueProfit.ts:71`); or
  - its economic class is out of profit; or
  - otherwise, for a **non-settlement** row, when `tax_deductible === false`.

  So today a user-imported row marked not deductible **also disappears from true profit**.

`reducesTrueProfit()` feeds:

- **KPIs and profit:**
  - `computeKpis()`, `kpi.ts:306`, `581-584`.
  - `calcTrueProfit()`, `trueProfit.ts:268`, `410`.
  - These drive Home, Scorecard and the Settlements stats.
- **CPM:** `cpm.ts:249` and `periodScopedCpm.ts:104`.
- **Profit Analysis:** `profitAnalysis.ts:171`.
- **Truck Comparison:** `truckComparison.ts:180`.
- **Cash Flow forecast:** `cashFlowForecast.ts:112`.
- **Tolls coverage:** `kpi.ts:306` and `tollsSummary.ts:205`.
- **Audit ledger:** `auditLedger.ts:95` gives `excluded` with a reason. The Profit Audit and Explainer show it (`app/src/components/ProfitExplainer.tsx:179`).
- **Tax Estimator net profit:** `outOfPocketDeductions` = non-settlement rows with `reducesTrueProfit` (`app/src/data/dashboardStats.ts:83-86`). Through `app/src/data/taxEstimate.ts` it reaches the Tax Estimator, the Home tax cards and the quarterly amounts.

Separately:

- **Accountant Package:** skips `source = 'settlement'` and `tax_deductible === false` (`app/src/stats/accountantPackage.ts:108-114`). Fuel, maintenance and tolls are always added (`accountantPackage.ts:116-120`).
- **Operating P&L and Scorecard:** count every deduction unconditionally, by design (the legacy ports; `trueProfit.ts:38-44`).
- **Exports:**
  - `exportAllData.ts` and the backup snapshot carry the raw column.
  - The Accountant Package exports use the rule above.

## 3. What existing rows hold

- **Every row has a non-null value**, because the column is `not null default true`. There is no "undecided" today.
- **Out-of-pocket imported rows:** true, except the three default categories and AI-flagged whole restaurant receipts, which are false.
- **Settlement-withheld rows:** false (invariant #1). They count in profit through the settlement rule, never as a tax deduction.
- **Rows the user edited:** whatever the user chose. **These cannot be told apart from AI or default values**, because nothing records who set the value.

A read-only check the owner can run (replace the id):

```sql
select source,
       category,
       tax_deductible,
       count(*),
       sum(amount)
from deductions
where user_id = '<USER_UUID>'::uuid
group by 1, 2, 3
order by 1, 2, 3;
```

---

## 4. Proposed design

### Data model

Add one nullable column; **never** make `tax_deductible` nullable. Many checks rely on `!== false`/`=== false`; a null would silently become "deductible" in some places and "not false" in others.

```sql
alter table deductions add column if not exists deductible_decided_by text
  check (deductible_decided_by in ('user', 'rule', 'pending'));
```

| Value | Meaning |
| --- | --- |
| `pending` | Imported, out-of-pocket, waiting for the user. `tax_deductible` keeps its column default (true), but no total that asks "is it deductible?" may trust it while pending. |
| `user` | The user chose: in the import card, the Deductions edit, a bulk "decide", or a remembered choice they confirmed. |
| `rule` | A fixed product rule, never the AI. Settlement-withheld rows are always false (invariant #1, not a choice). |
| `null` | An old row from before this change. Treated exactly as today. |

The usual PENDING_SQL steps apply:
- A new `deductions` column needs no new-table checklist.
- It does need: export (already all columns), the reset is fine (row-level), and `DATA_FLOW.md`.

### No AI value saved

- `mapPurchase()` and `mapGenericDeduction()` stop reading `d.taxDeductible` and stop calling `defaultTaxDeductible()` for imported rows. Those rows are saved `pending`.
- The import card drops the "Deductible: Yes/No" line. It shows a "Tax deductible? You decide" control instead (below).
- **The category stays.** The AI may still suggest "Meals (per diem covered)", because that is classification, not deductibility.
  - The category has its own profit rule (`trueProfit.ts:71`): a per-diem-covered meal never reduces profit, deductible or not.
  - This is an existing product rule. The owner should confirm it stays (see option notes).

### Decide before saving, or later?

**Recommended: later, with a visible count.**

- The import card shows a Yes/No choice per receipt. One choice covers all lines of that receipt, and lines can be changed in Deductions.
- It is **not required to save**. Requiring it would add a blocking step to every receipt and to batch imports.
- Undecided rows show a "Decide" chip on Deductions.
- A count appears on Deductions and on the Tax Estimator: "3 expenses ($412.50) need your tax decision".
- The existing alerts/nudges list gets one more nudge.
- Bulk action: "Mark all as deductible / not deductible" for a filtered list.

### Remembering the user's own earlier choice

**Allowed, as a suggestion the user confirms, never silently.**

- The app may store the user's last choice per category and per vendor. This would be a new small table, or new columns on `category_learning_rules` (`docs/SCHEMA.sql:501`).
- On the next import it **pre-selects** that answer in the card, marked "Your choice last time".
  - The row stays `pending` until the user taps Save on the card with that choice visible.
  - It becomes `user` when they confirm.
- **This differs from an AI decision in two ways:**
  - The source is only this user's own past taps, never the model.
  - It is applied in the app after the extraction, and **never sent to the AI**.

  This matters because `category_learning_rules` IS sent to ai-import today as `learningRules` (`app/src/data/aiImportCall.ts:87`, `96`). The deductibility memory must stay out of that payload.

### How undecided items count

- **In profit (KPIs, CPM, audit ledger, Cash Flow): they count as expenses.**
  - The money was really spent. This matches today's default, so profit numbers do not move when an item is pending.
  - `reducesTrueProfit()` treats `pending` like true. The category rules still apply.
- **In deductible totals (Tax Estimator net profit, Accountant Package): they are NOT counted** until the user decides.
  - This is conservative: a higher estimated tax, never an overstated deduction.
  - These screens show the undecided count and amount.
  - It **changes tax numbers for newly imported receipts only**, versus today. Old rows are unchanged (below).
- **The audit ledger** shows a pending row as `counted` for profit, with a "tax decision pending" note.

### Old rows

Unchanged unless the owner decides otherwise.

- `deductible_decided_by` stays null, and they behave exactly as today.
- Offer an optional later "Review past imports" list that sets them to `user` one by one. It never runs automatically.

### Edge Functions and deploy order

`ai-import` is the only function that changes, and ONLY the prompt:
- remove `taxDeductible` (and the unused `bizPct`) from the schemas;
- remove the sentence "set the document's taxDeductible to false" from the meals rule. The categorize-as-Meals part stays.

`ai-advisor`, `reset-data` and `delete-account`: no change.

This is an edit to the "port verbatim" prompt, made by this owner decision.

Order:
1. **SQL:** the new column (PENDING_SQL section, NOT YET APPLIED until the owner runs it).
   - The client must already tolerate the column missing: an unknown-column write no-ops (`updateRowTolerant` pattern).
2. **OTA:** the client ignores `taxDeductible`, saves `pending`, and shows the decision UI and the counts.
3. **Phones updated:** close and reopen the app twice. Settings must show the new update.
4. **Deploy ai-import** with `scripts/deploy-ai-import.ps1`.
   - Old app versions that still read `taxDeductible` see `undefined`, which they already treat as "not false" (`mapExtraction.ts:570`). So the order is safe either way.

### AI consent text and privacy list

- **No change needed.**
  - What is sent to Anthropic and to whom stays the same, so `AI_CONSENT_VERSION` (`app/src/ai/aiConsent.ts:14`) is not bumped.
  - The consent bullets (`app/src/i18n/locales/en.json` `aiConsent`, about line 3413) do not mention deductibility.
  - `src/config/privacyPolicy.ts` does not mention deductibility either.
- **This holds only if** the remembered user choices are never added to the ai-import payload.
- **If the owner ever wants them sent:** that is new data sent to the AI, so the consent version must be bumped and the privacy data list updated.
- **Optional:** one Terms or Privacy sentence such as "The app never decides whether an expense is tax deductible; you do". This is not required.

### Pinned tests that change

Tests that assert today's automatic value on imported rows:

- `app/src/import/__tests__/mapExtraction.test.ts` lines 495, 507, 520, 553 and 558. These cover the store item, meal and advance-repayment defaults, and the generic default.
- The restaurant whole-receipt test (`d.taxDeductible === false` turning into Meals) changes its expectation. The category stays; the flag becomes `pending`.
- Any `aiImportSave.*` test that snapshots inserted out-of-pocket deduction rows gains `deductible_decided_by: 'pending'`.

Tests that must stay green unchanged:

- The settlement-withheld false tests: `mapExtraction.test.ts:211`, `aiImportSave.settlementChildren.test.ts:226`, `aiImportSave.loanDedupe.test.ts:146`.
- `goldenPrimeSettlement*.test.ts`.
- `dashboardStats`, `accountantPackage`, `cpm`, `cashFlowForecast` and `auditLedger` tests on old rows.

New tests:

- A pending row counts in `reducesTrueProfit`, but is excluded from `outOfPocketDeductions` and the Accountant Package.
- The undecided count and amount are correct.
- A `user` choice wins over everything.
- An old null row behaves exactly as today, with a literal-value test.
- The remembered choice is pre-selected but not saved as `user` without a confirm.
- The ai-import payload never contains the deductibility memory (a source-check test on `aiImportCall.ts`).
- No import path reads `extraction.taxDeductible` (a source check).

---

## 5. Options

**(A) Minimal.**
- What changes:
  - Stop using the AI flag: `mapPurchase` ignores `taxDeductible`.
  - Hide the card line.
  - Imported rows default to deductible, with a "Decide" chip only on meals-category rows.
- What stays: no new column, no counts.
- Cost: small.
- Risk:
  - The app still decides by default (true), which arguably still is "not the user deciding".
  - User-set and default values stay indistinguishable.

**(B) Pending state, decide later.** RECOMMENDED.
- What it is: the design above, with the new column, the count and the bulk decide.
- Cost: medium.
  - One SQL column.
  - The mapper, the import card, the Deductions chip and filter, two totals.
  - The Tax Estimator and Accountant Package notes.
  - i18n in 7 locales and tests.
- Risk:
  - The tax estimate rises for undecided new receipts. This is intended, conservative and visible.
  - Profit does not move.

**(C) Must decide before save.**
- What it is: B, plus the card blocks Save until Yes/No is picked for each receipt.
- Cost: B plus a small amount.
- Risk:
  - Slows every import and batch imports. Users may tap Yes blindly to get past it.
  - No undecided state can exist, so the count is not needed.

**(B+) Add remembered choices.**
- What it is: B plus the per-category/vendor memory pre-select.
- When: can ship later as its own commit.
- Cost: small to medium (one table or columns plus a PENDING_SQL section).

**Recommendation:**
1. Ship **B** first.
2. Then **B+** once the owner has seen the count in use.
3. Keep the Meals and Advance Repayment and Escrow **category** profit rule as it is (it is not a tax decision).
4. Separately, decide whether fuel, maintenance and toll receipts, which have no flag today, also need a user decision. Out of scope here.

## Ship list for implementation (later, not now)

- **PENDING_SQL:** one section (the `deductible_decided_by` column). B+ needs a second one.
- **Edge Functions:** `ai-import` (prompt only), deployed LAST, after the SQL, the OTA and the phones are updated.
- **App delivery:** `eas update`. No native build is needed.
