# Golden Settlement — the profit engine's permanent oracle

> Owner decision 2026-10-13. Read before touching `computeKpis()`,
> `trueProfit.ts`, `cpm.ts`, `settlementReconciliation.ts`,
> `primeOperatingStatement.ts` or the settlement mapper.
> Test: `app/src/data/__tests__/goldenPrimeSettlement.test.ts`.

## The document

`GRWLLG-OY-PrimeInc6.pdf` — Prime Inc, unit 283940, week ending
2026-08-21, 8 pages, 2,327 miles. Home showed This Week's Profit ~$4,549
(earlier $1,936); the correct figure, verified by hand against Prime's
printed totals and its Statement of Income and Expense, is **$2,534.36**.

| Figure | Value |
|---|---|
| Owner revenue | 4,783.75 (line haul 3,345.12 + fuel surcharge 1,230.86 + EP OTHER 175.00 + incentives 32.70 + toll .07) |
| Reimbursements | 312.80 (reefer fuel 216.30 + wash interior 95.50 + PR 1.00) |
| Deductions printed | 3,212.19, of which non-expenses 650.00 (warranty advance 500, personal advance 50, performance bond 100) |
| Real expense | 2,249.39 |
| Profit | 2,534.36 = net due 1,884.36 + 650.00 |
| Deposit | 1,884.73 = net due 1,884.36 + interest .37 |
| Miles | 2,327 (2,081 loaded + 246 empty); LTD/QTD 10,146 is not the week |
| Per mile | RPM 2.06, CPM 0.97, PPM 1.09 |

## Rules this settlement fixed

1. **Reimbursements offset expenses, every carrier.** A reimbursement
   repays a cost already booked, so `canonicalExpenseBreakdown()` subtracts
   it; it is never counted as revenue (RPM stays on the carrier's revenue).
   Prime prints the same convention (REEFER FUEL 262.53 − 216.30 = 46.23).
   Settlement-linked reimbursements follow their settlement's truck and
   week; unlinked ones (Maintenance-screen warranty credits) are
   fleet-level rows (NULL-truck rule). Every expense source, reimbursements
   included, is a REQUIRED argument — never `= []`.
2. **Duplicate-fuel guard is per row** (`resolveFuelRows()`). A
   settlement-linked fuel row is skipped only when a withheld fuel line of
   the same settlement matches it (amount within one cent — charged, or
   net of the row's own discount — and same fuel type or date); each line
   covers one row. Other rows count once, at the CHARGED amount: the
   per-line FUEL DISCNT column is informational because the UD/RD/ED
   credits apply the discount. The old guard skipped every linked row and
   lost the whole week's fuel when the AI put fuel only in the fuel lists.
3. **Settlement-linked fuel and reimbursements belong to their
   settlement's week** (`filterSettlementLinkedRowsToWindow()`), not to the
   per-line purchase date (fuel bought 8/13 on a week ending 8/21).
4. **Trailing minus** — `"184.85-"` / `".37-"` = negative
   (`app/src/import/amount.ts`, shared by the mapper and the checks).
5. **Import checks run only on printed totals** (`settlementReconciliation.ts`):
   deduction lines (+ fuel-list rows no line covers) = total deductions;
   revenue lines = gross; reimbursement lines = total reimbursed;
   gross + reimbursements − deductions = net due. A missing total skips its
   check (null never fails, never guessed). Save stays blocked on a
   mismatch, with "Save anyway, flagged needs-review" (confidence 'low' +
   `reconciliationOverride` in parsed_json).
6. **Prime operating statement, real layout** (Prime-only, total level):
   TOTAL REVENUE = gross; MILES = miles; TOTAL OPERATING EXPENSES =
   deductions − reimbursements − interest; TOTAL STATEMENT = net due +
   interest. Prime books lines under its own headings ($1.00 fuel card
   under WIRE CHARGE, PR 1.00 as PERSONAL PYMNT RCV, 16.25 split 15.25
   WEIGHT TICKETS + 1.00 WIRE CHARGE), so never reconcile line by line.
   The .37 interest appears only in this reconciliation line.
7. **Profit bridge** (`computeKpis().bridge`, Home: tap the profit) —
   net pay + non-expense withheld lines − expenses that never passed
   through a settlement + reimbursements not on a settlement = profit.
   Any unexplained difference is shown, never hidden. No deposit columns
   (owner decision: older weeks have none, so the bridge would start from
   different figures on different weeks).
8. **Truck fixed-cost estimate**: in CPM/PPM only. This Week's Profit
   (`computeKpis().net`) does NOT include it; the bridge states it as a
   note. RPM − CPM = PPM holds everywhere. Exception kept as-is and
   asserted by the test: Per-Truck Profitability's own `netProfit`
   (`buildTruckComparison()`) DOES subtract it.

## The eight traps (each has its own test)

1. Trailing-minus credits. 2. FUEL DISCNT column is informational.
3. Deductions span pages 1-2 (AS 23.50 + 65.87 = 89.37).
4. A reimbursement offsets its own expense. 5. "ADV FOR WEIGHT TICKETS"
16.25 is a real scale expense — it relies on Prime's seeded `WT / WEIGHT
TICKETS` code-map row; the generic classifier alone reads any "ADV" as an
advance repayment. 6. Revenue from OWNER REVENUE, not LOAD/TRIP REVENUE.
7. Pages 7-8 are attachments. 8. Net due 1,884.36 vs deposit 1,884.73.
