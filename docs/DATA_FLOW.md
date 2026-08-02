# DATA_FLOW.md — mutation → screen/stat consistency map

Owner directive, mega-pass part A (2026-07-30): every mutation in this app
must be reflected everywhere it's supposed to show up, immediately. This
doc maps every mutation to every screen/stat that reads the tables it
touches, so a future change can be checked against it instead of
discovered as a device bug report. See `app/src/data/queryInvalidation.ts`
(`invalidateFinancialData()`) for the mechanism: a bare table-name query
key prefix-matches every filtered variant an entity hook builds
(`[table, 'list', userId, filters]`), and `refetchType: 'all'` forces an
eager refetch even for screens that aren't currently mounted.

## How to read this doc

- **Mutation** — a user action that writes to the database.
- **Tables touched** — what it writes to (informs which query keys must
  invalidate).
- **Must reflect it** — every screen/stat whose number changes as a
  result. If a screen is missing from a row where it should read that
  table, that's a bug.
- **Invalidation path** — `entityHooks.ts` (self-invalidates its own
  table on insert/update/delete, automatic, per-table), `invalidateFinancialData()`
  (the shared cross-cutting sweep called after import save / delete /
  reset / budget save), or a bespoke `onSuccess` (a custom hook with its
  own invalidation, e.g. `dashboardLayout.ts`).

## Mutation → screen matrix

| Mutation | Tables touched | Must reflect it | Invalidation path |
|---|---|---|---|
| **Import new settlement** | `documents`, `settlements`, `loads`, `fuel_purchases`, `deductions` (withheld), `reimbursements`, `maintenance_records`, `tolls`, `loans`, `driver_payments`, `profiles.business_balance` | Dashboard (hero, revenue/deduction trio, per-diem cards, tax cards, Fleet Health, AI Insights), Cash Flow (weekly trend, forecast trailing-avg), Transactions, P&L, Profit Analysis, Scorecard, Tax Estimator, AI Coach, Accountant Package, Documents Archive, Settlements screen, Truck Health (if maintenance rows included) | `saveExtraction()` → `invalidateFinancialData()` (import screen's `handleSave()`) |
| **Re-import same week (replace)** | Same as above, scoped to the one settlement's rows (CLAUDE.md invariant #10) | Same as above — every stat must recompute from the REPLACED figures, not double-count | Same — the replace path deletes+reinserts before the same `invalidateFinancialData()` call |
| **Import fuel/maintenance/purchase/toll/loan/driver_payment/financial-doc/compliance/w2/other** | `documents` + the one docType-specific table (see `aiImportSave.ts`'s per-docType branch) | Whichever list screen owns that table, plus Dashboard/P&L/Profit Analysis/Scorecard/Accountant Package for any table that feeds the tax/cost engines (deductions, fuel, maintenance) | Same `invalidateFinancialData()` call |
| **Manual add/edit/delete — settlements, deductions, fuel, maintenance, loads, reimbursements, tolls, loans, credit cards, bank statements, misc income, user categories, drivers, driver payments, household income/members, compliance items, trucks** | The one entity table | Every screen listed above that reads that table; Dashboard/P&L/Tax Estimator/Accountant Package for anything feeding gross/net/deductions/miles/tax | `entityHooks.ts` self-invalidation (every `useInsert*`/`useUpdate*`/`useDelete*` hook invalidates `[table]` in its own `onSuccess`) — no manual wiring needed per screen |
| **Mark Maintenance as Done** (truck-health.tsx) | `maintenance_records` (new record) + `trucks.current_odometer`/`apu_hours` (bumped) | Truck Health (interval countdowns), Dashboard's Fleet Health Score, Scorecard, truck detail screens | `useInsertMaintenanceRecord`/`useUpdateTruck` self-invalidate `maintenance_records`/`trucks` |
| **Capital transaction (contribution/draw)** | `capital_transactions`, sometimes a linked `deductions` row (`linked_deduction_id`) | Capital Account screen, Dashboard's Capital Account strip, Accountant Package | `useInsertCapitalTransaction` self-invalidates; `capital-account-summary` aggregate has its own `onSuccess` in `capitalAccount.ts` |
| **Cash Flow budget save** | `profiles.cf_*` | Cash Flow forecast, CEO Mode (reads `profiles.weekly_goal`/balance-adjacent fields) | `useUpdateProfile` → explicit `invalidateQueries(['profile', userId])`/`['dashboard-layout', userId]` in `profile.ts` |
| **Dashboard layout save/reset** | `profiles.dashboard_layout`, `dashboard_sections_collapsed` | Dashboard itself, Customize Dashboard | `useUpdateDashboardLayout`'s own `onSuccess` → `['dashboard-layout', userId]` |
| **Delete (any entity, incl. settlement cascade)** | The one entity table, plus every cascaded child (settlement delete cascades loads/fuel/reimbursements/withheld deductions server-side, CLAUDE.md invariant #5) | Every screen that read the deleted rows — same list as manual add/edit | `useDelete*` self-invalidates its own table; settlement/deduction/maintenance detail screens additionally call `invalidateFinancialData()` after delete so cascaded CHILD tables (not the entity hook's own table) also refresh |
| **Reset All Data** | Every table in `supabase/functions/reset-data/index.ts`'s `TABLES_IN_DELETION_ORDER` (23 tables) + `profiles.*` DATA fields (business_balance, initial_capital, weekly_goal, cf_*, dashboard_layout, dashboard_sections_collapsed) reset to empty/0/null | EVERY screen in the app — this is the "prove nothing survives" case | `settings.tsx`'s reset handler → `refreshProfile()` + `invalidateFinancialData(queryClient)` — **audit fix (2026-07-30): 8 of the 23 wiped tables (`trucks`, `drivers`, `driver_payments`, `household_income`, `household_members`, `compliance_items`, `maintenance_intervals`, `truck_health_config`) were silently missing from `AFFECTED_TABLES`, so Truck Health/Drivers/Compliance Tracker/household-income-fed Tax Estimator kept showing pre-reset data until something else forced a refetch. Fixed — see `queryInvalidation.ts` and its regression test mirroring `TABLES_IN_DELETION_ORDER`.** |
| **Delete Account** | Same table list as Reset, plus the `profiles` row and the `auth.users` row itself | N/A — user is signed out, no screen to reflect it | Not applicable (session ends) |

## Navigation intent — how routes must be opened from now on

BETA FEEDBACK ROUND 2 (owner decision 2026-07-31, device tester report:
"pressing back lands on the SETTLEMENTS screen instead of Home"). Root
cause (confirmed by reading the installed expo-router/react-navigation
source, not guessed): every screen under `app/(tabs)/more/` shares ONE
nested Stack navigator (`more/_layout.tsx`). Cross-tab navigation into it
— from Home cards, the Reports hub, CEO Mode recommendations, Scorecard,
anywhere OUTSIDE the "more" tab — always uses plain `router.push(href)`,
which is correct and does not need to change, but a plain `push` onto an
already-mounted nested Stack appends to whatever is CURRENTLY on top of
it rather than resetting it. Across a session, visiting different
Home cards (cash-flow, then later settlements, then later
tax-estimator, ...) without returning all the way to Home in between
silently left the "more" stack several screens deep, so back popped
through THAT accumulated history — landing on an unrelated screen,
never Home. `backBehavior="initialRoute"`
(`app/(tabs)/_layout.tsx`) only governs what happens once a tab's OWN
stack is already empty; it does nothing to stop that stack from
accumulating in the first place, which is why it didn't fix the reported
bug.

**The fix — and the rule going forward:** `app/(tabs)/more/index.tsx`
(the shared stack's always-mounted root screen) calls
`useResetStackOnTabBlur()` (`app/src/navigation/useResetStackOnTabBlur.ts`),
which resets that stack to just its root every time the "more" tab loses
focus. This means:

- **Every existing `router.push('/(tabs)/more/X')` call site keeps working
  unchanged** — the fix lives in exactly one place (the shared stack's
  root screen), not at each of the 20+ call sites across Home, Reports,
  CEO Mode, etc. Nobody needs to remember a special navigation pattern
  when linking to a `more/X` screen.
- **Do not remove or bypass `useResetStackOnTabBlur()`** from
  `more/index.tsx` — every screen nested under `more/` depends on it for
  predictable back behavior. If `more/index.tsx` is ever restructured,
  this hook call must move with it.
- **A new top-level tab** (sibling to `index`/`transactions`/`reports`,
  not nested under `more/`) needs no special handling — back already
  reaches Home directly via `backBehavior="initialRoute"`.
- **A new screen nested under `more/`** automatically inherits the reset-
  on-blur guarantee — no per-screen wiring needed, same as the existing
  ones.

`app/src/navigation/backIntent.ts`'s `backTargetFor(href)` is the
resulting intent table — every route classifies to `'home'` (top-level
tabs and `more/index` itself: back reaches Home in one press) or
`'moreIndex'` (any screen nested under `more/`: back reaches `more/index`
first, then Home on a second press — bounded and deterministic now,
never unbounded). `src/navigation/__tests__/backIntent.test.ts`
regression-guards this against every route in the shared nav registry
(`navRegistry.ts`'s `RAW_NAV_GROUPS`), so a new route that's classified
inconsistently with where it actually lives in the navigator tree fails
a test instead of shipping as a fresh version of this exact bug.

## The known symptom this audit fixed

**Cash Flow revenue stayed $0 after a settlement import.** Root cause:
the Cash Flow 30-day forecast's "Weekly Revenue" figure was ENTIRELY a
manually-typed budget number (`profiles.cf_weekly_revenue`) with zero
connection to the `settlements` table — importing a settlement changed
`settlements`, which the Cash Flow screen doesn't read for its budget
inputs at all, so of course nothing there ever moved. Fixed
(`app/src/stats/cashFlowForecast.ts` `trailingWeeklyRevenueAverage()`):
when the user hasn't entered their own Weekly Revenue, the forecast now
uses the trailing 4-week average of their ACTUAL settlement gross
revenue, labeled "from your settlements" in the UI so it's never
mistaken for a manually-entered number. This is display-only — the field
still SAVES `null` when left empty, so the average keeps recomputing
live from the latest imports every time rather than freezing the number
the first time it's shown. A manually-entered value always overrides it.

## Integration test coverage (fake-supabase)

- `app/src/data/__tests__/aiImportSave.settlement.test.ts` — import
  creates a settlement + all child rows; re-import (same week) replaces
  in place without duplicating or double-crediting `business_balance`;
  re-import never touches a different week's children; a settlement with
  no resolvable week_ending throws instead of silently colliding.
- `app/src/data/__tests__/aiImportSave.documentsCoverage.test.ts` —
  every docType creates exactly one `documents` row (Documents Archive
  audit, part E).
- `app/src/data/__tests__/queryInvalidation.test.ts` — every table Reset
  All Data wipes is present in the invalidation sweep (regression guard
  for the 8-table gap this audit found and fixed).
- `app/src/stats/__tests__/cashFlowForecast.test.ts` — the trailing
  4-week revenue average, including the multi-truck same-week-sums-first
  case and the "ignores older weeks" case.
- `app/src/tax/__tests__/perDiem.test.ts` — per-settlement per diem days
  sum correctly (dedup-by-week min-wins), including the exact reported
  0-mile "home week" bug (mega-pass part B).

A full end-to-end "open every screen and check the number" pass isn't
automatable here — this repo has no component/screen test harness (only
pure `src/<domain>` logic is unit-tested; screens themselves are manually
verified on-device per session, see PROMPTS.md's verification checklist
convention). The matrix above is the audit's actual deliverable: an
explicit, checkable map future changes can be diffed against, plus
regression tests for every gap this pass actually found and fixed.
