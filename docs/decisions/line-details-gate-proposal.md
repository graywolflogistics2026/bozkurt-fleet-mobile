# Line details gate: why 8 Prime weeks saved without line rows (proposal, 2026-11-25)

Status: DESIGN ONLY. No code, no SQL run, nothing deployed. Owner decision
needed on section D before any stage starts.

Context: 8 of the owner's 15 latest Prime weeks were saved with
`statement.linesNotSaved = true`. Their saved statements record two causes:
- `line_details_differ`, all 8 weeks. Differences: 2.55, 94.68, 296.55,
  352.55, 511.00, 514.55, 1701.00, 2277.16.
- `loads_revenue_mismatch`, 4 weeks.

No week failed on a block subtotal or a missing page. The income lines tie
to the printed gross every week, so profit is not in question (see C).

Both causes lead to the same result. `aiImportSave.ts:475-490` sees the
gate's `lineDetails === 'mismatch'` (`settlementGate.ts:200-219`) and drops
every line row of the week: loads, fuel, deductions, maintenance,
reimbursements and tolls.


## A. The loads check

### What is compared

`splitPrimeLoads()` (`app/src/import/primeLoads.ts:52-90`), Prime only:

- Left side, from the reader's `settlement.loads[]`: the sum of
  `loads[].revenue` over loads that print miles, plus adjustments.
  Adjustments are mileless load lines, plus revenue lines that look like
  load revenue (LINEHAUL / TRIP REV / LOAD REV / OWNER REV) for an order
  that has no load.
- Right side: the statement row(s) labelled REVENUE FROM PRIME INC.
  (`settlement.operating.lines`, revenue section).
- Tolerance: $1.00 (`primeLoads.ts:30`).

On a mismatch the gate marks line details as 'mismatch'
(`settlementGate.ts:206-207`). The week then saves without any line rows.

That is stricter than the rule written in `primeLoads.ts`' own header (owner
2026-10-17): "on a mismatch the loads are saved with no revenue and the
week is flagged needs-review".

### Where `loads[].revenue` comes from

Every PDF import has gone through the settlement reader since 2026-11-13.
Its prompt is `CONTENT_PROMPT` in `app/src/settlementReader/prompt.ts:24`,
bundled into `supabase/functions/ai-import/reader/core.gen.js`. For loads
it says only:

  "loads: one entry per printed load/trip (order number, origin,
  destination, loaded miles, empty miles, the load's own revenue amount),
  as printed".

It does not say which column. `toExtraction.ts:265-272` copies that value
straight into `loads[].revenue`.

The Prime rule "Load revenue is the OWNER REVENUE column, never the LOAD
REVENUE or TRIP REVENUE column (on a percentage load TRIP REVENUE 4,028.34
at .720 is OWNER REVENUE 2,900.40)" still exists. But it lives only in the
OLD prompt (`supabase/functions/ai-import/index.ts:518`,
`buildExtractionPrompt`). The settlement reader no longer uses that prompt;
it is now only the general (non-settlement) path. So the 2026-10-17 fix was
lost when the new reader replaced the old one on 2026-11-13.

The reader's revenue LINES (`settlementLines`, section revenue) are a
separate list. Each RV line's amount is the amount the line pays the owner,
which on Prime is OWNER REVENUE. They become `revenueItems` and tie to TOTAL
REV, as the owner sees.

### Why exactly 1/0.72 in three weeks

A Prime percentage load prints a trip (gross) revenue and the owner's share
at .720. When every load of the week is a percentage load and the model
copies the trip column for "the load's own revenue amount", the loads list
is exactly REVENUE FROM PRIME INC ÷ 0.72. That fits the evidence:
- 10-02: 3,410.09 × 0.72 = 2,455.26.
- 10-16: 9,065.27 × 0.72 = 6,526.99.
- 11-20: 9,705.48 × 0.72 = 6,987.94.

A ratio between 0.72 and 1 (09-25: 0.614 overall) means a week where the
model's column choice differed between loads, or where loads are paid
differently. Only that week's stored loads, order by order, can tell.

Weeks that pass (11-13: 7,088.08) are weeks where the model happened to
copy the owner column, or where the loads are not percentage loads. In
short: yes, the reader is sometimes copying the gross/trip column, because
its prompt never tells it which one.

### 08-14 (6,162.38 vs 6,067.70)

The difference is 94.68 = 2 × 47.34. That is the "Linehaul 47.34-"
adjustment counted as +47.34 instead of -47.34:
2,900.40 + 1,763.24 + 1,451.40 + 47.34 = 6,162.38.

The likely cause is the trailing minus being lost or the adjustment's sign
being read as a charge. That is the same week's figure the old prompt rule
(2) addressed.

94.68 is also one of the eight `line_details_differ` amounts. This week may
differ for that one reason on both checks. The SELECT in B shows it.

### Fix options

A1. Reader prompt.
- What: make the loads instruction carrier-neutral but exact: copy every
  revenue figure printed on the load line with its printed column header
  (for example `revenues: [{column: "TRIP REVENUE", amount}, {column:
  "OWNER REVENUE", amount}]`). The app then picks OWNER REVENUE for Prime in
  `toExtraction.ts`. Carrier isolation stays in the app; the model still
  only copies.
- Simpler variant: "the amount the load pays the owner". That puts meaning
  back into the prompt, against the reader's design rule.
- Risk: any prompt change can shift other fields. It must be re-checked on
  the golden weeks (08-14 and the 2,533.36 week) before shipping.
- Fixes new reads only. Old weeks need "Read again" (one AI read each).
- Needs: `npm run build:reader` + ai-import redeploy (with
  `deploy-ai-import.ps1`) + `eas update`.

A2. Compare the revenue LINES, not the loads list.
- What: in `splitPrimeLoads()`, take each load's revenue from the RV
  revenue line with the same order number (`revenueItems[].order`). Those
  lines are the owner's money and already tie to TOTAL REV. The loads list
  then supplies only miles, origin and destination. Also use that amount
  for the saved `loads.revenue` (`mapExtraction.ts`).
- Risk 1: the check gets weaker. It no longer checks the loads table's own
  revenue column; it checks that RV lines and REVENUE FROM PRIME INC agree.
  The owner's evidence shows they always do.
- Risk 2: orders must match. A load without an RV line, or two RV lines for
  one order (linehaul + adjustment), needs a rule. The proposal: sum all
  RV lines of that order. A load with no RV line keeps today's behaviour
  (mismatch).
- Works on stored readings as soon as a week is saved again. No new AI read
  is needed if a "save again from the stored reading" path exists (see D).
- Needs: app change + `npm run build:reader` (the gate is bundled into
  core.gen.js, and the server uses it to decide re-reads) + ai-import
  redeploy + `eas update`.

A3. Both.
- A2 makes the check correct whatever the model picks.
- A1 makes the stored per-load revenue correct for every carrier, and for
  the view-only "as printed" amount.

A4 (separate question). Go back to the 2026-10-17 rule.
- What: a loads mismatch alone saves the loads with no revenue and flags
  the week, instead of dropping every line row.
- On its own this rescues none of the 8 weeks, because all 8 also have
  `line_details_differ`. It only matters for future weeks.
- Needs the same deploys as A2.

Note on the view-only loads just built (175ae2c, e438ec8, not yet
published by OTA). In 10-02, 10-16 and 11-20 the "as printed" revenue shown
for each load is the TRIP column, not what Prime paid the owner. It is a
printed number, but the wrong one to show. Stage 1 below fixes the display.


## B. line_details_differ

### What is compared

`lineDetailsDifference()` (`app/src/import/reviewVerdict.ts:81-89`) takes the
LARGEST (by size) of two kinds of difference. The saved label
(`settlementStatement.ts:709-710`) is only that one number, so a week with
several differences shows just the biggest.

1. Settlement-page totals (`checkSettlementReconciliation`,
   `settlementReconciliation.ts:81-130`, tolerance $1.00):
   - Σ deduction lines + fuel-list rows no deduction line covers vs TOTAL
     DEDUCTIONS FROM TRUCK.
   - Revenue lines vs TOTAL REV.
   - Reimbursement lines vs TOTAL REIMBURSED.
   - Gross + reimbursements − deductions − wages vs NET AMOUNT DUE.
   - Wage lines vs TOTAL WAGE EXPENSE, and the wage identity.

2. Prime group checks (`buildPrimeGroupChecks`, `primeLineGroups.ts`,
   tolerance $1.00). Settlement deduction lines grouped by printed code are
   compared with the matching statement rows:
   - UF/TRACTOR FUEL, UE/TRACTOR DEF, RF/REEFER FUEL;
   - UD, RD, ED discounts; SF/STATE FUEL TAX;
   - UR+SH/UNIT REPAIR EXPENSE + RO PARTS REPAIR;
   - WA/ADVANCES (WA reimbursement lines netted; WEIGHT TICKETS excluded);
   - PO/PRIME POINT OF SALE; PB/ACCRUAL PERFORMANCE BOND (by size).

   Plus one TOTAL group: Σ all deduction lines + uncovered fuel-list rows +
   wages − ALL reimbursement lines − printed interest vs −TOTAL OPERATING
   EXPENSES.

The gate also counts statement lines that do not add up to their printed
block (`settlementGate.ts:201-202`), but the owner's weeks never hit that.

### Which lines can leave 2.55, 296.55, 352.55, 514.55, 511.00, 1,701.00

The pattern (a constant 2.55, plus a round dollar amount in some weeks)
points to the TOTAL group or the deductions total. These are candidates,
not yet proven:

- **The round part.** A line on one side that the other side books
  elsewhere or not at all. In the TOTAL group, ALL reimbursement lines are
  subtracted on the settlement side. A PR PERSONAL PAYMNT (owner money in,
  owner 2026-11-03) or a WA advance taken that the statement books outside
  TOTAL OPERATING EXPENSES leaves exactly its round amount as a residual.
  The same goes for a personal chargeback code (CARRIER_CODES.md: GA
  garnishment, AL 401K loan, CH child care, insurance codes) that Prime
  deducts from the settlement but does not put on the operating statement.
- **The 2.55 part.** A small charge or credit printed every week on one
  side only. Candidates:
  - a fixed weekly fee line;
  - interest that `printedInterestNetOf()` takes out with a different sign
    or from a different row than the one the settlement pages carry;
  - a fuel-list row (`tractorFuel`/`reeferFuel`) that no UF/RF line covers,
    so `summedSettlementDeductions()` adds it a second time.

  11-20 has only the 2.55, so it is the cleanest week to identify it.
- **2,277.16 and 1,701.00.** These are big enough to be a whole group:
  - a fuel purchase list double-counted against its UF line;
  - an advance taken (WA, reimbursement section) that ADVANCES nets
    differently;
  - a repair (UR/SH) booked on the statement under another label.
- **94.68 (08-14).** Very likely the 47.34 sign error from section A, seen
  through the revenue/net-due identity.

### The read-only SELECT (do NOT run it here; the owner runs it)

It lists, for weeks ending 2026-11-20 and 2026-10-02:
- every non-revenue line the reader stored (deduction lines with their
  group, reimbursement lines, wage lines, the fuel purchase lists, the
  statement rows as read and as saved);
- the printed totals and the saved review reasons.

Amounts are shown as stored text so that nothing is re-cast.

```sql
with me as (
  select id from auth.users where email = 'alicembozkurt@gmail.com'
),
wk as (
  select s.week_ending, s.statement, d.parsed_json -> 'settlement' as rd
  from settlements s
  join me on s.user_id = me.id
  left join documents d on d.id = s.document_id
  where s.week_ending in ('2026-11-20', '2026-10-02')
),
code_group(code, line_group) as (
  values ('UF', 'tractor_fuel'), ('UE', 'tractor_def'), ('RF', 'reefer_fuel'),
         ('UD', 'tractor_fuel_discount'), ('RD', 'reefer_fuel_discount'), ('ED', 'def_discount'),
         ('SF', 'state_fuel_tax'), ('UR', 'repair'), ('SH', 'repair'), ('WA', 'advances'),
         ('PO', 'meals'), ('PB', 'performance_bond')
)
select week_ending, part, kind, code, label, line_group, amount, detail
from (
  select wk.week_ending, 1 as part, 'settlement deduction line' as kind,
         l ->> 'code' as code, l ->> 'desc' as label,
         coalesce(cg.line_group, 'TOTAL group only') as line_group,
         l ->> 'amount' as amount, null::text as detail
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'deductions') = 'array' then wk.rd -> 'deductions' else '[]'::jsonb end) l
  left join code_group cg on cg.code = upper(trim(l ->> 'code'))
  union all
  select wk.week_ending, 2, 'settlement reimbursement line (subtracted in TOTAL group)',
         r ->> 'code', r ->> 'desc', coalesce(cg.line_group, 'TOTAL group only'),
         r ->> 'amount', r ->> 'ref'
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'reimbursementItems') = 'array' then wk.rd -> 'reimbursementItems' else '[]'::jsonb end) r
  left join code_group cg on cg.code = upper(trim(r ->> 'code'))
  union all
  select wk.week_ending, 3, 'settlement wage line', w ->> 'code', w ->> 'desc', 'TOTAL group only', w ->> 'amount', null
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'wageItems') = 'array' then wk.rd -> 'wageItems' else '[]'::jsonb end) w
  union all
  select wk.week_ending, 4, 'tractor fuel purchase list', null, concat_ws(' ', f ->> 'date', f ->> 'location', f ->> 'state'),
         'added only if no UF line covers it', f ->> 'amount', 'discount ' || coalesce(f ->> 'discount', '')
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'tractorFuel') = 'array' then wk.rd -> 'tractorFuel' else '[]'::jsonb end) f
  union all
  select wk.week_ending, 5, 'reefer fuel purchase list', null, concat_ws(' ', f ->> 'date', f ->> 'location', f ->> 'state'),
         'added only if no RF line covers it', f ->> 'amount', 'discount ' || coalesce(f ->> 'discount', '')
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'reeferFuel') = 'array' then wk.rd -> 'reeferFuel' else '[]'::jsonb end) f
  union all
  select wk.week_ending, 6, 'statement row as read', null, o ->> 'label', o ->> 'section', o ->> 'amount', null
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.rd -> 'operating' -> 'lines') = 'array' then wk.rd -> 'operating' -> 'lines' else '[]'::jsonb end) o
  where coalesce(o ->> 'section', '') <> 'revenue'
  union all
  select wk.week_ending, 7, 'statement row as saved', null, o ->> 'label', o ->> 'section', o ->> 'amount', null
  from wk
  cross join lateral jsonb_array_elements(case when jsonb_typeof(wk.statement -> 'prime' -> 'lines') = 'array' then wk.statement -> 'prime' -> 'lines' else '[]'::jsonb end) o
  where coalesce(o ->> 'section', '') <> 'revenue'
  union all
  select wk.week_ending, 8, 'printed total / saved check', null, t.key, null, t.value, null
  from wk
  cross join lateral jsonb_each_text(jsonb_build_object(
    'TOTAL DEDUCTIONS FROM TRUCK (read)', wk.rd -> 'totalDeductions',
    'TOTAL REIMBURSED (read)', wk.rd -> 'reimbursements',
    'TOTAL WAGE EXPENSE (read)', wk.rd -> 'totalWageExpense',
    'NET AMOUNT DUE UNIT (read)', wk.rd -> 'netPay',
    'TOTAL OPERATING EXPENSES (read)', wk.rd -> 'operating' -> 'weekTotalOperatingExpenses',
    'saved statement group totals', wk.statement -> 'prime' -> 'totals',
    'saved review reasons', wk.statement -> 'reviewReasons'
  )) t
) x
order by week_ending desc, part, line_group, label;
```

How to read it, one week at a time:
1. Add the part 1 amounts per `line_group` and compare each group with its
   statement rows in part 7 (statement rows are signed, an expense is
   negative).
2. The group that is off by the week's difference is the cause.
3. If every group ties, the cause is in the TOTAL group. Look for a part 2
   reimbursement line (PR, WA) or a part 1 line marked "TOTAL group only"
   whose amount equals the round part, and for a 2.55 line on one side only.
4. Also check part 4/5 for a fuel purchase that no UF/RF line covers.


## C. Options (analysis only)

Profit facts that hold for all three options. A week whose statement passed
the gate counts from its printed statement:
- `statementWeekOf()` (`app/src/stats/statementRoute.ts:99`) builds gross
  and expenses from the saved statement rows.
- `computeKpis()` adds them to the other rows (`app/src/stats/kpi.ts:388-390`).
- Rows linked to that settlement are detail only and are kept out of the
  totals (`app/src/stats/trueProfit.ts:328-329`).

So profit, expenses, Cost/Mile, deposit and the tax estimate do not change
whether line rows are saved or not. The golden tests
(goldenPrimeSettlement, goldenPrimeSettlement0814) must stay green either
way. What changes is detail:
- Deductions list rows;
- fuel gallons and MPG;
- maintenance rows feeding Truck Health;
- toll rows;
- reimbursement rows;
- the Prime sheet (withheld lumper lines are its only withheld rows).

### (1) Fix the reader or the comparison so these weeks reconcile

- What the user sees: re-read weeks save normally, with all their line
  rows. No new flags.
- Numbers that move:
  - None of profit, expenses or tax (statement route).
  - Detail screens gain rows: Deductions list, fuel gallons/MPG, Truck
    Health (a repair row can move a health baseline — that is a real number
    on a real screen), tolls.
  - Saved `loads.revenue` becomes the owner amount.
- Old weeks: unchanged until the owner uses "Read again" on each, which
  replaces the week (invariant #10). One week at a time, checked on the
  phone.
- Risk of a silent wrong number: LOW. The save still requires every check
  to tie. Only a known, named difference is accounted for (for example
  "PR lines are not operating expenses"), never a guess. Each fix gets a
  fixture from the real week.

### (2) A small tolerance

- What the user sees: weeks within the tolerance save their rows.
- Numbers: same as (1) for the weeks it lets through.
- What it buys: a $3 tolerance would rescue 11-20 (2.55) only. Nothing
  else is under $90. A percentage tolerance big enough to rescue the others
  would hide hundreds of dollars.
- Old weeks: as (1).
- Risk: MEDIUM to HIGH. A tolerance hides a difference without naming it.
  If the 2.55 is a real line booked on one side only, it is a recurring
  structural difference. It should be a named rule, not slack. The current
  $1.00 tolerance exists for rounding only. NOT recommended.

### (3) Save the lines anyway with a visible "needs review: $X difference" flag

- What the user sees: all line rows saved, and a flag on the week saying
  the line details differ from the statement by $X.
- Numbers that move:
  - Profit, expenses and tax: no (statement route).
  - Every row-based detail screen now shows rows that are, as a whole, off
    by $X, and nobody knows which row is wrong: Deductions per category,
    fuel gallons/MPG, Truck Health, tolls.
  - The flag would have to follow those rows to every place they appear
    (Deductions, Fuel, Truck Health, Accountant Package export, backup)
    to meet "never silently".
- Old weeks: as (1); they need a re-read or a re-save to get rows.
- Conflicts: it reverses the 2026-10-31 simple-import decision ("line
  details that disagree with the passed statement: the week saves without
  line rows"), so it needs an explicit owner decision superseding it.
- Risk: HIGH for the owner's rule. The flag sits on the week, but the
  wrong number sits on a row. Once a row is in a CSV or the accountant
  package, the flag is gone. NOT recommended unless every row-based export
  carries the flag.


## D. Recommendation and stage plan

Recommendation: option (1) in two parts.
- Make the loads check use the owner's own RV lines (A2), and restore the
  owner-column instruction in the reader (A1, i.e. A3).
- Then fix `line_details_differ` with a NAMED rule for whatever line the
  SELECT shows. No tolerance, no saving of mismatched rows.
- Consider A4 (a loads mismatch alone drops only load revenue, as written
  on 2026-10-17) as a separate owner decision.

Stages. One per commit; after each shipped stage, one real-PDF import on the
tablet before the next (working rule 9).

0. Diagnose. The owner runs the SELECT in B (read-only) and sends the
   result. No code. If useful, the same SELECT for 10-16, 09-25 and 08-14.

1. View-only display fix, OTA only.
   - In the view-only statement loads, show each load's revenue from its RV
     revenue line of the same order (the owner's amount); fall back to the
     load figure.
   - Check on the phone: the 10-02 loads show 1,552.33 / 633.07 / 269.86
     "as printed", not the trip amounts.
   - Ships with the not-yet-published view-only OTA. No SQL, no Edge
     Function.

2. Loads check from RV lines (A2), plus loads.revenue from the RV line.
   - Fixtures: 10-02, 10-16, 11-20 (×0.72), 09-25 and 08-14 from the stored
     readings.
   - Needs: `npm run build:reader`, ai-import redeploy via
     `scripts/deploy-ai-import.ps1` (EDGE FUNCTION), and `eas update`.
     Deploy the function first, then the OTA, so server and app use the
     same rule.
   - Check on the phone: "Read again" on 10-02. The loads reason is gone;
     line_details_differ still shows until stage 3.

3. Reader prompt (A1): copy every load revenue column with its header; the
   app picks OWNER REVENUE for Prime in `toExtraction.ts`.
   - EDGE FUNCTION redeploy + OTA.
   - Golden weeks re-checked first.
   - Check: a fresh import of 11-20 stores the owner amounts in
     `loads[].revenue`.

4. line_details_differ: one named rule per cause the SELECT proves (for
   example "PR / WA reimbursement lines are not in TOTAL OPERATING
   EXPENSES", or "the 2.55 line is booked under X"), each with a fixture
   from the real week.
   - `npm run build:reader` + EDGE FUNCTION redeploy + OTA.
   - Check: "Read again" on 11-20 saves with its line rows; profit on Home
     unchanged.

5. Re-read the 8 weeks one at a time with "Read again" (one AI read each).
   No SQL. After each: the week shows its line rows; profit, deposit and
   Cost/Mile unchanged; the view-only loads disappear for that week
   (real rows replace them).

6. Optional (owner decision): A4. A loads mismatch alone flags the week and
   saves loads without revenue, instead of dropping every line row.
   - build:reader + EDGE FUNCTION redeploy + OTA.

Possible addition (design only): store the gate's named causes at import
(for example `statement.lineDetailsCauses: ['group:total 352.55',
'loads']`), so the next diagnosis needs no SELECT. This is a client save
change to the jsonb only — no SQL, no column.
