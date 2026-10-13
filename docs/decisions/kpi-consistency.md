# Kpi Consistency

> One canonical KPI engine: `computeKpis()` in `app/src/stats/kpi.ts`, used by every screen.
> Origin: device report of three screens showing three numbers for one week; root causes traced first, then unified.
> Also: SIX-ITEM FINAL PASS item 2 (Profit Analysis moved onto the same engine, 2026-08-27).

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- KPI CONSISTENCY (owner decision, device report: "three screens report
  three different numbers for the same week" — CPM $27.60 × 3,120 mi ≈
  $86K of expenses; Net/Mile didn't equal RPM − CPM; "Variable ≈ Total"
  on the fixed/variable split; the Weekly Net Trend list looked offset in
  a multi-truck account; AI Coach implied "just one settlement" while
  Scorecard showed 6; the same week showed 3 different nets — $4,543.27 /
  $4,241.18 / $7,186). Findings were traced end to end BEFORE any fix, per
  the owner's own explicit two-phase instruction, then fixed.
  **FINDINGS (root causes, confirmed by reading the actual code, not
  guessed)**:
  1. **THE $86K CPM INFLATION + "everything lands in variable" — ONE
     root cause, not two**: `calcCanonicalCpm()` (`src/stats/cpm.ts`)
     already excluded a major-repair-overhaul or vehicle-purchase one-off
     from CPM when it was logged as a `deductions` row (category "Major
     Repairs & Overhauls", the >$2,500-threshold+keyword rule from the
     FULL PARITY pass) — but had NO equivalent exclusion for the exact
     same kind of repair logged as a `maintenance_records` row instead
     (the normal way a repair gets logged via the Maintenance screen, or
     via a settlement's own itemized maintenance line item). A real
     multi-thousand-dollar engine/transmission overhaul in
     `maintenance_records` divided straight into the per-mile figure with
     zero exclusion — and because it landed in the "Maintenance & Repairs"
     bucket (classified `'variable'`), it also explains "everything lands
     in variable" as a direct consequence of the SAME bug: a five-figure
     anomaly sitting in one variable bucket dwarfs whatever real fixed
     costs (insurance, truck payment) are configured, making the split
     look broken even though the classification logic itself
     (`CPM_BUCKET_TYPE`) was never wrong.
  2. **"Net/Mile doesn't equal RPM − CPM"**: Scorecard's KPI card mixed
     TWO DIFFERENT SCOPES in the same card, not just two different
     expense-set definitions — `RPM`/`CPM` (via the screen's own
     `canonicalCpm`) were already correctly TRUCK-SCOPED (an earlier
     "MULTI-TRUCK MODEL re-audit" pass fixed that), while `Net/Mile` was
     still `calcScorecard()`'s own `netPerMile` — part of the legacy
     0-100 score, which is DELIBERATELY fleet-wide-ALWAYS
     (`useFleetStats(null)`, CLAUDE.md's own protected exemption).
     Whenever a specific truck was active, Net/Mile was showing the WHOLE
     FLEET's ratio right next to a specific TRUCK's RPM/CPM — genuinely
     different scopes, not a rounding/definition quirk.
  3. **Weekly Net Trend "offset"**: the list itself renders `weekEnding`+
     `net` from ONE object per row (`weeklyTrend.map((w,i) => ...)`) — it
     was never literally two drifting parallel arrays. The real bug: the
     data feeding it (`buildWeeklyTrueProfitTrend(settlementsQuery.data,
     dedQuery.data, ...)`) was completely UNSCOPED to the active truck,
     unlike every other figure on the same screen. In a multi-truck fleet,
     a week where only ANOTHER truck settled still appeared in the list
     (pulling in that other truck's own numbers), while a week the ACTIVE
     truck itself settled could sit next to it looking inconsistent —
     which is what read as "offset by one" on device.
  4. **AI Coach "just one settlement" + the 3-nets mismatch**:
     `src/data/aiCoachSummary.ts`'s own `weeklyTrend` was ALREADY full,
     fleet-wide settlement history (not just the latest) — that part was
     never broken. Two real, separate bugs WERE found in
     `src/data/proactiveCoach.ts` (the weekly-review generator): (a) the
     AI prompt (`buildWeeklyReviewPrompt()`) stated "revenue $X, YTD
     moved from A to B" with NO settlement count anywhere in it — nothing
     stopped the model from describing that as "after just one
     settlement" even when the real count was 6; (b) `weeklyReviewInputs`
     mixed `gross: latestSettlement.gross` (ONE settlement row's own
     revenue) with `net: latestWeekTrend.net` (buildWeeklyTrueProfitTrend's
     own AGGREGATE across every settlement sharing that week) — in a
     multi-truck fleet where 2+ trucks settle the same week, this
     literally paired one truck's revenue with the WHOLE FLEET's expenses
     in the same weekly review, a real, confirmed scope mismatch. A THIRD,
     independent bug was found while unifying: `proactiveCoach.ts` also
     had its OWN, separate `calcCanonicalCpm()` assembly (`latestCpm`,
     used only as an internal nudge-threshold, never displayed directly)
     with its own subtle divergence from Scorecard's (one truck's cost
     basis × the WHOLE FLEET's settlement count, rather than every
     truck's own basis × its own count) — a third, quietly-drifting
     implementation of the same concern.
  **THE FIX — ONE canonical KPI function**: `src/stats/kpi.ts`'s new
  `computeKpis({trucks, settlements, loads, deductions, fuelPurchases,
  maintenanceRecords, tolls, truckScope, manualMilesOverride, window})` —
  filters every input row array ONCE by an explicit `DateWindow | null`
  (`null` = no time filtering at all, Scorecard's own deliberately
  all-time design) before ANY computation, so numerator and denominator
  can never drift onto different date ranges, then composes the
  already-correct, already-tested primitives this app already had
  (`buildTruckComparison()`, `calcCanonicalCpm()`, `calcMiles()`,
  `sumCanonicalExpenses()`, `calcPerDiemDays()`) into ONE flat result:
  `gross`, `net`, `expenses.{total,fixed,variable}`, `miles.{total,
  loaded,empty,deadheadPct}`, `rpm`, `cpm`, `ppm`, `perDiemDays`,
  `settlementCount`, `buckets`, `excludedTotal`, `excludedOneOffs`.
  **TWO DELIBERATELY DIFFERENT DOLLAR CONCEPTS, discovered and reconciled
  by this pass's OWN cross-screen consistency test** (an early draft
  conflated them, caught immediately by the new test failing): (1) `net`/
  `expenses.total` is the ESTABLISHED, dominant TRUE-PROFIT figure (gross
  minus EVERY real deduction/fuel/maintenance/toll dollar, one-offs
  INCLUDED — a real repair bill must still reduce real net profit, never
  silently vanish) — the same formula `src/stats/trueProfit.ts`'s
  `calcTrueProfit()` already uses everywhere else in the app (Home's Hero
  Card, CEO Mode, Share Weekly Profit, Profit Analysis); a SCOPED truck's
  own `net` is its DIRECT expenses only, deliberately NEVER a fleet-level
  allocation, per `src/stats/costAllocation.ts`'s own explicit header
  comment ("for PER-TRUCK CPM purposes only, never for
  P&L/tax/true-profit"). (2) `cpm`/`rpm`/`ppm`/`expenses.fixed`/
  `expenses.variable`/`buckets`/`excludedOneOffs` is the deliberately
  NARROWER per-mile operating view (Scorecard's own established "Why?"
  breakdown convention) — EXCLUDES a one-off repair/vehicle purchase (so
  one big bill can't spike a per-mile ratio to something meaningless) but
  INCLUDES the truck's own fixed cost-basis estimate (a real recurring
  cost with no deduction row for a paid-off truck). `ppm` is ALWAYS
  exactly `rpm − cpm` — the literal fix for the explicitly reported bug —
  but `ppm × miles` will NOT generally equal `net`, by design; both
  concepts are named plainly in `KpiResult`'s own doc comment so no future
  caller is surprised by the difference.
  **DELETED competing implementations (owner's own explicit "list what
  you removed")**:
  1. `app/(tabs)/index.tsx`'s `statsQuery = useFleetStats(activeTruck?.id
     ?? null)` / `stats` — confirmed via repo-wide grep to have ZERO
     remaining consumers (Home had already migrated every real KPI figure
     to `periodScopedCpm`/`heroPeriodTrio` in an earlier pass, leaving
     this as dead weight AND a live landmine — a future edit reaching for
     "stats" here would have silently resurrected the exact
     all-time/unscoped-vs-scoped mismatch this whole pass exists to
     eliminate).
  2. `app/(tabs)/more/scorecard.tsx`'s own inline `canonicalCpm` useMemo
     (a hand-assembled `calcCanonicalCpm()`/`withAllocatedBucket()` call),
     its own `fleetFixedCostTotal` useMemo, and the `milesSource`/
     `scopedGrossRevenue`/`scopedLoadedMiles`/`scopedDeadheadPct`/
     `scopedEmptyMiles` ad-hoc derivations (all replaced by fields on one
     `kpi = computeKpis(...)` call) — plus the now-dead `scopedTruckRow`
     lookup it depended on.
  3. `src/data/proactiveCoach.ts`'s own THIRD, independently-drifting
     `calcCanonicalCpm()` assembly (`carrierWithholdsLoan`/
     `truckCostBasis`/`truckFixedCostTotal`/`canonicalMilesTotal`/
     `latestCpm`, plus the `useFleetStats(null)` query it depended on) —
     replaced by one `computeKpis({truckScope: null, window: null})`
     call, which ALSO gets the maintenance-one-off CPM fix for free.
  4. `src/stats/periodScopedCpm.ts`'s internal branching logic — the
     module's own EXTERNAL shape (`{window, comparison, scopedRow, cpm}`)
     is kept byte-for-byte identical (zero risk to Home's own large,
     already-correct rendering code, and its full pre-existing test suite
     passes unchanged) but its ACTUAL math now delegates to
     `computeKpis()` internally instead of maintaining a second copy of
     the scoped/all-trucks CPM branching — `PeriodScopedCpmResult` also
     gained a `kpi: KpiResult | null` field exposing the full canonical
     object directly for any future caller.
  **Other concrete fixes**: `calcCanonicalCpm()` (`src/stats/cpm.ts`) now
  applies the SAME `isMajorRepairOverhaul()`/`isVehiclePurchaseOneOff()`
  text+amount rules to `maintenance_records` rows that it already applied
  to `deductions` rows (the CONFIRMED root cause of the $86K/CPM-inflation
  + fixed-variable-split symptoms) — `CpmMaintenance` gained optional
  `description`/`service_type` fields, threaded through
  `ComparisonMaintenance` (`src/stats/truckComparison.ts`) so every
  existing caller keeps compiling and gets the fix automatically.
  `app/(tabs)/more/scorecard.tsx`'s "Weekly Net Trend" list is now
  truck-scoped (`scopedSettlements`/`scopedDeductions`/`scopedFuel`/
  `scopedMaintenance`/`scopedTolls`, same pattern Home already
  established), fixing the cross-truck bleed that read as "offset" on
  device. The KPI card's Revenue/Mile, Fuel/Mile, and Net/Mile tiles now
  all come from the SAME `kpi` object as Cost/Mile (Fuel/Mile specifically
  now reads the canonical "Fuel & DEF" bucket instead of a raw unscoped
  sum of every fuel purchase on the account) — the 0-100 score/grade
  itself (`calcScorecard()`) is UNCHANGED, CLAUDE.md's own protected
  verbatim-legacy exemption; only the per-mile TILES sitting next to it
  were ever the bug. `src/stats/weeklyReview.ts`'s `WeeklyReviewInputs`
  gained `settlementCountYtd` (a real row count, never invented), woven
  into both the AI prompt ("...across N settlement(s) recorded so far
  this year...") and the always-correct fallback template
  (`ceoMode.weeklyReviewFallback.ytd`, all 7 locales) — `settlement`
  itself stays in Latin script per the glossary in every translation.
  `proactiveCoach.ts`'s `weeklyReviewInputs.gross` now reads
  `latestWeekTrend.gross` (the same fleet-aggregated figure `net` already
  used) instead of a single settlement row's own gross.
  **Cash Flow / Accountant Package, audited, not migrated to
  computeKpis() directly**: both already share the SAME leaf-level
  canonical primitives (`sumCanonicalExpenses()`, `reducesTrueProfit()`,
  `calcMiles()`, `calcPerDiemDays()`) computeKpis() itself is built from
  — confirmed, not assumed, by the new cross-screen test's own Accountant
  Package case (its `grossIncome` — a plain `sum(settlement.gross)` for a
  year window — reconciles EXACTLY with `computeKpis()` for the identical
  window+scope). A full migration to literally calling `computeKpis()`
  was judged unnecessary and NOT attempted: Cash Flow is a forward-looking
  FORECAST (trailing averages projected into future weeks) and the
  Accountant Package is an itemized LEDGER (every real line item listed,
  deliberately NEVER excluding a one-off the way CPM does) — both
  fundamentally different data shapes from a single point-in-time KPI
  snapshot, not a case of "the same figure computed twice."
  **CROSS-SCREEN CONSISTENCY TEST** (owner's own explicit item 6, "the
  guarantee that this class of bug can't return"):
  `src/stats/__tests__/kpiConsistency.test.ts` (new) — ONE fixed,
  realistic multi-truck/multi-week dataset (including a week TWO trucks
  settle together, and both flavors of the one-off bug — a deduction AND
  a maintenance_records row) asserted against: Dashboard
  (`buildPeriodScopedCpm`, Home's own real function) vs. Scorecard
  (`computeKpis`) reporting IDENTICAL net/rpm/cpm/miles for the same
  window+scope, with `ppm = rpm - cpm` proven true on both; both one-offs
  proven excluded from CPM specifically while still fully reducing real
  net profit; AI Coach's gross+net for a shared multi-truck week proven to
  come from the SAME aggregated figure `computeKpis()` produces (the
  literal "coach only receives the latest settlement" fix, proven, not
  just described); AI Coach's YTD settlement count proven to match
  Scorecard's own settlement history for the same year; the Accountant
  Package's `grossIncome` formula proven to reconcile exactly with
  `computeKpis()` for the same window; and `calcMiles()`/
  `computeKpis().miles.total` proven to agree exactly for the same rows.
  This repo has no React Native rendering harness anywhere (a standing,
  documented limitation) — "Dashboard"/"Scorecard"/"AI Coach" in this test
  means the exact pure functions each screen's own component calls, called
  the same way the real screen calls them, not a rendered UI assertion.
  **Deliverables**: 118 suites / 3,001 tests pass (10 new pure-logic tests
  in `kpi.test.ts` + 6 new cross-screen tests in `kpiConsistency.test.ts`,
  plus updated fixtures in `weeklyReview.test.ts`); `tsc --noEmit` clean;
  all 7 locales confirmed key-parity (glossary test re-passed clean,
  1,278 tests — "settlement" correctly kept in Latin script in the new
  `weeklyReviewFallback.ytd` string in every translation). No SQL/Edge
  Function changes — every fix in this pass is pure client-side JS/TS.
  Ships via a normal `eas update`.

  2. **ONE KPI ENGINE — Profit Analysis found broken, root-caused, fixed**:
     Profit Analysis's formula (`buildProfitAnalysis()`,
     `src/stats/profitAnalysis.ts`) already used the SAME canonical
     `sumCanonicalExpenses()` `computeKpis()` itself is built from —
     confirmed NOT a formula divergence. The real, confirmed bug:
     `windowStartIso()`'s 30-day window used UTC-based date arithmetic
     (`setUTCDate`) while `src/stats/heroPeriodWindow.ts`'s
     `resolveHeroPeriodDateWindow()` — the ONE shared resolver every
     `computeKpis()` consumer (Home's "1M" tab, Scorecard, AI Coach) uses
     for an identical trailing-30-day period — uses LOCAL-time arithmetic
     (`setDate`), the same "MONTH FILTER OFF-BY-ONE" UTC-vs-local mismatch
     class this codebase has hit before (`formatMonthLabel()`). For a
     30/90/180/365-day window spanning a DST transition, the two methods
     can land on a genuinely different UTC calendar day — EMPIRICALLY
     confirmed via a real `America/Chicago` DST-crossing case
     (`now=2026-03-20T23:30:00Z`): old UTC-based → `2026-02-18`, new
     local-time-based → `2026-02-19`, a full day's transactions'
     difference. Fixed by switching `windowStartIso()` to the identical
     `setDate()` arithmetic `resolveHeroPeriodDateWindow()` uses, plus
     adding the matching explicit upper bound (`<= end`) to
     `buildProfitAnalysis()`'s own window filters, which only ever had a
     lower bound before. **Confirmed already correct, no fix needed**:
     Share Weekly Profit (already routes through the canonical
     `buildWeeklyTrueProfitTrend()`); Operating P&L/Truck Comparison/
     Accountant Package/Cash Flow — all deliberately exempt per their own
     established design (verbatim-legacy P&L port, the Per-Truck
     allocation model, an itemized ledger, a forecast) and left untouched.
     Tests: `profitAnalysis.test.ts` gained a cross-timezone
     (`America/Chicago`/`UTC`/`Pacific/Honolulu`/`Europe/London`)
     agreement test against `resolveHeroPeriodDateWindow('1M', ...)`, plus
     a dedicated DST-crossing test reproducing the OLD buggy
     `setUTCDate`-based implementation directly to prove it would have
     produced `2026-02-18` (a real, different day) where the fix produces
     `2026-02-19` — this test would have caught the original bug, not
     just asserted the fix's own behavior. `kpiConsistency.test.ts` gained
     a new case: `buildProfitAnalysis()`'s `netIncome` matches
     `computeKpis().net` exactly for the identical fleet-wide 30-day
     window on the file's existing realistic multi-truck fixture — a
     genuinely partial window (only 3 of 5 fixture settlements fall
     inside it), not a vacuous all-inclusive check.
