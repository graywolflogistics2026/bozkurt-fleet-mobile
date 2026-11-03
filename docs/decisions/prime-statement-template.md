# Prime statement template (owner decision 2026-11-03)

Prime's Statement of Income and Expense (WEEKS TOTAL column) prints the
same labels in the same blocks every week; a line is left out when its
WEEKS TOTAL is blank. Code: `app/src/import/primeStatementTemplate.ts`
(`PRIME_TEMPLATE`, `diagnosePrimeBlocks()`, `blockDiagnosisLine()`).
Prime only (carrier isolation): never applied to another carrier.

## Blocks and labels (print order)

| Block | Printed total | Labels |
|---|---|---|
| REVENUE | TOTAL REVENUE | REVENUE FROM PRIME INC., EXTRA PAY, PICKUP/STOP OFF PAY, FUEL SURCG BILL, REEF FUEL SURCG, SAFETY INC, SERVICE INC, OUTSIDE LUMPER 1099 PAY, TOLL 1099 PAY |
| FUEL | TOTAL FUEL,OIL,TAX | TRACTOR FUEL, TRACTOR FUEL DISCOUNT, TRACTOR DEF, REEFER FUEL, REEFER FUEL DISCOUNT, DEF DISCOUNT, STATE FUEL TAX |
| REPAIR | TOTAL EQUIPMENT REPAIR AND MAINT. | UNIT REPAIR EXPENSE, RO PARTS/REPAIR |
| TIRES | TOTAL TIRES | TIRES |
| MISCELLANEOUS | TOTAL MISCELLANEOUS | TOLLS, LUMPERS, OT LOAD/UNLOAD ADVANCE, ADVANCES, WEIGHT TICKETS, QUALCOMM COST, WIRE CHARGE, TRIP XPRESS CHG, TRAILER WASH, COMPANY STORE, PRIME POINT-OF-SALE, PREPASS WEIGH STATION, OPERATOR TRK EXTRAS, PERSONAL PYMNT RCV, MISCELLANEOUS |
| OUT OF POCKET | TOTAL OUT OF POCKET COSTS | OUT OF POCKET COSTS |
| FIXED COST | TOTAL FIXED COST | PHYSICAL DAMAGE INSURANCE, BT/DH INSURANCE, LICENSE AND PERMITS, STATEMENT PREPARATION, OPERATOR OCCUP ACC, FEDERAL HWY TAX |
| OTHER INCOME AND EXPENSE | TOTAL OTHER INCOME AND EXPENSE | ACCRUAL PERFORMANCE BOND, INTEREST INCOME FROM DEPOSIT, INTEREST EXPENSE ON OVER DRAW, START UP & EXCESS MILEAGE COST |

FUEL + REPAIR + TIRES + MISCELLANEOUS = TOTAL VARIABLE COSTS; variable +
out of pocket + fixed + other = TOTAL OPERATING EXPENSES; TOTAL REVENUE +
TOTAL OPERATING EXPENSES = TOTAL STATEMENT; TOTAL STATEMENT + PRIOR WEEK
BALANCE FORWARD = TOTAL CASH FLOW = SETTLEMENT TO OPERATOR = payout.

Every template label is a known line in `primeStatementLines.ts` (test
`primeStatementTemplate.test.ts`). A new label Prime starts printing goes
into both, in the same block.

## Missing-line detection

For a block whose read lines do not add up to its printed total:
- **missing** = template labels of the block that were not read (labels
  this account printed on earlier statements first);
- **read twice** = labels read more than once;
- **pages** = the statement pages its lines were read from (each line
  carries its page since 2026-11-03, `tagStatementLinePages()` in
  `supabase/functions/ai-import/chunking.ts`); a block with nothing read
  uses the pages of the blocks printed before and after it.

A variable block with neither lines nor its TOTAL line read, while TOTAL
VARIABLE COSTS has a gap, carries that gap. When several variable blocks
are empty, the line names them all ("REPAIR or TIRES"). The single label
of a block cannot be proven from the totals alone.

The diagnosis goes into the re-read reason (`rereadRequestFor()`, logged on
the job), the Send report (`importAudit.ts`, section "Statement blocks that
do not add up") and the job verdict details (Diagnostics).

## Priority of evidence (same day)

When the printed totals tie among themselves (TOTAL STATEMENT check and the
cash chain pass), a block subtotal mismatch (variableCosts,
operatingExpenses) is a line-details warning: the week is saveable from
the printed totals, profit ties to TOTAL OPERATING EXPENSES through one
"lines not read" row (`statementRoute.ts`), and the line rows are not
stored. The subtotal blocks only when the printed totals do not tie.

## Profit lines the owner types (same day)

Profit from the printed totals needs only these lines, by label
(`PROFIT_LINES`): ADVANCES, PRIME POINT-OF-SALE, OPERATOR TRK EXTRAS,
PERSONAL PYMNT RCV, ACCRUAL PERFORMANCE BOND, INTEREST INCOME FROM DEPOSIT.
When one of them is missing from a block that does not add up
(`profitLinesToAsk()`), the certify card shows one field per line with the
printed label instead of failing the week; Certify waits until they are
answered. A typed amount becomes a statement line of its block, signed as
Prime prints it and flagged `typed` (`withTypedStatementLines()`); 0 means
"not printed this week" — no $0 row, the label goes to
`operating.typedNotPrinted` so it is not asked again. The gate and profit
then recompute from the edited reading.
