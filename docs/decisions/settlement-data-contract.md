# Settlement data contract (what the code does, 2026-11-13)

Written from the code as it stands at 2db3897 (owner decision 2026-11-13:
"write it from what the code and golden-settlement.md actually do today;
list every difference; change no code for it"). This is the SPEC the new
reader (`docs/decisions/settlement-reader-2026-11.md`) must satisfy. Where
an older doc says something else, the section "Differences" at the end
lists it; the code is what is described here.

## 1. The contract object

The reader hands the app ONE `Extraction` (`app/src/import/types.ts`) with
`docType: 'settlement'` and a `settlement` object. Everything downstream
(gate, card, save, statement route, KPIs) reads only that object.

| Group | Fields the app reads | Who uses them |
|---|---|---|
| Dates (printed text) | `settlementDateRaw`, `printDateRaw`, `statementWeekEndingRaw`, `operating.weekEndingRaw` | `printedDates.ts` parses; the model's own ISO dates are never used once a raw date was read |
| Identity | `carrier`, `unit`, `driverName` | carrier isolation, truck/driver match |
| Settlement totals | `grossRevenue` (TOTAL REV), `reimbursements` (TOTAL REIMBURSED), `totalDeductions` (TOTAL DEDUCTIONS FROM TRUCK), `netPay` (NET AMOUNT DUE UNIT), `depositAmount` + `totalLabels.depositAmount` (payout line and its printed label), `payoutMethod` | `settlementReconciliation.ts`, `printedTotalsOf()` |
| Settlement lines | `revenueItems`, `reimbursementItems` (with `code`), `deductions` (with `code`), `loads`, `tractorFuel`/`reeferFuel`, `milesLines`, `totalMiles`, `loadedMiles` | line route, detail rows, miles split, Prime code map |
| Statement (Prime) | `operating.lines[{section,label,amount}]`, `operating.totalLines[{label,amount}]`, `operating.recapLines`, `weekMiles`, `priorWeekBalanceForward`, `settlementToOperator`, `directDeposit` (+ labels), `payoutMethod`, YTD fields, escrow fields | `buildPrimeStatementCheck()`, `statementWeekOf()`, `readPrimeEscrow()` |
| Attachments | `maintenance`, `tolls` | detail rows only, never a total |

Amounts are signed as printed: a trailing minus is negative
(`amount.ts` `parseAmount`). Block totals come ONLY from a line whose
label starts with TOTAL (`statementTotalLabels.ts` `totalFieldOfLabel()`);
a regular line never becomes a total (07/17 MISCELLANEOUS 6.50-).

## 2. Gate identities (Prime statement route)

`settlementStatement.ts` `buildPrimeStatementCheck()`; every check runs
only when both sides were printed; tolerance $1.00 (miles 1).

| Check id | Identity | Blocks? |
|---|---|---|
| `statementTotal` | TOTAL REVENUE + TOTAL OPERATING EXPENSES = TOTAL STATEMENT | yes |
| `totalCashFlow` | TOTAL STATEMENT + PRIOR WEEK BALANCE FORWARD = TOTAL CASH FLOW | yes |
| `settlementToOperator` | SETTLEMENT TO OPERATOR = TOTAL CASH FLOW (or the computed cash flow) | yes |
| `directDeposit` | payout line = SETTLEMENT TO OPERATOR (or cash flow) | yes |
| `variableCosts` | fuel + repair + tires + misc block totals = TOTAL VARIABLE COSTS | only when the printed totals do NOT tie |
| `operatingExpenses` | variable + out of pocket + fixed + other = TOTAL OPERATING EXPENSES | only when the printed totals do NOT tie |
| `revenueLines`, `section_*` | lines of a block = its TOTAL line | never (line-details note) |
| `grossMatches` | settlement TOTAL REV = statement TOTAL REVENUE | yes (`gross_differs`, after the statement passes) |
| `milesMatch` | statement MILES = settlement miles | never |
| `statementWeekEnding` | statement week (YY/MM/DD) = settlement date | yes (`date_mismatch`) |
| `mergeConflict` | one TOTAL label printed with two values | yes |

Settlement side (`settlementReconciliation.ts`, every carrier):
- gross + reimbursements − deductions = net due (`net_due_differs`);
- printed payout = net due + balance forward + interest
  (`deposit_differs`; skipped when the payout is a NET DUE line).

The printed totals TIE when `statementTotal` passes, `totalCashFlow` or
`settlementToOperator` passes, and no cash-chain check fails
(`printedTotalsTie`). Then a block subtotal that does not add up is only a
note.

Required (`primeGateMissing()`): TOTAL REVENUE, TOTAL OPERATING EXPENSES,
TOTAL STATEMENT, the statement week, and SETTLEMENT TO OPERATOR unless the
week is negative. TOTAL VARIABLE COSTS and TOTAL FIXED COST are only
required while the printed totals do not tie.

Negative week: TOTAL CASH FLOW < 0. Then SETTLEMENT TO OPERATOR and the
payout are not required. Owed to carrier = −TOTAL CASH FLOW, deposited =
0 (`settlementDeposit()`).

Other carriers: printed gross, deductions and net due must exist and tie
(gross + reimbursements − deductions = net due), and the line items must
add up (profit comes from them).

## 3. Headline figures (what the card shows and saves)

- Revenue = TOTAL REVENUE.
- Deposited = the printed payout line when one was read (not a NET DUE
  line), else SETTLEMENT TO OPERATOR, else TOTAL CASH FLOW, else TOTAL
  STATEMENT + balance forward. Never computed from lines. A value < 0 is
  owed to carrier, deposited 0.
- Profit (`statementRoute.ts` `statementWeekOf()`) = TOTAL REVENUE − the
  counted statement lines:
  - Excluded, never expenses: ADVANCES, PRIME POINT-OF-SALE (meals),
    OPERATOR TRK EXTRAS (truck cost basis), ACCRUAL PERFORMANCE BOND and
    INTEREST INCOME.
  - PERSONAL PYMNT RCV: a credit is owner money in; a charge is an
    expense.
  - A block whose lines differ from its printed TOTAL gets one
    "(lines not read)" line for the difference. A gap to TOTAL VARIABLE
    COSTS or TOTAL OPERATING EXPENSES gets one line too. So expenses always
    tie to TOTAL OPERATING EXPENSES.
- Escrow / held by carrier = PERF BD EMGCY FD YTD, else the accounts-page
  balance (`primeEscrow.ts`).

## 4. Golden weeks (owner workbook, 13 weeks, 2026-11-13)

Fixture: `app/src/settlementReader/__tests__/fixtures/prime13Weeks.ts`
(converted from `prime-13-hafta-dogru-rakamlar.xlsx`, sheet "Detay").
Every week ties:
- net due = revenue + reimbursed − deductions;
- gross due = net due + balance forward + interest income − interest
  expense;
- profit = revenue − real expense;
- the bridge difference is 0;
- the YTD columns are continuous.

13-week totals: revenue 58,772.17, deposited 26,463.71, profit 32,221.06,
miles 22,286.

## 5. Differences between the older docs and the code

1. `golden-settlement.md` rule 5 says a mismatch can be saved with
   "Save anyway, flagged needs-review". The code has no override since the
   simple import flow (batch D2): a gate failure saves nothing.
2. `golden-settlement.md` rule 6 says:
   - TOTAL OPERATING EXPENSES = deductions − reimbursements − interest;
   - TOTAL STATEMENT = net due + interest.

   The code checks neither. It checks the statement chain (section 2) and
   ties the two sides only through TOTAL REV = TOTAL REVENUE and the
   payout identity.
3. `golden-settlement.md` writes profit as a bridge from the deposit
   (1,884.73 + 550 + 100 − 0.37 − 1.00). The code computes profit as
   TOTAL REVENUE − counted statement lines (section 3). It gives the same
   number. The bridge is only an explanation (`computeKpis().bridge`).
4. `golden-settlement.md` "Deposit 1,884.73 = net due + interest". In the
   code the deposit is READ (payout line or SETTLEMENT TO OPERATOR), and
   that identity is only a check (`depositMismatch`, $1.00).
5. Zero:
   - P3 (2026-11-13) says zero is a valid value.
   - In the code, a printed 0 counts as NOT PRINTED for every statement
     total and settlement total (`printedTotal()`, `labeledStatementTotals`
     `printed()`), so a TOTAL printed 0.00 skips its check.
   - Negative values are valid in both.
6. Tolerances: older docs say "to the cent" in places. The code uses $1.00
   for every dollar identity, $0.01 for escrow and 1 for miles.
7. `prime-statement-source.md` / `simple-import-flow.md`: the app runs the
   gate and the server decides re-reads (`job_verdict`, max 3 reads). The
   new reader moves the decision to the server and allows max 2 reads.
   Same gate, same identities.
8. `golden-settlement.md` trap 3 ("deductions span pages 1-2") and the
   page-merge rules (`settlement-import-chunking.md`) describe the
   page-by-page reader. The new reader reads the content range in one
   call: no page merge exists.
9. `statement-reading-2026-10.md`:
   - The model mix (statement Opus, lines Sonnet, attachments Haiku) and
     step C (dual read, profiles) are replaced by the new reader. Its
     models are: content Opus, range detection and attachments Haiku.
   - `AI_IMPORT_ALLOW_FABLE` stays false.
