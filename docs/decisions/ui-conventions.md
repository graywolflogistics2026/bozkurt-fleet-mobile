# Ui Conventions

> UI conventions that used to sit in CLAUDE.md: one chart primitive, one nav registry, feature flags, build-info visibility.
> Charts: `app/src/stats/chartHelpers.ts` thin polyline (+ optional fill) only. Nav: `app/src/navigation/navRegistry.ts` is the ONLY route list.
> Build info: `app/src/lib/buildInfo.ts` / `buildInfoFormat.ts` feed Settings footer and the error screen.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- CHART LANGUAGE CONSISTENCY (owner decision 2026-07-30): every trend
  chart app-wide draws from one shared, tested primitive —
  `app/src/stats/chartHelpers.ts`'s `buildPolylinePoints()`/
  `buildAreaPoints()` (extracted from the Dashboard hero card's own
  hand-rolled SVG math) — a thin 1-2px `react-native-svg` `Polyline`,
  optionally with a subtle translucent `Polygon` fill underneath
  ("Apple Stocks style"). Cash Flow's Weekly Trend chart was the one
  holdout still using thick opaque bars; restyled to match (gross = thin
  accent-blue line, no fill; net = thin green/red line with a subtle
  fill, colored by its most recent value's sign). Any NEW trend chart
  must use these shared helpers rather than hand-rolling bars again.

- NAV PARITY (owner decision 2026-07-30, device evidence: "Documents"
  missing from the wide-screen sidebar's TOOLS group despite being
  reachable from the More tab): `app/(tabs)/more/index.tsx` used to
  maintain its OWN separately hand-written item list — Equipment and then
  Documents were each added there but never to `WideSidebar.tsx`'s
  `GROUPS` (which WideSidebar AND `MenuSheet.tsx` both already rendered
  directly, so they were ALREADY guaranteed identical to each other — the
  actual divergence was between those two and the More tab's flat list).
  `app/src/navigation/navRegistry.ts` is now the ONE shared registry
  every nav surface derives from — `WideSidebar.tsx` re-exports
  `GROUPS`/`isActiveRoute` from it (so `MenuSheet.tsx` and
  `app/(tabs)/reports.tsx`'s existing imports don't need to change), and
  `more/index.tsx` calls its `moreTabItems()` (the full registry minus
  the 5 routes that already have their own bottom-tab icon — Home,
  Transactions, Import, Deductions, Truck Health — named explicitly via
  `TAB_BAR_HREFS`, not inferred). A route added to ONE nav surface but not
  another is now structurally impossible — there is only one list left to
  add it to. `src/navigation/__tests__/navRegistry.test.ts` regression-
  guards the exact reported bug (Documents under tools, Equipment under
  business) plus the general "every non-tab-bar route appears in
  moreTabItems" invariant. The orphaned `more.*` i18n block (labelKeys the
  old separate list used, since replaced by the registry's `nav.*` keys)
  was deleted from all 7 locales — confirmed unused everywhere first.

- NAV SIMPLIFICATION / FEATURE FLAGS (owner decision 2026-07-30): Bank
  Statement and Credit Cards are hidden from every nav surface (phone
  Menu, wide sidebar, Reports hub — all of which render through
  `navRegistry.ts`, so this is one change, not three) behind
  `app/src/config/featureFlags.ts`'s `FEATURE_FLAGS.bankCreditCards`
  (default `false`). This is the established pattern for "turn a feature
  off without deleting it": `navRegistry.ts` keeps the full, unfiltered
  route list as `RAW_NAV_GROUPS` and exports a flag-filtered `NAV_GROUPS`
  (`filterNavGroupsByFlags()`, pure and directly testable) as the one
  thing every surface actually renders from — flipping the flag back to
  `true` restores both routes everywhere instantly, no code/table/test
  changes needed. Capital Account is explicitly NOT gated by this flag
  (owner-contribution flow, draw tracking, and tax basis depend on it —
  confirmed decision). Existing `bank_statements`/`bank_transactions`/
  `credit_cards` rows are untouched and still readable by anything that
  queries them directly (e.g. Accountant Package's own aggregate) — the
  flag only gates NAVIGATION and NEW rows. The legacy-backup importer
  (`app/src/data/legacyImport/importLegacyBackup.ts`, the only actual
  "import" pathway for these two entities — ai-import's docType schema
  has never covered bank/card statements) checks the same flag for its
  3 relevant entities (Credit Cards; Bank statements' card-type AND
  checking-type rows, both landing in `bank_statements`) and, when off,
  skips writing new rows and pushes a plain informational line to the
  import result's existing `warnings` array (never styled as a failure)
  when the backup payload actually contained rows of that type — "politely
  say the feature is currently disabled," never a silent skip and never
  an error. Any FUTURE feature that needs this same "hide without delete"
  treatment should follow the identical pattern: a new `FEATURE_FLAGS` key
  + gating at the single registry/import choke point, never scattered
  per-screen conditionals.

- RUNTIME VISIBILITY (owner decision 2026-07-30 — "which JS is on this
  device should never be a guess again"): `app/src/lib/buildInfo.ts`'s
  `getBuildInfo()`/`formatBuildInfoLine()` — app version
  (`Constants.expoConfig?.version`), the EAS Update id (`Updates.updateId`,
  the single most reliable "which bundle actually loaded" signal, shown
  short-form), and a git commit hash (`app.config.js`'s build-time
  injection of `EAS_BUILD_GIT_COMMIT_HASH`, an env var EAS Build sets
  automatically on every cloud build — null for a local dev-client run).
  `app.json` was converted to `app.config.js` (dynamic config) SOLELY to
  read that env var at build time; every other field is unchanged. Shown
  in Settings' footer AND on `ScreenErrorBoundary`'s crash screen (with a
  "Copy Details" button bundling build info + error + both stacks via
  `expo-clipboard`) — both read from this one module so they can never
  disagree about the format. The pure formatting half
  (`app/src/lib/buildInfoFormat.ts`) has zero expo-constants/expo-updates
  imports so it stays unit-testable and safely importable from
  `ScreenErrorBoundary` (the last line of defense) without adding a new
  native-module dependency to worry about there.
