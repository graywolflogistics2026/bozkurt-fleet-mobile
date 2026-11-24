# Settlement loads vs Loads screen — diagnosis (2026-11-24)

Status: DIAGNOSIS + PROPOSAL. Read-only: no code, SQL or deploy was
changed.

## Tester report and owner request

> Tester: "loads listed inside Settlements are not fully synchronized
> with the Loads screen, many loads are missing".
>
> Owner: explain how the Loads screen gets its rows; how the settlement
> detail builds its load list; which flows create `loads` rows and whether
> a settlement import creates or links loads; what key matches a
> settlement load line to a loads row and every case where no match
> happens. Give a read-only SELECT comparing, per settlement week, the
> settlement's load lines with the loads rows for ONE user. Propose fix
> options with cost and risk. Check whether adding loads rows can change
> revenue, profit, KPIs, the profit audit or any tax number. The fix must
> not change any number.

## Short answer

The settlement detail shows **two different lists**, and only one of them comes from `loads`.

1. **"Income lines"** (`app/app/(tabs)/more/settlements.tsx:762-776`).
   - These are read straight from the imported document's `documents.parsed_json.settlement.revenueItems` (`extractRevenueItems()`, `settlements.tsx:117-122` and `298-302`).
   - They are every printed revenue line: linehaul, fuel surcharge, stop pay, detention, adjustments.
   - **They are never `loads` rows**, and nothing ever turns them into loads.
2. **"Loads"** (`settlements.tsx:809-825`).
   - These are `loads` rows whose `settlement_id` equals the settlement id (`settlementLoads`, `settlements.tsx:293-296`).
   - It is the same table and the same rows the Loads screen reads.

So the two "load lists" a tester compares are usually **Income lines vs Loads**. These will never match one-for-one: one load has several income lines, and adjustment lines are not loads.

The `loads` rows themselves are the same on both screens. The Loads screen can still look like it is missing rows, for display reasons described below: truck scope, collapsed past months, and pickup-date grouping.

The SELECT below shows which cause applies to the tester's account.

## How the Loads screen gets its rows

- **Query:** `useLoads()` (`app/src/data/loads.ts:4-5`) is the generic entity list (`app/src/data/entityHooks.ts:106-125`). It runs `select * from loads where user_id = me`, ordered, with **no date limit**.
- **Truck scope:** `filterLoadsByTruckScope()` (`app/src/stats/loadsScope.ts:20-31`, used at `app/app/(tabs)/more/loads.tsx:71-74`).
  - A load has no `truck_id`; it takes its truck from its settlement.
  - A load whose settlement belongs to ANOTHER truck is hidden while a specific truck is selected.
  - Loads with no settlement, or whose settlement has no truck, are always shown.
- **Sorting:** rows are sorted by `load_date`, newest first (`loads.tsx:73`).
- **Grouping:** rows are grouped by month in `MonthGroupedList` (`loads.tsx:130-147`).
  - **Every past month starts collapsed.** Only the current month and the "no date" group are open (`app/src/components/monthGroups/MonthGroupedList.tsx:53-65`).
  - `load_date` is the load's **pickup date** (`app/src/import/mapExtraction.ts:196-203`), so a week's loads can sit in an earlier month than the settlement.
- **No add button:** the Loads screen has no manual-add flow. It can only delete (`loads.tsx:86-100`).

## How the settlement detail builds its lists

- **"Loads":** `loadsQuery.data.filter(l => l.settlement_id === selected.id)` (`settlements.tsx:293-296`).
  - Shows origin → destination, loaded miles and revenue (`settlements.tsx:809-825`).
  - It has no truck filter and no month grouping, so every row of that week is visible here.
- **"Income lines":** `revenueItems` from the document's `parsed_json` (`settlements.tsx:117-122`, `298-302`, `762-776`).
  - Reader path: `revenueItems` = every printed line of the revenue section (`app/src/settlementReader/toExtraction.ts:253-256`).
  - The reader's `loads` is a **separate** list the model fills "one entry per printed load/trip" (`app/src/settlementReader/prompt.ts:24`, converted at `toExtraction.ts:264-271`).

## Which flows create `loads` rows

1. **Settlement import:** the only live source.
   - `mapSettlement()` builds `loads` from the extraction's `settlement.loads` (`mapExtraction.ts:187-210`).
   - `saveExtraction()` inserts them with the new `settlement_id` (`app/src/data/aiImportSave.ts:750-758`, `insertBatchResilient('loads', ...)`).
   - A re-import of the same week deletes that settlement's old loads and inserts the new ones (`aiImportSave.ts:723-734` and `942`; invariant #10).
2. **Legacy web-backup import:** `app/src/data/legacyImport/importLegacyBackup.ts:277`. This is a one-time migration.
3. **Manual entry:** none (no add flow anywhere).
4. **Rate confirmation import:** none. There is no rate-confirmation docType. The ai-import prompt mentions a rate confirmation only as a place to read pickup and delivery dates (`supabase/functions/ai-import/index.ts:276`).

**Creates, never links.** A settlement import always CREATES new rows. It never looks for an existing load to link, so there is no de-duplication against loads from other sources.

**Removal:**
- delete on the Loads screen;
- re-import replace;
- settlement delete (`loads.settlement_id ... on delete cascade`, `docs/SCHEMA.sql:439`);
- truck deletion (`app/src/data/truckDeletion.ts:86`).

## What key matches a settlement line to a loads row

**None.**

- The only link is `loads.settlement_id`, set at save time.
- No order number, date or amount is ever compared between an income line and a loads row.
- The one place order numbers are compared is the **Prime loads splitter** (`app/src/import/primeLoads.ts:51-71`). It decides which revenue lines are *adjustments* rather than loads; it does not match against stored rows.

## Every case where a printed load or line has no loads row

1. **The line is not a load.** Fuel surcharge, stop pay, detention, incentives and adjustments appear in Income lines but never in loads, by design.
2. **Prime RV line with no miles.**
   - It is an adjustment, never a load (`primeLoads.ts:9-10`, `42-45`, `55`).
   - The prompt says the same at `supabase/functions/ai-import/index.ts:513`, rule (3).
3. **The week was saved without line details (`linesNotSaved`).**
   - The statement passed but the lines did not reconcile, so `settlementMapping.loads = []` (`aiImportSave.ts:459-474`).
   - The week shows Income lines (from `parsed_json`) and **zero** loads.
4. **The model listed fewer loads than were printed.**
   - `loads` is a separate list in the reader output (`prompt.ts:24`), and no check compares its count with the printed trips.
   - The Prime check compares revenue sums only (`primeLoads.ts:73-80`). A short list mostly fails that check and lands in case 8; a missing zero-revenue trip would not.
5. **A row failed to insert.** It is reported in `skippedRows` and not saved (`aiImportSave.ts:742-758`).
6. **The rows exist but are hidden on the Loads screen:**
   - (a) another truck's settlement while a truck is selected (`loadsScope.ts:27-30`);
   - (b) a past month that is collapsed (`MonthGroupedList.tsx:62-65`);
   - (c) the pickup date falls in a different month than the settlement week (`mapExtraction.ts:196`).
7. **The settlement was deleted or re-imported.** Its loads went with it, or were replaced.
8. **The row exists with $0 revenue.**
   - A Prime week whose loads did not add up to the statement keeps its loads with revenue 0 (`mapExtraction.ts:191-194`, `209`).
   - It looks "wrong" rather than missing.

## Read-only SELECT (owner reviews, then runs in the SQL Editor)

Replace `<USER_UUID>` once. Find it in Supabase > Authentication > Users. It is not included here.

```sql
-- READ-ONLY. One row per settlement week for ONE user:
-- printed income lines and AI-listed loads (from the stored document)
-- vs the loads rows actually saved for that settlement.
with u as (select '<USER_UUID>'::uuid as uid),
s as (
  select st.id, st.week_ending, st.truck_id, st.document_id, st.gross,
         coalesce((st.statement->>'linesNotSaved')::boolean, false) as lines_not_saved
  from settlements st, u
  where st.user_id = u.uid
),
doc as (
  select s.id as settlement_id,
    coalesce(jsonb_array_length(d.parsed_json->'settlement'->'revenueItems'), 0) as income_lines,
    (select coalesce(sum(case when (r->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (r->>'amount')::numeric else 0 end), 0)
       from jsonb_array_elements(coalesce(d.parsed_json->'settlement'->'revenueItems', '[]'::jsonb)) r) as income_lines_total,
    coalesce(jsonb_array_length(d.parsed_json->'settlement'->'loads'), 0) as ai_loads,
    (select count(*)
       from jsonb_array_elements(coalesce(d.parsed_json->'settlement'->'loads', '[]'::jsonb)) l
      where (case when (l->>'loadedMiles') ~ '^[0-9]+(\.[0-9]+)?$' then (l->>'loadedMiles')::numeric else 0 end)
          + (case when (l->>'emptyMiles')  ~ '^[0-9]+(\.[0-9]+)?$' then (l->>'emptyMiles')::numeric  else 0 end) > 0) as ai_loads_with_miles
  from s
  left join documents d on d.id = s.document_id
),
ld as (
  select l.settlement_id,
         count(*) as load_rows,
         coalesce(sum(l.revenue), 0) as load_revenue,
         count(*) filter (where coalesce(l.revenue, 0) = 0) as zero_revenue_rows,
         min(l.load_date) as first_load_date,
         max(l.load_date) as last_load_date
  from loads l, u
  where l.user_id = u.uid
  group by l.settlement_id
)
select s.week_ending,
       s.truck_id,
       s.gross,
       s.lines_not_saved,
       doc.income_lines,
       doc.income_lines_total,
       doc.ai_loads,
       doc.ai_loads_with_miles,
       coalesce(ld.load_rows, 0)         as load_rows,
       coalesce(ld.load_revenue, 0)      as load_revenue,
       coalesce(ld.zero_revenue_rows, 0) as zero_revenue_rows,
       ld.first_load_date,
       ld.last_load_date
from s
left join doc on doc.settlement_id = s.id
left join ld  on ld.settlement_id  = s.id
order by s.week_ending desc;

-- Loads with no settlement at all (legacy import), same user:
select count(*) as loads_without_settlement
from loads
where user_id = '<USER_UUID>'::uuid and settlement_id is null;
```

How to read each row of the first query:

- **`income_lines` > `load_rows`:** this is normal. It is case 1 or 2.
- **`lines_not_saved` = true and `load_rows` = 0:** case 3.
- **`ai_loads_with_miles` > `load_rows`:** case 4 or 5. A load was printed and read but not saved.
- **`zero_revenue_rows` > 0:** case 8.
- **`first_load_date` in an earlier month than `week_ending`:** case 6c. The load sits under that month on the Loads screen.
- **Rows match here but the tester still misses them on the phone:** case 6a or 6b.

Caveats:
- If `income_lines` and `ai_loads` are null for a week, its stored `parsed_json` uses a different shape (older import path). Those weeks can only be compared by `load_rows`.
- The SQL Editor runs as an admin and bypasses RLS. That is why the query filters by `user_id` explicitly.

## Can adding `loads` rows change any number?

Yes. Some numbers would change, so a fix that creates rows is NOT number-neutral. Where loads are used:

- **Gross, revenue and profit: no.**
  - Gross comes from settlements (`layeredGross`, `app/src/stats/kpi.ts:380`), never from loads.
  - The Prime splitter says so explicitly: "gross never comes from loads, so profit is untouched" (`primeLoads.ts:14-15`).
- **Tax: no.**
  - Per diem uses each settlement's `per_diem_days` (invariant #25; `app/src/tax/perDiem.ts` does not read loads).
  - The tax estimate's net profit does not read loads (`app/src/data/dashboardStats.ts:68-86` uses loads only for miles).
- **Profit audit and explainer: no.** `auditLedger.ts` and `profitExplainer.ts` do not read loads.
- **Accountant Package: no.** It passes `loads: []` (`app/app/(tabs)/more/accountant-package.tsx:560`).
- **MILES: YES.** `calcMiles()` (`app/src/stats/miles.ts:91-111`):
  - For a week with no stored loaded/empty split on the settlement, it takes the split from that week's loads.
  - It then uses `totalMiles = max(statement miles, loads loaded + empty)`.
  - So new loads rows can raise a week's total miles and change its loaded/empty split.
  - This flows through `computeKpis()` (`kpi.ts:367`, `402`) into:
    - **CPM, RPM, net per mile and deadhead %** on Home, Scorecard and Settlements;
    - Truck Comparison (`truckComparison.ts:224-298`);
    - `dashboardStats.ts:68` and `115`;
    - `periodScopedCpm.ts:90`;
    - the coach's deadhead line (`proactiveCoach.ts:110-111`);
    - Daily Tips (`dailyTips.ts:135`).
- **Coach "loads to close the gap": YES.** Average revenue per load is computed from the latest week's loads (`proactiveCoach.ts:191-195`).
- **Best/worst lanes: YES.** These are the RPM rankings (`app/src/stats/cashFlowTrend.ts:80-100`).
- **Loads screen header: YES.** Total loads, loaded miles and revenue per mile (`loads.tsx:76-84`).
- **Per diem default: no.** It is computed from settlement miles at import time (`mapExtraction.ts:181`) and is never re-derived.

## Fix options

**1. Make the two lists honest (display only).** RECOMMENDED FIRST.
- Settlement detail:
  - Rename "Income lines" to something like "Statement revenue lines".
  - Add one line under each list: "N loads · M other revenue lines (fuel surcharge, adjustments)".
  - When `linesNotSaved`, say "Load details were not saved for this week (the lines did not match the statement)."
- Loads screen:
  - Show the settlement week under each load.
  - Optionally open every month that has loads, or group by settlement week instead of pickup month.
- Cost: small (one screen pair, i18n in 7 locales).
- Risk: none for numbers; no data change.

**2. Show "settlement-only" trips in Loads, with a marker.**
- Loads would list, read-only, the printed trips found in a week's `parsed_json` that have no loads row (cases 3-5), labeled "From statement, not saved as a load".
- Built in memory from `parsed_json` only; no row is written.
- Cost: medium. It needs a careful matcher (order number + miles) so the same trip is not shown twice.
- Risk: no number change, because nothing reads these display items. The risk is a wrong match showing a duplicate on screen.

**3. Create or link loads rows from settlement lines (new imports).**
- Cost: medium.
- Risk: **changes numbers** (miles, CPM, RPM, deadhead, lanes, coach), as listed above.
- It could be made number-neutral only by also freezing miles to the statement for those weeks. That means storing the settlement's own split first, so `calcMiles()` ignores the loads split. Even then, the average revenue per load and the lane rankings would still change.
- This does NOT meet "must not change any number" without an explicit owner exception.

**4. One-time backfill from stored `parsed_json`.**
- This is option 3 applied to history, so it carries the same number changes.
- It also adds a PENDING_SQL or script step, and a re-import of a week would replace the backfilled rows.
- Cost: medium to high. Risk: the same as option 3, plus every past week's CPM changes at once.

**Recommendation:**
1. Run the SELECT on the tester's account first, to see which case dominates.
2. Then ship option 1. If trips really are missing (cases 3-5), add option 2.
3. Options 3 and 4 need an explicit owner decision to accept the miles, CPM and lane changes. If chosen, they need a pinned before/after test on the golden weeks first.

## Ship list (for this document)

None: no SQL to apply, no Edge Function, no OTA. The SELECT is read-only and for the owner to run.
