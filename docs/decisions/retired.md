# Retired

> Retired features and screens (kept for history; do not re-implement without a fresh owner decision).
> Customize Dashboard (invariant #17, retired 2026-08-02) incl. its crash-on-mount fix; Share Weekly Profit, Fix Truck Assignments and the separate AI Advisor screen (removed 2026-08-27).
> Reusable leftover: `app/src/components/ScreenErrorBoundary.tsx` (on-screen error + stack) for screens with risky native deps.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- CUSTOMIZE DASHBOARD DIAGNOSTICS (owner decision 2026-07-30, device
  feedback round 4): a triple-tap on the screen title reveals a small,
  deliberately plain diagnostics panel (rendering mode, card count,
  layout JSON length, query status, last caught error) — temporary
  instrumentation for device bug reports, not a permanent UI feature.
  Two real silent-failure bugs found by this pass's review and fixed
  alongside it: the loading card's `!draft` condition could stay true
  forever if the `profiles` fetch itself errored (now falls back to
  `mergeDashboardLayout(null)` so the screen is always usable even when
  the fetch failed); `DraggableFlatList`'s error boundary
  (`DragListErrorBoundary`) only catches RENDER-path errors, never one
  thrown inside `onDragEnd`'s event-handler callback — that callback now
  has its own try/catch as a second safety net, both permanently
  downgrading to the guaranteed-safe arrows-only `FlatList`.

- CUSTOMIZE DASHBOARD — CRASH-ON-MOUNT, the actual root cause (owner
  decision 2026-07-30, decisive device evidence: a white flash then the
  screen closes, before first paint, so the diagnostics panel above never
  even got a chance to render): every fix up to this point was downstream
  of the real bug — `dashboard-customize.tsx` imported
  `react-native-draggable-flatlist` (built on reanimated + gesture-
  handler) STATICALLY at module scope. If that native module fails to
  link/initialize in a release build, evaluating the screen's own module
  throws before React renders anything at all — no error boundary,
  wherever placed, can catch a throw during `require()`/module
  evaluation, because the component tree that would contain the boundary
  never gets built. Fixed two ways, together: (1)
  `app/src/dashboard/dragModuleLoader.ts`'s `loadDragModule()` — the ONLY
  reference to the drag module anywhere in the file is now a type-only
  `import type` (erased entirely at compile time, zero runtime
  reference); the real module is loaded lazily, inside a `useEffect`
  (never during the synchronous render), wrapped so ANY failure resolves
  to `null` instead of propagating — the arrows-only baseline is
  therefore always what's rendered on first paint (dragModule starts
  `null`), upgrading to drag-plus-arrows only after a load that has
  already proven it won't crash; (2) `app/src/components/
  ScreenErrorBoundary.tsx` — a reusable, generic screen-level error
  boundary that renders the error message + component stack ON SCREEN
  (not just console), now wrapping the whole Customize Dashboard screen.
  The two are complementary, not redundant: the boundary is the safety
  net for anything that could still go wrong AFTER the module
  successfully loads; the lazy loader is what prevents the crash from
  ever reaching a boundary in the first place. Available for reuse on any
  other screen with a similarly risky native-module dependency. Follow-up
  (device evidence: a PERSISTENT white screen after that fix landed —
  changed behavior from the earlier white-flash-then-close, meaning an
  update DID reach the device): audited `ScreenErrorBoundary` end to end
  (already 100% dark-themed colors, reinforced with an explicit
  `flex:1`/`colors.bg` outer wrapper so the dark background is guaranteed
  to paint full-screen regardless of the navigator's own flex chain) and
  the arrows-only baseline (found and fixed a real gap: `draft` used to
  start `null` and only populate once `layoutQuery` resolved, so first
  paint showed an EMPTY card list — not literally white given `Screen`'s
  own dark background, but a real violation of "must render synchronously
  with a hard default layout, no query-await before first paint"). `draft`
  now initializes via `useState(() => mergeDashboardLayout(null))` — a
  pure, synchronous call, so the full default card list is what's on
  screen before the network round-trip even starts; a `hydrated` flag
  (not `draft` itself) tracks whether the user's real saved layout has
  arrived, gating Save (never silently overwrite an unseen real layout
  with the placeholder default) without ever gating the cards themselves.

- UX MEGA-PASS item C — CUSTOMIZE DASHBOARD PLAIN FALLBACK (owner decision
  2026-07-31, device evidence: "still broken; also unreachable from the
  'Good morning' header link" — the 4th device report on this screen
  despite three prior rounds of hardening `app/(tabs)/more/
  dashboard-customize.tsx` itself: crash-on-mount fix, synchronous-first-
  paint fix, error boundary, on-screen diagnostics). Rather than a 5th
  attempt at hardening a screen that depends on a native drag module and
  lives behind its own route — either one a fresh place for a device-
  specific failure to hide — the Dashboard's "Customize" header link no
  longer navigates to that route at all. It now opens
  `app/src/components/SimpleCustomizeDashboardModal.tsx` directly, in
  place, via `ModalSheet` (so it gets item B's close X/scroll/keyboard-
  avoidance for free): pure local component state, zero external
  libraries (no `react-native-draggable-flatlist`, no reanimated/gesture-
  handler dependency at all), show/hide toggles + ▲▼ reorder only — the
  same `useDashboardLayout`/`useUpdateDashboardLayout` hooks and
  `DashboardCardConfig`/`mergeDashboardLayout` types as the fancy screen,
  just a dumber, bulletproof renderer on top. This is now the PRIMARY
  path. The fancy screen (drag, per-card labels, section assignment) is
  demoted to a secondary, opt-in "Advanced editor" button inside this
  modal — still fully intact, still reachable, just no longer the only
  door in. `dashboardCustomize.simpleSubtitle`/`advancedEditor` are the
  two new i18n keys this required (all 7 locales, hi/uk as untranslated
  English copies per invariant #11). Any future "this screen might not
  mount" risk elsewhere in the app should default to this same pattern —
  a plain, dependency-free primary path with the risky/fancy version kept
  as an opt-in upgrade, not the reverse.

- UX MEGA-PASS item F — SHARE WEEKLY PROFIT (owner decision 2026-07-31):
  the entire capture/destinations/clipboard pipeline was extracted out of
  `app/(tabs)/more/share-profit.tsx` into `app/src/components/shareCard/`
  — `shareDestinations.ts` (the destination list), `useShareCapture.ts`
  (the ViewShot-capture + clipboard/Linking/system-share-sheet logic,
  content-agnostic — caption and pre-translated alert strings are passed
  in per call, not closed over), `useShareMessages.ts` (builds those
  strings once via `t()`), `ShareDestinationsRow.tsx` (the button row),
  and `ShareCardModal.tsx` (a `ModalSheet`-based wrapper bundling all of
  the above for a screen that just wants a share button, not a whole
  screen). This is what "same share-card pipeline" means below. (1)
  WhatsApp, SMS/Messages, and Copy Image added to
  `shareDestinations.ts`'s `SHARE_DESTINATIONS` — Copy Image is a pure
  clipboard action (`dest.key === 'copy'`, no `scheme`, never calls
  `Linking.openURL`) rather than a literal "Copy Link," since this app
  has no hosted image/link URL to copy (CLAUDE.md invariant #22, no
  external-data features/backend) — copying the branded image + caption
  straight to the clipboard is the one coherent thing "copy" can mean
  here. (2) The metric-toggle row's on-screen card is now keyed
  (`key={cardKey}`, derived from the exact inputs that determine its
  content: included metrics + selected week) so the ViewShot child View
  fully re-mounts on every toggle/week change, rather than relying on a
  third-party native view wrapper's own diffing to catch a state update —
  a defensive fix for the reported "toggling MPG doesn't change the
  rendered card" symptom. (3) A week picker (horizontal pill row, only
  shown when 2+ settlements exist) lets any past week be shared, not just
  the latest — `selected` (the settlement being shared) replaces the old
  hardcoded `latest` throughout. (4) AI Coach (`ceo-mode.tsx`) and
  Scorecard (`scorecard.tsx`) both gained a "📤 Share" header link that
  opens a `ShareCardModal` with content appropriate to each screen — CEO
  Mode's business score + this week's revenue/profit, Scorecard's score/
  grade + revenue-per-mile/net-per-mile — through the identical
  destinations row and capture pipeline Share Weekly Profit uses, per the
  directive's "same share-card pipeline, appropriate content."

- DASHBOARD SIMPLIFICATION (owner decision 2026-08-02, binding — "remove
  Customize entirely and ship one well-designed fixed layout"): Home
  (`app/(tabs)/index.tsx`) is a FIXED, non-customizable layout now,
  exactly this order, nothing else:
  a) Hero profit card (period tabs + area chart) — unchanged.
  b) Revenue / Expenses / Net Profit trio with % deltas — unchanged.
  c) Business Balance slim card — unchanged, including the negative-
     balance "you owe the carrier" red treatment.
  d) AI Coach card (`AiCoachCard`, new) — a FIXED entry point into the
     `ceo-mode` briefing screen, replacing the old rotating AI Insight
     card. Same visual container/treatment as the retired card (icon +
     bold title + one sentence, tappable) but the content no longer
     rotates through candidate insight types — it's a static invitation
     into AI Coach. Deliberately reuses the EXISTING `ceoMode.title`/
     `ceoMode.subtitle` i18n strings ("AI Coach" / "Your weekly business
     briefing, composed from your own data.") instead of adding new
     keys — no 7-locale translation pass needed for this card.
  e) Recent Loads, then Best/Worst Lanes (`BestWorstLanesCard`, new) —
     reuses `src/stats/cashFlowTrend.ts`'s existing `rankLoadsByRpm()`
     (already powering Cash Flow's own "Best & Worst Lanes" section)
     capped at 3 each (a Home teaser, not a duplicate of the full
     screen — tapping through goes to Cash Flow for the complete
     5-and-5 ranked list). Also reuses existing i18n
     (`cashFlowScreen.lanesTitle`/`bestLanes`/`worstLanes`) rather than
     adding dashboard-scoped duplicates of the same text.
  REMOVED from Home entirely (invariant #17 above is retired, struck
  through, kept for history): the Fleet Health Score gauge, the rotating
  AI Insight card, the Capital Account strip, the needs-review counter
  chip, and every card that lived inside the 4 collapsible Overview/
  Money/On-the-Road/Taxes sections (the tax row, per-diem summary, the
  Revenue-vs-Expenses trend + monthly overlay chart, the Expenses
  Breakdown donut, Goal Progress, the Road Days heat map, the truck
  mini-card, the S-corp preview, 1099-NEC reminders, and fleet/driver
  overview) — none of that underlying data or functionality was deleted
  from the PRODUCT, only from the Home screen: Capital Account, Tax
  Estimator, Truck Health, Profit Analysis, Scorecard, and Cash Flow all
  remain full screens reachable from the Menu exactly as before.
  **Deleted outright** (fully dead once Home no longer references them,
  confirmed by grep before removal — nothing else in the app imported
  them): `app/(tabs)/more/dashboard-customize.tsx` (the fancy drag-editor
  screen), `src/components/SimpleCustomizeDashboardModal.tsx` (the plain-
  fallback editor UX MEGA-PASS item C introduced), `src/dashboard/
  dragModuleLoader.ts` + its test (the lazy drag-module loader that
  screen depended on), `src/data/dashboardLayout.ts` (the
  `useDashboardLayout`/`useUpdateDashboardLayout`/
  `useUpdateSectionsCollapsed` hooks — nothing reads/writes
  `profiles.dashboard_layout`/`dashboard_sections_collapsed` anymore),
  `src/stats/dashboardLayout.ts` + its test (the card-id/route/label/
  section registry + `buildCustomizedDashboardBlocks()` the whole feature
  was built on), and — because they lost their only caller once the Fleet
  Health gauge and Expenses Breakdown donut left Home —
  `src/components/CircularGauge.tsx` and `src/components/DonutChart.tsx`.
  Six Home-only pure stats modules also lost their only caller and were
  deleted with their tests: `aiInsights.ts`, `roadDaysHeatmap.ts`,
  `fleetHealthScore.ts`, `taxProgress.ts`, `goalProgress.ts`,
  `cpmTrend.ts`, `trendRange.ts` (all confirmed via grep to have zero
  importers outside Home and their own test files before deletion).
  `'dashboard-layout'` was removed from `queryInvalidation.ts`'s
  `AFFECTED_AGGREGATES` (and its regression test) since nothing queries
  that key anymore. Nav: the `/(tabs)/more/dashboard-customize` entry was
  removed from `navRegistry.ts`'s `GROUPS` (which every nav surface —
  phone Menu, wide sidebar, Reports hub — derives from, so this is one
  edit, not three, per the NAV PARITY invariant above) and its
  `Stack.Screen` from `more/_layout.tsx`; the orphaned `nav.
  dashboardCustomize`/`dashboard.customize`/the entire `dashboardCustomize.*`
  i18n block were deleted from all 7 locale files (same "confirmed unused
  everywhere first, then delete" convention as the NAV PARITY invariant's
  orphaned `more.*` block cleanup). `ScreenErrorBoundary.tsx` (a reusable,
  generic component still used by `settings.tsx` and others) had its
  design-history comments referencing the deleted `dashboard-customize.tsx`/
  `dragModuleLoader.ts` lightly trimmed rather than left dangling, but the
  component itself is untouched — it remains available for reuse on any
  future screen with a risky native-module dependency.
  **Deliberately NOT deleted**: `profiles.dashboard_layout`/
  `dashboard_sections_collapsed` DB columns (harmless, no migration —
  Reset All Data still clears them as a no-op) and the many Home-specific
  i18n strings for the removed cards (`dashboard.aiInsights.*`,
  `dashboard.fleetHealth.*`, `dashboard.moneyBreakdown.*`,
  `dashboard.taxProgress.*`, `dashboard.goalProgress.*`,
  `dashboard.roadDaysHeatmap.*`, `dashboard.capitalAccountTitle`,
  `dashboard.truckCardLabel`, `dashboard.fleetOverviewTitle`,
  `dashboard.driverOverviewTitle`, `dashboard.necReminder*`,
  `dashboard.scorpPayroll*`, `dashboard.yearFallbackBanner`,
  `needsReview.homeCounter`) — a deliberate scope decision, not an
  oversight: no test in this repo enforces "every i18n key must be
  used," deleting ~50 keys across 7 locale files precisely and safely is
  a large, error-prone undertaking for zero functional benefit, and
  leaving them costs nothing (unused JSON entries, never rendered). If a
  future pass wants that cleanup, do it as its own explicit task.
  PARITY.md's Dashboard section and PROMPTS.md (both the original
  Session 9a item 8 / Personalization-package item 1 specs, marked
  RETIRED in place for history, and a new Backlog entry) were updated to
  match — per-card customization may return in a v2 pass, but only on a
  fresh, explicit owner decision, not as a standing roadmap item.
  Tests: `tsc --noEmit` clean; the full `jest` suite (64 suites — down
  from 73, matching the 9 deleted test files) passes; all 7 locale files
  confirmed to still have identical key sets after the i18n cleanup
  (`glossary.test.ts` re-passed as the existing parity guard).

  3. **REMOVED: Fix Truck Assignments screen**, entirely — deleted
     `app/(tabs)/more/truck-assignments.tsx`, its `navRegistry.ts`/
     `more/_layout.tsx` wiring, and — confirmed via grep to have no OTHER
     caller — `app/src/data/truckAssignments.ts` (`assignRowsToTruck()`,
     the P0-audit-verified bulk-update-not-delete logic from the prior
     FINAL PASS entry) and `app/src/import/truckAssignmentRepair.ts`
     (`findUnassignedRows()`/`UnassignedRow`), plus both files' own test
     suites. **KEPT**: `buildTruckComparison()`'s own, entirely separate
     `unassignedRow` aggregate (`src/stats/truckComparison.ts` — a
     different mechanism, never called `findUnassignedRows()`) still
     surfaces revenue with no truck attribution on the Per-Truck
     Profitability screen; its own "fix" card
     (`app/(tabs)/more/truck-comparison.tsx`) is repointed from the now-
     deleted screen to `/(tabs)/more/settlements`, where ordinary per-row
     truck reassignment already exists on each settlement's own edit
     sheet (MULTI-TRUCK MODEL, above) — the i18n string itself
     (`truckComparison.unassignedFixLink`) was reworded from "Fix truck
     assignments →" to "Assign trucks in Settlements →" so it no longer
     promises a screen that's gone.
  4. **REMOVED: AI Advisor as a separate screen** — deleted
     `app/(tabs)/more/ai-advisor.tsx` and its `navRegistry.ts`/
     `more/_layout.tsx` entries. Audited what it offered beyond AI Coach
     BEFORE deleting, per the user's own explicit instruction: it had ONE
     real capability AI Coach's own `handleGetBriefing()` didn't — a
     genuine multi-turn, free-form Q&A chat (running message history
     forwarded on every send), vs. AI Coach's own one-shot "compose one
     prompt, send it once" briefing. Folded in FIRST, before deletion: a
     new "Ask a Question" section in `app/(tabs)/more/ceo-mode.tsx`
     (`chatMessages`/`chatInput`/`chatSend`/`handleSendChat()`) reusing
     the exact same `callAiAdvisor()` call and running-history convention
     the deleted screen used, verbatim in spirit. The tab bar's own raised
     [+] action sheet had a real, now-fixed dead-end reachability bug
     found during this pass: `app/(tabs)/_layout.tsx`'s `onAskAi` handler
     pushed straight to the now-deleted `/(tabs)/more/ai-advisor` route —
     repointed to `/(tabs)/more/ceo-mode`, where the folded-in chat now
     lives. `callAiAdvisor()`/`aiAdvisorCall.ts` itself is UNTOUCHED and
     still called by CEO Mode's own briefing, Maintenance, Profit
     Analysis, `proactiveCoach.ts`, and `weeklyReview.ts` — none of those
     go through the deleted screen, confirmed by grep before removing it.

  6. **REMOVED: Share Weekly Profit screen** — deleted
     `app/(tabs)/more/share-profit.tsx` and its nav wiring. Confirmed
     (not assumed) the shared share-card pipeline
     (`src/components/shareCard/ShareCardModal.tsx`/`useShareCapture.ts`/
     `useShareMessages.ts`/`shareDestinations.ts`/
     `ShareDestinationsRow.tsx`) is genuinely, independently reused by
     BOTH CEO Mode's own "📤 Share" button (`ceo-mode.tsx:272`) and
     Scorecard's own (`scorecard.tsx:502`) — KEPT entirely, untouched.
     Confirmed the referral flow's own share mechanism
     (`src/referral/referralShare.ts`) is a genuinely SEPARATE, plain
     `Linking`/`Share`/clipboard implementation with no dependency on the
     deleted screen (its own header comment already documented this).
     i18n: the `shareProfit.*` block was NOT deleted wholesale — only its
     screen-specific sub-keys (`title`/`subtitle`/`noSettlements`/
     `metrics.*`/`weekOf`/`weekPickerLabel`), confirmed orphaned by grep
     first; `shareProfit.share`/`.captionTemplate`/`.shareTo`/
     `.destinations.*`/`.notAvailableTitle`/`.imageCopiedTitle`/
     `.imageCopiedBody`/`.copiedTitle`/`.copiedBody`/`.shareFailedTitle`
     are all still genuinely used by the shared pipeline and were kept.
