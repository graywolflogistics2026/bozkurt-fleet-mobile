# Menu and tab bar simplification — proposal

Status: IMPLEMENTED (2026-11-23), Stage 1, Stage 2 and the follow-up
below. Stage 2's owner decisions (below) REPLACE the Stage 2 plan in §2-§3
of this proposal and Stage 1's "no headings" decision.

Follow-up (owner 2026-11-23, after Stage 2), CURRENT state:
- The compliance screen is a menu row again, in Business right after
  Documents. Renamed 2026-11-24 from "Documents & Renewals" to "Renewals &
  Expiry Dates" (key `nav.compliance`, also the screen title and the
  Documents card title). The card on Documents stays. Final menu: 20 rows;
  Business = Trucks, Drivers, Assets & Equipment, Capital Account,
  Documents, Renewals & Expiry Dates. (Older text below that says
  "Documents & Renewals" means this same screen.)
- Transactions (owner 2026-11-24) is no longer a menu row: it is the fourth
  card on Operating P&L (after Cash Flow, Profit Analysis, Scorecard). Its
  route stays a hidden tab; opened from the card, back returns to
  Operating P&L (`?from=operating-pnl`), otherwise back goes Home as
  before. Final menu: 19 rows; Overview = Operating P&L, Truck Health, AI
  Coach.
- 2026-11-24 (owner, after phone testing): Assets & Equipment (the Asset
  Register screen) is no longer a menu row: a card on Capital Account next
  to Loans, titled `nav.assetsEquipment` (`MENU_LABEL_OVERRIDES`
  removed); its Equipment card stays. The "Renewals & Expiry Dates" card on
  Documents is removed (that screen is only a menu row now). Every parent
  card shares one accent look (`RelatedScreenCard`). CURRENT final menu:
  18 rows; Business = Trucks, Drivers, Capital Account, Documents, Renewals
  & Expiry Dates.
- Scorecard is a third card on Operating P&L (after Cash Flow and Profit
  Analysis). Still hidden from the phone menu, still on the Reports tab,
  still linked from Truck Comparison. The wide-sidebar-only Scorecard row
  and `SIDEBAR_ONLY_AFTER` are removed; the sidebar is Home + the menu
  rows. The two Stage 2 bullets below about the 19-row menu, the
  compliance card as its only way in, and the sidebar Scorecard row are
  superseded by this follow-up.

Stage 2 owner decisions (2026-11-23), as built:
- Section headings back in the phone Menu and the wide sidebar (Home on top
  of the sidebar only). Stage 1's big rows, gear and bottom padding kept.
  Reports unchanged; groups stay internal.
- Final menu, 19 rows: Revenue (Import, Loads, Settlements); Expenses (Fuel,
  Maintenance, Tolls & Fees, Deductions); Overview (Transactions, Operating
  P&L, Truck Health, AI Coach); Business (Trucks, Drivers, Assets &
  Equipment, Capital Account, Documents); Tax & Accounting (Accountant
  Package, Tax Estimator); System (Settings).
- Cards on parent screens (router.push to the child's unchanged route; no
  route moved, no screen merged): Reimbursements -> Other Income; Other
  Income -> Tax Estimator; For Prime Inc Drivers -> Accountant Package;
  Truck Comparison -> Trucks; Equipment -> Asset Register (menu label
  "Assets & Equipment"); Documents & Renewals -> Documents ("Renewals &
  expiry dates"); Loans -> Capital Account; Cash Flow + Profit Analysis ->
  Operating P&L; Data Cleanup -> Category Learning. Category Learning and
  Invite & Earn -> buttons in Settings > Tools.
- Scorecard hidden from the phone menu (on Reports); a wide-sidebar row,
  now after Operating P&L (its earlier anchor, Profit Analysis, became a
  card).
- Code: `navRegistry.ts` (MENU_SECTIONS, MENU_REACHED_FROM,
  MENU_LABEL_OVERRIDES, SIDEBAR_ONLY_AFTER), `RelatedScreenCard.tsx`,
  `menuReachability.test.ts` (every route reachable; each parent file
  links to its child).

Owner answers for stage 1 (2026-11-23): (a) Reports stays exactly as
today; the menu groups stay internal, only the visible list is flat.
(b) "Home" is removed ONLY from the phone menu; the tablet sidebar (768px+)
is also flat, with Home on top. (c) Scorecard row hidden from the menu;
route and screen stay. (d) The proposed order, Settings last, also reached
by the gear.

## Owner decisions (2026-11-23)

- The Menu (phone bottom sheet) becomes ONE flat list. NO section headings
  (Overview / Revenue / Expenses / Tools / Business / Intelligence / System
  removed). Bigger rows (more height, bigger font). Most-used first, in this
  order:
  Import, Loads, Settlements, Other Income (Reimbursements inside), Fuel,
  Maintenance, Tolls & Fees, Deductions, Accountant Package (For Prime Inc
  Drivers inside), Tax Estimator, Trucks (Truck Comparison inside), Drivers,
  Assets & Equipment (Asset Register + Equipment as one), Capital Account,
  Loans, Operating P&L, Cash Flow, Profit Analysis, Truck Health, AI Coach,
  Documents (Documents & Renewals inside), Transactions, Settings.
- The Menu's "Home" row is removed (the Home tab already exists).
- Scorecard is HIDDEN from the menu only. The screen and route stay.
- Category Learning, Invite & Earn and Data Cleanup move inside Settings.
- Settings also gets a gear icon in the Menu header, next to the X.
- The list gets extra bottom padding (safe-area inset + extra), so the last
  row is never near or under the Android back button.
- Bottom tab bar: Home | Import (center) | Reports | Menu. Transactions
  leaves the tab bar and lives in the menu list.
- The daily screens (Loads, Settlements, Fuel, Maintenance, Tolls & Fees,
  Deductions) stay as SEPARATE rows.
- HARD RULES: no number or calculation changes; no screen's data is lost;
  every moved or merged screen stays reachable; all links, deep links,
  alerts and notification routes keep working; i18n keys in all 7 locales.

## 1. Current source

### Menu and tab bar

| What | Where |
|---|---|
| The ONE route registry (groups, labels, emoji) | `app/src/navigation/navRegistry.ts:37-130` `RAW_NAV_GROUPS` |
| Feature-flag filter (Bank Statement, Credit Cards hidden) | `navRegistry.ts:138-163` `FLAG_GATED_HREFS`, `filterNavGroupsByFlags`, `NAV_GROUPS` |
| Tab-bar routes left out of the More list | `navRegistry.ts:171-177` `TAB_BAR_HREFS` (Home, Transactions, Import, Deductions, Truck Health; this list is already stale: Deductions and Truck Health are no longer tabs) |
| `flattenNavItems`, `moreTabItems`, `isActiveRoute` | `navRegistry.ts:179-193` |
| Phone Menu sheet (renders the groups with headings) | `app/src/components/MenuSheet.tsx:15-64` (rows `:41-55`, header with X `:27-32`, `paddingBottom: spacing.xl` only `:34`, row style `:120-141`) |
| Wide-screen sidebar (≥ 768 px, no tab bar there) | `app/src/components/WideSidebar.tsx:39-57` (`GROUPS = NAV_GROUPS`), render `:86-110` |
| More-stack index (flat list; reached when back lands on `more/`) | `app/app/(tabs)/more/index.tsx:18` `moreTabItems()` |
| Reports tab (shows the **Intelligence** and **Tools** groups) | `app/app/(tabs)/reports.tsx:8` `REPORTS_SECTION_KEYS`, `:20` |
| Tab bar | `app/app/(tabs)/_layout.tsx:204-259`: Home `:204`, Transactions `:219`, Import (raised `CenterImportButton`) `:223`, Reports `:234`, Menu (`MenuTabButton` opens `MenuSheet`) `:238`, hidden routes Deductions/Truck Health (`href: null`) `:258-259`; MenuSheet mounted `:266` |
| More stack screen titles | `app/app/(tabs)/more/_layout.tsx:16-49` |
| Back behaviour (`/(tabs)/more/*` → More index, other → Home) | `app/src/navigation/backIntent.ts:19-22` |

### Every route that points to an affected screen

| Screen (route) | Referenced from |
|---|---|
| Scorecard `/(tabs)/more/scorecard` | `navRegistry.ts:118`; `dailyTips.ts:164,168,542` (tips tipScorecard, tipDeadheadBenchmark); `truck-comparison.tsx:264`; Reports (Intelligence group) |
| Equipment `/(tabs)/more/equipment` | `navRegistry.ts:107`; `dailyTips.ts:158,536`; `data-cleanup.tsx:384` |
| Asset Register `/(tabs)/more/asset-register` | `navRegistry.ts:67`; `dailyTips.ts:148,525`; Reports (Tools group) |
| Reimbursements `/(tabs)/more/reimbursements` | `navRegistry.ts:51`; `dailyTips.ts:142,519`; `ProfitExplainer.tsx:49`; `linkedRecordRoute.ts:22` |
| Other Income `/(tabs)/more/other-income` | `navRegistry.ts:52`; `dailyTips.ts:143,520` |
| Truck Comparison `/(tabs)/more/truck-comparison` | `navRegistry.ts:106`; `dailyTips.ts:157,535`; `scorecard.tsx:358` |
| For Prime Inc Drivers `/(tabs)/more/prime-driver-expenses` | `navRegistry.ts:74`; `dailyTips.ts:533` (intentionalNone); Reports (Tools group). Source-check tests read its file: `estimateNotice.test.ts:107,118`, `descriptionText.test.ts:132,141`, `scanCore.test.ts:213` |
| Documents & Renewals `/(tabs)/more/compliance` (label `nav.compliance` = "Documents & Renewals") | `navRegistry.ts:84`; `dailyTips.ts:151,528`; `unlockNudgePresentation.ts:48`; `linkedRecordRoute.ts:18`; `aiRecommendations.ts:128,141`; `alerts.tsx:165` (bell → Alerts → compliance item) |
| Documents `/(tabs)/more/documents` (with `openId` param) | `navRegistry.ts:85`; `dailyTips.ts:152,529`; `deductions.tsx:1108`; `import/index.tsx:1766,1775`; `maintenance.tsx:524`; `settlements.tsx:833` |
| Category Learning `/(tabs)/more/category-learning` | `navRegistry.ts:86`; `dailyTips.ts:153,530`; Reports (Tools group) |
| Invite & Earn `/(tabs)/more/referral` | `navRegistry.ts:87`; `dailyTips.ts:531` (intentionalNone); Reports (Tools group) |
| Data Cleanup `/(tabs)/more/data-cleanup` | `navRegistry.ts:92`; `dailyTips.ts:532` (intentionalNone); Reports (Tools group) |
| Transactions `/(tabs)/transactions` | `navRegistry.ts:42,173`; tab `_layout.tsx:219`; `dailyTips.ts:138,515`; `backIntent.test.ts:7` |

No push-notification handler routes by URL. The only custom-scheme deep link
is auth (`src/auth/deepLink*.ts`), which no change here touches. Every link
above uses a route path, and **no proposal below moves or deletes a
route**, so all of them keep working unchanged.

## 2. The five merges

Three ways to do any merge:

- **(A) Menu-level link.** The child row leaves the menu. The parent
  screen gets one tappable card ("Reimbursements ›") that pushes the
  child's existing route. Cost: small (one card + 1-2 i18n keys). Risk:
  very low; no screen code moves; data, routes, tips and deep links are
  untouched.
- **(B) Tabs in one screen.** The parent screen gets a two-way switch that
  renders the child screen's body. Cost: medium (extract the child into a
  component, move header/params handling). Risk: medium. Route params
  (`openId` on Documents), back behaviour and the source-check tests that
  read the child file can break.
- **(C) Real merge** (one screen, one list). Cost: high. Risk: high. Two
  data sets in one list, and the child route must become a redirect.

**Recommendation: (A) for all five.** It is the cheapest option that meets
the decision ("X inside Y": one menu row, the other reachable from inside
it). It is also the only one that keeps every route, tip, alert and test
exactly as it is.

| Merge | (A) link | Notes and risk |
|---|---|---|
| Reimbursements → Other Income | Card at the top of Other Income: "Reimbursements ›" | ⚠ Accounting: reimbursements OFFSET expenses, never revenue (Golden settlement rule). Putting them "inside Other Income" can read as "this is income". Numbers don't change, but the card should say so: "Reimbursements — offsets expenses, not income ›". (B)/(C) would mix two tables (`misc_income`, `reimbursements`) with opposite meanings; avoid. |
| Truck Comparison → Trucks | Card on Trucks: "Compare trucks ›" | Truck Comparison already works with 1 truck. Optional later: show the card only with 2+ trucks (invariant #7 says fleet-only UI is hidden at n=1). That would be a visibility change, so it needs its own owner decision; default = always shown, as the menu row is today. |
| For Prime Inc Drivers → Accountant Package | Card on Accountant Package: "For Prime Inc Drivers ›" | Today the row is shown to every user. Keep the same visibility (no carrier gating) so nothing changes. Gating it on a Prime settlement would follow carrier isolation, but it is a separate decision. (B)/(C) would break 3 source-check tests and mix a Prime-only tool into the generic accountant export. |
| Asset Register + Equipment → "Assets & Equipment" | One menu row "Assets & Equipment" opens Asset Register; a card there: "Equipment (financed gear) ›" | These are two DIFFERENT data sets: Asset Register = capital purchases recorded as **deductions** (`useDeductions`, warranties, contribution sync); Equipment = the **`equipment` table** (assets with loans). A real merge (C) would put deductions and equipment rows in one list, which is risky for accounting. Needs 1 new label key `nav.assetsEquipment`. |
| Documents & Renewals → Documents | Card at the top of Documents: "Renewals & expiry dates ›" | Name clash: the compliance screen is ALREADY labelled "Documents & Renewals", while the decision calls the parent "Documents". Proposal: the menu row stays "Documents" (the documents screen, `openId` links unchanged); the card uses a NEW key ("Renewals & expiry dates"); the compliance screen title stays as is. Alerts, AI recommendations and unlock nudges keep routing to `/more/compliance` directly. |

## 3. Tests and docs that reference the menu

Tests:

- `app/src/navigation/__tests__/navRegistry.test.ts`: asserts Documents is
  in the `tools` group and Equipment in the `business` group (`:19-27`), no
  duplicate hrefs, `moreTabItems` = flat minus `TAB_BAR_HREFS`, feature-flag
  gating. Stays green if the groups are kept (see §4); new tests are added
  for the flat menu.
- `app/src/alerts/__tests__/dailyTips.test.ts:31,57`: every href in
  `RAW_NAV_GROUPS` must have a tip-coverage entry, and no entry may name a
  href that is gone. If any route were deleted from `RAW_NAV_GROUPS`, this
  test fails. Hence the design below keeps every route in the registry and
  only changes what the Menu shows.
- `app/src/navigation/__tests__/backIntent.test.ts:7`: Transactions → back
  to Home. It stays true after Transactions leaves the tab bar.
- File-path source checks (unaffected by option A): `estimateNotice.test.ts`,
  `descriptionText.test.ts`, `scanCore.test.ts` (prime-driver-expenses.tsx),
  `kpiConsistency.test.ts:15` (comment only).

Docs that describe the menu or tab bar:

- `docs/decisions/ui-conventions.md:4,26-51` (nav registry rule).
- `docs/DATA_FLOW.md:100`, `docs/decisions/multi-truck-model.md:118,209`,
  `docs/decisions/prime-oop-tracker.md:13`,
  `docs/decisions/referral-and-credits.md`, `docs/decisions/retired.md`,
  `docs/ADMIN_RUNBOOK.md`, `PROMPTS.md`.
- `CLAUDE.md` folder map ("`(tabs)/` (Home, Transactions, Import,
  Deductions, Truck Health)", already stale) and the comments in
  `_layout.tsx:154-168`, `navRegistry.ts:4-36,165-170`.
- i18n `reports.subtitle` ("…the Intelligence and Tools groups…").

### Design for the registry (used by every commit)

Keep `RAW_NAV_GROUPS` as the full list of routes (tips coverage, Reports and
the flag filter keep working). Add next to it:

- `MENU_ORDER: Href[]`, the flat menu list in the owner's order;
- `MENU_REACHED_FROM: Record<href, parentHref | 'settings' | 'hidden'>`, for
  every route that is NOT a menu row (Reimbursements → Other Income,
  Scorecard → hidden (still in Reports), Category Learning → Settings, …).

A new test asserts that every route in `RAW_NAV_GROUPS` is either in
`MENU_ORDER` or in `MENU_REACHED_FROM`. That keeps the hard rule "every
moved or merged screen stays reachable" checked by `npx jest`.

### Proposed commits (one change each; each ships by itself with `eas update`)

1. **Flat Menu.** `MENU_ORDER` + test; `MenuSheet` renders it with no
   headings. Rows go from `paddingVertical: spacing.sm` to `spacing.md` and
   the label font from `typography.size.md` (13) to `lg` (16). Gear button
   (⚙️, closes the sheet, opens Settings) next to the X, with an
   accessibility label (new key, 7 locales). Bottom padding = safe-area
   bottom inset + `spacing.xl`. No Home row; Scorecard not listed. The five
   children and the three Settings tools stay as rows for now, at the
   positions of their future parents, so nothing becomes unreachable
   between commits.
2. **Tab bar.** Transactions gets `href: null` (route kept, like Deductions
   and Truck Health); its row appears in the menu (already in commit 1).
   `TAB_BAR_HREFS` updated (it is stale already).
3. **Merges**, one commit each, in this order: 3a Reimbursements card in
   Other Income; 3b Compare-trucks card in Trucks; 3c For Prime Inc Drivers
   card in Accountant Package; 3d "Assets & Equipment" row + Equipment card
   in Asset Register (new key `nav.assetsEquipment`); 3e Renewals card in
   Documents. Each removes the child row from `MENU_ORDER` and adds it to
   `MENU_REACHED_FROM`.
4. **Settings tools.** A "Tools" card in Settings with three buttons:
   Category Learning, Invite & Earn, Data Cleanup (same `SecondaryButton`
   pattern as `settings.tsx:587,641`). The three rows leave the menu.
5. **Docs**: `ui-conventions.md` nav section, CLAUDE.md folder map line,
   CHANGELOG. (Could also go with each commit.)

New i18n keys (all 7 locales; es/ru/tr/hi translated, ar/uk English):
`nav.assetsEquipment`, `menu.openSettings` (a11y), one link label per merge
(5), `settings.toolsTitle`.

Ship list for every commit: PENDING_SQL none; Edge Functions none;
`eas update` only (no native module, no `app.config.js` change). Each commit
gets its own update and a quick check on the tablet before the next one.

## 4. What would not work as stated, and alternatives

1. **"No section headings" vs the Reports tab.** Reports builds its list
   from the Intelligence and Tools GROUPS (`reports.tsx:8,20`). If the
   groups were deleted, Reports would be empty. Alternative (in the design
   above): keep the groups in the registry; only the Menu goes flat. Reports
   stays exactly as today, so it still lists Scorecard, Category Learning,
   Data Cleanup, etc. If the owner also wants Reports trimmed, that is a
   separate decision.
2. **Removing "Home" breaks the tablet.** On width ≥ 768 px (the owner's
   tablet in landscape) there is NO tab bar; `WideSidebar` is the only
   navigation and its Home row is the only way back to Home. Alternative:
   remove Home from the phone Menu only. Open question for the owner: should
   the wide sidebar also become the flat list (with Home on top), or keep
   its groups? Recommended: same flat order plus Home, so phone and tablet
   match.
3. **"Import (center)" with 4 tabs.** With Home | Import | Reports | Menu
   there is no middle slot; the raised Import button would sit in slot 2,
   off-centre. Alternatives: (a) accept slot 2 with the raised style
   (cheapest); (b) keep 5 slots with one more tab on the right, e.g. Home |
   Reports | [Import] | Truck Health | Menu; (c) a floating Import button
   over a 4-tab bar (more work, can cover content). Recommended: (a), unless
   the owner wants it truly centred, then (b).
4. **Bottom padding inside a Modal on Android.** `MenuSheet` is a React
   Native `Modal`. On Android a Modal is its own window, and
   `useSafeAreaInsets()` inside it can return 0; Expo SDK 54 is edge-to-edge,
   so the system back/navigation bar overlaps the sheet. Alternative: read
   the inset in `TabsLayout` (outside the Modal) and pass it to `MenuSheet`,
   or wrap the sheet in its own `SafeAreaProvider`; plus a fixed extra
   (`spacing.xl`) so it never sits under the bar even when the inset reads 0.
   This must be checked on the tablet/phone; it cannot be verified here.
5. **"Documents (Documents & Renewals inside)".** The screen called
   "Documents & Renewals" today is the compliance screen, a different screen
   from Documents. See the Documents row in §2: keep "Documents" as the menu
   row and name the inside link "Renewals & expiry dates".
6. **Reimbursements "inside Other Income".** Fine as navigation, but the
   link must not call them income (§2). Alternative row label, if wanted:
   "Other Income & Reimbursements".
7. **Asset Register + Equipment "as one".** A single combined list would mix
   deductions with `equipment` rows. The safe version is one menu row
   "Assets & Equipment" opening Asset Register with an Equipment link (§2).
8. **Stale `TAB_BAR_HREFS`.** It still lists Deductions and Truck Health,
   which are no longer tabs, so the More index (`more/index.tsx`) hides them.
   Commit 2 fixes the list; the More index then follows `MENU_ORDER` too.

Not verifiable here: how the sheet looks and scrolls on the device, the
Android navigation-bar overlap, and the tablet sidebar. The owner checks
those after each `eas update` (restart the app twice).
