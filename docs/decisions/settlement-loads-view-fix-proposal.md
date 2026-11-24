# Loads missing for weeks saved without line details — fix proposal (2026-11-24)

Status: PROPOSAL. Read-only design: no code, SQL or deploy was changed.
Follows `docs/decisions/settlement-loads-sync-diagnosis.md`.

## Live finding (owner's account, 15 latest weeks, owner-run SELECT)

- Saved gross = printed gross in every week, so Settlements ties to the statements.
- 8 weeks were saved with `linesNotSaved = true`. They have 0 `loads` rows, but their stored document lists loads:
  - week ending 2026-11-20: 4 loads
  - 10-23: 2
  - 10-16: 4
  - 10-09: 3
  - 10-02: 3
  - 09-25: 2
  - 09-11: 4
  - 08-14: 3
- That is 25 loads in `documents.parsed_json -> settlement.loads` that never became `loads` rows.
- The 6 weeks saved with their lines have `load_rows = loads_counted` exactly.
- No pickup-date or month shifts. 08-22 ($191.40) and one line of 08-14 are mileless Prime lines (adjustments, never loads).
- Conclusion: the Loads screen is "missing" loads only for weeks saved without line details.

## 1. linesNotSaved: when, why, what is skipped, how to recover

**Automatic, never the user's choice.** There is no button for it on the import card.

The exact code: `app/src/data/aiImportSave.ts:475-490`. When `evaluateSettlementGate()` passes but returns `lineDetails === 'mismatch'`, the save sets:

```
settlementMapping.loads = [];
settlementMapping.fuel = [];
settlementMapping.deductions = [];
settlementMapping.maintenance = [];
settlementMapping.reimbursements = [];
settlementMapping.tolls = [];
settlementStatement = { ...settlementStatement, linesNotSaved: true };
```

When the gate returns 'mismatch' (`app/src/import/settlementGate.ts:200-219`):

- **Prime path only.** The statement gate must pass first. On other carriers, line items that do not add up FAIL the gate (`lines_differ`), so nothing is saved and `linesNotSaved` never happens.
- **Inside a passed Prime statement**, `mismatch` is true when any of these holds:
  - **(a) A line-sum check failed:** a statement block's lines do not add up to its PRINTED block total (`LINE_SUM_CHECKS`), or a subtotal did not tie while the printed totals did.
  - **(b) A line-details difference exists** (`lineDetailsDifference()`, `app/src/import/reviewVerdict.ts:81-89`). The issue list (deductions / revenue lines / reimbursement lines / wage lines vs the printed totals) or a Prime group check disagrees.
  - **(c) The Prime loads check failed** (`splitPrimeLoads()`, `app/src/import/primeLoads.ts`). Σ load revenue + Σ adjustments ≠ REVENUE FROM PRIME INC. (±$1), with at least one load.
  - **(d) A content page was not read** (`missingPages.length > 0`).

**What is skipped.** Every line-derived row of the week:
- loads
- fuel purchases
- deductions
- maintenance
- reimbursements
- tolls

The only exception is the Prime **PR** personal-payment credits. They are put back as owner money in (`aiImportSave.ts:598-610`, owner 2026-11-13).

**What is still saved:**
- The settlement row: gross from TOTAL REVENUE, miles from the printed MILES row, net due, per diem days.
- `settlements.statement`, so profit comes from the statement.
- The loaded/empty split (see 2).
- The documents row with the full `parsed_json`, and the stored PDF.

**What the user sees.** "Line details were not saved because they did not match your statement." (`importFlow.linesNotSaved`), with "Try reading them again" (`IncompleteLineItemsNotice.tsx`).

**How to save the lines later.**
- Re-read the stored file ("Try reading them again" / Read again), or import the same PDF again. Both are a re-import of the same week (invariant #10: replace).
- Lines are saved only if the new reading reconciles. A reading that still mismatches saves the week again without lines.
- There is no way today to save the existing reading's lines on demand.

## 2. Miles, split, RPM, CPM and deadhead for a linesNotSaved week

They do NOT depend on `loads` rows.

- **Total miles.** `settlements.miles` = the statement's printed MILES row (`aiImportSave.ts:419-427`, batch C item 5).
- **Loaded/empty split.**
  - `settlements.loaded_miles / empty_miles / miles_split_source` (§82) are written by `readMilesSplit()` (`aiImportSave.ts:677-692`).
  - That function reads the EXTRACTION's `settlement.loads` (Prime: the RV lines' loaded/empty columns, `milesSplit.ts:89-98`), not the emptied mapping.
  - So a linesNotSaved week normally HAS a stored split, from the very loads that were not saved as rows.
- **The one miles engine.** `calcMiles()` (`app/src/stats/miles.ts:73-130`) uses the stored split first. It uses the loads rows only when no split is stored. Week total = MAX(statement miles, loaded + empty).
- **RPM, CPM and deadhead %.**
  - RPM and CPM come from `computeKpis()`: gross or expenses ÷ that total.
  - Deadhead % = empty ÷ total, over weeks with a known split.
- **So these 8 weeks:**
  - have miles counted, and a split if one was stored.
  - A week whose split write failed (columns missing at the time) or found no miles has `loaded_miles/empty_miles = null`. It counts in the total miles but sits in "weeks without breakdown" for deadhead %.

Read-only SELECT. Do NOT run before review; the owner runs it.

```sql
-- Owner's 15 latest settlement weeks: stored miles and loaded/empty split.
with u as (select id as uid from auth.users where email = 'alicembozkurt@gmail.com')
select s.week_ending,
       s.miles                                                   as statement_miles,    -- settlements.miles
       s.loaded_miles, s.empty_miles,                                                    -- settlements (§82)
       s.miles_split_source, s.miles_split_label,                                        -- settlements (§82)
       (s.loaded_miles is not null and s.empty_miles is not null) as split_stored,
       coalesce((s.statement->>'linesNotSaved')::boolean, false) as lines_not_saved,    -- settlements.statement (§77)
       (select count(*) from loads l where l.settlement_id = s.id) as load_rows
from settlements s join u on s.user_id = u.uid
order by s.week_ending desc
limit 15;
```

## 3. What a stored statement load contains

`documents.parsed_json -> settlement.loads[]`.

- **Today's reader** (`app/src/settlementReader/toExtraction.ts:264-271`) writes exactly these fields:
  - `order`: order number as printed
  - `from` / `to`: origin / destination
  - `loadedMiles`, `emptyMiles`: numbers, 0 when blank
  - `revenue`: the load's own printed revenue
- **No date.** The reader does not ask for a pickup or delivery date (`prompt.ts:24`). That is why every imported load gets `load_date = week_ending` (`mapExtraction.ts:157, 196`) and why no month shifts were found.
- **Older (pre-reader) extractions** may also carry `pickupDate`, `deliveryDate`, `date`, `dropDate`, `rate`, `shipper` (`app/src/import/types.ts:58-73`).
- **Enough for a read-only list:** order, origin → destination, loaded / empty miles, revenue, and the week ending (from the settlement).
- **For Prime, apply the same rule as the save:** hide mileless entries (`isMilelessLoad`, adjustments).
- **Revenue caveat:** when the Prime loads check failed (cause 1c), a saved load would have kept revenue 0 (`mapExtraction.ts:191-194`). A read-only list should show the printed amount labeled "as printed", never as counted revenue.

## 4. VIEW-ONLY option (recommended): show statement loads, create nothing

**Where.** The Loads screen (`app/app/(tabs)/more/loads.tsx`) plus small label changes on the settlement detail (`app/app/(tabs)/more/settlements.tsx`).

**Source.**
- One new pure function, e.g. `statementOnlyLoads(settlements, documents)` in `app/src/stats/`.
- It returns, for every settlement with `statement.linesNotSaved = true` AND 0 `loads` rows: the week, its `truck_id`, and the document's `settlement.loads`, filtered with the Prime mileless rule.
- Read from the documents already fetched (`useDocuments()`); no new query.

**On the Loads screen:**
- **Per such week, a header row:** "Week ending Nov 20 · 4 loads on the statement · details not saved".
- **Under the header, one muted item per statement load:**
  - order, origin → destination, loaded / empty miles, revenue "as printed";
  - an outlined tag "From statement".
- **No swipe, no delete mark, no edit sheet.** Tapping an item (or the header) opens the settlement week in Settlements (same route the Settlements list uses), where the stored statement can be read. It never opens a load editor.
- **Each real load row** gets its settlement week, "Week ending Nov 13". The week comes from `settlement_id`. A load with no settlement shows no week.
- **Top stats** (Total loads, Loaded miles, Revenue per mile) stay computed from `loads` rows only. A muted line under them says "+ 25 loads on statements, not counted here" when any exist.

**On the settlement detail (`settlements.tsx`):**
- Rename the two lists so testers stop comparing them: "Settlement income lines (N)" and "Loads (N)", each with its count.
- A linesNotSaved week shows, under Loads, the same "From statement" items and the "details not saved" note, instead of an empty list.

**How it behaves:**
- **Month grouping.** Statement loads have no date, so each item sits in the month of its week ending (the same month an imported load lands in, since `load_date = week_ending`). The header row goes first in that month's group. Past months stay collapsed as today.
- **Truck filter.** The same rule as `filterLoadsByTruckScope()`: the settlement's `truck_id`. Another truck's week is hidden while a specific truck is selected; a week with no truck is always shown.
- **Back.** No new route. Tapping opens Settlements with the existing route, and Back returns to Loads as it does from any More screen.
- **Export.** The Loads screen has no export. Export All Data / backup (`exportAllData.ts`, `backupSnapshot.ts`) read the `loads` TABLE only, so view-only items are never exported. The document's `parsed_json` is already in the export as part of `documents`.
- **Search.** The Loads screen has no search today; nothing to change.
- **No calculation reads these items:**
  - They exist only in the Loads screen's and the settlement detail's render path.
  - They are never passed to `calcMiles`, `computeKpis`, `buildTruckComparison`, `rankLoadsByRpm` (Cash Flow lanes), the Coach, daily tips or any export.
  - A source-check test pins this: no stats or data module imports `statementOnlyLoads` except the two screens.
  - No `loads` row is created, so no number anywhere can change.

**Cost and risk.**
- Cost: one pure function with tests, one screen section, label changes, about 6 i18n keys × 7 locales.
- Risk: display only. Worst case is a wrong-looking list, never a wrong number.

## 5. ROW-CREATION option (analysis only, not proposed for now)

A one-time backfill that inserts `loads` rows for the 8 weeks from their stored `parsed_json`:
- `settlement_id` = the week;
- `load_date` = `pickup_date` = week ending;
- revenue kept only where the Prime loads check passes, exactly as `mapSettlement()` would do;
- Prime mileless lines skipped.

What would move:

- **Loads screen stats:**
  - Total loads +25, and Loaded miles up by those loads' loaded miles.
  - Revenue per mile: revenue ÷ loaded miles over the rows. If some of those weeks failed the loads check, their loads carry revenue 0, so loaded miles go up while revenue does not, and RPM goes DOWN.
- **Total miles, CPM, RPM (Home, Scorecard, Tax/Accountant, `computeKpis`):**
  - Unchanged for every week that already has a stored split. `calcMiles()` takes the stored split over the loads rows, and the total is MAX(statement miles, split).
  - For a week with NO stored split, the new rows would supply one. Loaded/empty become known, and the total can go UP if loaded + empty > the printed MILES. CPM and RPM (÷ total) then go DOWN slightly for that window.
  - The SELECT in section 2 shows which weeks are in this case.
- **Deadhead %:**
  - Unchanged for weeks with a stored split.
  - For a week without one, the week leaves "without breakdown", and deadhead % moves toward that week's empty share (up or down).
- **Truck Comparison:** the same engine (`calcMiles`), so the same answer: no change where a split is stored. Per-truck CPM/RPM move only for weeks without one.
- **Coach:**
  - Deadhead per week (`proactiveCoach.ts:108-112`) and trailing average: only weeks without a stored split change.
  - The daily tips' `loadsCount` rises by 25, which can switch which tip shows.
- **Route stats (Cash Flow best/worst lanes, `rankLoadsByRpm`):**
  - New loads with revenue > 0 and loaded miles > 0 join the ranking. Best/worst lanes and the average lane RPM can move either way.
  - Loads with revenue 0 are excluded there.
- **Unchanged:**
  - Profit, gross and every expense: gross comes from the statement, never from loads.
  - Per diem: stored per settlement.
  - Taxes.
  - The golden settlement tests.

**Rule for future imports, if chosen.** On `lineDetails === 'mismatch'`, keep the load rows (revenue only if the loads check passed), and keep skipping fuel / deductions / maintenance / reimbursements / tolls. This changes the D2 rule ("never the mismatching line rows"), so it needs an owner decision.

Risk:
- It moves numbers (section above).
- It makes a mismatching reading's loads look certified.
- A re-import then replaces them like any week (invariant #10).

## 6. Recommendation and stage plan

**Recommendation:** the VIEW-ONLY option. It answers the tester ("the loads are there, from the statement, not saved as records"), moves no number, and keeps the D2 rule intact. Decide on row creation separately, after the section 2 SELECT shows which weeks have no stored split.

**Stages.** One commit each, checkable on the phone, each with `eas update`.

1. **Names and counts.** Settlement detail: "Settlement income lines (N)" and "Loads (N)". Loads screen: "Week ending <date>" on each real load. Phone: open week 11-13 (lines saved); counts match the lists.
2. **The pure function.** `statementOnlyLoads()` plus tests:
   - only linesNotSaved weeks with 0 rows;
   - Prime mileless lines excluded;
   - truck scope rule;
   - a source-check test that no calculation imports it.
   No UI yet.
3. **Loads screen section.** Week header + "From statement" items in the week's month group, the "+ N loads on statements, not counted here" line, tap to open the week. Phone: weeks 11-20, 10-23, ... show 4, 2, ... statement loads, and the top stats are unchanged.
4. **Settlement detail.** A linesNotSaved week shows its statement loads under Loads with the "details not saved" note. Phone: open 11-20.

No SQL, no Edge Function at any stage.
