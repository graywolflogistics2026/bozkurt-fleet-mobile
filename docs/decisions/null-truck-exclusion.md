# Null Truck Exclusion

> NULL `truck_id` = fleet-level row; a specific-truck scope must match `truck_id = X OR truck_id IS NULL`.
> First fixed in `entityHooks.ts` applyFilters(); reintroduced in computeKpis() and fixed again.
> Every new scoped filter needs a NULL-truck test.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- MULTI-TRUCK MODEL — NULL-TRUCK EXCLUSION ACROSS EVERY SCOPED SCREEN + TWO
  UNRELATED DEVICE BUGS (owner decision, device report: "Deductions screen
  is empty," "Documents screen is empty," splash wordmark barely visible;
  no new SQL). Three findings, reported before fixing, then fixed:
  1. **ROOT CAUSE, confirmed exactly as the report's own hypothesis**:
     `src/data/entityHooks.ts`'s `useEntityList()`/`useEntityListPaged()`
     applied every filter (including `truck_id`) as a plain `.eq(key,
     value)` — SQL equality never matches a NULL row, regardless of the
     comparison value. That's correct for "All Trucks" scope (the filter
     value is `undefined` there, skipped entirely, so the unfiltered query
     already includes every fleet-level row) but WRONG the instant a
     SPECIFIC truck is scoped — and `ActiveTruckContext`'s own long-
     standing "n=1 shortcut" (CLAUDE.md invariant #7) means a
     SINGLE-TRUCK account's `activeTruckId` is ALWAYS a real truck id,
     NEVER "All Trucks" (`showPicker: trucks.length > 1` hides the picker
     entirely for one truck — there is no way to ever reach the null
     state). Every fleet-level deduction/fuel/maintenance/toll row
     (insurance, permits, accounting fees — "most deductions stay
     fleet-level (null) by design," §63's own entry) was therefore
     PERMANENTLY invisible for the majority of real accounts, with
     literally no picker to work around it — this is the actual "the
     screen is empty" bug, not a display glitch.
     **Fix, one shared choke point**: `entityHooks.ts` gained
     `applyFilters()`, special-casing `truck_id` specifically —
     `query.or('truck_id.eq.<value>,truck_id.is.null')` instead of a plain
     `.eq()` — a real value now matches THAT truck's own rows **OR** any
     fleet-level (null) row; `truck_id IS NULL` is never "genuinely
     truck-specific" to some OTHER truck, so including it in every
     specific-truck's own view can never leak another truck's data, only
     ever restore a fleet-level row's visibility. Every OTHER filter key
     keeps its original plain `.eq()` behavior — deliberately narrow, not
     a general "any filter can mean OR NULL" mechanism. `loads` has no
     `truck_id` column of its own (attributed via `settlement_id` ->
     `settlements.truck_id`, per the ORIGINAL MULTI-TRUCK MODEL entry's
     own design) so it can't use this same server-side mechanism —
     `src/stats/loadsScope.ts`'s `filterLoadsByTruckScope()` had the
     IDENTICAL bug client-side (excluded a load with no `settlement_id`,
     or whose settlement has no `truck_id`, from every specific-truck
     scope) and got the identical fix: such a load is now included in
     EVERY specific-truck scope, never just "All Trucks."
     `app/(tabs)/more/maintenance.tsx` had its own screen-local inline
     ternary (`activeTruckId ? {truck_id: activeTruckId} : undefined`)
     doing the same job as `src/stats/fleetScope.ts`'s shared
     `truckIdFilterFor()` — harmless on its own, but a divergence risk
     that fix's own header comment explicitly warns against; switched to
     the shared helper for consistency, not a second bug fix.
     **AUDIT — every list that gained scope filtering** (the report's own
     explicit checklist), verified by reading each screen's actual query
     call, not assumed: `deductions.tsx`/`settlements.tsx`/`fuel.tsx`/
     `tolls.tsx`/`maintenance.tsx` all route through `useEntityList({
     truck_id: truckIdFilterFor(activeTruckId) })` — fixed centrally by
     the one `entityHooks.ts` change, no screen-by-screen edit needed
     beyond maintenance's own convention alignment. `loads.tsx` routes
     through `filterLoadsByTruckScope()` — fixed there directly.
     `documents.tsx`/`reimbursements.tsx` were confirmed to apply NO
     truck filter at all (neither table has a `truck_id` column) — never
     part of this bug class, correct as-is.
  2. **A SECOND, UNRELATED root cause for "Documents screen is empty" —
     found by reading the code, not assumed to be the same bug as
     item 1**: `documents` was simply missing from `entityHooks.ts`'s
     `ORDER_COLUMN` map, so every query fell back to
     `DEFAULT_ORDER_COLUMN` ('created_at') — a column `documents` has
     never had (it uses `imported_at` instead, `docs/SCHEMA.sql`).
     `.order('created_at', ...)` against a nonexistent column is a real
     Postgres error on EVERY query, silently swallowed by the screen
     (which only ever checked `.data`, never `.isError`) and rendered as
     an empty list with no visible error anywhere — a completely
     different failure mode from item 1's NULL-exclusion, despite
     producing the same visible symptom. Fixed by adding `documents:
     'imported_at'` to `ORDER_COLUMN`. Auditing this SAME defect class
     (a table missing from the map that doesn't actually have
     `created_at`) found it independently, proactively affects two MORE
     live tables neither named in the report: `loans` (Loan Center —
     reachable, in active use, equally broken) and `credit_cards`
     (currently behind `FEATURE_FLAGS.bankCreditCards`, lower real-world
     impact today, fixed anyway since it's the identical bug) — both
     added as `loans: 'id'`/`credit_cards: 'id'` (neither table has a
     natural transaction-date column of its own to prefer over a stable
     ordering; a real `created_at` column would be the better long-term
     fix, flagged as a follow-up schema migration, not attempted this
     pass since a pure client-side ordering fallback already resolves
     the actual crash).
  3. **Tests, matching the report's own explicit ask** — "a NULL-truck
     row is visible in the fleet view on every one of those screens, and
     the total row count with 'All Trucks' selected equals the unfiltered
     count": `src/data/__tests__/entityHooks.test.ts` (extended) proves
     the REAL `queryFn` a `truck_id` filter now issues
     `.or('truck_id.eq.<X>,truck_id.is.null')` (never a plain `.eq()`
     that would silently exclude a fleet-level row) and that omitting the
     filter (the "All Trucks" case) issues no `truck_id` constraint at
     all — the full unfiltered row set, which already includes every
     fleet-level AND every truck-specific row, satisfying "total row
     count with All Trucks equals the unfiltered count" by construction
     (there is no separate "All Trucks" query to disagree with the
     unfiltered one — they're the same query). This one fix covers
     deductions/settlements/fuel/tolls/maintenance identically, since
     they all share this exact `queryFn` code path — a single test
     against the shared mechanism is real coverage for all five, not a
     stand-in. `src/stats/__tests__/loadsScope.test.ts` (rewritten) — the
     two pre-existing tests that asserted the OLD (buggy) exclusion
     behavior were replaced with tests asserting the NEW, correct
     behavior (a fleet-level/no-settlement load is visible in EVERY
     specific-truck scope, a genuinely different-truck's load is still
     excluded) plus a dedicated single-truck-account case proving a
     specific-truck scope returns the FULL unfiltered set when every
     settlement already belongs to that one truck (the literal "total row
     count... equals the unfiltered count" case for the one table that
     needed a client-side fix). Full suite: 114 suites / 2755 tests pass;
     `tsc --noEmit` clean.
  4. **SPLASH WORDMARK TOO SMALL, unrelated third device report, fixed in
     the same pass**: `app/scripts/generateBrandAssets.js`'s
     `composeSplashWithWordmarkSvg()` previously sized "BOZKA TRUCKING AI"
     at a fixed, tiny fraction of the CANVAS (`size * 0.032`) with no
     relationship to the truck mark's own on-canvas width at all — at the
     mark's real size the wordmark rendered at roughly 1/20th its width,
     unreadable at real launch-screen scale. Fixed by solving for the
     fontSize algebraically instead: the rendered string's estimated
     width (glyphs + letter-spacing gaps, using a measured-in-practice
     average glyph-width-to-fontSize ratio for bold Arial/Helvetica
     uppercase — ordinary letters ~0.66x their own fontSize, the two
     spaces in this specific string narrower at ~0.32x) is set to land at
     96% of the truck mark's own width ("roughly the width of the truck
     mark," the report's own exact framing) — robust to a future
     wordmark-text change too, rather than a magic number tuned only for
     this one string. `font-weight` raised 700 -> 800 ("heavier weight");
     the gap between the mark and the text block raised from `size *
     0.045` to `size * 0.09` ("generous spacing between icon and text").
     Verified visually before committing (per the report's own explicit
     ask) by regenerating `splash-icon.png`, compositing it over the
     app's real `#08080c` background (the same color
     `expo-splash-screen`'s own plugin config already fills the screen
     with), and inspecting it at both a large (400px) and a real-device-
     scale-like (180px) preview — the wordmark reads clearly, bold, and
     visually proportionate to the truck mark at both sizes, with none of
     the previous cramped/illegible feel. Only `splash-icon.png` changed
     on disk — `icon.png`/`favicon.png`/the Android adaptive layers/every
     store-assets file are built from the untouched `composeSquareSvg()`/
     `composeRectSvg()` functions and were confirmed unaffected via `git
     status` after regenerating everything.
     **NATIVE BUILD REQUIRED, same standing limitation as every prior
     brand-asset pass**: `splash-icon.png` is a NATIVE-level asset
     (`expo-splash-screen`'s own plugin config in `app.config.js`,
     unchanged this pass) baked into the compiled binary at build time —
     an OTA `eas update` CANNOT ship this change; only a fresh EAS Build
     re-bundles the new PNG. Every other change in this pass (items 1-3,
     the NULL-truck exclusion fixes) is pure client-side JS/TS and ships
     via a normal `eas update` immediately.
  No SQL/Edge Function changes this pass — every fix is pure client-side
  JS/TS plus one build-time-only asset regeneration script edit.

- KPI CONSISTENCY — NULL-TRUCK EXCLUSION REINTRODUCED (owner decision,
  device report immediately following the pass above: "the new KPI engine
  is dropping most of my data" — expenses reading $0 including fuel
  specifically, Scorecard miles reading 3,120 vs. the real 10,146, Weekly
  Net Trend listing only 2 of 6 settlement weeks). No SQL/Edge Function
  changes; pure client-side JS/TS.
  **DIAGNOSIS (per the owner's own 4-point checklist, answered in order)**:
  1. **YES, confirmed** — `computeKpis()`'s scoped-truck branch filtered
     every row array by PLAIN EQUALITY (`row.truck_id === truckScope`) —
     the EXACT bug class already found and fixed once in
     `entityHooks.ts`'s `applyFilters()` and `loadsScope.ts`'s
     `filterLoadsByTruckScope()`, reintroduced in the brand-new
     `computeKpis()` path the immediately-preceding KPI CONSISTENCY pass
     shipped. SQL equality never matches a NULL row; `ActiveTruckContext`'s
     own n=1 shortcut means a SINGLE-TRUCK account's `activeTruckId` is
     ALWAYS a real, non-null truck id (there is no "All Trucks" picker to
     fall back to) — so this wasn't a rare multi-truck edge case, it
     silently dropped every fleet-level/unassigned settlement, deduction,
     fuel purchase, maintenance record, and toll for the common
     single-truck account the instant a specific truck was scoped.
  2. **NO** — `useEntityList()` (`src/data/entityHooks.ts`, what
     `useSettlements`/`useDeductions`/`useFuelPurchases`/
     `useMaintenanceRecords`/`useTolls` are all bound to) fetches the
     table's FULL row set with no `.range()`/`.limit()` at all, confirmed
     by re-reading the function directly — genuinely unbounded, matching
     its own header comment ("stays fully unchanged... every aggregate
     consumer... must keep reading complete data"). The opt-in
     `useEntityListPaged()` companion exists but nothing in the KPI path
     calls it. Pagination was not the cause.
  3. **NO** — Scorecard passes `window: null` (explicitly "no time
     filtering," its own documented all-time design) and `computeKpis()`
     only ever filters by date once, at the top, and only when a real
     window is given. Not double-applied, not narrower than intended.
  4. **YES, they all reach the engine** — every one of
     deductions/fuelPurchases/maintenanceRecords/tolls is a REQUIRED
     (non-optional) array parameter on `computeKpis()`'s own TypeScript
     type, and every real call site (Scorecard, `periodScopedCpm.ts`) was
     confirmed passing real arrays via `queryResult.data ?? []`, not a
     query object or a dropped await. The data reaching the function was
     real and complete — it was FILTERED AWAY once inside, by the
     plain-equality truck check in point 1. Fuel reading $0 specifically
     is explained by the same root cause: most real fuel purchases DO
     carry a `truck_id`, but this account's apparently didn't (or the
     account is effectively single-truck with historically-unassigned
     rows) — same mechanism, same fix, no separate bug in the fuel path.
  **THE FIX**: `src/stats/kpi.ts` gained one exported predicate,
  `matchesTruckScope(rowTruckId, truckScope)` — `truckScope: null` ("All
  Trucks") matches everything; a real `truckScope` matches that truck's
  own rows **OR** any null-truck row, mirroring `entityHooks.ts`'s own
  established rule exactly ("`truck_id IS NULL` is never 'genuinely
  truck-specific' to some OTHER truck, so including it in a specific
  truck's own scoped view can never leak another truck's data, only ever
  restore a fleet-level row's visibility" — the same accepted tradeoff:
  in a genuine multi-truck account a still-unassigned row shows under
  EVERY truck's own individual scope until fixed via the Truck
  Assignments repair screen, which is strictly better than silently
  dropping real data, per CLAUDE.md's own "no dollar silently lost"
  principle). `computeKpis()` was restructured around this ONE shared
  filter for both the "All Trucks" and scoped-truck branches — filtering
  settlements/deductions/fuel/maintenance/tolls identically, THEN
  computing gross/net/miles/CPM directly from that null-inclusive set,
  rather than picking apart `buildTruckComparison()`'s own row (which
  correctly stays PLAIN-EQUALITY/allocation-based for the completely
  separate Per-Truck Profitability screen's "which truck should I keep"
  concept — deliberately left untouched, since real multi-truck cost
  ALLOCATION is still the right idea for THAT screen and was never the
  bug here). `computeKpis()` no longer calls `buildTruckComparison()` at
  all internally as a result — a real simplification, not just a fix.
  The SAME exact bug, independently reintroduced in TWO screen-local
  copies of "scope this row array to the active truck," was found and
  fixed identically: `app/(tabs)/index.tsx`'s own `scopedSettlements`/
  `scopedDeductions`/`scopedFuel`/`scopedMaintenance`/`scopedTolls`
  (feeding the Hero Card, Revenue/Expense/Net trio, Recent Loads,
  Best/Worst Lanes — pre-existing code from an EARLIER pass, not
  introduced by the KPI CONSISTENCY pass, but the identical bug class)
  and `app/(tabs)/more/scorecard.tsx`'s own equivalent five (feeding the
  Weekly Net Trend list and the "settlements missing miles" Why?
  breakdown section) — both now call the shared `matchesTruckScope()`
  instead of hand-rolling their own plain-equality filter, which is
  exactly how this bug was reintroduced in the first place.
  **SILENT-ZERO GUARD** (owner's own explicit ask: "a zero expense figure
  in accounting software is never an acceptable silent default"):
  `computeKpis()` now validates every one of its 7 array-shaped inputs
  (`trucks`/`settlements`/`loads`/`deductions`/`fuelPurchases`/
  `maintenanceRecords`/`tolls`) with `assertArray()` — throws a
  descriptive `Error` (never a silent `console.error`-and-continue; a
  pure calculation function has no sensible "recover and keep going"
  path once its inputs are invalid, and returning a zero-filled result IS
  the exact bug this guard exists to prevent) naming the bad parameter
  and its actual runtime type/shape, whether that's `undefined`, `null`,
  or a whole react-query result object (`{ data: [...], isLoading, ... }`)
  passed instead of its own `.data` array. Every real call site already
  passes real arrays (confirmed above), so this is pure defense in depth
  — it fires only if a future edit reintroduces the "wrong shape"/
  "dropped await" class of bug the owner named.
  **TESTS** (`src/stats/__tests__/kpi.test.ts`, all 5 explicitly requested
  guards plus the missing-source guard): a realistic 6-settlement, mostly-
  null-truck-id fixture (matching the real-world single-truck-account
  shape that triggered this) proves (1) the fleet view's miles equal the
  sum of every settlement's miles; (1b) a SCOPED truck also sees every
  null-truck settlement, never a fraction of the real total; (2) null-
  truck deduction/fuel/maintenance/toll rows are included in BOTH the
  fleet view and a specific truck's own scoped view; (3) `matchesTruckScope()`
  lists all 6 settlement weeks, none missing, for the same row shape the
  Weekly Net Trend list reads; (4) expenses are non-zero for a scoped
  truck whose expenses are ENTIRELY null-truck fuel rows — the literal
  "fuel specifically reads $0" case; (5) the engine's own miles/gross
  totals match `calcMiles()`/a raw sum for the identical rows. Plus the
  missing-source guard: real fuel/maintenance/toll/deduction rows sum
  exactly (not silently zeroed); `computeKpis()` throws for each of the 7
  array params passed as `undefined`; and throws for a query-result-
  object-shaped value passed where a plain array was expected. Full
  suite: 118 suites / 3,014 tests pass (+13 new); `tsc --noEmit` clean.
  Ships via a normal `eas update`.
