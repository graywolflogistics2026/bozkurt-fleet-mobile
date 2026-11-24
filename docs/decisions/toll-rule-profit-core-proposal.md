# Toll rule in the profit core: proposal (DRAFT, 2026-11-24, not implemented)

**Goal.** Use the Tolls & Fees rule in every profit figure, so a toll is never counted twice on a settlement that has **no** approved statement (another carrier, or a Prime week that did not pass the gate). Statement-backed weeks must stay exactly as they are today.

**The rule** (`app/src/stats/tollsSummary.ts:124-141`, `buildTollsSummary()`):

- A `tolls` row is **covered** when its settlement has a deduction in "Tolls & Scales" whose kind is `tolls`. The kind comes from `tollKindOf(code + description)`, and anything that is not a scale ticket counts as `tolls`.
- A covered row is that line's itemized breakdown. It is never added on top of the line.
- A row with no `settlement_id` is never covered. Neither is a row whose settlement has only a scales line or no toll line at all.

**Status.** Findings and a design only. No code, SQL or text changed.

---

## Key finding: coverage depends on the settlement, not on the date

Whether a row is covered is a fact about its **settlement**: "does settlement S have a toll-kind Tolls & Scales deduction?" It does not depend on any date. That matters because the profit sites filter rows by date before they sum:

- deductions are filtered by `ded_date`;
- tolls rows are filtered by `toll_date`.

A week's toll line and its itemized plazas often fall on different dates. Owner example: the 09/18 line "EZ … thru 09/09" against plazas dated 09/01 to 09/08. If coverage were checked on already-filtered rows, the line could fall outside the window while its plazas fall inside, and the double count would come back in some periods.

So **coverage must be decided on the full, unfiltered deductions**, once, before any date window or truck scope. This is why the fix cannot live inside `canonicalExpenseBreakdown()`: that function only ever receives rows that are already filtered.

## 1. Every site that adds `tolls` rows

"Double count" below means: the site adds a covered `tolls` row on top of the toll deduction line that already contains it.

| # | Site | What it adds today | Double count? |
|---|---|---|---|
| 1 | `src/stats/trueProfit.ts:270` `canonicalExpenseBreakdown()` (the core of `sumCanonicalExpenses`, `layeredExpenseBreakdown`, `calcTrueProfit`) | Every `tolls` row passed in (`tollsTotal`), next to every Tolls & Scales deduction that reduces true profit (`:268`). | **Yes**, for a settlement with no approved statement that has a toll-kind line AND linked `tolls` rows. **No** for a backed week: `splitSettlementLayers()` (`:339`) removes its linked rows first. |
| 2 | `src/stats/trueProfit.ts:416` `buildWeeklyTrueProfitTrend()` | Tolls filtered by `toll_date` into each 7-day week, then #1. Feeds Home's weekly chart, AI Coach summary (`src/data/aiCoachSummary.ts:76`), Alerts (`src/data/alerts.ts:134`), Scorecard (`more/scorecard.tsx`) and the CEO weekly review. | **Yes**, same condition. Also, plazas dated before the week start land in the **previous** week, so that week loses money it never spent. |
| 3 | `src/stats/cpm.ts:301` `calcCanonicalCpm()`, "Tolls" bucket | Every row passed in (`layers.tolls` from `kpi.ts:390`). | **Yes**, same condition. Moves Cost/Mile, Profit/Mile, the fixed/variable split and the "Why?" buckets. |
| 4 | `src/stats/truckComparison.ts:186` (`fleetLevelTolls`) and `:227` (`directTolls`) → `calcCanonicalCpm()` | Rows with no truck go into the fleet pool, which is shared out by miles; rows with a truck count for that truck. | **Yes**, same condition. Rows arrive already filtered by date from `src/stats/periodScopedCpm.ts:97`. |
| 5 | `src/stats/profitAnalysis.ts:165` → `layeredExpenseBreakdown()` | Tolls filtered by `toll_date` within the period. | **Yes**, same condition. |
| 6 | `src/stats/auditLedger.ts:148` | One ledger row per tolls row: `status: 'counted'`, `reason: 'expense'`. | **Yes**: the Audit shows the line and its plazas both as "counted". |
| 7 | `src/stats/kpi.ts:338` `computeKpis()` | Tolls filtered by `toll_date` + truck scope → `layers.tolls` → #1, #3, #6. | Inherits #1, #3 and #6. Home, Settlements, the settlement-week header and Profit Analysis tie-outs all read from here. |
| 8 | `src/stats/kpi.ts:576` profit bridge `tollsTotal` | Only rows with no settlement (`!t.settlement_id`). | **No.** But the bridge assumes a settlement-linked row is inside net pay while profit (#1) subtracts it, so today `bridge.difference` is off by the covered amount on such a week. The fix shrinks that difference. |
| 9 | `src/stats/periodScopedCpm.ts:97` | Filters tolls by `toll_date` → #4. Passes the unfiltered list to #7. | Inherits #4 and #7. |

Already on the rule, no change: `kpi.ts:601` (Profit Audit cross-check, `countedTollsOf`), `cashFlowForecast.ts:106/128`, `accountantPackage.ts:286/369`, the Tolls & Fees screen (`more/tolls.tsx:124`).

Read the `tolls` table but do not compute profit, so no change:

| Site | What it does |
|---|---|
| `src/import/primeOperatingStatement.ts:153` | Filter only, Prime rows. |
| `src/stats/settlementWeek.ts:24` | Filter only, then calls #7. |
| `src/data/truckDeletion.ts:102` | "What will be deleted" preview total. |
| `src/data/dailyTips.ts:133,187` | Row counts. |
| `app/(tabs)/more/data-cleanup.tsx` | Lists rows for cleanup. |
| `src/stats/profitExplainer.ts:94-98` | Category label only. |
| `src/data/proactiveCoach.ts` | Goes through #2 and #7. |

Capital Account does not read `tolls` at all.

## 2. One shared helper

Add it to `app/src/stats/tollsSummary.ts`, next to the rule it shares:

```ts
// Settlements whose toll/fee line covers their own tolls rows (the
// Tolls & Fees rule). Settlement-level, never date-level: build it from
// the FULL deductions list, before any window or truck scope.
export function tollLineSettlementIds(deductions: ReadonlyArray<TollRuleDeduction>): Set<string>;

// The tolls rows that count: every row except the breakdown rows of a
// settlement with a toll/fee line.
export function withoutCoveredTolls<T extends { settlement_id?: string | null }>(
  tolls: ReadonlyArray<T>,
  deductions: ReadonlyArray<TollRuleDeduction>
): T[];
```

- **`buildTollsSummary()` uses `tollLineSettlementIds()` too.** Its `coveringLine` map keeps picking the largest line, used only for the screen breakdown. Then the screen and profit cannot disagree about which rows are covered. `tollRuleByIndex()` and `countedTollsOf()` keep working unchanged on top of it.
- **It runs once, at each entry point, on the unfiltered input**, before the orphan split, date window and truck scope:

  | Entry point | Where it runs |
  |---|---|
  | `computeKpis()` | Top of the function, on `inputs.tolls` vs `inputs.deductions`. Covers #1, #3, #6 and #7. |
  | `buildWeeklyTrueProfitTrend()` | Before the per-week loop. Covers #2. |
  | `buildProfitAnalysis()` | Before `windowTolls`. Covers #5. |
  | `buildPeriodScopedCpm()` and `buildTruckComparison()` | Before `fTolls` and at the top of `buildTruckComparison`. Covers #4 and #9. |
- **Running it twice is safe.** After a pass on the full list, every remaining row is uncovered across all deductions. A later pass, even on filtered deductions, can only see a subset of the covering settlements, so it removes nothing more. `buildTruckComparison()` can therefore call it even though `periodScopedCpm` already did.
- **`canonicalExpenseBreakdown()`, `cpm.ts` and `auditLedger.ts` keep their signatures.** They simply never receive a covered row.
- **The Audit ledger (#6), recommended:** list each covered row as `status: 'excluded'` with a new reason `toll_breakdown` ("Part of a settlement toll line — counted once"), so the Audit still shows every row once. This adds one `LedgerReason` value and 2 i18n keys in all 7 locales, next to the existing `duplicate_fuel` keys (`en.json:2850`, `:3121`). Needs owner approval: it touches the Audit screen text.

**Why statement-backed weeks stay exactly as today:**

1. A covered row always has a `settlement_id`. For a backed week, `splitSettlementLayers()` already removes every row linked to that settlement before any sum, CPM bucket or ledger row. Removing it earlier changes nothing.
2. The only place that uses a backed week's linked tolls is the cross-check (`kpi.ts:601`). It already applies the same rule through `countedTollsOf()`, so it gets the same list.
3. A covered row has a `settlement_id`, so it is never an orphan row (`kpi.ts:309`), and the explainer's own-expense layer never sees it.
4. Gross, statement expenses, deposits, held-by-carrier, per diem and miles do not read `tolls`.

## 3. Proof that the owner's numbers do not move

| Figure (owner, live) | Pinned by a test today? | Before / after proof |
|---|---|---|
| Home Revenue 88,210 | Yes: 88,210.06 in `src/data/__tests__/homePeriodTotals18.test.ts:129,155`, `golden18Saved.test.ts:82`, `prOwnerMoneyInMismatch.test.ts:129`, `driverCarrierPayroll18.test.ts:125` | Gross never reads `tolls`. These tests must stay green. |
| Profit 46,232.73 (18 golden weeks, expenses 41,977.33) | Yes: the same four tests | Must stay green. Limit: the golden-18 store has **0 tolls rows and 0 Tolls & Scales lines**, and 18 of 18 weeks are statement-backed (checked with a throwaway probe, deleted). These tests prove nothing *else* moves, but do not exercise tolls. |
| Home Expenses 49,641 / Net 38,569 (live; includes the owner's own expenses beyond the golden weeks) | **No.** No fixture holds the owner's live own-expense rows. | Proved by the read-only SQL below plus the new test T1. |
| Capital 64,874.50 / 29,583.50 | **No** | Capital does not read `tolls`: no capital file references it. Nothing to pin. |
| Tolls & Fees 827.47 | Yes: `src/stats/__tests__/tollsSummary.test.ts:10` (709.47 + 118.00), fixture `src/stats/__tests__/fixtures/ownerTolls.ts` | Uses the same rule. Stays green after the `tollLineSettlementIds()` refactor. |
| Golden weeks 2,533.36 and 4,987.74 | Yes: `goldenPrimeSettlement.test.ts`, `goldenPrimeSettlement0814.test.ts` | Must stay green. |
| Tolls & Scales 12-week spend 826.97 | Yes: `tollsDoubleCount.test.ts` | Must stay green. |

**Why live data cannot change.** All 11 of the owner's `tolls` rows are linked to the Prime weeks 08/07, 08/21, 09/04 and 09/18 (`ownerTolls.ts`). If each of those weeks is statement-backed, which they are ("all 18 weeks certified"), the helper removes only rows that `splitSettlementLayers()` already removes. The 2 own CAT Scale tickets are deductions, not `tolls` rows.

Read-only check for the owner to run in the SQL Editor (no writes). It lists every tolls row the helper would treat as covered, with its settlement's statement state:

```sql
select s.week_ending, s.carrier,
       s.statement->>'source'                 as statement_source,
       s.statement->'prime'->>'gatePassed'    as gate_passed,
       count(t.id)                            as covered_toll_rows,
       sum(t.amount)                          as covered_amount
from public.tolls t
join public.settlements s on s.id = t.settlement_id
where exists (
  select 1 from public.deductions d
  where d.settlement_id = s.id
    and lower(trim(d.category)) = 'tolls & scales'
    and coalesce(d.description, '') !~* '(weight\s*tickets?|\mcat\s*scales?\M|\mscales?\M)'
)
group by 1, 2, 3, 4
order by 1;
```

Expected: 4 rows (08/07, 08/21, 09/04, 09/18), each with `statement_source = prime_statement` and `gate_passed` true or null.

- A null `gate_passed` belongs to an older statement whose gate is worked out again by the app (`isStatementBacked()`). Those weeks show "Certified" on the device.
- If every row is a certified Prime week, **no live number can change**.
- Any other row (another carrier, or `gate_passed = false`) is exactly a double count today. Its `covered_amount` is how much Home Expenses would drop.

**T1 (new pinning test).** Run `computeKpis()` and `buildPeriodScopedCpm()` over the owner's real toll fixture (`ownerTolls.ts`), with each of its 6 settlements given a passing Prime statement (the golden statement fixtures), plus the 2 own CAT tickets:

- the before numbers are recorded in the test;
- with the helper, every figure must be identical: gross, expenses, net, CPM, PPM, buckets, ledger counted totals, bridge difference, every week of `buildWeeklyTrueProfitTrend()`, and Truck Comparison rows.

## 4. Fixture for the second carrier (no approved statement)

`src/stats/__tests__/fixtures/otherCarrierTolls.ts`:

**Settlement** `s-acme`:
- carrier `ACME FREIGHT`, week ending **2026-10-23**, truck T1;
- gross **3,000.00**, net **2,760.00**;
- `statement` null.

**Deductions** (withheld, `source: 'settlement'`, `settlement_id: s-acme`, `ded_date` 2026-10-23):
- "TOLLS THRU 10/20", Tolls & Scales, **40.00**;
- "INSURANCE", Insurance, **200.00**.

**`tolls` rows** linked to `s-acme`, `source: 'settlement'`: HCTRA 15.00 (10/18), NJTP 15.00 (10/19), HCTRA 10.00 (10/20) = **40.00**. This is the line's own breakdown.

**Own toll**: `settlement_id` null, `source: 'manual'`, plaza "PA TPK", 2026-10-21, **12.40**.

| Figure (all-time, fleet) | Today | After the fix |
|---|---|---|
| Expenses | 40 + 200 + **40** + 12.40 = **292.40** | 40 + 200 + 12.40 = **252.40** |
| Profit | **2,707.60** | **2,747.60** |
| "Tolls" CPM bucket | 92.40 | 52.40 |
| Audit ledger, tolls & scales counted | 92.40 (5 rows) | 52.40 (2 rows), plus 3 rows excluded `toll_breakdown` |
| Bridge: 2,760.00 net pay − 12.40 own toll = 2,747.60; `difference` | **−40.00** | **0.00** |
| Tolls & Fees screen total (unchanged) | 52.40 | 52.40 |

Variant **4b** (covered rows dated in the previous week, 10/14 to 10/16, line dated 10/23):

- Today, `buildWeeklyTrueProfitTrend()` charges 40.00 to the week of 10/16, which may have no settlement at all, while the 10/23 week also counts its line.
- After the fix, the 10/16 week shows no toll cost, and 10/23 is unchanged at 2,747.60 profit (own toll included).

## 5. Risks and the exact tests to add

| Risk | Mitigation / decision |
|---|---|
| Coverage worked out on rows already filtered by date or truck brings the double count back in some periods. | The helper takes the unfiltered list at each entry point (section 2). Tests T4 and T5. |
| A toll line that does **not** reduce profit (an out-of-profit `economic_class`, e.g. informational) still "covers" its plazas, so both drop out of profit. | **Owner decision needed:** (a) keep the screen's rule as is (any toll-kind line covers), or (b) in profit only, a line covers only when `reducesTrueProfit()` is true. Recommend (b), so a number is never lost (rule 3). If (b), the screen keeps its own rule and the two can differ only in that rare case. Test T6. |
| The line is smaller than its plazas (partial itemization, e.g. line 40, rows 55): the extra 15 is not counted. | Same as the screen and Accountant Package today ("never summed"). Pin it with T7 so it is a decision, not an accident. |
| A scales-only line (weight tickets) never covers EZ-Pass rows. | Correct by the rule. T8. |
| Covered rows carry a different `truck_id` than their line (Truck Comparison shares them out differently). | Removed before scoping, so they never count for any truck. T5. |
| An existing test pins a number that includes a double-counted row. | Run the full suite before the change. Any test that changes is pinning the bug; list it for the owner before updating it. |
| The bridge difference changes on other-carrier weeks. | It moves toward 0 (an improvement). Uncovered settlement-linked rows still leave a gap: kept as is and reported, out of scope. |
| New Audit reason text. | One `LedgerReason` value and 2 keys in all 7 locales (es/ru/tr/hi translated, ar/uk English). Needs owner approval (scope rule 5). |

**Tests to add** (`src/stats/__tests__/tollRuleProfitCore.test.ts`, plus T1 in `src/data/__tests__/`):

- **T1** Owner's toll fixture on statement-backed Prime weeks: every figure identical before and after (section 3), on All, Yearly, Monthly, Weekly, Truck Comparison and the weekly trend.
- **T2** Other-carrier fixture: profit 2,707.60 → 2,747.60; expenses 292.40 → 252.40; Tolls bucket 52.40; ledger tolls counted 52.40 with 3 rows `toll_breakdown`; bridge difference 0.00. Covers `computeKpis`, `calcTrueProfit`, `buildProfitAnalysis`, `buildPeriodScopedCpm` and `buildTruckComparison`.
- **T3** The same week through each entry point gives the same profit (one-KPI-engine rule).
- **T4** Variant 4b: the previous week has no toll cost; the 10/23 week is 2,747.60.
- **T5** Truck scope: a covered row with `truck_id` T2 while its line has `truck_id` null. It counts for no truck; the fleet total is 2,747.60.
- **T6** A toll line with an out-of-profit class, per the owner's answer to the T6 risk above.
- **T7** Line 40.00 with rows totalling 55.00: profit counts 40.00.
- **T8** A scales-only line plus EZ-Pass rows: the rows count.
- **T9** `withoutCoveredTolls()` run twice, or on a filtered subset, removes nothing more.
- **T10** NULL-truck rule (CLAUDE.md): an own toll with `truck_id` null still counts in a single-truck scope.
- **Regression (must stay green):**
  - `homePeriodTotals18`, `golden18Saved`, `prOwnerMoneyInMismatch` and `driverCarrierPayroll18` (88,210.06 / 41,977.33 / 46,232.73 / 39,913.01);
  - `goldenPrimeSettlement` (2,533.36), `goldenPrimeSettlement0814` (4,987.74) and `goldenPrimeSettlement0717`;
  - `tollsSummary` (827.47), `accountantPackageTolls`, `tollsDoubleCount` (826.97);
  - `queryInvalidation`, and the full `npx jest`.

## Ship impact if approved (estimate, nothing done)

- Code only: `tollsSummary.ts` (helper) plus the 4 entry points. The Audit reason and i18n only if approved.
- No SQL, no Edge Function. Ships with `eas update`.
- Per working rule 9, these would be separate commits:
  1. the helper, used by `buildTollsSummary`, with no behavior change;
  2. the entry points, with T1 to T10;
  3. the Audit reason and i18n.
