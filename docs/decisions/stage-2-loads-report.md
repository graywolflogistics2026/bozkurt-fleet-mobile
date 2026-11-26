# Stage 2 (loads from the week's revenue lines): report (2026-11-25)

Nothing was pushed, deployed or published, and no SQL was run. git status
is clean except the untracked `app/supabase/`. The reader prompt was not
touched.


## Commits

- 5be2fec: Docs. "Stage 2 evidence 2026-11-25" and the D1 note, added to
  `docs/decisions/advance-family-rule-proposal.md`.
- 5528bbf: Stage 2 code, tests, reader bundle and CHANGELOG.
- The next docs commit: this report.


## Test counts

- After 5528bbf: 226 suites, 5,452 passed, 1 todo, 0 failed. tsc clean.
  The coreBundle test is green after `npm run build:reader`.
- Before (after stage 3a, e66d593): 225 suites, 5,413 passed, 6 todo.
- The remaining todo: 08-14 matches after stage 4.


## What changed

- `primeLoads.ts`:
  - New `loadRevenueByOrder()`. It maps each order to the sum of its
    LOAD_REVENUE_DESC lines, to the cent.
  - `splitPrimeLoads()`: each load with miles takes its order's sum
    (`lineRevenue`). The check is Σ lineRevenue + adjustments vs REVENUE
    FROM PRIME INC., within $1.00.
  - The reader's per-load sum is kept only as `readerLoadRevenue`, for
    comparison. It is never used by the check or the save.
  - Adjustments are exactly as before.
- New named failure, `load_without_revenue_line`:
  - Cases: a load with miles whose order has no matching line, or a load
    with miles and no order number.
  - The check fails (`matches` false).
  - The gate cause is `{kind: 'loads', difference: null, reasons:
    ['load_without_revenue_line'], orders: [...]}`. A load with no order
    number shows as null.
  - The saved review reason `loads_revenue_mismatch` gets the label
    "load_without_revenue_line: <orders>".
- `mapExtraction.ts`: a Prime load's `loads.revenue` is its per-order line
  sum when the check passes, else 0. It is never the reader's figure.
  Non-Prime carriers are unchanged.
- `statementLoads.ts` (view-only) now uses the same
  `loadRevenueByOrder()`. Its logic is identical (same parser, same
  rounding), so the view output is unchanged. The statementLoads tests,
  including the isolation test and the 11-13 test, are green.
- D1 is unchanged: a loads failure alone still drops every line row.


## 17-week gate: before = stored / stage 3a, after = stage 2

- 2026-07-31: stored mismatch 798.31; after 3a, loads only (+2,282.10);
  after stage 2, MATCH.
- 2026-08-07: match; match; match (unchanged).
- 2026-08-14: stored mismatch 94.68; after 3a, mismatch 94.68; after
  stage 2, mismatch 94.68 (unchanged). The causes are revenue lines
  +94.68 and loads +94.68. Needs stage 4.
- 2026-08-21: match; match; match (unchanged).
- 2026-08-28: match; match; match (unchanged; no load with miles).
- 2026-09-04: match; match; match (unchanged).
- 2026-09-11: stored mismatch 2,277.16; after 3a, match; still match.
- 2026-09-18: match; match; match (unchanged).
- 2026-09-25: stored mismatch 296.55; after 3a, loads only (+2,004.13);
  after stage 2, MATCH.
- 2026-10-02: stored mismatch 514.55; after 3a, loads only (+954.83);
  after stage 2, MATCH.
- 2026-10-09: stored mismatch 352.55; after 3a, match; still match.
- 2026-10-16: stored mismatch 1,701.00; after 3a, loads only
  (+2,538.28); after stage 2, MATCH.
- 2026-10-23: stored mismatch 511.00; after 3a, match; still match.
- 2026-10-30: match; match; match (unchanged).
- 2026-11-06: match; match; match (unchanged).
- 2026-11-13: match; match; match (unchanged).
- 2026-11-20: stored mismatch 2.55; after 3a, loads only (+2,717.54);
  after stage 2, MATCH.

Every week passes the statement gate.


## Per-order saved revenue vs the reader's figure

- In the 8 weeks that save rows today (08-07, 08-21, 08-28, 09-04, 09-18,
  10-30, 11-06, 11-13), the per-order line sum equals the reader's figure
  on every order. No saved number changes. 08-28 has no load with miles.
- 09-11, 10-09 and 10-23 also equal the reader's figure on every order.
- Where they differ, the week saved no rows before:
  - 07-31: 4845329 1,951.10 (reader 2,709.86); 4857478 3,269.26
    (4,540.64); 4873616 647.88 (899.84).
  - 09-25: 5054601 212.56 (1,057.74); 5081817 2,980.17 (4,139.12).
  - 10-02: 5051626 1,552.33 (2,156.02); 5069068 633.07 (879.26);
    5110361 269.86 (374.81).
  - 10-16: 5124931 1,517.04 (2,107.00); 5145720 1,122.70 (1,559.30);
    5146126 3,015.78 (4,188.59); 5158522 871.47 (1,210.38).
  - 11-20: 5234572 871.66 (1,210.64); 5267496 2,681.79 (3,724.71);
    5288497 1,551.39 (2,154.71); 5298068 1,883.10 (2,615.42).
  These are the amounts a "Read again" would save for those weeks, if the
  new reading is the same as the stored one.


## Findings checked

Every finding matched the tests (`primeLoadsStage2.test.ts`,
`primeWeeks2026.test.ts`). Nothing differed:
- The lines plus adjustments tie REVENUE FROM PRIME INC. to the cent in
  16 weeks.
- 08-14 is +94.68 (adjustment +47.34), and it is still named.
- The reader's sums are 8,150.34 / 5,196.86 / 3,410.09 / 9,065.27 /
  9,705.48 against the lines' 5,868.24 / 3,192.73 / 2,455.26 / 6,526.99 /
  6,987.94.
- No load with miles lacks a line.
- 08-28 has one mileless 2.33 line, equal to the statement.
- 10-02 saves 1,552.33 / 633.07 / 269.86.


## Existing tests changed (no profit or saved number changed)

- `goldenPrimeSettlement0814.test.ts`: two tests put the TRIP figures
  under `loads` and expected the loads check to fail.
  - Under stage 2 those figures are ignored. The tests now expect a match
    and the saved revenue 2,900.40 / 1,763.24 / 1,451.40. Profit
    4,987.74 is still asserted.
  - The failure case is kept as a new test: the OWNER REVENUE line of one
    order is read under another description, which gives
    `load_without_revenue_line`. The rows are not saved and profit is
    unchanged.
- `wageWeeks.test.ts` (11/06): its synthetic reading has one load (order
  4700001) and no revenue line, so stage 2 named it
  `load_without_revenue_line`. The test now adds that load's revenue line
  (TRIP REVENUE 2,534.68 = REVENUE FROM PRIME INC. = TOTAL REV in that
  fixture). The six wage rows and profit 580.73 are unchanged.


## One design detail to know

- If two loads with miles ever share one order number, the order's line
  sum is counted once, on the first load; the next load gets 0.00. The
  check still compares the right total.
- This never occurs in the 17 weeks.
- The view-only list shows the order's sum on both loads (its stage 1
  behaviour, unchanged).


## What could not be verified here

- Live database, device and real PDFs. The fixtures are the stored
  readings.
- A "Read again" makes a new AI read, which can differ.


## Ship list

- PENDING_SQL: none.
- `npm run build:reader`: done. The bundle is committed in 5528bbf.
- Redeploy ai-import FIRST (the gate is bundled):

```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile"
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ai-import.ps1
```

- Then the OTA (JS only, no native build):

```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
npx eas-cli update --branch preview --message "Prime loads check from the week's own revenue lines (stage 2)"
```

- On the tablet:
  1. Close and reopen the app twice, and confirm the Settings version line
     shows the new update.
  2. Use "Try reading them again" on 10-02 first.
  3. Expected: the same profit and deposit. After certify, the loads show
     1,552.33 / 633.07 / 269.86.
  4. Then 07-31, 09-25, 10-16 and 11-20, one week at a time.
- Stage 3a ships first if it has not shipped yet. Both can go in one
  redeploy + OTA, but rule 9 says one change at a time.
- Rollback: `git revert 5528bbf`, then `npm run build:reader`, the
  ai-import redeploy and the OTA.
