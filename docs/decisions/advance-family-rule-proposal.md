# Advance family rule for Prime WA lines (proposal, 2026-11-25)

Status: DESIGN ONLY. No code changed, no SQL run, nothing deployed.
Nothing in this file changes a number. Every rule below is Prime only and
lives in the Prime modules (`primeLineGroups.ts`, `primeLoads.ts`), behind
`isPrimeCarrier()`.

Follows `docs/decisions/line-details-gate-proposal.md` (2df6aa6). Stage 1
of that file (view-only load revenue from the revenue lines) is done
(03f28de). This file is the detailed design for its stage 4
(line_details_differ) and refines its stage 2 (loads check).

Weeks in scope (all saved with `statement.linesNotSaved = true`):
2026-11-20, 10-23, 10-16, 10-09, 10-02, 09-25, 09-11, 08-14.
Optional: 07-31 (it also ties with an LE late fee of 251.22). 07-17 is out
of scope (the 3,999 personal payment week).

How to read the evidence: amounts marked "inferred" come from the owner's
totals plus the rule "one 1.00 wire fee per weight-ticket line". They fit
every week to the cent, but only the export in answer 6 proves them line
by line.


## 1. Where the WA/ADVANCES group is compared today, and why each week differs

### The code path

- `buildPrimeGroupChecks()`, `app/src/import/primeLineGroups.ts:80-133`.
  The `advances` group is defined at line 66:
  - Settlement lines: deduction lines with printed code `WA`.
  - Lines left out: any whose description matches `/\bWEIGHT\s+TICKETS?\b/i`
    (`excludeDesc`, applied at line 91).
  - Netted: reimbursement lines with code `WA`. A reimbursement line with
    no code is netted only if its description matches `/\bADVANCE\b/i`
    (lines 97-104). A line with ANY other code is never netted. So an
    `LE` "LATE FEE*" line is never netted.
  - Statement side: minus the sum of statement rows labelled `ADVANCES`.
    A missing row counts as 0 (lines 87 and 106).
  - Tolerance: $1.00 (line 71). The group runs only when at least one WA
    line remains (line 96).
- `lineDetailsDifference()`, `app/src/import/reviewVerdict.ts:81-89`. It
  takes the LARGEST difference among the failed groups and the
  settlement-total issues of `checkSettlementReconciliation()`
  (`settlementReconciliation.ts:81-158`).
- `evaluateSettlementGate()`, `app/src/import/settlementGate.ts:196-219`.
  - Any difference means `lineDetails = 'mismatch'`. So does
    `splitPrimeLoads().matches === false` (line 207).
  - The week then saves without line rows (`aiImportSave.ts:475-490`).
  - Only the largest difference is stored as the review reason
    `line_details_differ` (`settlementStatement.ts:709-710`), so smaller
    differences are hidden behind it.

Fuel-list rows (`tractorFuel`, `reeferFuel`) that no deduction line covers
are added only in two places:
- the deductions total (`summedSettlementDeductions()`,
  `settlementReconciliation.ts:58-79`);
- the TOTAL group (`primeLineGroups.ts:125-127`).

They are never added to the advances group or to the fuel groups.

A fuel-list row counts as covered only if a deduction line has the same
amount and is a fuel line by text or category (`resolveFuelRows()`,
`app/src/stats/trueProfit.ts:180-218`, which uses `isWithheldFuelLine()`).

### Each week, as the code computes it

The advances group computes: (WA lines without weight tickets) − (WA
reimbursement lines) − ADVANCES.

- 11-20: 195.35 − 0 − 192.80 = **2.55**. This is the fee on ADVANCE
  DEBEFL. There are no weight-ticket lines (no WEIGHT TICKETS row).
- 10-23: 527.25 − 16.25 (weight tickets, inferred: 15.25 + 1.00) = 511.00,
  with no ADVANCES row = **511.00**. This is the lumper advance (510 +
  1.00).
- 10-09: 385.05 − 32.50 (inferred: 30.50 + 2 × 1.00) = **352.55** (350 +
  2.55).
- 09-25: 319.05 − 22.50 (inferred: 20.50 + 2 × 1.00) = **296.55** (293 +
  3.55).
- 10-02: 537.05 − 22.50 (inferred) = **514.55** (lumper 202 + late fee
  312.55). The LE reimbursement of 310 is not netted because its code is
  LE, not WA.
- 10-16: 1,717.25 − 16.25 (inferred) = **1,701.00** (lumper 698 + fuel
  principal 999.00 + fees 4.00).
- 09-11: 2,365.91 − 38.75 (inferred: 35.75 + 3 × 1.00) = 2,327.16, minus
  ADVANCES 50 = **2,277.16**.
- 08-14: 595.00 − 45.00 (4 weight-ticket lines: 16.25 + 6.25 + 16.25 +
  6.25) = 550.00, minus ADVANCES 550 = **0.00**. The group passes.
  - Verified in code: the committed fixture of the real 08-14 week
    (`app/src/data/__tests__/golden0814Fixture.ts`) gives `advances`
    550.00 / 550.00 / 0.00, and every other group ties.
  - So 08-14's stored 94.68 comes entirely from the 47.34 sign error
    (answer 5), through the revenue-lines-vs-TOTAL REV issue.

Your reading in A is confirmed, with two precisions:
- (a) The netting uses only code WA (or a codeless line that says
  ADVANCE), so the LE late-fee reimbursement is never netted.
- (b) 08-14 does not fail the advances group at all.

### Differences that may be hidden behind the stored one

- **10-16 and 09-11, fuel groups.** The statement books the fuel principal
  of an "ADV FOR UF-/RF-" line under TRACTOR FUEL / REEFER FUEL. The UF
  and RF groups count only UF/RF lines. So if those weeks also have UF
  lines, `tractor_fuel` is short by the UF principal and `reefer_fuel` by
  the RF principal (answer 3).
- **10-16 and 09-11, TOTAL group.** It ties ONLY if the advance-funded
  fuel is not also printed in the fuel purchase list. If it is printed
  there, the TOTAL group and the deductions total count it twice
  (answer 3).
- **10-23, 10-09, 09-25.** Not verified by hand. The export in answer 6
  covers them.


## 2. Design: the "advance family" check (one named Prime group)

### Name and place

Group `advance_family` in `primeLineGroups.ts`. It replaces the `advances`
entry of `GROUPS` and is computed by its own function. The result keeps
the `PrimeGroupCheck` shape and adds one optional field:
`reason?: AdvanceFamilyReason`.

### Inputs (settlement side)

- Every deduction line with printed code `WA`. Each is classified by its
  printed description: upper case, spaces collapsed. The first matching
  rule wins, in this order:
  1. WEIGHT: `^ADV FOR WEIGHT TICKETS?$`. Statement row: WEIGHT TICKETS.
  2. LUMPER: `^ADV FOR OUTSIDE LUMPER$`. Statement row: LUMPERS.
  3. FUEL: `^ADV FOR ` followed by one or more `UF-` / `RF-` pairs, each
     with an amount (`UF- 136.84 RF- 12.16`). The whole text must be
     consumed: any leftover word means "unparsable". UF principal = sum of
     the UF amounts; RF principal = sum of the RF amounts. Amounts are
     parsed with `parseAmount()`. The statement rows are TRACTOR FUEL /
     REEFER FUEL, and these principals go to the fuel groups (answer 3).
  4. LATE FEE: `^ADV FOR LATE FEE$`. It is paired with the reimbursement
     lines with code `LE` and description `/\bLATE FEE\b/`. Nothing goes
     on the statement.
  5. PLAIN: `^ADVANCE\b` (ADVANCE, ADVANCE DEBEFL, ADVANCE EXT WARRANTY
     PURCHASE, ADVANCE GLOVES ...). Statement row: ADVANCES. WA
     reimbursement lines (advances taken) are netted here exactly as
     today, so 07-17 keeps today's arithmetic.
  6. Anything else is UNRECOGNIZED, for example "WKLY PYMT OF ADV" or
     "ADV IN PYMTS" (Prime codes ADV 97-99) or "ADV FOR TOLLS".
- Other lines that the same statement rows carry: these are open owner
  decision D2. The check is exact, so a wrong choice fails loudly and
  never absorbs.
  - Deduction lines with code `LM` go to LUMPER.
  - Deduction lines with code `WT` go to WEIGHT.
  - Deduction lines with code `FC` (FUEL CARD CHARGE) go to WIRE.

### Statement side

Rows labelled ADVANCES, LUMPERS, WEIGHT TICKETS and WIRE CHARGE
(`normalizeStatementLabel`). Each is taken as a charge: minus the sum of
its rows. A missing row counts as 0.

### Derived fees (never read, always computed)

- FUEL, per line: fee = line amount − (UF principal + RF principal).
- LATE FEE: fee = Σ late-fee lines − Σ LE late-fee reimbursement lines.
- WEIGHT: fee = Σ WEIGHT lines (incl. WT) − WEIGHT TICKETS.
- LUMPER: fee = Σ LUMPER lines (incl. LM) − LUMPERS.
- PLAIN: fee = Σ PLAIN lines − Σ WA reimbursement lines − ADVANCES.

### The check (exact to the cent, no tolerance)

settlement = Σ all derived fees
statement = WIRE CHARGE − Σ FC lines
passed = |settlement − statement| < 0.005

### Named reasons. Each one fails the group, so the week stays unsaved.

Nothing is absorbed:
- `advance_unrecognized`: a WA line in class 6. The difference reported
  is that line's whole amount, so it can never be 0.
- `advance_fuel_unparsable`: an "ADV FOR" line that names UF/RF but whose
  text is not fully consumed, or an amount that does not parse.
- `late_fee_not_reimbursed`: ADV FOR LATE FEE lines with no LE late-fee
  reimbursement line.
- `advance_fee_out_of_range:<class>`: a class or line fee below 0.00, or
  above 2.55 × that class's line count. A negative fee means the principal
  is larger than what was paid: a misread or a wrong row. The 2.55 cap is
  open owner decision D3; observed fees are 0.00, 1.00 and 2.55.
- `fees_differ`: Σ fees ≠ WIRE − FC.

### Results on the evidence (Σ fees vs WIRE − FC)

- 11-20: plain 2.55 = 3.55 − 1.00.
- 10-23: 527.25 − 510 − 15.25 = 2.00 = 3.00 − 1.00.
- 10-09: 385.05 − 350 − 30.50 = 4.55 = 5.55 − 1.00.
- 09-25: 319.05 − 293 − 20.50 = 5.55 = 6.55 − 1.00.
- 10-02: 537.05 − 201 − 20.50 − 310 = 5.55 = 6.55 − 1.00.
- 10-16: 1,717.25 − 999.00 − 698 − 15.25 = 5.00 = 6.00 − 1.00.
- 09-11: 2,365.91 − 1,339.16 − 50 − 934 − 35.75 = 7.00 = 8.00 − 1.00.
- 08-14: 595 − 550 − 41 = 4.00 = 5.00 − 1.00.
- The 2,533.36 golden week (`goldenPrimeSettlement.test.ts`, W/E
  08-21): 566.25 − 550 − 15.25 = 1.00 = 2.00 − 1.00.

### Replacing the old comparison

- Delete the `advances` entry from `GROUPS` and add `advance_family` to
  the `PrimeLineGroup` type.
- Old stored readings keep `group: 'advances'` inside
  `parsed_json.reviewWarnings`. That is audit text only; nothing
  recomputes from it.
- Keep the `importScreen.group.advances` i18n key so the review screen
  can still show an old warning, and add `importScreen.group.advance_family`
  in all 7 locales (en first).
- Saved weeks are not re-evaluated. A week changes only when the owner
  uses "Read again" on it.
- Carrier isolation stays as it is: `buildPrimeGroupChecks()` returns null
  for any carrier that is not Prime.


## 3. Fuel advances and double counting

### What the code does today with "ADV FOR UF-/RF-" lines

- UF / RF groups: never included (the code is WA). The statement's
  TRACTOR FUEL / REEFER FUEL rows include the principal, so these groups
  fall short by that principal whenever they run. A group runs only if
  the week has at least one UF/RF line.
- `advances` group: included in full (principal + fee). That is the bulk
  of 1,701.00 and 2,277.16.
- TOTAL group and the deductions total:
  - The WA line is counted once, as a deduction line.
  - The fuel purchase list row is counted AGAIN if the same purchase is
    printed there, because the WA line is not a fuel line
    (`isWithheldFuelLine()` needs the word fuel/diesel/def/reefer or the
    category Fuel & DEF; "ADV FOR UF- 850.00" has neither). So it never
    covers the row.
  - Whether Prime prints advance-funded fuel in the purchase list is not
    known from here. The export (answer 6, `tractorFuel` / `reeferFuel`)
    decides it.
- So yes: on the check side, the fuel can be counted twice, but only if
  it is in the purchase list.
- On the profit side after a save, the fuel is NOT counted twice:
  - The WA line is classed REPAYMENT, which is out of profit (answer 4).
  - The fuel row is counted once.
  - Profit for these weeks comes from the statement anyway
    (`statementRoute.ts`).

### Proposed rule (Prime only)

- (a) `tractor_fuel` group: settlement side = Σ UF lines + Σ UF principal
  of FUEL advances. `reefer_fuel` group: Σ RF lines − RF reimbursements
  + Σ RF principal. A group runs when either part exists.
- (b) Only if the export shows the purchase in the fuel list: in the Prime
  check only, a fuel-list row whose amount equals one parsed UF/RF
  principal (to the cent, same fuel type, each principal used once)
  counts as covered by that advance.
  - It applies to the TOTAL group and to the Prime deductions total.
  - `resolveFuelRows()` (the profit engine) is NOT changed: after save
    the WA row is out of profit and the fuel row must still count once.

### 10-16 and 09-11 under the proposal

The UF/RF split of each principal is from the description; the export is
needed.

- `advance_family`:
  - 10-16: fees 5.00 = 5.00. Ties.
  - 09-11: 7.00 = 7.00. Ties.
- `tractor_fuel` / `reefer_fuel`: Σ UF/RF lines + parsed principals vs
  TRACTOR FUEL / REEFER FUEL.
  - 10-16: principals 136.84 + 850.00 + 12.16 = 999.00, split between
    UF and RF as printed.
  - 09-11: 480.49 + 42.30 + 791.82 + 24.55 = 1,339.16.
  - They tie if TRACTOR FUEL + REEFER FUEL = Prime fuel-card lines +
    these principals, which is what your WA + FC equation says.
- TOTAL group: unchanged formula. It ties today unless the fuel list
  repeats the purchase; with rule (b) it ties in that case too. TOTAL
  OPERATING EXPENSES contains the fuel principal once (in the fuel rows)
  and the fees once (in WIRE); the settlement side contains the WA line
  once (principal + fee).


## 4. What a save writes for WA lines today, and for the 8 weeks

### Today's mapping in a week that passes

- `classifySettlementLines()` (`settlementLineClass.ts:51-89`) with
  `findCarrierCodeMatch()` (`carrierCodes.ts`). For Prime, a code LABEL
  printed in the description wins first, then the printed code.
- Each printed line becomes one deduction row at its FULL printed amount
  (principal + fee):
  - payment method Settlement Withheld;
  - `source` settlement;
  - `settlement_id` set.

How each kind of line is classed:
- ADV FOR OUTSIDE LUMPER: the label OUTSIDE LUMPER matches (LM).
  Category Lumper Fees, deductible yes, class EXPENSE_VARIABLE.
- ADV FOR WEIGHT TICKETS: the label WEIGHT TICKETS matches (WT; golden
  trap 5). Category Tolls & Scales, deductible yes, class
  EXPENSE_VARIABLE.
- ADVANCE, ADVANCE DEBEFL, ADVANCE EXT ...: the label ADVANCE matches
  (WA ADV 01). Category Advance Repayment, deductible no, class
  REPAYMENT, which is out of profit (`lineClass.ts:98-109`).
- ADV FOR UF-/RF-: no label matches; falls back to the printed code WA.
  Advance Repayment, REPAYMENT, out of profit.
- ADV FOR LATE FEE: there is no LATE FEE label in the map. Advance
  Repayment, REPAYMENT, out of profit.
- LE "LATE FEE*" (reimbursement section): LE is not in the code map, so
  `nonReimbursementCredits()` leaves it alone. It is saved as a normal
  reimbursement row of 310.00, which offsets expenses on the line route.
- FC FUEL CARD CHARGE: Bank & Merchant Fees.

Withheld rows are never tax deductions (invariant #1) and never reach
the accountant categories (origin rule).

### Prime sheet

The "Lumpers through settlement" block (`app/src/stats/settlementLumpers.ts`)
reads the statement LUMPERS row when there is one (201.00 in 10-02), and
the WA/LM rows only when the statement has no LUMPERS row. So the sheet
shows the statement figure and its "Difference (wire fee)" as today. It
cannot disagree with the statement for these weeks.

### Where the wire fee goes

Inside each row:
- 10-02: lumper row 202.00 (inferred) vs statement LUMPERS 201.00 +
  WIRE 1.00.
- The Deductions list (per-category detail) shows Lumper Fees 202.00 for
  that week, while the statement-based screens show 201.00 under Lumper
  Fees and 1.00 under Bank & Merchant Fees.

This is the same as the weeks that pass today: the 2,533.36 golden week
saves weight tickets 16.25 against statement 15.25. Profit, expenses,
CPM and tax do not read these rows for a statement-backed week
(`trueProfit.ts:328-329`, `kpi.ts:388-390`). Splitting each row into
principal + "wire fee" rows is open owner decision D4. It would change
the rows of weeks that already pass, so it is NOT part of this proposal.

### What would be saved per week after a successful "Read again"

These are class totals; per-line amounts are inferred until the export
arrives. Every week also gets its non-WA rows (fuel, UF/RF, repairs,
meals, bond, FC, loads).

- 11-20:
  - Advance Repayment 195.35 (REPAYMENT, includes the 2.55 fee).
- 10-23:
  - Lumper Fees 511.00.
  - Tolls & Scales 16.25.
- 10-09:
  - Lumper Fees 352.55.
  - Tolls & Scales 32.50.
- 09-25:
  - Lumper Fees 296.55.
  - Tolls & Scales 22.50.
- 10-02:
  - Lumper Fees 202.00.
  - Tolls & Scales 22.50.
  - Advance Repayment 312.55 (REPAYMENT).
  - Reimbursement row LE 310.00.
- 10-16:
  - Lumper Fees ~699-702 (698 plus the lumper lines' fees).
  - Tolls & Scales 16.25.
  - Advance Repayment for the fuel advances ~1,000-1,003 (REPAYMENT).
  - Fuel rows from the purchase list.
- 09-11:
  - Advance Repayment 50.00 (plain ADVANCE).
  - Lumper Fees ~934-938.
  - Tolls & Scales 38.75.
  - Advance Repayment for the fuel advances ~1,339-1,343.
- 08-14:
  - Advance Repayment 550.00.
  - Tolls & Scales 45.00 (4 rows), as in its golden fixture.

### Existing numbers that change

- Weeks already saved: none. The rule runs only at import and save. No
  backfill, no SQL.
- Weeks that pass today: same result. One exception: on a future re-read,
  a week with an unrecognized WA description would now stay unsaved,
  where today a $1 slack let it through. That is stricter, never looser.
- The 8 weeks, only after the owner re-reads each one. Profit, expenses,
  deposit, Cost/Mile and the tax estimate do not change (statement
  route; the goldens assert it). What changes on that week's detail
  screens, because rows now exist:
  - Deductions list rows and per-category detail;
  - Fuel gallons and MPG;
  - Truck Health (only if a UR/SH repair row carries an odometer);
  - reimbursement rows;
  - the Loads screen: real loads replace the view-only statement loads.
  The Prime sheet block is unchanged, because it reads the statement.

### Late-fee pair (open owner decision D5)

The 310.00 LE row would sit in the Reimbursements detail as an ordinary
reimbursement, while its 312.55 advance row is out of profit.
- For a statement-backed week this moves no total.
- On a Prime read without the statement page it would add 310.00 to line
  profit.

Proposal: when (and only when) an LE late-fee line is paired by the
advance family, save it as a credit with class REPAYMENT, as PR and WA
credits are today (`aiImportSave.ts:584-626`). The pair then nets to the
2.55 fee. It needs owner approval: it gives code LE a meaning, the same
way the ED built-in code was approved.


## 5. Stage 2 (loads from the revenue lines) and the 08-14 sign bug

### Stage 2 design (unchanged from the gate proposal A2, made exact)

In `splitPrimeLoads()`:
- Each load with miles takes its revenue from the sum of the revenue
  lines of its order number that match `LOAD_REVENUE_DESC` (already
  exported, `primeLoads.ts`).
- Revenue lines with no load order stay as adjustments (today's rule).
- Check: Σ load-revenue lines (loads + adjustments) vs REVENUE FROM PRIME
  INC., within the existing $1.00.
- `mapExtraction.ts` saves `loads.revenue` from the same per-order sum
  when the check passes (today: the reader's figure when it passes,
  else 0).

The view-only loads (stage 1) already use this sum, so the screen and the
saved rows will agree.

### A load with no revenue line

- Today a load whose `revenue` is missing reads as 0. The total check
  then fails unless the other loads happen to cover it. No named reason.
- Proposed: a load with miles and an order number but no matching
  load-revenue line is a named failure, `load_without_revenue_line`
  (order number kept). The loads check fails. Never a 0 that quietly
  passes, never the reader's figure as a fallback.
- A load with no order number: same named failure.
- Open owner decision D1: whether a loads failure alone still drops every
  line row (today) or only the load revenue (the 2026-10-17 rule, gate
  proposal A4).

### The 08-14 sign bug: where the minus is lost

- `toExtraction.ts` keeps a printed minus everywhere:
  - `cell()` uses `numOrNull`, which reads "47.34-" as −47.34
    (`lib/number.ts:30`);
  - `signedLineAmount()` (`toExtraction.ts:70-76`) returns a negative
    amount as is, and makes an unsigned revenue line negative when the
    reader says `direction: "charge"`;
  - `loads[].revenue` is `cell(l.revenue)`.
- `splitPrimeLoads()` adds adjustments with their sign (`amountOf`). The
  golden fixture with −47.34 gives 6,115.04 − 47.34 = 6,067.70 and
  `matches: true` (checked here).
- So the minus is lost in the READER OUTPUT. The model returned the
  revenue line as "47.34" with direction "credit" (and, if it also listed
  it under loads, "47.34" there; loads have no direction field).
- This cannot be proven from the stored data: `import_jobs.result_json`
  and `documents.parsed_json` hold the converted extraction (numbers),
  not the reader's raw text. A week saved before 2026-11-13 would come
  from the old prompt instead.
- The same +47.34 explains both 94.68s:
  - revenue lines vs TOTAL REV gives the stored `line_details_differ`
    (a `revenueLinesMismatch` issue);
  - the loads check gives `loads_revenue_mismatch`.

### Smallest named fix

Do NOT flip a sign in the app; that is a guess. Two parts:
- (i) After stage 2 the loads check no longer reads `loads[]` revenue, so
  only the revenue line's sign matters. That sign is already checked by
  revenue lines vs TOTAL REV.
- (ii) A named re-read trigger, `revenue_line_sign`. The case: the
  revenue lines differ from the printed TOTAL REV by exactly 2 × the
  amount of one line (to the cent), and that line has no miles (an
  adjustment). Then the server reads the settlement pages again instead
  of certifying without rows.
  - It goes in `settlementGate.ts` `nextImportStep()`, using the reader's
    existing re-read budget (max 2).
  - It reuses the `explainMismatch()` 'sign' idea (`machine.ts:263`).
  - The re-read either returns −47.34, or the week stays unsaved and
    names the line.

Optional extra: a one-line reader-prompt addition for revenue lines: "a
revenue line printed with a minus keeps the minus in amount".
- Same deploy and golden checks as gate-proposal stage 3.
- Any prompt change can shift other fields, so it ships alone.


## 6. Fixtures: what to export per week

Weeks: 2026-11-20, 10-23, 10-16, 10-09, 10-02, 09-25, 09-11, 08-14, plus
07-31 if wanted.

Needed from `documents.parsed_json` (via `settlements.document_id`):
- `settlement.carrier`.
- `settlement.deductions[]`: code, desc, amount. All WA, FC, LM, WT, UF,
  RF and every other line, because the TOTAL group needs them all.
- `settlement.reimbursementItems[]`: code, desc, ref, amount (WA, LE, RF,
  SF, PR ...).
- `settlement.revenueItems[]`: code, desc, order, amount (stage 2 and the
  sign bug).
- `settlement.wageItems[]`.
- `settlement.loads[]`: order, loadedMiles, emptyMiles, revenue. from/to
  are not needed.
- `settlement.tractorFuel[]` and `settlement.reeferFuel[]`: date, state,
  gallons, amount, discount (the double-count question). Location is not
  needed.
- Printed totals: `settlement.grossRevenue`, `totalDeductions`,
  `reimbursements`, `netPay`, `totalWageExpense`, `subtotalPriorWage`,
  `totalDeductionsFromSettlements`.
- `settlement.operating.lines[]`: section, label and amount (weeks
  column only), without payout/bank rows. Also
  `settlement.operating.weekTotalOperatingExpenses`.
- `parsed_json.settlementGate` and `parsed_json.reviewWarnings`: what the
  gate saw, with every failed group (not just the largest).

Needed from `settlements`:
- `statement.linesNotSaved`;
- `statement.reviewReasons`;
- `statement.prime.lines` (section, label, amount; no payout rows);
- `statement.prime.totals`;
- plus id, truck_id and week_ending.

Not needed and NOT exported: driverName, unit, payout labels, deposit
rows, accounts page, settlementTotalLines, pageMap. Nothing with bank
digits.

Read-only export SELECT. The owner runs it in the Supabase SQL Editor;
Claude never runs it. It returns one row per saved week:

```sql
with me as (
  select id from auth.users where email = 'alicembozkurt@gmail.com'
),
wk as (
  select s.id, s.week_ending, s.truck_id, s.statement, d.parsed_json as pj
  from settlements s
  join me on s.user_id = me.id
  left join documents d on d.id = s.document_id
  where s.week_ending in ('2026-11-20', '2026-10-23', '2026-10-16', '2026-10-09',
                          '2026-10-02', '2026-09-25', '2026-09-11', '2026-08-14', '2026-07-31')
)
select
  wk.week_ending,
  wk.truck_id,
  jsonb_build_object(
    'carrier', wk.pj -> 'settlement' -> 'carrier',
    'deductions', wk.pj -> 'settlement' -> 'deductions',
    'reimbursementItems', wk.pj -> 'settlement' -> 'reimbursementItems',
    'revenueItems', wk.pj -> 'settlement' -> 'revenueItems',
    'wageItems', wk.pj -> 'settlement' -> 'wageItems',
    'loads', (select jsonb_agg(l - 'from' - 'to')
              from jsonb_array_elements(case when jsonb_typeof(wk.pj -> 'settlement' -> 'loads') = 'array'
                                             then wk.pj -> 'settlement' -> 'loads' else '[]'::jsonb end) l),
    'tractorFuel', (select jsonb_agg(f - 'location')
                    from jsonb_array_elements(case when jsonb_typeof(wk.pj -> 'settlement' -> 'tractorFuel') = 'array'
                                                   then wk.pj -> 'settlement' -> 'tractorFuel' else '[]'::jsonb end) f),
    'reeferFuel', (select jsonb_agg(f - 'location')
                   from jsonb_array_elements(case when jsonb_typeof(wk.pj -> 'settlement' -> 'reeferFuel') = 'array'
                                                  then wk.pj -> 'settlement' -> 'reeferFuel' else '[]'::jsonb end) f),
    'grossRevenue', wk.pj -> 'settlement' -> 'grossRevenue',
    'totalDeductions', wk.pj -> 'settlement' -> 'totalDeductions',
    'reimbursements', wk.pj -> 'settlement' -> 'reimbursements',
    'netPay', wk.pj -> 'settlement' -> 'netPay',
    'totalWageExpense', wk.pj -> 'settlement' -> 'totalWageExpense',
    'subtotalPriorWage', wk.pj -> 'settlement' -> 'subtotalPriorWage',
    'totalDeductionsFromSettlements', wk.pj -> 'settlement' -> 'totalDeductionsFromSettlements',
    'operatingLines', (select jsonb_agg(jsonb_build_object('section', o -> 'section', 'label', o -> 'label', 'amount', o -> 'amount'))
                       from jsonb_array_elements(case when jsonb_typeof(wk.pj -> 'settlement' -> 'operating' -> 'lines') = 'array'
                                                      then wk.pj -> 'settlement' -> 'operating' -> 'lines' else '[]'::jsonb end) o
                       where coalesce(o ->> 'label', '') !~* '(deposit|card|acct|account|routing|bank)'),
    'weekTotalOperatingExpenses', wk.pj -> 'settlement' -> 'operating' -> 'weekTotalOperatingExpenses',
    'settlementGate', wk.pj -> 'settlementGate',
    'reviewWarnings', wk.pj -> 'reviewWarnings'
  ) as reading,
  jsonb_build_object(
    'linesNotSaved', wk.statement -> 'linesNotSaved',
    'reviewReasons', wk.statement -> 'reviewReasons',
    'primeLines', (select jsonb_agg(jsonb_build_object('section', o -> 'section', 'label', o -> 'label', 'amount', o -> 'amount'))
                   from jsonb_array_elements(case when jsonb_typeof(wk.statement -> 'prime' -> 'lines') = 'array'
                                                  then wk.statement -> 'prime' -> 'lines' else '[]'::jsonb end) o
                   where coalesce(o ->> 'label', '') !~* '(deposit|card|acct|account|routing|bank)'),
    'primeTotals', wk.statement -> 'prime' -> 'totals'
  ) as saved
from wk
order by wk.week_ending desc, wk.truck_id nulls last;
```

Before sending the result, glance through it: no row should show an
account or card number. Fixtures will be committed with amounts, labels
and codes only, under `app/src/import/__tests__/fixtures/`.


## 7. Test and regression plan; stages and deploys

### Goldens that must stay green, unchanged

- `goldenPrimeSettlement.test.ts`, the 2,533.36 week. Family result:
  plain 0 + weight 1.00 = WIRE 2.00 − FC 1.00.
- `goldenPrimeSettlement0814.test.ts`, 4,987.74. Family result: plain
  0 + weight 4.00 = 5.00 − 1.00. Every group still ties, as checked
  above.
- `statementLoads.test.ts`, including the isolation test.
- `coreBundle` (the bundled reader matches the source after
  `npm run build:reader`).
- `settlementGate`, `reviewVerdict`, `primeLoads`, `primeLineGroups` and
  `aiImportSave` suites.

### New tests

- One fixture per week (answer 6):
  - `advance_family` ties to the cent;
  - every other group and the TOTAL group tie;
  - `evaluateSettlementGate()` gives `lineDetails: 'match'`. For weeks
    that also need stage 2 or the sign fix, only after that stage lands.
- Unknown WA description (e.g. "ADV FOR TOLLS 25.00"): group fails with
  `advance_unrecognized`, the week saves without rows, and the reason is
  named.
- "ADV FOR UF- 136.8X": `advance_fuel_unparsable`.
- ADV FOR LATE FEE without LE: `late_fee_not_reimbursed`.
- One cent off (WIRE CHARGE 6.54 instead of 6.55 in 10-02): fails. No
  tolerance.
- A negative or too-large class fee: `advance_fee_out_of_range`.
- A non-Prime carrier with WA-looking lines: `buildPrimeGroupChecks()`
  returns null, no family check runs, and the line route is unchanged.
- Fuel: UF/RF groups include the parsed principals. If the export shows
  the fuel list repeats the purchase, the covered-row rule is tested and
  `resolveFuelRows()` is unchanged (a profit-engine test pins that).
- Stage 2:
  - loads revenue from lines per order;
  - `load_without_revenue_line`;
  - 11-13 still matches the save mapping;
  - 10-02 / 10-16 / 11-20 pass at their line sums.
- Sign: the 08-14 fixture with +47.34 in its revenue line gives the
  `revenue_line_sign` re-read, never a flip.

### Stages and deploys

One change per commit; after each shipped stage, one real-PDF import on
the tablet before the next.

1. Stage A (this file): docs only, nothing to deploy.
2. Stage 0: the owner runs the export SELECT (read-only). Fixtures are
   committed (tests only, red where a later stage is needed, marked
   `test.todo` until then). Nothing to deploy.
3. Stage 3a: the advance family check, replacing `advances`, plus the
   UF/RF principal and the new i18n key.
   - `npm run build:reader` (the gate is bundled in `core.gen.js`, and
     the server uses it for re-read decisions).
   - Redeploy ai-import with `scripts/deploy-ai-import.ps1`.
   - Then `npx eas-cli update --branch preview`. Function first, then the
     OTA.
4. Stage 3b (only if the export shows it): the fuel-list covered-row rule
   in the Prime check. Same deploys.
5. Stage 2: loads check from the revenue lines, and `loads.revenue` from
   the line. Same deploys.
6. Stage 4: `revenue_line_sign` re-read for 08-14 (optional prompt line
   separately). Same deploys.
7. Optional, owner decisions: D1, D4, D5, each its own stage.

### What "Read again" will show

- The settlement detail's "Line details were not saved ... [Try reading
  them again]" re-reads the content pages. That is a new AI read, one of
  the owner's reads.
- The gate runs with the new rules:
  - If every check ties, the CHECK AND CERTIFY card appears with the same
    headline profit and deposit. Certify replaces the week with its rows
    (invariant #10), and the quiet line disappears.
  - If something still differs, the week saves again without rows. The
    quiet line stays, and the stored reason names the remaining
    difference.
- Recommended addition with stage 3a: store every failed group and named
  reason, not only the largest, as `statement.lineDetailsCauses`. That is
  jsonb only, no SQL, no column.


## 8. Safety: nothing is weakened

A week saves its rows only when the gate returns `lineDetails: 'match'`.
That still requires ALL of the following, unchanged:

- Statement gate:
  - every statement identity;
  - the cash chain with balance forward;
  - statement week ending = settlement date;
  - TOTAL REVENUE = gross;
  - net due, wage identity and deposit;
  - the date gate;
  - no missing page.
- Settlement totals within $1:
  - deduction lines + uncovered fuel = TOTAL DEDUCTIONS FROM TRUCK;
  - revenue lines = TOTAL REV;
  - reimbursement lines = TOTAL REIMBURSED;
  - wage lines and the wage identity.
- Prime groups within $1: tractor_fuel, tractor_def, reefer_fuel, the
  three discounts, state_fuel_tax, repair, meals, performance_bond and
  the TOTAL group.
- NEW, exact to the cent: `advance_family`.
- Statement line sums and block subtotals.
- The loads check.

What gets looser, and why it is safe:
- The old `advances` group ($1) is replaced by `advance_family` (exact).
  It only changes WHICH statement rows the WA lines are compared with.
- A misread line amount still breaks the deductions total and the TOTAL
  group, which do not use the family at all.
- The UF/RF principal and the fuel-list covered-row rule use only figures
  printed in the description, matched to the cent.
- No tolerance is added. No difference is ever saved silently, and an
  unrecognized line keeps the week unsaved with its name.


## Recommended stage order

0 (export) → 3a (advance family) → 3b (if needed) → 2 (loads from lines)
→ 4 (08-14 sign) → Read again, one week at a time.

- 3a goes first because `line_details_differ` blocks all 8 weeks.
- With 3a alone, 10-23, 10-09 and 09-11 should save their rows, if the
  export shows no hidden differences.
- Stage 2 then rescues the loads weeks (10-02, 10-16, 11-20, 09-25), and
  stage 4 rescues 08-14.


## Open owner decisions

- D1. A loads failure alone: keep dropping every line row (today), or
  save the rows with loads revenue 0 and the week flagged (the 2026-10-17
  rule)?
- D2. Do LM lines belong to LUMPERS, WT lines to WEIGHT TICKETS and FC
  lines to WIRE CHARGE in the advance family? The export confirms it per
  week.
- D3. The per-line wire fee cap: 2.55, the largest fee seen, or no cap
  (exact sum and non-negative fees only)?
- D4. Split each advance row into principal + a "wire fee" row (Bank &
  Merchant Fees), so the row categories match the statement exactly?
  This changes rows of weeks that already pass, so it is a separate
  decision; recommended NO for now.
- D5. Give code LE (late fee reimbursement) the class REPAYMENT when it
  pairs with an ADV FOR LATE FEE line?
- D6. "WKLY PYMT OF ADV" / "ADV IN PYMTS" (ADV 97-99): unrecognized until
  a real week shows where the statement books them?
- D7. A "re-check the stored reading" action (no AI read) instead of
  "Read again" for these 8 weeks? It is cheaper. It would replace a week
  from `parsed_json`, and only stages 2/3 need it; stage 4 needs a real
  re-read anyway.


## Owner decisions 2026-11-25

- D1: keep today's behaviour. A loads failure alone still drops every
  line row.
- D2: YES. Deduction lines with code LM go to LUMPER, WT to WEIGHT and FC
  to WIRE.
- D3: the cap is 2.55 per advance line. For each class:
  0.00 <= fee <= 2.55 × line count.
- D4: NO wire-fee row split.
- D5: YES, but as its own LATER stage: the LE late-fee reimbursement will
  be saved as REPAYMENT when it is paired. In stage 3a the LE line is
  used only to derive the late-fee fee; saving is unchanged.
- D6: unrecognized WA descriptions stay unrecognized.
- D7: NO new re-check action; the owner uses "Read again".
- Also YES: store `statement.lineDetailsCauses` (jsonb only) with stage
  3a.


## Export results 2026-11-25

Source: the owner's read-only export of 17 real Prime weeks (2026-07-31 ..
2026-11-20), now the test fixture
`app/src/import/__tests__/fixtures/primeWeeks2026.json`.

These are the owner's independent calculations. Stage 3a re-checks them
in tests, and the stage 3a report lists any difference.

- `advance_family` as designed passes in all 17 weeks. That includes the
  weeks that save normally today: 08-07, 08-21, 08-28, 09-04, 09-18 and
  11-13. 10-30 and 11-06 have no WA lines, so the group does not run.
- Fees per week (each sum = WIRE CHARGE minus FC lines, exact):
  - 07-31: LATE 2.55 + LUMPER 2.00 = 4.55.
  - 08-07: WEIGHT 2.00.
  - 08-14: WEIGHT 4.00.
  - 08-21: WEIGHT 1.00.
  - 08-28, 09-04, 09-18: 0.
  - 09-11: FUEL 2.00 + WEIGHT 3.00 + LUMPER 2.00 = 7.00 (UF principal
    1,272.31, RF 66.85).
  - 09-25: WEIGHT 2.00 + LUMPER 3.55 = 5.55.
  - 10-02: LATE 2.55 + WEIGHT 2.00 + LUMPER 1.00 = 5.55.
  - 10-09: WEIGHT 2.00 + LUMPER 2.55 = 4.55.
  - 10-16: FUEL 2.00 + WEIGHT 1.00 + LUMPER 2.00 = 5.00 (UF principal
    986.84, RF 12.16).
  - 10-23: WEIGHT 1.00 + LUMPER 1.00 = 2.00.
  - 11-13: WEIGHT 3.00.
  - 11-20: PLAIN 2.55.
- No unrecognized WA description in 17 weeks. Seen: ADVANCE, ADVANCE
  DEBEFL, ADV FOR WEIGHT TICKETS, ADV FOR OUTSIDE LUMPER, ADV FOR UF- x
  [RF- y], ADV FOR LATE FEE. No LM- or WT-coded deduction lines occur.
- Fuel and totals:
  - With the UF/RF principals added, the UF and RF groups tie in all
    weeks.
  - The TOTAL group ties in all 17 weeks, and so do deduction lines plus
    uncovered fuel vs the printed TOTAL DEDUCTIONS.
  - There are ZERO uncovered fuel-list rows in all 17 weeks, so nothing
    is counted twice. Stage 3b (the fuel-list covered-row rule) is NOT
    needed and is dropped.
- Stage 2 check: per order, the revenue lines matching LOAD_REVENUE_DESC
  (plus lines whose order has no load with miles) equal the statement row
  REVENUE FROM PRIME INC. to the cent in 16 of 17 weeks.
  - Only 08-14 differs, by 94.68: the Linehaul 47.34- adjustment is
    stored as +47.34.
  - The reader's own per-load revenue differs in 07-31, 08-14, 09-25,
    10-02, 10-16 and 11-20.
- 07-31 is also saved with linesNotSaved, so 9 weeks, not 8.
- Expected after stage 3a alone:
  - 09-11, 10-09 and 10-23 can save their rows.
  - 07-31, 09-25, 10-02, 10-16 and 11-20 still need stage 2 (loads).
  - 08-14 needs stage 4 (sign).

Revised stage order: 3a (advance family) → 2 (loads from revenue lines) →
4 (08-14 sign) → D5 (LE as REPAYMENT) → Read again, one week at a time.


## Golden 07-17 under stage 3a (owner 2026-11-25, option 1)

Stage 3a keeps the rule as designed. A re-read of the golden 07-17 week
would now save the week WITHOUT its line rows. Its profit (−293.62),
deposit and PR personal payment are unchanged. The golden test
(`goldenPrimeSettlement0717.test.ts`) now expects this, with the named
causes: advance_unrecognized, advance_fee_out_of_range:lumper,
advance_fee_out_of_range:plain and fees_differ.

Recorded for later:
1. Evidence for a later D6 revision: in the 07-17 golden, "WKLY PYMT OF
   ADV" 550 ties exactly as PLAIN with fee 0.00. The arithmetic is 550 −
   the WA reimbursement lines 3,999.00 and 460.59 = −3,909.59, against
   ADVANCES +3,909.59. D6 is NOT widened now.
2. In this golden, the July layout has the LUMPER (215) and WIRE CHARGE
   (2.55) lines without codes. July-era weeks may therefore not be
   re-readable with their rows under the new rule.
3. 07-17 is not in the export, and its stored data is unchanged.
