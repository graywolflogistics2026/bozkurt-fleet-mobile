# Prime statement as source, source labels, profit is never the deposit

> Owner decisions 2026-10-13 (design table + D1–D9, R1–R4, the BANK
> DEPOSIT add-on). Read before touching `computeKpis()`, `trueProfit.ts`,
> `cpm.ts`, the import checks, or anything that shows profit or deposits.
> Builds on `docs/decisions/golden-settlement.md`.

## Two settlement layers

- **Statement-backed Prime week** (`settlements.statement.source =
  'prime_statement'`, self-check passed, not saved past a failing check):
  profit comes from Prime's own Statement of Income and Expense. Every row
  linked to that settlement (withheld deductions, fuel list,
  reimbursements, settlement maintenance/tolls, lumper companions) stays
  as detail and is never counted again (`splitSettlementLayers()`).
- **Every other week** (other carriers, Prime PDFs without the page,
  weeks imported before §77, flagged saves) uses the line-level engine.
- **The owner's own rows** (no `settlement_id`) are a separate layer on top.

Carrier gate: the Prime route is selected only when the statement page was
actually extracted from a Prime statement. A null/unknown carrier never
selects it; Prime labels never touch another carrier.

## Formula (statement-backed week)

gross = TOTAL REVENUE · expenses = −Σ(expense lines, signed as printed)
− personal-payment offset · profit = gross − expenses ·
fixed = the statement's FIXED section, variable = everything else (R2) ·
CPM adds the truck fixed-cost estimate as before (never in profit) ·
deposit = the printed deposit · profit = deposit + excluded lines added
back − interest income.

Golden week: 4,783.75 − 2,249.39 = 2,534.36; fixed 255.77, variable
1,993.62; 1,884.73 + 550.00 + 100.00 − 0.37 = 2,534.36.

BALANCE FORWARD (owner decision 2026-10-17): deposit = TOTAL STATEMENT +
PRIOR WEEK BALANCE FORWARD (signed as printed; "1,202.92-" = the owner
owed Prime). The balance forward is never revenue or an expense; the
bridge shows it as its own line ("Prior week balance forward", +1,202.92
when last week's deficit was recovered). Interest EXPENSE ON OVER DRAW is
a counted expense. Second golden week (W/E 2026-08-14): 7,914.10 −
2,926.36 = 4,987.74; 3,072.57 + 1,202.92 + 550.00 + 62.25 + 100.00 =
4,987.74. Rows that are not dollar lines (MILES, WEEKS IN SERVICE, PRIOR
WEEK BALANCE FORWARD, SETTLEMENT TO OPERATOR, PERF BD/EMGCY FD) never
enter a section sum (`statementInfoRow()`).

## Line table (`app/src/import/primeStatementLines.ts`)

| Class | Lines |
|---|---|
| Revenue | REVENUE FROM PRIME INC., EXTRA PAY, PICKUP/STOP OFF PAY, FUEL SURCG BILL, REEF FUEL SURCG, SAFETY INC, SERVICE INC, OUTSIDE LUMPER 1099 PAY (D1), TOLL 1099 PAY |
| Fuel & DEF | TRACTOR FUEL, TRACTOR DEF, REEFER FUEL, their DISCOUNT lines, DEF DISCOUNT, STATE FUEL TAX (D2) |
| Maintenance & Repairs | UNIT REPAIR EXPENSE, RO PARTS/REPAIR — above the existing $2,500 one-off threshold: in profit, out of CPM (D5) |
| Tires | TIRES |
| Tolls & Scales | TOLLS, WEIGHT TICKETS, PREPASS WEIGH STATION |
| Lumper Fees | LUMPERS (D1); OT LOAD/UNLOAD ADVANCE — needs-review on first appearance (D3) |
| ELD & Communications | QUALCOMM COST, TRIP XPRESS CHG |
| Bank & Merchant Fees | WIRE CHARGE, INTEREST EXPENSE ON OVER DRAW (D8) |
| Truck Wash / Supplies / Misc | TRAILER WASH / COMPANY STORE / MISCELLANEOUS |
| Misc + first-appearance review (D7) | OUT OF POCKET COSTS, START UP & EXCESS MILEAGE COST |
| Fixed | PHYSICAL DAMAGE INS, BT/DH INS (Insurance—Truck); LICENSE AND PERMITS, FEDERAL HWY TAX; STATEMENT PREPARATION; OPERATOR OCCUP ACC (Insurance—Health, fixed bucket — R2) |
| Excluded | ADVANCES (advance), ACCRUAL PERFORMANCE BOND (escrow), PRIME POINT-OF-SALE (meals, per diem — D4), OPERATOR TRK EXTRAS (truck extras, tracked in Truck Cost Basis — D6), INTEREST INCOME (own bridge line — D8) |
| R1 | PERSONAL PYMNT RCV — an offset only up to the same settlement's PR reimbursement lines; any remainder is owner money in (excluded, needs-review) |
| Unknown label | Misc (revenue-section: revenue), needs-review on first appearance — never dropped, never guessed |

## Self-check (blocks Save; "Save anyway, flagged needs-review")

Each block's lines = its printed total; fuel + repair + tires + misc =
total variable; variable + out of pocket + fixed + other = total operating
expenses; revenue + operating expenses = total statement; total statement
+ prior week balance forward = TOTAL CASH FLOW = SETTLEMENT TO OPERATOR =
DIRECT DEPOSIT (2026-10-17); TOTAL REVENUE = settlement gross; MILES =
settlement miles; the statement page's week ending = the settlement's
(a year/day-swapped reading of "26/08/14" counts as the same date only
when the swap lands exactly on it). Line route deposit check: net due +
balance forward + interest (income +, expense −) = printed deposit.
Page-by-page merging calls two values for a header total a conflict only
when both came from the same printed label (`settlement.totalLabels`,
ai-import `chunking.ts`). Checks run only on printed totals. A flagged save keeps
the figures but profit uses the line route, labeled Unverified. The import
preview lists every line the AI read with its printed sign and every
check with its numbers (R3).

## Source labels (every week)

Verified by Prime statement / Totals match (gross + reimbursements −
deductions = net due within $1, each check only on printed totals) /
Unverified (flagged needs-review until marked reviewed; profit captioned
"estimate from line items"). Old weeks stay Unverified until re-imported
(D9, no backfill).

## Profit is never the deposit; the deposit is read, never computed

- `printed.deposit`: DIRECT DEPOSIT, else SETTLEMENT TO OPERATOR, else net
  due (labeled "Net due"). Amount only — bank digits are scrubbed from
  every stored extraction (`app/src/import/bankDigits.ts`).
- Check (all carriers): net due + interest income = printed deposit
  within $1.
- A negative week with no deposit line shows "Owed to carrier" and adds 0
  to Deposited.
- Home: "Profit, not deposits" + "Deposited to your bank: $X" for the same
  period and truck scope — a sum of per-week printed figures, never a
  running balance (Business Balance stays retired).
- Cash Flow income reads the same per-week deposit (cash view); profit is
  the P&L view.
- Prime YTD: "Prime's YTD says $X; your imported weeks add up to $Y" —
  informational, never a warning.

## Audit ledger

`computeKpis().ledger`: every row COUNTED / OFFSET / EXCLUDED with a reason;
Σ counted − Σ offset = expenses.total. Used by Home's Expenses explainer
(R4: same resolver, Revenue − Expenses = Net Profit), the bridge's "Show
every row" and "Share audit" (plain text via the native share sheet).

## The gate (owner decision 2026-10-17, item 6)

Gate = every check INSIDE the statement (each block's lines = its printed
total; variable + fixed + other = total operating expenses; revenue −
expenses = TOTAL STATEMENT; the cash chain TOTAL STATEMENT + balance
forward = TOTAL CASH FLOW = SETTLEMENT TO OPERATOR = DIRECT DEPOSIT) plus
the statement week ending = settlement week ending. Every one must have
been read and must pass (`gateMissing` lists what was not read — never
skipped). Warn only: miles, TOTAL REVENUE vs the AI's header gross, a
header total two pages read differently, every line-item total, the
per-group checks (`primeLineGroups.ts`).

Gate passed: profit from the statement; settlement gross = TOTAL REVENUE;
deposit = SETTLEMENT TO OPERATOR (`depositSource 'settlement_to_operator'`);
net due stays the printed page-3 figure; any warning -> amber "line
details differ by $X" + needs-review (`reviewReasons` statement_warning /
line_details_differ), Save works, never the line route; loads keep
revenue only if the loads check passed. Gate failed or no statement: the
old blocking guard, with "Save as estimate" (flagged, line route,
Unverified). Stored statements from before the gate keep the old rule
(`isStatementBacked()` uses `prime.gatePassed` only when present).

Checks run only in the app (import preview + `aiImportSave.ts`); the
server reads, merges and stores. After an `eas update` a ready job's stored
reading is re-checked with no re-read; a reading from the older prompt (no
printed labels / no balance forward field) is shown "Read with an older
version" with Read again first.

## Review screen (item 7, `reviewVerdict.ts`, `SettlementReview.tsx`)

Green "Verified by Prime's statement. Profit $X, deposited $Y" [Save];
green "Totals match. Profit estimated from line items. $X" [Save] (no
statement, printed totals tie — never "Verified"); amber "Saved from the
statement; line details need a look" [Save] + Details; red "We couldn't
verify this week" + one sentence [Read again][Save as estimate][Discard].
Details: every check in plain words, the per-group table, the statement
lines the AI read, pages not read, the raw AI note, Share audit (every
line with amounts, checks, groups; bank digits removed). Read again
(`reread_job`) re-reads only the content pages of an unsaved ready job
with the current prompt; attachments stay stored ("Read the missing
pages" after saving).
