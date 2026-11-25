# Advance family, stage 3a: report (2026-11-25)

Nothing was pushed, deployed or published, and no SQL was run. git status
is clean except the untracked `app/supabase/`.


## Commits (in order)

- 9a0aabb: Docs. Owner decisions and export results 2026-11-25, added to
  `docs/decisions/advance-family-rule-proposal.md`.
- de54128: Tests.
  - The export moved to
    `app/src/import/__tests__/fixtures/primeWeeks2026.json` (the `_note`
    key dropped). The docs copy was deleted and never committed.
  - Helper `fixtures/primeWeeks2026.ts` builds each week on the golden
    08-14 shape (`golden0814()` overrides).
  - Test `primeWeeks2026.test.ts`: the fixture reproduced the stored gate
    result (status, lineDetails and lineDifference) for all 17 weeks
    before any rule changed.
- e66d593: Stage 3a code, tests, reader bundle, i18n and CHANGELOG.
- The next docs commit: this report, plus the golden 07-17 note in the
  proposal.


## Test counts

- After e66d593: 225 suites, 5,413 passed, 6 todo, 0 failed. tsc clean.
  The coreBundle test is green after `npm run build:reader`.
- Before stage 3a (after de54128): 224 suites, 5,354 passed, 9 todo.


## What stage 3a changed

- `app/src/import/primeLineGroups.ts`:
  - `advance_family` replaces the `advances` group. It is listed in the
    same place (after repair). `buildAdvanceFamily()` is exported, along
    with `MAX_FEE_PER_ADVANCE_LINE = 2.55`.
  - Classes: WEIGHT, LUMPER, FUEL (UF-/RF- principals parsed, the whole
    text consumed), LATE (needs LE "LATE FEE"), PLAIN (ADVANCE..., netted
    with WA advances taken as before). LM goes to LUMPER, WT to WEIGHT and
    FC to WIRE.
  - The fees must equal WIRE CHARGE − FC to the cent. Each class:
    0.00 <= fee <= 2.55 × lines.
  - Named reasons: advance_unrecognized, advance_fuel_unparsable,
    late_fee_not_reimbursed, advance_fee_out_of_range:<class>,
    fees_differ.
  - `tractor_fuel` and `reefer_fuel` add the parsed principals. A group
    runs when it has lines OR a principal.
  - No fuel-list covered-row rule. `resolveFuelRows()` is unchanged.
- `settlementGate.ts`: a 'mismatch' result now carries `lineCauses`: every
  failed group with its reasons, every line-total issue, the loads check
  with its difference, statement line sums, and missing pages. A 'match'
  result is unchanged (no new key).
- `aiImportSave.ts`: when a week saves without line rows, it stores
  `statement.lineDetailsCauses` (jsonb only, no column, no SQL).
- New key `importScreen.group.advance_family` in all 7 locales ("Advances
  and wire fees"; es/ru/tr/hi translated, ar/uk English). The old
  `advances` key is kept.
- Unchanged: the loads check, every other group and tolerance, the
  statement gate, the save mapping of rows, and the reader prompt.


## 17-week gate (importDate 2026-11-25): before = stored result, after = stage 3a

- 2026-07-31: before mismatch 798.31 (advances). After: mismatch, the
  loads check only (+2,282.10). Needs stage 2.
- 2026-08-07: before match; after match (unchanged).
- 2026-08-14: before mismatch 94.68. After: mismatch 94.68 (revenue lines
  +94.68, loads +94.68). Needs stage 4.
- 2026-08-21: before match; after match (unchanged).
- 2026-08-28: before match; after match (unchanged).
- 2026-09-04: before match; after match (unchanged).
- 2026-09-11: before mismatch 2,277.16. After: MATCH.
- 2026-09-18: before match; after match (unchanged).
- 2026-09-25: before mismatch 296.55. After: mismatch, loads only
  (+2,004.13). Needs stage 2.
- 2026-10-02: before mismatch 514.55. After: mismatch, loads only
  (+954.83). Needs stage 2.
- 2026-10-09: before mismatch 352.55. After: MATCH.
- 2026-10-16: before mismatch 1,701.00. After: mismatch, loads only
  (+2,538.28). Needs stage 2.
- 2026-10-23: before mismatch 511.00. After: MATCH.
- 2026-10-30: before match; after match (unchanged; no WA lines).
- 2026-11-06: before match; after match (unchanged; no WA lines).
- 2026-11-13: before match; after match (unchanged).
- 2026-11-20: before mismatch 2.55. After: mismatch, loads only
  (+2,717.54). Needs stage 2.

Every week passes the statement gate before and after.


## Findings checked against the owner's calculation

Every finding was re-checked in tests (`advanceFamily.test.ts`,
`primeWeeks2026.test.ts`) and matched. Nothing differed:
- The fees per class and per week are exactly as listed, and each sum
  equals WIRE CHARGE − FC to the cent.
- The UF/RF principals are 09-11 1,272.31 / 66.85 and 10-16 986.84 /
  12.16.
- 10-30 and 11-06 have no WA line, so the group does not run.
- There is no unrecognized WA description. There are no LM- or WT-coded
  lines.
- Every Prime group, including TOTAL, ties in all 17 weeks. Deduction
  lines + uncovered fuel tie TOTAL DEDUCTIONS in all 17 weeks. The only
  line-total issue is 08-14 revenue lines (+94.68).
- After stage 3a alone, 09-11, 10-09 and 10-23 match. 07-31, 09-25,
  10-02, 10-16 and 11-20 fail only the loads check. 08-14 fails only on
  the sign.

Small additions, not differences:
- 07-31 also has a PLAIN fee of 0.00 (ADVANCE 500 + 50 = ADVANCES 550).
- In the 5 loads-only weeks, `lineDifference` becomes null, because the
  loads check carries no amount there. So a re-read of one of these weeks
  before stage 2 stores the review reason loads_revenue_mismatch but no
  longer line_details_differ. The loads difference is in
  `lineDetailsCauses`.

Fixture limits:
- The export had no printed date text. The fixture derives the settlement
  date and statement week ending (YY/MM/DD) and the print date (the day
  before) from the week ending.
- The statement week totals come from the saved statement totals.
- Neither limit affects the line checks. The fixture reproduced every
  stored gate result exactly.


## Tests changed in existing goldens (no number changed)

- `goldenPrimeSettlement.test.ts` (2,533.36 week, W/E 08-21): the
  assertion on the removed `advances` group (550/550) became
  `advance_family` 1.00/1.00, with fees weight 1.00 and plain 0.00.
- `goldenPrimeSettlement0814.test.ts` (4,987.74): the group list row
  `advances 550/550` became `advance_family 4/4`. Every other row is
  unchanged.
- `goldenPrimeSettlement0717.test.ts` (owner option 1): a re-read of
  07-17 now saves without line rows.
  - The assertion "only RF 5.34 is saved as a reimbursement row" became
    "linesNotSaved, causes named, no reimbursement rows".
  - Profit −293.62, the deposit and the PR 3,999.00 contribution are
    unchanged and still asserted.
  - Recorded in the proposal (section "Golden 07-17 under stage 3a"):
    - "WKLY PYMT OF ADV" 550 ties exactly as PLAIN with fee 0.00 (550 −
      3,999.00 − 460.59 vs ADVANCES +3,909.59), as evidence for a later
      D6 revision.
    - The July layout prints LUMPER 215 and WIRE CHARGE 2.55 without
      codes, so July-era weeks may not be re-readable with their rows.
    - 07-17 is not in the export; its stored data is unchanged.


## What could not be verified here

- Live database, device and real PDFs. The fixtures are the stored
  readings, not new AI reads.
- A "Read again" makes a new AI read, which can differ from the stored
  reading.


## Ship list for stage 3a

- PENDING_SQL: none.
- `npm run build:reader`: done. The bundle is committed in e66d593.
- Edge Function: ai-import must be redeployed (the gate is bundled in
  `core.gen.js`). Deploy it FIRST:

```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile"
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ai-import.ps1
```

- Then the OTA (JS only, no native build):

```powershell
cd "C:\Users\Latitude 5520\Downloads\bozkurt-fleet-mobile-starter\bozkurt-fleet-mobile\app"
npx eas-cli update --branch preview --message "Prime advance family check (stage 3a): advances, lumpers, weight tickets and wire fees reconcile exactly"
```

- On the tablet:
  1. Close and reopen the app twice, and confirm the Settings version line
     shows the new update.
  2. On week 10-23 (then 10-09, then 09-11), use "Try reading them again".
  3. Expected: the CHECK AND CERTIFY card with the same profit and deposit.
     After certify, the week shows its line rows and the "Line details
     were not saved" line is gone.
  4. Home profit is unchanged.
  5. One week at a time.
- Rollback: `git revert e66d593`, then `npm run build:reader`, the
  ai-import redeploy and the OTA.
