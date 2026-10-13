# Multi Truck Model

> Multi-truck model: global scope selector, per-truck profitability, selector placement, CPM/PPM per truck.
> Extends invariant #7 (single truck is the n=1 presentation of the fleet logic).
> See also null-truck-exclusion.md and kpi-consistency.md.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- MULTI-TRUCK MODEL — GLOBAL SCOPE SELECTOR + PER-TRUCK PROFITABILITY
  (owner decision, docs/PENDING_SQL.md §63, NOT YET RUN). Fleet-vs-per-
  truck scoping used to be inconsistent across the app — Home's own
  dashboard trio was truck-scoped while Scorecard's canonical CPM was
  fleet-wide (a settlement with no `truck_id` silently vanished from
  Home's numbers while still showing correctly on Scorecard, an EARLIER,
  already-fixed instance of this exact class of bug — see the MILES READ
  BUT NOT USED entry above). This pass makes scope explicit, centralized,
  and consistent everywhere, per an explicit three-category rule set.
  1. **GLOBAL SCOPE SELECTOR — `ActiveTruckContext` extended, not
     replaced**: `activeTruckId: string | null` now carries a real "All
     Trucks" meaning — `null` means either "no trucks yet" (unchanged,
     trucks.length===0) OR the user has explicitly chosen "All Trucks"
     (trucks.length>1), disambiguated by the new `isAllTrucks` field.
     **Default changed**: a multi-truck account with no stored preference
     used to silently land on `trucks[0]`; it now defaults to "All
     Trucks" (requirement 1's own "All Trucks (default)"). Persisted via
     the SAME `active-truck:${userId}` AsyncStorage key as before, with a
     `'all'` string sentinel representing the null/All-Trucks state (a
     literal `null` can't round-trip through AsyncStorage).
     `setActiveTruckId('all' | truckId)` is the one entry point every
     screen and the top-bar selector call. Every ONE of the 17
     pre-existing `useActiveTruck()` call sites was individually audited
     against the new "activeTruck can now be null even with 2+ trucks on
     the account" possibility (see items 2-4 below for the ones that
     needed real changes) — most already tolerated `activeTruck === null`
     gracefully, since that was already the pre-existing zero-trucks
     case; this pass reuses those exact same code paths rather than
     adding a second "no truck" branch. `TruckSwitcher.tsx` (already
     rendered in the top bar via `_layout.tsx`'s `headerRight`, unchanged
     wiring) IS the global scope selector the requirement asks for — "All
     Trucks" is now its first Alert-picker option; the pill shows 🚛 "All
     Trucks" or 🚚 "Unit X" depending on scope. `src/stats/fleetScope.ts`'s
     `truckIdFilterFor(activeTruckId)` is the ONE shared translation from
     scope to a `useEntityList({truck_id: ...})` filter (`null` → `undefined`
     = no filter = "All Trucks," matching `createEntityHooks`'s own
     `if (value === undefined) continue` — every list screen calls this
     one function, never a screen-local `scope === 'all' ? undefined :
     scope` inline, which is exactly the divergence requirement 1
     forbids). `src/components/FleetScopeLabel.tsx` is the ONE shared "state
     which scope you're showing" component (`variant="list"` — silent
     for 0/1 trucks, "Showing: All Trucks"/"Showing: Unit X" for 2+;
     `variant="fleetOnly"` — always shows "Fleet-wide (all trucks)")
     every screen below renders from, so the wording (and the underlying
     scope value) can never disagree screen to screen.
  2. **SCOPE RULES, category 1 — fleet-level, NEVER splittable**: Tax
     Estimator, Capital Account, Cash Flow, Accountant Package all
     already compute fleet-wide (none of them ever filtered by truck) —
     this pass adds `<FleetScopeLabel variant="fleetOnly" />` to each so
     the screen says so explicitly, satisfying "the screen must state
     this" without changing a single number.
  3. **SCOPE RULES, category 2 — truck-level, MUST be per truck**:
     - **`deductions.truck_id` + `tolls.truck_id`** (docs/PENDING_SQL.md
       §63, nullable, `references trucks`, same no-`on delete`-clause
       shape as `fuel_purchases.truck_id`'s own §6 precedent) — these
       were the two tables with NO truck attribution at all
       (`settlements`/`fuel_purchases`/`maintenance_records` already had
       it). `mapExtraction.ts`'s withheld-deduction map and
       `toTollInsert()` now inherit the settlement's own `truck_id` at
       import time (§63's own backfill migration applies the identical
       rule retroactively to existing rows). Most deductions stay
       fleet-level (`null`) by design — insurance, accounting fees,
       permits are genuinely nobody's-truck costs; the Deductions edit
       sheet gained an OPTIONAL truck picker (shown only for a 2+-truck
       account) that writes `truck_id` via a plain, separate
       `useUpdateDeduction()` call — deliberately NOT folded into the
       §62 atomic `update_deduction_with_contribution_sync` RPC, since
       truck assignment has zero interaction with that RPC's
       category/payment-method/contribution-sync guarantees and
       extending an already-atomic money-correctness RPC's SQL signature
       for a rarely-needed capability wasn't worth the risk.
     - **`src/stats/costAllocation.ts`'s `allocateByMiles()`** —
       requirement 6's allocation rule: a fleet-level cost (`truck_id`
       null) is split across REAL trucks by each truck's share of the
       REAL TRUCKS' combined total miles (deliberately not the whole
       fleet's miles, which would also include any unassigned
       settlement's own miles with nothing to allocate against) — an
       ALLOCATION for per-truck CPM only, never touching P&L/tax/true-
       profit, which stay unsplit.
     - **`src/stats/truckComparison.ts`'s `buildTruckComparison()`** —
       the per-truck engine every truck-level screen below reads from.
       For each truck: direct costs via the SAME `calcCanonicalCpm()`
       every other CPM consumer uses (fed only that truck's own
       `truck_id`-tagged deductions/fuel/maintenance/tolls, plus that
       truck's own `calcTruckCostBasisWeekly()` weighted by its own
       settlement count) PLUS its allocated share of the fleet-level
       pool (computed once via `calcCanonicalCpm(0, 1, fleetLevelRows,
       ...)`, reusing that function's own exclusion/double-count logic
       rather than re-deriving it). A synthetic **Unassigned** row
       (requirement 7: "a null-truck row never disappears from a fleet
       view") surfaces any settlement with no `truck_id` as pure revenue
       visibility (its expenses are always $0 — the fleet-level cost pool
       it might seem to "own" is already fully allocated to real trucks,
       so double-showing it there would double-count it), excluded from
       best/worst ranking, with a "Fix truck assignments →" link.
       Reconciliation is exact by construction: `fleetTotals.totalExpenses`
       always equals what a SINGLE whole-fleet `calcCanonicalCpm()` call
       over every row (truck-tagged + fleet-level pool) would produce —
       proven directly in `truckComparison.test.ts`.
     - **New screen: Per-Truck Profitability** (`app/(tabs)/more/truck-
       comparison.tsx`, requirement 4 — "the screen that answers 'which
       truck should I keep?'") — revenue/expenses/net/RPM/CPM/PPM/miles/
       deadhead% side by side, ranked, best (green border/🏆) and worst
       (red border/⚠️) highlighted, period tabs (`src/stats/
       periodFilter.ts`, the same shared period definition Deductions/
       Settlements already use), an explicit "$X direct + $Y allocated"
       caption per truck (requirement 6's own labeling ask), driver pay +
       net-after-driver-pay per truck (requirement 5) when any driver
       payment data exists, and the Unassigned nudge card. Wired into
       `navRegistry.ts`'s `business` group and `more/_layout.tsx`.
     - **Scorecard** — its own KPI card was already fleet-wide
       (`useFleetStats(null)`, unconditional) — that already WAS "the
       fleet average"; the only missing piece was requirement 2's
       "AND a per-truck breakdown, never a single blended number." Now,
       when `isAllTrucks`, a new "Per-Truck Breakdown" card (reusing
       `buildTruckComparison()` against the exact same full/unfiltered
       settlement/deduction/fuel/maintenance/toll data the screen already
       fetches for its own CPM) sits above the KPI card, ranked, tapping
       a row switches the global scope to that truck; a "See full
       comparison →" link opens the dedicated screen.
     - **Home (`app/(tabs)/index.tsx`)** — the per-mile trio's own fleet-
       wide fixed-cost figure had a real gap: in "All Trucks" mode,
       `truckFixedCostTotal` silently stayed $0 (it only ever read the
       single `activeTruck`'s own cost basis) — under-counting real fixed
       truck-ownership costs out of the fleet-average CPM. Fixed: when
       `isAllTrucks`, it now sums EVERY truck's own cost basis weighted by
       its own settlement count, never $0.
     - **Truck Health** — no meaningful numeric "average" exists for a
       categorical health status, so "must be per truck" is satisfied by
       an explicit picker (never a silent default) whenever the global
       scope is "All Trucks" on a 2+-truck account — a screen-LOCAL
       `scopedTruckId` mirrors the global scope but lets the user pick
       one truck to actually view, with a "🔄 change truck" link back to
       the picker. **Honestly flagged, not silently claimed complete**: a
       full stacked-per-truck-status-at-a-glance summary (colored chips
       per truck before picking) would need N additional per-truck health
       queries and was judged out of scope for this pass given its size —
       the picker satisfies "ask explicitly, never blend," not "show
       every truck's status simultaneously."
  4. **SCOPE RULES, category 3 — lists follow the selector**:
     `settlements`/`fuel_purchases`/`maintenance_records`/`tolls`/
     `deductions` all now pass `{truck_id: truckIdFilterFor(activeTruckId)}`
     into their existing `useEntityList()` call (Settlements additionally
     shows a 🚚 unit-number badge per row in "All Trucks" mode — silent in
     a specific-truck scope, where every row is obviously that truck
     already). **`loads` has no `truck_id` column of its own** (attributed
     via `settlement_id` → `settlements.truck_id`) — the entity-hooks
     filter mechanism can't join, so `src/stats/loadsScope.ts`'s
     `filterLoadsByTruckScope()` is a small, tested, client-side filter
     the Loads screen applies instead; a load with no `settlement_id` (or
     whose settlement has no truck) is excluded from a specific-truck
     scope, included under "All Trucks" — same "never guess, exclude
     rather than misattribute" spirit as every other scope rule here.
     **Create flows, audited individually for the new "activeTruckId can
     now be null with 2+ trucks" case**: Maintenance's own "Add Record"
     form used to hard-require `activeTruckId` (`if (!userId ||
     !activeTruckId) return`) — harmless when this could only happen with
     ZERO trucks, but a real regression once "All Trucks" became the
     default for every multi-truck account (it would have silently
     blocked adding any maintenance record). Fixed with an explicit,
     required truck picker inside the Add form, shown only when the
     global scope is "All Trucks" on a 2+-truck account (`addFormTruckId`,
     converted to a real `recordTruckId` before Save is enabled) —
     `bumpTruckReading()` was also re-pointed at the record's own resolved
     truck rather than the (now possibly-null) scope truck. Fuel and
     Tolls' own manual-add flows were audited too and left NON-blocking on
     purpose: they silently attach to the current scope truck when one is
     selected (a reasonable default — "I'm looking at Unit X, so a fuel
     purchase I add now is Unit X's") and stay fleet-level/unassigned in
     "All Trucks" mode, matching how most deductions have always worked,
     rather than adding yet another required picker to every add-flow.
  5. **TRUCK ASSIGNMENT AT IMPORT — requirement 3, mostly ALREADY BUILT**:
     `app/src/import/truckMatch.ts`'s `resolveTruckMatch()` already
     returned `needsPicker: true` (never silently `truck_id: null`)
     whenever a 2+-truck account's extracted unit number didn't match
     exactly one truck, and the import preview screen already rendered a
     required truck-picker gating Save on it — this was true before this
     pass. The one genuine gap: there was no explicit "not truck-specific"
     answer, only "pick one of my trucks." Fixed with a
     `NOT_TRUCK_SPECIFIC` sentinel state value (`app/(tabs)/import/
     index.tsx`) — a real, non-null string so it satisfies the existing
     `!truckId` gate, rendered as its own pill alongside the per-truck
     ones, converted back to a real `null` right before `saveExtraction()`
     is called. `mapSettlement()`'s withheld-deduction and toll mappers
     now also stamp `truck_id` from the settlement's own resolved value
     (previously only settlement/fuel/maintenance did).
  6. **REPAIR FLOW for existing null-truck rows** — new screen
     (`app/(tabs)/more/truck-assignments.tsx`, requirement 3's second
     half): `app/src/import/truckAssignmentRepair.ts`'s pure, tested
     `findUnassignedRows()` scans `settlements`/`fuel_purchases`/
     `maintenance_records`/`tolls` (deliberately NOT `deductions` — most
     deductions are legitimately, permanently fleet-level by design, so a
     bare "truck_id is null" scan would flag hundreds of correctly-
     fleet-level rows as if they were broken; a deduction that genuinely
     needs a truck is assigned from its own edit sheet, item 3 above, on
     the user's own initiative) for rows with no `truck_id`, sorted
     newest-first, with per-row quick-assign (🚚, an Alert picker) and a
     multi-select bulk-assign bar. Framed neutrally throughout ("assign a
     truck," never "your data is broken") — a null-truck row can be
     entirely legitimate if it predates the account's 2nd truck. Wired
     into `navRegistry.ts`, `more/_layout.tsx`, and linked from the
     Per-Truck Profitability screen's own Unassigned nudge card.
  7. **DRIVER DIMENSION — requirement 5**: `buildTruckComparison()`
     resolves each `driver_payments` row to a truck (via its own
     `settlement_id` → that settlement's `truck_id` when present, else
     the driver's own `default_truck_id`) and sums `gross_pay +
     employer_taxes` per truck, exposed as `driverPay`/`netAfterDriverPay`
     on each row — surfaced on the Per-Truck Profitability screen
     whenever any driver-payment data exists. Deliberately a margin-AFTER
     view (net profit itself is NOT reduced by driver pay) rather than
     folded into the expense total, matching the requirement's own "see
     the true margin after paying the driver" framing as an additional
     lens, not a redefinition of `netProfit`.
  8. **TESTS** (all 4 explicitly required, plus the supporting pure
     modules): `truckComparison.test.ts` — a null-truck settlement
     surfaces as its own Unassigned row rather than disappearing; a
     truck's `directExpenses`/`allocatedExpenses` come ONLY from its own
     tagged rows plus its mile-weighted share of the fleet-level pool
     (proven by asserting truck A's totals are unaffected by truck B's
     own direct deduction); the comparison's `fleetTotals` reconcile
     exactly against a single whole-fleet `calcCanonicalCpm()` call over
     every row (both truck-tagged and fleet-level) — the literal
     "totals reconcile with the fleet totals" requirement; best/worst
     ranking; per-truck cost basis never blending across trucks; driver-
     pay resolution via both `settlement_id` and `default_truck_id`
     fallback paths. `costAllocation.test.ts` — proportional split, two
     trucks' shares summing back to exactly the pool amount, divide-by-
     zero guards. `fleetScope.test.ts` — the ONE selector→filter
     translation ("the selector state is respected by every list," proven
     at the level every list screen actually calls). `loadsScope.test.ts`
     — the settlement-join filter for the one table with no `truck_id` of
     its own. `truckAssignmentRepair.test.ts` — the repair-flow scan.
     `mapExtraction.test.ts` gained coverage for the new withheld-
     deduction/toll `truck_id` propagation (both the assigned and
     explicitly-not-truck-specific cases). Full suite: 110 suites / 2654
     tests pass; `tsc --noEmit` clean.
  9. **i18n**: all-new namespaces (`fleetScope.*`, `truckComparison.*`,
     `truckAssignments.*`) plus scattered additions to `truckSwitcher`/
     `importScreen`/`maintenance`/`truckHealth`/`deductions`/`scorecard`/
     `dashboard`/`nav`/`common` — es/ru/ar/tr fully translated, hi/uk as
     untranslated English copies per invariant #11. "Settlement" kept in
     Latin script in every locale per the glossary (`truckAssignments.
     kind.settlement` and every sentence that names one); the glossary
     test caught a real slip mid-pass — "deadhead" got translated instead
     of kept in Latin script in all four of es/ru/ar/tr's
     `truckComparison.deadheadPct`, fixed before commit.
  **Deliverables**: docs/PENDING_SQL.md §63 (`deductions.truck_id` +
  `tolls.truck_id` + backfill) is **NOT YET RUN** — apply it via the
  Supabase SQL Editor (or `pending_63.sql` at the repo root) before this
  pass's client code depends on those columns existing; every other
  change in this pass is pure client-side JS/TS, so no Edge Function
  redeploy is needed for anything here. No new native dependency — ships
  via a normal `eas update` once §63 has been run.

- MULTI-TRUCK MODEL — SELECTOR PLACEMENT + SELF-TEST FIXES (owner
  decision, no new SQL). Two parts: moving the interactive scope control
  to a dedicated Home strip, and a real self-audit of the pass above that
  found — and fixed — a genuine correctness bug in both Home's and
  Scorecard's per-truck CPM.
  1. **SELECTOR PLACEMENT**: `app/src/components/FleetScopeSelectorStrip.tsx`
     (new) is now the ONE interactive scope control in the whole app — a
     full-width horizontal chip row ("🚛 All Trucks" + "🚚 Unit N" per
     truck, selected chip highlighted) placed on Home directly under the
     greeting, above everything else — replacing the plain-text
     `FleetScopeLabel` that used to sit there. Hidden entirely via the
     same `showPicker` (`trucks.length > 1`) gate every other scope UI in
     this app already uses — no clutter for a solo operator, appears the
     moment a 2nd truck exists. `TruckSwitcher.tsx` (the top-bar badge
     shown on every OTHER tab via `app/(tabs)/_layout.tsx`'s
     `screenOptions.headerRight`) is now READ-ONLY by default
     (`interactive = false`) — a plain badge naming the current scope,
     never its own separate Alert-picker — so there is structurally only
     one place to change the scope, never two controls that could feel
     inconsistent even though they already shared the same
     `ActiveTruckContext` value. `interactive` stays available as an
     explicit opt-in prop for any future caller (none exist today).
  2. **SELF-TEST, method**: re-read every screen this pass touched against
     the request's own checklist, rather than trusting the prior pass's
     passing tests — the tests were correct for the PURE functions they
     covered, they just didn't catch that two SCREENS were computing
     their per-mile figures from the wrong inputs.
  3. **FINDING (confirmed, fixed) — Home's and Scorecard's per-truck CPM
     was a broken hybrid, not a real per-truck figure**: both screens'
     `canonicalCpm` used to call `calcCanonicalCpm()` on the FULL,
     UNFILTERED account (every truck's deductions/fuel/maintenance/tolls)
     regardless of the active scope, only swapping in the scoped truck's
     own FIXED cost basis on top. Selecting a specific truck therefore
     didn't show that truck's own CPM — it showed the WHOLE FLEET's
     revenue and variable costs with one truck's fixed cost added in,
     which is worse and more wrong than the fleet average, never that
     truck's real number. This directly violated the explicit "per-truck
     CPM uses only that truck's costs plus its allocated share" and
     "never a single blended number as if it were one truck's"
     requirements. Root cause: `truckFixedCostTotal` was the only
     scope-aware input; nothing scoped the deductions/fuel/maintenance/
     tolls arrays themselves.
     **Fix, one canonical mechanism reused by both screens**:
     `src/stats/truckComparison.ts` gained `cpmBreakdown: CanonicalCpmResult
     | null` on every `TruckComparisonRow` (the DIRECT-only
     `calcCanonicalCpm()` result `buildTruckRow()` was already computing
     internally, now exposed instead of discarded) and a new
     `withAllocatedBucket(cpm, allocatedAmount, totalMiles)` — appends a
     distinct, clearly-labeled `"Allocated Fleet Costs"` bucket (never
     blended silently into an existing category, satisfying requirement
     6's own labeling ask) and recomputes `costPerMile`/`profitPerMile`/
     `variableTotal` to include it. Both Home and Scorecard now compute
     `truckComparisonResult = buildTruckComparison(...)` UNCONDITIONALLY
     (not just for the "All Trucks" breakdown list), derive
     `scopedTruckRow = trucks.find(r => r.truckId === activeTruck.id)`,
     and branch: a scoped truck reads `withAllocatedBucket(scopedTruckRow.
     cpmBreakdown, scopedTruckRow.allocatedExpenses, milesSource.totalMiles)`
     for its headline CPM (guaranteed to equal the SAME number the
     Per-Truck Profitability screen shows for that truck, by construction
     — proven directly in `truckComparison.test.ts`'s new "a row's own
     cpmBreakdown + withAllocatedBucket reproduces that SAME row's
     headline costPerMile/profitPerMile exactly" test); "All Trucks"
     scope keeps the original fleet-wide `calcCanonicalCpm()` call,
     unchanged in shape, now correctly fed `fleetFixedCostTotal` (every
     truck's own cost basis summed, not $0 — the prior pass's own partial
     fix for the ALL-TRUCKS case, confirmed still correct and now
     consistently paired with the scoped-truck case above).
  4. **FINDING (confirmed, fixed) — Home's Hero Card/Revenue-Expense-Net
     trio/Recent Loads/Best-Worst Lanes ignored the scope selector
     entirely**: the DASHBOARD LAYOUT PER SCOPE spec's own "Single truck:
     every money card and per-mile figure is that truck only" was never
     actually wired — `fullWeeklyRevenueExpenseTrend`/
     `fullWeeklyTrueProfitTrend`/`thisWeekExpenseRows`/`recentLoads`/
     `lanes` all read the FULL, unfiltered account regardless of scope.
     Fixed with one shared filtering layer — `scopedSettlements`/
     `scopedDeductions`/`scopedFuel`/`scopedMaintenance`/`scopedTolls`
     (direct `truck_id === activeTruck.id` filter, pass-through
     unchanged in "All Trucks" scope) and `scopedLoads` (via the existing
     `filterLoadsByTruckScope()`, since `loads` has no `truck_id` of its
     own) — every one of the above now derives from these instead of the
     raw query data. Deliberately DIRECT-only, no fleet-level cost
     allocation folded in: a weekly revenue/expense TREND is a
     directional chart, not a per-mile cost figure, so it doesn't need
     the same allocation treatment the CPM figure explicitly does per
     requirement 6 — a documented, deliberate scope decision, not an
     oversight. `statsQuery` itself changed from a hardcoded
     `useFleetStats(null)` to `useFleetStats(activeTruck?.id ?? null)` —
     safe now that Scorecard's own (deliberately fleet-wide-always)
     `useFleetStats(null)` call is the only OTHER consumer, so there's no
     more risk of two screens reading this hook with silently different
     scope assumptions the way the ORIGINAL bug (documented above this
     entry, "MILES READ BUT NOT USED") was caused by.
  5. **FINDING (confirmed, fixed) — Scorecard's own "Why?" breakdown
     modal mixed scoped and fleet-wide figures within the SAME screen**:
     even after the canonicalCpm fix above, several DISPLAY-ONLY figures
     still read straight from `statsQuery.data` (Scorecard's own
     `useFleetStats(null)`, deliberately ALWAYS fleet-wide for the
     legacy-parity 0-100 score) — Revenue/Loaded Mile, the miles-missing
     warning, the Why? modal's Total/Loaded/Empty Miles + Deadhead % rows,
     and each CPM bucket's own $/mi line all divided by or displayed the
     WHOLE FLEET's numbers right next to a now-correctly-scoped headline
     CPM figure. Fixed with `scopedGrossRevenue`/`scopedLoadedMiles`/
     `scopedDeadheadPct`/`scopedEmptyMiles` (the last derived from
     `deadheadPct × totalMiles` — the same ratio `calcMiles()` itself
     used to produce deadheadPct — rather than `totalMiles − loadedMiles`,
     which would overstate empty miles whenever a settlement's own
     printed total exceeds its loads' summed miles or a manual override
     is active) — each reads from `scopedTruckRow` when one is active,
     falling back to `statsQuery.data` only in "All Trucks" scope. Home
     got the analogous fix for its own miles-missing warning (now reads
     `milesSource.totalMiles`, override-aware, instead of raw
     `stats.totalMiles`, so it can never contradict the per-mile trio it
     sits directly under).
  6. **FINDING (deliberate, not a bug) — the manual mile-override's
     comment in Scorecard was stale**: it used to say "this screen's
     stats are fleet-wide... a deliberate simplification" — no longer
     true after the fixes above, corrected in place.
  7. **Screens audited and left unchanged, findings noted rather than
     silently assumed correct**:
     - `operating-pnl.tsx`/`profit-analysis.tsx` — both genuinely
       fleet-wide-only screens (verbatim-legacy P&L port; Profit
       Analysis's own aggregate rollup) that were simply missing the
       `<FleetScopeLabel variant="fleetOnly" />` every other category-1
       screen already had — added.
     - `truck-comparison.tsx`/`truck-assignments.tsx` — deliberately do
       NOT follow the global scope selector at all (their whole purpose
       is comparing/fixing assignments ACROSS every truck) — confirmed
       correct as built, not a gap.
     - `alerts.ts`/`aiCoachSummary.ts`/`proactiveCoach.ts` (maintenance-
       health nudges, the AI Coach's cost-basis nudge) — still default to
       the first truck when scope is "All Trucks" (the FIVE ADDITIONS
       pass's own established simplification, unchanged this round) —
       flagged as an existing, documented limitation, not silently
       redone.
     - Scorecard's `duplicateWeeksIgnored` warning and the legacy 0-100
       `scorecard` score itself (score/grade/`revenuePerMile`/
       `netPerMile`/`fuelPerMile`) — confirmed, NOT fixed, deliberately:
       CLAUDE.md's own TRUE-PROFIT CONSISTENCY entry already establishes
       the legacy score as a verbatim-legacy, always-fleet-wide figure by
       design; extending that exemption to `duplicateWeeksIgnored`
       (a data-quality housekeeping count, not a money figure) was
       judged the same class of acceptable, minor, flagged simplification
       given the size of this pass — not silently redefined as "fixed."
     - `share-profit.tsx`/`ceo-mode.tsx`/`documents.tsx` — not reviewed
       this pass at all; flagged honestly as unaudited rather than
       claimed correct.
  8. **Reconciliation, staleness, import matcher, repair flow** — all
     re-verified by code review (no device/simulator available in this
     environment, the same standing limitation this codebase has flagged
     at every prior UI-testing juncture): a null-truck settlement still
     surfaces via the Unassigned row/fleet-wide queries (no filter change
     touched this); `buildTruckComparison()`'s own reconciliation
     invariant is unchanged and still tested; every scope-dependent
     `useMemo` keys off `activeTruck`/`activeTruckId`, so switching scope
     recomputes synchronously with zero staleness (Home's own scoping is
     entirely client-side filtering of already-fetched data, so there's
     no network round-trip in the critical path either); the import
     truck-matcher's "not truck-specific" sentinel and the Fix Truck
     Assignments screen's bulk-assign were both re-read end to end with
     no defects found.
  Tests: `truckComparison.test.ts` gained the reproduces-the-row's-own-
  headline-figures proof (item 3 above) plus a dedicated
  `withAllocatedBucket` describe block (labeled-bucket append, the
  zero-allocation passthrough, the divide-by-zero-miles null guard).
  110 suites / 2658 tests pass (unchanged count — no new pure module,
  only 4 new test cases inside the existing file); `tsc --noEmit` clean.
  No new i18n strings this pass — every new/changed UI reuses keys
  already shipped in the prior MULTI-TRUCK MODEL entry. No SQL/Edge
  Function changes — this is a pure client-side correctness + placement
  fix on top of the same §63 schema. Ships via a normal `eas update`
  (§63 must still be run first, unchanged from the prior entry).

- MULTI-TRUCK MODEL — AUDIT OF THE 3 PREVIOUSLY-UNREVIEWED SCREENS (owner
  decision, no new SQL). The prior self-test pass explicitly flagged
  Share Weekly Profit, AI Coach, and Documents as unaudited rather than
  claiming them correct. This pass reads all three end to end.
  1. **FINDING (confirmed, fixed) — Share Weekly Profit didn't honor the
     scope selector at all, AND had a pre-existing internal
     inconsistency**: `useSettlements()` was completely unfiltered, so
     the week picker and "selected" settlement always spanned every
     truck regardless of the active scope. Independently of scope, the
     Revenue metric (`selected.gross`) read exactly ONE settlement row's
     own value while the Profit metric already AGGREGATED every
     settlement sharing that `week_ending` (the routine multi-truck case
     where every truck settles the same week) — the two metrics on the
     SAME share card could silently disagree about which trucks'
     numbers they even covered. Fixed together: `scopedSettlements`/
     `scopedDeductions`/`scopedFuel`/`scopedMaintenance`/`scopedTolls`
     (same direct `truck_id === activeTruck.id` filter pattern as Home's
     own fix) feed BOTH metrics now; the week picker changed from a list
     of raw settlement rows to a deduped list of `week_ending` strings
     (since 2+ settlements can legitimately share one week), and Revenue
     is now the SUM of every scoped settlement's gross for the selected
     week — always the same underlying row set Profit's own
     `buildWeeklyTrueProfitTrend()` call aggregates over, so the two can
     never disagree again. `<FleetScopeLabel />` added.
  2. **FINDING (confirmed, labeled rather than re-scoped) — AI Coach's
     dollar figures are fleet-wide by design, but this was previously
     undocumented ON SCREEN**: `useAiCoachSummary()`/`useProactiveCoach()`
     both intentionally read fleet-wide, unfiltered settlement data (see
     each file's own pre-existing header comment) — the weekly review
     text, recommendations, and periodic nudges are composed from
     account-wide data specifically so this stays within the app's own
     "one ai-advisor call per week" cost-control ceiling; re-deriving a
     separate AI-composed briefing PER TRUCK would multiply that budget
     and was judged out of proportion for this pass. The real, confirmed
     bug: after the prior pass correctly scoped Home's Hero Card and
     per-mile trio to the active truck, a user could see a truck-scoped
     profit figure at the top of Home and an unlabeled FLEET-WIDE dollar
     figure (e.g. "this week's revenue was $X" in the AI weekly review
     text) directly below it in the AI Coach card, with nothing
     explaining the discrepancy — exactly the "silently disagreeing
     numbers" risk this whole audit exists to catch. Fixed by treating
     AI Coach as a category-1 fleet-only surface (same treatment as Tax
     Estimator/Capital Account/Cash Flow): Home's `AiCoachSection` shows
     the existing `fleetScope.fleetWideAlways` note whenever a specific
     truck is actively selected (matching the Business Balance/Tax
     Strip cards right above it); the dedicated `ceo-mode.tsx` screen
     gained `<FleetScopeLabel variant="fleetOnly" />` under its title.
  3. **FINDING (confirmed, labeled — cannot be cheaply re-scoped) —
     Documents has no way to follow the selector**: the `documents`
     table has no `truck_id` column at all (confirmed via `db.ts`'s own
     `DocumentRow` type) — it's a raw upload/audit-trail archive, and
     some documents never even produce a truck-attributable record (an
     archived `'other'`-docType file with no resolved category, for
     instance). Tracing a document to a truck would require joining
     through its linked settlement/deduction/maintenance/toll row for
     EVERY row in the list (the same mechanism `findLinkedRecords()`
     already uses for a SINGLE document's own detail view, not built for
     list-wide filtering) — a real, nontrivial feature, not a quick fix,
     and out of scope for this audit pass. Documents is instead
     explicitly labeled fleet-wide (`<FleetScopeLabel variant="fleetOnly"
     />`) so the screen is honest about not following the selector
     rather than silently ambiguous about it — a genuine per-document
     truck join is flagged here as a real follow-up, not silently
     dropped.
  Tests: no new pure-logic module this pass (the share-profit fix is
  screen-local filtering, reusing already-tested `buildWeeklyTrueProfitTrend()`
  unchanged) — 110 suites / 2658 tests pass (count unchanged), `tsc
  --noEmit` clean. No new i18n strings — every label added this pass
  reuses `fleetScope.fleetWideAlways`, already shipped in the first
  MULTI-TRUCK MODEL pass. No SQL/Edge Function changes. Ships via a
  normal `eas update`.

- MULTI-TRUCK MODEL — CPM/PPM BROKEN AGAIN, ROOT CAUSE + FULL
  RE-VERIFICATION (owner decision, device report: "the per-mile trio
  shows implausible values and doesn't change when I switch the hero
  card's period tabs," no new SQL). ROOT CAUSE (traced before any fix,
  per the owner's own explicit request): Home's per-mile trio
  (`app/(tabs)/index.tsx`) was wired to `canonicalCpm`, computed from
  `truckComparisonResult`/`scopedTruckRow` — which were themselves built
  from `settlementsQuery.data ?? []` etc., the FULL, UNFILTERED query
  results, completely independent of `heroPeriod`. The Hero Card's own
  number/chart (via `calcHeroPeriod()`) DID read `heroPeriod` correctly —
  so the trio wasn't reading a *different* period from the Hero Card, it
  was reading NO period at all, an always-all-time blended average sitting
  directly under a number that visibly changed on every tab tap — exactly
  "implausible and unchanging" once a real trucking business has more than
  a few months of history (an all-time average buries any recent trend).
  This was a genuine regression from the immediately-preceding SELECTOR
  PLACEMENT pass, not a pre-existing bug — that pass fixed the trio's
  TRUCK scope but never gave it a PERIOD scope to begin with.
  **FIX — one shared resolver, two new pure modules**:
  `src/stats/heroPeriodWindow.ts`'s `resolveHeroPeriodDateWindow(period,
  sortedWeekEndings, now)` turns a `HeroPeriod` selection into a concrete
  `{startIso, endIso} | null` window — `thisWeek`/`lastWeek` resolve to the
  exact same two settlement weeks `calcHeroPeriod()` itself already uses
  (both read from the identical ascending `week_ending` list, so the two
  can never land on a different window from each other despite being
  separate function calls), `1M`/`3M`/`6M`/`yearly` are the same rolling-
  N-day-ending-now windows `calcHeroPeriod()` already defines for those
  tabs; `filterRowsByDateWindow()` is the one shared row filter every
  period-scoped input (settlements/deductions/fuel) now goes through.
  `src/stats/periodScopedCpm.ts`'s `buildPeriodScopedCpm()` is the new
  single entry point: resolves the window, filters settlements/loads/
  deductions/fuel/maintenance/tolls through it, calls the EXISTING
  `buildTruckComparison()` on the filtered set, and returns either the
  active truck's own row (via the pre-existing `withAllocatedBucket()`
  from the SELECTOR PLACEMENT pass, so direct + labeled-allocated costs
  stay separated exactly as before) or — in "All Trucks" scope — a
  fleet-wide `calcCanonicalCpm()` call over the same filtered rows plus
  every truck's own `calcTruckCostBasisWeekly()` weighted by how many of
  ITS OWN settlements actually fall inside the window. This is what makes
  fixed-cost pro-ration automatic rather than a special case: a truck
  payment is charged once per settlement week that's actually IN the
  window, so "This Week" (1 settlement) is naturally ~4x cheaper in fixed
  cost than "1M" (~4 settlements) with no separate scaling logic —
  verified directly by a dedicated test (below). Home now computes
  `heroWindow` ONCE (`resolveHeroPeriodDateWindow`, same period/
  weekEndings/`now` reference `buildPeriodScopedCpm()` resolves its own
  copy from) and feeds it through to the trio, the sanity guards, AND
  (see below) the Hero Card's own progress bar — numerator (revenue/
  costs) and denominator (miles) are now guaranteed to come from the
  identical window on every consumer, by construction, not by convention.
  **SANITY GUARDS**: `perMileNoWindow` (the window itself is null — no
  settlement falls in this period at all) shows
  `dashboard.perMileTrio.noDataForPeriod` instead of a number, distinct
  from `perMileMilesMissing` (settlements exist in the window but have no
  recorded miles) which reuses Scorecard's own `milesMissingWarning` —
  two genuinely different situations, named differently rather than
  collapsed into one generic "no data" message. The pre-existing
  CPM-too-high (`>$4/mi`) warning is unchanged in trigger, but now tappable
  straight into a NEW, Home-local, period-aware "Why?" `ModalSheet`
  (reusing Scorecard's own real i18n keys — `scorecard.whyTitle`/
  `whyFixedTotal`/`whyVariableTotal`/`whyExcludedOneOffsTitle`/
  `whyExcludedOneOffsNote`/`cpmExcludedTotal` — rather than duplicating
  new strings) showing the bucket breakdown for THIS SAME window, since
  Scorecard's own "Why?" breakdown is deliberately all-time/unwindowed and
  would otherwise silently show a different period than the trio a user
  just tapped from.
  **PHASE 4 — ADVERSARIAL RE-VERIFICATION (report before fix, per the
  owner's own explicit checklist)**:
  1. **FOUND AND FIXED — a second instance of the exact "two figures on
     the same card, different windows" bug class** (the owner's own
     example: the Share card bug from the prior audit pass): the Hero
     Card's 0-100 profit-score progress bar (`calcScorecard()`, rendered
     directly under the Hero Card's own now-period-accurate headline
     number) still read all-time `stats`/`fuelCost` — untouched by this
     pass's own root-cause fix, since it was never wired to `canonicalCpm`
     in the first place, a separate code path with the identical
     underlying mistake. Fixed by period-scoping its own inputs
     (`periodDeductionsAll`/`fuelCost`, both filtered through the SAME
     `heroWindow`) and sourcing `grossRevenue`/`totalMiles` from
     `periodScopedCpm`'s own scoped-truck-row-or-fleet-aggregate — the
     bar's inputs can now never drift onto a different window than the
     number sitting directly above it. `calcScorecard()`'s own formula and
     its "count every deduction unconditionally" legacy convention (CLAUDE.md's
     established exemption, distinct from the canonical CPM engine's own
     Meals/Advance-Repayment/Escrow exclusions) were deliberately left
     untouched — only its inputs are now period-scoped, never its math.
  2. **CONFIRMED CORRECT, no change needed — the other screens named**:
     Scorecard's own CPM (fixed in the immediately-preceding SELECTOR
     PLACEMENT pass) is deliberately all-time/unwindowed — it has no
     period tabs of its own, so "the same metric agrees across every
     screen that shows it" doesn't apply to it the way it does to Home's
     trio; Home's own new period-scoped figure and Scorecard's all-time
     figure are two DIFFERENT, individually-labeled numbers by design, not
     a disagreement. Cash Flow, Profit Analysis, Operating P&L, Accountant
     Package, and CEO Mode all already carry `<FleetScopeLabel
     variant="fleetOnly" />` (from the two prior MULTI-TRUCK MODEL passes)
     and were re-verified this pass to have zero stray `truck_id`/
     `activeTruck` filtering anywhere in their own data-fetch code —
     genuinely fleet-wide, consistent with their own labels. Deductions/
     Settlements/Loads correctly chain truck-scope-then-their-own-screen-
     local period filter with no numerator/denominator mismatch found.
  3. **RECONCILIATION, verified by construction and by test**: the "All
     Trucks" branch of `buildPeriodScopedCpm()` computes its own
     `grossRevenue`/`totalMiles` from the SAME window-filtered settlement/
     load rows `buildTruckComparison()`'s own `fleetTotals` is built from
     (both ultimately route through the identical `calcMiles()`/plain-sum
     logic) — the two can't drift apart because neither is a second,
     independently-derived total. `truckComparison.test.ts`'s own
     pre-existing test (from the SELECTOR PLACEMENT pass) already proves
     `fleetTotals` equals a single whole-fleet `calcCanonicalCpm()` call
     over every row (truck-tagged + fleet-level pool); this pass's own
     `periodScopedCpm.test.ts` adds the period-filtered analog — a
     dedicated "All Trucks scope still reconciles to the same
     window-filtered totals" case (below).
  4. **CANONICAL-HELPERS-ONLY, re-audited**: grepped every screen for a
     hand-rolled `revenue/miles`-shaped expression; the only true positive
     was `Loads` screen's own `rpm()` — a PER-LOAD rate for a single row
     in a list (the same kind of per-row rate `rankLoadsByRpm()`
     elsewhere in this app already computes), never a fleet/period
     aggregate competing with `calcCanonicalCpm()`. No other screen
     computes its own version of CPM, RPM, profit, miles, or deductible
     totals — every aggregate consumer routes through the same shared
     modules (`trueProfit.ts`, `cpm.ts`, `miles.ts`, `truckComparison.ts`,
     now also `periodScopedCpm.ts`/`heroPeriodWindow.ts`).
  5. **NOTED, not changed (explicitly out of scope)**: the Revenue/
     Expenses/Net Profit trio directly above the per-mile trio on Home
     (DASHBOARD SIMPLIFICATION's own original design) has always been a
     fixed "this week vs. last week" comparison, independent of
     `heroPeriod` — a real, pre-existing asymmetry now sandwiched between
     two period-aware elements (the Hero Card above it, the per-mile trio
     below it), but out of this pass's stated scope (the owner's own
     report named the per-mile trio and the Hero Card specifically) and
     flagged here rather than silently touched. `proactiveCoach.ts`'s own
     internal `latestCpm` (an all-time figure used only as a nudge
     THRESHOLD input, never itself displayed anywhere) was reviewed and
     left unchanged for the same reason — it's not a displayed figure that
     could visibly disagree with anything.
  Tests: `heroPeriodWindow.test.ts` (new, 8 tests) — thisWeek/lastWeek
  resolution and null-when-unresolvable, the four rolling-day windows
  against a fixed `now`, inclusive-bounds/no-date-field row filtering.
  `periodScopedCpm.test.ts` (new, 11 tests) — a realistic multi-month,
  8-settlement dataset (deliberately varying gross/miles/deductions every
  week, so a bug that silently reused the wrong window couldn't hide
  behind a flat per-week ratio) proving every one of `thisWeek`/
  `lastWeek`/`1M`/`3M`/`6M`/`yearly` produces a genuinely distinct,
  independently-verified RPM/CPM; a direct "numerator and denominator
  always drawn from the identical window" proof; the null-window/
  zero-settlements case returning `cpm: null` rather than a silent
  all-time fallback; the "All Trucks" reconciliation case; and a dedicated
  fixed-cost pro-ration block (1 vs. 4 settlement weeks of a $1,000/month
  truck payment, proving the charge scales with the window rather than a
  flat lump sum). Full suite: 112 suites / 2683 tests pass; `tsc --noEmit`
  clean. i18n: 1 new key, `dashboard.perMileTrio.noDataForPeriod` — es/ru/
  ar/tr translated, hi/uk as untranslated English copies per invariant
  #11; glossary test re-passed clean. No SQL/Edge Function changes —
  every change in this pass is pure client-side JS/TS. Ships via a normal
  `eas update`.

- MULTI-TRUCK MODEL — CPM/PPM BROKEN AGAIN, ITEM 0 (owner decision, direct
  follow-up to the pass above: "also fix the asymmetry you flagged"). The
  Revenue/Expenses/Net Profit trio directly under the Hero Card was still
  a FIXED "this week vs last week" comparison no matter which period tab
  was active, even after the per-mile trio and the profit-score bar were
  both fixed to follow `heroPeriod` — the same "rows on the same screen
  describe different windows" bug class, just not yet closed for this
  one remaining element.
  **FIX**: `src/stats/heroPeriodWindow.ts` gained
  `resolvePreviousHeroPeriodDateWindow()` (the companion to
  `resolveHeroPeriodDateWindow()` — the immediately PRECEDING, same-
  length, non-overlapping window: the settlement week right before
  "this week"/"last week," or the equal-length rolling window
  immediately before the current one for 1M/3M/6M/yearly) and
  `calcHeroRevenueExpenseTrio()`, which sums RAW settlement/deduction
  rows DIRECTLY through the SAME `filterRowsByDateWindow()` every other
  period-scoped figure on Home already uses — deliberately NOT re-
  derived from the settlement-week-bucketed weekly trend the way an
  earlier draft of this fix did. That mattered: a settlement-week-
  bucketed sum can silently miss a deduction dated in a "gap" week with
  no settlement covering it (a real out-of-pocket expense — insurance,
  a repair — logged while the truck sat idle between settlements), which
  would have made the Expenses tile's own number disagree with the
  Expense Total Explainer modal it opens into. Summing raw rows directly
  by the identical window both consumers already use is what guarantees
  they can never drift apart — proven directly by a dedicated test
  reconciling `calcHeroRevenueExpenseTrio()`'s own `expenses` figure
  against a raw `filterRowsByDateWindow()` sum over the same rows.
  Net Profit is NOT computed by this new function — Home reuses
  `heroPeriodResult.netProfit`/`.change` (the Hero Card's own canonical
  true-profit figure) directly, so the trio's Net Profit tile and the
  Hero Card's own headline number are provably the same value rather
  than two independently-computed ones.
  **A second, related fix found while wiring this in**: the Expense
  Total Explainer modal (opened by tapping the Expenses tile) used to
  ALWAYS read `thisWeekExpenseRows` — a hardcoded "this week" window —
  regardless of `heroPeriod`, so selecting "1M" would show a period-
  correct Expenses number on the tile but open a modal still titled
  "This Week's Expenses" and showing only the latest settlement week's
  rows: the exact tile-to-modal disagreement this whole pass exists to
  prevent, just one level deeper than the number itself. Fixed by
  switching the modal to `periodDeductionsAll` (the same period+truck-
  scoped rows the profit-score bar already reads) and adding
  `dashboard.expenseExplainer.titleByPeriod.{thisWeek,lastWeek,1M,3M,
  6M,yearly}` (replacing the old static `title` key) plus a period-
  neutral `empty` string ("No expenses recorded for this period yet.",
  was "...this week yet.") across all 7 locales.
  `handleDeleteExpenseRow()`'s own row lookup was switched from
  `thisWeekExpenseRows.find()` to `periodDeductionsAll.find()` to match
  — otherwise deleting a row from a non-"this week" breakdown would have
  silently failed to find it and skipped its linked-document cleanup.
  `thisWeekPoint`/`thisWeekExpenseRows` themselves are UNCHANGED and stay
  pinned to the literal latest settlement week — they still (and only)
  feed the "All Trucks" PER TRUCK THIS WEEK card, a deliberately
  separate, always-this-week feature unrelated to the period tabs.
  Tests: `heroPeriodWindow.test.ts` gained `resolvePreviousHeroPeriodDateWindow`
  (thisWeek's previous window is exactly lastWeek's own window; a
  rolling period's previous window is same-length and non-overlapping;
  null when there's no data that far back) and `calcHeroRevenueExpenseTrio`
  (thisWeek's revenue/expenses match the exact settlement-week window
  with a delta against lastWeek; the reconciliation proof against a raw
  `filterRowsByDateWindow` sum; no fabricated delta when the previous
  window is empty; zero/null-window on a fresh account; a 1M rolling
  case aggregating 3 settlement weeks with a real previous-window
  comparison) — 9 new tests. Full suite: 112 suites / 2692 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (glossary
  test re-passed clean). No SQL/Edge Function changes — pure client-side
  JS/TS. Ships via a normal `eas update`.
