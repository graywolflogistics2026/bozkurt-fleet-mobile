# Printed dates; held by carrier; one deposit per statement

> Owner decisions 2026-10-29 ("TWO FIXES: DATES (definitive) and ESCROW /
> HELD / DEPOSIT"). Read before touching `dateGuard.ts`,
> `printedDates.ts`, the ai-import date prompt, `primeEscrow.ts`,
> `heldByCarrier.ts`, or anything that shows escrow, held or deposit
> figures.

## Part A: dates

- **The model never interprets a date.** ai-import returns each
  settlement date AS PRINTED: `settlementDateRaw` ("26/08/14"),
  `printDateRaw` ("8/13/26"), `statementWeekEndingRaw` ("26/08/14"). It
  also returns the PDF's own `pdfCreationDate` (Info dictionary,
  `supabase/functions/ai-import/pdfInfo.ts`). The app parses them in
  `app/src/import/printedDates.ts`.
- **Prime:** SETTLEMENT DATE and the statement WEEK ENDING are YY/MM/DD.
  The print DATE is M/D/YY. Line dates are MMDD, and their year comes from
  the week ending: a month and day later than the week ending is the
  previous year (`lineDateFromWeekEnding`). The model's year is ignored on
  every Prime date (`sanitizeExtractionDates`).
  - Proof: "26/08/14" and "26/08/21" share "26/08", and only the third
    number moves by 7.
  - Read as DD/MM/YY they become 2014-08-26 and 2021-08-26, which was the
    "old years" bug.
- **Gate** (`checkPrimeSettlementDates`):
  - Settlement date minus print date must be 0 to 7 days.
  - The week ends on a Friday (soft).
  - The statement week ending equals the settlement date EXACTLY. The
    year/day swap tolerance of 62c6435 is removed.
  - The PDF CreationDate is within 3 days of the print date, when present.
  - The date is no later than the import date + 10 days.
  - A date more than 14 months before the import date asks for
    confirmation.
  - An older reading (no printed text) always asks.
- **Any failure:** Save is blocked. The preview asks one line, "The
  statement prints 26/08/14. I read it as Aug 14, 2026. Correct?", with
  [Yes] and [Pick another date] (`SettlementDateQuestion.tsx`). The answer
  is stored as `settlement.dateConfirmed` for exactly that date.
  `saveExtraction` re-runs the gate and throws without that answer.
  Nothing before 2020 is ever saved.
- **Other carriers:** no Prime rule. If only one digit order fits, that
  date is used. Otherwise the app uses the format remembered for that
  carrier, else the one reading inside [print, print + 7], else it asks
  once. The confirmed format is stored in `settlements.statement.dates`
  (§77 jsonb, no new SQL) and found again by `rememberedDateFormat`.
- **Saved weeks:** the "Needs a date check" list on Settlements
  (`findSavedWeeksNeedingDateCheck`) flags:
  - weeks before 2025-01-01;
  - weeks in the future;
  - a Prime week not on a Friday;
  - a `week_ending` different from the printed statement date in the jsonb.

  Each flagged week has a one-tap fix to the printed date, or a picker.
  A fix is never applied onto a week that already exists for the same
  truck.

## Part B: held by carrier, deposits

- **`calcEscrowBalance()` is removed.** It summed every Escrow & Deposits
  deduction, so re-imports, other trucks, and manual or other-carrier rows
  inflated it.
- **`primeEscrow.ts` reads what Prime prints:**
  - held = the balance sheet PERF BD/EMGCY FD, YTD TOTAL column (else
    page 3's PERFORMANCE BOND/EMER FUND PAID balance);
  - prior = page 3's prior balance;
  - week = ACCRUAL PERFORMANCE BOND (else page 3's this-week amount).
- **Escrow checks** never block Save: prior + week = held, page 3 = page 6,
  and page 5 = page 3. A failure marks only that week's held figure
  `unverified`.
- **Interest check** (information only): net = escrow prior + balance
  forward. The expected interest is |net| × APR / 52, as income when
  net ≥ 0 and as an expense when net < 0.
  - 8/21: 500 × 3.83% / 52 = 0.37.
  - 8/14: −802.92 × 3.83% / 52 = 0.59.
- **`heldByCarrier(settlements, truckScope, { window, deductions })`:**
  - Per carrier account (carrier + the printed unit, else the truck), it
    takes the newest week with a printed held balance that did not fail,
    shown "as of" that week. The fleet figure is the sum of those.
  - A week saved without a truck folds into the carrier's only account.
  - Accounts with nothing printed give a labeled "estimate from imported
    weeks" (one statement per week), else "not printed yet".
  - `heldAtMonthEnd` uses the last settlement inside the month.
- **Where it shows:** Settlements card, Accountant Package ("at month end"
  / "at year end"), Cash Flow This month, and the daily tip (real figure
  and its as-of date).
- **Deposited:** the sum of per-week printed deposits, one per statement
  (`onePerStatementWeek`: carrier + week + printed unit + deposit), in
  `computeKpis`, `primeDepositsYtd` and Cash Flow monthly.
- **Prime YTD comparison:** now uses YTD SETTLEMENT TO OPERATOR, not TOTAL
  STATEMENT: "Prime's YTD says $8,099.66; your imported weeks add up to
  $4,957.30 (3,142.36 is earlier weeks not imported)".
