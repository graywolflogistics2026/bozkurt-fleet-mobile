# Changelog — dated task entries

Moved verbatim from CLAUDE.md on 2026-10-13 (CLAUDE.md is now kept small).
Newest first = the reverse of the order entries were appended; a few
entries carry no date of their own. Entries that are mostly standing
rationale live in `docs/decisions/` instead (see the index in CLAUDE.md);
lines starting with ⤷ mark where part of an entry was moved there.
Inside entries, "above"/"below"/"the pass above" refer to the ORIGINAL
oldest-first order, i.e. read "above" as "further down this file".

NEW ENTRIES: add at the top, max ~10 lines each — what changed, files,
PENDING_SQL §, redeploys, eas update vs native build. Never in CLAUDE.md.

- RESUMABLE PAGE-BY-PAGE IMPORT JOBS — 17-page stall redesign (owner
  decisions 2026-10-13, A-H + B/C/D/G + amendments + scale add-on). Jobs run
  as a chain of short runs under the 150 s Free-plan wall clock, store each
  page's result, resume at the first unfinished page, hold a lease, beat a
  heartbeat ("Interrupted at page N - Resume"); Prime classification +
  early stop, attachments last (max 12), 40-page cap question, 10 MB / 150
  page limits; per-field page merge; core self-checks non-skippable; "line
  items incomplete" + "Read the missing pages". jobEngine.ts, index.ts,
  chunking.ts, bankDigits.ts. §78. Redeploy ai-import. eas update.
  docs/decisions/settlement-import-chunking.md ("Resumable jobs").

- PRIME STATEMENT AS SOURCE + SOURCE LABELS + PROFIT IS NEVER THE DEPOSIT
  (owner decisions 2026-10-13, D1-D9, R1-R4, bank-deposit add-on). Prime
  weeks with a self-checked Statement of Income and Expense count from it
  (linked rows = detail); Verified / Totals match / Unverified labels;
  printed deposit read (never computed), "Deposited to your bank" on Home,
  Cash Flow cash-in uses it; audit ledger + Share audit; import preview
  shows every statement line and check. §77 (settlements.statement jsonb,
  no backfill). Redeploy ai-import. eas update.
  docs/decisions/prime-statement-source.md.

- GOLDEN SETTLEMENT (owner decision 2026-10-13). Real Prime week (unit
  283940, W/E 8/21) showed ~$4,549, correct $2,534.36. Fixed: reimbursements
  now offset expenses in every profit figure; duplicate-fuel guard per row
  (fuel only in the fuel list was dropped); settlement-linked fuel/reimb
  follow their settlement's week; "184.85-" parses negative; import blocks
  on revenue/reimbursement/net-due mismatches (+ "Save anyway, flagged");
  real Prime operating-statement layout; Home profit bridge sheet. Golden
  test + docs/decisions/golden-settlement.md. No SQL. Redeploy ai-import.
  Ships via eas update.

- DOCUMENT TITLES ON THE LIST (owner decision 2026-09-23, follow-up — "the
  list still shows Document"). Root cause: the list read the right field
  (useDocuments() selects '*'; displayDocumentTitle() showed title first),
  but the title was only SAVED for documents imported after §76 was applied.
  Everything imported earlier, and every receipt attached from Deductions /
  Compliance / For Prime Inc Drivers (those uploads never go through
  saveExtraction(), doc_type 'other', no parsed_json), had title NULL, and
  linked-record titles were only computed inside the review sheet. Fix:
  resolveDocumentTitle() is computed once per document at render time
  (saved title -> linked record incl. prime_driver_expenses -> extraction ->
  vendor -> type label) into a `titles` map that BOTH the list row and the
  detail header read — nothing is written. The detail header is itself a
  TextInput (tap and type; saves as 'user' on blur/Done; empty or unchanged
  reverts). The "Needs a title" review now lists every document with no
  SAVED title (its list row may already show a computed one) so it can be
  saved or changed.

- DOCUMENT TITLES (owner decision 2026-09-23, docs/PENDING_SQL.md §76 —
  ✅ APPLIED 2026-09-23). `documents.title` +
  `title_source` ('ai' | 'record' | 'user'). On import, saveExtraction()
  stores the AI's own `title` (ai-import prompt's "document titles"
  addition) or one built from the extraction by buildTitleFromExtraction()
  with the caller's i18n TitleContext (useDocumentTitleContext()) — in a
  separate NON-FATAL update, so imports keep working before §76 is run.
  displayDocumentTitle() is the ONLY way a screen shows a document title
  (stored title -> vendor -> docType label); a source-audit test enforces
  it on documents.tsx. Tap the title in the viewer to rename
  (title_source 'user'); setDocumentTitle() re-reads the row and never lets
  an 'ai'/'record' write replace a 'user' title. "Needs a title" review
  queue (findDocumentsNeedingTitle(): no stored title AND no vendor, newest
  first) is a manual, user-started pass: suggestion = a linked record's own
  confirmed data first (buildTitleFromLinkedRecords: settlement carrier +
  W/E, single deduction "<category> receipt — date", maintenance, compliance
  label), then the stored extraction; one tap to accept or type your own.
  Historical documents with neither a linked record nor usable extracted
  data get no suggestion (the user types one) — there is no automatic
  re-run of the AI on the stored file.

- TRANSACTIONS SIGN BUG + ACCOUNTANT PACKAGE OUT-OF-POCKET NOISE (owner
  decision 2026-08-28, two unrelated device reports). Both pure
  client-side calculation/display fixes — no SQL, no Edge Function.
  **Item 1 — negative settlements shown as positive/green in
  Transactions**: `app/app/(tabs)/transactions.tsx` mapped every
  settlement into a `TransactionRow` with `type: 'income'` hardcoded
  unconditionally (never checking `s.net`'s own sign), then rendered
  color/prefix purely from `row.type` (`row.type === 'income' ?
  colors.green : colors.red`, always `+`) and stripped the sign entirely
  via `money(Math.abs(row.amount))` — a "you owe the carrier"
  negative-net settlement showed green and positive despite Settlements'
  own screen already correctly framing it as negative. `amount: s.net`
  itself was never flipped — this was 100% display-only. **Per-consumer
  total audit, every canonical figure checked explicitly, none affected**:
  `computeKpis()` (`kpi.ts:226`), `trueProfit.ts`'s `calcTrueProfit()`/
  `buildWeeklyTrueProfitTrend()` (:168, :196), `profitAnalysis.ts`'s
  `buildProfitAnalysis()`, `truckComparison.ts` (Scorecard/per-truck,
  :200/:258/:262/:270), and the Accountant Package's own `grossIncome`
  (`accountant-package.tsx:290`) all read `.gross` (freight revenue,
  architecturally non-negative) unclamped, never `.net` — true
  profit/net is always computed FRESH as `gross − expenses`, never by
  reading the settlement's own precomputed `.net` column, so none of
  these could ever be sign-corrupted by this bug even in principle.
  Exactly two consumers DO read `.net` directly, both correctly, both
  unclamped: `settlementsSummary.ts:23` (Settlements' own totals bar —
  confirmed already correct, matching the device report's own
  observation) and `dashboardStats.ts:61`'s `netRevenue`, which feeds
  `taxEstimate.ts:75`'s `netProfitBeforeDepreciation` — a real,
  significant total (your tax estimate) — verified unclamped and
  correctly signed too, so a negative-net settlement correctly reduces
  estimated taxable profit, exactly per CLAUDE.md invariant #1's
  net-pay model. **Fix**: extracted `src/stats/transactionDisplay.ts`'s
  `isNegativeTransactionRow()` (this repo has no RN rendering harness,
  same "pure logic here, thin render reads from it" split every other
  `src/stats/*.ts` module uses) — an income row's sign is now driven by
  its own `amount` (settlement `net` genuinely can be negative); an
  expense row stays unconditionally negative (`deductions.amount` is
  always a positive magnitude, confirmed against this codebase's own
  NEGATIVE SETTLEMENTS fixtures — a $550 advance-repayment or $100
  escrow line is never itself negative, only a settlement's own net pay
  can be). Test: `transactionDisplay.test.ts`, using the exact
  established NEGATIVE SETTLEMENTS fixture numbers (gross $5.16, net
  -$1,155.35).
  **Item 2 — Accountant Package out-of-pocket export had too much
  noise**: `accountantPackage.ts`'s `buildLineItems()` already filtered
  by scope/origin (`matchesAccountantScope()`, correctly excludes a
  settlement-withheld row — including a genuinely settlement-withheld
  "weight ticket"/scale fee, verified with a dedicated test — from the
  out-of-pocket scope) and by period, but never excluded a row whose own
  CATEGORY is one of the three non-deductible ones
  (`NON_DEDUCTIBLE_CATEGORIES` — Meals/Advance Repayment/Escrow &
  Deposits, `category.ts`) — the same set `reducesTrueProfit()`/
  Deductions' own "excludes $X meals, advances and escrow" caption
  already key off of, just never applied here. A manually-tracked (not
  settlement-withheld) Advance Repayment/Escrow/Meals row therefore
  leaked straight into the out-of-pocket line-item list and its category
  table. Fixed with `OUT_OF_POCKET_EXCLUDED_CATEGORIES`, applied ONLY
  when `scope === 'outOfPocket'` — the withheld/combined scopes are
  deliberately unchanged (they may legitimately want these rows for
  reference), proven by a dedicated regression test using the same mixed
  fixture. **Lumper Fees, audited per the explicit "reimbursed vs
  paid-out split, as originally designed" ask**: no such split has ever
  existed in `buildLumperFees()`'s history — confirmed by reading this
  function's full history, not assumed; it has always been a flat,
  unconditional sum of every Lumper-Fees-categorized line item in scope
  +period, computationally correct and unregressed. The OLDER, no-longer-
  used `buildAccountantPackage()` rollup (kept only for a hypothetical
  future caller) DOES net a reimbursement against a matched category via
  `matchReimbursementCategory()`'s `/lumper/i` keyword rule, but that
  mechanism was never carried over into the current line-item-first
  engine — flagged as a genuine, real-world limitation (a reimbursed
  lumper fee still shows as a full out-of-pocket expense) rather than
  silently assumed correct OR invented as a new feature under this
  pass's own narrower audit scope; a dedicated test pins the current,
  correct-as-is behavior so a future pass that adds the offset changes
  it deliberately. Tests: `accountantPackage.test.ts` gained a full
  "OUT-OF-POCKET SCOPE NOISE" describe block (exclusion proof, the
  origin-rule-vs-category-fix distinction for the weight-ticket case,
  withheld-scope-unchanged proof, combined-scope-unchanged proof, the
  category-table-never-includes-excluded-categories proof, and the
  item-4 mixed-dataset scenario with the two permitted content sections'
  correct amounts) plus the Lumper Fees audit-confirmation test. Full
  suite: 131 suites / 3572 tests pass (+11); `tsc --noEmit` clean. No new
  i18n strings — both fixes are pure calculation/display logic, no new
  copy. Ships via a normal `eas update`.

- DASHBOARD NET PROFIT vs EXPENSES — ROOT-CAUSE FIX, NOT A RELOCATION
  (owner decision 2026-08-28, direct follow-up to the Profit Analysis
  pass's own flagged-not-rushed Dashboard finding). Root cause reported
  before any fix, per the owner's own explicit ask, then fixed.
  **Root cause, confirmed by tracing the real code (three calculations
  that could drift apart, not one)**: Home's Hero Card headline Net
  Profit came from `src/stats/heroPeriod.ts`'s OLD `calcHeroPeriod()` —
  it summed ONLY `points: WeeklyRevenueExpensePoint[]`, itself mapped
  from `buildWeeklyTrueProfitTrend()`'s own output, a SETTLEMENT-WEEK-
  BUCKETED array (one entry per settlement week that exists). With zero
  settlements that array is `[]`, so `netOf(undefined) = 0` /
  `sumWindow([], ...)` summed nothing — Net Profit was STRUCTURALLY $0
  for ANY zero-settlement account, on EVERY period tab, regardless of
  what real deductions existed for the selected window. Meanwhile
  `src/stats/heroPeriodWindow.ts`'s `calcHeroRevenueExpenseTrio()` (the
  Revenue/Expenses tiles directly below the Hero Card — NOT Net Profit,
  which `app/(tabs)/index.tsx`'s own pre-existing comment already noted
  reused `heroPeriodResult.netProfit` directly rather than being computed
  by this function) filters RAW settlement/deduction rows via
  `filterRowsByDateWindow()` against a window from
  `resolveHeroPeriodDateWindow()` — for the `'1M'/'3M'/'6M'/'yearly'`
  tabs specifically, that window is computed purely from `now` and a
  fixed day count, INDEPENDENT of whether any settlement exists, so
  Expenses could be correctly non-zero with zero settlements while Net
  Profit could not. This is the confirmed, exact mechanism behind "Net
  Profit $0 next to a correctly non-zero Expenses tile" — two genuinely
  different calculations, never mathematically forced to agree, not a
  caching/staleness bug and not reachable on 'thisWeek'/'lastWeek' with
  zero settlements (both `resolveHeroPeriodDateWindow()` and the OLD
  `calcHeroPeriod()` return/sum nothing for those two tabs when
  `sortedWeekEndings` is empty, so BOTH sides correctly show $0/no-data
  together in that specific case — the mismatch is `1M`/`3M`/`6M`/
  `yearly`-only, confirmed by tracing `resolveHeroPeriodDateWindow()`'s
  own two branches directly).
  **The fix — unified onto the canonical KPI object, not relocated**:
  Net Profit (and its "vs previous period" delta) now comes from
  `src/stats/periodScopedCpm.ts`'s `buildPeriodScopedCpm()` — the SAME
  `computeKpis()` object Scorecard/AI Coach/Profit Analysis already read
  from, itself built entirely from raw-row date-window filtering, never
  a settlement-week-bucketed trend, so it can no longer go structurally
  stuck at $0 just because no settlement happens to exist in the window.
  `periodScopedCpm` was already computed on this exact screen (feeding
  the per-mile trio) — it moved earlier in the component (right after
  `heroWindow`/`now` are declared) since the Hero Card's own headline
  number now reads from it too, and its own declaration further down was
  deleted rather than duplicated. `PeriodScopedCpmResult` gained a new
  `previousKpi: KpiResult | null` field — the SAME `computeKpis()` call
  for the immediately PRECEDING, same-length, non-overlapping window
  (via the already-existing `resolvePreviousHeroPeriodDateWindow()`),
  `null` under the exact same conditions `kpi` is (no resolvable window,
  or no settlement that far back yet for 'thisWeek'/'lastWeek') — this
  is what lets the Hero Card's delta come from the SAME canonical
  mechanism instead of a second, differently-sourced comparison.
  **What did NOT change, deliberately**: the Revenue/Expenses tiles
  (`calcHeroRevenueExpenseTrio()`) are completely UNCHANGED — they were
  never the broken half (already correctly raw-row-filtered, already
  unaffected by whether any settlement exists) and this trio's own
  Expenses definition (ALL deductions unconditionally — matching the
  "Total Deductions" card elsewhere, per this file's own pre-existing
  TRUE-PROFIT CONSISTENCY entry: "only Net Profit needed the exclusion")
  is DELIBERATELY preserved as its own, intentionally broader concept
  from the canonical `expenses.total` (which excludes Meals/Advance
  Repayment/Escrow & Deposits and includes fuel/maintenance/tolls) —
  changing it would have both regressed that already-established,
  documented distinction AND desynced it from the Expense Total
  Explainer modal below it, which already matches the trio's own figure
  exactly. "Unified onto ONE calculation" here means: Net Profit now
  shares the SAME window-resolution mechanism, the SAME raw-row-filtering
  primitive, and the SAME non-bucketed-trend data source every other
  screen's own KPI figure already uses — not that Net Profit is forced
  to equal `Revenue − Expenses(as literally displayed in the trio tile)`,
  since those two tiles were never the established contract (confirmed
  by the pre-existing TRUE-PROFIT CONSISTENCY comment) and forcing it
  would itself be a regression, not a fix.
  **`calcHeroPeriod()` narrowed, not left as a landmine**: renamed to
  `calcHeroChartPoints()`, returning `WeeklyRevenueExpensePoint[]`
  directly — the OLD `netProfit`/`deltaAmount`/`change` fields and the
  `HeroPeriodResult` type are deleted entirely, along with the
  revenue/expenses/net summation half of `netOf()`/`sumWindow()`, rather
  than merely left uncalled (which would have been exactly the "unused,
  misleading parallel calculation sitting in the codebase as a landmine
  for a future editor" this file's own KPI CONSISTENCY entry already
  warns against). The function still owns real, distinct logic worth
  keeping: the Hero Card's sparkline chart inherently wants "one point
  per settlement week" — a week with no settlement legitimately
  contributing no point to a WEEKLY chart is a rendering choice, not a
  numeric-correctness issue the way a headline NUMBER silently
  defaulting to $0 is, so the chart-points windowing (both the
  `thisWeek`/`lastWeek` 8-point slice and the `1M`/`3M`/`6M`/`yearly`
  rolling-window filter) is unchanged in behavior, just narrowed to only
  what it's still used for. `calcHeroRevenueExpenseTrio()` was
  confirmed NOT dead code (still the Revenue/Expenses tiles' real
  source) and left untouched.
  **Tests** (`src/stats/__tests__/kpiConsistency.test.ts`'s new
  "DASHBOARD NET PROFIT vs EXPENSES — root-cause fix" block): (1) THE
  BUG, reproduced directly — `buildWeeklyTrueProfitTrend([], ...)` is
  proven to return `[]` for a zero-settlement account, and summing over
  that empty array is proven to be exactly `0`, the literal old
  mechanism, contrasted against the SAME account's real, non-zero raw
  deduction total (the "next to a correctly non-zero Expenses tile"
  half); (2) THE FIX — the identical zero-settlement, non-zero-deduction
  dataset run through the real `buildPeriodScopedCpm()` on the `'1M'` tab
  proves `kpi.net` is correctly negative (`gross 0 − expenses ~$1,372.98`),
  never the old mechanism's structural $0; (3) `previousKpi` proven to
  power a genuine two-period delta (a $500 current-period deduction vs. a
  $200 previous-period one, both correctly bucketed into
  `resolvePreviousHeroPeriodDateWindow()`'s own resolved boundaries); (4)
  NO SIDE-EFFECT DRIFT — Revenue (`kpi.gross`), the per-mile trio
  (`rpm`/`cpm`/`ppm`/`miles.total`), and the pre-existing multi-truck
  fixture's own already-passing assertions are all re-proven byte-
  identical to before this pass, since `previousKpi` is a purely additive
  field that never touched how `kpi`/`cpm`/`comparison`/`scopedRow` are
  computed. `src/stats/__tests__/heroPeriod.test.ts` rewritten for
  `calcHeroChartPoints()` (chart-points windowing only — the netProfit/
  delta assertions it used to carry are now covered by `computeKpis()`'s
  own extensive existing test suite, which this pass's new block builds
  directly on top of). Full suite: 130 suites / 3558 tests pass (+6);
  `tsc --noEmit` clean. No new i18n strings — this is a pure calculation-
  unification pass, no user-facing copy changed. No SQL/Edge Function
  changes. Ships via a normal `eas update`.

- PROFIT ANALYSIS "GHOST VALUE" — TRACED AND FIXED, NOT STALE/CACHED
  (owner decision 2026-08-28, device report: "Profit Analysis shows
  -$1,372.98, but the Deductions screen's own total is $5,800.72 — these
  must reconcile and they clearly don't"). Traced the exact render path
  BEFORE writing any fix, per the owner's own explicit demand for real
  evidence over another guess.
  **Root cause, confirmed by reading the actual code, not theorized**:
  `app/(tabs)/more/profit-analysis.tsx`'s `rollup30d` useMemo (now
  `rollup`) called `buildProfitAnalysis(settlementsQuery.data ?? [],
  fuelQuery.data ?? [], maintenanceQuery.data ?? [], dedQuery.data ?? [],
  30, new Date(), tollsQuery.data ?? [])` — every one of those five
  inputs is a LIVE React Query hook (`useSettlements()`,
  `useDeductions()`, etc.), and the `useMemo` recomputes fresh on every
  render whenever any of them changes. **This was never a caching or
  stale-invalidation bug** — there is no persisted/cached intermediate
  value anywhere in this path. The real cause: `buildProfitAnalysis()`
  (`src/stats/profitAnalysis.ts`) took a hardcoded `windowDays = 30`
  parameter — a ROLLING trailing-30-day window — and filtered EVERY
  input (settlements by `week_ending`, deductions by `ded_date`, fuel/
  maintenance/tolls similarly) to just that window. Meanwhile the
  Deductions screen's own period selector
  (`app/(tabs)/deductions.tsx:264`, `useSessionState<PeriodOption>(
  'deductions-period', 'all')`) **defaults to `'all'`** — no lower
  bound. -$1,372.98 and $5,800.72 were both live, both correctly
  computed — for two different, invisibly-mismatched date ranges. A
  second, smaller structural difference compounded the confusion:
  Deductions' own "Total" tile (`buildDeductionsTotalsBar()`,
  `src/stats/deductionsSummary.ts`) is the unconditional sum of every
  deduction row's amount, with no fuel/maintenance/tolls folded in at
  all (those live in separate tables Deductions never reads); Profit
  Analysis's Net Income has always subtracted the canonical
  `sumCanonicalExpenses()` figure (`src/stats/trueProfit.ts`) — deducts
  Meals (per diem covered)/Advance Repayment/Escrow & Deposits, and DOES
  fold in fuel/maintenance/tolls. Two genuinely different quantities,
  not just two different windows.
  **The fix, two parts**: (1) `buildProfitAnalysis()`'s 5th parameter is
  now `startIso: string | null` (an explicit lower bound, or `null` for
  no bound) instead of a baked-in `windowDays` count — `windowStartIso()`
  is kept exported unchanged for the one caller that still legitimately
  wants a rolling window (`src/data/aiCoachSummary.ts`'s own internal
  `profitAnalysisRollup`, used only to feed recommendation-candidate
  thresholds, never displayed as a headline figure — unaffected by this
  fix, still trailing 30 days). The screen now offers the SAME period
  selector Deductions/Settlements already use
  (`src/stats/periodFilter.ts`'s `PERIOD_OPTIONS` — This Month/3M/YTD/
  All, `periodStartIso()`), defaulting to `'all'` so the two screens
  agree by default without the user having to know to change anything.
  (2) `ProfitAnalysisRollup` now exposes the full reconciliation
  breakdown (`deductionsGrossTotal`/`deductionsExcludedTotal`/
  `deductionsCountedTotal`/`canonicalFuelExpense`/`tollsExpense`/
  `totalExpenses`) instead of just the rolled-up `netIncome` — extracted
  from a new shared `canonicalExpenseBreakdown()`
  (`src/stats/trueProfit.ts`), which `sumCanonicalExpenses()` is now a
  thin wrapper over (`.total`) so its own exported signature/behavior is
  completely unchanged for every other existing caller. The screen
  renders this as a "Total Expenses Breakdown" card — Deductions (gross,
  the SAME figure Deductions' own "Total" tile would show for an
  identical date range) minus an excluded-amount caption (meals/advance/
  escrow) plus Fuel/Maintenance/Tolls, equals Total Expenses — so the
  relationship between the two screens' numbers is visible, not
  implicit, per the owner's own framing ("Total Expenses should relate
  to Total Deductions plus/minus whatever other canonical inputs
  apply").
  **Cross-screen check (item 4 of the request), a real additional bug
  found and DELIBERATELY NOT fixed in this pass, flagged plainly**:
  audited Dashboard, Scorecard, and AI Coach for the exact same
  zero-settlement/manual-deductions-only account state.
  - **Scorecard**: no bug. Its per-mile KPI trio already reads from the
    canonical `computeKpis()` (migrated in an earlier pass, verified
    correct for this exact sub-ledger shape by the immediately-preceding
    "sub-ledger/general-ledger" pass); its "Weekly Net Trend" list uses
    `buildWeeklyTrueProfitTrend()` too, but only to populate a per-week
    ROW LIST (correctly empty with zero settlements — a list, not a
    headline figure that could read as "wrong").
  - **AI Coach**: no bug. `src/data/aiCoachSummary.ts:83`'s `latestWeek
    = weeklyTrend[weeklyTrend.length - 1] ?? null` correctly resolves to
    `null` for zero settlements, and `ceo-mode.tsx` renders `latestWeek
    ? money(latestWeek.gross) : '—'` — an honest "—", never a misleading
    $0. Defensible: "this week's profit" is inherently a settlement-week
    concept (invariant #9's "weekly is this app's only revenue
    granularity") — there genuinely is no "this week" to report on.
  - **Dashboard — CONFIRMED BUG, not fixed here**: `app/(tabs)/
    index.tsx:930-933`'s `heroPeriodResult` (the Hero Card's headline
    number) is `calcHeroPeriod(fullWeeklyTrueProfitAsRevenueExpense,
    heroPeriod, now)`, and `fullWeeklyTrueProfitAsRevenueExpense` is
    derived from `buildWeeklyTrueProfitTrend(scopedSettlements, ...)`
    (`src/stats/trueProfit.ts:192`), whose own `weekEndings` array is
    built SOLELY from `settlements` — `[...new Set(settlements.filter(s
    => s.week_ending)...)]`. Zero settlements means zero weekly points,
    unconditionally, regardless of how many manual deductions exist for
    any date. `calcHeroPeriod()`'s own `netOf(undefined) = 0`
    (`heroPeriod.ts:29-31`) and `sumWindow([], ...)` both return exactly
    `0` for an empty points array — this is CORRECT given what the
    function is fed, but what it's fed is wrong for this case. The
    practical effect: for every ROLLING tab (1M/3M/6M/yearly — NOT
    thisWeek/lastWeek, which legitimately have no "current week" to
    speak of with zero settlements and correctly resolve to `null` via
    `resolveHeroPeriodDateWindow()`), the Hero Card's headline Net
    Profit shows **exactly $0**, always, regardless of real manual
    deductions — while the Revenue/Expenses/Net Profit trio directly
    below it shows a CORRECT, non-zero Expenses figure for the identical
    window (`calcHeroRevenueExpenseTrio()`, `index.tsx:950-953`,
    deliberately raw-row-filtered by `heroWindow` rather than
    settlement-week-bucketed, specifically to avoid this exact gap-date
    problem — CLAUDE.md's own prior "CPM/PPM BROKEN AGAIN" entry). The
    Trio's own Net Profit tile (`index.tsx:1186-1193`) then deliberately
    REUSES `heroPeriodResult.netProfit` "so it can never show a
    different figure than the Hero Card's own headline" — which means
    Home can currently show Revenue: $0 · Expenses: $(real total) · Net
    Profit: $0 side by side, an internally-inconsistent arithmetic
    result (Net Profit ≠ Revenue − Expenses) directly on the app's own
    landing screen, for exactly the account shape (zero settlements,
    manual-only deductions) the owner's own account is currently in.
    **Why not fixed in this pass**: fixing the Trio tile ALONE (compute
    it as `heroPeriodTrio.revenue - heroPeriodTrio.expenses` instead of
    reusing `heroPeriodResult.netProfit`) would just move the
    inconsistency rather than remove it — it would make the Trio correct
    while making it disagree with the Hero Card's own headline number
    right above it, breaking the OTHER intentional invariant that
    comment protects. Fixing it properly means giving `calcHeroPeriod()`
    (or a rolling-period-only alternative to it) a raw-row-based
    computation for BOTH the current AND the equivalent PRECEDING window
    (needed for `.change`/`.deltaAmount`, mirroring
    `resolvePreviousHeroPeriodDateWindow()`'s own existing symmetry) —
    a real, non-trivial change to code the chart/delta rendering also
    depends on, judged too risky to rush within this same pass. Flagged
    here explicitly as a confirmed, scoped, actionable follow-up rather
    than silently left for a future device report to rediscover from
    scratch.
  **Tests** (`src/stats/__tests__/profitAnalysis.test.ts`): every
  existing `buildProfitAnalysis()` call site updated to the new
  `startIso` signature (`windowStartIso(30, NOW)` in place of the bare
  `30`, unchanged behavior); a new `explicit startIso / null bound /
  reconciliation breakdown` describe block — `startIso=null` includes
  every row regardless of date; `deductionsGrossTotal` always equals
  `deductionsCountedTotal + deductionsExcludedTotal` exactly;
  `totalExpenses` always equals `revenue - netIncome` AND the sum of its
  own 4 breakdown parts; `canonicalFuelExpense` excludes settlement-
  linked fuel while the display-tile `fuelExpense` still includes it;
  and — the literal reported scenario — a fixture reproducing the exact
  $1,372.98 (trailing 30 days) vs. $5,800.72 (all time) figures from a
  single realistic manual-deductions-only dataset, proving the smaller
  figure is a genuine, correctly-computed subset of the larger one, not
  a different/wrong number. `src/stats/__tests__/kpiConsistency.test.ts`
  updated to the new signature (unchanged assertions). Full suite: 130
  suites / 3552 tests pass (+11); `tsc --noEmit` clean; all 7 locales
  confirmed at full recursive key-parity (a direct key-set diff, not
  just the glossary test) — `profitAnalysis.last30Days` removed
  (confirmed unused everywhere first), 10 new keys added, "escrow" kept
  in Latin script per the glossary in every translation, es/ru/tr/hi/ar
  fully translated, uk as an untranslated English copy per invariant
  #11. No SQL/Edge Function changes — every change in this pass is pure
  client-side JS/TS. Ships via a normal `eas update`.

- AI COACH CHAT UNREACHABLE WHEN NO WEEKLY GOAL IS SET (owner decision
  2026-08-28, device report: "AI Coach chat still missing" after the
  SIMPLIFICATION PASS folded it into `ceo-mode.tsx`). Confirmed by
  tracing the render tree, not by re-guessing a repeat of the same fix:
  the "Ask a Question" chat block (`app/(tabs)/more/ceo-mode.tsx`) had
  been nested INSIDE the `weeklyGoal == null ? <goal prompt> : <...>`
  ternary's else-branch — a gate that exists to hold the AI BRIEFING back
  until a weekly goal is set (device feedback round 2, owner decision
  2026-07-13), which the chat section inherited by accident when it was
  folded in, despite `chatMessages`/`handleSendChat` having zero actual
  dependency on `weeklyGoal`. Net effect: an account with no
  `profiles.weekly_goal` set could never reach the chat at all, even
  though the code was live and pushed. Fixed by moving the chat block out
  to render unconditionally alongside every other post-loading section,
  independent of goal status. `tsc --noEmit` clean; full suite (129/129
  suites, 3500 tests) unchanged/still passing (no new pure-logic module —
  this is a pure JSX-placement fix; this repo has no React Native
  rendering harness to add a dedicated regression test against, the same
  standing limitation flagged at every prior UI-reachability fix in this
  file). No SQL/Edge Function changes — ships via a normal `eas update`.

- SIMPLIFICATION PASS (owner decision 2026-08-27, eight items — remove
  features not earning their place, fix a data-cleanup gap, adapt
  Equipment to auto-populate, calm the daily tip down). No SQL/Edge
  Function changes needed for items 1-6/8; item 7 needs
  docs/PENDING_SQL.md §73 (below). Every code change ships via a normal
  `eas update` — no new native dependency, no native rebuild needed for
  anything in this pass.
  1. **DAILY TIP PERSISTENCE, re-diagnosed from scratch**: the prior
     "flash and vanish" fix (`findTodaysAnchorTip()`) was necessary but
     not sufficient. Two real, independent bugs found by tracing the
     actual render tree, not by re-applying the same hypothesis: (a) the
     daily-tip card used to live INSIDE `AiCoachSection`
     (`app/(tabs)/index.tsx`), which only mounts once `aiCoach.isLoading`
     (`useAiCoachSummary()` — 7 required queries) resolves — but
     `useDailyTip()` itself needs ~20 queries to compute a FRESH pick
     (strictly MORE than aiCoach needs), so `AiCoachSection` would mount
     first with the tip block still empty inside it, then pop in later;
     worse, if `aiCoach.isLoading` ever flipped back to `true` for any
     reason during a session, the WHOLE section (tip included) would
     UNMOUNT, showing the unrelated loading placeholder in its place — a
     real, visible flash/vanish with nothing to do with the tip's own
     data readiness. Fixed by extracting a new, always-mounted
     `DailyTipCard` component rendered as a sibling OUTSIDE the
     `aiCoach.isLoading` branch (`app/(tabs)/index.tsx`), gated only on
     its own sticky `dailyTip.tip` state. (b) `useDailyTip()`
     (`app/src/data/dailyTips.ts`) gated even RECONSTRUCTING an
     already-recorded anchor for today on the FULL `ready` (all ~20
     queries) — but reconstructing an anchor only ever needs
     `profileQuery` (nudge_state lives on the profile row); the other ~19
     queries exist solely to let `buildDailyTipCandidates()` pick a FRESH
     topic when nothing's been shown yet. Split into `profileReady`
     (gates anchor reconstruction — fast) vs. the existing `ready` (still
     gates picking a NEW topic — needs the full data), so the common case
     ("today's tip was already decided, just show it again") now renders
     almost instantly instead of waiting on the slowest of ~20 independent
     queries on every fresh Home mount. **Honest limitation**: this repo
     has no React Native rendering harness (standing, documented
     limitation throughout this file) — the fix is structural and
     directly explains the exact reported symptom ("not require
     re-navigation to see it"), but there is no automated test that
     exercises the actual mount/unmount timing; verify on-device.
  2. **DELETED (RETIRED) DRIVER STILL OFFERED IN IMPORT — root cause
     found and fixed**: there is no hard-delete UI for a driver at all —
     `app/(tabs)/more/drivers.tsx`'s own header comment already says so
     ("'active' toggle is the retire equivalent — no delete from the UI,
     drivers can have settlement/payment history"); `useDeleteDriver`
     (the hard-delete hook, `app/src/data/drivers.ts`) has ZERO callers
     anywhere in the app, confirmed by grep. So "I deleted a driver" means
     the user toggled it to `active: false` — and the import screen's own
     `useDrivers()` call (`app/(tabs)/import/index.tsx`) fetched EVERY
     driver, active or not, so `resolveDriverMatch()`
     (`app/src/import/driverMatch.ts`, itself confirmed 100% pure — no
     hidden persistence, driven entirely by whatever `drivers` array it's
     given) kept auto-matching and offering a retired driver forever.
     Fixed by filtering the import screen's own fetch to
     `useDrivers({ active: true })` — the EXACT SAME filtering mechanism
     already established two lines below it for a different entity
     (`useUserCategories({ active: true })`), never a new pattern.
     Matches `ActiveTruckContext`'s own `.eq('is_active', true)` fetch for
     trucks, which never had this bug in the first place. **Audited the
     same class of bug for trucks and loans, per the user's own
     directive**: trucks were ALREADY correctly filtered
     (`ActiveTruckContext.tsx:94`); loans have no "existing loan" picker
     reachable during import at all (`resolveLoanAssetMatch()` only
     matches a NEW loan's asset NAME against truck/equipment, never
     selects among existing loans, so there's no stale-list surface for
     this bug class to hide in) — but ONE real, lower-severity instance
     was found and fixed anyway for consistency:
     `app/src/data/aiImportSave.ts`'s own `loan_agreement` docType asset-
     link lookup fetched trucks with no `is_active` filter at all,
     meaning a NEW loan-agreement document could theoretically match a
     RETIRED truck's own unit_number — added `.eq('is_active', true)`
     there too. Test: `entityHooks.test.ts` gained a case proving
     `useDrivers({ active: true })` issues a real `.eq('active', true)`
     constraint — the exact mechanism the import-screen fix depends on.
  5. **TRIMMED: the estimates-only disclaimer under Home's greeting** —
     removed `<LegalFootnote/>` from `AiCoachSection`
     (`app/(tabs)/index.tsx`, right under its own "🧑‍✈️ Good Evening"
     line) specifically, since none of that card's own content
     (recommendations, weekly review, periodic nudges) is a computed TAX
     figure — this is a MOVE, not a deletion of invariant #8. Confirmed
     (not assumed) the disclaimer is still present everywhere it's
     load-bearing: Tax Estimator (`tax-estimator.tsx:255,493`),
     Accountant Package (screen `accountant-package.tsx:896` AND both
     PDF/Excel exports via `t('common.legalFootnote')` threaded into
     `accountantPackageReport.ts`'s `disclaimer` string, rendered at
     `accountantPackageReport.ts:348`), and Home's own Tax Strip card
     (`app/(tabs)/index.tsx:762`, unchanged) — the ONLY screens that carry
     it after this change, matching invariant #8's own requirement
     exactly.
  7. **EQUIPMENT AUTO-POPULATED FROM IMPORTS (owner decision, binding)**:
     a settlement or standalone purchase deduction line landing in a
     durable-goods category now ALSO creates a linked Equipment row, the
     same "one item, two views, id-linked" pattern this codebase already
     established for personally-paid expenses <-> capital contributions.
     **Categories** (`app/src/import/category.ts`'s new
     `EQUIPMENT_TYPE_CATEGORIES`, one shared constant, no re-typed second
     list anywhere): `Tools & Equipment`, `Truck Supplies & Equipment`,
     `Electronics`, `Comfort & Sleeper`, `Safety Gear & Workwear` — every
     one a real, pre-existing `CANONICAL_CATEGORIES` string, never
     invented. Deliberately EXCLUDES `Truck Parts` (that category's own
     existing comment already draws this exact line: a CONSUMED part,
     not a standing asset) and `Major Repairs & Overhauls`/`Warranty &
     Service Contracts` (a repair/service, not a tracked physical item).
     **Schema** (docs/PENDING_SQL.md §73, mirrored as `pending_73.sql`,
     **NOT YET APPLIED**): `equipment.linked_deduction_id uuid references
     deductions(id) on delete cascade` (mirrors
     `capital_transactions.linked_deduction_id` exactly) + `equipment.
     vendor text` (mirrors `deductions.store` — no existing column served
     this purpose). **Wiring** (`app/src/import/equipmentLink.ts`'s pure
     `buildLinkedEquipmentInsert()`, called from THREE sites in
     `app/src/data/aiImportSave.ts` — settlement-withheld deductions
     [after `insertBatchResilient()` was extended to return inserted
     rows' real ids via `.select()`, a backward-compatible change every
     existing caller already ignored the return value of], standalone
     purchase deductions [`mapPurchase()`'s own loop, already had
     `savedDed.id`], and the generic fallback deduction): a failure to
     create the linked row THROWS a step-tagged `SaveExtractionError`
     (`equipment-link-insert`, added to `saveExtractionError.ts`'s
     `SaveExtractionStep` union and `errorStepGroups.ts`'s
     `savingRecords` bucket) — never silently swallowed, matching this
     file's own "never let a save look complete when it wasn't"
     convention. **Bidirectional delete, the mechanism chosen and why**:
     deleting the DEDUCTION side is a pure DB-level cascade (§73's `on
     delete cascade`, zero app code, free) — the REVERSE direction
     (deleting Equipment also deletes its linked deduction) has no FK to
     hang a cascade off of, so it's one explicit, directly-testable
     function, `app/src/data/equipmentMutations.ts`'s
     `deleteEquipmentWithLinkedDeduction()` (extracted out of
     `equipment.tsx`'s own delete handler specifically so it's
     exercisable against the fake Supabase client — this repo has no RN
     rendering harness to call a screen's own event handler directly) —
     the Equipment row's own delete always commits FIRST and is never
     undone if the linked-deduction delete then fails (reported back,
     never thrown). **Field sync on edit** (item 7.5): editing a
     deduction's amount/date/description/store on the Deductions screen
     (`app/(tabs)/deductions.tsx`'s `handleSaveEdit()`) now also calls
     `app/src/data/deductionMutations.ts`'s new `syncLinkedEquipment()` —
     a plain `.update(...).eq('linked_deduction_id', deductionId)` (no
     lookup step needed; a deduction with no linked row simply updates
     zero rows, the correct no-op), best-effort/never-blocks
     (`.catch(console.error)`), mirroring `applyContributionSync()`'s own
     spirit rather than a second atomic RPC (unlike a capital
     contribution, a linked Equipment row has zero effect on any profit/
     tax total, so there's nothing here needing that same all-or-nothing
     guarantee). `category` is DELIBERATELY never synced (the user may
     want the asset side classified differently from the expense side);
     every Equipment-only field (financing, loan_id, depreciation,
     tags, notes) obviously has nothing to sync from. **Canonical totals
     verified unaffected — structurally, not just by absence of a bug
     today**: grepped `sumCanonicalExpenses()`/`computeKpis()`/
     `calcCanonicalCpm()`/`buildTruckComparison()` for any reference to
     an `equipment` table/param — none exists; none of these functions
     even ACCEPT an equipment array as input, so there is no code path
     for Equipment's existence to affect any total, ever. Proven directly
     in `aiImportSave.equipmentLink.test.ts`'s own dedicated test
     (deleting the just-created Equipment row leaves
     `sumCanonicalExpenses()`'s output byte-identical). **Backfill**
     (item 7.4/7.7): `app/src/import/equipmentLink.ts`'s pure
     `findMissingEquipmentBackfill()` (checked BOTH by
     `linked_deduction_id` AND, defensively, a fuzzy match on
     name+amount+date, in case an Equipment row was created some other
     way before this feature existed) feeds a new "Missing Equipment
     Entries" section on Data Cleanup
     (`app/(tabs)/more/data-cleanup.tsx`/`orphanCleanup.ts`'s
     `useOrphanSummary()`/`useRunEquipmentBackfill()`) — additive, never
     destructive, so no blocking confirmation dialog like the delete
     tools on that same screen, still gated behind the same explicit
     multi-select + button pattern (nothing auto-created on page load).
     **Equipment screen** (`equipment.tsx`) gained a "📥 From an import"
     badge (mirrors Loan Center's own established "📥 From a settlement"
     provenance-badge convention) and a vendor line on any auto-linked
     row. **Equipment tip rewritten** (item 7.8, see item 8 below).
     Tests: `equipmentLink.test.ts` (13, the pure category/insert/backfill
     logic), `equipmentMutations.test.ts` (4, the real bidirectional-
     delete function against the fake Supabase client — including the
     "cascade from the deduction side" case and the "linked-delete
     failure never undoes the already-committed Equipment delete" case),
     `aiImportSave.equipmentLink.test.ts` (5, end-to-end through the REAL
     `saveExtraction()` — settlement AND standalone-purchase paths both
     proven to create linked rows, a consumable category proven to
     create NONE, the cascade-on-delete proven, and the canonical-totals-
     unaffected proof).
  8. **DAILY TIP LIBRARY updated to match items 3/4/6/7**: removed
     `tipFixTruckAssignments`/`tipAiAdvisor`/`tipShareProfit` entirely —
     their `DailyTipTopic` union members, `DAILY_TIP_CATEGORY`/
     `DAILY_TIP_ROUTE`/`DAILY_TIP_ICON` entries, detector functions
     (`detectTipFixTruckAssignments`/`detectTipAiAdvisor`/
     `detectTipShareProfit`), `DailyTipBuilderInput` fields
     (`unassignedRowsCount`/`hasPositiveNetWeek`, now unused since their
     only detectors are gone — `app/src/data/dailyTips.ts`'s own
     `findUnassignedRows()`/`hasPositiveNetWeek` computations removed
     too), `buildDailyTipCandidates()` wiring, coverage-map entries, AND
     — a real gap this pass's own audit caught, not just the TS topic
     union — the actual i18n STRING blocks
     (`dailyTips.tipFixTruckAssignments.v0/v1/v2` etc.) in all 7 locale
     files, which the TS-level removal alone would have left dangling.
     Equipment tip (`dailyTips.tipEquipment.v0/v1/v2`) rewritten in all 7
     locales to describe automatic population from imports, correcting
     the old, now-FALSE "not a one-off deduction" framing (it now
     appears in BOTH places, deliberately). **Coverage-map test
     genuinely strengthened, not just updated**: the existing test
     (`dailyTips.test.ts`) only ever checked the FORWARD direction (every
     nav href has a coverage entry) — it would NEVER have caught a STALE
     coverage-map entry left behind for a since-removed screen, exactly
     the mistake this pass could have made. Added a new REVERSE-direction
     test (`every coverage-map key still names a REAL nav registry href`)
     and directly VERIFIED it catches the mistake it's designed for:
     temporarily re-added a
     `'/(tabs)/more/truck-assignments': 'intentionalNone'` entry, re-ran
     the suite, watched it fail with that exact key listed in `orphaned`,
     then reverted and confirmed it passes clean — not just asserted in
     a comment.
  **i18n across the board**: new keys added to all 7 locales (es/ru/tr/
  hi/ar fully translated, uk as an untranslated English copy per
  invariant #11) — `ceoMode.chatTitle/chatEmpty/chatInputPlaceholder/
  chatSend/chatFailedTitle` (reusing the just-orphaned `aiAdvisor.*`
  translations' own wording before that block was deleted, so the
  folded-in capability reads identically to what it replaced),
  `equipmentScreen.fromImport` (+ `deleteConfirmBody` reworded to
  mention the linked-deduction removal), `dataCleanup.
  missingEquipmentTitle/missingEquipmentNote/createSelected/
  viewInEquipment`. Orphaned keys removed from all 7 locales:
  `nav.truckAssignments`/`nav.aiAdvisor`/`nav.shareProfit`, the entire
  `truckAssignments.*`/`aiAdvisor.*` blocks, `shareProfit.*`'s
  screen-only sub-keys (kept the shared-pipeline ones), and the 3
  orphaned `dailyTips.tip*` blocks. `docs/ADMIN_RUNBOOK.md`'s own
  hand-maintained "every screen as of this writing" SQL route list
  (its own header comment: "update this list whenever a screen is
  added/removed") updated to drop the 3 removed routes. Glossary/parity
  test re-passed clean after one real catch: `truckComparison.
  unassignedFixLink`'s new wording had translated "Settlements" into
  es/ru/tr/ar instead of keeping it in Latin script per the glossary —
  fixed to keep the literal route name in English in all four before
  committing.
  **Deliverables**: 129 suites / 3500 tests pass (the JS test count
  reads slightly lower than the prior pass's 3512 despite ~22 new pure-
  logic tests added — the glossary test dynamically generates one
  case per glossary-term-occurrence per locale, and removing 3 topic
  blocks + several `shareProfit`/`aiAdvisor`/`truckAssignments` i18n
  keys genuinely shrank that count; confirmed no test FILE was lost,
  same 129 suites both times); `tsc --noEmit` clean. No Edge Function
  was touched — no redeploy needed for `ai-import`/`ai-advisor`/
  `reset-data`/`delete-account`/`referral-sync`. `docs/PENDING_SQL.md`
  §73 is **NOT YET APPLIED** — until it's run, any deduction landing in
  an equipment-type category during import fails cleanly with a step-
  tagged `equipment-link-insert` error (the column doesn't exist yet)
  rather than silently skipping the link — apply it before relying on
  this feature in production. Ships via a normal `eas update`.
  ⤷ [moved 2026-10-13: lines starting "3. **REMOVED: Fix Truck Assignments screen**, enti..." -> docs/decisions/retired.md]
  ⤷ [moved 2026-10-13: lines starting "6. **REMOVED: Share Weekly Profit screen** — delet..." -> docs/decisions/retired.md]

- SIX-ITEM FINAL PASS (owner decision 2026-08-27) — a large, deliberately
  rigorous pass: remove business balance tracking outright, unify every
  screen onto the one canonical KPI engine, fix a confirmed Fix Truck
  Assignments data-loss report, add a manual-deduction receipt
  attachment, audit (not blindly re-fix) the daily-tip diagnostic, and
  close the multi-file import ordering gap. Deliverables: 128 suites /
  3,496 tests pass; `tsc --noEmit` clean; all 7 locale files confirmed at
  full recursive key-parity (0 missing/0 extra keys each, glossary test
  re-passed clean, 1,602 checks).
  3. **CRITICAL — Fix Truck Assignments "data loss" report: audited,
     confirmed NOT a delete anywhere in the reachable code, refactored
     for testability + a real resilience gap fixed**. Full trace before
     writing anything, per the explicit instruction: `app/(tabs)/more/
     truck-assignments.tsx`'s per-row handler (`openRowPicker` →
     `assignOne()`, pre-refactor) and bulk handler (`handleBulkAssign()`)
     both called ONLY `useUpdateSettlement`/`useUpdateFuelPurchase`/
     `useUpdateMaintenanceRecord`/`useUpdateToll` — every one of those is
     `createEntityHooks(<table>).useEntityUpdate` (`src/data/
     entityHooks.ts:182-192`), which issues
     `supabase.from(table).update(values).eq('id', id)`. `useEntityDelete`
     (`entityHooks.ts:194-204`) is a genuinely separate function with its
     own `.delete()` call — confirmed, by reading both side by side, that
     nothing in this screen's call chain ever reaches it. Git history
     confirms this isn't a regression either: `git log --oneline -- app/
     (tabs)/more/truck-assignments.tsx app/src/import/
     truckAssignmentRepair.ts` shows exactly ONE commit (`08cdc2c`) ever
     touched either file — there is no prior "correct" version this could
     have regressed from. **Cannot confirm "why it deletes instead of
     updates" because it does not delete** — stated plainly rather than
     inventing a root cause to match the report. Most likely explanations
     for what was actually observed, in order of plausibility: (a) the
     similarly-named "Data Cleanup" screen (`app/(tabs)/more/
     data-cleanup.tsx`) DOES delete rows by design (orphaned tolls/
     maintenance/documents/duplicate loans, each behind its own explicit
     "Remove Selected" confirm) — easy to conflate with "fixing truck
     assignments"; (b) a genuine, if narrow, resilience gap this audit
     DID find and fix (below).
     **The real gap, fixed**: `handleBulkAssign()`'s old inline logic
     wrapped its whole per-row loop in ONE shared try/catch, so a single
     row's update failure (e.g. a genuine
     `settlements_user_week_truck_uidx` collision — two unassigned
     same-week settlements bulk-assigned to the same truck in one batch)
     aborted the ENTIRE remaining batch with no per-row report of what
     happened or didn't. Refactored the previously inline, unexported,
     untestable logic into `app/src/data/truckAssignments.ts`'s exported
     `assignRowsToTruck(rows, truckId)` — never anything but
     `update({truck_id}).eq('id', row.id)` per row, for any of the 4
     tables — which now NEVER aborts on one row's failure: every row is
     attempted, successes and failures are both collected and returned
     (mirroring `aiImportSave.ts`'s own established
     `insertBatchResilient()` convention for exactly this "one bad row
     must never take down the whole batch" problem). The screen's bulk
     handler now shows a "{{count}} row(s) could not be assigned" alert
     naming which ones and why, re-selecting only the failed rows so the
     user can retry just those.
     **Proof, as required — a real test against the real exported
     handler**: `src/data/__tests__/truckAssignments.test.ts` (new, 5
     tests, using `fakeSupabase.ts`) — 0 rows selected (no-op, no crash);
     all rows selected across 2 tables (N in, N out, every one correctly
     assigned, no other column touched); a row already assigned to a
     DIFFERENT truck (reassigned, not duplicated or dropped — row count
     unchanged); the bulk-select path specifically, across all 4 tables
     at once (same total row count, all correctly assigned); and the
     resilience fix itself — one row's injected update failure mid-batch
     leaves the OTHER rows correctly assigned and the failed row's own
     row count/existence completely unchanged (still exists, just
     unassigned) — proving no row is ever removed on failure either.
     **Honestly stated, not glossed over**: the literal git-stash-verify-
     it-fails-then-passes step this item's own instructions called for
     could not be performed meaningfully — there is no prior "buggy"
     version of this logic to stash back to (confirmed by the git-log
     check above), so a stash-and-rerun would just make the test file and
     `truckAssignments.ts` disappear entirely (nothing to run, not a
     failing assertion). The proof that exists instead: the reachable
     code was read line by line and traced to a plain `.update()` call at
     every step (cited above with exact file:line), and the 5 new tests
     pass against the REAL exported function, not a reimplementation.
  4. **Deductions manual entry — attach a receipt**: `src/deductions/
     attachment.ts`'s `buildDeductionAttachmentPath()` (pure path
     builder, `{user_id}/Receipts/{slugified description}/{filename}`)
     and `src/data/deductionAttachment.ts`'s `uploadDeductionAttachment()`
     mirror `src/compliance/attachment.ts`/`src/data/
     complianceAttachment.ts`'s already-established manual-attachment
     pattern exactly (upload-immediately-on-pick, `doc_type: 'other'`, no
     AI extraction). Three actions on the manual add-deduction sheet
     (`app/(tabs)/deductions.tsx`) — "📷 Take Photo" (`expo-image-picker`'s
     `launchCameraAsync`, camera permission already configured in
     `app.config.js` for this exact plugin), "🖼️ Choose from Library"
     (`launchImageLibraryAsync`), "📄 Import a File"
     (`expo-document-picker`) — all already-installed dependencies, no
     new native module. Manual fields stay the sole source of truth (no
     re-extraction of the photo/PDF's own contents) — the attachment is
     proof only. On Save, `insertDeductionWithContributionSync()` (the
     atomic §62 RPC) creates the deduction as before, unmodified; if an
     attachment was uploaded, a SEPARATE plain `updateDeduction.mutateAsync({
     document_id })` follow-up links it — same "attaching has no
     interaction with the RPC's own money-correctness guarantees, so it's
     never folded into that RPC's signature" precedent this exact
     screen's own `handleAssignTruck()` already established for truck
     assignment. Best-effort: an attachment-link failure never undoes the
     already-successfully-saved deduction. Appears in Documents & Renewals
     automatically, no new UI needed there — `documents.tsx`'s existing
     `findLinkedRecords()`/`documentTitle.ts` machinery already surfaces
     any deduction with a real `document_id` (confirmed by reading
     `documentsFilter.ts:126-138` before claiming this, not assumed).
     Tests: `src/deductions/__tests__/attachment.test.ts` (new, 3 tests —
     the path shape, the user-id-prefix RLS convention, the empty-
     description fallback). `jest.config.js`'s `testMatch` gained
     `src/deductions/**/*.test.ts` (a new source directory, previously
     unlisted — same class of gap this codebase has hit for `analytics`/
     `launch`/`onboarding` before).
  5. **Daily tip diagnostic — AUDITED, reachability CONFIRMED, no fix
     applied** (per the explicit instruction: do not write another
     speculative fix). Traced the full render tree in `app/(tabs)/more/
     settings.tsx`: the triple-tap gesture handler
     (`handleDiagnosticsFooterTap`, lines 108-119) and the diagnostics
     panel it reveals (`showDailyTipDiagnostics && (...)`, lines 595-613)
     are both UNCONDITIONALLY reachable — no `__DEV__` gate, no
     `isOwnerAccount()`/`hasFullAccess()` check, no loading-state early
     return anywhere in this component's render path (confirmed by
     grepping for every early `return`/`if` in the file — none of them
     gate the top-level JSX tree). `useDailyTip()` (line 98) and its
     `diagnostics` object are correctly wired to the panel's render
     (`dailyTipDiag.diagnostics.eligibleCount`/`displayedTopic`/
     `entries`, lines 599-611) — confirmed not stale/orphaned. The gesture
     itself (a 1500ms rolling tap-time window, 3 taps required) has no
     apparent silent-failure mode. **This code is already live** — it
     shipped in commit `1993783`, the immediately-preceding pass in this
     same session — so no new fix was needed or made. **Exact steps for
     the user**: open Settings (Menu → Settings) → scroll to the very
     bottom → triple-tap the small gray build-info text line (app
     version / EAS update id / commit hash) within about 1.5 seconds →
     an orange-bordered "🛠️ Daily Tip Diagnostics" card appears directly
     above that line, showing "N of M topics eligible, showing
     '<topic>', last shown <date>" plus a per-topic
     precondition_not_met/silenced/cooldown/eligible breakdown. If this
     genuinely doesn't appear on the real device after confirming the
     latest `eas update` has landed and the app was fully restarted, the
     next diagnostic step is pasting the exact on-screen output here (per
     the user's own stated plan) — there is nothing further to fix
     blind.
  6. **Multi-file import order — base lists confirmed correct, batch
     review queue found broken and fixed**. `entityHooks.ts`'s
     `ORDER_COLUMN` map (Settlements→`week_ending`, Loads→`load_date`,
     Deductions→`ded_date`, Fuel→`purchase_date`, Maintenance→
     `service_date`, Tolls→`toll_date`, Documents→`imported_at`) is
     applied via `.order(orderColumn, {ascending:false, nullsFirst:false})`
     on EVERY `useEntityList()` call, confirmed still correctly wired for
     all 7 — these lists are already immune to processing/finish order by
     construction, re-verified rather than assumed (`entityHooks.test.ts`
     already covers this).
     **The real gap**: `app/(tabs)/import/jobs.tsx`'s `handleReviewAll()`
     built its `reviewJobIds` queue straight from `readyJobs` — itself
     `sortImportJobsForDisplay()`'s own output, ordered by job CREATION
     time (when each upload/job was STARTED), not by the underlying
     document's own extracted date. With bounded concurrency, a job
     started 3rd can finish (and become `'ready'`) 1st — start-time order
     and true chronological order routinely disagree, exactly the
     reported symptom. Fixed with a new pure sorter,
     `src/import/importJobs.ts`'s `sortJobIdsByDocumentDate()` (descending
     by date, a row with no resolvable date sorts LAST, never first —
     never let an unknown date masquerade as "most recent"). `handleReviewAll()`
     is now async: it fetches every READY job's own extracted date
     (`fetchImportJobResult()`, one read per already-completed job — cheap,
     bounded, never touches a still-queued/processing job, which has no
     result yet) via `getPrimaryExtractionDate()` (the same settlement-
     weekEnding-aware resolver `duplicateCheck.ts` already uses), sorts,
     THEN navigates — a small loading spinner (`preparingReviewAll`) covers
     the brief async gap.
     Tests: `src/import/__tests__/importJobs.test.ts` gained
     `sortJobIdsByDocumentDate` coverage — the LITERAL reported scenario
     (processing order week3→week1→week2, asserted review order
     week3→week2→week1 regardless), immunity to every permutation of
     finish order for the same 3 entries (proving the sort output can
     never depend on completion order at all, not just for one lucky
     ordering), the no-resolvable-date-sorts-last rule, non-mutation of
     the input, and the empty-input case.
  Every item above ships via a normal `eas update` — no native rebuild
  needed (every new dependency used — `expo-image-picker`'s
  `launchCameraAsync`, `expo-document-picker` — was already installed).
  `docs/PENDING_SQL.md` §72 (mirrored as `pending_72.sql` at the repo
  root) is **NOT YET APPLIED** — the client-side removal of every
  balance-touching call ships and is safe regardless of whether §72 has
  been run; §72 itself should be applied promptly since it's what
  actually stops the §70 trigger from moving `business_balance` one more
  time for an old settlement carrying a stale pre-this-pass credit value.
  No Edge Function was touched in this entire six-item pass — no
  redeploy needed for `ai-import`/`ai-advisor`/`reset-data`/
  `delete-account`/`referral-sync`.
  ⤷ [moved 2026-10-13: lines starting "1. **REMOVE BUSINESS BALANCE TRACKING (binding own..." -> docs/decisions/balance-removal.md]
  ⤷ [moved 2026-10-13: lines starting "2. **ONE KPI ENGINE — Profit Analysis found broken..." -> docs/decisions/kpi-consistency.md]

- FOUR MORE DEVICE ISSUES — THE PRIOR FIXES DIDN'T ACTUALLY FIX THEM
  (owner decision, device report: warranty loan still duplicating, balance
  still wrong, daily tip still invisible). No SQL needed for any of the
  four — every fix is pure client-side JS/TS plus one ai-import prompt
  clarification.
  1. **WARRANTY LOAN DUPLICATED ON EVERY IMPORT, ROOT CAUSE CONFIRMED**:
     `aiImportSave.ts`'s loan-upsert loop matched an existing Loan Center
     row via EXACT STRING EQUALITY — `.eq('name', loan.name)` — and the
     settlement schema's own `loans[]` section
     (`supabase/functions/ai-import/index.ts`,
     `{"name":"","balance":0,"payment":0,"frequency":"","nextDue":""}`)
     has no separate lender/original-amount field, so `name` was the ONLY
     identifying value available. The AI's own extracted wording for a
     recurring loan-recap line naturally varies week to week (a trailing
     reference/invoice suffix, punctuation, capitalization) — the exact
     match missed the existing row on nearly every re-import and inserted
     a new one instead, exactly matching the reported symptom (one new
     "duplicate" per import, each individually flagged needs-review by
     the low-confidence machinery since a lone, un-cross-referenced loan
     recap line reads as low-confidence). Fixed two ways, together:
     (a) new `app/src/import/loanMatch.ts` — `normalizeLoanKey()` (the
     same normalize-then-match approach `categoryLearning.ts`'s
     `normalizeKeyword()` already uses for exactly this "same vendor,
     slightly different text every time" problem, tuned with a 6-token
     budget for a loan's own longer name/lender text) and
     `findMatchingLoan()` — normalized-name equality/containment, with a
     conservative guard (a same-named candidate is rejected if BOTH sides
     have a real balance and they differ by more than 6x, and if BOTH
     sides have a recorded lender that disagrees) so a same-named-but-
     wildly-different-amount pair (e.g. a $500/week warranty repayment
     vs. a $58,000 truck loan that happens to share a word) is never
     silently merged. `aiImportSave.ts`'s loop now fetches every existing
     loan ONCE (not per-line) and matches via this function; a newly-
     inserted loan is pushed into the local candidate list so two
     loans[] lines in the SAME settlement that both normalize to the
     same key merge into one row instead of both inserting. (b) a new
     `ai-import` prompt APPROVED ADDITION: `loans[]` must ONLY be
     populated from a genuine, DEDICATED loan/financing recap section —
     never synthesized merely because a `deductions[]` line looks like a
     repayment (the "ADVANCE — EXT WARRANTY" line already belongs ONLY in
     `deductions[]` with category "Advance Repayment," as the existing
     prompt text already said — this addition explicitly forbids ALSO
     mirroring it into `loans[]`), and `loans[].name` must stay STABLE
     across weeks (no invoice numbers, reference IDs, dates, or check
     numbers) since the app matches this loan to the same Loan Center row
     by name across every settlement. **AUDIT — no other recurring
     settlement line has this shape**: `loans[]` is the ONLY array in the
     settlement schema representing a standing, repeatedly-re-extracted
     obligation matched by name across imports; `assets`/`operating` are
     singular per-settlement snapshot objects, never upserted against a
     named standing entity, so they carry no equivalent duplication risk.
  2. **WARRANTY REPAYMENT — CONFIRMED ALREADY CORRECT, NOT DOUBLE-
     COUNTED**: verified by reading the actual classification/exclusion
     code, not assumed. `category.ts`'s `classifySettlementLine()`
     (line ~436-439) checks `isGenericAdvance()` BEFORE
     `isWarrantyService()` — "ADVANCE — EXT WARRANTY" matches the generic-
     advance rule first and resolves to category "Advance Repayment,"
     never "Warranty & Service Contracts" (that category is reserved for
     the ORIGINAL one-time purchase line, a real deductible expense,
     documented in the file's own ORDER MATTERS comment). "Advance
     Repayment" is in both `NON_DEDUCTIBLE_CATEGORIES` (category.ts:110)
     and `trueProfit.ts`'s `TRUE_PROFIT_EXCLUDED_CATEGORIES` (line 68) —
     it never reduces true profit or appears in the Accountant Package's
     out-of-pocket deductible view. `mapSettlement()` also stamps
     `tax_deductible: false` unconditionally on every withheld deduction
     row (invariant #1's defense-in-depth). Separately confirmed the
     loan's own `balance`/`payment` fields are NEVER read by any true-
     profit/CPM calculation — `calcCanonicalCpm()`'s fixed-cost estimate
     comes from `truckCostBasis.ts`'s `calcTruckCostBasisWeekly()`, which
     reads the truck's own manually-set `cost_basis_loan_monthly_payment`
     column, never derived from any `loans` table row (CLAUDE.md's own
     TRUCK COST BASIS entry: "never a synthetic loan estimate"). So the
     warranty amount appears exactly ONCE as a real expense (the withheld
     deduction, correctly excluded from true profit) and the loan's
     balance/payment fields exist purely for Loan Center's own display,
     with zero path into any profit/tax/CPM figure.
  3. **BUSINESS BALANCE $61,897 WITH ZERO SETTLEMENTS — WRITE-SITE AUDIT
     + WHY VERIFY BALANCE MUST EXPLAIN THIS**: `reconcileBusinessBalance()`
     (`businessBalanceLedger.ts`) can only ever reconstruct the expected
     balance from CURRENTLY EXISTING rows — every settlement's own
     `business_balance_credit` plus every currently-existing
     `capital_transactions` row's own `business_balance_applied`. With
     zero settlements on file, a real $60,000 contribution and a real
     $5,000 draw reconstruct to exactly $55,000 (verified directly by a
     new test using these exact numbers) — a stored $61,897 is a $6,897
     drift with structurally NO possible explanation from the ledger
     alone, which IS the diagnostic signal: something moved the balance
     before the row(s) that could explain it still existed, or through a
     path the ledger was never designed to see. Full write-site audit
     (grepped `business_balance` across `app/src` and
     `supabase/functions`, not assumed): (a)
     `apply_settlement_business_balance_credit` RPC — settlement import/
     re-import, atomic, re-reads current state under lock (§60); (b) the
     §70 `AFTER DELETE` trigger — settlement delete, reverses the exact
     credit; (c) `record_manual_capital_transaction`/
     `update_manual_capital_transaction`/`delete_manual_capital_transaction`
     RPCs — manual draws/contributions, atomic (§60); (d)
     `useUpdateBusinessBalance()` (`capitalAccount.ts:74`) — confirmed
     TRULY DEAD, zero call sites anywhere in the app beyond its own
     definition (grepped); (e) `reset-data` Edge Function — resets to
     exactly `0` on a full account reset, not a source of "extra" drift;
     (f) a GENUINE ADDITIONAL WRITE PATH found during this audit,
     NOT previously catalogued: `legacyImport/importLegacyBackup.ts`'s
     `updateBusinessBalance()` (line 730-736) sets `business_balance`
     DIRECTLY from the legacy backup JSON's own `bizBalance` field via a
     plain `.update()` — completely bypassing the RPC/ledger system, with
     no settlement or capital_transactions row left behind to explain it.
     This is the single most plausible explanation for a drift with zero
     current settlements: a one-time legacy-backup restore, at any point
     in the account's history, could have set this value directly, and
     `reconcileBusinessBalance()` — by design, reconstructing only from
     rows that still exist — has no way to see that write after the fact.
     **Fix — Verify Balance now explains itself instead of showing a bare
     mismatch**: Capital Account's Verify Balance sheet
     (`capital-account.tsx`) now shows a plain-language explanation
     whenever a mismatch is found — a settlement-count-zero-specific
     message naming BOTH plausible causes (a settlement deleted before
     §70's automatic correction existed, or a legacy backup restore that
     set the value directly) when `reconciliation.settlementCount === 0`,
     a more general version otherwise — plus a direct "🏦 Reconcile
     Balance" button that closes Verify Balance and opens the existing
     Reconcile Balance sheet in one tap, rather than leaving the user to
     find it themselves. **The actual $61,897 correction still has to
     happen on the user's own device** (this environment has no
     production database access to do it remotely) — opening Verify
     Balance will now show the real current numbers and the explanation
     above; Reconcile Balance corrects it to the real value with one
     recorded, reversible equity entry (never a silent overwrite, §60's
     existing atomic mechanism). Going forward, this cannot recur through
     any of the FOUR atomic mechanisms above — only a future legacy-
     backup restore (an explicit, rare, user-initiated action, unchanged
     by this pass) could bypass the ledger again, and it would now be
     immediately visible and explained the next time Verify Balance is
     opened, rather than silently invisible.
  4. **DAILY TIP DIAGNOSTIC — NOW REACHABLE IN A SHIPPED BUILD**: the
     prior pass's panel was gated on `__DEV__` (React Native's own
     global, always `false` in a real EAS build) — invisible on the
     user's actual device by construction, not a bug in the diagnostics
     themselves. Fixed by making the SAME panel reachable in ANY build
     type: a triple-tap (within 1.5s) on the build-info footer line at
     the bottom of Settings — the same production-debugging pattern
     CLAUDE.md's own (now-deleted) CUSTOMIZE DASHBOARD DIAGNOSTICS entry
     established, reimplemented inline here since that screen's own
     shared component no longer exists (removed in DASHBOARD
     SIMPLIFICATION) — toggles a `showDailyTipDiagnostics` state that
     reveals the panel regardless of `__DEV__`. The panel itself now also
     shows the FULL per-topic breakdown (`useDailyTip()`'s
     `diagnostics.entries`, every topic tagged
     precondition_not_met/silenced/cooldown/eligible — previously only
     the summary counts were exposed from the hook, not the per-topic
     list), so "what blocked it if none [were eligible]" is answerable
     directly on the device, not just the eligible/considered/shown
     summary line. The existing `__DEV__`-gated `console.log` inside
     `useDailyTip()` itself is unchanged (harmless, additive) — only the
     Settings-side visibility gate changed, from `__DEV__` to the tap
     gesture.
  5. **DATA CLEANUP — DUPLICATE WARRANTY LOANS TOOL**: `orphanCleanup.ts`
     gained a new, SEPARATE section from the pre-existing informational-
     only `settlementSourcedLoans` list — `duplicateLoanGroups`, built via
     `loanMatch.ts`'s new `findDuplicateLoanGroups()` (the SAME normalized-
     name grouping the fixed upsert now matches on, applied to every loan
     on the account regardless of source, so a group here is exactly what
     the fix would now treat as "the same loan" going forward). Each
     group is sorted so the RECOMMENDED row to keep is first — a real,
     nonzero balance beats a null one (it's actually been updated by a
     real recap line), tie-broken by earliest `created_at` (the
     original) — shown in the Data Cleanup screen
     (`app/(tabs)/more/data-cleanup.tsx`) with a green "✓ Recommended:
     keep this one" label, per-row checkboxes, and a new
     `useDeleteDuplicateLoans()` bulk-delete mutation (same confirm-then-
     remove pattern as the tolls/maintenance sections above it) — a real,
     standing-obligation table, so nothing here is auto-selected or auto-
     merged; the user reviews and chooses. GUIDANCE FOR THE USER, stated
     honestly since this environment has no access to the real account's
     data: the recommended-keep heuristic (most complete balance, then
     oldest) is a reasonable DEFAULT for a typical case, but the actual
     Loan Center list should be checked against it before deleting
     anything — if a MORE RECENT duplicate happens to carry a more
     accurate/complete balance than an older "original," the tool's own
     sort already surfaces that one first, but the user's own judgment
     about which balance figure is actually correct should win regardless
     of which row the tool recommends.
  Tests: `app/src/import/__tests__/loanMatch.test.ts` (new, 11 tests) —
  `normalizeLoanKey()`'s tokenization/stopword/reference-suffix-stripping;
  `findMatchingLoan()`'s exact/fuzzy-name match, the wildly-different-
  balance rejection, the disagreeing-lender rejection, the agreeing-lender
  match, and the no-name-at-all guard; `findDuplicateLoanGroups()`'s
  grouping + singleton exclusion.
  `app/src/data/__tests__/aiImportSave.loanDedupe.test.ts` (new, 6 tests,
  against the REAL `saveExtraction()` and an in-memory fake Supabase
  client) — the literal requested proof: three settlements with
  progressively different warranty-loan wording resolve to ONE loan row
  with the balance updated to the latest figure; a same-named-but-wildly-
  different-balance line is NOT merged (2 loans, not 1); two loans[]
  lines in the same settlement that normalize to the same key merge into
  one row; a same-week re-import updates rather than duplicates; the
  withheld deduction resolves to non-deductible "Advance Repayment" (not
  "Warranty & Service Contracts"); true profit correctly excludes the
  advance-repayment amount regardless of the loan's own balance.
  `app/src/stats/__tests__/businessBalanceLedger.test.ts` gained the
  exact reported-numbers regression (zero settlements + $60k contribution
  + $5k draw reconstructs to exactly $55,000; the same data against a
  stored $61,897 surfaces a $6,897 drift with `settlementCount: 0` and
  `settlementsTotal: 0` — the literal "unattributable to anything
  currently on file" signal). Full suite: 127 suites / 3,494 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (glossary test
  re-passed clean — "settlement" kept in Latin script in every locale's
  new Verify Balance explanation strings). `supabase/functions/ai-import/
  index.ts` was modified (the new loans[]-is-a-recap-field prompt
  addition) and **needs redeploying**; `ai-advisor`/`reset-data`/
  `delete-account`/`referral-sync` were NOT touched. No new
  `docs/PENDING_SQL.md` section was needed — every fix in this pass reads/
  writes columns that already exist (`loans.lender`/`original_amount`
  have existed since the original Loan Center schema; nothing new was
  added to `profiles`/`capital_transactions`). No new native dependency —
  pure JS/TS plus one Edge Function prompt edit — ships via a normal
  `eas update` once `ai-import` has been redeployed.

- FOUR DEVICE ISSUES AFTER THE LATEST BUILD (owner decision, no SQL for
  any of the four). Diagnosed and fixed in the order reported.
  1. **BUSINESS BALANCE OVERCOUNTING, root cause found and reconstructed
     from the real ledger**: audited every write site
     (`aiImportSave.ts`'s `apply_settlement_business_balance_credit`
     RPC, §70's `AFTER DELETE` trigger, §60's manual capital-transaction
     RPCs, and every personally-paid-expense path) and confirmed the
     settlement-import/delete mechanism is genuinely single-source (the
     RPC re-reads `business_balance_credit` fresh under a row lock and
     applies only the delta; the trigger only ever fires on a real
     delete; personally-paid expenses still never touch it — reconfirmed,
     not just assumed). The ACTUAL bug: Capital Account's own
     draw/contribution/edit/reconcile handlers guarded ONLY with React
     state (`savingDraw`/`savingContribution`/etc., checked via a
     button's `disabled` prop) — a real gap, since a fast double-tap (or
     a tap firing again before the next render) can pass that check
     twice before either state update has applied. Unlike the settlement
     RPC, `record_manual_capital_transaction()`/
     `update_manual_capital_transaction()` apply a REAL new delta on
     every call — nothing stopped a double-submitted contribution or
     Reconcile action from applying twice, which is exactly the ~$5,741
     excess on top of the earlier known drift. Fixed with one shared
     synchronous `savingRef` guard across all four handlers (same
     check-and-set pattern the import screen's own `savingRef` already
     used) — closes the gap a React-state-only guard structurally can't.
     **`src/stats/businessBalanceLedger.ts`'s `reconcileBusinessBalance()`**
     (new, pure, tested) reconstructs the EXPECTED balance entirely from
     data the app already has (every currently-existing settlement's own
     `business_balance_credit` + every manual `capital_transactions`
     row's own `business_balance_applied`) and compares it to what's
     stored — "reconstruct it from the ledger and show me the
     arithmetic," without needing direct database access. Capital
     Account now shows a proactive ⚠️ drift warning the instant the two
     disagree, plus a "🔍 Verify Balance" action opening a breakdown
     (settlements total / manual total / expected / stored / match or
     mismatch amount) — the exact arithmetic, in-app. `docs/
     ADMIN_RUNBOOK.md` gained a matching SQL recipe (same reconciliation
     formula, so the two can never disagree) to spot-check drift across
     every account, excluding the owner/dev account by default.
     **Test** (the literal requested one): `aiImportSave.settlement.test.ts`
     gained "import, RETRY the identical import, then delete — balance
     returns to EXACTLY its prior value, never double-credited" — proven
     against the REAL `saveExtraction()` (a retry's delta is
     `newCredit - previousCredit = 0`, since the credit is unchanged)
     and the REAL delete path (fakeSupabase.ts's trigger simulation).
  2. **DAILY TIP NEVER RENDERS, root cause confirmed by tracing the exact
     empty-account path**: the component IS correctly mounted
     (`app/(tabs)/index.tsx`'s `AiCoachSection`, gated only on
     `aiCoach.isLoading`, which resolves normally for an empty account —
     confirmed no query hangs forever, every one of the ~20 queries
     `useDailyTip()`'s own `queriesLoading` ORs together uses `enabled:
     !!userId` + this app's global `retry: 1`, so none can stay
     `isLoading: true` indefinitely). Five real, evergreen candidates DO
     exist for a truly empty account with zero settlements/trucks
     (`tipMaintenance`/`tipAssetRegister`/`tipDocumentsRenewals`/
     `tipDrivers`/`tipTruckHealth` — each fires on zero data alone,
     confirmed by evaluating every one of the ~40 detectors by hand
     against an all-zero `candidateInput`). The ACTUAL blocker:
     `selectDailyTip()`'s own `SIGNUP_GRACE_MS` check unconditionally
     returned `null` for the first 24 hours after signup — "never on day
     one" — regardless of how many real candidates existed. Since
     onboarding (ToS + tutorial + the setup wizard) already gates entry
     to Home behind several screens, there's no literal mid-signup-flow
     instant left to protect by the time a user ever sees this card —
     removed the check entirely, a deliberate reversal of the original
     design decision per this pass's own explicit, overriding
     instruction ("an empty account must still get getting-started
     tips — that's the most important case").
     **Diagnostics, so this can't be invisible again**:
     `buildDailyTipDiagnostics()` (new, pure, tested) reports, for EVERY
     topic in the system, one of `precondition_not_met`/`silenced`/
     `cooldown`/`eligible` — read by both `useDailyTip()`'s own dev-only
     (`__DEV__`) console log and a new dev-only diagnostic card in
     Settings ("N of M topics eligible, showing X, last shown Y"),
     so the two surfaces can never disagree.
     **Test** (the literal requested one): `dailyTips.test.ts` gained "an
     EMPTY account (zero settlements, zero trucks, day 0) sees a real
     tip on first launch" — built from the REAL `buildDailyTipCandidates()`
     with every field genuinely zero, fed through the REAL
     `selectDailyTip()`, asserting a non-null result.
  3. **SPLASH WORDMARK STILL TOO SMALL, measured, root-caused, and fixed
     for real this time**: measuring the PRIOR pass's own "fix" (a
     height-driven fontSize formula) with a real pixel bounding-box scan
     of the rendered PNG proved it was never actually applied — the
     function's own width-overflow safety clamp was silently shrinking
     the computed ~200px fontSize back down to ~64px, because "BOZKA
     TRUCKING AI" (18 characters) cannot fit at anywhere near that height
     on one line within a 1024px canvas, at ANY letter-spacing or weight.
     This is a hard mathematical ceiling for a single line at this
     string length, not a tunable ratio. **The fix: wrap onto two lines**
     — "BOZKA" (matching `brand.ts`'s own `BRAND_SHORT_NAME`) / "TRUCKING
     AI," the split that minimizes the WIDER line's own character-
     weighted width (computed directly for all 3 reasonable splits, not
     assumed — this one wins by a wide margin) — which lets the solved
     fontSize itself grow from ~64px to ~105px, nearly double.
     **Measured, not assumed, before committing**: the rendered text
     line height grew from 51px (5.0% of canvas height) to 79px (7.7%),
     with the wider line spanning 92.3% of canvas width — composited over
     the real `#08080c` background at the exact requested 1080×1920
     phone frame and visually confirmed before committing. Only
     `splash-icon.png` changed (confirmed via `git status` after
     regenerating every asset) — `icon.png`/favicon/Android adaptive
     layers/store assets are untouched, matching every prior pass's own
     "splash-only" scope.
  4. **LOAN CENTER NONSENSE FIGURES, two independent causes, both
     addressed**: (a) audited the mapping code and the screen's own
     aggregate math and found BOTH correct — the likely cause is a bad
     VALUE at the source, either an AI misread of an ambiguous
     settlement loan-recap table or a manual-entry typo, not a bug in
     how this app reads/sums the fields. `supabase/functions/ai-import/
     index.ts`'s extraction prompt gained an explicit clarification:
     `loans[].balance` is the loan's remaining/outstanding balance (a
     large, tens-of-thousands figure); `loans[].payment` is ONLY the
     recurring PERIODIC payment for one pay period (a small, few-
     hundred-to-low-thousands figure) — never the balance, the original
     loan amount, or a cumulative total; when genuinely ambiguous which
     printed figure is which, the model is told to leave `payment` at 0
     rather than guess, since a wrong `0` is far less misleading than a
     payment that looks like it pays off the whole loan at once. (b) a
     real, permanent backstop regardless of source:
     `src/stats/loanSanity.ts`'s `isImplausibleLoanPayment()` (new, pure,
     tested) — "a monthly payment greater than 10% of the loan balance is
     implausible," the user's own explicit rule taken literally, since a
     normal amortizing truck loan pays off over 3-7 years. A flagged
     row shows a ⚠️ warning on its own card (real value, never hidden)
     and is EXCLUDED from the screen's own "Est. Monthly Payments" total
     (never silently folded in as fact) — with a note naming how many
     rows and how much was excluded, so nothing just quietly vanishes
     from the total either. Edit/delete for every loan field (name,
     lender, original amount, balance, payment, frequency, APR, next
     due) already existed on this screen before this pass — confirmed,
     not rebuilt.
  Tests: `businessBalanceLedger.test.ts` (new, 6 tests — matches when
  the ledger reconciles, surfaces a nonzero drift plainly using the
  exact reported-shape numbers, negative-net-pay/deleted-settlement/
  floating-point-rounding cases, zero-row rows never counted).
  `loanSanity.test.ts` (new, 11 tests — the weekly/biweekly/monthly
  conversion, the exact reported ratio flagged true, a normal ratio
  flagged false, the 10% boundary is strictly-greater-than not
  greater-or-equal, zero/negative balance or payment never flags).
  `dailyTips.test.ts` gained 7 new tests (the grace-period removal, the
  literal empty-account scenario, and a full `buildDailyTipDiagnostics()`
  block covering all 4 reasons). `aiImportSave.settlement.test.ts`
  gained the retry+delete test described above. Full suite: 125 suites
  / 3,463 tests pass; `tsc --noEmit` clean; all 7 locales confirmed at
  full key-parity (a recursive key-set diff against en.json — 0
  missing/0 extra in every one of es/ru/tr/hi/ar/uk).
  `supabase/functions/ai-import/index.ts` was modified (item 4's
  extraction-prompt clarification) and **needs redeploying**;
  `ai-advisor`/`reset-data`/`delete-account`/`referral-sync` were NOT
  touched. No SQL/PENDING_SQL changes for any of the four items — every
  fix is pure client-side JS/TS plus the one Edge Function prompt edit.
  Item 3 (the splash PNG) needs a fresh EAS BUILD, same standing
  limitation every prior splash-asset pass has had — items 1, 2, and 4
  ship via a normal `eas update` alone.

- LAUNCH EXPERIENCE — BIGGER WORDMARK + ANIMATED BRAND INTRO (owner
  decision, no SQL). Two parts.
  1. **NATIVE SPLASH, round 2 — the real cause of "still too small"**:
     `generateBrandAssets.js`'s `composeSplashWithWordmarkSvg()` already
     sized the wordmark to ~96% of the MARK's own width (the previous
     pass's fix) — the remaining problem was that the mark itself was
     only ever sized to `ICON_WIDTH_FRACTION = 0.62` of the 1024×1024
     canvas, a fraction tuned for an APP-ICON safe zone (so an OS
     icon-mask never clips it) that has no bearing on a splash screen,
     which `expo-splash-screen`'s `resizeMode: "contain"` displays
     un-cropped. With ~20% of the canvas sitting empty on every side and
     "contain" scaling the WHOLE 1024×1024 image (padding included) to
     fit the device width, all that invisible margin was silently
     shrinking the visible content along with it. New
     `SPLASH_WIDTH_FRACTION = 0.86` (splash-only, `icon.png`/favicon/
     Android adaptive layers/store assets untouched — confirmed via `git
     status` after regenerating everything, only `splash-icon.png`
     changed) shrinks that wasted margin to ~7% per side, which is what
     actually makes the mark+wordmark noticeably bigger on a real device
     — not a further change to the already-correct text-to-mark ratio.
     Also: heavier weight (900, was 800) and GENEROUS letter-spacing
     again (0.18, up from the immediately-prior pass's deliberately-
     tightened 0.1 — a fresh, explicit owner ask that supersedes that
     earlier choice) and more separation from the mark (gap 0.11, was
     0.09), all per this pass's own literal wording. **Verified before
     committing**: composited the regenerated `splash-icon.png` over the
     real `#08080c` background at a phone-portrait (1080×2340) and a
     tablet-portrait (1600×2560) canvas using `resizeMode:"contain"`
     semantics, viewed both — wordmark reads clearly bold at both scales,
     clear separation from the mark, no clipping.
  2. **ANIMATED BRAND INTRO**: a short (~1.5s, within the requested
     1.2-1.8s), cold-start-only sequence on the app's own first JS
     screen. `src/launch/launchIntroGate.ts` (pure, tested) —
     `shouldShowLaunchIntro()` — and `src/launch/launchIntro.ts` (the
     untested, native-calling orchestrator; same "no jest-expo/RN
     runtime in this repo's plain-Node ts-jest setup" split this
     codebase already uses for `buildInfo.ts`/`buildInfoFormat.ts`) —
     `checkShouldShowLaunchIntro()`. **Cold-start-only, not "once ever"
     and not AsyncStorage-backed**: a plain module-level `let
     hasCheckedThisProcess` — correct BY CONSTRUCTION, since it resets to
     `false` only when the JS engine/module registry is torn down and
     re-evaluated from scratch, which happens exactly on a real cold
     start (the OS actually killing and relaunching the process), never
     on backgrounding/foregrounding. **Deep-link/notification skip**:
     `Linking.getInitialURL()` + (defensively capability-checked, same
     convention as `importJobNotifications.ts`)
     `Notifications.getLastNotificationResponseAsync()`, both resolved
     before the decision is made — either signal present means "the user
     is going somewhere specific," skip entirely. **Reduced motion is
     NOT a gating condition** — it changes HOW the intro animates (fade
     only, no scale/translateY, same overall stage timing either way),
     never WHETHER it shows; handled inside `LaunchIntroOverlay.tsx` via
     reanimated 4's own `useReducedMotion()` (available since 3.5, no new
     dependency — this app already had `react-native-reanimated` as a
     dependency with ZERO actual usages anywhere before this pass, and
     `babel-preset-expo` already auto-injects the worklets plugin per
     this repo's own `babel.config.js` header comment, so no build config
     changed either).
     **HANDOFF CONTINUITY, an explicit, stated design call**: the native
     splash is a STATIC image (mark + wordmark already both fully
     visible together) — there's no way for a static PNG to stage a
     reveal, so "the wordmark rises beneath [the mark] with a soft fade"
     and "the starting frame matches the native splash exactly" are in
     real tension when taken fully literally together. Resolved the way
     real apps commonly do: the MARK stays visually continuous across the
     handoff (starts already mostly opaque/full-size — opacity 0.6→1,
     scale 0.94→1 — a subtle settle, not a hard pop; background color and
     mark position/size never change, so there's no color flash and no
     jump), while the WORDMARK and TAGLINE (which the static splash has
     no equivalent staged-reveal mechanism for) perform the actual
     staged entrance — a deliberate "replay" flourish that reads as
     intentional motion specifically because the background/position
     never move under it, documented plainly in the component's own
     header comment rather than silently glossed over.
     **Sequence** (`LaunchIntroOverlay.tsx`, reanimated `useSharedValue`/
     `useAnimatedStyle`/`withTiming`/`withDelay`): mark fade+scale-in
     (0-460ms) → wordmark rises+fades in (200-600ms, `translateY 14→0`
     skipped under reduced motion) → tagline fades in (520-860ms) → hold
     → whole block eases out (opacity 1→0 + a gentle 1→1.03 scale release
     under normal motion, fade-only under reduced motion) from 1100ms to
     1500ms — `onFinish` fires via `runOnJS` off the LAST animation's
     completion callback, exactly once.
     **Wiring** (`app/_layout.tsx`'s `RootLayoutNav`): the overlay is
     rendered as a SIBLING on top of the already-mounted `<Stack>` (never
     in place of it) — this is what lets the EXISTING redirect effect
     keep working completely unchanged: by the time the overlay's ~1.5s
     animation finishes and fades away, the real destination screen
     (sign-in, tabs, wherever `resolveRootRedirect()` sent the user) is
     already rendered underneath, so there's no blank/loading flash at
     the reveal. `SplashScreen.hideAsync()` now also waits on the intro
     decision (in addition to the existing `loading` gate) — this is
     what makes the native-splash-to-overlay handoff itself seamless:
     whichever comes next (the overlay, or the real app directly when
     skipped) is already known and ready to render the instant the
     native splash disappears.
     **Also wired into the SAME `RootLayoutNav`, no extra plumbing
     needed**: this pass's own earlier USAGE ANALYTICS entry's screen-
     open observer already lives here — confirmed the two features don't
     interfere (the analytics observer only fires once `!loading &&
     session`, independent of the intro overlay's own mount state, and
     the overlay sits visually on top without blocking the observer's
     `usePathname()` tracking underneath).
  Tests: `src/launch/__tests__/launchIntroGate.test.ts` (new, 6 tests) —
  every branch of `shouldShowLaunchIntro()` (shows on a clean cold start;
  never again once this process already decided, even if the other two
  signals would otherwise allow it; skips on a deep link; skips on a
  notification; skips when both are present). The animation
  component/orchestrator itself (native Linking/Notifications calls,
  reanimated worklets) is not independently unit-tested — same standing
  "no React Native rendering harness in this repo" limitation every
  other hook/animation-heavy feature in this codebase has flagged
  honestly. `jest.config.js`'s `testMatch` gained
  `src/launch/**/*.test.ts` (a new source directory, previously
  unlisted — same class of gap the `analytics`/`onboarding` directories
  once hit). Full suite: 123 suites / 3,426 tests pass; `tsc --noEmit`
  clean. No i18n changes — `BRAND_NAME`/`BRAND_TAGLINE` are reused,
  never-translated brand-voice constants (CLAUDE.md invariant #11's own
  "brand voice stays English regardless of locale" carve-out), no new
  user-facing string was added.
  **What needs a NEW EAS BUILD vs. what ships via `eas update`, stated
  plainly (item 3's own explicit ask)**: `splash-icon.png` is a
  NATIVE-level asset baked into the compiled binary at build time via
  `app.config.js`'s `expo-splash-screen` plugin config (unchanged this
  pass) — an OTA `eas update` CANNOT touch it; only a fresh EAS Build
  re-bundles the new PNG, same standing limitation this codebase's own
  APP ICON + SPLASH entry already documented for the very first splash
  asset. The ENTIRE animated intro (the gating logic, the reanimated
  sequence, the `_layout.tsx` wiring) is pure JS/TS with no new native
  dependency (`react-native-reanimated` was already installed and
  already had its babel plugin wired) — ships via a normal `eas update`
  alone, no rebuild needed for that half. Until a fresh build actually
  ships, users will see the OLD (smaller) native splash handing off into
  the NEW animated intro — a real, temporary mismatch in relative sizing
  between the two, unavoidable until both halves are on the same build.

- DAILY TIP — FLASH-AND-VANISH BUG FIX + "SHOW ME ANOTHER" (owner
  decision, no SQL). Two items.
  1. **ROOT CAUSE, confirmed by reading the actual hook**: the daily tip
     card re-derived its pick (`selectDailyTip()`) on every recompute —
     both while OTHER, slower-loading queries (documents, equipment,
     trucks, drivers, loans, compliance, tax config/estimate, capital
     account — the hook only gated on `settlements`/`deductions`/
     `profile`) still held default/zero values a detector could easily
     fire against, AND — the dominant cause — the instant a pick was
     PERSISTED, `isEligible()`'s own 30-day cooldown treats "shown within
     the last 30 days" (which includes TODAY, the moment it's recorded)
     as ineligible, so the very next recompute silently excluded the
     topic it had just shown and swapped in something else, or nothing.
     Fixed two ways: `queriesLoading` now waits for every query the hook
     depends on before computing any candidate; and a NEW
     `findTodaysAnchorTip()` (`src/alerts/dailyTips.ts`) reconstructs an
     ALREADY-shown-today topic directly from persisted state — picking
     the EARLIEST non-silenced entry shown today — instead of ever
     re-deriving it from a live `selectDailyTip()` recompute, so it's
     stable no matter how many times the surrounding data refetches or
     the component re-renders. `src/data/dailyTips.ts`'s `useDailyTip()`
     was rewritten around this: a local `overlay` (the full nudge_state
     as this session currently understands it, optimistic ahead of the
     server round-trip so rapid actions can't race a stale read) plus
     `displayedTopic` state, initialized from the sticky anchor via one
     effect and never re-derived from a live recompute afterward.
  2. **"SHOW ME ANOTHER"**: a subtle link next to Dismiss
     (`dailyTips.showAnother`) advances to the next eligible topic
     immediately, recorded through the exact SAME
     `recordDailyTipShown()`/cooldown mechanism as the automatic daily
     pick — no separate budget or counter, so a manually-viewed topic can
     never repeat today (its own 30-day cooldown already covers it) and
     tomorrow's rotation is affected only by that same standing rule,
     never an extra artificial restriction. Once nothing eligible
     remains, the link is replaced by a warm
     `dailyTips.exhausted` message ("You've read them all — new ones
     appear as your data grows.") instead of looping. Dismiss keeps its
     pre-existing "auto-offer a replacement if one is eligible" behavior,
     now built on the identical record-and-display path.
  Tests: `dailyTips.test.ts` gained 20 new tests — `findTodaysAnchorTip()`
  reconstructs identically across many simulated re-renders and a
  simulated server round-trip (JSON round-trip), survives even though
  `selectDailyTip()` would now exclude the same topic (the literal proof
  of what stops the flash), ignores a prior-day entry and a
  since-dismissed one, and picks the earliest of several same-day entries
  (anchor vs. later advances); "show me another" tests prove each advance
  is genuinely distinct, the exhausted state triggers once every eligible
  topic is shown, and a topic never touched today is still picked
  normally the next day (no day-slot consumed by manual browsing) while
  one that WAS advanced-to correctly stays excluded tomorrow too. Full
  suite: 121 suites / 3,409 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity. No SQL/Edge Function changes — pure
  client-side JS/TS. Ships via a normal `eas update`.

- SETTLEMENT DELETE LEAVES ORPHANS — BALANCE, DERIVED ROWS, DUPLICATE
  DETECTION (owner decision, device-confirmed report — deleting every
  settlement left `business_balance` inflated by $6,897, Loan Center and
  Tolls still showed settlement-sourced rows, and re-importing the same
  file was still flagged a duplicate with Settlements empty).
  docs/PENDING_SQL.md §70 (mirrored as `pending_70.sql` at the repo
  root), **NOT YET APPLIED**.
  AUDIT (item 1) — every record a settlement import creates, and what
  happens today on delete vs. what should:
  1. `profiles.business_balance_credit`(→`profiles.business_balance`) —
     written on save/re-import via the §37/§38
     `apply_settlement_business_balance_credit()` RPC, **never reversed
     anywhere** on delete. SHOULD: reversed atomically. Root cause of bug A.
  2. `loads`/`fuel_purchases`/`reimbursements`/`deductions` (withheld) —
     already `on delete cascade` from `settlements` (confirmed live via a
     read-only PostgREST schema probe). Correct as-is, no bug.
  3. `maintenance_records.settlement_id`/`tolls.settlement_id` — added
     `on delete cascade` by §61, confirmed LIVE. The orphaned rows in the
     device report are near-certainly pre-§61 legacy rows
     (`settlement_id` permanently null, unbackfillable — no record of
     which settlement they came from before the column existed). SHOULD:
     cascade going forward (already true); historical orphans need a
     one-time cleanup tool, not a backfill. Root cause of bug C.
  4. `loans` — **no FK to `settlements` at all, by design**: a loan is
     upserted by name across many settlements over the loan's whole
     life, so it must never cascade-delete with any one of them.
     Genuinely independent once created. SHOULD: never deleted, but
     mark its provenance so a settlement-derived loan is never mistaken
     for a stale manual leftover. Root cause of bug B.
  5. `documents` (the uploaded settlement file + its `parsed_json`) — no
     FK from `settlements.document_id` back to `documents` that cascades
     on settlement delete; `duplicateCheck.ts`'s import-time duplicate
     match reads the `documents` table directly, which a settlement
     delete never touched. SHOULD: cleaned up via the existing
     `cleanupOrphanedDocument()` (re-checks genuine orphan status
     itself) the instant its settlement is gone — Storage file included.
     Root cause of bug D.
  6. `capital_transactions` linked to a withheld deduction — already
     `on delete cascade` via `linked_deduction_id`, which cascades a
     second hop once the deduction itself is cascade-deleted by #2.
     Correct as-is.
  FIX 1 — BALANCE REVERSAL, AN AFTER DELETE TRIGGER (item 2, owner's own
  suggested mechanism, adopted): `reverse_settlement_business_balance_credit()`
  is a `SECURITY DEFINER` trigger function on `settlements`, fired
  `AFTER DELETE FOR EACH ROW` — subtracts `OLD.business_balance_credit`
  from `profiles.business_balance` for `OLD.user_id`. `SECURITY DEFINER`
  over `SECURITY INVOKER` deliberately: the trigger takes no
  caller-supplied parameters to validate (no impersonation risk, unlike
  the existing RPCs' `p_user_id`/`auth.uid()` checks), and it must work
  identically whether the delete came from an authenticated user's own
  session (has `auth.uid()`) or a service-role Edge Function (has none —
  would silently no-op under `SECURITY INVOKER` + an `auth.uid()` guard).
  This is what covers the truck-CASCADE path "at once," per the request's
  own framing: `deleteTruckCompletely()` (`truckDeletion.ts`) issues one
  `delete from trucks`, Postgres cascades every one of that truck's
  settlements internally, entirely inside the database, never through
  app code — a client-side reversal call could never reach that path, but
  the trigger fires for every deleted `settlements` row regardless of
  what triggered the delete.
  FIX 2 — DUPLICATE DETECTION + DOCUMENT/STORAGE CLEANUP (item 3):
  `settlements.tsx`'s delete handler now captures the settlement's own
  `document_id` before deleting it, then calls the existing
  `cleanupOrphanedDocument()` (`deductionMutations.ts` — already used by
  every other per-record delete flow) afterward — it re-checks whether
  anything ELSE still references that document (another settlement,
  deduction, or maintenance record) before removing the row and its
  Storage file, so it's safe even for a shared/duplicate-detected
  document. Once the `documents` row is gone, `duplicateCheck.ts`'s
  match against it correctly finds nothing, and re-importing the same
  file is no longer flagged. A cleanup failure is logged, never blocks
  the settlement delete itself (the balance reversal and cascade have
  already committed by then). Invalidation uses the established
  UNSCOPED sweep (`invalidateFinancialData(queryClient)`, no `entities`
  list) — an earlier draft of this fix enumerated specific entities and
  silently omitted `'profiles'` (needed for the Capital Account/Home
  balance display to reflect the trigger's reversal), caught during this
  same pass; enumerating a precise list here once already missed one
  entity, which is exactly the class of bug the unscoped-sweep
  convention exists to avoid for a wide-reaching action like this.
  FIX 3 — LOAN PROVENANCE (item 4): `loans` gains `settlement_id uuid
  references settlements on delete set null` and `source text not null
  default 'manual' check (source in ('settlement','import','manual'))`.
  `set null`, not cascade — a loan is a real, standing obligation that
  legitimately outlives any one settlement, per the audit above; deleting
  the settlement that first surfaced it must never delete the debt
  itself, only drop the now-stale pointer. `mapSettlement()`'s own loan
  mapping stamps `source: 'settlement'`; `mapLoanAgreement()` (the
  standalone `loan_agreement` docType) stamps `source: 'import'`; every
  other loan (added by hand on the Loan Center screen) defaults to
  `'manual'`. `aiImportSave.ts`'s loan upsert loop now writes
  `settlement_id: settlementId` on both the insert and update branch, so
  a loan's provenance link always points at whichever settlement most
  recently touched it. Loan Center's own `LoanCard` shows a small "📥
  From a settlement" badge (or "📥 From a settlement (since deleted)"
  once its `settlement_id` has gone null via the FK) — never a silent
  leftover, per the request's own framing.
  VERIFICATION (item 5): a personally-paid deduction's
  `capital_transactions` insert (`deductionMutations.ts`'s
  `applyContributionSync()`) has never touched `profiles.business_balance`
  at all — confirmed by re-reading the function (it only ever writes
  `capital_transactions`) and proven directly by a new dedicated test
  (`settlementDeletion.test.ts`'s "personally-paid expenses never touch
  the bank balance" block): inserting a linked contribution for a
  personally-paid deduction leaves `business_balance` byte-identical
  before and after, while the SAME account's settlement-driven balance
  (from a separate, unrelated settlement) is completely unaffected by it
  either direction — the two mechanisms (settlement net-pay crediting
  `business_balance`; personal-payment-paid deductions crediting the
  CONTRIBUTION/tax-free base only) are proven structurally independent,
  not just individually correct.
  RECONCILE ACTION (item 6): Capital Account's old "🏦 Update Business
  Balance" button (a bare, unlabeled overwrite —
  `useUpdateBusinessBalance()`, now explicitly marked DEPRECATED in its
  own header comment and left in place unused, same "harmless deprecated
  function" precedent as `cf_insurance_monthly`) is replaced with "🏦
  Reconcile Balance." `handleReconcileBalance()` computes
  `delta = target − currentlyTracked`, then records it as a normal,
  labeled `capital_transactions` row (`tx_type: delta > 0 ? 'contribution'
  : 'draw'`, `note: "Balance reconciliation — adjusted from $X to $Y"`)
  via the EXISTING atomic `useRecordManualCapitalTransaction()` hook
  (§60's `record_manual_capital_transaction()` RPC — row write + balance
  delta in one transaction, the same pattern this whole pass's own
  balance-reversal trigger mirrors) — never a silent overwrite, always a
  visible, reversible, delete-able row in the equity history like any
  other draw/contribution. The sheet shows "Currently tracked: $X" plus
  a live preview ("Will record a $Y contribution" / "...draw" / "No
  change") before the user commits.
  CLEANUP TOOL (item 7): a new screen, `app/(tabs)/more/data-cleanup.tsx`
  ("🧹 Data Cleanup," wired into `navRegistry.ts`'s Tools group — one
  shared registry edit per the established NAV PARITY convention, and
  into `dailyTips.ts`'s `DAILY_TIP_SCREEN_COVERAGE` map as
  `'intentionalNone'`, same reasoning as the milestone-triggered Referral
  screen: a one-time historical repair tool has nothing to nudge about
  day to day). `src/data/orphanCleanup.ts`'s `fetchOrphanSummary()`
  finds: tolls/maintenance_records with `source='settlement' AND
  settlement_id IS NULL` (structurally impossible to be anything BUT a
  pre-§61 orphan, never a false positive against a real manual/import
  row); documents referenced by nothing (a set-difference against every
  settlement/deduction/maintenance_records `document_id`); and — purely
  informational, per the audit's own "genuinely independent" finding —
  every `loans` row with `source='settlement'`, explicitly never offered
  for deletion here (a real loan is real debt; this list exists so it's
  never mistaken for a leftover, with a link straight to Loan Center for
  anyone who decides one really is stale). The screen shows counts and
  dollar totals per category, lets the user select specific rows, and
  requires an explicit confirm (with the real amount named) before
  removing anything — "let me remove them after review," not an
  automatic sweep.
  TESTS (item 8, all three named scenarios): `fakeSupabase.ts` gained a
  parallel `SET_NULL_RULES` mechanism (mirroring the existing
  `CASCADE_RULES`) and a `reverseSettlementBalanceCredits()` function
  modeling the new trigger, wired into both the direct-delete path and
  `cascadeDelete()`'s truck-cascade path — same "proves the
  CLIENT-VISIBLE deletion shape is correct, not that live Postgres is
  actually configured this way" honest boundary this file's fake
  Supabase harness has always operated under (no Postgres runtime exists
  in this environment). `settlementDeletion.test.ts` (new, 9 tests):
  import → delete reverses `business_balance` to EXACTLY its prior value
  (including a dedicated case for a NEGATIVE net-pay week — the balance
  correctly goes back UP on delete, not down); every derived row
  (loads/fuel/reimbursements/deductions/maintenance/tolls) and the
  document + its Storage file are gone; a `loans` row from that
  settlement survives with `settlement_id` set to null and `source`
  still `'settlement'`; and the personally-paid-expenses independence
  proof described above. `truckDeletion.test.ts` gained a
  `seedTruckWithThreeSettlements()` case proving deleting a truck with 3
  settlements reverses the SUM of all three credits via the cascade path
  alone, with zero truck-deletion-specific balance code — the trigger
  fires per cascaded row automatically.
  DELIVERABLES: 121 suites / 3,397 tests pass; `tsc --noEmit` clean; all
  7 locales confirmed key-parity (a full recursive key-set diff against
  en.json — 0 missing/0 extra in every one of es/ru/tr/hi/ar/uk — run
  directly, since this repo's glossary test only checks glossary-bearing
  keys, not full parity; "settlement" kept in Latin script per the
  glossary in every locale's `dataCleanup.*`/`loans.source*` strings; the
  Arabic "view in Loan Center" link uses `←`, matching this locale's own
  established RTL "link points toward the start" convention, not a
  mechanical mirror of the LTR `→`). `docs/PENDING_SQL.md` §70 is **NOT
  YET APPLIED** — `pending_70.sql` at the repo root has the exact SQL
  (the trigger function + trigger, and the two new `loans` columns +
  check constraint); until it's run, the client code degrades
  gracefully: `business_balance_credit` still gets written on
  save/re-import as before (unchanged behavior), but a settlement delete
  won't reverse it until the trigger exists, and `mapSettlement()`/
  `mapLoanAgreement()` will send `settlement_id`/`source` on every loan
  upsert regardless, which Postgres will reject only if those columns
  are missing entirely (review before running — same "assembled by hand,
  not executed against a live database in this environment" limitation
  every SQL migration in this codebase's history carries). No Edge
  Function was touched this pass — every change is pure client-side
  JS/TS plus this one pending SQL migration; no redeploy needed for
  `ai-import`/`ai-advisor`/`reset-data`/`delete-account`/`referral-sync`.
  Ships via a normal `eas update` once §70 has been run.

- AI COACH — DAILY TIPS COVERING THE WHOLE APP (owner decision, Part 2 of
  the AI Coach "fix stale cache + daily tips" request, docs/PENDING_SQL.md
  §69, NOT YET APPLIED). One tip per day on Home, chosen from whatever the
  account's own setup/data justifies right now, composed entirely client-
  side from i18n templates — **no AI call**, distinct from the weekly
  financial review (Part 3 above), which stays this app's one AI call per
  user per week.
  **STEP 1 — the coverage map was presented and approved before any
  implementation began**, per the request's own explicit gate: a table
  covering all 34 reachable screens in `navRegistry.ts` (36 raw minus 2
  feature-flagged-off — Credit Cards/Bank Statements) plus a "General
  Trucking Knowledge" pool, each marked with its planned tip content and
  precondition, or "intentionally none" with a reason (Home — tips render
  here, would be circular; Invite & Earn — its own milestone-triggered
  mechanism, not part of the daily rotation; Credit Cards/Bank
  Statements — not reachable in the live app today).
  **THE ENGINE, `src/alerts/dailyTips.ts`**: 40 topics (`DailyTipTopic`,
  the 39 approved coverage-map topics — 33 screen-based + 6 general-
  knowledge — plus `tipSettings`, caught missing during implementation and
  added before writing any tests), each with exactly 3 phrasings
  (`dailyTips.<topic>.v0/v1/v2` — benefit-stated / question-framed /
  leads-with-a-real-figure, matching the request's own worked example
  archetypes). Every detector is a pure function taking minimal already-
  fetched row shapes, same convention as `missingDataNudges.ts`/
  `periodicCoachNudges.ts`; a tip's own precondition simply stopping being
  true IS the "disappears entirely once the thing it teaches is done"
  behavior, no separate mechanism needed. **A real content-safety design
  constraint found while writing this**: since `selectDailyTip()` chooses
  a topic's variant BY ROTATION INDEX, not by which figure happens to be
  available that day, a variant can never safely reference a detail field
  (`{{count}}`/`{{days}}`/`{{pct}}`/...) unless EVERY branch of that
  topic's detector guarantees the field is present whenever the topic
  fires at all — audited detector-by-detector; topics with an
  optional/conditional detail field (`tipSettlements`, `tipMaintenance`,
  `tipAccountantPackage`, `tipTaxEstimator`, `tipCapitalAccount`) simply
  never reference that field in any of their 3 variants, avoiding a raw
  unresolved `{{placeholder}}` ever rendering on a day the field happens
  to be absent.
  **ROTATION** (`selectDailyTip()`/`selectDailyTipVariant()`): filters to
  precondition-eligible topics, then to ones not silenced and not shown
  within the last 30 days ("no topic repeats within a month" —
  `DAILY_TIP_COOLDOWN_MS`), then avoids a 3rd consecutive day of the SAME
  category (`setup`/`money`/`discovery`/`knowledge`, generalizing the
  request's own literal "never three tax tips in a row" example) when a
  different-category alternative exists, then picks whichever eligible
  candidate was shown longest ago (or never) — a natural round-robin that,
  combined with the explicit cooldown, guarantees no repeat within a month
  whenever 2+ topics are eligible (proven directly by a 35-simulated-day
  test using this app's real ~35-topic pool, plus a separate small-pool
  test proving the engine correctly returns `null` once every topic is on
  cooldown rather than repeating one early). Variants cycle strictly
  0→1→2→0→... in order, so a topic never repeats a phrasing before the
  other two have been used.
  **PERSISTENCE**: reuses `profiles.nudge_state` — a THIRD disjoint
  topic-key family (every key prefixed `tip`) sharing the same column the
  missing-data (item D) and periodic-coach (item E2) nudge families
  already use, per this app's own established "disjoint key sets, one
  column" precedent. `NudgeStateEntry` (`nudgeFrequency.ts`) gained two
  new optional fields: `variantIndex` (which phrasing was shown last) and
  `dismissCount` (see the referral nudge below) — both simply unused by
  the two original families, no behavior change for them.
  **A real, confirmed bug found and fixed while wiring this in**:
  `recordNudgesShown()`/`silenceNudgeTopic()` used to build a BRAND-NEW
  entry object with only `lastShownAt`/`silencedAt`, silently DROPPING
  `variantIndex`/`dismissCount` if either was already set on that topic —
  the referral-nudge family's own "never after two dismissals" counter
  would have been wiped the very next time that same topic was simply
  shown again. Both functions now preserve every field they don't
  themselves own (`{...next[topic], lastShownAt: ..., silencedAt: ...}`).
  Caught by this pass's own test suite, not shipped broken.
  **`src/data/dailyTips.ts`** (`useDailyTip()`) is the data-fetching half
  — composes real figures from the SAME canonical functions every other
  screen already uses, never a second calculation: `findUnassignedRows()`
  (truck-assignment repair), `calcCurrentYearDepreciation()` (the real
  depreciation preview total), `calcPerDiemDays()` (YTD per-diem days),
  `calcMiles()` (deadhead %), `nextQuarterlyDeadline()`,
  `useCapitalAccountSummary()`, `useTaxEstimate()`'s own
  `estimate.weeklyTaxReserve`. Wired into Home's `AiCoachSection` (a new
  card block below the existing periodic-nudge/unlock-nudge lines, its
  own icon + label + action button + Dismiss), distinct from and
  additional to the existing periodic AI-Coach-voiced nudge.
  **REFERRAL NUDGE, a deliberately SEPARATE mechanism**
  (`src/referral/referralNudge.ts` + `src/data/referralNudge.ts`) — the
  request's own explicit "surface at the RIGHT moments, not randomly,"
  never part of the daily rotation pool. `detectReferralNudge()` fires at
  exactly the 4 named moments, priority-ordered (a qualified referral >
  a goal-beating week > a first Accountant Package export > active 3+
  weeks), reusing the existing `computeReferralProgress()` for the real
  "N of 3" progress line and the existing `selectNudgesToShow()` engine
  for a 14-day cooldown ("once every two weeks"). "After their first
  accountant export" needed a genuinely new signal this app never had —
  `profiles.accountant_package_exported_at` (docs/PENDING_SQL.md §69,
  NOT YET APPLIED), set fire-and-forget right after a successful PDF/
  Excel export. "Never after two dismissals" is a real new mechanism,
  not a reuse of the daily-tip engine's simple silence-on-dismiss:
  `recordReferralNudgeDismissed()` tracks `dismissCount` and only
  silences on the 2nd dismissal — **a second real bug caught by this
  pass's own tests before shipping**: the first version called the
  shared `silenceNudgeTopic()` helper on the silencing branch, which has
  no `dismissCount` parameter of its own — the topic was correctly
  silenced but its own `dismissCount` stayed stuck at 1 instead of 2 (a
  cosmetic-only bug today, since silencing is already terminal, but a
  real latent trap for any future caller that reads the count). Fixed by
  writing the entry directly in `recordReferralNudgeDismissed()` itself
  rather than delegating to a helper that doesn't know about this field.
  On Home, a separate `ReferralNudgeCard` (its own small `Card`, not
  folded into the AI Coach block — this isn't "AI Coach content") shows
  the message, progress, a Share button reusing the EXACT SAME
  `buildReferralShareMessage()`/`shareViaSystemSheet()` pipeline the
  dedicated Invite & Earn screen already uses (so the shared message can
  never disagree between the two surfaces), and a Dismiss link.
  **Tests**: `src/alerts/__tests__/dailyTips.test.ts` (new, 24 tests) —
  a `DAILY_TIP_SCREEN_COVERAGE` completeness check asserting every href
  in `navRegistry.ts`'s `RAW_NAV_GROUPS` has either a real topic or an
  explicit `'intentionalNone'` entry (**the literal "a test FAILS when a
  new screen enters the nav registry without either a tip or an explicit
  entry" requirement**), detector precondition-gating spot checks
  (including the exact "disappears once done" proof — the same
  `buildDailyTipCandidates()` call before/after a precondition stops
  holding), the 35-day rotation proof, the small-pool exhaustion proof,
  variant-cycling, category-alternation (both the "avoids it" and the
  "never blocks entirely when no alternative exists" cases), signup
  grace, and dismiss/silence. `src/referral/__tests__/referralNudge.test.ts`
  (new, 15 tests) — priority order, the "never randomly" day-one/
  recency gating (`hasQualifiedReferralRecently`'s own 14-day window,
  proven to reject a referral that qualified months ago), the 14-day
  cooldown via the shared engine, and the full dismiss-count-then-
  silence lifecycle including the bug fix above. Full suite: 120 suites
  / 3,351 tests pass; `tsc --noEmit` clean; all 7 locales confirmed key-
  parity — 3 general keys + 40 topics × 3 variants + 5 referral-nudge
  keys, es/ru/tr/hi/ar fully translated (glossary terms — per diem, CPM,
  RPM, deadhead, escrow, Schedule C, HVUT/2290, IRP, CDL, DPF, S-Corp —
  kept in Latin script throughout; "settlement" kept English per the
  glossary in every locale that references one), uk as an untranslated
  English copy per its own still-disabled status; glossary test re-
  passed clean (1,554 checks).
  `docs/PENDING_SQL.md` §69 (`profiles.accountant_package_exported_at
  timestamptz`, mirrored as `pending_69.sql` at the repo root) is **NOT
  YET APPLIED** — until it's run, `useReferralNudge()`'s
  `hasExportedAccountantPackage` check simply reads `undefined`/falsy
  (an unknown column), so the "first export" moment never fires but
  nothing breaks; the other 3 referral moments and the entire daily-tips
  feature work standalone regardless. `supabase/functions/reset-data/
  index.ts` was updated (new field in `PROFILE_DATA_RESET`'s CLEARED
  bucket) and **needs redeploying** once §69 has been run;
  `ai-advisor`/`ai-import`/`delete-account`/`referral-sync` were NOT
  touched. No new native dependency — pure client-side JS/TS plus one
  small SQL migration — ships via a normal `eas update`.

- AI COACH — FIX STALE CACHE + WEEKLY REVIEW GAINS CPM (owner decision,
  docs/PENDING_SQL.md §68, NOT YET APPLIED — two parts of a 3-part request;
  the third part, daily tips, is a separate, much larger feature gated on
  a coverage-map review before implementation and is NOT part of this
  entry).
  **PART 1 — STALE CACHE BUG**: device report — every settlement was
  deleted and the AI Coach kept showing the old weekly review, quoting
  dollar figures that no longer existed. Root cause: the cache
  (`ai_weekly_review`/`ai_weekly_review_week_ending`/
  `ai_weekly_review_generated_at`/`ai_weekly_review_locale`) only ever
  tracked WHICH SETTLEMENT WEEK and LOCALE a review covers — never
  whether the underlying FIGURES (revenue, net, RPM, ...) it quotes are
  still what the account's real data currently produces.
  `shouldGenerateWeeklyReview()` correctly declined to regenerate once
  `latestWeekEnding` went null (nothing to review), but nothing ever
  stopped the STALE cached text from being DISPLAYED — a completely
  separate, unguarded code path (`weeklyReviewUsable`, which only ever
  checked locale + script, never data currency).
  **Fix**: `src/stats/weeklyReview.ts` gained
  `computeWeeklyReviewFingerprint(inputs)` — a deterministic digest of
  every figure the prompt/fallback actually quotes (gross, net, rpm,
  trailingAvgRpm, cpm, deadheadPct, fuelPctOfRevenue, chargebacks,
  perDiemDays, ytdProfitBefore/After, settlementCountYtd, goalProgress).
  `isCachedReviewUsable()` now REQUIRES the cached fingerprint to match
  the CURRENT one (computed fresh from whatever `useSettlements()`/
  `useDeductions()`/etc. currently return) before ever showing cached
  text — `currentFingerprint === null` (nothing to review right now) can
  never match any cached fingerprint, which is the literal fix for "I
  deleted every settlement and the coach kept quoting the old numbers."
  `shouldGenerateWeeklyReview()` treats a fingerprint mismatch FOR THE
  SAME WEEK (a correction/edit to data that doesn't change week_ending)
  the same way a locale switch already was — it bypasses the normal
  7-day cooldown and regenerates immediately. **A real design bug was
  caught by this pass's own test suite before it shipped**: since the
  fingerprint includes `weekEnding` itself, a genuinely NEW settlement
  week always produces a different fingerprint too — an early version of
  this fix let ANY fingerprint mismatch bypass the cooldown, which would
  have meant every single new settlement import immediately fired an AI
  call regardless of the "one call per week" cap. Fixed by scoping the
  cooldown-bypass to `sameWeek && !dataUnchanged` specifically — a new
  week still respects the ordinary cooldown (unchanged, established
  behavior); only an edit within the SAME already-reviewed week forces
  an immediate regeneration attempt. This mechanism needed NO changes to
  any settlement/truck/deduction mutation call site — `weeklyReviewInputs`
  (and therefore the fingerprint) is derived live from the exact same
  `useSettlements()`/`useDeductions()`/`useFuelPurchases()`/
  `useMaintenanceRecords()`/`useTolls()` queries every other screen
  already correctly refreshes via the established ONE REFRESH PATH
  `invalidateFinancialData()` convention (confirmed: both the settlement
  delete flow and `deleteTruckCompletely()`'s own caller already issue an
  unscoped `invalidateFinancialData(queryClient)` sweep, and Reset All
  Data already nulls the whole `ai_weekly_review*` cache bucket directly
  server-side). New **empty state**: `useProactiveCoach()` returns
  `weeklyReviewEmpty` (true once loading has settled and there's
  genuinely no settlement to review) — Home now shows
  `ceoMode.weeklyReviewEmpty` ("Nothing to review yet — import a
  settlement and I'll break down your week.") instead of silently
  rendering nothing.
  **PART 3 — WEEKLY REVIEW GAINS CPM**: the prompt/fallback/fingerprint
  were missing Cost Per Mile entirely despite it being one of the KPIs
  explicitly requested — `WeeklyReviewInputs` gained `cpm: number | null`,
  wired in `proactiveCoach.ts` from the SAME account-wide canonical
  `computeKpis()` call (`latestKpi.cpm`) that already fed
  `latestCpm`/`cpmComparisonRpm` for the periodic-nudge engine — never a
  second CPM formula, the literal same figure Scorecard/Home's per-mile
  trio show. New `ceoMode.weeklyReviewFallback.cpm` key deliberately
  spells out "cost per mile" per-language rather than embedding the bare
  glossary token "CPM" (same established precedent as Cash Flow's own
  `avgRpm` string) — no glossary constraint triggered since the term
  isn't literally present in `en.json`'s own string. The review now
  covers every KPI this request asked for: revenue, net, RPM vs trailing
  average, CPM, deadhead %, fuel % of revenue, biggest chargebacks,
  per-diem days, goal progress, and YTD movement — still 2-3 sentences
  plus up to 3 action items, still one `ai-advisor` call per user per
  week at most, unchanged.
  Tests: `weeklyReview.test.ts` gained a `computeWeeklyReviewFingerprint`
  describe block (identical inputs match; a changed gross/net/CPM/YTD/
  chargeback/goal figure each independently changes the digest), a "data
  fingerprint mismatch" describe block under `shouldGenerateWeeklyReview`
  (same-week data change bypasses cooldown; null cached fingerprint
  treated as a mismatch; all-settlements-deleted never regenerates; the
  dedicated regression guard for the "new week's naturally-different
  fingerprint must NOT bypass the cooldown" bug caught mid-pass), 3 new
  `isCachedReviewUsable` cases (the literal delete-all-settlements
  scenario; a same-week data change; a null cached fingerprint), and CPM
  coverage added to the existing prompt/fallback tests. Full suite: 118
  suites / 3,061 tests pass; `tsc --noEmit` clean; all 7 locales
  confirmed key-parity (`ceoMode.weeklyReviewEmpty`/
  `ceoMode.weeklyReviewFallback.cpm` — es/ru/tr/hi/ar fully translated
  keeping "settlement" in Latin script per the glossary, uk as an
  untranslated English copy per its own still-disabled status; glossary
  test re-passed clean). `docs/PENDING_SQL.md` §68
  (`profiles.ai_weekly_review_fingerprint text`, mirrored as
  `pending_68.sql` at the repo root) is **NOT YET APPLIED** — the client
  degrades gracefully until it's run (a `null`/absent column value is
  already treated as "never trust this cache," so the bug fix's own
  logic is unaffected by whether the migration has landed yet; the ONE
  thing that doesn't work pre-migration is caching a NEW fingerprint,
  which simply no-ops as an unknown column write until §68 is applied —
  same graceful-degradation precedent as every other new `profiles`
  column added ahead of its own migration in this codebase's history).
  `supabase/functions/reset-data/index.ts` was updated (new field added
  to `PROFILE_DATA_RESET`'s CLEARED bucket) and **needs redeploying**
  once §68 has been run; `ai-advisor`/`ai-import`/`delete-account`/
  `referral-sync` were NOT touched. No new native dependency — pure
  client-side JS/TS plus one small SQL migration — ships via a normal
  `eas update`.

- TWO ACCOUNTANT PACKAGE BUGS — MONTH FILTER OFF-BY-ONE + OWNER'S EQUITY
  ROW DETAIL (owner decision, no SQL). No native rebuild — pure
  client-side JS/TS, ships via a normal `eas update`.
  1. **MONTH FILTER OFF-BY-ONE, ROOT CAUSE**: `app/(tabs)/more/
     accountant-package.tsx`'s own Month pill row (`monthNames`, line 593
     at the time of the fix) built each button's LABEL via
     `date(\`${year}-${pad(i+1)}-01\`, {month:'short'})` — and
     `formatDate()` (`app/src/i18n/format.ts`) is `new Date(d).
     toLocaleDateString(locale, options)`. A date-ONLY ISO string
     ("YYYY-MM-DD", no time component) is parsed by `new Date(string)` as
     UTC MIDNIGHT per the ECMAScript spec (a date-TIME string with no
     offset parses as LOCAL time instead — this distinction is the whole
     bug) — but `.toLocaleDateString()` always renders in the device's
     LOCAL timezone. For any timezone BEHIND UTC (the entire Western
     Hemisphere, where this app's own users are), that mismatch rolls the
     displayed month back by one: UTC midnight May 1st reads as "Apr 30"
     in US time zones. Every Pill's own label was therefore the PREVIOUS
     month's name, while its `onPress` still correctly set the NEXT
     month's numeric value — the Pill visually labeled "May" was really
     sitting on the button that sets `month=6` (June), one position later
     than its own label claimed. `periodLabelFor()` (the report header's
     "May 2026" text) had the identical bug, one level up. `buildLineItems()`/
     `inAccountantPeriod()` themselves were ALWAYS correct (plain
     `dateStr.slice(5,7) === month` string comparison, no `Date()`
     involved) — this was purely a LABEL bug, not a filter bug, but the
     practical effect ("selecting May shows June's documents") was
     identical to a real filter bug from the user's own perspective.
     **Fix**: `app/src/i18n/format.ts` gained `formatMonthLabel(year,
     month1Based, locale, options)` — constructs the `Date` via the
     LOCAL-time constructor (`new Date(year, month1Based - 1, 1)`,
     unambiguous by spec — its arguments are always local calendar
     components, never UTC) instead of round-tripping through an ISO
     STRING, so construction and `.toLocaleDateString()`'s own formatting
     happen in the exact same timezone — no UTC-vs-local seam left for a
     rollback to hide in. Exposed as `useFormatters().monthLabel()`. Every
     month-LABEL construction in the app was audited and fixed: both
     `accountant-package.tsx` occurrences (`periodLabelFor`/`monthNames`)
     and 4 in `cash-flow.tsx`'s own Monthly View (`MonthlyTrendChart`'s
     axis endpoints, `MonthCard`'s own title — both used
     `date(new Date(Date.UTC(...)).toISOString().slice(0,10), ...)`, the
     identical bug via a different-looking construction — plus the
     tightest-month/best-month callout lines) — the Cash Flow ones were
     informational-only labels (never a selector), so they never caused
     the WRONG data to load, only ever showed the wrong month NAME; still
     a real, confirmed instance of "the same class of error," now fixed
     identically. **Audited, confirmed correct, no change**: Deductions'/
     Settlements' own period tabs (`src/stats/periodFilter.ts`) use a
     STATIC translated "This Month" string, never a dynamically-computed
     month name — no label-vs-value mismatch is possible. Per-diem month
     vs. YTD (`buildPerDiemBlock()`) is entirely string-slice based
     (`.slice(0,4)`/`.slice(5,7)`), no `Date()` round-trip at all. The
     "expense breakdown This Month/Last Month" toggle named in the audit
     request no longer exists in the codebase — it was removed in the
     DASHBOARD SIMPLIFICATION pass (confirmed via a repo-wide grep, not
     assumed) — nothing to check there. **Flagged, deliberately out of
     scope**: `formatDate()`/`date()` itself carries this SAME general
     UTC-vs-local pitfall for ANY date-only string passed to it, not just
     constructed month-boundaries — `format.test.ts`'s own PRE-EXISTING
     test (`formatDate('2026-03-05T00:00:00Z', 'en')`, matched against a
     regex accepting EITHER "3/4" or "3/5") already tacitly tolerated this
     ambiguity rather than fixing it. This is a real, broader, already-
     latent issue (evidenced by that test's own tolerant regex) that could
     affect other date-only-string displays elsewhere in the app — fixing
     `formatDate()` itself was judged out of scope for THIS bug report
     (which was specifically about month WINDOWS) given how many call
     sites across the app would need re-verifying; flagged here as a real
     follow-up rather than silently expanded into or silently ignored.
     **Tests**: `format.test.ts` gained `formatMonthLabel` coverage
     (every one of the 12 months produces its own correct name; swept
     across `Pacific/Honolulu`/`America/Chicago`/`UTC`/`Pacific/Kiritimati`
     — timezones on both sides of UTC — via runtime `process.env.TZ`
     manipulation, PROVING immunity rather than asserting it; a direct
     side-by-side reproduction of the OLD buggy pattern under a behind-UTC
     timezone, confirmed to actually produce "Apr" for May, so this test
     would have caught the original bug). `accountantPackage.test.ts`
     gained the exact requested scenario — one row in each of 3
     consecutive months, selecting each month's own numeric value via
     `buildLineItems()` returns exactly that month's row. A NEW,
     dedicated end-to-end block in `accountantPackageReport.test.ts`
     chains `buildLineItems()` → `buildScheduleCTotals()` →
     `groupLineItemsByScheduleCBucket()` → `buildAccountantReportHtml()`
     → `formatMonthLabel()` for all 3 months, proving the label, the
     on-screen filter, AND the exported HTML (which PDF and Excel share
     verbatim, per this file's own established precedent — one proof
     covers both surfaces) all agree for every month selection, with zero
     leakage from a neighboring month.
  2. **OWNER'S EQUITY ROW DETAIL**: `OwnersEquitySummary` (`src/stats/
     accountantPackage.ts`) used to expose only 4 AGGREGATE totals (cash
     contributed / expenses paid personally outstanding / reimbursements
     taken back / owner draws), never the individual `capital_transactions`
     rows behind them. `src/stats/capitalAccount.ts` gained
     `buildCapitalFlowRows()` — reuses the SAME 4-way classification
     `summarizeCapitalFlows()` already established (contribution-vs-draw ×
     linked-vs-unlinked = cash contribution in / expense paid personally /
     reimbursement taken back / owner draw out — never a second
     classification that could disagree with the flow totals already
     shown) but ITEMIZED, one row per real transaction, never netted the
     way `expensesPaidPersonallyOutstanding` nets multiple contributions
     against reimbursements for the same deduction — each row keeps its
     own real `tx_date`, `note` (the user's own text, or — for a linked
     row — `planContributionSync()`'s/the "Reimburse Myself" flow's own
     auto-composed "{description} — paid personally (...)"/"{description}
     — reimbursed to owner", both already real, meaningful strings, not
     invented for this pass), and `amount`, sorted chronologically (oldest
     first). A genuinely blank note (an old manual row entered before
     notes were captured) falls back to a plain, type-specific label
     ("Cash contribution", "Owner draw", ...) rather than an empty cell.
     `CapitalTransactionLike` gained an optional `note?: string | null`
     field (backward compatible — every existing caller that never
     touched `note` keeps compiling unchanged). `buildOwnersEquity()`
     computes `rows` from the exact SAME `contributions` input its own
     `flows` total already reads — same all-time scope as the existing
     aggregate (the Accountant Package's own Owner's Equity section has
     always been all-time regardless of the report's Year/Month
     selection, confirmed by reading `useCapitalTransactions()` — a plain
     unfiltered `useEntityList()` — before changing anything; preserved
     exactly as-is, not silently re-scoped by this fix) — so the itemized
     rows can never sum to a different total than what the summary above
     them already shows. **Screen** (`accountant-package.tsx`): a new
     "Owner's Equity — Detail" `Card` under the existing summary Card,
     one read-only row per transaction (date — description — type label,
     tinted green/red for in/out matching the summary rows' own existing
     tinting) — reuses the SAME 4 type-label i18n keys the summary already
     shows (`cashContributedLabel`/`expensesPaidPersonallyLabel`/
     `reimbursementsTakenBackLabel`/`ownerDrawsLabel`), never a second,
     separately-translated set of type names. Deliberately READ-ONLY on
     this screen (no edit/delete) — matching the Capital Assets section's
     own existing read-only `Row`-based precedent immediately above it,
     not the editable `LineItemRow` pattern the category tables use;
     editing a contribution/draw stays a Capital Account/Deductions-screen
     action, out of scope for a report screen. **PDF/Excel**
     (`accountantPackageReport.ts`, one shared HTML template for both,
     per this file's own established precedent): a new itemized table
     right under the existing 4-row summary, gated behind DETAILED format
     only — same SUMMARY-vs-DETAILED convention every other section
     (Lumper Fees, category line items) already follows (summary = totals
     only, detailed = every itemized row) — a deliberate, stated design
     choice, not a silent omission from summary mode. **Tests**:
     `capitalAccount.test.ts` gained `buildCapitalFlowRows` coverage (all
     4 types classified correctly; date/note/amount carried through
     untouched; the type-specific fallback description when note is
     blank; chronological sort regardless of input order; the "never
     nets" proof — a $300 contribution and its own $100 reimbursement
     both appear as their own separate, un-netted rows, unlike
     `summarizeCapitalFlows()`'s own $200-outstanding netted figure for
     the identical data). `accountantPackage.test.ts` gained
     `buildOwnersEquity — rows` coverage (itemized + chronological +
     never disagreeing with `flows`). `accountantPackageReport.test.ts`
     gained a dedicated block proving every row's date/description/type
     label/amount renders in DETAILED mode, in the correct chronological
     order, with correct in/out tinting, entirely ABSENT in SUMMARY mode,
     and a "no rows" message when there are none — covering the PDF/Excel
     surfaces (shared HTML) directly; the on-screen surface is proven via
     the same `buildOwnersEquity` test plus direct code review of the
     screen's own render (this repo has no React rendering harness, the
     same standing limitation this codebase has flagged at every prior
     UI-testing juncture).
  Full suite: 114 suites / 2751 tests pass; `tsc --noEmit` clean. i18n: 2
  new keys (`accountantPackage.ownersEquityDetailTitle`/
  `ownersEquityNoRows`) — es/ru/ar/tr fully translated, hi/uk as
  untranslated English copies per invariant #11; glossary test re-passed
  clean (1176 tests). No SQL/Edge Function changes.

- THREE ITEMS — SPLASH WORDMARK, DELETE A TRUCK, DOCUMENT TYPE
  CONFIRMATION AT REVIEW (owner decision, docs/PENDING_SQL.md §64, NOT
  YET RUN).
  1. **SPLASH WORDMARK**: `app/scripts/generateBrandAssets.js` gained
     `composeSplashWithWordmarkSvg()` — the truck mark plus `BRAND_NAME`
     ("BOZKA TRUCKING AI"), white, letter-spaced, small font, centered as
     ONE block beneath the mark, generous padding on every side — used
     ONLY for `splash-icon.png`'s own generation call; every OTHER
     surface (icon.png, favicon, Android adaptive layers, store assets)
     keeps the plain mark-only design unchanged (confirmed via a
     regenerate-and-diff: only `splash-icon.png` actually changed).
     Regenerated and visually verified (composited over the app's own
     `#08080c` background and inspected) — wordmark renders correctly,
     no font-rendering gap in this environment's `sharp`/librsvg build.
     **Needs a new EAS BUILD, not an OTA update** — `splash-icon.png` is a
     native-level asset baked in at build time (same class of constraint
     as every other `app.config.js` image asset, per the APP ICON +
     SPLASH entry above).
  2. **DELETE A TRUCK** — a real, permanent delete, distinct from Retire
     (`trucks.is_active = false`, unchanged, still the default/
     recommended option, CLAUDE.md invariant #7's "every record stays").
     **Schema fix (docs/PENDING_SQL.md §64)**: adversarial-audit finding,
     confirmed by reading `docs/SCHEMA.sql` line by line — 5 `truck_id`
     foreign keys (`settlements`, `fuel_purchases` (§6),
     `maintenance_records`, `deductions` (§63a), `tolls` (§63c)) were
     plain `references trucks` with NO `on delete` clause, which defaults
     to `NO ACTION` (behaves exactly like `RESTRICT`) — `delete from
     trucks` failed with a foreign-key violation the instant any row
     anywhere still pointed at that truck, making a real delete
     structurally impossible before this fix. §64 drops each constraint
     by its ACTUAL name (looked up dynamically via `pg_constraint`,
     never guessed — `settlements_user_id_week_ending_key`'s own
     precedent elsewhere in this file already confirms this app relies
     on Postgres's default auto-naming) and re-adds all 5 as `on delete
     cascade`. Two OTHER `truck_id` FKs were ALREADY correct and left
     untouched: `maintenance_intervals.truck_id`/`truck_health_config.
     truck_id` were already `on delete cascade` (per-truck SETTINGS
     rows); `drivers.default_truck_id`/`compliance_items.truck_id` are
     both deliberately kept `on delete set null` — a driver or compliance
     item is not "that truck's data," it should survive the truck's own
     deletion, just lose the now-meaningless association.
     **Atomicity, no new Edge Function/RPC needed**: with §64 applied, a
     single `delete from trucks where id = $1` — a plain client-side
     Supabase call, RLS-scoped to the caller's own row (`trucks_owner_all`
     `for all` policy already covers DELETE) — is a genuinely atomic
     Postgres transaction: it cascades every settlement/load (a second
     hop, via the ALREADY-existing `loads.settlement_id on delete
     cascade`)/fuel_purchase/maintenance_record/deduction/toll/
     maintenance_interval/truck_health_config row, and any
     `capital_transactions` row LINKED to one of those cascaded
     deductions (a second hop, via the ALREADY-existing
     `capital_transactions.linked_deduction_id on delete cascade`) — all
     inside the one transaction that statement runs in. No RPC was
     needed the way §60's balance-ledger fixes needed one, because there
     is no non-cascadable side effect to make atomic alongside the row
     deletes (see the business-balance decision below).
     `app/src/data/truckDeletion.ts`: `fetchTruckDeletionImpact(truckId)`
     (read-only counts + a `totalDollarValue` — sum of every settlement's
     own gross plus every fuel/maintenance/toll/deduction amount,
     deliberately NOT summing `loads.revenue` too, since that's already
     counted once inside its own settlement's gross) drives the
     confirmation screen's real numbers; `deleteTruckCompletely(truckId)`
     collects every `document_id` referenced by the truck's settlements/
     maintenance_records/deductions BEFORE the delete (the only join path
     that still exists at that point), issues the ONE atomic delete, then
     — AFTER it has already succeeded — runs a best-effort cleanup pass
     reusing the EXISTING `cleanupOrphanedDocument()`
     (`deductionMutations.ts`, the same function every other per-record
     delete flow already calls) once per collected id, which re-checks
     genuine orphan status itself so a document still referenced
     elsewhere (a different truck, a fleet-level row) is never touched.
     Storage cleanup is deliberately a SEPARATE, non-transactional pass —
     the same honest limitation `delete-account`/`reset-data` already
     document (Storage deletion can't be rolled back together with a SQL
     statement) — a failure there is reported (`documentCleanupFailures`)
     but never means the truck or its financial records survived.
     **Business balance, stated plainly (the request's own "make it
     consistent" instruction)**: deleting a truck's settlements does
     **NOT** reverse any of their `business_balance_credit` from
     `profiles.business_balance` — matching the app's own PRE-EXISTING,
     single precedent exactly (`useDeleteSettlement`, Settlements' own
     individual delete action, is a plain `useEntityDelete` with no
     balance-reversal step at all — confirmed by reading it before
     deciding this, not assumed). The real cash the carrier already paid
     isn't un-deposited just because the record of it is gone; truck
     deletion is a bulk application of the identical, already-shipped
     rule, not a new one invented for this feature. Tax estimates and the
     Capital Account summary need zero special handling — both are
     computed LIVE from whatever rows currently exist (CLAUDE.md
     invariant #6's "no cached/stored total" convention), so the very
     next read after a deletion is automatically correct. `delete-account`/
     `reset-data`'s own explicit per-table deletion loops were
     deliberately NOT touched — they already delete children before
     parents (working correctly regardless of RESTRICT vs. CASCADE), and
     rewriting their order to lean on the new cascade would be an
     unrequested, unnecessary risk to two already-hardened Edge Functions.
     **UI** (`app/(tabs)/more/trucks.tsx`, the edit sheet — this app's
     "truck detail screen"): a "Danger Zone" section, visually separated
     by a red divider, under Save/Cancel — Retire (soft, unchanged
     behavior, now with explanatory copy) above the divider, "🗑️ Delete
     Truck Permanently" below it in red. Tapping it opens a dedicated
     confirmation `ModalSheet`: real itemized counts (Settlements/Loads/
     Fuel/Maintenance/Tolls/Deductions/Documents) + the headline dollar
     total, the business-balance statement above, an "⬇️ Export This
     Truck's Data First" button (`app/src/data/truckExport.ts`'s
     `fetchTruckExportData()` — a truck-scoped counterpart to Settings'
     own `fetchAllUserData()`, same `File`/`Paths`/`Sharing` JSON-export
     pattern), and a required typed-unit-number field (falls back to the
     literal word "DELETE" when a truck has no `unit_number` set) gating
     the final button — same "type to confirm" friction Settings' own
     Delete Account flow already established. `refreshTrucks()`
     (`ActiveTruckContext`) self-heals correctly with no code change
     needed: it re-derives `activeTruck` from a fresh `trucks` fetch, so
     deleting the currently-active truck naturally falls back to the
     remaining truck (n=1) or "All Trucks" (n>1), the exact same logic
     path an already-invalid stored preference already went through.
     **Tests, real cascade + atomicity proof, not hand-waved**:
     `fakeSupabase.ts` gained `CASCADE_RULES` + a recursive
     `cascadeDelete()` — a minimal, explicit mirror of every `on delete
     cascade` FK this app's schema documents (both §64's 5 new ones and
     the 2 pre-existing second-hop ones), wired into the fake's own
     `.delete()` path, so a test can prove "deleting the PARENT row
     removes every CHILD row the real FK graph is documented to cascade"
     against real code — same honest-boundary spirit as every other fake
     in this file (proves the CLIENT-VISIBLE deletion shape is correct,
     not that live Postgres is actually configured this way — §64 must
     really be run). Full jest suite re-run against this change
     (16 suites / 196 tests) confirmed zero regressions in any
     pre-existing test that already relied on `.delete()`.
     `truckDeletion.test.ts` (new, 8 tests): real counts/dollar total
     scoped to exactly one truck of a two-truck fleet; a zero-record
     truck returns all zeros; cascade removes every settlement/load/fuel/
     maintenance/toll/deduction/linked-contribution/setting row tied to
     the truck; a DIFFERENT truck's own data is completely untouched; a
     fleet-level deduction (no `truck_id`) and a manual (non-linked)
     capital contribution both survive untouched; orphaned documents get
     cleaned up (Storage + row) while a document still referenced by
     another truck is left alone; **atomicity**: an injected failure on
     the truck delete itself throws and performs ZERO document cleanup,
     nothing partially removed; a failed document cleanup is reported,
     never thrown, and never undoes the already-succeeded truck deletion.
  3. **DOCUMENT TYPE CONFIRMATION AT REVIEW**: `app/src/import/
     typeOverride.ts` (new, pure) — the AI's own 17-value internal
     `DocType` classification is collapsed to the 7 buckets a user can
     actually choose between: Settlement / Expense receipt / Fuel /
     Maintenance / Toll / Bank statement / Other. `docTypeToSimpleDocType()`
     is the selector's PREFILLED starting value (settlement/fuel/
     maintenance/amazon|store map to their own bucket; every other raw
     docType — w2/insurance/loan_agreement/toll/... — folds into "Other,"
     since a full 17-way picker would defeat the point of "a clear
     selector"). `remapExtractionToSimpleType(extraction, target)` is
     called LIVE on every tap (`app/(tabs)/import/index.tsx`, via the
     SAME `setExtraction()` pattern `withPrimaryExtractionDate()`/
     `withPerDiemDays()`/`withPaymentMethod()` already use — never a
     second, parallel piece of state that could drift from what Save
     actually does), so the whole preview below it (icon/label, duplicate
     check, settlement-replace banner, reconciliation guard, date field,
     category picker) reflows from the new type automatically. "Keeping
     what applies, dropping what doesn't" is implemented as: derive the
     BEST-available vendor/date/totalAmount/summary by checking every
     sub-object a prior classification might have populated (a
     settlement's own `carrier`/`weekEnding`/`netPay`, a maintenance
     record's own `shop`/`total`, ...) — never inventing a value, only
     relocating one to where the mapper for the NEW type actually reads
     from (confirmed by reading `mapExtraction.ts`'s own mapper bodies:
     `mapPurchase()`/`mapFuel()`/`mapMaintenance()`/`mapGenericDeduction()`
     all read primarily from these TOP-LEVEL `Extraction` fields, not
     their own docType-specific sub-object, which is what makes this
     remap tractable at all) — then ensure the target's own sub-object
     exists as at least `{}` ONLY when `aiImportSave.ts`'s own dispatch
     chain requires it truthy (`docType === 'fuel' && d.fuel`, etc. — a
     real, confirmed-by-reading-the-dispatch-chain requirement, not
     guessed). The ORIGINAL sub-object is deliberately NEVER deleted —
     switching the selector back and forth is lossless, nothing is
     destroyed by trying a type and changing your mind. **Settlement is
     never synthesized from scratch** — remapping INTO "Settlement" only
     ever preserves already-present `d.settlement` data (there's no sane
     way to invent `week_ending`/gross/net from an unrelated receipt);
     the existing "Week Ending required" gate (invariant #10) already
     blocks Save with a clear message if that's genuinely missing, same
     as it always has for any settlement extraction. **Toll and Bank
     statement, an honest, stated gap, not a silent one**: neither has a
     dedicated extraction shape or DB save destination anywhere in the
     ai-import pipeline today — confirmed by reading `aiImportSave.ts`'s
     own dispatch chain, `'toll'` was ALREADY silently falling through to
     the generic-deduction save path before this feature existed (no
     standalone `tolls`-table write path has ever existed for an
     ai-import doc, only for a settlement's own itemized toll section);
     bank/credit-card statements have NO ai-import docType at all
     (CLAUDE.md's own NAV SIMPLIFICATION / FEATURE FLAGS entry: the ONLY
     import path for those two entities is the separate legacy-backup
     JSON importer). Both route through `docType: 'other'` (archived,
     saved as a NEEDS-REVIEW deduction, invariant #14) — exactly what
     already happened for "toll" silently before, now visible, user-
     controlled, and labeled with an explicit "a dedicated ledger for
     this type isn't built yet" note in the preview rather than a smooth,
     misleading confirmation. Building either a real toll ledger or a
     real bank-statement extraction shape is a materially larger,
     unrequested feature, out of scope here.
     **The required test, proven end to end, not just at the remap
     function's own boundary**: an AI-classified settlement (`carrier:
     'Prime Inc'`, `weekEnding: '2026-06-06'`, `netPay: 850`) changed to
     "Expense receipt" produces `docType: 'store'` with `vendor`/`date`/
     `totalAmount` correctly pulled from the settlement's own fields —
     verified by feeding the remapped extraction through the REAL
     `mapPurchase()` (not a re-implementation) and asserting the
     resulting deduction has `amount: 850`, `ded_date: '2026-06-06'`,
     `store: 'Prime Inc'`, exactly the literal wording of the requested
     test case.
     Tests (`typeOverride.test.ts`, new, 12 tests): every raw-docType-to-
     bucket mapping; toll/bank_statement both confirmed to route to the
     same "other" fallback as a documented, tested fact rather than an
     assumption; the required settlement→expense-receipt case end to end
     through the real `mapPurchase()`; the target sub-object correctly
     synthesized as truthy when absent (fuel/maintenance) and NEVER
     overwritten when already present; the original sub-object surviving
     a remap untouched (lossless switch-back); an already-correct top-
     level field never overwritten by a worse nested fallback value.
  Tests: 114 suites / 2730 tests pass (20 new: 8 truckDeletion + 12
  typeOverride); `tsc --noEmit` clean. i18n: 28 new keys across
  `trucks.*` (20) and `importScreen.*` (8, including the 7-way
  `simpleDocType.*` block) — es/ru/ar/tr fully translated ("Settlement"
  kept in Latin script per the glossary in every locale), hi/uk as
  untranslated English copies per invariant #11; glossary test re-passed
  clean (1176 tests). `docs/PENDING_SQL.md` §64 (also mirrored as
  `pending_64.sql` at the repo root) is **NOT YET RUN** — item 2's client
  code depends on it (a plain truck delete will still fail with a
  foreign-key violation exactly as before until it's applied); items 1
  and 3 work standalone. No Edge Function was touched — no redeploy
  needed for `ai-import`/`ai-advisor`/`reset-data`/`delete-account`.
  Every change except item 1's asset regeneration is pure client-side
  JS/TS/SQL, ships via a normal `eas update`; item 1 needs a fresh EAS
  BUILD (native asset, not OTA-updatable) before the new splash wordmark
  reaches a device.

- APP ICON + SPLASH — REAL BRAND ASSETS (owner decision 2026-08-27): the
  app shipped with the default Expo template placeholder PNGs
  (`app/assets/images/icon.png` and friends — a generic blue/white
  boomerang-style template mark, confirmed by viewing the file, never
  replaced) for the entire project's history — `BrandAppIcon.tsx`, the
  source COMPONENT for this exact composition, existed since the branding
  pass but was never actually rendered to real PNG files (its own header
  comment said as much: "turning it into the actual store icon files...
  still needs a render-to-PNG step this code-only pass can't perform").
  This pass does that render.
  **How the PNGs were generated**: there is no way to rasterize a live
  React Native `<Svg>` component to a file outside of a running app
  instance (no headless RN renderer in this toolchain), so
  `app/scripts/generateBrandAssets.js` (new, committed, re-runnable at
  any time — `node scripts/generateBrandAssets.js` from `app/`) instead
  re-expresses `BrandLogo.tsx`'s exact SVG shape data (viewBox "0 0 48
  26" — the trailer rect, sleeper-cab path, chassis line, two wheel
  circles, every stroke/linejoin/linecap attribute copied verbatim) as
  plain SVG strings, composed the same way `BrandAppIcon.tsx` composes
  them (near-black `#08080c` — `theme.ts`'s own `colors.bg` — background,
  centered white truck mark), and rasterizes each composition with
  `sharp` (new devDependency, added specifically for this script — never
  imported by the app's own runtime code, so it adds nothing to the
  shipped bundle). Both design tokens (`colors.bg`, `BRAND_LOGO_LIGHT`)
  are copied into the script as plain string literals rather than
  imported (a plain Node script has no way to import a React
  Native/TypeScript module directly) — the SAME "each tool is self-
  contained, kept in sync by hand" convention this repo already uses for
  Deno Edge Functions that can't import from `app/src` either; if
  `BrandLogo.tsx`'s path data or `theme.ts`'s `colors.bg` ever changes,
  `generateBrandAssets.js`'s own `TRUCK_MARK_INNER_SVG`/`BG_COLOR`
  constants need a matching manual update, flagged in the script's own
  header comment.
  **Files generated** (all committed): `app/assets/images/icon.png`
  (1024×1024, full-bleed — deliberately NO pre-rounded corners baked in,
  since iOS/the OS apply their own corner mask at display time, and
  double-rounding would show background-colored slivers at the corners),
  `android-icon-foreground.png`/`android-icon-monochrome.png` (1024×1024,
  transparent background, truck mark scaled to 50% width — a
  DELIBERATELY more conservative safe-zone ratio than the plain icon's
  62%, since Android crops adaptive icons to a variety of OEM-chosen mask
  shapes and only guarantees the inner ~66% of the canvas survives every
  one of them; monochrome is always plain white regardless of brand
  color, since Android applies its own tint to that layer), `android-
  icon-background.png` (1024×1024, flat `#08080c` fill, no mark),
  `splash-icon.png` (1024×1024, transparent background, truck mark only —
  the `expo-splash-screen` plugin's own already-correct `backgroundColor:
  '#08080c'` in `app.config.js`, unchanged this pass, fills the rest of
  the screen so this composites seamlessly), `favicon.png` (512×512,
  full-bleed, same design as the app icon). `app.config.js`'s ONE
  substantive change: `android.adaptiveIcon.backgroundColor` was still
  the Expo template's own light-blue placeholder (`#E6F4FE`) despite
  every image file it sits alongside already being wired to the real
  brand paths — corrected to `#08080c` to match the newly-generated
  `android-icon-background.png` and the app's own theme; every other
  `icon`/`web.favicon`/splash-plugin field already pointed at the correct
  paths, just at placeholder content.
  **`store-assets/` (new folder, repo root)** — what the actual store
  LISTINGS need, never read by the app itself, upload by hand: `play-
  store-icon-512.png` (512×512), `play-store-feature-graphic-
  1024x500.png` (1024×500, same design centered on the wider rectangular
  canvas, text-free — the store already shows the app name separately
  next to it), `app-store-icon-1024.png` (1024×1024, identical design to
  `icon.png` — Apple, like Google, wants a flat square with no pre-
  applied corner rounding).
  **This needs a new EAS BUILD, not just an `eas update`**: `icon`/
  `splash`/`android.adaptiveIcon`/`web.favicon` are all NATIVE-level
  assets baked into the compiled binary at build time (same class of
  constraint CLAUDE.md's own BRANDING CLEANUP entry already documented
  for `app.config.js`'s `name`/permission strings) — an OTA `eas update`
  cannot touch them; only a fresh build re-bundles the new PNGs.
  `docs/ADMIN_RUNBOOK.md`/PROMPTS.md's own "next native build" checklist
  should carry this forward until it actually ships.
  Full suite: 105 suites / 2601 tests pass (unchanged — no test/source
  logic touched, only assets/config/a new build-time-only script); `tsc
  --noEmit` clean. No SQL/Edge Function changes; no redeploy needed for
  anything. No i18n changes (an icon has no text, per the user's own
  explicit design brief).

- FULL SYSTEM AUDIT — P1 BATCH, NINE FIXES (owner decision 2026-08-26/27,
  same adversarial audit as the P0 pass above, next-priority findings).
  1. **SETTLEMENT RE-IMPORT DUPLICATES maintenance/toll rows
     (docs/PENDING_SQL.md §61, NOT YET RUN)**: unlike loads/fuel_purchases/
     reimbursements/withheld deductions, `maintenance_records`/`tolls` had
     no `settlement_id` column at all to scope "old rows for THIS
     settlement" by (`maintenance_records` only had `document_id`, which
     is a FRESH id on every re-import attempt — no help finding the
     PREVIOUS attempt's rows; `tolls` had no linking column whatsoever) —
     re-importing the same PDF twice silently doubled these expenses,
     double-counting in true profit, CPM, and the Accountant Package.
     Fixed by adding `settlement_id` to both tables (nullable, `on delete
     cascade`, same convention as the other settlement-child tables) and
     applying the IDENTICAL capture-old-ids/insert-new/delete-old pattern
     `aiImportSave.ts` already used for loads/fuel/reimbursements/
     deductions. Tests: `aiImportSave.settlement.test.ts` gained two new
     end-to-end cases proving a settlement with maintenance+toll line
     items imported twice (and a third time) leaves exactly one
     maintenance row and one toll row, correctly tagged to the single
     (replaced) settlement.
  2. **TWO DISAGREEING "does this reduce income" RULES**:
     `dashboardStats.ts`'s `outOfPocketDeductions` (feeds the tax
     estimate's net-profit input, `taxEstimate.ts`) checked only
     `source`/`tax_deductible`, silently disagreeing with the canonical
     `reducesTrueProfit()` (`src/stats/trueProfit.ts`), which ALSO
     excludes Meals/Advance Repayment/Escrow & Deposits by category. A row
     re-categorized to Meals without its `tax_deductible` flag being
     updated was excluded from true profit but STILL subtracted in the
     tax estimate — understating tax owed. Fixed two ways: (a)
     `outOfPocketDeductions` now filters via `d.source !== 'settlement' &&
     reducesTrueProfit(d)` — a strict superset of the old check, so it can
     only ever exclude MORE, never include a row the old check didn't
     already include; (b) re-categorization now re-applies the smart
     default for `tax_deductible` in BOTH places a deduction's category
     can be edited — `deductions.tsx`'s new `handleEditCategoryChange()`
     (mirrors the pre-existing add-flow pattern, `handleAddCategoryChange()`)
     and `accountant-package.tsx`'s `handleSaveCategory()`/
     `convertLineItemToDeductionInsert()` (which used to hardcode
     `tax_deductible: true` unconditionally, regardless of the new
     category). Still a SMART DEFAULT, not a lock — a checkbox/later edit
     can always override it. Tests: `dashboardStats.test.ts` gained the
     exact reported scenario (a Meals row with `tax_deductible` still
     `true`, proving it's excluded from `outOfPocketDeductions` while
     `totalDeductions` stays unchanged) plus Advance-Repayment/Escrow and
     withheld-row cases.
  3. **DEDUCTION EDIT + CONTRIBUTION SYNC NOT ATOMIC
     (docs/PENDING_SQL.md §62, NOT YET RUN)**: `deductions.tsx`'s
     `handleSaveEdit()`/`handleSaveAdd()` each did a deduction write THEN,
     as a SEPARATE `await`, a linked-contribution sync — a network drop
     between the two could leave the deduction saved with a stale/
     missing/orphaned linked contribution, corrupting `taxFreeRemaining`.
     Fixed with two new atomic RPCs, same §60 pattern: `update_deduction_
     with_contribution_sync()`/`insert_deduction_with_contribution_sync()`
     — either the deduction write AND the contribution create/update/
     remove both happen, or neither does, in one transaction.
     `applyContributionSync()`/`fetchLinkedContributionId()`
     (`deductionMutations.ts`) are unchanged and still used by
     `accountant-package.tsx`'s category-only edit and `documents.tsx`'s
     payment-method quick-edit — neither touches personal-payment sync at
     all, a narrower, separate, explicitly-flagged gap left out of this
     fix's scope. Tests: `deductionMutations.test.ts` gained 13 new tests
     against the real exported functions (not a reimplementation) proving
     create/update/remove/noop sync all work atomically, AND — the actual
     atomicity proof — that a failed RPC call leaves BOTH the deduction
     row and any contribution completely untouched (never partially
     applied), for both the edit and add flows.
  4. **UNAWAITED handleJobStart + EdgeRuntime.waitUntil WITHOUT A
     CAPABILITY CHECK OR SERVICE-ROLE CLIENT**: three real bugs in
     `ai-import/index.ts`. (a) `return handleJobStart(...)` (no `await`)
     inside the top-level try/catch let a REJECTION of that promise escape
     the catch entirely — a bare `return somePromise` in an async function
     hands the promise straight to the caller without re-entering the
     function's own synchronous frame, so a later rejection never gets a
     chance to be caught there; fixed to `return await handleJobStart(...)`.
     (b) `(globalThis as any).EdgeRuntime.waitUntil(...)` had no capability
     check — if that global were ever missing, it threw synchronously
     (compounded by (a), this could escape as a raw error); now checked
     FIRST, before any `import_jobs` row is created, failing cleanly with
     no job ever left stuck at "queued." (c) `runJobInBackground()` used
     the ORIGINAL caller's JWT-scoped client for every write — a
     background job can run up to `JOB_HARD_BUDGET_MS` (4 minutes), long
     enough for a short-lived session token to expire mid-job, silently
     failing every subsequent status-update write (including the one that
     marks a job 'failed') and stranding it in "processing" forever with
     no error ever recorded. Fixed by routing every `import_jobs` write
     through a service-role client (`getServiceRoleAdminClient()`, renamed
     from the rate-limit pass's own `getRateLimitAdminClient()` — same
     cached client, now serving two purposes), each explicitly scoped by
     BOTH `.eq("id", jobId)` AND `.eq("user_id", userId)` since a
     service-role client bypasses RLS entirely. `consume_ai_import_credit()`
     still uses the ORIGINAL caller client specifically — it's `security
     definer` and derives the user exclusively from `auth.uid()`, which
     has no meaning for a service-role connection; already best-effort/
     failure-tolerant, so a stale JWT failing there is a far smaller
     degradation than the whole job never completing. Client-side safety
     net added too: `isStrandedJob()` (`src/import/importJobs.ts`) flags
     an active job whose `updatedAt` hasn't moved in 10+ minutes (well
     past the server's own 4-minute budget) as stuck, surfacing a Retry
     button on the Import Jobs screen even though its `status` never made
     it to `'failed'`. Tests: 5 new `isStrandedJob()` cases. The Deno-side
     fix itself has no Jest test (no Deno runtime in this environment,
     same standing limitation as every prior ai-import pass) — hand-
     reviewed line by line instead of fabricating coverage.
  5. **bad_request/unauthenticated STILL SHOWED RAW ENGLISH**:
     `friendlyAiFailure.ts`'s own header comment used to claim these two
     "keep their own existing, already-specific/dedicated UI" — false;
     neither was ever in `classifyAiImportFailureCategory()`'s map, so
     both fell through to `friendlyAiImportError()`'s plain, NEVER-
     TRANSLATED hardcoded English strings, regardless of the user's
     locale (violating CLAUDE.md invariant #11). Fixed: `unauthenticated`
     now maps to a new `sessionExpired` category (a distinct fix — sign in
     again — from every other bucket's generic "try again"); `bad_request`
     maps to the existing `internal` bucket (every real `bad_request`
     message ai-import actually returns — "retryJobId is required," "Only
     POST is supported," "Request body must be valid JSON" — is an
     app-side bug, never something a real user action causes). New
     `importScreen.friendlyFailure.sessionExpired` key across all 7
     locales (es/ru/ar/tr translated, hi/uk untranslated English copies).
     Test updated: the old "falls through to null" assertion for these
     two types was itself testing the bug — replaced with explicit
     category assertions for both, plus a `usage_limit_reached`/unknown-
     type case confirming the one type still deliberately left out of the
     map (it keeps its own genuinely dedicated real-figures UI).
  6. **NUDGE/WEEKLY-REVIEW WRITES ARE FIRE-AND-FORGET**: every
     `updateProfile.mutate(...)` call in `alerts.ts`/`proactiveCoach.ts`
     (recording nudges shown, silencing/unsilencing a nudge, setting
     role, dismissing the role prompt, caching a generated weekly review)
     had no `onError` at all — for the "record shown" writes specifically,
     the local ref tracking "already recorded this topic set" was set
     BEFORE the mutation even started, so a failed write meant this
     session would never retry it, and since `profiles.nudge_state` in
     the DB never actually changed, the frequency-cap engine kept
     computing against STALE state on every future load — silently
     defeating "at most once per topic per week/month." Fixed: every
     `.mutate()` call now has an `onError` that `console.error`s (making
     the failure diagnosable) and, for the ref-guarded effects, resets the
     ref so a LATER render can retry instead of giving up for the rest of
     the session. `proactiveCoach.ts`'s weekly-review generation got the
     same treatment for BOTH failure paths (a failed AI call, a failed
     cache write) plus a `.catch()` for a thrown error, all resetting
     `generatingKeyRef` so a genuinely failed week's review isn't silently
     skipped forever. HONESTLY FLAGGED: no new test file — both hooks are
     large orchestration hooks (11+ and 9+ data-hook dependencies,
     AuthContext-transitive JSX imports) with no existing dedicated test
     file, same established precedent as this codebase's other thick
     data-layer hooks; hand-verified via `tsc` + careful code review
     rather than forcing a large, fragile mock-everything test into
     existence under time pressure.
  7. **CONSOLIDATED MIGRATION WAS HALF A SCHEMA BEHIND**: `0002_
     consolidated_pending_sql.sql` covered only §1-36, with its own header
     comment flagging that §37/§38 were applied afterward and never folded
     in — the disaster-recovery "provision a fresh Supabase project" path
     was broken for anything shipped in the ~5 months since. Fixed with a
     new `supabase/migrations/0003_consolidated_pending_sql_37_62.sql`
     (1,390 lines) covering §37 through §62 (§37-60 confirmed "✅ APPLIED"
     live; §61/§62 — this pass's own new sections — included too since a
     fresh-provisioning snapshot needs the CURRENT schema the app code
     depends on, each clearly marked "NOT YET RUN" in its own section
     header so nobody mistakes the file's existence as proof they're
     live), following 0002's exact idempotency conventions throughout.
     Five real discrepancies were found and fixed while assembling it
     (not present if the raw docs/PENDING_SQL.md fenced blocks were
     copied naively): §52's 205-row and §53's 8-row carrier-code seed
     INSERTs had no `on conflict` clause at all (would throw a duplicate-
     key error on a second run); §56's and §58's constraint-drop
     statements had no `if exists` guard; §58's and §59's constraint-add
     statements had no duplicate-object guard; §37's function body is
     immediately superseded by §38's, so the file goes straight to §38's
     final version rather than transcribing a throwaway intermediate one.
     VERIFIED against the live database via read-only `information_schema`/
     `pg_constraint`/`pg_policies` queries (not just assumed correct):
     every §37-60 table/column/constraint/function/RLS-policy state
     checked matched what PENDING_SQL.md's prose described, with ZERO
     discrepancies found — including an exact-count match on the seeded
     `carrier_code_maps` data (213 live rows = 205 + 8, confirming the
     transcription is complete, not truncated), and confirming §61/§62's
     columns/functions are genuinely absent from the live schema (matching
     their own "NOT YET RUN" status, not fabricated). NOT independently
     re-verified: every single column across all 26 sections, or the full
     RLS-policy list on tables other than `ai_credit_purchases` — stated
     plainly as the honest scope of what was actually checked.
  8. **EXPORT ALL MY DATA omitted account_credits/ai_credit_purchases/
     referrals**: the first two fit the standard `user_id` loop
     (`EXPORT_TABLES`) and were simply missing; `referrals` genuinely
     can't — it has `referrer_id`/`referred_user_id`, no single `user_id`
     column, same reason `delete-account`/`reset-data` already handle it
     as a bespoke delete rather than the standard loop. Fixed:
     `account_credits`/`ai_credit_purchases` added to `EXPORT_TABLES`;
     `fetchAllUserData()` gained a bespoke `referrals` query
     (`.or('referrer_id.eq.X,referred_user_id.eq.X')`, matching BOTH
     directions — referrals this user made AND the one row recording who
     referred them, both genuinely their own data). `fakeSupabase.ts`
     gained `.or()` support (a minimal `column.eq.value`-clause parser,
     the only shape this codebase's real Supabase calls use) to make this
     testable at all. In the same pass, found and fixed a second, unrelated
     staleness bug this test file's own regression guard exists to catch:
     its hand-maintained `TABLES_IN_DELETION_ORDER` mirror had silently
     drifted from delete-account's real array, missing
     `category_learning_rules` and `account_credits` — corrected alongside
     the main fix rather than left quietly wrong.
  9. **CPM FORMULA DIVERGENCE, VERIFIED**: the actual code, read directly
     rather than assumed from the flagged report's own framing, showed
     `proactiveCoach.ts`'s CPM-vs-RPM coach nudge used neither the legacy
     `calcCpm()` NOR Scorecard's `calcCanonicalCpm()` — a THIRD, ad-hoc
     single-week approximation, `(thisWeek.gross - thisWeek.trueProfitNet)
     / thisWeek.miles`. Compared directly against `calcCanonicalCpm()` and
     found two real, opposite-direction divergences: (a) a week containing
     a major one-off repair or vehicle purchase spiked the ad-hoc figure
     artificially high (true-profit's own weekly net subtracts that
     dollar-for-dollar in the week it happened; `calcCanonicalCpm()`
     deliberately excludes one-offs from the per-mile figure for exactly
     this reason) — a real false-positive "you're running at a loss" nudge
     risk; (b) the ad-hoc formula never added the truck's own fixed cost
     basis (loan/lease payment, warranty) unless it happened to already be
     a settlement-withheld deduction row — a false-negative risk in the
     other direction. Fixed by computing the SAME `calcCanonicalCpm()`
     figure Scorecard shows, over the SAME account-wide scope (not a new,
     unproven per-week variant — Scorecard's own CPM is already an
     all-account aggregate, so reusing that exact scope is the literal
     SAME number a user would see by tapping through to Scorecard, never a
     second figure that could disagree with it), compared against
     `trailingAvgRpm` (falling back to `latestRpm` only when there isn't
     yet enough history) rather than a single week's RPM — pairing an
     account-wide cost figure against one week's revenue rate would just
     trade one apples-to-oranges comparison for another. The `cpmAboveRpm`
     nudge copy's own "this week" wording was ALSO wrong under the new
     scope — fixed across all 7 locales to "your overall cost per mile...
     your typical rate per mile," a direct, necessary consequence of the
     scope change that would otherwise have shipped a now-inaccurate
     string. HONESTLY FLAGGED: no new test file, same "large orchestration
     hook, no existing dedicated test file" reasoning as item 6 — the
     underlying `calcCanonicalCpm()`/`calcTruckCostBasisWeekly()`/
     `carrierWithholdsLoanPayment()`/`resolveMilesTotal()` functions this
     fix wires together are each already separately unit-tested; hand-
     verified via `tsc` + code review that the wiring itself is correct.
  **Deliverables**: 105 suites / 2601 tests pass; `tsc --noEmit` clean.
  `docs/PENDING_SQL.md` §61 and §62 are **NOT YET RUN**. `supabase/
  functions/ai-import/index.ts` was modified (item 4) and **needs
  redeploying**. No other Edge Function changed this pass. All client-side
  changes ship via a normal `eas update` — items 1 and 3 depend on §61/§62
  being applied first (the client calls RPCs/reads a column that don't
  exist yet otherwise); every other item works standalone. New file:
  `supabase/migrations/0003_consolidated_pending_sql_37_62.sql` (a
  disaster-recovery snapshot artifact, not itself run against anything).

- FULL SYSTEM AUDIT — FOUR P0 FIXES (owner decision 2026-08-25/26, adversarial
  pre-launch security/correctness review, findings prioritized and fixed in
  the owner's own explicit order — "credit hole first, it's an open door").
  1. **CREDIT SELF-GRANT RLS HOLE + TOCTOU RACE (docs/PENDING_SQL.md §59,
     NOT YET RUN)**: `ai_credit_purchases` had a self-service UPDATE RLS
     policy (`user_id = auth.uid()`) with NO check constraint on
     `credits_remaining` — any authenticated user could `UPDATE
     ai_credit_purchases SET credits_remaining = 999999 WHERE user_id =
     auth.uid()` directly via the Supabase client, silently granting
     themselves unlimited AI-import usage. Compounded by a genuine TOCTOU
     race in `consumeOneCreditIfOverAllowance()`
     (`supabase/functions/ai-import/index.ts`): select-the-cheapest-pack,
     THEN update by id, with no row lock — two concurrent imports could both
     read the same `credits_remaining: 1` and both decrement to 0, net
     effect -1 instead of the real available balance. Fixed together, one
     migration: (a) `drop policy ai_credit_purchases_update_own` — users get
     SELECT only now, no client-side write path at all; (b) `alter table
     ai_credit_purchases add constraint ai_credit_purchases_remaining_le_granted
     check (credits_remaining <= credits_granted)` — defense in depth, even
     a future service_role bug can't grant more than what was actually
     purchased; (c) `consume_ai_import_credit()`, a new `security definer`
     RPC — `select ... for update ... limit 1` (the row lock that closes the
     race) then `update ... set credits_remaining = credits_remaining - 1`,
     scoped to `auth.uid()` internally (never a client-passed user id), one
     atomic transaction. `ai-import/index.ts`'s
     `consumeOneCreditIfOverAllowance()` now just calls `supabase.rpc('consume_ai_import_credit')`
     — no client-side read-then-write at all.
     **SERVER-CONTROLLED AUDIT — every other table checked**: reviewed every
     RLS write policy in the live public schema for the same shape (a
     client-writable column the business logic depends on for a
     usage/allowance/entitlement decision). Found clean: `ai_usage_log`
     (insert-own-only, append-only, never updated), `ai_usage_config`
     (service_role-write-only), `account_credits` (no client write policy at
     all — only `reset-data`/referral-sync's service-role client writes it),
     `referrals` (status/qualification fields are service_role-written by
     `referral-sync` only), `profiles.plan` (protected by the pre-existing
     `protect_profile_plan_fields()` trigger, §50). `import_jobs`'s
     self-scoped UPDATE (a user can update their own job's `status`) was
     reviewed and judged NOT a financial-value hole — it drives UI-visible
     background-import progress, not a balance/credit/allowance a user could
     profit from forging.
     **§49/§58 LIVE-DB VERIFICATION**: confirmed via a direct read-only
     `information_schema.columns`/`pg_constraint` query against the linked
     project that both were, in fact, already applied (matching the owner's
     own belief) — PENDING_SQL.md's stale `[ ]` markers were simply never
     updated after the migrations actually ran. Corrected to `[x]` with a
     dated confirmation note on each.
  2. **BALANCE LEDGER ATOMICITY — 4 sites (docs/PENDING_SQL.md §60, NOT YET
     RUN)**: every one of these used to write its row (with a
     `business_balance_applied`/`business_balance_credit` tracking value
     already filled in) and THEN call `apply_business_balance_delta` as a
     SEPARATE step — if the RPC failed after the row write had already
     succeeded (nothing here was ever wrapped in a transaction), the row was
     left permanently claiming a delta that was never actually applied, with
     no rollback. Delete was worst: the row (the only record of what needed
     reversing) was removed BEFORE the reversal ran. Fixed with 4 new
     `security invoker` RPCs, each folding the row write and the balance
     delta into ONE atomic Postgres transaction, each computing its own
     delta from a FRESH, row-locked (`for update`) read of the row's CURRENT
     state — never from a value the client might have captured earlier and
     trusted stale: `record_manual_capital_transaction()` (insert + apply),
     `update_manual_capital_transaction()` (reads the row's current
     `business_balance_applied` under lock, adjusts by the DIFFERENCE only —
     never re-applies the full new amount, which would double-count),
     `delete_manual_capital_transaction()` (reverses the balance FIRST,
     deletes the row only once that's committed — a failed reversal now
     means the row is NEVER deleted, closing the "delete is worst" gap
     directly), `apply_settlement_business_balance_credit()` (the
     settlement-import path: re-reads `settlements.business_balance_credit`
     under lock rather than trusting a value computed earlier in
     `saveExtraction()`'s execution — this is also what fixes the specific
     "retry computes a 0 delta against its own stale value" bug, since
     `aiImportSave.ts` no longer writes `business_balance_credit` at INSERT/
     UPDATE time at all; it's now written ONLY by this RPC, after every
     child-row insert and the re-import cleanup have already succeeded).
     `app/src/data/capitalTransactions.ts` was rewritten around these 4 RPCs
     — `useRecordManualCapitalTransaction`/`useReimburseMyself`/
     `useUpdateManualCapitalTransaction`/`useDeleteManualCapitalTransaction`
     each now make exactly one RPC call apiece, no client-side two-step.
     **Real tests, not a fake reimplementing the RPC in JS**:
     `capitalTransactions.test.ts` (new, 14 tests — previously ZERO coverage
     for this file) exercises the REAL hooks against `fakeSupabase.ts`'s
     `.rpc()` mock, extended to model each of the 4 new RPCs' documented
     CONTRACT (insert-and-credit, update-and-adjust-by-difference,
     lock-then-reverse-then-delete) as a single JS function call — HONEST
     BOUNDARY, stated in both files' own header comments: this proves the
     CLIENT correctly calls the right RPC with the right params and handles
     the result/error correctly (a real, if narrower, bug category — wrong
     RPC name, wrong param shape, a swallowed error), not that the real SQL
     body is correct (no Deno/Postgres runtime exists in this repo's Jest
     environment, the same limitation this file has flagged at every prior
     SQL-touching pass). Tests include: a contribution/draw correctly
     crediting/debiting `business_balance`; editing UP or DOWN adjusts by
     the difference only, never double-counting; a 3-edit chain nets to
     exactly the same result as the final single state (no drift); **a
     failed delete RPC leaves BOTH the row and the balance completely
     untouched** (the literal "delete is worst, must survive until the
     reversal succeeds" proof); a full insert→edit→delete lifecycle nets to
     exactly $0 balance effect. `aiImportSave.settlement.test.ts` and
     `aiImportSave.negativeSettlement.test.ts` (pre-existing, unmodified)
     both still pass unchanged against the new RPC-based flow — traced by
     hand to confirm the new `apply_settlement_business_balance_credit` mock
     reproduces the exact same delta math the old inline `newCredit -
     previousCredit` computation did.
     `aiImportSave.errorReporting.test.ts`'s balance-update-failure test was
     updated to key its injected failure on the new RPC name
     (`rpc:apply_settlement_business_balance_credit`, not the old
     `rpc:apply_business_balance_delta`) — the old key would have silently
     stopped injecting anything, making that test falsely pass.
  3. **RESET-ALL-DATA — preflight + reordering (`supabase/functions/
     reset-data/index.ts`)**: before this fix, a schema-drift bug (a
     `profiles` column this function writes — e.g. a not-yet-run
     PENDING_SQL section — missing on the live database) meant every
     business table gets wiped, every Storage file gets deleted, and ONLY
     THEN, on the very last step, Postgres returns a generic "column does
     not exist" error — after everything irreversible has already happened.
     Fixed three ways: (a) a new `preflightCheck()` runs FIRST, before any
     write — a READ-ONLY dry run (`select` with the identical `.eq()`
     predicate and, for `profiles`, the identical column list the real
     writes use) of every table/column this function is about to touch; any
     missing table or column returns a 409 with the exact list of what
     failed, and NOTHING has been touched. (b) The profiles data-field
     update — the "column-dependent" step most likely to fail on a schema
     mismatch — now runs FIRST, before any destructive delete, so even a
     residual failure the preflight somehow missed (e.g. a column dropped
     in the narrow window between the preflight read and this write) still
     leaves every table/file untouched rather than "already destroyed with
     a generic error." (c) The table-delete loop no longer aborts on the
     first failure — every table is attempted, and a partial failure
     returns a structured report (`tablesSucceeded`/`tablesFailed`/
     `storageErrors`) instead of a single generic message, so the caller can
     tell exactly how far the reset got. Every step remains independently
     idempotent (a no-op if already reset/already empty), so re-running the
     whole function after ANY failure — preflight, profile update, table
     delete, or storage — is always safe. **Honestly flagged**: this fix has
     no Jest test — the entire change lives in Deno Edge Function code with
     no client-side TypeScript counterpart to exercise, same "no Deno test
     runtime available" limitation this file has documented at every prior
     Edge Function pass; hand-reviewed line by line instead of fabricating
     false coverage.
  4. **UNBOUNDED QUERIES — ordering, pagination, and scoped invalidation**:
     two fixes, `app/src/data/entityHooks.ts` and
     `app/src/data/queryInvalidation.ts`.
     - **`useEntityList()` ordering (universal, safe — same row set, just a
       defined order)**: every list query used to fetch a table's entire
       row set with NO `order by` at all — whatever order Postgres happened
       to return, forever, for every table. `ORDER_COLUMN` (exported,
       tested) maps each table to its real natural date column — verified
       against `docs/SCHEMA.sql`/`app/src/types/db.ts`'s own type
       definitions, not guessed (`settlements` → `week_ending`, `deductions`
       → `ded_date`, `loads` → `load_date`, `misc_income` → `income_date`,
       `compliance_items` → `due_date`, ... — a table with no natural
       event date, e.g. `trucks`/`drivers`/`loans`/`user_categories`, falls
       back to `created_at`). `.order(orderColumn, {ascending: false,
       nullsFirst: false})` is now applied to every `useEntityList()` call,
       every table, unconditionally.
     - **`useEntityListPaged()` — a new, OPT-IN, real infinite-scroll
       mechanism**, built on `useInfiniteQuery`, real page-size/range
       math, tested. Deliberately does NOT replace `useEntityList()` or get
       force-retrofitted into today's list screens: Deductions/Settlements/
       every other list screen's own totals-bar/chart computes over the
       FULL period's client-side data (This Month/3M/YTD/All), and every
       aggregate consumer (`dashboardStats.ts`'s fleet/driver stats,
       `capitalAccount.ts`'s summary, true-profit/CPM/tax-estimate
       calculations) needs the complete row set to sum correctly — silently
       windowing `useEntityList()`'s DEFAULT behavior to "current year" or
       "most recent N" would have been a real correctness regression (wrong
       totals shown to a user), not just a performance fix. The MECHANISM
       is real and ready (most-recent-N chosen over a calendar-year cutoff,
       the spec's own explicit "or", since a Jan 1 calendar-year window
       would show an empty/near-empty screen right when a new year starts —
       reads as broken, not paginated); adopting it in a specific
       browse-only screen is flagged as a follow-up, screen-by-screen
       decision requiring its own aggregate-math rework, not silently
       done here.
     - **Scoped invalidation — `invalidateFinancialData(queryClient,
       {entities})`**: editing one deduction's category used to invalidate
       all ~28 entity tables plus every aggregate (32 total
       `invalidateQueries` calls) regardless of what actually changed —
       `invalidateFinancialData()` was called this way from ~90 call sites
       across ~34 screens (the "ONE REFRESH PATH" pass's own deliberate
       design, so this fix narrows scope without reverting that pass's
       actual goal: every mutation still refreshes every screen that
       genuinely depends on it). `AGGREGATE_DEPENDENCIES` (new, tested) maps
       each derived aggregate query key to the real table(s) it reads from
       — verified by directly reading each aggregate's own fetch function
       (`dashboardStats.ts`'s `fetchFleetStats()`/`fetchDriverStats()` only
       ever query `settlements`/`deductions`/`loads`; `capitalAccount.ts`'s
       summary only ever queries `capital_transactions`/`profiles`), not
       guessed from screen names. Passing `{entities: [...]}` — the specific
       table(s) a mutation actually wrote to — now invalidates only those
       tables plus whichever aggregates depend on at least one of them;
       omitting `entities` (pull-to-refresh, Reset All Data, a settlement/
       legacy-backup import that touches nearly everything anyway) keeps
       the full, unconditional sweep, unchanged. Also removed two genuinely
       DEAD entries from the aggregate list, confirmed by reading every
       actual fetch site: `'profit-loss'` was never a real query key
       anywhere in the app (`operating-pnl.tsx` computes `buildProfitLoss()`
       via a plain `useMemo`, no cached query of its own); `'tax_config'`/
       `'tax_year_data'` self-invalidate independently in `taxConfig.ts`'s
       own `onSuccess` and are never derived from any OTHER table's
       mutation, so including them in every other mutation's sweep was pure
       waste. Rolled out across every real call site (`deductions.tsx`'s 7,
       `settlements.tsx`'s 8, `capital-account.tsx`'s 7,
       `accountant-package.tsx`'s 3, `scorecard.tsx`'s 4, `documents.tsx`'s
       3, `maintenance.tsx`'s 4, `drivers.tsx`'s 4, plus every
       single-entity screen — credit cards, compliance, category learning,
       tolls, asset register, loans, reimbursements, loads, other income,
       equipment, fuel, trucks, bank statements, truck health's Mark-as-Done,
       Home's expense-row delete); pull-to-refresh handlers, Reset All Data,
       settlement import, and legacy-backup import were all deliberately
       LEFT as the full unscoped sweep, each with an inline comment
       explaining why enumerating specific entities wasn't safe/possible
       there.
     - **Measured before/after, the requested scenario**: editing one
       deduction's category (`deductions.tsx`'s `handleSaveEdit`, which
       always touches `deductions` and may touch `capital_transactions` via
       `applyContributionSync()`) — **32 `invalidateQueries` calls before
       this fix, 5 after** (`deductions`, `capital_transactions`,
       `fleet-stats`, `driver-stats`, `capital-account-summary`), an 84%
       reduction — measured directly in
       `queryInvalidation.test.ts`'s "the EXACT reported scenario" test
       (calls the real unscoped sweep once to get the real 32-count, not a
       hand-counted guess, then asserts the scoped call's exact 5-key set)
       rather than hand-counted.
  **Deliverables**: 105 suites / 2578 tests pass (`capitalTransactions.test.ts`
  and `entityHooks.test.ts` new, `queryInvalidation.test.ts` and
  `aiImportSave.errorReporting.test.ts` extended/updated); `tsc --noEmit`
  clean. `docs/PENDING_SQL.md` §59 and §60 are **NOT YET RUN** — both must
  be applied via the Supabase SQL Editor before this pass's client/Edge
  Function code will work correctly (the RPC calls will 404/error against a
  database that doesn't have them yet). `supabase/functions/ai-import/
  index.ts` (§59's RPC-based credit consumption) and `supabase/functions/
  reset-data/index.ts` (preflight + reordering) were both modified and
  **need redeploying**. `app/src/data/aiImportSave.ts`/
  `app/src/data/capitalTransactions.ts`/`app/src/data/entityHooks.ts`/
  `app/src/data/queryInvalidation.ts` and every screen listed above are
  pure client-side changes — no native dependency added, ships via a normal
  `eas update` once §59/§60 have been run (the client code calls RPCs that
  don't exist yet otherwise). No i18n changes this pass (no new user-facing
  strings — every fix is internal data-layer/security/performance work).

- ACCOUNTANT REPORT — SUMMARY VS DETAILED EXPORT (owner decision,
  web-parity pass, no SQL). The web PDF always lists every line item;
  mobile's PDF/Excel export already did too (confirmed by reading
  `accountantPackageReport.ts` before writing anything — `categorySections`
  already rendered every `cat.items` row unconditionally) — what was
  actually missing was a FASTER summary-only option and real vendor/
  invoice enrichment on the detailed rows, both now added.
  1. **Format selector, remembered across sessions** (spec item 1):
     `app/(tabs)/more/accountant-package.tsx` gained a Format Pill row
     (Summary/Detailed) next to the existing Year/Month/Scope pills, with
     a one-line note under it explaining the current choice. The choice
     is cached in `AsyncStorage` via a new `src/data/accountantReportFormat.ts`
     (`getCachedReportFormat()`/`setCachedReportFormat()`) — the SAME
     lightweight, per-device-preference pattern `src/i18n/localeStorage.ts`
     already established for the user's language choice (a genuine UI
     tool default, not account data worth a `profiles` column or syncing
     across devices). Applies identically to both PDF and Excel, since
     both already render from the ONE shared `buildAccountantReportHtml()`
     template.
  2. **The actual SUMMARY/DETAILED branch**: `accountantPackageReport.ts`'s
     `buildAccountantReportHtml()` gained a 4th parameter,
     `format: ReportFormat = 'detailed'` — defaulting to 'detailed'
     specifically so every EXISTING caller (and every pre-existing test)
     keeps producing exactly what it always has, with zero call-site
     changes required elsewhere. `'summary'` renders category subtotals
     (with their Schedule C chip), Lumper Fees' own total-only line, the
     per-diem block, capital assets, and owner's-equity totals — but skips
     every individual `cat.items`/`lumperFees` row AND the "Paid with"
     column header (nothing to head, since no item rows render under it).
     `'detailed'` is the pre-existing always-itemized behavior, now
     explicitly named as its own mode rather than the only mode.
  3. **Vendor/invoice enrichment, genuinely new data on the line item**
     (spec item 2, "include vendor and any invoice/order number
     captured"): `LineItem` (`accountantPackage.ts`) gained `vendor:
     string | null` and `reference: string | null` — a deduction's own
     already-captured `store` becomes its vendor (no invoice concept for
     a deduction, always null); a maintenance record's own already-
     captured `vendor`/`invoice_number` map straight across; fuel
     (`location` is already the description itself) and tolls (no
     vendor/invoice concept at all) always leave both null — real data
     this app already stores on import/manual entry but had never
     surfaced on a line item before this pass. `lineItemRow()` appends
     `(vendor)` and ` — Inv# {reference}` to a DETAILED row's own
     description ONLY when present — `description` itself is untouched
     (still drives category grouping/summary display unchanged), and
     these suffixes are only ever rendered in DETAILED mode. "Don't
     truncate item names, wrap them": the description table cell already
     had no `white-space:nowrap`/`overflow:hidden` (only the `.amt`
     column does) — wrapping was already the HTML default, confirmed by
     reading the CSS before claiming this was fixed, not assumed.
  4. **Same footer/header, both formats** (spec item 3): `headerLine`
     (company — truck unit — period — scope) and every footer note are
     built and passed through completely unchanged regardless of
     `format` — the format parameter only ever gates which BODY rows
     render, never the identity/footer strings.
  5. **File naming** (spec item 4, "…-july-2026-out-of-pocket-detailed.pdf"):
     a new pure `buildAccountantReportFilename(year, month, scope, format,
     extension)` (`accountantPackageReport.ts`) builds this exact slug
     from FIXED, non-localized English month names + scope/format words
     (`out-of-pocket`/`settlement-withheld`/`combined`,
     `summary`/`detailed`) — deliberately NOT the screen's own translated
     Pill labels, since a shared/downloaded file's NAME should stay
     portable across every locale/OS/share target even though its
     CONTENT is fully localized (matches the pre-existing Excel export's
     own already-unlocalized filename precedent). Excel already wrote its
     own named file (`new File(Paths.cache, filename)`) — now uses this
     shared builder instead of its own inline one. PDF is the genuinely
     new half: `expo-print`'s `printToFileAsync()` always returns an
     auto-named temp file with no filename option of its own, so the
     handler now copies it (`new File(uri).copy(renamed)`, `expo-file-
     system`'s documented `File.copy()`) to a File built from this same
     slug before calling `Sharing.shareAsync()` — whatever the user
     saves/forwards is properly named, not a random `expo-print-XXXX.pdf`.
  Tests: `accountantPackage.test.ts` gained `buildLineItems()` coverage
  for the vendor/reference mapping (deduction→store, maintenance→vendor+
  invoice_number, fuel/toll always null, a genuinely-uncaptured vendor
  stays null rather than a guess). `accountantPackageReport.test.ts`
  gained a full "SUMMARY vs DETAILED format" block against ONE shared
  multi-category/multi-item fixture (spec item 5's own explicit asks):
  DETAILED contains every line item's description; SUMMARY contains NONE
  of them while still showing every subtotal; category AND Lumper Fees
  subtotals are proven to literally equal the sum of their own detailed
  line items in BOTH rendered outputs ("they reconcile exactly," the
  fixture's own `cat.amount === sum(cat.items)` invariant asserted
  directly, not just assumed from `groupLineItemsByScheduleCBucket`'s own
  separately-existing "every group's own items sum to its own amount"
  test); vendor/reference enrichment appears in DETAILED and is fully
  absent from SUMMARY; an unset format defaults to byte-identical
  DETAILED output; scope/period filtering (upstream in `buildLineItems()`,
  which this module has no parameter for at all) is proven to apply
  identically regardless of format; an empty Lumper Fees list omits the
  section header in both formats. Plus a dedicated
  `buildAccountantReportFilename()` block (the exact spec example
  reproduced verbatim, the "All Year" year-only slug, every scope/format
  value producing its own distinct slug, real English month names not
  zero-padded numbers). Full suite: 103 suites / 2550 tests pass; `tsc
  --noEmit` clean; all 7 locales confirmed key-parity
  (`accountantPackage.formatLabel`/`formatSummary`/`formatDetailed`/
  `formatSummaryNote`/`formatDetailedNote`/`referenceLabel` — es/ru/ar/tr
  fully translated, hi/uk as untranslated English copies per invariant
  #11; glossary test re-passed clean). No SQL changes — every field this
  pass reads (`deductions.store`, `maintenance_records.vendor`/
  `invoice_number`) already existed. No Edge Function redeploy needed —
  every change in this pass is pure client-side JS/TS. No new native
  dependency (`expo-file-system`'s `File.copy()` was already available in
  the existing dependency) — ships via a normal `eas update`. HONESTLY
  FLAGGED, not device-verified: `File.copy()`'s behavior copying FROM an
  `expo-print`-generated temp URI specifically was reviewed against the
  documented API surface, not exercised on a real device from this
  environment (no Deno/Expo runtime available here, same standing
  limitation this file has flagged at every prior native-API-touching
  pass) — worth a real-device smoke test on the next PDF export before
  fully trusting it in the field.

- PER DIEM YTD BUG FIX + DEDUCTIONS/SETTLEMENTS TOTALS & CHARTS (owner
  decision, two-part pass, no SQL — every table/column both parts read
  already existed).
  PART 1 — PER DIEM YTD BUG: device report — the accountant report showed
  the SAME number for "this month" and "year-to-date" (both 35 days).
  Root cause, found by reading `buildPerDiemBlock()`
  (`src/stats/accountantPackage.ts`), not guessed: whenever the report's
  own Month pill was set to "All Year" (`month === null`), the old code's
  `month == null ? ytdSettlements : ytdSettlements.filter(...)` fed the
  EXACT SAME settlement array into both the "month" and "YTD"
  calculations — genuinely the same bucket, not a coincidence, and
  reproducible on any account with 2+ months of settlement history.
  Fixed: `monthDays`/`monthDeduction` are now `number | null` — `null`
  whenever there is no genuinely narrower month selected, NEVER a number
  silently equal to `ytdDays`/`ytdDeduction`. `ytdDays`/`ytdDeduction`
  were already correct (always every settlement in the selected YEAR,
  regardless of month scope) and are unchanged. The screen
  (`app/(tabs)/more/accountant-package.tsx`) and the shared PDF/Excel
  report template (`src/stats/accountantPackageReport.ts` — both exports
  render this exact same HTML, so fixing it once covers both) now render
  the "This Month" row ONLY when `monthDays != null`; "All Year" shows
  just the YTD row, never a duplicate. The Deductible-Expenses summary
  card's own compact per-diem sub-line — previously always labeled "This
  Month" even in All-Year scope — is now a scope-neutral "Per Diem
  Deduction" label (`accountantPackage.perDiemDeductionLabel`, new key)
  showing `monthDeduction ?? ytdDeduction`, so it's never mislabeled
  either. AUDITED for the same bug class elsewhere in the report (spec's
  own "check the same class of bug on the per-diem dollars and any other
  YTD figure"): grepped the whole `accountantPackage.ts`/
  `accountantPackageReport.ts`/screen for every "ytd"/"YTD" occurrence —
  per diem is the ONLY YTD concept in this report; no second instance of
  this bug class exists to fix. Tests: `accountantPackage.test.ts` gained
  a two-month-dataset case reproducing the EXACT reported symptom (35
  days in June, 42 YTD across June+July) proving `monthDays <
  result.ytdDays` strictly, plus a dedicated "All Year never equals YTD"
  case proving `monthDays`/`monthDeduction` are `null`, never a repeated
  number. `accountantPackageReport.test.ts` gained matching HTML-output
  cases (both rows render distinctly when a month is selected; the "This
  Month" label/row is entirely absent from the HTML when it isn't) —
  since the PDF and Excel exports share this exact HTML, one test proves
  both surfaces. "On screen" correctness is structural, not separately
  tested — this repo has no RN rendering harness (same limitation this
  file has flagged at every prior UI-testing juncture); the screen reads
  the SAME `buildPerDiemBlock()` result the tests directly exercise.
  PART 2 — DEDUCTIONS & SETTLEMENTS TOTALS + CHARTS: three new shared,
  pure modules — `src/stats/periodFilter.ts` (`PERIOD_OPTIONS =
  ['thisMonth', '3M', 'ytd', 'all']`, `filterByPeriod()`,
  `bucketGranularityFor()` — 'ytd' is a real CALENDAR-YEAR window, Jan 1
  through today, per CLAUDE.md's own established "not a rolling 365
  days" rule, deliberately distinct from '3M''s rolling-90-day window
  the same way `heroPeriod.ts`'s own '3M' tab already works — precisely
  the class of month-vs-YTD confusion PART 1 exists to prevent, applied
  here from the start rather than fixed after the fact), used by BOTH
  screens so they can never disagree about what a period tab means;
  `src/stats/deductionsSummary.ts` (`buildDeductionsTotalsBar()` — reuses
  the EXISTING canonical `groupDeductions()`/`isSettlementDed()` origin
  split, Total = literally Out-of-Pocket + Withheld so it always visibly
  reconciles, `nonDeductibleAmount` computed from the SAME canonical
  `NON_DEDUCTIBLE_CATEGORIES` set `trueProfit.ts`'s own exclusion list
  mirrors — informational only, never changes what Total displays;
  `buildDeductionsChartSeries()` — weekly buckets (`isoWeekKey()`) for
  "This Month," monthly (`YYYY-MM`) for longer periods, two independent
  running sums per bucket; `buildTopCategories()` — top N by amount,
  share relative to the shown total; `toggleDeductionSeries()` — the
  chart's own two legend chips share ONE state with the pre-existing All/
  Out-of-pocket/Settlement segmented Pill row, deliberately made to
  behave IDENTICALLY to tapping the matching Pill — tapping "Out-of-
  Pocket" isolates to out-of-pocket either way, so the same-labeled
  control never means opposite things in two places); and
  `src/stats/settlementsSummary.ts` (`buildSettlementsTotalsBar()` — a
  plain sum of gross/net/miles over whatever settlements the caller has
  already period-filtered, the EXACT SAME summation
  `dashboardStats.ts`'s fleet-wide `FleetStats` already uses
  (`grossRevenue = sum(gross)`, `netRevenue = sum(net)`), just applied to
  a filtered subset — never a second gross/net formula; `avgRpm =
  gross/miles`, `null` rather than a divide-by-zero when there are no
  miles). The Settlements chart reuses the EXISTING
  `buildWeeklyTrend(settlements)` unchanged (already exactly "gross
  revenue and net pay per settlement week") — period filtering only
  narrows which settlements are fed into it.
  `app/(tabs)/deductions.tsx`: a new totals bar (💳 Out-of-Pocket / 🏦
  Settlement-Withheld / 📋 Total, each tile tappable — isolates that
  origin, mirroring the Pill row) sits above period tabs (This Month/3M/
  YTD/All, "remembered for the session" via a new
  `src/lib/useSessionState.ts` — the SAME module-level-Map pattern
  `useMonthCollapse.ts` already established for exactly this class of
  requirement, generalized so both this screen and Settlements can each
  use it under their own key), a thin-line 2-series chart (`buildPolylinePoints()`,
  CLAUDE.md's CHART LANGUAGE CONSISTENCY invariant — never a thick bar)
  with tappable legend chips, and a Top Categories card (tapping a
  category narrows the list/chart further via a new local
  `categoryFilter` state, independent of period/origin). A caption under
  Total names the excluded non-deductible amount ("excludes $1,180
  meals, advances and escrow") whenever it's nonzero. Fewer than 2 chart
  buckets shows a "not enough data yet" message instead of a misleading
  chart (spec item 2f). `app/(tabs)/more/settlements.tsx`: the OLD
  always-all-time 4-tile totals card (Gross/Reimbursed/Deductions/Net,
  read from `useFleetStats(null)`) is REPLACED by the new period-tab-
  driven 3-tile bar (Gross/Net Pay/Miles + average-RPM caption) — the
  Reimbursed/Deductions figures aren't lost, they're still one tap away
  on their own dedicated screens; `useFleetStats`/`allSettlementReimbTotal`/
  `allSettlementDedTotal` were deleted outright as genuinely dead code
  once nothing referenced them (confirmed via grep before removing,
  matching this codebase's own "if unused, delete it" convention) rather
  than left as unused variables. Both screens' filter order is
  period-first, then needs-review, matching the pre-existing filter
  chain on each screen (Deductions additionally layers a category filter
  on top; Settlements has no equivalent).
  Tests: `periodFilter.test.ts` (new) — `thisMonth`/`ytd`/`3M`/`all`
  window boundaries (including the explicit "YTD always includes more
  than This Month" proof this pass' own PART 1 bug is about),
  `bucketGranularityFor()`. `deductionsSummary.test.ts` (new) — the
  canonical origin split reused verbatim (Total = Out-of-Pocket +
  Withheld), the non-deductible caption summing EXACTLY the 3 canonical
  categories and nothing else, weekly-vs-monthly chart bucketing, top-
  category ranking/share/empty-list handling, and the full
  `toggleDeductionSeries()` state machine (isolate from 'all', toggle
  back to 'all', switch between the two isolated states) proving the
  chart chips and the Pill row can never disagree. `settlementsSummary.test.ts`
  (new) — the totals bar's plain-sum math, the null-not-NaN avgRpm
  guard, and an end-to-end period-filter-into-`buildWeeklyTrend()` case
  proving the chart reuses the real canonical function rather than a
  second one. Full suite: 103 suites / 2533 tests pass; `tsc --noEmit`
  clean; all 7 locales confirmed key-parity (`accountantPackage.
  perDiemDeductionLabel`, `deductions.totalsTile*`/`period.*`/
  `chartNotEnoughData`/`topCategoriesTitle`/`clearCategoryFilter`/
  `totalsBarNonDeductibleCaption`/`allTimeSuffix`,
  `settlementsScreen.avgRpmCaption`/`period.*`/`chartNotEnoughData` — es/
  ru/ar/tr fully translated (keeping "Settlement"/"escrow" in Latin
  script per the glossary — "RPM" itself is spelled out per-language
  rather than left as a literal abbreviation, matching Cash Flow's own
  pre-existing `avgRpm` translation precedent), hi/uk as untranslated
  English copies per invariant #11; glossary test re-passed clean). No
  SQL changes. No Edge Function redeploy needed — every change in this
  pass is pure client-side JS/TS. No new native dependency — ships via a
  normal `eas update`.

- CASH FLOW MONTHLY VIEW + MULTI-FILE BACKGROUND IMPORT (owner decision,
  two-part pass, no SQL — every table/column both parts read already
  existed).
  PART 1 — CASH FLOW MONTHLY VIEW: `app/src/stats/cashFlowMonthly.ts` is a
  new, pure module — `buildMonthlyCashFlowOverview()` walks BIDIRECTIONALLY
  outward from the CURRENT month, anchored at the ONE real known figure
  (today's `cf_bank_balance`): backward reconstructs each past month's
  ACTUAL income/fixed/variable/periodic from real settlements/spend
  events/compliance items (never a guess), forward projects each future
  month from the same steady-state weekly figures (`weeklyIncome`/
  `weeklyFixed`/`weeklyVariable`, post-override) the existing 30-day
  forecast already computes — this is what makes a requested year that
  differs from the current year (a past year, all `'actual'`; a future
  year, all `'projected'`) chain correctly: the walk always resolves the
  same real anchor regardless of which 12-month window the caller actually
  asked for, proven directly by a test that calls the function twice (once
  per adjacent year) and checks December's closing balance against the
  following January's opening balance. The month `today` falls in is
  `'current'` — a blended actual-to-date (month start through today) +
  projected-remainder (tomorrow through month end) figure, "never a guess
  about days that haven't happened, never a stale figure for days that
  have." An ACTUAL month's spend events are bucketed fixed/variable using
  the SAME category sets `cashFlowClassification.ts` already determined
  account-wide (`classification.variable`'s own category list) — a
  category the classifier excluded as a one-off for the steady-state
  PROJECTION (so it doesn't inflate every future week) still folds into
  "fixed" for an ACTUAL month's own total, since a real dollar that was
  actually spent must show up somewhere, never vanish.
  `app/src/stats/cashFlowPeriodic.ts` gained `buildPeriodicItemsInRange()`
  (a `[startIso, endIso]`-bounded sibling of the existing
  `buildPeriodicForecastItems()`, which stays exactly as it was — always
  forward-only from "today," correct for the 30-day forecast) since the
  Monthly view needs a PAST month's own periodic items too (an HVUT 2290
  paid back in March is still part of March's real actuals). The Cash Flow
  screen (`cash-flow.tsx`) gained 3 period tabs — 30 Days (unchanged,
  exactly the pre-existing week-by-week view) / This Month (a single
  always-expanded `MonthCard` for the current calendar month, independent
  of the Monthly tab's own year selector) / Monthly (a Pill-based year
  selector mirroring the Accountant Package's own established pattern,
  a thin single-line "Apple Stocks style" trend of closing balance across
  the 12 months via the SAME `buildPolylinePoints`/`buildAreaPoints`
  primitive every other chart in this app already uses, a tightest-month +
  best-month highlight line via new `findTightestMonthIndex()`/
  `findBestMonthIndex()`, and a tap-to-expand `MonthCard` per month —
  collapsed by default showing just the month name/status badge/closing
  balance, expanding on tap to the identical opening/income/fixed/
  variable/periodic/closing breakdown `WeekCard` already shows for the
  30-day view, spec item 4's "same breakdown... keeping the 'where it came
  from' basis and manual overrides" — the figures already reflect
  whatever income/fixed/variable/periodic overrides are set, since every
  period reads from the exact same `forecast.weeklyIncome`/`weeklyFixed`/
  `weeklyVariable`/`overrides` the 30-day view uses, computed once and
  shared). A projected month renders at 65% opacity with a "PROJECTED"
  badge (spec item 2, "clearly distinguished"); the current month gets a
  "THIS MONTH" badge instead (a blend, not a pure projection, so it isn't
  dimmed).
  PART 2 — MULTI-FILE BACKGROUND IMPORT: builds directly on the pre-
  existing `import_jobs` background-job system (server-tracked rows,
  `EdgeRuntime.waitUntil()`-driven processing in `ai-import`, per-document
  monthly usage allowance) — no Edge Function changes were needed, since a
  batch is purely a CLIENT-side orchestration of N calls to the exact same
  already-existing `mode: 'job'` endpoint.
  1. **Multi-file picker + batch enqueue** (spec item 1): `pickPdf()`
     (`app/(tabs)/import/index.tsx`) now calls `DocumentPicker.
     getDocumentAsync({..., multiple: true})` — a single pick (still the
     common case) is completely unchanged, routing through the exact
     pre-existing one-job `startBackgroundJob()` path; 2+ files branch into
     `startBatchImport()`. Capped at `MAX_BATCH_IMPORT_FILES = 10`
     (`app/src/import/importJobs.ts`, "configurable" per spec item 1 — one
     constant to change) with a friendly "only the first 10 were selected"
     notice rather than a silent truncation; oversized files (the existing
     10 MB per-file guard) are filtered out with their own notice before
     anything else happens. Each file becomes its own `import_jobs` row via
     the NEW `useStartImportJobsBatch()` (`app/src/data/importJobs.ts`),
     which reuses the exact same per-file upload+invoke logic the single-
     file `useStartImportJob()` already had (extracted into a shared
     `startOneImportJob()`) run through a new, pure, fully-injectable
     `runBatchWithConcurrency()` (`app/src/import/importJobs.ts`) — the
     CLIENT-side counterpart to `ai-import/chunking.ts`'s own server-side
     `runWithConcurrencyLimit()` (CLAUDE.md's SPEED UP SETTLEMENT IMPORT
     entry), at a modest `BATCH_START_CONCURRENCY = 3` rather than firing
     all N uploads at once (the exact contention risk that pass's own
     history already worked through) or fully serial (slow for a real
     10-file batch). "A failed item never blocks the others" (spec item 5)
     is what this function's own per-item try/catch guarantees — one
     file's upload/invoke failure is captured as `{item, error}` without
     stopping or skipping any other file's own attempt, and every result
     stays correctly paired with its own input item regardless of actual
     completion order.
  2. **Allowance pre-check, client-side by design** (spec item 4, task
     "batch usage-allowance check"): `app/src/usage/aiUsage.ts`'s new
     `planBatchImportCapacity(batchSize, usage, availableCredits,
     bypassesLimit)` — remaining monthly allowance first, then spills into
     available credits, `willProcess`/`willBeBlocked`/`usesCredits`
     computed without starting a single job. Deliberately built on the
     SAME client-RLS-readable read `useAiUsageDisplay()`
     (`app/src/data/aiUsageDisplay.ts`) already performs for Settings'
     usage display (a direct read of `ai_usage_log`'s monthly count +
     `ai_credit_purchases`) rather than a new Edge Function endpoint — this
     is explicitly an ESTIMATE for the up-front message only ("say up
     front how many will process... rather than silently truncating"); the
     real, authoritative gate remains exactly what it already was, the
     server's own per-document check inside `ai-import` at the moment each
     job actually runs, unweakened and unbypassed by this pre-check. When
     `willBeBlocked > 0`, `confirmBatchWillBeBlocked()` shows the exact
     up-front figures via `Alert` with three choices — Cancel, Get Credits
     (routes to Settings, where the credit-pack offers already live, PART 5
     of the FIVE ADDITIONS pass), or Continue with N (only offered when
     `willProcess > 0`) — proceeding always uses only the FIRST `willProcess`
     files from the batch, in picked order, never a silent drop. An owner
     account (`bypassesUsageLimit`) always gets `willProcess === batchSize`,
     matching the existing owner-bypass precedent.
  3. **Import Queue view** (spec item 2): mostly ALREADY BUILT by the prior
     BACKGROUND IMPORT pass — `app/(tabs)/import/jobs.tsx`'s `JobRow`
     already showed filename, a per-status label (including
     `waiting_to_retry`), the "page N of M" progress granularity
     (`importJobs.pageProgress`), and per-item Review/Retry/Dismiss
     actions; confirmed unchanged. The one addition this pass made:
     a "Review All (N)" button (shown whenever 2+ jobs are `'ready'` at
     once) that launches the batch review flow below.
  4. **Batch review flow, Next/Skip without returning to the queue**
     (spec item 3): `app/(tabs)/import/index.tsx` gained a new
     `?reviewJobIds=a,b,c` route param (alongside the pre-existing single
     `?reviewJobId=X`, unchanged) — a small state layer (`currentReviewId`/
     `batchQueue`/`batchTotal`/`batchPosition`) resolves EITHER param down
     to one `currentReviewId` the EXISTING review-loading effect
     (`fetchImportJobForReview`/`downloadImportJobFileToLocal`/
     `afterExtraction`) already acts on — single-job and batch reviews
     share 100% of the same load/save/dismiss code path per document, so
     "the reconciliation guard and needs-review rules still apply per
     document" is structural, not a separate re-implementation. A new pure
     `nextBatchReviewStep(queue)` (`app/src/import/importJobs.ts`, "pop the
     next id off the queue") drives `advanceBatchReview()` — called by
     Skip (the preview phase's Discard button doubles as Skip while
     `batchTotal > 0`, and the error phase gains its own dedicated Skip
     button so one failed document can't stall the walkthrough) and by
     "Next Document" (the done phase's primary action once `batchTotal >
     0`, replacing the ordinary Import-Another/Done pair — becomes
     "Finish" and returns Home on the last document). "Nothing saves
     without confirmation" (spec item 3) is unchanged from the single-file
     flow — Save is still one explicit tap per document, Skip/Next never
     calls `saveExtraction()`. A "Reviewing N of M" progress line is shown
     above every phase while `batchTotal > 0`.
  Tests: `src/stats/__tests__/cashFlowMonthly.test.ts` (new, 20 tests) —
  actual/current/projected status classification, actual months computing
  from real settlement/event data (including the unclassified-category-
  folds-into-fixed rule), projected months scaling the weekly steady-state
  figures by each month's own day count, the current month's actual-to-
  date/projected-remainder blend, balance chaining within a year AND
  across a year boundary (both a past-year and a future-year case),
  overrides applying identically to actual/projected months, and
  `findTightestMonthIndex`/`findBestMonthIndex`. `src/import/__tests__/
  importJobs.test.ts` gained `runBatchWithConcurrency` (the concurrency
  cap is honestly respected; the spec's own required "10 files enqueue and
  complete out of order without mixing results" proof via inverted
  per-item delays; one failure never stops or skips any other task; empty
  input; a limit larger than the item count) and `nextBatchReviewStep`
  coverage. `src/usage/__tests__/aiUsage.test.ts` gained
  `planBatchImportCapacity` coverage (fits entirely within the allowance;
  exceeds it and reports the real blocked count rather than silently
  truncating; spills into credits once the allowance is exhausted; blends
  both; the owner bypass; a zero-capacity batch reports 0 processing, never
  a negative number). Full suite: 100 suites / 2478 tests pass; `tsc
  --noEmit` clean; all 7 locales confirmed key-parity (`cashFlowScreen.*`
  period/month-view keys + `importJobs.batch*`/`skipDocument`/
  `nextDocument`/`finishReview`/`reviewAll` — es/ru/ar/tr fully translated,
  hi/uk as untranslated English copies per invariant #11; glossary test
  re-passed clean). No SQL changes — every table/column both parts read
  (`profiles.cf_*`, `settlements`, `deductions`, `compliance_items`,
  `import_jobs`, `ai_usage_log`, `ai_credit_purchases`) already existed.
  `ai-import`/`ai-advisor`/`reset-data`/`delete-account`/`referral-sync`
  were NOT touched — no Edge Function redeploy needed for either part. No
  new native dependency (`expo-document-picker`'s `multiple` option was
  already available in the existing dependency) — ships via a normal
  `eas update`.

- OWNER/DEV ACCOUNT FLAG (owner decision, docs/PENDING_SQL.md §58).
  `profiles.plan` (docs/PENDING_SQL.md §50) gains a 5th value, `'owner'`
  — the app owner's/developer's own account, for heavy testing without
  hitting the AI-import allowance and without skewing usage/cost
  analytics used for pricing decisions. Same column-level protection as
  `'lifetime'`/`'complimentary'` already had — `protect_profile_plan_fields()`
  (§50) protects the whole `plan` column regardless of value (service_role
  or the `postgres` role only), so the CHECK constraint just widens, no
  trigger change needed — a client can never set this value either, same
  as every other plan value.
  1. **BYPASSES the monthly AI-import allowance entirely** (item 1) —
     `supabase/functions/ai-import/index.ts`'s `checkAiImportUsageAllowed()`/
     `consumeOneCreditIfOverAllowance()` both query `profiles.plan` FIRST,
     before any of the counting queries (`ai_usage_config`/`trucks`/
     `ai_usage_log`/`ai_credit_purchases`), and short-circuit immediately
     for `'owner'` — no counter, no 80% soft-limit notice, no hard limit,
     no credit-pack prompt, anywhere. `ai-advisor` was checked and
     confirmed to have no equivalent allowance gate at all (only
     `ai-import` does, per the original FIVE ADDITIONS pass's own scope),
     so no change was needed there.
  2. **EXCLUDED from usage analytics and per-user cost reporting by
     default** (item 2) — `docs/ADMIN_RUNBOOK.md`'s two real cross-user
     AGGREGATE queries (the failure-cause breakdown in "AI Import
     Reliability" recipe #2, and "Review AI usage/cost per user" in "AI
     Cost Control" recipe #3) both gained a `join profiles p on p.user_id
     = l.user_id` + `and p.plan is distinct from 'owner'` filter, each
     with an inline comment showing exactly how to remove that one line
     when the TRUE infrastructure cost (including the owner's own usage)
     is actually wanted. Deliberately NOT applied to single-row/per-email
     lookups or raw event listings (recipe #1 in either section, the
     "list every non-paying account" plan-status listing) — those aren't
     aggregates a skewed sample could distort, and seeing your own test
     failures in a raw event list is exactly what you'd want when
     debugging.
  3. **STILL fully respects the shared rate-limit cooldown** (item 3) —
     deliberately untouched: `getRateLimitCooldownMs()`/
     `ai_rate_limit_state` inside `extractOnePass()` (the actual
     Anthropic-call chokepoint) has no plan check at all, so an owner
     account backs off exactly like every other account when the shared
     Anthropic API key gets rate-limited — bypassing that would risk real
     users, not just this one account's own allowance.
  4. **Settings badge + never sees upgrade/paywall UI** (item 4) —
     `app/src/entitlement/hasFullAccess.ts` gained `isOwnerAccount()`,
     deliberately a SEPARATE helper from the existing `isOwnerGrantedPlan()`
     (whose similar name means something different: "a plan the business
     owner granted to a CUSTOMER for free" — an owner account gets its own
     "🛠️ Owner account" Settings badge, never the lifetime/complimentary
     wording). `hasFullAccess()` itself now returns `true` for `'owner'`
     too, so the app's one existing usage-limit-adjacent UI (Settings'
     whole "AI Usage" card — the counter, soft/hard-limit notices, credit-
     pack prompts) is hidden entirely for an owner account
     (`app/src/data/aiUsageDisplay.ts`'s `useAiUsageDisplay(isOwner)` also
     skips its own two queries in that case, not just hiding already-
     fetched data) — confirmed via the same repo-wide audit the original
     LIFETIME / COMPLIMENTARY ACCOUNTS pass already did that no OTHER
     paywall/upgrade-prompt surface exists yet to gate.
  5. **No hidden dev-only behavior elsewhere** (item 5) — verified by
     construction: every other access-gating check in the app reads
     `hasFullAccess()`, which treats `'owner'` identically to `'paid'`/
     `'lifetime'`/`'complimentary'` — there is no second, owner-specific
     code path anywhere else that could mask a bug a real user would hit.
  Tests: `hasFullAccess.test.ts` gained `'owner'` coverage (passes
  `hasFullAccess()`, does NOT count as `isOwnerGrantedPlan()`, and a new
  `isOwnerAccount()` describe block proving true only for `'owner'` and
  false for every other plan including the other full-access ones — "a
  normal account is unaffected"). `aiUsage.test.ts` gained
  `bypassesUsageLimit()` coverage (the client-side display-layer mirror).
  Honestly scoped, same limitation as every prior ai-import pass: the
  ACTUAL server-side allowance bypass and the `protect_profile_plan_fields()`
  trigger's column-level protection are both Deno/Postgres-only with no
  live runtime available in this environment — hand-reviewed rather than
  unit-tested, not fabricated coverage. Full suite: 99 suites / 2442
  tests pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity
  (`settings.ownerAccountBadge`, es/ru/ar/tr translated, hi/uk as
  untranslated English copies per invariant #11; glossary test re-passed
  clean — "owner" is a plain English UI word here, not a glossary term).
  `ai-import` was modified (the two usage-gate functions) and needs
  redeploying; `ai-advisor`/`reset-data`/`delete-account`/`referral-sync`
  were NOT touched. No new native dependency — pure JS/TS plus one small
  SQL migration — ships via a normal `eas update`.

- ACCOUNTANT PACKAGE — FULL VISUAL PARITY WITH WEB (owner decision,
  v2026.08.05-W chase, no SQL). The screen was functionally complete
  (FULL PARITY pass PART B, above) but visually plain — no colour coding,
  no Schedule C chips, a 2-flow Owner's Equity instead of the real 4-flow
  breakdown, no "Paid with" column, a short 2-segment header. This pass
  brings the colour language and richness to exact parity across all
  three surfaces (on-screen, PDF, Excel) without changing any of the
  underlying numbers.
  1. **ONE shared colour source, `app/src/stats/accountantPackageColors.ts`
     (new)** — `ACCOUNTANT_EXPORT_COLORS` (the exact spec hex values:
     owner-paid amber `#fef3c7`, total-expenses red `#fee2e2`, gross
     income green `#dcfce7`, capital-contributions-in green `#f0fdf4`,
     owner-draws-out light red `#fef2f2`, capital assets blue `#eff6ff`/
     header `#dbeafe`, lumper-fees header amber `#fef3c7`, subtotal grey
     `#f1f5f9`) and `ACCOUNTANT_SCREEN_COLORS` (dark-theme-aware
     translucent overlays of the SAME hue family — `rgba(245,158,11,…)`
     for amber, `rgba(239,68,68,…)` for red, `rgba(34,197,94,…)` for
     green, `rgba(37,99,235,…)` for the capital-assets blue, and
     `colors.card2` for the grey subtotal rows — this app's own existing
     secondary-surface tone, reused rather than inventing a new grey).
     Same meaning always gets the same colour family on every surface —
     a screenshot and an exported file can never visually disagree.
  2. **PDF and Excel export extracted into a new, pure, fully-testable
     module, `app/src/stats/accountantPackageReport.ts`** —
     `buildAccountantReportHtml()` used to live inline in the screen
     component (untestable without a React/Expo runtime, which this
     repo's jest setup deliberately doesn't have — CLAUDE.md's own
     standing "pure ts-jest, no jest-expo" convention). Same "pure
     function, caller owns i18n via t()" pattern as
     unlockNudgePresentation.ts/coachNudgeText.ts: the screen resolves
     every string via `t()` into a flat `AccountantReportStrings` object
     and passes `money`/`date` as plain formatter functions — this module
     itself has zero i18next/React/Expo dependency. Both the PDF export
     (`expo-print`) and the Excel export (same HTML, `.xls`-extension
     trick) call the exact same function, so proving the HTML has the
     amber owner-paid treatment covers BOTH export surfaces in one test,
     by construction — there is no separate PDF-only or Excel-only code
     path that could diverge.
  3. **Line items now carry `paymentMethod`** (`accountantPackage.ts`'s
     `LineItem` type) — only ever populated for a `deduction`-kind row
     (`d.payment_method`, one of the 9 generic values, CLAUDE.md
     invariant #2 — never translated, a domain value like every other
     enumerated field per invariant #11); always `null` for fuel/
     maintenance/toll rows, which have no such concept and are never
     flagged owner-paid. Rendered as an actual "Paid with" GRID COLUMN in
     both exports (spec's literal ask); on a narrow phone screen the same
     information is shown inline under the row instead ("Paid with:
     Cash") to avoid a 3rd-column overflow on mobile — same information,
     an honest adaptation to the surface, not a gap.
  4. **Owner's Equity is now the real FOUR-FLOW breakdown**, not the old
     2-row cash/linked summary — `buildOwnersEquity()` gained a `flows:
     CapitalFlowsSummary` field by calling the EXISTING
     `summarizeCapitalFlows()` (Capital Account screen's own "Where your
     equity comes from" card, PART E/F passes above) rather than a second,
     potentially-disagreeing computation: cash contributed (green-in),
     expenses paid personally outstanding (green-in, netted against
     whatever's already been reimbursed for that specific expense — a
     real device-verified case: a $200 linked contribution with a $50
     reimbursement-taken-back nets to $150 outstanding, not $200),
     reimbursements taken back (light-red-out), owner draws (light-red-
     out), and Net Position — each flow rendered with its own accountant-
     facing one-liner note (`cashContributedNote`/
     `expensesPaidPersonallyNote`/`reimbursementsTakenBackNote`/
     `ownerDrawsNote`). `netPosition` is proven by test to equal the exact
     same figure `calcCapitalAccount()`'s own effectiveContribution-
     totalDraws formula would produce for identical data — the two
     screens can never disagree.
  5. **Schedule C reference chips** — the "(Line 21)" text that used to
     trail a category name inline is now a small blue pill (`ScheduleCChip`
     on-screen, `.chip` CSS class in the export), matching the "BLUE...
     Schedule C reference chips" spec line.
  6. **Shared category grouping**, `groupLineItemsByScheduleCBucket()`
     (new, `accountantPackage.ts`) — extracted so the on-screen category
     table and the exported category table group individual line items
     under each category header IDENTICALLY (previously the export only
     showed category SUBTOTALS, no line-item detail at all — the owner-
     paid amber treatment + Paid With column could only ever appear in
     the Lumper Fees export section, never in the main category table).
     Groups by the SAME resolved Schedule C bucket `buildScheduleCTotals()`
     itself used (not the raw `category` string) — the exact "a custom
     category whose bucket differs from its own name silently vanishes
     from its group's row list while still counting toward the total" bug
     this pattern already fixed once, regression-guarded again here.
  7. **Header identity, all three surfaces**: `buildHeaderLine(scopeYear,
     scopeMonth)` composes ONE string — `company name — truck unit —
     period — scope` (spec item 3's exact 4-segment order) — reused for
     the on-screen `ScreenTitle` AND passed as-is into every export's
     `AccountantReportInput.headerLine`, so the identity line can never
     read differently between what's on screen and what's in a shared
     file. Period is `date(..., {year:'numeric', month:'long'})` (e.g.
     "August 2026") or the bare year for "All Year"; scope resolves the
     existing `accountantPackage.scope*` label. This header is now always
     populated (period+scope are never both empty) — the old
     `|| t('accountantPackage.title')` fallback for a brand-new account
     with no company/truck set is no longer reachable, since period+scope
     always contribute at least one segment; the subtitle line still
     carries the "Accountant Package" concept for discoverability.
  8. **Reconciling caption** — a new muted line
     (`accountantPackage.reconcilingCaption`, "This total reconciles with
     the category breakdown below.") under the summary tile's Deductible
     Expenses row, on-screen and in both exports.
  9. **Footer notes** (spec item 2) — three new always-shown lines: meals
     excluded under per diem, advance repayments/escrow non-deductible,
     OWNER PAID rows = Owner Contributions
     (`footerMealsNote`/`footerNonDeductibleNote`/`footerOwnerPaidNote`).
  10. **Small pre-existing i18n gap fixed in passing**: the export's own
      disclaimer text was a hardcoded, never-translated English constant
      (`const DISCLAIMER = 'Estimates only...'`) sitting right next to the
      already-translated `common.legalFootnote` key the on-screen
      `<LegalFootnote/>` component already used for the IDENTICAL text —
      the export now reuses `t('common.legalFootnote')` instead, so the
      exported file's disclaimer is translated in every locale too, not
      just the on-screen one.
  11. **i18n cleanup**: `cashTransfers`/`paidPersonally` (the old 2-flow
      Owner's Equity labels) became orphaned by item 4 above and were
      removed from all 7 locales, confirmed unused repo-wide first — the
      OTHER already-pre-existing dead legacy keys in this same i18n block
      (`scheduleCTitle`, `assetsByCategoryTitle`, `totalExpenses`, etc.,
      orphaned by an EARLIER pass, not this one) were deliberately left
      alone, same "only clean up what THIS pass newly orphaned" scope
      discipline as the FULL PARITY FOLLOW-UP PART A entry above.
  **Honest scope note on test coverage**: this repo's jest setup is
  deliberately pure-ts-jest with no React Native rendering harness (no
  `.test.tsx` files exist anywhere in this codebase, confirmed by search)
  — so "an OWNER PAID row renders with the amber treatment" is proven at
  the level this app CAN test: the exact colour tokens
  (`accountantPackageColors.test.ts`, pinned to the literal spec hex
  values) and the exported HTML's actual amber background + badge + paid-
  with column for an owner-paid row, in a fixture covering BOTH the
  Lumper Fees table and the main category table
  (`accountantPackageReport.test.ts`) — which is genuine, real coverage
  of the PDF/Excel surfaces (identical HTML, one test proves both). The
  ON-SCREEN component's own use of these same tokens
  (`ACCOUNTANT_SCREEN_COLORS.ownerPaidBg` on `LineItemRow`) is not
  independently re-verified by a render test, since no such harness
  exists in this repo — same limitation this codebase has flagged
  honestly at every prior "no RN component test infra" juncture rather
  than fabricating false coverage.
  Tests: `accountantPackageColors.test.ts` (new, 14 tests — every export
  hex pinned to the spec, screen tokens confirmed same hue family +
  relative emphasis, key-set parity between the two maps).
  `accountantPackageReport.test.ts` (new, 13 tests — header identity
  string rendered verbatim, owner-paid amber+badge+paid-with in BOTH the
  lumper table and the category table, a non-owner-paid row gets neither,
  the "Paid with" column header appears above both tables, full section
  order per spec item 4 proven via string-index comparisons, empty-state
  sections omitted entirely, every colour-coded section present, the
  4-flow owner's-equity rows + their one-liner notes, the 3 footer notes +
  disclaimer, and an HTML-escaping test for untrusted description text).
  `accountantPackage.test.ts` gained `paymentMethod`/`flows`/
  `groupLineItemsByScheduleCBucket` coverage (8 new tests, including the
  real netted-outstanding-amount case and the custom-category grouping
  regression). Full suite: 97 suites / 2411 tests pass; `tsc --noEmit`
  clean; all 7 locales confirmed key-parity (14 new
  `accountantPackage.*` keys — es/ru/ar/tr fully translated, hi/uk as
  untranslated English copies per invariant #11; glossary test re-passed
  clean, no glossary terms in any new string). No SQL/Edge Function
  changes. No new native dependency — pure JS/TS work reusing
  `expo-print`/`expo-sharing`/`expo-file-system`, already dependencies —
  ships via a normal `eas update`.

- "EDGE FUNCTION RETURNED A NON-2XX STATUS CODE" NEVER LEAKS RAW (owner
  decision 2026-08-24, 5-item bug report). Root cause, confirmed by
  reading both sides of the wire: `ai-import`'s `Deno.serve` handler had
  NO top-level try/catch — any uncaught exception anywhere in its ~350
  lines (a Postgres error not wrapped in its own try/catch, a bug in the
  page-merge logic, an unexpected null reference) bypassed every one of
  its own `errorResponse()` calls entirely; Deno's own default response
  for an uncaught throw is not JSON, so the client's `ctx.json()` parse
  failed too and fell through to the `@supabase/functions-js` SDK's own
  HARDCODED default string ("Edge Function returned a non-2xx status
  code") — never anything the server actually wrote. Five fixes, one per
  item:
  1. **Server ALWAYS returns structured JSON**: the whole `Deno.serve`
     handler body is now wrapped in one top-level try/catch —
     `errorResponse("internal", "Something went wrong on our end — your
     data is safe. Please try again.", 500)` on any uncaught exception,
     full error+stack always `console.error`'d first. `ErrorType` gained
     4 new codes — `billing_exhausted` (Anthropic 401/403/402 — our own
     account can't be billed/authenticated), `rate_limited` (Anthropic
     429 — pre-existed but was previously indistinguishable from every
     OTHER non-2xx status), `oversized` (the file-size guard, renamed
     from a generic `bad_request`), `internal` (everything else,
     including the daily-count-check Postgres failure, a missing
     `ANTHROPIC_API_KEY`, and the old catch-all `anthropic_error`, which
     this pass retires — every one of its usages was reclassified into
     one of the new, more specific codes). `model_refusal`/`parse_failed`
     keep their own richer server-side codes/messages but bucket under
     the SAME client-side "invalid_document" friendly copy. Every Anthropic
     HTTP status is now logged in full via `console.error`
     (`supabase functions logs ai-import`) regardless of what's forwarded
     to the client — item 1's "log the underlying Anthropic status and
     message server-side."
  2. **Client never shows the raw string, ever**:
     `app/src/data/aiImportCall.ts`'s `invokeAiImportOnce()` used to fall
     back to the bare SDK `error.message` whenever `ctx.json()` parsing
     failed or the parsed body had no `.error` field — that fallback IS
     the leak point, fixed by never reading `error.message` at all
     anymore (a `Response` context with an unparseable/`.error`-less body
     maps to the same safe `'internal'` message the server itself uses; a
     non-Response context maps to a safe, fixed `'network_error'`
     message) — this is deliberate defense in depth on TOP of fix #1, not
     a duplicate of it: an in-flight deploy where an older function
     version is still serving some requests, or a proxy/edge layer
     returning its own error page, must still never show this string.
     `app/src/import/friendlyAiFailure.ts`'s `FriendlyFailureCategory`
     grew from 4 buckets to 7 (`billingAuth`/`rateLimit`/`timeoutOverload`/
     `oversized`/`invalidDocument`/`internal`/`offline`), each with its
     own `importScreen.friendlyFailure.*` i18n copy (all 7 locales) —
     `oversized` deliberately reuses the EXISTING `fileTooLargeMessage`
     string (same "size guidance" wording already used for the pre-upload
     client-side size guard) via a special case in the import screen's
     `handleAiError()`, rather than a duplicate translated string. The
     picked file (`fileMeta`) and the Retry button were already
     unconditional on error type (confirmed, not changed) — every one of
     these 7 categories already gets "keeps the picked file, offers
     Retry" for free.
  3. **BATCH BACK-PRESSURE — a real Anthropic 429 pauses the queue,
     globally, not just for the one caller that hit it**: every user of
     this app shares ONE Anthropic API key (CLAUDE.md's own standing
     rule) — a 429 is an account-wide signal, not a per-user one.
     `ai_rate_limit_state` (docs/PENDING_SQL.md §56, NOT YET RUN) is a
     single GLOBAL row, written by `ai-import` itself via a NEW
     service-role client in that function (new precedent for this
     function, matching delete-account/reset-data/referral-sync's own
     established `SUPABASE_SERVICE_ROLE_KEY` usage) the instant a real
     429 comes back (extracting Anthropic's own `Retry-After` header when
     present, defaulting to 30s otherwise) — and READ by `extractOnePass()`
     (the ONE choke point every Anthropic call in this file goes through:
     image, single-call PDF, and every individual page) BEFORE it ever
     calls Anthropic. Whenever the cooldown is active, that call
     short-circuits to a safe `rate_limited` result with ZERO further
     Anthropic load — this is what "pause the queue" means concretely: one
     rate-limited call anywhere stops every OTHER in-flight/about-to-start
     call, in any job, for any user, from also independently hammering
     Anthropic and also independently failing. Best-effort throughout
     (every read/write wrapped in try/catch, degrades to "no cooldown"
     if the table doesn't exist yet or the service-role key isn't set) —
     this table's own failure can never be the reason an import fails.
     `import_jobs.status` gains `'waiting_to_retry'` (§56's CHECK
     constraint update) — a BACKGROUND job (real wall-clock room via
     `JOB_HARD_BUDGET_MS`, unlike the synchronous path's tight per-HTTP-
     request budget) that hits `rate_limited` now genuinely PAUSES and
     retries with exponential backoff (`runJobInBackground()`'s new
     `withRateLimitBackoff()` — 15s/45s/90s schedule, or Anthropic's own
     `Retry-After` if longer, bounded by remaining job budget) instead of
     immediately failing, flipping the job's own status to
     `'waiting_to_retry'` while it waits so the client's jobs list/chip
     shows it distinctly (amber, matching the needs-review badge's "please
     note this, not an error" convention) rather than looking stuck or
     failed. The per-page fallback path (`runPageWithRetry`, used by the
     chunked continuation) also treats `rate_limited` as retryable now
     (reusing its existing one-retry slot, with a real backoff sleep
     sourced from `retryAfterSeconds` first) — honestly scoped: this layer
     doesn't get its own job-status visibility (no job context available
     that deep), the OUTER single-call/whole-job level is where
     `'waiting_to_retry'` is actually shown. The SYNCHRONOUS (non-job)
     path deliberately does NOT sleep-and-retry (it can't block a live
     HTTP request for minutes) — it fails fast with `rate_limited` +
     `retryAfterSeconds`, letting the client's existing Retry button
     (fix #2) handle it. `app/src/import/importJobs.ts`'s
     `ImportJobStatus`/`isActiveJob()`/`deriveChipSummary()` all updated
     (`waiting_to_retry` is active, and folds into the chip's existing
     `'processing'` kind — same "still working on it" meaning from the
     user's own perspective).
  4. **Concurrency/tier guidance, answered plainly, not guessed**: this
     environment has no credentials to query the Anthropic Console for
     this account's actual rate-limit tier — docs/ADMIN_RUNBOOK.md's new
     "AI Import Reliability" section says so explicitly and points at
     console.anthropic.com's own Limits page as the authoritative source,
     rather than asserting a number that can't be verified.
     `AI_IMPORT_BATCH_CONCURRENCY` is LEFT AT its existing default of 2,
     not raised — same "prefer a small, evidence-based increase over a
     speculative jump" caution the earlier SPEED UP SETTLEMENT IMPORT
     pass already established, now backed by two NEW safety nets
     regardless of the real number (the global cooldown gate, and
     automatic job-level backoff) — recommendation: watch
     `ai_usage_log.failure_reason` for `rate_limited` occurrences over a
     week of real multi-document use (ADMIN_RUNBOOK.md recipe #2), and
     only then try 3 next, one step at a time, same precedent as before.
     For a 10-document batch specifically: each is its own independent
     background job (§54) — `AI_IMPORT_BATCH_CONCURRENCY` only bounds
     PAGES within ONE document, not how many of the 10 documents' jobs
     run concurrently (nothing throttles that) — the global cooldown gate
     is what actually protects against 10 simultaneous jobs each
     independently hammering Anthropic.
  5. **Owner diagnostic — every non-2xx, with its real cause, queryable**:
     `logAiUsage()` now accepts an optional `detail` param and stores
     `"{errorType}: {the real message}"` (truncated to 400 chars) in
     `ai_usage_log.failure_reason` instead of the bare type alone — every
     failure path in the file was updated to pass its own real message
     through. `docs/ADMIN_RUNBOOK.md`'s new "AI Import Reliability"
     section has 4 ready-to-run recipes: recent failures with real cause
     (extends the pre-existing PART 4 recipe), a failure-type breakdown
     over a period (which of the 6 codes is actually happening), checking/
     clearing the shared rate-limit cooldown, and the concurrency/tier
     guidance from item 4. The full untruncated detail (raw Anthropic
     HTTP status + response body) is always in `console.error` too
     (`supabase functions logs ai-import`) for anything the 400-char
     column truncates.
  Tests: `app/src/import/__tests__/friendlyAiFailure.test.ts` extended for
  all 7 categories (billing_exhausted/anthropic_error legacy fallback/
  rate_limited/timeout+truncated/oversized/model_refusal+parse_failed+
  invalid_document/internal/network_error). `app/src/data/__tests__/
  aiImportCall.test.ts` gained a dedicated "never leaks the raw SDK error
  string" describe block (non-JSON body, JSON-with-no-`.error` body, a
  real structured error still passes through untouched, no-Response-context
  connectivity failure, AbortError-context timeout unaffected) — every
  case asserts the raw SDK string literally never appears in the result.
  `app/src/import/__tests__/importJobs.test.ts` gained `waiting_to_retry`
  coverage (active status, chip-summary folding, sort-order floating).
  Full suite: 95 suites / 2362 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`importScreen.friendlyFailure.
  invalidDocument`/`internal`, `importJobs.status.waitingToRetry`/
  `importJobs.waitingToRetryNote` — es/ru/ar/tr fully translated, hi/uk as
  untranslated English copies per invariant #11). `ai-import` was modified
  (top-level try/catch, 6-code taxonomy, rate-limit cooldown gate,
  job-level backoff) and NEEDS REDEPLOYING; `ai-advisor`/`reset-data`/
  `delete-account`/`referral-sync` were NOT touched. docs/PENDING_SQL.md
  §56 (`ai_rate_limit_state` table + `import_jobs.status` CHECK constraint
  update) is NOT YET RUN — every new mechanism degrades gracefully until
  it is (the cooldown gate silently no-ops with no table/service-role key,
  and a `'waiting_to_retry'` status write silently no-ops against the old
  CHECK constraint, falling back to plain automatic retry with no visible
  status change until §56b runs). No native rebuild needed — pure JS/TS
  plus SQL/Edge Function work, no new native dependency, client ships via
  a normal `eas update`.

- MILES READ BUT NOT USED (owner decision 2026-08-24, device report:
  "import screen says 'using settlement total 10,146' — the value IS
  extracted — yet Home still shows 'no miles recorded' and CPM/RPM/PPM
  stay uncomputed"). Traced end to end, per the report's own numbered
  hypotheses, before writing anything:
  1. **THE VALUE WAS NEVER LOST** — `mapExtraction.ts`'s `mapSettlement()`
     computes `miles = num(s.totalMiles)` and writes it into the SAME
     `settlements.miles` NOT NULL column every screen reads
     (`num()` never silently drops to a string or a different field
     name — verified by reading the actual mapper, not assumed).
     `aiImportSave.ts`'s INSERT/UPDATE spreads `{ ...mapping.settlement,
     ... }` verbatim — no renaming, no field dropped. `calcMiles()`
     (`src/stats/miles.ts`) correctly reads `s.miles` per settlement row.
     Proven end to end with a new dedicated test
     (`src/data/__tests__/aiImportSave.milesEndToEnd.test.ts`) that runs
     the REAL `saveExtraction()` with a payload carrying
     `totalMiles: 10146`, confirms the saved row has `miles: 10146` (a
     real number, not a string), and feeds it through the actual
     `calcMiles()`/`calcCanonicalCpm()` to confirm CPM/RPM/PPM all
     compute as real numbers.
  2. **THE ACTUAL BUG — Home read via a DIFFERENT query scope than every
     other screen**: `app/(tabs)/index.tsx`'s dashboard trio queried
     `useFleetStats(activeTruck?.id ?? null)` — TRUCK-SCOPED — while
     Scorecard (`app/(tabs)/more/scorecard.tsx`) and the Settlements
     screen's own top stat row both call `useFleetStats(null)` —
     FLEET-WIDE (confirmed via a repo-wide grep: Home was the ONLY
     truck-scoped call site in the app). A settlement whose own
     `truck_id` doesn't match `activeTruck.id` — most commonly one
     imported before any truck existed in the account yet
     (`truckMatch.ts`'s `resolveTruckMatch()` silently saves
     `truck_id: null` when `trucks.length === 0`, no picker ever forced,
     by design) — was silently EXCLUDED from Home's truck-scoped query
     while remaining correctly included in Scorecard's fleet-wide one:
     the exact "read on a different path than the one the dashboard
     uses" the report described. Home's own code comment already said
     this block "mirrors scorecard.tsx's own truck-cost-basis/manual-
     override block exactly" — the truck-scoped `useFleetStats` call was
     the one place that mirror broke. Fixed by changing it to
     `useFleetStats(null)`, a true match to Scorecard/Settlements —
     `activeTruck` stays used for genuinely truck-SPECIFIC settings
     (cost basis, the manual miles override), only the stats query's
     scope changed. This is now the ONE canonical, fleet-wide miles
     read every consumer shares: dashboard trio, CPM "Why?" (Scorecard),
     lane analysis (`rankLoadsByRpm`, already fleet-wide via `useLoads()`
     — verified, unchanged), and per-diem context (`calcPerDiemDays`,
     unrelated to miles scoping — verified, unchanged). The Accountant
     Package doesn't read miles/CPM at all (verified via grep) — nothing
     to fix there.
  3. **ORDERING BUG CLASS — "null must never beat a number"**: audited
     `src/import/milesGuard.ts`'s `resolveWeeklyMiles()` (the guard
     applied once, right after extraction, before `mapSettlement()` ever
     sees the value) and found a real, latent asymmetry — it protected
     against `totalMiles` being IMPLAUSIBLY LARGE relative to a real
     loads breakdown (the original "LTD miles" trap), but had NO
     symmetric protection against `totalMiles` coming back implausibly
     SMALL (most commonly exactly 0/missing) while real loads data
     clearly indicated otherwise — exactly the shape a multi-page
     merge's own chunk[0]-priority rule for this field
     (`supabase/functions/ai-import/chunking.ts`'s
     `mergeChunkedExtractions()`, which deliberately trusts chunk[0]'s
     totalMiles unconditionally, including when it's a legitimate 0 for
     a real home week — verified, left unchanged, still correct for that
     case) could produce if the mileage recap happens to print on a
     LATER page than chunk[0]. Added a new rule 3 to
     `resolveWeeklyMiles()`: when real loads exist with a nonzero summed
     mileage but `totalMiles` came back smaller than that sum, use the
     loads-derived total instead (flagged for review, a judgment call —
     not silent like the unambiguous "no loads = 0" rule 1). This is a
     CLIENT-SIDE safety net that runs on whatever extraction the server
     ultimately returns — single-call or merged — so it protects the
     miles value end to end regardless of which path produced it,
     without needing to reverse the deliberate, already-verified
     chunk[0]-priority design for this field server-side (loads are
     already correctly concatenated across every chunk by the existing
     merge, which is what makes this recovery possible).
  4. **Tests**: `src/import/__tests__/milesGuard.test.ts` gained a
     dedicated "rule 3" block using the exact reported 10,146-mile
     figure (0/undefined/partial totalMiles recovered from a real loads
     sum; confirms rule 3 does NOT fire when totalMiles already matches
     or plausibly exceeds the loads sum). `src/import/__tests__/
     chunking.test.ts` gained two new cases: a real nonzero totalMiles
     on the header chunk surviving the merge completely unchanged (the
     ordinary case), and an end-to-end "merge + guard together" test
     proving that even when the header chunk itself lacks totalMiles,
     the guard recovers the real 10,146 from the loads the merge
     correctly preserved. `aiImportSave.milesEndToEnd.test.ts` (new,
     described in point 1) is the full save→read→CPM proof the report
     explicitly asked for, plus a "guard-recovery" case showing a
     lost-upstream totalMiles still lands correctly once actually saved.
  5. **Diagnostic** (settlement detail screen,
     `app/(tabs)/more/settlements.tsx`): the miles field was ALREADY
     shown plainly and editable there (a stat-row figure plus an
     editable `Field` + Save, both reading the literal DB-stored
     `selected.miles` — confirmed unchanged, pre-existing). Added the
     ONE thing that was actually missing and would have made TODAY's
     specific bug visible immediately: a "Truck: {{unit}}" /
     "⚠️ No truck assigned" line right next to it, looked up from
     `selected.truck_id` against the fleet's own truck list — the
     exact hidden column whose null/mismatch caused the divergence.
  Full suite: 95 suites / 2350 tests pass (+19 new); `tsc --noEmit`
  clean; all 7 locales confirmed key-parity (`settlementsScreen.
  assignedTruck`/`noTruckAssigned`, es/ru/ar/tr translated with
  "settlement" kept in Latin script per the glossary, hi/uk as
  untranslated English copies). No SQL changes. `ai-import` was NOT
  modified — the merge's own chunk[0]-priority behavior for totalMiles
  was deliberately left as-is (already correct for the genuine-0-miles
  case; the client-side guard is what closes the gap for every path),
  so no Edge Function redeploy is needed. Ships via a normal
  `eas update`.

- CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, no SQL
  needed — every field this pass touches already existed on
  `capital_transactions`; `tx_date`/`amount`/`note` were always
  writable columns, just never exposed as editable on this screen).
  1. **DATE FIELD**: both "Add Contribution" and "Add Draw" (see item 2)
     gained a Date field, defaulting to today (`todayIso()`, re-applied
     every time the sheet is freshly opened via new `openDraw()`/
     `openContribution()` functions — previously the two ModalSheets were
     opened by a bare inline `onPress`, with no reset step at all) but
     freely editable for a back-dated entry. New pure
     `validateCapitalTransactionDate()` (`src/stats/capitalAccount.ts`) —
     reuses `dateGuard.ts`'s `toDateOrNull()` for the base "is this a real
     calendar date" check (so the two modules can never disagree about
     what counts as a valid date string), then rejects anything after
     today (ISO-string lexicographic comparison, immune to timezone
     Date-object pitfalls) or before `MIN_CAPITAL_TX_YEAR = 2020` (matches
     `dateGuard.ts`'s own `isImplausibleDate()` floor — deliberately
     STRICTER than that function's "up to next year" allowance, since a
     capital transaction always records something that already happened
     and can never be legitimately future-dated). Save is disabled and an
     inline red message shown whenever the current date fails validation,
     on Add Contribution, Add Draw, AND the new edit sheet (item 3) alike.
  2. **WORDING**: "Record Draw"/"Record Distribution"/"Record
     Contribution" → "Add Draw"/"Add Distribution"/"Add Contribution"
     (button labels + both add-sheet AND new edit-sheet titles — "Edit
     Draw"/"Edit Distribution"/"Edit Contribution") — VALUES only, key
     names unchanged, across all 7 locales (es/ru/ar/tr translated,
     hi/uk untranslated English copies per invariant #11) — same "rename
     values not keys" convention as the DOCUMENTS & RENEWALS rename.
  3. **EVERY ROW EDITABLE**: `HistoryRow` used to only make a LINKED
     contribution tappable (straight to Deductions) and only gave a
     MANUAL row an inline ✕ delete icon — now EVERY row (draw or
     contribution, linked or manual) is tappable and opens one shared
     edit sheet (date/amount/note + Delete), replacing the old inline ✕
     icon and the old direct-navigate-on-tap behavior entirely. New
     `isLinkedContribution()` (`src/stats/capitalAccount.ts`) is the ONE
     shared predicate both the row's own 🔗 indicator and the edit
     sheet's amount-lock decision read from — previously computed inline,
     independently, in two places. For a linked row, amount renders as
     locked/muted text with an explanatory note
     (`capitalAccount.linkedAmountLocked`) and a "View Linked Expense"
     button routing to Deductions; date/note stay freely editable via the
     SAME plain `useUpdateCapitalTransaction()` entity-hook update (no
     balance side effect at all, since a linked row never applies one —
     `manualTransactionBalanceDelta`'s own header comment). Delete is
     deliberately NOT offered for a linked row from this screen — deleting
     it independently would desync it from its deduction (the deduction
     would silently re-create a fresh linked contribution on its own next
     save via `deductionMutations.ts`'s `applyContributionSync()`), so
     that still routes through Deductions, unchanged from before. New
     `useUpdateManualCapitalTransaction()` (`src/data/capitalTransactions.ts`)
     handles a MANUAL row's edit — adjusts `business_balance` by the
     DIFFERENCE only via new pure
     `computeManualTransactionBalanceAdjustment()`
     (`newDelta - previousBalanceApplied`, where `previousBalanceApplied`
     is ALWAYS read from the row's own stored `business_balance_applied`
     column, never re-derived from its pre-edit amount — same "no drift
     across a chain of repeated edits" rule `useDeleteManualCapitalTransaction`'s
     own reversal already followed), applied via the SAME atomic
     `apply_business_balance_delta` RPC every other real cash movement on
     this screen uses. **"Tap to edit" applied everywhere else a
     financial row was read-only on this screen**: audited the rest of
     the screen (the Contributed/Draws/Tax-Free-Left summary card, the
     Business Balance card, the 4 flow-total rows) and found nothing else
     qualifying — those are all COMPUTED AGGREGATES (sums across many
     transactions), not individual editable rows, so there's nothing a
     "tap to edit" pattern could apply to; Business Balance already had
     its own dedicated "Update Business Balance" edit action (unchanged).
  Tests (`src/stats/__tests__/capitalAccount.test.ts`, extended):
  `validateCapitalTransactionDate` (past/today/future/too-old/malformed,
  plus the exact "back-dated entry lands in the right month's report"
  proof — a back-dated tx_date fed through the SAME `groupByMonth()`
  every other list screen in this app uses buckets into its own
  historical month, never the current one);
  `computeManualTransactionBalanceAdjustment` (fresh insert, edit up,
  edit down, a draw's negative direction, a same-amount no-op, and a
  5-edit chain proving the SUM of every incremental adjustment equals
  exactly the start-to-end delta — the literal "no drift" guarantee);
  `isLinkedContribution` (a linked contribution, a plain cash one, and —
  the one genuine edge case — a DRAW that happens to carry a
  `linked_deduction_id`, which must never count as "locked" since that's
  a reimbursement, not a contribution); and a new "full lifecycle" block
  proving insert→edit→delete always nets to exactly $0 business_balance
  effect regardless of whether the edit went up or down, plus a
  regression case for the pre-existing no-edit insert→delete path. Full
  suite: 94 suites / 2331 tests pass (+18 new); `tsc --noEmit` clean; all
  7 locales confirmed key-parity. No SQL/Edge Function changes — every
  column this pass writes to already existed; no redeploy needed for any
  Edge Function. No new native dependency — ships via a normal
  `eas update`.

- BACKGROUND IMPORT CRASH — "undefined is not a function" ON COMPLETION,
  ROOT CAUSE AND FIX (owner decision 2026-08-24, device report). Diagnosis
  method: grepped for every function reference the BACKGROUND IMPORT pass
  itself introduced (the job poller, the completion/notification effect,
  the chip's tap handler, the retry path, "Review now") rather than
  guessing — found ONE genuine dead reference, confirmed by reading the
  actual installed React Native source, not assumed.
  1. **THE ACTUAL BUG**: `src/data/importJobs.ts`'s
     `downloadImportJobFileToLocal()` (called the moment "Review now" is
     opened for a background-completed job — i.e. exactly "at completion")
     called `supabase.storage.from('documents').download(storagePath)`
     then `data.arrayBuffer()` on the resulting Blob. React Native's own
     built-in `Blob` (`node_modules/react-native/Libraries/Blob/Blob.js`,
     read directly to confirm, not assumed) implements only `slice()`/
     `size`/`type` — `arrayBuffer()` genuinely does not exist on it. This
     is why it crashed EVERY time, deterministically, not intermittently:
     a real missing method on this platform, not a permission/availability
     edge case. Confirmed via a repo-wide grep that this was the ONLY
     `.arrayBuffer()` call anywhere in the codebase — a brand-new function
     this pass introduced, exercising a pattern nowhere else in the app
     had ever run against the real RN runtime. Fixed by replacing it with
     the SAME signed-URL + `File.downloadFileAsync()` pattern
     `documentViewer.ts`'s `shareDocumentFile()` already uses successfully
     in production (Documents Archive's own Share/Download feature) — a
     native download straight to a local file, no Blob/ArrayBuffer
     conversion at all. Every other function reference audited (job
     poller's `refetchInterval`, `useStartImportJob`/`useRetryImportJob`/
     `useDismissImportJob`, the chip's `router.push`, `fetchImportJobResult`/
     `fetchImportJobForReview`) was confirmed clean — properly-defined,
     called from inside a React component body, nothing referencing an
     unmounted screen's closure.
  2. **HARD RULE — completion never depends on an optional capability**:
     `src/import/importJobs.ts` (the pure, zero-Expo/RN-dependency module)
     gained `runOptionalSideEffect()` — wraps ANY async side effect (a
     notification call, or any future optional capability) so a missing
     function, a throw, or a rejected promise can never propagate to the
     caller; `ImportJobsChip.tsx`'s completion effect now routes every
     `notifyImportJobDone()` call through it. Belt-and-suspenders on top:
     `src/notifications/importJobNotifications.ts`'s own exported
     functions (`getNotificationPermissionStatus`/
     `requestNotificationPermission`/`notifyImportJobDone`/
     `hasNotifiedJob`) each gained an explicit capability check
     (`typeof Notifications.getPermissionsAsync === 'function'`, etc.)
     plus their own internal try/catch, so they're safe even for a future
     caller that doesn't go through the wrapper; the module-level
     `Notifications.setNotificationHandler(...)` call (which runs the
     instant this always-mounted-in-the-tab-layout module is first
     imported) is now itself wrapped in a try/catch — the exact "drag-
     module crash-on-mount" class of bug CLAUDE.md's own CUSTOMIZE
     DASHBOARD entry already documents for a different screen, applied
     here defensively even though it wasn't the actual reported crash.
     `ImportJobsChip`'s whole `checkAndNotify()` async function is also
     now explicitly `.catch()`-guarded so even an unexpected failure in
     the loop itself (not just the notification calls) can never surface
     as an unhandled rejection.
  3. **Safe when the originating screen is gone**: audited and confirmed
     already correct by construction — `src/import/importJobs.ts`'s own
     header comment already documented this design intent ("there is no
     client-side state a screen unmount/app background could lose — every
     derived value is recomputed FROM SCRATCH from whatever the server's
     current row values are on the next poll"). The "Review now" effect
     (`app/(tabs)/import/index.tsx`) reads `job` fresh via
     `fetchImportJobForReview()`/`downloadImportJobFileToLocal()` every
     time it runs — never a closure captured from whatever screen
     originally called `startBackgroundJob()` — and its existing
     `cancelled` flag already guarded every `setState` call after an
     await, so THIS screen unmounting mid-load was already safe too. No
     structural change was needed here; both effects now have comments
     spelling this out explicitly since it's exactly the property the bug
     report asked to verify.
  4. **Regression tests** (`src/import/__tests__/importJobs.test.ts`,
     extended): `runOptionalSideEffect()` resolves cleanly for an
     undefined/null function, a function that throws synchronously, and a
     function that returns a rejected promise — while still genuinely
     calling and awaiting a working one (not a blanket no-op). A new
     "completion is visible with zero dependency on the originating
     screen" block simulates a job started by one (now-unmounted) "screen
     A" and completion detected by a totally independent "screen B"
     computation sharing no variable/ref/closure with A — proving
     `deriveChipSummary` surfaces both a ready and a failed job correctly
     from nothing but a freshly-polled jobs array. The actual fixed
     `downloadImportJobFileToLocal()` implementation itself is NOT
     unit-tested here — it needs a real Expo/RN runtime (no jest-expo/RN
     mocking exists in this test setup, same limitation every other
     `src/data/*` network/file-system function in this codebase has;
     `documentViewer.ts`'s equivalent, already-proven-in-production
     pattern is the actual confidence this fix is correct).
  5. **Error surface fix**: the reviewJobId catch block
     (`app/(tabs)/import/index.tsx`) used to set `errorMessage` directly
     from `err.message` — which is exactly how a raw runtime error like
     "undefined is not a function" ended up as the ONLY visible text on
     screen, with no explanation of what failed. It now always shows a
     friendly, translated headline (`importJobs.reviewLoadFailed`, all 7
     locales) pointing at Copy Details; `errorReport`
     (`buildLocalErrorReport('Loading the completed import job', err)`,
     unchanged) still carries the exact message and stack trace for real
     debugging — the fix is scoped to this specific catch block (the
     actual site of the reported crash), not a rewrite of every catch
     block's existing "show the real error text" convention elsewhere in
     this screen, which remains appropriate for the more ordinary
     network-style errors those paths normally see.
  Full suite: 94 suites / 2313 tests pass (+7 new); `tsc --noEmit` clean;
  all 7 locales confirmed key-parity. No SQL/Edge Function changes; no
  redeploy needed for `ai-import`/`ai-advisor`/`reset-data`/
  `delete-account`. No new native dependency — pure JS/TS work reusing an
  already-proven expo-file-system pattern — ships via a normal
  `eas update`.

- DEVICE TESTING ROUND — NEEDS REVIEW, PAYMENT+DESTINATION SUMMARY,
  DOCUMENTS & RENEWALS (owner decision 2026-08-24, docs/PENDING_SQL.md
  §55, ✅ APPLIED — `deductions.reviewed_at`/`documents.reviewed_at` and
  the 6 `compliance_items` columns are live). Four items:
  1. **NEEDS REVIEW WON'T CLEAR — root cause and fix**: there was no
     explicit "mark reviewed" action ANYWHERE in the app — the two
     existing signals (a deduction's "NEEDS REVIEW: " description prefix;
     a document's `parsed_json.confidence === 'low'`, CLAUDE.md invariant
     #14) could each only ever be set by AI import, never cleared by a
     user action. Worse, `aiCoachSummary.ts` (AI Coach's needs-review
     count/$-value) and `missingDataNudges.ts`'s
     `detectNeedsReviewReceipts()` each independently re-implemented the
     raw `.startsWith('NEEDS REVIEW:')` check instead of reading the one
     shared `src/import/needsReview.ts` module Deductions/Documents/
     Settlements/Transactions already used — so even a hypothetical
     per-screen fix wouldn't have propagated everywhere the count is
     shown. Fixed with a new CANONICAL override column on both tables,
     `reviewed_at timestamptz` (§55a): `isDeductionNeedsReview()`/
     `isDocumentNeedsReview()` (`needsReview.ts`) now check it FIRST and
     short-circuit to `false` regardless of what the description/
     confidence still say — this is what "clears EVERY signal at once"
     actually means, rather than trying to keep two independent flags in
     sync. `isSettlementNeedsReview()` derives from its linked document as
     before, so marking a settlement reviewed (which marks its document)
     automatically flows through with zero settlement-specific state.
     `aiCoachSummary.ts`/`missingDataNudges.ts` were both switched to call
     the shared `isDeductionNeedsReview()` instead of their own inline
     check — the actual fix for "still shows as needing review in the AI
     Coach," not a separate patch. `stripNeedsReviewPrefix()` (new,
     `needsReview.ts`) is a cosmetic cleanup applied alongside setting
     `reviewed_at` — strips the literal prefix so a reviewed row's
     description doesn't keep visually shouting "NEEDS REVIEW: " next to
     its own "Reviewed ✓" state, but `reviewed_at` (never description
     text) is the one thing every check actually reads. Two pure builders,
     `buildMarkDeductionReviewedUpdate()`/`buildMarkDocumentReviewedUpdate()`
     (`needsReview.ts`), define the exact update payload; `src/data/
     needsReviewMutations.ts`'s `useMarkDeductionReviewed()`/
     `useMarkDocumentReviewed()`/`useMarkAllDeductionsReviewed()` are the
     ONLY mutations anywhere that ever write `reviewed_at`, each calling
     the caller's own `invalidateFinancialData(queryClient)` afterward
     (the established per-screen convention, not baked into the hook
     itself, so a screen-specific mutation can't silently skip it).
     `src/components/NeedsReviewBadge.tsx` gained `MarkReviewedButton` —
     shows "Mark reviewed" while a row is flagged, briefly "Reviewed ✓"
     while the mutation is in flight, then disappears entirely once the
     row's own `needsReview` flag flips false (there is no separate
     persistent "already reviewed" chip — a reviewed row just stops
     looking flagged). Wired into: Deductions (row + edit sheet + a bulk
     "Mark all reviewed" link next to the "Needs review only" filter pill,
     shown only when that filter is on and something's still flagged),
     Documents viewer (marks the document), Settlements (row + detail
     sheet, marks the settlement's LINKED document — same two-hop
     relationship `isSettlementNeedsReview()` already used). Transactions
     needed NO changes at all — it already read the shared
     `isDeductionNeedsReview()`/`isSettlementNeedsReview()` functions, so
     it reflects the fix automatically; tapping a flagged row there
     navigates to Settlements/Deductions, where the new control lives.
     Tests: `needsReview.test.ts` gained coverage for both new signals
     always losing to `reviewed_at`, both pure builders' exact payload
     shape, and a dedicated end-to-end block proving a marked-reviewed row
     never survives a `.filter(isDeductionNeedsReview)` pass alongside a
     still-flagged one — the literal "never reappears in any needs-review
     count" guarantee the device report asked for.
  2. **PAYMENT + DESTINATION SUMMARY**: `src/data/documentsFilter.ts`'s
     `findLinkedRecords()` — previously explicitly documented as excluding
     fuel/loads/reimbursements ("none of which carry a document_id of
     their own") — now traces them via a two-hop lookup: find the linked
     SETTLEMENT first (by `document_id`, same as every other kind), then
     match fuel/loads/reimbursements by `settlement_id` against that
     settlement's own id (`aiImportSave.ts` stamps these three with
     `settlement_id` but never `document_id` — the only way to reach them
     from a document at all). Deliberately does NOT re-match deductions by
     `settlement_id` too — a settlement-withheld deduction already carries
     BOTH `document_id` AND `settlement_id`, so it's already captured by
     the plain `document_id` loop; adding a second match would double-
     count it (regression-tested explicitly). New `LinkedRecordKind`
     values `'fuel'`/`'load'`/`'reimbursement'`; a new pure
     `summarizeLinkedRecordCounts()` collapses a ref list into the
     "3 fuel entries, 12 deductions, 2 loads, 1 maintenance record"-style
     count summary. Tolls remain a confirmed, honestly-flagged gap — the
     `tolls` table has neither `document_id` nor `settlement_id` in the
     current schema, so a settlement's own toll charges cannot be traced
     back to their source document at all yet; a future schema addition,
     not silently faked. `src/navigation/linkedRecordRoute.ts` is a new
     shared module (`LINKED_RECORD_ROUTE`/`buildLinkedRecordHref()`)
     extracted from what used to be a Documents-viewer-local map/function,
     now used by BOTH the Documents viewer and Settlements' detail sheet
     so the two screens can never disagree about where a given ref kind
     routes to — fuel/load/reimbursement land on their own list screens
     (no `?openId=` auto-open wired up for those 3 screens yet, same as
     bank_statement/compliance_item/household_income already were).
     `src/components/DestinationSummary.tsx` is the ONE shared block
     rendered at the BOTTOM of both the Settlement detail sheet and the
     Document viewer: a "Landed as: ..." count line, every individual ref
     tappable (navigates to its own row), and — for a deduction-kind ref —
     an inline "✏️" category quick-edit (opens `CategoryPicker` in place,
     saves via the SAME `useUpdateDeduction()` + `invalidateFinancialData()`
     path Deductions' own screen uses, never a second write path). A
     "Paid via" payment-method picker (the same 9-pill list Deductions
     uses) is shown ONLY when the settlement/document maps to EXACTLY ONE
     linked deduction — a settlement has no `payment_method` column at all
     (it's a carrier deposit, not a payment choice), and a document linked
     to several deductions has no single coherent value to show/edit, so
     the row is simply omitted rather than guessing or averaging one.
     Tests: `documentsFilter.test.ts` gained a full "two-hop via
     settlement_id" describe block (fuel/loads/reimbursements found via
     their settlement, never matched to the WRONG settlement, never
     traced with no settlement source at all, the deduction double-count
     guard) plus `summarizeLinkedRecordCounts` coverage — proving the
     summary reflects exactly what was actually saved, the device
     report's own "reflects real saved rows" ask.
  3. **DOCUMENTS & RENEWALS (Compliance rename + manual entry)**: renamed
     "Compliance"/"Compliance Tracker" to "Documents & Renewals" —
     user-facing TEXT VALUES only (nav registry's `nav.compliance` i18n
     VALUE, the screen's own title/subtitle/empty-state/delete-confirm/
     notification copy, `alerts.complianceSection`/`complianceDue`,
     `ceoMode.recommendations.complianceCatchUp`, the 5
     `docTypes.*.route` strings that used to read "Compliance Tracker
     (not yet wired to a screen)" — also dropping that stale parenthetical
     since the screen has always been wired — plus 4 stale code comments
     in `alerts.tsx`/`WideSidebar.tsx`/`queryInvalidation.ts`/
     `complianceNotifications.ts`), across all 7 locales. Deliberately did
     NOT rename: the `compliance_items` table/`compliance.*` i18n KEY
     namespace/`ComplianceType`/`isComplianceTypeVisibleForRole` etc.
     (internal identifiers, zero user-visible cost to leave alone, real
     risk to touch) or any historical dated log entry in this file/
     PROMPTS.md/docs/PENDING_SQL.md/docs/DATA_FLOW.md that used the old
     name to describe what was true AT THE TIME — same "never rewrite
     history" convention as every other renamed feature in this file
     (e.g. DASHBOARD SIMPLIFICATION's own struck-through invariant #17).
     Manual entry (the "+ Add Item" flow already existed — 'other' type +
     free-text label — this pass only expands its FIELD SET, per the
     device report's own framing): `compliance_items` gained 6 new,
     nullable/additive columns (§55b) — `issue_date`, `reminder_lead_days`
     (a per-item override of `calcComplianceStatus()`'s app-wide 30-day
     due-soon threshold — the function gained an optional 3rd param that
     falls back to the old default when null/omitted, so every
     already-seeded row behaves identically to before), `note`,
     `truck_id`/`driver_id` (FKs, `on delete set null`), and
     `applies_to` (`'truck'|'trailer'|'driver'|'business'`, new exported
     `ComplianceAppliesTo` type — informational only, role-based
     filtering in `src/alerts/roleFilter.ts` still keys off `type`,
     unchanged, invariant #4's own explicit ask). The add/edit form
     (`compliance.tsx`) gained matching fields: issue date, a numeric
     reminder-lead-days field (placeholder shows "Default: 30 days"),
     a note field, an appliesTo pill row (clearing truck_id/driver_id
     whenever appliesTo changes away from a value that needs them), and —
     only once a truck/trailer or driver is the selected appliesTo AND
     the user actually has any — a truck/driver picker sourced from the
     EXISTING `useTrucksList()`/`useDrivers()` hooks (no new query
     needed). Attachment (item 3's "optional photo/PDF attachment"):
     `src/compliance/attachment.ts`'s pure `buildComplianceAttachmentPath()`
     (`{user_id}/Compliance/{slug(label)}/{filename}`, CLAUDE.md's
     standard storage-path convention) + `src/data/complianceAttachment.ts`'s
     `uploadComplianceAttachment()` — uploads immediately on pick (not
     deferred to Save, same "upload first, reference its id" order as
     aiImportSave.ts's own step 1/2) via the same `File(...).bytes()` +
     `supabase.storage.from('documents').upload()` pattern the AI-import
     save path already uses, then inserts a plain `documents` row
     (`doc_type: 'other'` — a manual attachment has no AI extraction
     behind it, so there's no more specific DocType) and stores the new
     id as the form's `sourceDocumentId`, saved into
     `compliance_items.source_document_id` (the SAME column AI-extracted
     compliance items already populate — `mapCompliance()`,
     invariant #21 — a manual and an AI-matched item share one field, one
     meaning). "📷 Attach Photo" (`expo-image-picker`) / "📄 Attach PDF"
     (`expo-document-picker`) — both already-installed dependencies, no
     new native module. Manual items get the SAME expiry alerts as
     built-in ones by construction, not by a separate code path — every
     consumer of `calcComplianceStatus()` (`aiCoachSummary.ts`'s
     compliance-due count, `alerts.ts`'s `dueCompliance` list, this
     screen's own notification-scheduling effect and list-row urgency
     chip) now passes `item.reminder_lead_days` through, so a manual
     item's own custom lead time (or the 30-day default, if unset) drives
     its urgency/notification exactly like a built-in item's does.
     Tests: `status.test.ts` gained a `reminderLeadDays` describe block
     (null/undefined behaves identically to the old default; a shorter
     custom lead time keeps a row "ok" past the point the default would
     have flagged it; a shorter lead time correctly flips to "due_soon"
     once inside its own window; a longer custom lead time flags EARLIER
     than the default would; overdue always stays overdue regardless of
     any custom lead time) — proving a manual item's custom reminder
     genuinely changes its urgency, not just that the field round-trips.
     `attachment.test.ts` (new) covers `buildComplianceAttachmentPath()`.
  4. **Kept intact, verified not touched**: `src/alerts/roleFilter.ts`'s
     `isComplianceTypeVisibleForRole()`/`TRUCK_COMPLIANCE_TYPES`/
     `PERSONAL_COMPLIANCE_TYPES`/`TRUCK_OWNING_ROLES` (item 4's own
     explicit ask) — untouched; the new `applies_to`/`truck_id`/
     `driver_id` fields are informational display-only, role filtering
     still keys off `type` alone. `src/alerts/nudgeFrequency.ts`'s
     frequency-cap engine — untouched, still governs how often a
     due-soon/overdue compliance nudge can surface. Every built-in
     AI-populated item (`mapCompliance()`'s 5 auto-populating docTypes,
     invariant #21) — untouched, still find-or-updates the one matching
     `(user_id, type)` row exactly as before; the 6 new columns are
     additive/nullable so an AI-populated row simply leaves them null
     unless a user edits it afterward.
  Full suite: 94 suites / 2306 tests pass (`documentsFilter.test.ts`,
  `needsReview.test.ts`, `status.test.ts`, `attachment.test.ts` (new),
  `missingDataNudges.test.ts` all directly extended/added this pass);
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (glossary test
  re-passed clean). `ai-import`/`ai-advisor`/`reset-data`/`delete-account`
  were NOT touched this pass — no redeploy needed for any Edge Function.
  No native rebuild needed — `expo-image-picker`/`expo-document-picker`
  were already dependencies (already used by the Import screen), no new
  native module added. docs/PENDING_SQL.md §55 has been run against the
  live project and this pass's client update has been published to
  preview via `eas update`.

- BACKGROUND IMPORT (owner decision 2026-08-24, docs/PENDING_SQL.md §54)
  — "the real fix for perceived slowness... even at best speed, a
  multi-page settlement takes a minute-plus of AI time. The user should
  NOT sit and watch it." Six items:
  1. **FIRE-AND-FORGET FLOW**: picking a PDF now uploads it to Storage
     and starts a server-tracked `import_jobs` row, returning the user to
     the app almost immediately (`app/src/data/importJobs.ts`'s
     `useStartImportJob()`) instead of a multi-minute foreground wait.
     Photo imports are DELIBERATELY UNCHANGED — a photo is always a
     single, fast Anthropic call (never chunked/continued, per the
     existing architecture), so there's no "perceived slowness" problem
     to fix there; `processImage()`/the synchronous `callAiImport()`
     stay exactly as the prior SPEED UP pass left them, untouched.
  2. **SURVIVES NAVIGATION + APP BACKGROUNDING**: the actual extraction
     runs SERVER-SIDE via `EdgeRuntime.waitUntil()` (`supabase/functions/
     ai-import/index.ts`'s `runJobInBackground()`) — a genuine Supabase
     Edge Runtime capability for continuing work after a response has
     already been sent, referenced by this file's own prior TIMEOUT/
     PAGE-BUDGET comment for a while but never actually exercised before
     this pass. The client just polls `import_jobs`
     (`useImportJobs()`, 3s while anything is queued/processing, 30s once
     everything's terminal) — since the job's progress is entirely
     server-owned, nothing about it depends on the client's own JS still
     running; reopening the app days later and polling once picks up
     exactly wherever the server currently is. "Poll or subscribe" —
     polling was chosen over a Realtime channel subscription for
     simplicity/reliability (no channel lifecycle to manage).
  3. **"READY TO REVIEW" + confirmation-gated save**: on completion the
     persistent chip (`app/src/components/ImportJobsChip.tsx`, always
     mounted from the tab layout in both the phone and wide-screen
     branches) turns into "Review now" and fires a local notification
     (`app/src/notifications/importJobNotifications.ts`, same
     permission/dedupe pattern as truckHealthNotifications.ts/
     complianceNotifications.ts, mirrored not shared). Tapping "Review
     now" (or the jobs list's own button) routes to
     `/(tabs)/import?reviewJobId=X`, which loads the job's
     `result_json` and feeds it through the EXACT SAME `afterExtraction()`
     a live synchronous extraction uses — duplicate check, truck/driver
     match, category confirm, the settlement reconciliation hard guard,
     the needs-review flag, ALL identical regardless of which path
     produced the data. Nothing is ever auto-saved from a job.
     **CRITICAL FIX caught during this pass, not shipped broken**:
     `handleSave()` requires `fileMeta` to be set (it's how Save knows
     what to re-upload to the settlement's own final storage path) — the
     ORIGINAL local file from whatever session started a background job
     may be long gone by the time it's reviewed (a different app session
     entirely, after a restart). The reviewJobId effect now downloads the
     job's own already-uploaded Storage copy back into a fresh local temp
     file (`downloadImportJobFileToLocal()`) before calling
     `afterExtraction()`, so Save behaves identically to a live import's
     own save. Without this, Save would have silently no-opped for every
     job-sourced review — `fileMeta` would have stayed null forever.
     A job-sourced save also auto-dismisses its own `import_jobs` row
     afterward (best-effort, never blocks the save itself) so it doesn't
     linger in the list as a stale "ready" job pointing at already-saved
     data.
  4. **QUEUEING**: multiple jobs coexist independently — `useImportJobs()`
     is a single polled list; `app/(tabs)/import/jobs.tsx` (a new screen
     nested in the Import tab's own stack, same precedent as the existing
     `import/camera.tsx` modal — NOT added to `navRegistry.ts`, since
     that registry's "every route must appear" rule governs top-level
     Menu/sidebar destinations, not screens reached only from within a
     tab's own flow) shows every job with per-item status/progress/retry/
     dismiss. `app/src/import/importJobs.ts`'s `sortImportJobsForDisplay()`
     floats active (queued/processing) jobs above terminal ones regardless
     of age, newest-first within each bucket; `deriveChipSummary()` picks
     the one headline job the persistent chip shows (processing > ready >
     failed > hidden priority).
  5. **RETRY REUSES THE ALREADY-UPLOADED FILE**: a failed job's own
     `storage_path` is stored server-side from the start — retry
     (`useRetryImportJob()`, `ai-import`'s `mode:'retry_job'` request,
     `handleJobStart()`'s retry branch) re-reads that SAME Storage object
     and resets the SAME job row (never creates a new one, never asks the
     client to re-upload or re-pick), "never make the user pick it
     again." The failed job's own step-tagged reason
     (`error_message`/`error_step`) stays visible in the list until
     retried.
  6. **CONCURRENCY KNOB**: `AI_IMPORT_BATCH_CONCURRENCY` was already
     EXPOSED by the prior SPEED UP pass (default 2, no redeploy needed to
     change it — just the Supabase dashboard's Edge Function env var);
     this pass REUSES the same single knob for the job engine's own
     `runJobPages()` (deliberately one shared dial, not a second
     job-specific one, for simplicity). Recommendation for the next value
     to try, given the previously MEASURED real per-page durations
     (23.9s-40s, this file's own ROUND 5 MEASURED EVIDENCE entry): **try
     3 next**, not higher — the ORIGINAL failure mode this whole
     concurrency history is built around (an early uncontrolled
     `Promise.all` attempt) was real Anthropic rate-limit/contention
     errors, and this codebase has no visibility into this account's
     actual Anthropic rate-limit tier, so a modest, one-step-at-a-time
     increase (2 -> 3) is the responsible move pending real data, not a
     bigger speculative jump. Watch the `INSTRUMENT` log lines (both the
     per-page `status` field for an `anthropic_error`/`rate_limited`
     signal, and per-wave `waveDurationMs`) in
     `supabase functions logs ai-import` after trying 3 — if durations
     stay flat (no rate-limit errors, wave time still bounded by the
     slowest single page rather than growing with queue depth), it's
     safe to try 4 next; if `anthropic_error`/`529`-shaped failures show
     up, drop back to 2.
  HONEST LIMITATIONS, stated plainly rather than silently assumed away:
  - `JOB_HARD_BUDGET_MS` (240s) is a best-effort value, not an
    independently-verified platform ceiling for `waitUntil` background
    work — see `ai-import/index.ts`'s own BACKGROUND IMPORT comment block
    for the full reasoning. Monitor real job timing and adjust if the
    platform's real ceiling differs.
  - The local "ready to review" notification is genuinely best-effort: it
    depends on this app's own polling loop being alive to notice a
    transition (the app foregrounded, or backgrounded-but-still-JS-alive)
    at the moment completion happens. If the app is fully closed/killed
    while a job finishes, the notification fires on the NEXT time the app
    is reopened and polls again, not at the exact moment of completion.
    The JOB ITSELF still finishes correctly either way (server-driven,
    independent of the client) — only the NOTIFICATION's timing is
    affected. A guaranteed "notify even fully closed" would need real
    push notifications (APNs/FCM device token registration + a
    server-side sender) — a materially larger, separate feature
    deliberately not attempted this pass.
  - The staging Storage file (`{user_id}/import-jobs/...`, where a
    picked-but-not-yet-saved file lives so retry/review can re-read it)
    is NOT explicitly cleaned up when a job is dismissed — an accepted,
    minor, sweepable-later leak, same class of tradeoff already accepted
    elsewhere in this codebase (`cleanupOrphanedDocument()`'s own
    reasoning: a harmless orphaned Storage object is a smaller problem
    than the alternative). Both `reset-data`/`delete-account`'s existing
    recursive `{user_id}/` Storage-folder walk sweeps these up
    regardless, so this is bounded, not unbounded.
  - The client-side data-layer hooks (`useStartImportJob`/
    `useRetryImportJob`/`useDismissImportJob`/`useImportJobs`,
    `app/src/data/importJobs.ts`) have NO dedicated test file — a
    deliberate scope decision, not an oversight: they're thin wrappers
    around `supabase.from(...)`/`.storage.upload(...)`/
    `.functions.invoke(...)` with react-query boilerplate, the same shape
    as dozens of OTHER data hooks in this codebase with no test file of
    their own (`useTolls`, `useLoans`, ...) — the REAL logical complexity
    (status transitions, chip priority, sort order, retry eligibility) is
    the PURE `app/src/import/importJobs.ts` module, which does have full
    test coverage (below). The server-side job engine
    (`ai-import/index.ts`'s `handleJobStart()`/`runJobInBackground()`/
    `runJobPages()`) is hand-reviewed, not compiler-checked — no Deno CLI
    is available in this environment, same limitation every prior
    ai-import pass in this codebase has had, and genuinely no way to
    exercise `EdgeRuntime.waitUntil()` or a live Anthropic call from this
    sandbox.
  Tests: `app/src/import/__tests__/importJobs.test.ts` (new, 20 tests) —
  lifecycle status checks (`isActiveJob`/`isRetryableJob`/
  `isReviewableJob`), QUEUEING (`sortImportJobsForDisplay`: active jobs
  float above terminal ones regardless of age, newest-first within each
  bucket, a real multi-job queueing scenario, does not mutate its input),
  `deriveChipSummary`'s full priority matrix (processing/queued > ready >
  failed > hidden, correct counts), and a dedicated RESUMING AFTER
  BACKGROUNDING test proving `deriveChipSummary` is a pure function of
  whatever the current poll returned — calling it again with a
  freshly-changed snapshot (simulating the server having made real
  progress while the app was backgrounded/closed) reflects the new state
  completely, with the first call's own result provably untouched by the
  second. Plus `jobProgressFraction`'s edge cases (null total, zero
  total, clamping). `queryInvalidation.test.ts`'s TABLES_IN_DELETION_ORDER
  mirror gained `import_jobs`. Full suite: 93 suites / 2262 tests pass;
  `tsc --noEmit` clean (covers everything under `app/` — the Deno
  function itself is outside this tsconfig's scope, same as every prior
  ai-import pass).
  docs/PENDING_SQL.md §54 (`import_jobs` table + RLS + index) is ✅
  APPLIED. `import_jobs` was added to `reset-data`'s
  `TABLES_IN_DELETION_ORDER` (delete-account needs no explicit entry —
  `user_id ... on delete cascade` handles it automatically, same
  precedent as `drivers`) and to `queryInvalidation.ts`'s
  `AFFECTED_TABLES`; deliberately NOT added to `exportAllData.ts`'s
  `EXPORT_TABLES` (transient job/processing state, not a permanent
  financial record, same reasoning `ai_usage_log`/`service_status` are
  excluded for). `ai-import` was modified (new job mode,
  `EdgeRuntime.waitUntil` background engine) and has been redeployed;
  `ai-advisor`/`delete-account` were NOT touched; `reset-data` WAS
  modified (new table-list entry) and has been redeployed too. No new
  native dependency — `expo-notifications` was
  ALREADY a dependency and already configured
  (`app.config.js`'s existing plugin entry, already used by
  truckHealthNotifications.ts/complianceNotifications.ts) — ships via a
  normal `eas update`, no native rebuild needed.

- SPEED UP SETTLEMENT IMPORT (owner decision 2026-08-24, device report:
  strictly-sequential one-page-at-a-time processing made an 11-page
  settlement take 3-5 minutes wall-clock). Six items, all in one pass:
  1. **CONTROLLED CONCURRENCY**: `supabase/functions/ai-import/
     chunking.ts`'s new `runWithConcurrencyLimit()` — a generic,
     order-preserving bounded-concurrency worker pool (each of `limit`
     workers repeatedly claims the next unclaimed index from a shared
     cursor until the queue is empty; `results[i]` always matches
     `items[i]` regardless of which one finishes first). This is the
     dial between the two failed extremes CLAUDE.md's own MULTI-PAGE
     SETTLEMENT CHUNKING history already documents: an EARLIER
     uncontrolled `Promise.all` over a whole batch caused real Anthropic
     rate-limit/contention failures (which is why processing went fully
     sequential in the first place, round 5), while strict one-at-a-time
     processing is correct but slow. `BATCH_CONCURRENCY` (index.ts,
     default 2, overridable via the `AI_IMPORT_BATCH_CONCURRENCY` env var
     without a redeploy) governs it. `PAGES_PER_BATCH` is deliberately
     LEFT AT 2 this pass (not increased) — with concurrency also 2, an
     invocation's (up to) 2 pages now fire TOGETHER as one wave instead
     of sequentially, which is the direct, low-risk fix for the reported
     slowness without the added complexity of multiple waves per
     invocation. `PAGE_TIMEOUT_MS` (110s per page) and the dynamic
     `remainingInvocationBudgetMs()` hand-off-before-150s-ceiling
     mechanism are BOTH unchanged, per the owner's explicit instruction —
     a wave's budget is snapshotted once before firing its (up to 2)
     concurrent requests, then re-checked for real before ever starting
     a NEXT wave.
  2. **SMART PAGE TRIAGE**: `chunking.ts`'s new `triagePageOrder()` —
     reorders (never SKIPS — MULTI-PAGE SETTLEMENT CHUNKING ROUND 3's own
     hard-won lesson is that a fixed page CAP silently produced a
     $0-deductions settlement because real financial content lived past
     the cap) pages so financially-meaningful ones are extracted FIRST.
     CHEAP, NOT EXACT, HONESTLY FLAGGED: there's no OCR/text-extraction
     library available in this Deno function (a new, heavier dependency,
     deliberately out of scope for a speed pass) — this uses each page's
     own single-page-PDF byte size relative to the document's median as a
     proxy (a page >1.8x the median usually embeds a full-page raster
     scan — a photographed attachment — rather than the settlement's
     native, compact text/table content); a misclassification is
     harmless since every page still gets extracted either way, only the
     ORDER changes. Computed ONCE per document (the first invocation to
     enter the continuation path splits every page to measure it, then
     `pageOrder` is echoed back and forth between client/server on every
     later round via the new wire-protocol fields below, so the server
     never re-triages the same document twice).
  3. **SHRINK THE PAYLOAD**: audited honestly rather than half-built.
     Real, already-happening reduction, now MEASURED: splitting each page
     into its own single-page PDF (pre-existing architecture) already
     excludes every other page's fonts/images/objects via pdf-lib's
     `copyPages()` — this pass adds `INSTRUMENT` logging of each page's
     actual byte size so a real device import's real numbers are visible
     in `supabase functions logs ai-import` instead of assumed. The
     bytes measured for TRIAGE are also cached and reused for the actual
     extraction call on whichever pages the SAME invocation processes,
     avoiding a redundant re-split. True DPI/quality reduction of an
     embedded RASTER scan is explicitly NOT implemented — same honest
     limitation this codebase already flagged in the MULTI-PAGE
     SETTLEMENT CHUNKING ROUND 5 entry: it requires a PDF-rendering/
     image-codec dependency this Edge Function doesn't have. Duplicate/
     blank-page stripping was considered and deliberately NOT
     implemented — genuine risk of double-counting line items for a
     rare, unconfirmed-real-world case, not worth the risk to a data
     pipeline that's had multiple hard-won correctness passes.
  4. **PROGRESSIVE UI**: `index.ts` now returns `partialData` (the
     merged-so-far extraction) and `progress: {through, total}` on every
     ONGOING (non-terminal) response — `aiImportCall.ts`'s `onProgress`
     callback forwards it (sanitized through the same dateGuard/
     milesGuard pipeline as the final result). The import screen's new
     shared `handleAiProgress()` (`app/(tabs)/import/index.tsx`, used by
     both the pickPdf and handleRetryImport call sites so they can never
     drift apart) swaps the working label to
     `importScreen.processingPageProgressWithData` ("Page {{through}} of
     {{total}} · revenue and deductions captured") once the server has
     real financial figures, and renders a small running preview
     (Week Ending / Gross Revenue / Deductions / Net Pay, reusing the
     EXISTING `importScreen.previewLabels.*` keys the post-extraction
     preview screen already uses — only `previewLabels.weekEnding` was
     new) below the spinner — the user can start reviewing before the
     last (often attachment-heavy) page lands.
  5. **INSTRUMENT AND REPORT**: every page attempt now logs its own page
     number, payload byte size, duration, and status
     (`[ai-import] INSTRUMENT page=...`); every wave logs its page set,
     concurrency, duration, and remaining budget
     (`INSTRUMENT wave ...`); the one-time triage pass logs page count,
     average byte size, the computed order, and its own duration
     (`INSTRUMENT triage ...`). MEASURED BEFORE/AFTER, HONESTLY: this dev
     sandbox has no credentials to call the real Anthropic API (the same
     limitation flagged repeatedly throughout this codebase's own prior
     chunking passes) — no real 11-page settlement was actually run
     through this code. PROJECTED, not measured: with PAGES_PER_BATCH=2
     and BATCH_CONCURRENCY=2 both unchanged, an invocation's 2 pages now
     run concurrently instead of summed sequentially — using the
     previously MEASURED real per-page durations (23.9s-40s, CLAUDE.md's
     own ROUND 5 entry), a 2-page wave that used to take ~2×30s≈60s now
     takes ~max(30s,30s)≈30-40s, so an 11-page document's 6 round trips
     (unchanged count) should take roughly 6×35s≈210s (~3.5 min) instead
     of 6×60s≈360s (~6 min) — a projected ~40-45% wall-clock reduction,
     not a bigger claim than the architecture can honestly support. The
     new INSTRUMENT logging is what turns this projection into a real
     measurement on the next actual device import — check `supabase
     functions logs ai-import` after this deploy.
  6. **EVERYTHING ELSE STAYS**, verified not just claimed: retry-once on
     a genuine 5xx (never on timeout) — `callAnthropicMessages()`/
     `MAX_ANTHROPIC_ATTEMPTS` untouched; gap-tolerant merge — extended,
     not replaced (`mergeAllPages()` still marks confidence "low" on any
     missing page, still never stops the whole document over one bad
     page); the settlement reconciliation hard guard
     (`settlementReconciliation.ts`) — untouched, still operates purely
     on the final merged extraction's own fields regardless of how many
     waves/triage reorders produced it; no partial save without the
     needs-review flag — unchanged (`confidence` forcing logic in
     `mergeAllPages`/`mergeChunkedExtractions` untouched).
  CRITICAL CORRECTNESS FIX REQUIRED BY BOTH #1 AND #2, not optional:
  `mergeAllPages()` used to assume `outcomes[0]` was always page 1's own
  extraction (true only when pages were both processed AND returned
  strictly sequentially) — with triage reordering pages and concurrency
  letting them complete out of order, that assumption breaks. Fixed by
  sorting outcomes by PAGE NUMBER before merge, every time, regardless of
  processing/completion order — `chunking.test.ts`'s new "OUT-OF-ORDER
  OUTCOMES" tests reproduce exactly this (a scrambled-order input array
  proven to produce an IDENTICAL merge result to the naturally-ordered
  one).
  WIRE PROTOCOL RENAMED (owner decision, this pass — both client and
  server updated together in the same commit, no backward-compat shim
  needed): `pageRangeStart` (a raw page NUMBER) → `orderIndex` (a
  position INTO `pageOrder`, SMART PAGE TRIAGE's ordering) +
  `pageOrder: number[]` (echoed back and forth so the server never
  re-triages); `nextPageStart` → `nextOrderIndex`. Compared with `!==
  null`/`!= null` EVERYWHERE, never truthiness — `nextOrderIndex` can
  legitimately be `0` (an invocation that hit its budget ceiling before
  attempting even one page), which the old page-number-based
  `nextPageStart` never had to worry about (real page numbers start at 1,
  always truthy) — `aiImportCall.test.ts` gained a dedicated test for
  exactly this edge case.
  Tests: `chunking.test.ts` gained `runWithConcurrencyLimit` (limit
  respected, order preserved regardless of completion order, empty
  input, limit > item count, limit=1 fully sequential) and
  `triagePageOrder` (natural order preserved for similar-sized pages, a
  single/multiple attachment-looking pages moved to the end preserving
  relative order, never drops a page, degenerate all-zero-bytes input,
  single page) describe blocks, plus 2 new `mergeAllPages`
  "OUT-OF-ORDER OUTCOMES" tests. `aiImportCall.test.ts`'s existing
  continuation-loop suite was updated to the new orderIndex/pageOrder
  wire shape (same round-trip-count assertions as before, since
  PAGES_PER_BATCH is unchanged) plus 2 new tests (partialData forwarded
  through onProgress; the orderIndex=0 edge case). Full suite: 92 suites
  / 2230 tests pass; `tsc --noEmit` clean (the app-side `tsconfig.json`
  doesn't cover `supabase/functions/` at all — this repo has no Deno CLI
  available in this environment either, so the Edge Function's own
  TypeScript was hand-reviewed line by line rather than compiler-checked,
  same limitation every prior ai-import pass in this codebase has had).
  2 new i18n keys added to all 7 locales
  (`importScreen.processingPageProgressWithData`,
  `importScreen.previewLabels.weekEnding` — es/ru/ar/tr translated,
  hi/uk as untranslated English copies per invariant #11); every other
  preview label reuses the screen's own existing `previewLabels.*` keys.
  `ai-import` was modified (concurrency, triage, instrumentation, wire
  protocol) and needs redeploying; `ai-advisor`/`reset-data`/
  `delete-account` were NOT touched. No native rebuild needed — pure
  JS/TS work, no new native dependency, ships via a normal `eas update`.

- STATUS CHECK + FIX — LOGO, NAV ORDER, PER-MILE TRIO (owner decision
  2026-08-24, device report: three previously-requested items not visible
  on device). Audited each against the actual code before touching
  anything, per the owner's own explicit ask:
  1. **LOGO — was in the code, but with a real bug** (`src/components/
     BrandLogo.tsx:39`): `BrandLogo`'s own default `color` prop was
     `colors.accent` (brand blue, `#2563eb`) — every call site that didn't
     pass an explicit color rendered blue, directly contradicting this
     same file's own MONOCHROME VARIANTS comment ("colors.accent... never
     the default"). That covers `BrandWordmark.tsx:32`'s bare
     `<BrandLogo>` (used by the top bar `app/(tabs)/_layout.tsx:116`, the
     wide sidebar `WideSidebar.tsx:77`, CEO Mode's in-page header
     `ceo-mode.tsx:135`, and every share-card footer — `ceo-mode.tsx:287`/
     `scorecard.tsx:410`/`share-profit.tsx:185`) and `intro.tsx:59`'s own
     bare `<BrandLogo size={72} />` — exactly the "top bar, wide sidebar,
     intro slides, share card" symptoms reported. Fixed at the one source:
     the default is now `BRAND_LOGO_LIGHT` (white), matching this app's
     dark-theme-only in-app default; `colors.accent` must be passed
     explicitly wherever blue is actually wanted (no call site does).
     `ScreenErrorBoundary.tsx:131` (crash screen) and `BrandAppIcon.tsx:30`
     (icon source component) already passed `BRAND_LOGO_LIGHT` explicitly
     — unaffected, already correct. **Auth screens** (`sign-in.tsx`,
     `sign-up.tsx`, `forgot-password.tsx`, `check-email.tsx`,
     `confirm-email.tsx`, `reset-password.tsx`) had NO logo at all, not a
     color bug — confirmed by grep, only `BRAND_NAME` as plain text. Added
     a new shared `AuthBrandHeader` (`BrandLogo.tsx`) — a centered
     `<BrandLogo>` above each screen's own `ScreenTitle` — to all six, one
     import + one line each. **No leftover old logo component/emoji/image
     asset was found** to delete — grepped for the retired 🐺 emoji
     "wordmark icon" (only remaining uses are CEO Mode's own unrelated
     decorative wolf icon on its button/nav entry, a different, intentional
     feature motif, not a logo) and for any `require(...logo...)`/`Image`
     reference; none exist. **Splash screen + app icon are a separate,
     confirmed bug that code cannot fix**: `assets/images/icon.png` (and
     the matching `splash-icon.png`/Android adaptive-icon images) are
     still the literal default Expo template placeholder graphic (verified
     by viewing the file — a blue chevron/boomerang mark with template
     guide circles, never replaced with the truck brand mark). These are
     native-level assets baked into the binary at build time
     (`app.config.js`'s `icon`/`splash`/`adaptiveIcon` fields) — fixing
     them requires generating real PNG exports of `BrandAppIcon.tsx` (the
     source component built for exactly this, still not yet rendered to
     files) and a fresh EAS Build; no `eas update` can touch them. Flagged
     explicitly rather than silently left broken.
  2. **NAV ORDER — was NOT in the code**: `navRegistry.ts`'s
     `RAW_NAV_GROUPS` had Tools listed AFTER Business and Intelligence
     (Overview/Revenue/Expenses/Business/Intelligence/Tools/System) — the
     requested order was never implemented, not a shipped-but-not-updated
     case. Fixed by reordering the Tools group object to sit directly
     after Expenses: Overview/Revenue/Expenses/Tools/Business/
     Intelligence/System. Since `WideSidebar.tsx`/`MenuSheet.tsx` both
     render `GROUPS.map(...)` directly off this one array (NAV PARITY
     invariant above), this single reorder fixes both the wide sidebar and
     the phone Menu sheet at once, as expected. `navRegistry.test.ts`'s
     assertions use `.find()`, not index/order, so no test needed
     updating. Stale order-description comments in `navRegistry.ts`'s own
     header and `WideSidebar.tsx`'s header were updated to match.
  3. **PER-MILE TRIO — was NOT in the code**: grepped Home
     (`app/(tabs)/index.tsx`) for every plausible name (RPM, CPM,
     `revenuePerMile`, `costPerMile`, `profitPerMile`, "per-mile") — zero
     matches; this was never built, not a rendering bug. Added a new
     compact three-across row directly under the Revenue/Expenses/Net
     Profit trio, reusing the SAME canonical `calcCanonicalCpm()`
     (`src/stats/cpm.ts`) Scorecard's own KPI card and "Why?" breakdown
     already use — never a second CPM formula (mirrors Scorecard's exact
     truck-cost-basis/manual-override block: `carrierWithholdsLoanPayment()`
     → `calcTruckCostBasisWeekly()` → `resolveMilesTotal()` →
     `calcCanonicalCpm()`, fed by the same `dedQuery`/`fuelQuery`/
     `maintenanceQuery`/`tollsQuery` Home already fetches for the
     true-profit trend). The shared compact-tile component (previously
     `TaxStripTile`, Tax Strip-only) was generalized to `CompactStatTile`
     with a new optional `valueColor` prop — Profit/Mile is green when
     `>= 0`, red when negative, the Tax Strip's own three tiles are
     unaffected (no color passed, same as before). Reuses existing i18n
     verbatim, zero new keys/no 7-locale pass needed:
     `scorecard.revenuePerMile` ("Revenue/Mile"), `scorecard.costPerMile`
     ("Cost/Mile (CPM)"), `scorecard.whyPpm` ("Profit/Mile (PPM)"). Revenue/
     Mile and Profit/Mile tiles route to `/(tabs)/more/scorecard` ("their
     detail"); the Cost/Mile tile routes to Scorecard with a new
     `?openWhy=true` param — `scorecard.tsx` now reads it via
     `useLocalSearchParams()` to initialize `whyOpen`, the exact same
     `?filter=needsReview`-style deep-link pattern Alerts' own link into
     Deductions already established — landing directly in the "Why?"
     breakdown instead of just the KPI card. The ⚠️ miles-missing warning
     is kept, same condition (`stats.totalMiles <= 0`) and copy
     (`scorecard.milesMissingWarning`) as Scorecard's own.
  Tests: no new test files — every underlying function reused here
  (`calcCanonicalCpm`, `calcTruckCostBasisWeekly`, `resolveMilesTotal`,
  `carrierWithholdsLoanPayment`) is already covered by its own suite
  (`cpm.test.ts`, `truckCostBasis.test.ts`, `miles.test.ts`); this pass
  only wires Home up to call them, the same way Scorecard already does.
  Full suite: 92 suites / 2215 tests pass (unchanged — no new pure-logic
  module was added); `tsc --noEmit` clean. No SQL/Edge Function changes;
  no redeploy needed for either. `eas update` ships everything in this
  entry EXCEPT the splash/app-icon fix, which needs a native rebuild as
  noted above.

- FIVE ADDITIONS — UNLOCK NUDGES, CAPITAL CLARITY, GOAL-DRIVEN COACH, COST
  CONTROL, USAGE LIMITS (owner decision 2026-08-24, docs/PENDING_SQL.md
  §51, ✅ APPLIED 2026-08-24; ai-import and ai-advisor redeployed, client
  update published to preview).
  PART 1 — "UNLOCK" NUDGES: `src/alerts/missingDataNudges.ts`'s 5 existing
  detectors are joined by 7 more (`weeklyGoalNotSet`, `complianceItemMissing`
  — medical card/CDL/HVUT/IRP, role-filtered via the existing
  `isComplianceTypeVisibleForRole` — `entityTypeNotSet`, `homeStateNotSet`,
  `firstReceiptMissing`, `businessBalanceNotSet`, `perDiemZeroMileWeek`),
  each owner-only except `weeklyGoalNotSet` (universal — a goal is what
  makes the AI Coach a coach). Every NEW field
  `buildMissingDataNudgeCandidates()` takes is OPTIONAL and
  omission-means-"unknown, don't nudge" (never a false-positive default),
  which is what keeps the original 5 detectors' existing call sites/tests
  behaving identically with zero changes required. Real numbers wherever
  one exists: `depreciationNotSet` can carry a `previewTotal` (the
  Section-179/bonus "up to $X this year" figure, computed via
  `calcCurrentYearDepreciation({method:'full'}, ...)` from the truck's
  own already-entered purchase price/date); `settlementMissingMiles` can
  carry the real, already-inflated `currentCpm`; `perDiemZeroMileWeek`
  can carry the real potential per-diem dollars (count × 7 ×
  `tax_year_data.per_diem.daily_rate`, threaded in from the caller —
  CLAUDE.md invariant #6, never hardcoded); `weeklyGoalNotSet` can carry
  a `suggested` starting figure (the trailing-4-week average net, the
  SAME number Part 3's goal-entry field prefills with —
  `src/stats/goalProgress.ts`'s `trailingAverageNet()`, one shared
  function so the nudge and the field never suggest two different
  numbers). `src/alerts/unlockNudgePresentation.ts` is the ONE shared
  icon/route/time-estimate/sentence-builder (`unlockNudgeText()`) used by
  BOTH the Alerts screen's now-richer card (icon, benefit sentence, a
  small "Unlock now" CTA + "~N min" estimate, a "Don't show this again"
  link) — renamed from "Worth a look" to "Get more out of the app,"
  separate from the time-critical maintenance/compliance sections above
  it — AND a new one-line teaser inside Home's `AiCoachSection` (the
  single top-priority nudge, tap-through to where it's entered) — the two
  surfaces can never disagree about wording. A real bug caught mid-pass:
  `unlockNudgeParams()` originally defaulted `count`/`days` to `0` for
  EVERY topic, which would have made i18next silently apply
  plural-suffix resolution (`_one`/`_other`) to topics that were never
  meant to pluralize (e.g. `entityTypeNotSet`) — fixed by only including
  `count`/`days` in the interpolation params when the detail actually
  has one.
  PART 2 — PAYMENT SOURCE & CAPITAL CLARITY: "Reimburse Myself" reuses
  the EXISTING `capital_transactions.linked_deduction_id` column,
  dual-purpose by design (no new SQL column) — on a `tx_type:'draw'` row
  it now means "this draw reimburses that deduction's own linked
  contribution," unambiguous alongside its existing
  `tx_type:'contribution'` meaning. `src/stats/capitalAccount.ts`'s new
  `calcReimbursementStatus()` (contribution amount − sum of its own
  reimbursement draws, floored at $0 — "returned capital must not keep
  inflating the tax-free base") and `summarizeCapitalFlows()` (the 4
  distinct flows: cash contributed / expenses paid personally still
  outstanding — netted against whatever's already been reimbursed for
  THAT specific expense / reimbursements taken back / owner draws, each
  with its own total; `netPosition` — contributions − draws −
  reimbursements — proven by test to always equal
  `calcCapitalAccount()`'s own `effectiveContribution − totalDraws` for
  the same data, so the two can never silently disagree). Deductions'
  edit sheet fetches `fetchReimbursementStatus()` when it opens (per-row,
  on demand — not a bulk fetch for every list row) and shows "Paid
  personally · reimbursed $X of $Y" / "· reimbursed in full" / "· not yet
  reimbursed" plus a "💰 Reimburse Myself ($outstanding)" button when
  applicable (`useReimburseMyself()`, `src/data/capitalTransactions.ts`
  — same atomic `apply_business_balance_delta` RPC pattern as every other
  real cash movement this screen already makes, direction = draw, since a
  reimbursement moves cash OUT of the business same as a plain draw).
  Capital Account gained a "Where your equity comes from" card (4 `FlowRow`s
  + a Net Position total) ahead of the existing cash/linked contribution
  breakdown card. Payment-source visibility/editability "everywhere an
  expense appears" (item 3) was AUDITED, not rebuilt — `deductions.tsx`'s
  existing `planContributionSync()`/`applyContributionSync()` wiring
  already creates/removes the linked contribution correctly on a
  business↔personal switch, confirmed unchanged and sufficient.
  PART 3 — WEEKLY GOAL DRIVES THE COACH: `src/stats/goalProgress.ts`
  (`calcGoalProgress()` — $ progress, %, and — only when a real
  rpm/avg-revenue-per-load exists, never fabricated — miles-at-current-
  RPM and loads-at-average-revenue-per-load gap-closing terms;
  `calcGoalStreak()` — signed consecutive-week count against the goal;
  `suggestGoalAdjustment()` — 'raise' at 3+ consecutive beats, 'lower' at
  5+ consecutive misses) feeds TWO surfaces: (1)
  `buildWeeklyReviewPrompt()` (`src/stats/weeklyReview.ts`) gained an
  optional `goalProgress` block — omitted entirely (never a fabricated
  "$0 goal" sentence) when no goal is set, per item 3's own "no goal set
  → the Part 1 nudge explains what it unlocks; the coach starts using it
  immediately once entered"; (2) `periodicCoachNudges.ts` gained 4 new
  goal-aware `CoachNudgeTopic`s (`goalStreakOver`/`goalStreakUnder`,
  `goalRpmGap` — the RPM this week's own miles would have needed to hit
  goal — `goalCostCategoryShortfall` — the single largest expense
  category dated that settlement week, only named when the goal was
  actually missed — `goalRaiseSuggestion`/`goalLowerSuggestion`), reusing
  the SAME 30-day-per-topic cooldown engine E2's periodic nudges already
  established, disjoint topic keys so the two families can never
  collide. `useProactiveCoach()` computes all of this once
  (`avgRevenuePerLoad` from that week's own `loads` rows,
  `goalTopCostCategory` from that week's own deductions) and threads it
  into both consumers. The weekly-goal field (`ceo-mode.tsx`'s existing
  first-open prompt, now joined by a new field in Settings' Business
  Profile card) is prefilled — never overwriting an in-progress edit or
  an already-saved goal — from `trailingAverageNet(coach.weeklyTrend)`,
  the identical number Part 1's `weeklyGoalNotSet_amount` nudge suggests.
  ⤷ [moved 2026-10-13: lines starting "PART 4 — COST CONTROL & GRACEFUL DEGRADATION: ever..." -> docs/decisions/usage-limits.md]

- NEXT PASS — BRANDING, AUTH COMPLETENESS, TAX STRIP, SMART ALERTS, AND
  PROACTIVE AI COACHING (owner decision 2026-08-24, five coherent commits):
  A. **BRANDING CLEANUP**: every remaining literal "Bozkurt Fleet OS" was
     replaced with `BRAND_NAME` ("BOZKA TRUCKING AI") — `app.config.js`'s
     `name` field and its two native-permission strings (camera/photo),
     the live `privacyPolicy.ts` body, CLAUDE.md's own rule-defining line
     (the one two lines above listing what's an allowed hardcoded brand
     value), and every doc-only mention (AGENTS.md, README.md, docs/*.md,
     PROMPTS.md, supabase/migrations/0001_init.sql, supabase/seed.sql).
     `slug`/`scheme`/`bundleIdentifier`/`package` deliberately kept as
     their original `bozkurt-fleet-os`/`bozkurtfleetos`/
     `com.bozkurtfleetos.app` values — native store/deep-link identifiers
     that would need a fresh app-store listing to change, a separate
     later decision. `legacy/index.html` and one historical CLAUDE.md log
     entry (FULL PARITY FOLLOW-UP PART H's own grep-audit record) were
     deliberately left untouched — legacy is never a source of truth for
     identity (this file's own top rule) and the log entry is a verbatim
     historical record of what was searched for at the time, not a live
     rule. **Logo**: `BrandLogo.tsx` (an existing react-native-svg
     side-profile semi-truck mark, RTL-mirrored) gained `BRAND_LOGO_DARK`/
     `BRAND_LOGO_LIGHT` color-preset exports so the mark stays legible
     regardless of background (a captured share-card image, a future
     white app-icon background) instead of only the in-app dark-theme
     default; added to `ScreenErrorBoundary.tsx`'s crash screen (the one
     major surface that didn't already show it — top bar/sidebar/intro/
     share cards already did). New `BrandAppIcon.tsx` composes a square
     dark-background + white-truck icon from the same mark via plain View
     layout (no nested-SVG-viewport complexity) — a SOURCE COMPONENT
     ready for Session 10's real store-asset export (turning it into
     actual `app.config.js` icon files still needs a render-to-PNG step
     this pass didn't do, and a native rebuild to ship it — explicitly
     flagged, not silently claimed done).
  B. **AUTH COMPLETENESS**: this Supabase client uses `flowType: 'implicit'`
     (confirmed by reading the installed `@supabase/auth-js` source, not
     assumed) and `detectSessionInUrl: false` — both password-recovery and
     signup-confirmation email links carry their tokens as a URL HASH
     FRAGMENT (`#access_token=...&type=recovery|signup`), which must be
     parsed manually. `src/auth/deepLink.ts`'s `parseAuthDeepLink()` (pure,
     zero `expo-constants`/`react-native` imports — this repo's jest.config.js
     runs `src/auth/**` under plain ts-jest/Node with NO Expo/RN mocking,
     same reason `buildInfo.ts`/`buildInfoFormat.ts` are split — the one
     function that reads `Constants.expoConfig.scheme`,
     `buildAuthRedirectUrl()`, lives in the separate untested
     `deepLinkRedirect.ts`) handles the hash-fragment shape, a `?code=`
     PKCE fallback, and Supabase's own `#error_description=...` shape for
     an expired/invalid link. `src/auth/deepLinkExchange.ts` dispatches a
     parsed link to `supabase.auth.setSession()`/`exchangeCodeForSession()`.
     Deliberately did NOT add `expo-linking` as a new dependency — React
     Native's own built-in `Linking` API (`getInitialURL`/`addEventListener`)
     already round-trips through the app's existing custom `scheme`
     (already configured in `app.config.js` before this pass) with zero
     native-module change, keeping this whole item OTA-deployable.
     **Forgot password**: sign-in gets a "Forgot password?" link ->
     `(auth)/forgot-password.tsx` (email input, 60s client-side resend
     cooldown on top of Supabase's own server-side rate limiting,
     `sendPasswordResetEmail()`) -> `reset-password.tsx` (a NEW top-level
     route, `rootRedirect.ts` exempts it from the normal "no session ->
     sign-in" bounce since the screen itself establishes a session from
     the link's token — and, uniquely among every gate screen in this
     app, is NEVER auto-redirected to `(tabs)` even once that session
     exists, so a user can't get yanked away before actually submitting
     their new password; it navigates itself once done, same
     explicit-navigate pattern as `tutorial.tsx`/`onboarding.tsx`) —
     handles an expired/invalid link (shows the real Supabase error,
     offers "Request New Link") and a genuine new-password form
     (`validateNewPassword()`, `src/auth/resetPasswordFlow.ts`).
     **Email confirmation**: `signUp()`/`resendConfirmationEmail()` both
     set `emailRedirectTo`/`options.emailRedirectTo` to
     `bozkurtfleetos://confirm-email`, so the confirmation email's link
     opens straight back into the app. Two entry paths, one shared UI
     pattern: (a) NO session yet (Supabase's "Confirm email" is on, so
     `signUp()` never granted one) — `sign-up.tsx` now routes to
     `(auth)/check-email.tsx` (resend + "use a different email address")
     instead of the old inline message; (b) a session DOES exist but
     `session.user.email_confirmed_at` is still null — a new
     `needsEmailConfirmation` gate (`resolveNeedsEmailConfirmation()`,
     `src/auth/profileGates.ts`, reads the Supabase Auth user object
     directly, no separate DB fetch/race to worry about) routes to the
     new top-level `confirm-email.tsx`, which is ALSO the deep-link
     target for path (a)'s email link — dual purpose, one screen. This
     gate runs FIRST among the authenticated gates in `resolveRootRedirect()`,
     ahead of ToS/tutorial/onboarding. `sign-in.tsx` also detects
     Supabase's specific "Email not confirmed" sign-in error and offers a
     resend button instead of a dead-end raw error string. Existing
     accounts are never retroactively locked out — Supabase auto-sets
     `email_confirmed_at` at signup time whenever "Confirm email" is off,
     so turning the setting on later doesn't touch already-confirmed
     users. See DELIVERABLES below for the exact Supabase dashboard steps
     this item requires (not a code change).
  C. **HOME TAX STRIP**: three compact, tappable tiles as the LAST content
     block on Home (ahead of only the Sign Out button) — Weekly Tax
     Reserve / Next Quarterly Payment (amount + due-date countdown,
     reusing the Tax Estimator's own `taxEstimator.deadlinePast`/
     `deadlineToday`/`deadlineInDays` copy rather than duplicating it) /
     Estimated Yearly Tax — all three reading from the SAME canonical
     `useTaxEstimate()` every other tax screen already uses (CLAUDE.md
     invariant #6), with the estimates-only disclaimer. Loading and
     no-tax-config-yet states both handled explicitly (the latter shows
     nothing, never a `$0` guess).
  D. **ROLE-AWARE SMART ALERTS + MISSING-DATA NUDGES + FREQUENCY
     DISCIPLINE**: `src/alerts/roleFilter.ts`'s `isComplianceTypeVisibleForRole()`
     filters the Alerts screen's compliance rows by `profiles.role` BEFORE
     they ever reach the UI — a company driver (or `trainee`, treated the
     same way — riding along, not operating their own truck) never sees a
     truck-only compliance item (HVUT 2290, IRP, annual inspection,
     insurance policy, IFTA — the schema has no separate "state sticker"/
     "cab card" type, IRP registration covers that ground), only personal
     ones (medical card, CDL, drug-consortium enrollment — a driver-level
     DOT requirement regardless of who owns the truck). An owner-operator/
     lease-operator/1099-contractor (CLAUDE.md invariant #18: 1099 already
     gets the full Schedule C experience, implying it also handles its own
     truck-related expenses) sees both. `role === null` shows every item
     (never silently hides a real deadline) AND a one-time "what's your
     role?" prompt (`resolveRolePromptNeeded()`) — answering it sets
     `role` directly; dismissing without answering sets the new
     `profiles.role_prompt_dismissed_at` (docs/PENDING_SQL.md §49) so it
     asks only once. New "Worth a look" section surfaces missing-data
     nudges (`src/alerts/missingDataNudges.ts`, pure detectors): no
     settlement imported in 10+ days, a settlement with revenue but no
     miles, truck cost basis / depreciation method not set (owners only —
     `isOwnerRole()`), receipts stuck in NEEDS REVIEW. Every nudge is
     frequency-capped (`src/alerts/nudgeFrequency.ts`): at most once per
     topic per week, never more than 2 a day (counted across ALL topics
     shown that calendar day, not per-topic), nothing at all in the first
     24 hours after signup, and silenceable per topic — all persisted
     server-side as `profiles.nudge_state` (jsonb, §49; also wired into
     `reset-data`'s `PROFILE_DATA_RESET` CLEARED bucket, per invariant
     #24's own "a new column missed here is exactly the bug class that
     audit exists to catch" warning). "Shown" is recorded the instant a
     nudge is rendered anywhere it's computed (the Alerts screen AND the
     always-mounted tab-bar bell badge both call `useAlertsData()`) —a
     deliberate, documented choice: the badge count IS itself a form of
     notification, so this doesn't under-count "shown" against the daily
     cap.
  E. **AI COACH — PROACTIVE, PERIODIC COACHING**: two features sharing the
     `nudge_state` frequency engine (generalized to a `<Topic extends
     string>` generic so both D's weekly-cooldown family and E's
     monthly-cooldown family use the identical, once-tested
     `selectNudgesToShow`/`recordNudgesShown`/`silenceNudgeTopic` — disjoint
     topic key sets mean the two families can never collide in the same
     JSON blob). **Weekly settlement review** (item E1): when a new
     settlement week becomes available, `src/stats/weeklyReview.ts`'s
     `shouldGenerateWeeklyReview()` (a new week_ending differs from the
     cached one, AND 7+ days since the last generation — the spec's own
     "one ai-advisor call per user per week at most" cap) triggers
     `buildWeeklyReviewPrompt()` — a rich, data-filled prompt (revenue,
     net, RPM vs. the user's own trailing 4-week average, deadhead %,
     fuel % of revenue, biggest settlement chargebacks, per-diem days,
     YTD profit before/after this week) sent as a single `ai-advisor`
     call, same "compose client-side from real numbers" pattern
     `ceo-mode.tsx`'s own briefing already established. Cached in three
     new `profiles.ai_weekly_review*` columns (§49) so it's lazily
     generated (and re-cached) the next time Home or Alerts is viewed
     after a new settlement lands, not synchronously inside the import
     save transaction. **Periodic nudges** (item E2): a second,
     conversational nudge family (`src/alerts/periodicCoachNudges.ts`) —
     no receipt added in 12+ days, a common quarterly expense category
     with zero spend this quarter (phrased as a question, from a fixed
     6-category list: Fuel Additives, Safety Gear & Workwear, Tools &
     Equipment, Parking & Lodging, ELD & Communications, Truck Wash &
     Detailing — never "invent an expense" advice), the accountant
     package being ready ahead of a close quarterly deadline, the
     quarterly tax deadline itself, fuel-% and deadhead-% trending up
     vs. the user's own trailing 4-week average, and CPM drifting above
     RPM (computed by reusing the SAME canonical true-profit weekly
     figure Home/Scorecard already read, `(gross - trueProfitNet) /
     miles`, never a second cost calculation). Capped to ONE visible
     nudge at a time (a rotating voice, not a checklist) with a 30-day
     per-topic cooldown ("never repeat the same one within a month," the
     spec's own words) via the shared engine's `ONE_MONTH_MS`. **Scope
     decision on delivery** (item E4's "phrased through ai-advisor...
     one call per week at most"): that single-call cap is spent entirely
     on the weekly review, which genuinely benefits from AI composition;
     the periodic nudges are short, fully-determined single-fact
     observations (same shape as item D's missing-data nudges) delivered
     as plain i18n templates instead of a second AI call — this is what
     keeps total AI usage at the spec's own explicit ceiling rather than
     silently doubling it. Both surfaces (weekly review + periodic nudge)
     render in Home's `AiCoachSection` (ahead of the existing top-3
     recommendation list, since they're the more time-relevant "just
     happened" content) and the periodic nudge also appears in Alerts'
     new "From your AI Coach" section, via the shared `coachNudgeText()`
     presentation helper so the two surfaces can never disagree about
     wording.
  DELIVERABLES: 81 suites / 1988 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (glossary test caught and fixed a real
  slip mid-pass — "deadhead" got translated instead of kept in Latin
  script in all four of es/ru/ar/tr's `deadheadTrendUp` string, fixed
  before commit). docs/PENDING_SQL.md §49 (5 new `profiles` columns:
  `nudge_state`, `role_prompt_dismissed_at`, `ai_weekly_review`,
  `ai_weekly_review_generated_at`, `ai_weekly_review_week_ending`) is NOT
  YET RUN against the live project as of this writing.
  `supabase/functions/reset-data/index.ts` was updated in this pass and
  needs redeploying; `ai-import`/`ai-advisor` were NOT touched, no
  redeploy needed for either. A1's `app.config.js` `name` field and its
  two native-permission strings are NATIVE-LEVEL identifiers baked in at
  build time — an `eas update` (OTA) cannot change them; the new display
  name/permission strings only reach a device via a fresh EAS Build.
  Every other item in this pass (B-E, plus the logo/crash-screen changes
  in A2) is pure JS, fully OTA-deployable. Supabase dashboard steps for
  enabling "Confirm email" + configuring custom SMTP from
  bozkatruckingai@gmail.com are documented in `docs/ADMIN_RUNBOOK.md`'s
  "Email Confirmation + Custom SMTP" section (added this pass) rather
  than only in chat, so they survive past this conversation.

- DEVICE TESTING ROUND — THREE ITEMS (owner decision 2026-08-24):
  1. **TUTORIAL GATE BUG, root cause confirmed and fixed**:
     `AuthContext.tsx`'s `needsTutorial` had `if (!profile) return false` —
     an UNLOADED profile (still fetching, or its fetch failed/timed out)
     was silently treated as "already seen," the exact wrong default.
     `needsTos` two lines above already had the correct default
     (`if (!profile) return true`, "block until confirmed"); `needsTutorial`
     now matches it. This was NOT signup-path-only — `resolveRootRedirect()`
     and the whole gate chain are driven purely by `profiles.tutorial_seen_at`
     regardless of signup vs. sign-in, confirmed by re-reading
     `app/src/navigation/rootRedirect.ts` and `app/app/_layout.tsx` — but the
     wrong default meant a sign-in transition (session set, profile fetch
     still in flight) or a stuck fetch could permanently skip it. All three
     gate functions (`needsTos`/`needsTutorial`/`needsOnboarding`) are now
     extracted into pure, testable functions,
     `app/src/auth/profileGates.ts` (`resolveNeedsTos`/`resolveNeedsTutorial`/
     `resolveNeedsOnboarding`), same convention as `rootRedirect.ts`/
     `signUpFlow.ts` — `needsOnboarding`'s own pre-existing
     `if (!profileLoaded) return false` was deliberately left UNCHANGED
     (not part of this bug report), just extracted for consistency.
     `AuthContext.tsx`'s `fetchProfile()` also gained a defensive fallback:
     if the full column select 400s specifically on `tutorial_seen_at`
     (the migration hasn't actually run against the live DB — §48 IS
     applied now, but this guards any future column added the same way),
     it retries once without that column instead of letting the WHOLE
     profile fetch fail and silently null out `tos_accepted_at`/
     `onboarding_completed_at` too. Verified BOTH replay entry points
     (Settings → "How it works", Import's empty-state "See how" link)
     already render unconditionally and already correctly
     `router.push('/tutorial?replay=true')` — no code path was found that
     could break their reachability; no change needed there.
     Tests: `app/src/auth/__tests__/profileGates.test.ts` (new) —
     regression-guards the exact bug (`resolveNeedsTutorial` with
     `profileLoaded: false` must return `true`, not `false`) plus every
     other branch of all three gate functions.
  2. **AI COACH FULLY VISIBLE ON HOME**: the shallow `AiCoachCard` teaser
     (icon + bold title + one static sentence, tap-through only) is
     replaced by `AiCoachSection` (`app/(tabs)/index.tsx`), which renders
     the actual briefing inline — a greeting line (time-of-day +
     first name, same `dashboard.greeting.*` keys the page's own header
     greeting uses), the profit-opportunity headline with its dollar
     figure (`ceoMode.recommendations.headerTitle`/`headerTitleZero`),
     and all three recommendation rows (icon + amount, each independently
     tappable to its own relevant screen via `recommendationRoute()`) —
     no truncation, no "see more" gate, `LegalFootnote` disclaimer kept.
     A "🧑‍✈️ Open full AI Coach →" link stays for the detail/goal-
     tracking/chat view (`ceo-mode.tsx`, unchanged in scope). Rather than
     Home re-deriving a second copy of ceo-mode.tsx's recommendation
     logic (real drift risk — two independently-computed "top 3
     recommendations" lists that could disagree), the ENTIRE derivation
     (weekly true-profit trend, needs-review/maintenance/compliance
     counts, the fuel-benchmark/tax-reserve-shortfall recommendation
     inputs, `buildRecommendationCandidates`/`selectTopRecommendations`)
     was extracted out of `ceo-mode.tsx` into the ONE shared
     `app/src/data/aiCoachSummary.ts`'s `useAiCoachSummary()` hook, which
     both `ceo-mode.tsx` and Home now call — react-query dedupes by query
     key, so this does not double-fetch settlements/deductions/fuel/etc.
     already active elsewhere on either screen. The presentation helpers
     (`RECOMMENDATION_ICON`, `recommendationText()`, `recommendationRoute()`)
     moved from being ceo-mode.tsx-local into `src/stats/aiRecommendations.ts`
     for the same single-source-of-truth reason. A zero-recommendations
     account (nothing currently flagged) shows `ceoMode.homeAllCaughtUp`
     ("You're all caught up...") instead of an empty card, still reachable
     to the full screen.
  3. **AI BUSINESS SCORE REMOVED ENTIRELY** (owner decision: "a made-up
     score adds nothing next to real dollar figures"): `src/stats/
     aiBusinessScore.ts` (`calcBusinessScore()`, the 0-100 composite +
     four 1-5 star sub-ratings) and its test file are deleted outright.
     `ceo-mode.tsx` had the only other reference — its Business Score
     Card, the star-rating info `ModalSheet`, and the Share card's score
     display are all removed; the Share card now shows the This-Week
     Revenue/Profit KPI pair as its own headline content instead of a
     score number. All 11 related i18n keys
     (`businessScoreTitle`/`starFuelEfficiency`/`starTaxOptimization`/
     `starMaintenance`/`starCashFlow`/`scoreInfoTitle`/`scoreInfoBody`/
     `scoreInfoFuel`/`scoreInfoTax`/`scoreInfoMaintenance`/
     `scoreInfoCashFlow`) were deleted from all 7 locale files — confirmed
     via repo-wide grep that nothing else imports `aiBusinessScore`,
     `calcBusinessScore`, `StarRating`, or references any of the deleted
     keys before removing them. This is UNRELATED to Scorecard's own 0-100
     score/grade (`calcScorecard()`, `app/(tabs)/more/scorecard.tsx`) or
     to the Dashboard's already-retired Fleet Health Score gauge (DASHBOARD
     SIMPLIFICATION above) — neither of those is touched by this item;
     "AI Business Score" was specifically CEO Mode's own separate 4-star
     composite.
  Tests: 74 suites / 1847 tests pass (+8 from `profileGates.test.ts`);
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (2 new
  `ceoMode.homeAllCaughtUp`/`ceoMode.homeOpenFull` keys added, 11 old
  score keys removed, es/ru/ar/tr fully translated, hi/uk untranslated
  English copies per invariant #11).

- IMPORT SAVE BUG FIX — empty-string dates/numerics never reach the
  database (owner decision 2026-08-23, device evidence: "Failed while
  saving loads/fuel/deductions — invalid input syntax for type date:
  \"\"" from the step-tagged error UI). Root cause: every AI-extracted
  field in `app/src/import/types.ts`'s `Extraction` type is typed as
  optional `string` (never `string | null`), so the model can return a
  key with an EMPTY-STRING value rather than omitting it; several date/
  numeric fallback chains across `mapExtraction.ts`/`aiImportSave.ts`
  used `??` (nullish coalescing), which only treats `null`/`undefined`
  as "absent" — a present-but-empty `''` sailed straight through to a
  Postgres `date`/`numeric` column, which rejects `''` (only a real
  value or `NULL` is valid). `||`-based chains were already safe (falsy
  includes `''`); this was specifically a `??` bug.
  1. **`app/src/import/dateGuard.ts`'s `toDateOrNull(value)`** is now the
     ONE guard every date written to the database routes through:
     `null`/undefined/non-string/whitespace-only/anything that isn't a
     real calendar date all return `null`. It's stricter than the
     existing lenient `parseIsoDate()` alone — that helper's
     `Date.UTC()` arithmetic silently ROLLS OVER an out-of-range month/
     day (month 13 becomes January of the next year) instead of
     rejecting it, so `toDateOrNull()` round-trips the parsed date's own
     year/month/day back against the original digits (same pattern
     `trySwapYearAndDay()` already uses in the same file) and returns
     `null` on any mismatch.
  2. **`app/src/import/mapExtraction.ts`'s `numOrNull(v)`** is the
     nullable counterpart to the existing `num(v, fallback=0)` — used
     wherever a `0` fallback would falsely claim "we know this is zero"
     on a nullable numeric column (gallons, loan balance/payment/APR,
     warranty years, document amount) as opposed to a NOT NULL column
     with a real 0 default, which keeps using `num()`.
  3. **Every mapper in `mapExtraction.ts` routes its own date/numeric
     fields through these two** (settlements, loads, fuel, maintenance,
     tolls, deductions, reimbursements, compliance, driver payments,
     loan agreements) — `mapSettlement()`'s own
     `settlementFallbackDate = toDateOrNull(s.weekEnding) ??
     toDateOrNull(d.date) ?? undefined` is the ONE settlement-level
     fallback every child mapper (`toFuelInsert()`/`toTollInsert()`, the
     inline load/deduction/maintenance mappers) receives as a
     `fallbackDate` param — implementing the exact "row's own date, else
     week_ending, else document date, else NULL" chain from the bug
     report: a child row is never rejected just because the AI left its
     own date blank. `aiImportSave.ts`'s `capital_transactions` insert
     (`tx_date: toDateOrNull(d.date) ?? new Date().toISOString().slice(0,
     10)`, a `NOT NULL` column) and `documents.amount`
     (`numOrNull(d.totalAmount)`) got the identical fix.
  4. **Resilient batch insert, `aiImportSave.ts`'s
     `insertBatchResilient()`**: loads/fuel_purchases/deductions/
     reimbursements/maintenance_records/tolls each try a fast full-batch
     `.insert()` first; on any failure, falls back to inserting ONE ROW
     AT A TIME, collecting `{table, description, reason}` for whichever
     rows still fail into `SaveExtractionResult.skippedRows` rather than
     discarding the whole import over one bad row. Carefully preserves
     the PRE-EXISTING re-import safety invariant (CLAUDE.md invariant
     #10's "old rows are deleted only after every new row succeeds"): on
     a REIMPORT, a persisting per-row failure still THROWS a
     `SaveExtractionError` (never silently deletes last week's data over
     an incomplete replacement); on a brand-new import (no prior data at
     risk), a partial failure is tolerated and reported instead. The
     import screen (`app/(tabs)/import/index.tsx`) shows an amber
     `importScreen.skippedRowsWarning` banner listing exactly which rows
     were skipped and why, whenever `skippedRows.length > 0`.
  Tests: `app/src/import/__tests__/dateGuard.test.ts` gained a
  `toDateOrNull` describe block (valid passthrough, empty/whitespace/
  "N/A"/null/undefined → null, malformed calendar date → null,
  whitespace-trimming). `app/src/import/__tests__/mapExtraction.test.ts`
  gained a `numOrNull` describe block plus edge-case coverage inside
  `mapSettlement`/`mapFuel`/`mapMaintenance`/`mapGenericDeduction`/
  `mapCompliance` (empty-string/malformed dates and numerics sanitizing
  correctly, settlement week_ending fallback, a string warrantyCredit
  like `"150.00"` still creating a correct numeric reimbursement despite
  JS's loose `>` comparison coercion risk). `app/src/data/__tests__/
  aiImportSave.errorReporting.test.ts` gained an "IMPORT SAVE BUG FIX
  (resilient batch insert)" block (transient-failure recovery, a
  persistent NEW-import failure reported not thrown, a persistent
  REIMPORT failure still throwing, good rows in the same batch still
  saving alongside a skipped one) and had its two pre-existing tests
  that asserted the OLD always-throw-on-any-failure behavior updated to
  match this deliberate behavior change. `app/src/data/__tests__/
  aiImportSave.settlementChildren.test.ts` gained an end-to-end
  "empty-string/malformed dates and numerics never reach the database"
  block proving a realistic malformed extraction (empty pickup/delivery
  dates, `'N/A'` gallons/amount, empty loan balance/payment/nextDue)
  saves without throwing, with every child row correctly inheriting the
  settlement's `week_ending` and every bad numeric landing as `null`.
  Full suite: 74 suites / 1839 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`importScreen.skippedRowsWarning`, hi/uk
  as untranslated English copies per invariant #11).

- FULL PARITY FOLLOW-UP, PART I — FIRST-RUN TUTORIAL (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item I). A 6-slide illustrated
  walkthrough — Snap it · AI reads it · You confirm · It lands everywhere
  · Your documents are kept · Ready for your accountant — shown once,
  gated between ToS acceptance and the onboarding wizard, and replayable
  any time from Settings > "How It Works" and the Import screen's empty-
  state "See how" link.
  **Gating**: `docs/PENDING_SQL.md` §48 (✅ APPLIED 2026-08-23)
  adds `profiles.tutorial_seen_at` (null = never seen, same "set once,
  never reset" pattern as `onboarding_completed_at`, §28).
  `AuthContext.tsx` gained `needsTutorial` (true once `!needsTos` and the
  column is null) and `needsOnboarding` now ALSO requires `!needsTutorial`
  — the tutorial must clear before onboarding ever shows, matching the
  spec's own explicit ordering. `app/src/navigation/rootRedirect.ts`'s
  pure gate function (`resolveRootRedirect()`) got a new priority rung
  slotted between the existing `tos`/`onboarding` lines: `needsTos` →
  `needsTutorial` → `needsOnboarding` → `(tabs)`. `app/app/_layout.tsx`
  registers the new `tutorial` Stack.Screen and threads `needsTutorial`
  into the redirect effect, same pattern as every other gated screen.
  **Screen** (`app/app/tutorial.tsx`): reads an optional `?replay=true`
  param. First-run (no param): finishing (Skip or reaching the last
  slide's Done) marks `tutorial_seen_at` then explicitly
  `router.replace('/onboarding')` — same explicit-navigate pattern as
  `onboarding.tsx`'s own `finishOnboarding()`, chosen over relying on the
  root-redirect effect to notice the profile change (faster, no extra
  render flash); the profile write is best-effort (a failure just means
  the tutorial shows again next launch, never worth blocking the user
  over). Replay (`?replay=true`): finishing just calls `router.back()`
  and never touches `tutorial_seen_at` again.
  **Pager** (`app/src/components/TutorialPager.tsx`): the ONE shared
  component every entry point renders — a plain horizontal
  `ScrollView` with `pagingEnabled` (native swipe support, no gesture
  library needed), dot indicators (tappable to jump), a "Skip" link
  top-right, and a bottom Next/Done `PrimaryButton`. REDUCED-MOTION-SAFE
  BY CONSTRUCTION: there is no `Animated`/`Reanimated`/autoplay anywhere
  in this component — every page transition is 100% user-driven (a swipe
  or a tap), so there's no auto-advancing motion an OS "reduce motion"
  setting would ever need to suppress. PHONE+TABLET: slide width comes
  from `onLayout` (never a hardcoded pixel value), so it scales cleanly
  to any screen size; the illustration itself is capped at
  `min(220, width * 0.55)` so it never grows absurdly large on a tablet.
  **Visuals** (`app/src/onboarding/slideVisuals.tsx`): ONE registry
  (`SLIDE_VISUALS`, slide id → component) — today every slide renders an
  in-app `react-native-svg` line-art scene (no new native dependency,
  works offline, zero asset weight). `app/assets/tour/README.md`
  documents the exact future PNG filenames (`tour-01-snap.png` ...
  `tour-06-report.png`) a future pass would drop in to upgrade to real
  illustrated artwork — the registry is the ONE place that swap would
  happen; the pager and every entry point read through it and would
  never need to change.
  **Content** (`app/src/onboarding/tutorialSlides.ts`): the ONE shared
  slide list (id + title/body i18n keys) every entry point reads from —
  first-run and every replay path render byte-identical content, can
  never drift apart.
  **Reset All Data**: `tutorial_seen_at` was deliberately left OUT of
  `reset-data`'s `PROFILE_DATA_RESET` field list — same KEPT bucket as
  `onboarding_completed_at` (CLAUDE.md invariant #24) — an explicit
  decision, not an oversight the way `dashboard_layout` was originally
  missed: a user resetting their business data shouldn't be forced to
  re-watch the tutorial any more than they should be forced back through
  the onboarding wizard.
  **Scope decision on "every major empty state"**: wired into the two
  entry points the spec names explicitly (Settings, Import's empty
  state) — Import is the highest-value placement since it's literally
  where the "snap it" flow the tutorial explains begins. Other empty
  states (Documents, Settlements, Deductions, ...) render through a
  shared list component (`MonthGroupedList`) whose `emptyLabel` prop is
  plain text with no slot for an inline link — extending that component's
  API for this was judged out of scope for this pass and is flagged here
  as a deliberate, not silent, scope limit rather than claimed as full
  coverage.
  Tests: `src/onboarding/__tests__/tutorialSlides.test.ts` (new, 4
  tests) — exact 6-slide count/order/id-uniqueness/non-empty-keys, plus
  `tutorialSlideIndex()`'s lookup. `src/navigation/__tests__/
  rootRedirect.test.ts` gained 2 new tests (the tutorial gate fires, and
  it blocks the onboarding gate from firing even when both are
  incomplete) plus updated the "fully-cleared" sweep to include the new
  `tutorial` segment. `jest.config.js`'s `testMatch` gained
  `src/onboarding/**/*.test.ts` (a new source directory, previously
  unlisted — would have silently collected 0 tests otherwise). Full
  suite: 74 suites / 1806 tests pass; `tsc --noEmit` clean; all 7 locales
  confirmed key-parity (`tutorial.*` — Settings' "How It Works" button
  and Import's "See how" link both read `tutorial.howItWorksButton`/
  `tutorial.seeHowLink` directly rather than duplicating a second key,
  hi/uk as untranslated English copies per invariant #11; "Schedule C"
  correctly kept untranslated in the final slide's body per the
  glossary).

- FULL PARITY FOLLOW-UP, PART J — SUPPORT EMAIL (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item J).
  `app/src/brand.ts` gained `SUPPORT_EMAIL = 'bozkatruckingai@gmail.com'`
  — a dedicated product support address, deliberately never the owner's
  own personal email, the same identity-separation principle as
  CLAUDE.md's very first invariant (this is a clean multi-tenant
  product). `app/src/lib/supportEmail.ts`'s `buildSupportMailtoUrl()` is
  the one shared `mailto:` builder every touch point below uses — a
  plain `Linking.openURL('mailto:...')` call (react-native's own API,
  already proven elsewhere in this app for the share-card deep link, per
  `useShareCapture.ts`) rather than adding a new native dependency like
  `expo-mail-composer` (so this ships via a normal EAS Update, no new
  build required). The body always includes build version/EAS update id/
  commit hash (`app/src/lib/buildInfo.ts`'s existing `getBuildInfo()`,
  same module Settings' footer and the crash screen already read from)
  and platform (`Platform.OS`) — optionally a user id and/or screen name/
  error message depending on the caller — and NEVER any financial data
  (settlements, deductions, balances, tax figures); there is no code path
  in `buildSupportMailtoUrl()` that could even reach a financial value,
  since its input type only has build/platform/user/screen/error fields.
  **Settings** (`app/(tabs)/more/settings.tsx`): new "Support" section
  (right after Legal) with "Contact Support" and "Report a Problem"
  buttons — both open the same mailto builder with a different subject
  line, including the signed-in user's own id (in scope here via
  `session?.user.id`). A caught `Linking.openURL()` failure (no mail app
  configured) falls back to an `Alert` naming `SUPPORT_EMAIL` directly so
  the user isn't stuck with a silently-failed tap.
  **Crash screen** (`app/src/components/ScreenErrorBoundary.tsx`): gained
  an "Email This Error" button next to the existing "Copy Details" one,
  via a new required `emailLabel` prop (this is a class component with no
  hook access, so labels are always caller-supplied, same pattern as
  `title`/`copyLabel`/`copiedLabel`) — sends screen name + error message +
  build info + platform, no user id (this component has no
  `AuthContext`/`session` access, confirmed by reading its `Props`/class
  body — a future caller could thread one through as an additional prop
  if ever needed). AUDIT NOTE, honestly flagged rather than silently
  assumed: a repo-wide grep found `ScreenErrorBoundary` is not currently
  wrapped around ANY live screen (its own header comment already says it
  was built for the now-deleted Customize Dashboard screen and kept as "a
  reusable, generic safety net" for later use) — this pass still updates
  the component correctly since CLAUDE.md's own convention is to keep it
  ready for the next screen that needs it, but the button has no current
  way to actually be seen by a user until some screen adopts the
  boundary.
  **Terms of Use / Privacy Policy**: both the source docs
  (`docs/TERMS_OF_USE_DRAFT.md` §12, `docs/PRIVACY_POLICY_DRAFT.md` §8)
  and the LIVE in-app text (`app/src/config/termsOfUse.ts`'s `TOS_BODY`
  gained a new "11. Contact" section it didn't have before at all;
  `app/src/config/privacyPolicy.ts`'s `PRIVACY_BODY` had its existing "8.
  Contact" placeholder filled via `${SUPPORT_EMAIL}` template
  interpolation) now name `SUPPORT_EMAIL` — replacing
  `TERMS_OF_USE_DRAFT.md`'s own placeholder, which had literally
  suggested the owner's personal `graywolflogistics@myyahoo.com` as an
  example, exactly the kind of identity leak this pass is about
  eliminating. Both stay marked "final formal legal-notice address
  pending attorney review" — filling in a real support inbox is not the
  same as attorney sign-off on the surrounding legal text, which these
  drafts still require before anything here is publishable (unchanged
  from before this pass). `TOS_VERSION` was deliberately NOT bumped — a
  contact-email addition isn't a substantive change to what a user
  agreed to, so it shouldn't force an unnecessary re-acceptance prompt
  (CLAUDE.md invariant #8's re-prompt-on-version-change mechanism is for
  real Terms changes).
  **Custom SMTP steps** (spec's own explicit ask, an operator/dashboard
  task, not a code change): documented as a new section in
  `docs/ADMIN_RUNBOOK.md` ("Custom SMTP") — exact Supabase Dashboard path
  (Project Settings → Authentication → SMTP Settings), what to configure
  (sender email/name, host/port/credentials from a provider), the
  recommendation to use a real transactional-email provider (Resend/
  Postmark/SendGrid) rather than raw consumer Gmail SMTP once volume
  grows (Google throttles/flags automated sends from a free Gmail
  account), and the explicit confirmation that no app code change is
  required for any of it (Supabase Auth is what sends these emails, the
  app only ever triggers them via `supabase.auth.*` calls).
  Tests: `src/lib/__tests__/supportEmail.test.ts` (new, 5 tests) —
  targets `SUPPORT_EMAIL`, includes subject/build-info/platform, includes
  the user id only when provided, includes screen/error only when
  provided (the crash-report shape), and a dedicated proof the body never
  contains anything dollar-figure-shaped. Full suite: 73 suites / 1782
  tests pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity
  (`settings.support*`/`settings.contactSupportButton`/
  `settings.reportProblemButton`/`settings.noMailApp*`, hi/uk as
  untranslated English copies per invariant #11).

- FULL PARITY FOLLOW-UP, PART H — SMALLER FIXES (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item H). Two real items;
  every other sub-point was confirmed already shipped by prior passes
  (the settlement-line classifier, zero-cost-row skipping, Mark-as-Done's
  cost-prompt wording, bold category headers + truck identifier in the
  Accountant Package header/exports, the per-diem month+YTD block, the
  Lumper Fees table above expenses, and the year selector — all already
  covered by the FULL PARITY pass's own PART A/B/C/D entries above, no
  further change needed).
  1. **MISC CONCENTRATION WARNING (spec H.1)**:
     `app/src/stats/accountantPackage.ts`'s `checkMiscConcentration()` —
     pure, takes the already-computed `ScheduleCLineTotal[]` (never
     re-derives a total independently, so it can't disagree with what the
     screen already shows) and flags when the "Misc" bucket exceeds 20%
     of the period's grand total, returning `null` (never a false
     positive) when there's no Misc bucket or the grand total is 0.
     Informational only — never blocks Save/export. Shown on the
     Accountant Package screen (amber `Card`, same treatment as the
     existing implausible-date warning) AND in both PDF/Excel exports
     (`buildReportHtml()`, right after the implausible-date warning
     block) so a CPA opening the exported file sees the same signal the
     owner saw in-app.
  2. **AI-IMPORT IDENTITY AUDIT (spec H.7)**: re-verified end to end,
     confirmed ALREADY FIXED by an earlier pass (owner decision
     2026-07-09, PRODUCT DECISION — predates this FOLLOW-UP spec by
     nearly a month). `supabase/functions/ai-import/index.ts`'s raw
     `LEGACY_EXTRACTION_PROMPT` constant still CONTAINS the literal
     "Graywolf Logistics LLC (Ali Bozkurt, Prime Inc. owner-operator,
     Unit 830157)" / "Ali Bozkurt is OTR truck driver..." text — but only
     as the exact-match anchor for two `.replace()` patches
     (`IDENTITY_LINE_BEFORE`/`AFTER`, `OTR_RULE_BEFORE`/`AFTER`) already
     wired into `buildExtractionPrompt()`'s replace chain; the ACTUAL
     prompt text sent to Anthropic on every request already reads
     "Parse this document for an owner-operator trucking business" /
     "the user is an OTR truck driver" — fully generic, no leak. Grepped
     the entire `supabase/functions/` and `app/src/` trees for
     "Graywolf"/"Ali Bozkurt"/"830157"/"Bozkurt Fleet OS" (as a hardcoded
     VALUE, not the product brand — which CLAUDE.md's own top rule
     explicitly allows) beyond this one already-patched spot and found
     none — every other hit was either a test fixture's arbitrary sample
     value (`Prime Inc.`/`830157` as a plausible carrier/unit number in
     `chunking.test.ts`/`storagePath.test.ts`/`truckMatch.test.ts`, no
     different from using any other placeholder) or a comment documenting
     that THIS app deliberately does NOT do what legacy did
     (`ai-advisor/index.ts`'s own header comment). No code change was
     needed for this item — the web app's reported bug does not exist on
     mobile, confirmed by reading the actual code path, not assumed.
  Tests: `src/stats/__tests__/accountantPackage.test.ts` gained a
  `checkMiscConcentration` describe block (4 tests — over/at-threshold,
  no-Misc-bucket, zero-total divide-by-zero guard). Full suite: 72
  suites / 1777 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (`accountantPackage.miscConcentrationWarning`, "Misc" kept
  untranslated as a domain category name per invariant #11).

- FULL PARITY FOLLOW-UP, PART G — CATEGORY LEARNING LAYER (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item G). Every manual
  re-categorization of a deduction now teaches a normalized keyword→
  category rule, per user (`category_learning_rules`, docs/PENDING_SQL.md
  §47, ✅ APPLIED 2026-08-23). `app/src/import/categoryLearning.ts`
  is the one pure module: `normalizeKeyword()` takes the first 3
  significant, non-stopword, non-numeric-only tokens of a description
  (e.g. "AMAZON.COM ORDER #123-4567" → "amazon com order") — deliberately
  dropping the numeric order-id suffix so the SAME vendor across many
  receipts keeps matching even though the trailing digits differ every
  time. `matchLearnedCategory()` is FUZZY (spec's own word): exact/
  substring match first (the common, fast path), then a word-level
  Levenshtein-distance fallback (within 25% of the longer string) for
  typo/OCR-damaged vendor names. `applyLearnedCategories()` is applied
  to a batch of mapped deduction rows BEFORE they're saved — spec's
  "applied before the built-in guesser" — a learned rule wins over
  whatever the AI/`guessCategory()` fallback already assigned, since it
  represents the user's own explicit, repeated correction; the one
  exception is the generic-fallback docType's `categoryOverride` (the
  NEEDS-REVIEW confirm flow, CLAUDE.md invariant #14) — an even more
  explicit, just-given signal that a learned rule never overrides.
  **Where a rule gets taught**: `app/src/data/categoryLearningRules.ts`'s
  `useLearnCategoryCorrection()` — called (best-effort, `.mutate()` not
  awaited, never blocks the actual save) from both places a user can
  hand-edit a deduction's category: `deductions.tsx`'s edit-save handler
  and `accountant-package.tsx`'s category-picker save handler — ONLY when
  the new category genuinely differs from what was already there (not a
  re-save of the same value). Upserts on `(user_id, keyword)`: correcting
  the same vendor again overwrites the category (most recent correction
  wins) and bumps `hit_count`, never creates a duplicate row.
  **Where a rule gets applied at import time**: `app/src/data/aiImportSave.ts`'s
  `saveExtraction()` fetches the user's rules ONCE (`fetchLearningRules()`,
  wrapped in try/catch defaulting to `[]` — this feature must never be
  able to BREAK an import, including before §47 has been run and the
  table doesn't exist yet) and applies them to all three
  deduction-producing paths: the settlement's own `mapping.deductions`
  batch, each purchase line item (`mapPurchase()`'s output), and the
  generic-fallback single row.
  **Prompt-context only, never training** (spec's own explicit
  requirement, stated plainly in the viewer UI too): the same rules are
  also forwarded to `ai-import` as a "USER CORRECTIONS" text block
  appended to the extraction prompt (`app/src/data/aiImportCall.ts`'s
  `callAiImport()` gained a `learningRules` param threaded the identical
  way `customCategories` already was;
  `supabase/functions/ai-import/index.ts`'s `buildExtractionPrompt()`
  appends `USER CORRECTIONS (...): "keyword" -> category; ...` right
  after the existing custom-categories block) — capped at 30 rules
  client-side (`buildUserCorrectionsPromptText()`, unused server-side
  since the server just joins whatever array it receives, but kept as
  the one shared cap definition) to keep the prompt bounded for a
  long-time user. This is PLAIN TEXT PROMPT CONTEXT for that one request
  only — no fine-tuning, no persistent model change, exactly like every
  other `APPROVED ADDITION` block in that prompt.
  **Viewer** (`app/(tabs)/more/category-learning.tsx`, wired into
  `navRegistry.ts`'s `tools` group — one shared registry edit, same NAV
  PARITY pattern as every other route): lists every rule (keyword →
  category, correction count), per-row delete, and a "Clear All" action.
  A permanent note states plainly: "This only adjusts the hints sent
  along with your own future imports — the AI model itself is never
  trained or fine-tuned on your data."
  **Wired into the standing 4-point new-table checklist** (Reset All
  Data's `TABLES_IN_DELETION_ORDER`, Delete Account's same list,
  `queryInvalidation.ts`'s `AFFECTED_TABLES`, `exportAllData.ts`'s
  `EXPORT_TABLES` — the exact "a new table wired into Reset but not
  invalidation" bug class CLAUDE.md's own PRE-LAUNCH HARDENING pass
  found and fixed for `equipment`) — `category_learning_rules` was added
  to all four in this same change, right alongside `user_categories`,
  which every one of those four lists already had.
  Tests: `src/import/__tests__/categoryLearning.test.ts` (new, 15 tests)
  — `normalizeKeyword()`'s tokenization/stopword/numeric-stripping/cap
  behavior, `matchLearnedCategory()`'s exact/substring/fuzzy-typo/
  no-match cases, `applyLearnedCategories()`'s override/pass-through
  behavior, and `buildUserCorrectionsPromptText()`'s formatting/30-rule
  cap. Full suite: 72 suites / 1773 tests pass; `tsc --noEmit` clean; all
  7 locales confirmed key-parity (`nav.categoryLearning`/
  `categoryLearning.*` keys, hi/uk as untranslated English copies).

- FULL PARITY FOLLOW-UP, PART F — CAPITAL ACCOUNT "DATA-LOSS BUG" AUDIT
  (owner decision 2026-08-05, web v2026.08.05-W chase, spec item F,
  flagged by the owner as the highest-priority item in this pass). Full
  re-audit of every mechanism that can remove a `capital_transactions`
  row, specifically checking for the web app's reported failure class: an
  "orphan cleanup" sweep that scans existing rows and deletes ones that
  merely LOOK orphaned (wrong on this app's data model, since a manual
  cash contribution has no deduction to be orphaned FROM in the first
  place — it would be silently swept up as a false positive).
  **Confirmed this codebase has no such sweep, and cannot grow one by
  accident**: there is exactly ONE way a row disappears without an
  explicit user tap — the DB's own `linked_deduction_id ... on delete
  cascade` FK (`docs/SCHEMA.sql`) — which by construction can only ever
  fire for a LINKED row whose OWN deduction was deleted; a manual row's
  `linked_deduction_id` is always `NULL`, so no FK on earth points at it.
  The one app-level removal path, `deductionMutations.ts`'s
  `applyContributionSync()`'s `'remove'` action, deletes by an EXACT id
  already resolved via `fetchLinkedContributionId(userId, deductionId)`
  (an exact `linked_deduction_id` match) — never a scan-and-guess. There
  is no orphan-EXISTENCE-check-then-delete pattern anywhere for
  `capital_transactions` (unlike `deductionMutations.ts`'s own
  `cleanupOrphanedDocument()`, which IS that pattern, but for `documents`/
  Storage, a completely different table with no such invariant to
  protect). `app/src/data/legacyImport/importLegacyBackup.ts`'s own
  header comment already documented this exact conclusion from a prior
  pass ("Remove orphaned contributions... structurally impossible here").
  Every OTHER spec item F sub-point was independently verified as ALREADY
  implemented by the immediately-preceding "FULL PARITY WITH WEB
  v2026.08.05-K, PART E" pass (above): no double-counting cash+linked
  (`summarizeContributions()` sums the two buckets separately, never
  both), no hidden base constant (`calcCapitalAccount()`'s
  `effectiveContribution = initialCapital + totalContributions`, no
  seeded figure), the "remove duplicate entries" action and the "cash
  transfers $X (n) · paid personally $Y (m)" breakdown line both already
  ship on the Capital Account screen, `taxFreeRemaining` is already
  live/unclamped/red-when-negative, and equity already moves
  `business_balance` via the tracked, reversible
  `business_balance_applied` delta (`useRecordManualCapitalTransaction`/
  `useDeleteManualCapitalTransaction`, `app/src/data/capitalTransactions.ts`)
  — confirmed this flows to Home/Cash Flow (both read
  `useCapitalAccountSummary()`, which reads `profiles.business_balance`,
  invalidated via the same `invalidateFinancialData()`/`'profile'` key
  every mutation here already calls) and that the tax estimate is
  provably unaffected (`calcTaxEstimate()`'s own input signature has no
  capital-account field at all — verified again by reading
  `app/src/data/taxEstimate.ts` fresh, not just trusting the prior pass's
  claim). No "explicit idempotent restore" action was added, because
  there is no wrongful-deletion path for it to restore FROM — the
  existing "➕ Record Contribution" button already IS the explicit,
  non-magical way to add equity back if a user made a manual entry
  mistake, and adding a second "restore" mechanism on top would be the
  kind of magic-auto-reseed the spec's own point (1) explicitly warns
  against ("never auto-seed equity").
  The ONE real, if narrow, gap this audit found: `applyContributionSync()`'s
  `'remove'` action had a single-row test proving it deletes the intended
  row, but nothing proving it LEAVES OTHER ROWS ALONE — the exact
  property this whole audit is about. Fixed by extending
  `src/data/__tests__/deductionMutations.test.ts` with a 3-row scenario
  (two different deductions' own linked contributions + one manual cash
  contribution) proving that removing ONE deduction's sync plan deletes
  only that one linked row, leaving the other deduction's linked
  contribution AND the manual contribution both untouched.
  Full suite: 71 suites / 1758 tests pass; `tsc --noEmit` clean.

- FULL PARITY FOLLOW-UP, PART E — DEPRECIATION ELECTION (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item E). Purchased trucks/
  trailers only. `app/src/tax/depreciation.ts`'s `calcCurrentYearDepreciation()`
  computes ONE tax year's depreciation expense from an owner's election:
  method `'full'` (Section 179/bonus — 100% expensed in the placed-in-
  service year, $0 every year after), `'macrs'` (IRS Pub. 946 half-year-
  convention percentages — tractor 3-year property `33.33/44.45/14.81/
  7.41`, trailer 5-year property `20/32/19.2/11.52/11.52/5.76`, applied
  by recovery year, $0 once the table is exhausted), `'spread'` (straight
  line over the owner's own chosen number of years, defaulting to 5 when
  unset), or `'ask'` (defers to the CPA — $0 in the estimate, flagged
  with `requiresCpaNote` rather than guessing a method on the owner's
  behalf). A truck whose `cost_basis_ownership_mode` (PART C) is
  `'lease'` skips entirely (`skippedAsLease: true`) — the owner doesn't
  own a leased truck, so it's never depreciable, regardless of any other
  field. An unconfigured asset (no method, no purchase price, or no year
  placed in service) contributes exactly $0 with `isConfigured: false`
  — never a guess. THE MACRS PERCENTAGE TABLES ARE HARDCODED, not sourced
  from `tax_year_data` — a deliberate, documented exception to CLAUDE.md
  invariant #6: they're fixed by IRC §168/Pub. 946 structure and do NOT
  change per tax year (unlike brackets/SE-tax rate/per diem, which DO and
  which invariant #6 requires sourcing server-side) — same "fixed by IRS
  form/code structure, not an annually-published figure" precedent
  already established by `app/src/import/category.ts`'s `SCHEDULE_C_LINE`
  mapping. Deliberately kept SEPARATE from PART C's `truckCostBasis.ts`
  "economic monthly spread" (a paid-off truck's CPM/per-mile cost TODAY)
  — the two numbers answer different questions and must never be
  confused or summed together.
  `docs/PENDING_SQL.md` §46 (✅ APPLIED 2026-08-23) adds
  `trucks.depreciation_method`/`depreciation_year_placed_in_service`/
  `depreciation_spread_years` (tractor) and the `trailer_`-prefixed
  equivalents (independent of the tractor's own election, same "trailer
  financing is independent of its tractor's" pattern as CLAUDE.md
  invariant #25). `sumFleetDepreciation()` sums current-year depreciation
  across every truck AND its own trailer (via `useTrucksList()`, which —
  unlike `useActiveTruck()` — includes retired trucks too, since a
  retired-but-still-owned truck can still generate a real depreciation
  deduction).
  TAX ESTIMATE WIRING: `app/src/data/taxEstimate.ts`'s `useTaxEstimate()`
  now subtracts `depreciationTotal` from net profit BEFORE calling
  `calcTaxEstimate()` (that function itself, a verbatim legacy port, is
  UNCHANGED) and exposes `depreciationTotal`/`depreciationRequiresCpaNote`/
  `netProfitBeforeDepreciation` in its bundle so the Tax Estimator screen
  can show depreciation as its own visible line (spec item E's explicit
  ask) rather than silently folding it into net profit: "Net Profit
  (before depreciation)" → "Depreciation: -$X" → the existing "Net
  Profit" row (now the post-depreciation figure, unchanged formula/
  position) — only rendered when `depreciationTotal > 0`, so an account
  with no purchased/configured trucks sees zero change to this screen. An
  orange CPA-decision note appears below the breakdown whenever any asset
  is set to `'ask'`.
  TRUCKS SCREEN: a new "Depreciation Election (tax)" section (tractor)
  and, only when a trailer purchase price is entered, a second "Trailer
  Depreciation Election (tax)" section — 4-pill method picker, year-
  placed-in-service field (hidden for 'ask'), spread-years field (only
  for 'spread'), and a "not set" prompt (amber) whenever no method is
  chosen yet, exactly matching PART C's Cost Basis section's own "not
  set" convention. When the tractor's cost-basis ownership mode is
  'lease', the whole depreciation picker is replaced by a plain
  "Leased — depreciation doesn't apply" note instead of showing controls
  that would have no effect.
  GLOSSARY: `MACRS` and `Section 179` added to `docs/I18N_GLOSSARY.md`'s
  DO-NOT-TRANSLATE list and `glossary.test.ts`'s `GLOSSARY_TERMS` — both
  are IRS-specific terms with no natural translation, same rationale as
  every other glossary entry. Catching this ALSO caught a pre-existing,
  unrelated miss: the Accountant Package's `capitalAssetsNote` string
  (from an earlier pass) already used "Section 179" in `en.json` but
  Spanish had translated it to "la Sección 179" — fixed as part of this
  pass's glossary addition, confirming the glossary test's own value
  (a term added for a NEW feature caught an OLD, previously-unenforced
  drift).
  Tests: `src/tax/__tests__/depreciation.test.ts` (new, 14 tests) — every
  method's math (full/macrs both tables/spread with and without an
  explicit year count/ask), the lease skip, the not-yet-placed-in-service
  $0 case, the unconfigured-$0 case, and `sumFleetDepreciation()`'s
  tractor+trailer independence (including a leased tractor with a
  purchased trailer depreciating only the trailer) and CPA-note
  aggregation. Full suite: 71 suites / 1757 tests pass; `tsc --noEmit`
  clean; all 7 locales confirmed key-parity, including the newly-enforced
  MACRS/Section 179 glossary terms.

- FULL PARITY FOLLOW-UP, PART D — EXPENSE TOTAL EXPLAINER (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item D). Tapping Home's
  "Expenses" tile (the Revenue/Expenses/Net Profit trio, DASHBOARD
  SIMPLIFICATION above) used to just navigate to Deductions — it now
  opens a breakdown in place, via `app/src/stats/expenseTotalExplainer.ts`'s
  `buildExpenseTotalExplainer()`: total/fixed/variable (reusing CPM's own
  `bucketFor()`/`typeFor()`, now exported from `src/stats/cpm.ts`, so the
  Explainer and the CPM "Why?" breakdown, PART C, can never disagree about
  what counts as fixed vs. variable) plus the 12 largest rows for the
  SAME week window the tile's own number already covers
  (`buildWeeklyRevenueExpenseTrend()`'s `weekStartFromEnding()` boundary,
  now exported from `src/stats/cashFlowTrend.ts`) — so the breakdown's
  total always matches the tile exactly, never a second, slightly-
  different figure. Any row over 15% of the (included) total is flagged
  "possible depreciable asset — check with your CPA"
  (`isPossibleDepreciableAsset`, informational only, never reclassifies
  or excludes the row on that basis). A vehicle-purchase-shaped
  description (`app/src/import/category.ts`'s `isVehiclePurchaseOneOff()`,
  introduced in PART C) is auto-excluded from the total/buckets/largest-
  rows list entirely — the same "capital purchase, not an operating
  expense, still counted in P&L/tax" principle as CPM's own exclusion —
  with the excluded amount shown as its own informational line rather
  than silently vanishing. Each of the 12 rows has a 🗑️ delete action
  right in the breakdown (spec item D's "12 largest DELETABLE rows"),
  reusing the exact same confirm-then-delete pattern Deductions' own
  screen uses (`deductions.deleteConfirmTitle`/`deleteConfirmBody`,
  `cleanupOrphanedDocument()` for a linked document, the DB's `on delete
  cascade` for a linked capital contribution per CLAUDE.md invariant #5)
  so deleting from Home behaves identically to deleting from Deductions,
  not a second, thinner delete path.
  Tests: `src/stats/__tests__/expenseTotalExplainer.test.ts` (new, 5
  tests) — the fixed/variable split, the top-12 cap and descending sort,
  the >15% depreciable-asset flag (plus a 0-total divide-by-zero guard),
  and the vehicle-purchase auto-exclusion (from the total, the buckets,
  AND the largest-rows list).
  Full suite: 70 suites / 1725 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`dashboard.expenseExplainer.*`, hi/uk as
  untranslated English copies per invariant #11).

- FULL PARITY FOLLOW-UP, PART C — CPM DONE THE WAY OWNER-OPERATORS DO IT
  (owner decision 2026-08-05, web v2026.08.05-W chase, spec item C).
  TRUCK COST BASIS (docs/PENDING_SQL.md §45, ✅ APPLIED 2026-08-23 —
  `trucks.cost_basis_ownership_mode` (`'paid'|'loan'|'lease'`),
  `cost_basis_loan_monthly_payment`, `cost_basis_paid_spread_months`,
  `cost_basis_warranty_cost`, `cost_basis_warranty_term_months`;
  `purchase_price` from docs/PENDING_SQL.md §36 is reused as-is for the
  'paid' mode's spread) replaces CPM's previous "sum every Loan Center
  row on the account and multiply by settlement count" approach — a
  synthetic estimate with no relationship to the ACTIVE truck's own
  financing that produced $8.48/mi on web (spec item C.2, "NEVER a
  synthetic loan estimate"). `app/src/stats/truckCostBasis.ts`'s
  `calcTruckCostBasisWeekly(truck, carrierAlreadyWithholdsLoanPayment)`
  is the one rule set: `lease` adds $0 (the settlement withholding
  already counts it — adding a second figure would double it); `loan`
  uses the FIXED `cost_basis_loan_monthly_payment` the owner enters once
  (never re-derived from a Loan Center schedule, which may not exist for
  this truck or may reflect a refinance this module can't reason about),
  skipped when the carrier already withholds it; `paid` spreads
  `purchase_price / cost_basis_paid_spread_months`. An extended warranty
  (`cost_basis_warranty_cost / cost_basis_warranty_term_months`) is a
  separate fixed cost added on top of whichever mode applies. Editable on
  the Trucks screen's existing add/edit form, right under Purchase &
  Financing — an unconfigured truck (`cost_basis_ownership_mode` null)
  contributes exactly $0, never a guess, with a "not set" prompt in the
  CPM "Why?" breakdown (below) rather than silently assuming zero fixed
  cost is correct.
  FIXED vs VARIABLE (spec item C.3): `app/src/stats/cpm.ts`'s
  `CanonicalCpmResult` gained `fixedTotal`/`variableTotal`/
  `fixedCostPerMile`/`variableCostPerMile`, and every `CpmBucket` now
  carries its own `type: 'fixed'|'variable'`
  (`CPM_BUCKET_TYPE` — Insurance/Permits/ELD & Software/Dues/Professional
  Services/Loan-Lease Payment are fixed; Fuel/Maintenance/Tolls/Parking &
  Lodging/Dispatch & Factoring/Driver Pay are variable; an unmapped
  category defaults to variable, the safer assumption for "how much does
  one more mile cost"). Scorecard shows this as one line: "Variable
  $X/mi adds cash today. Total $Y/mi covers everything"
  (`scorecard.fixedVariableSummary`).
  EXCLUDED ONE-OFFS (spec item C.2's "exclude multi-year one-offs and
  vehicle purchases from per-mile while keeping them as expenses/
  assets"): `calcCanonicalCpm()` now excludes (a) any deduction category
  `'Major Repairs & Overhauls'` (the existing >$2,500 major-component
  threshold from the category-taxonomy pass) and (b) any deduction whose
  description matches `app/src/import/category.ts`'s new
  `isVehiclePurchaseOneOff()` (down payment/truck-trailer-tractor-vehicle
  purchase phrasing — covers a purchase logged as a plain deduction
  instead of via `trucks.purchase_price`) from the per-mile figure
  ENTIRELY — a five-figure one-time cost divided across one week's miles
  would spike CPM to something meaningless. These rows are NEVER excluded
  from P&L/tax/true-profit — this function doesn't touch those totals —
  only from CPM's own per-mile math. Returned as `excludedOneOffs:
  {description, amount, reason}[]`, kept deliberately separate from the
  pre-existing `excludedTotal` (Meals/Advance Repayment/Escrow — non-
  expenses, not one-offs) so the Why? breakdown can label each correctly.
  WARNINGS (spec item C.4's "warn when CPM > $4 or miles missing"):
  Scorecard shows a red banner when `costPerMile > 4`
  (`scorecard.cpmTooHighWarning`) and an orange one when
  `statsQuery.data.totalMiles <= 0` (`scorecard.milesMissingWarning`).
  "WHY?" BREAKDOWN (spec item C.4's "keep the card clean, full breakdown
  behind a 'Why?' action"): the KPI card's Cost/Mile row now shows a
  small "Why?" link instead of an always-visible bucket list (the
  previous pass's inline `cpmBreakdownTitle` Card was removed). Opens a
  `ModalSheet` with: total/loaded/empty miles + deadhead % (from
  `calcMiles()`, PART B); RPM/PPM; every cost bucket with its per-mile
  share and fixed/variable tag; fixed vs. variable subtotals; "how your
  fixed truck cost was spread" (the truck cost basis's own ownership
  mode + weekly truck payment + weekly warranty, or a "not set" prompt
  linking to the Trucks screen); the excluded-one-offs list with an
  explanatory note; the pre-existing excluded (meals/advances/escrow)
  total; and — spec item C.4's own explicit ask — every settlement with
  revenue but no miles, each with an inline miles `Field` + Save button
  wired to the same `useUpdateSettlement()`/`invalidateFinancialData()`
  pattern as Settlements' own inline editing (PART B), reachable right
  from the breakdown that's actually affected by the gap instead of only
  from the Settlements screen.
  Tests: `src/stats/__tests__/truckCostBasis.test.ts` (new, 8 tests) —
  unconfigured/lease/loan/paid modes, the loan-skip-when-withheld guard,
  a zero-months divide-by-zero guard, warranty as an additive fixed cost,
  and the weeklyFixedTotal sum. `src/stats/__tests__/cpm.test.ts` gained
  5 tests — the fixed/variable split, a truck-cost-basis payment
  classified fixed, a Major Repairs & Overhauls one-off excluded from
  cost/mile while listed separately, and a vehicle-purchase-shaped
  deduction (e.g. "Truck down payment") excluded the same way.
  Full suite: 69 suites / 1720 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (new `scorecard.why*`/`scorecard.cpmType.*`/
  `scorecard.ownershipMode.*` and `trucks.costBasis*`/
  `trucks.ownershipMode.*` keys, hi/uk as untranslated English copies).

- FULL PARITY FOLLOW-UP, PART B — CANONICAL MILES (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item B). Web computed miles
  as a raw `sum(settlements.miles)` independently in several places, with
  no dedup — a duplicate settlement week (two rows sharing the same
  truck+week_ending, structurally rare on mobile thanks to CLAUDE.md
  invariant #10's unique constraint, but real for any row saved before
  that constraint existed or a legacy-backup import) silently DOUBLED
  the miles total, which cascades into CPM/RPM being wrong by the same
  factor. `app/src/stats/miles.ts`'s `calcMiles(settlements, loads)` is
  now the ONE shared calculation: (1) dedupes by `${truck_id}|
  ${week_ending}` (NOT `week_ending` alone — a real multi-truck fleet
  routinely has every truck settle the same week, which must NOT be
  treated as a duplicate) keeping whichever duplicate has the higher
  reconciled total and counting the rest as `duplicateWeeksIgnored`; (2)
  per week, `totalMiles = MAX(the settlement's own printed total, that
  week's loads' loaded+empty sum)` — never SUMMED, which would double-
  count whichever source is more complete; loaded/empty stay exactly
  what the loads table says even when the settlement's own total wins
  (never inflated to force a match); (3) exposes `loadedMiles`/
  `emptyMiles`/`deadheadPct` (null, never NaN, when totalMiles is 0)
  aggregated across all weeks. `app/src/data/dashboardStats.ts`'s
  `computeFleetStats()`/`fetchFleetStats()`/`fetchDriverStats()` all now
  route through `calcMiles()` (fetching `loads` alongside settlements) —
  `FleetStats` gained `loadedMiles`/`emptyMiles`/`deadheadPct`/
  `duplicateWeeksIgnored`. `calcCpm()` itself is UNCHANGED (still divides
  by whatever total it's given — CLAUDE.md's existing CPM invariant that
  it divides by TOTAL miles, not loaded, is preserved); only the total
  fed into it is now the deduped/reconciled figure.
  MANUAL TOTAL OVERRIDE (spec item B.3, docs/PENDING_SQL.md §44 —
  `trucks.manual_total_miles_override numeric(12,2)`, ✅ APPLIED
  2026-08-23): an odometer/ELD-sourced total the user enters
  supersedes `calcMiles()`'s own calculated total for CPM/RPM purposes
  only — loaded/empty/deadhead% stay from the weekly calc regardless
  (an odometer reading has no loaded-vs-empty split of its own).
  `resolveMilesTotal(calculated, manualOverride)` (`miles.ts`) is the
  pure switch: a positive override wins, otherwise falls back to the
  calculated total, returning which `source` is active so the UI can
  label it. Wired into Scorecard (`app/(tabs)/more/scorecard.tsx`): a
  banner names the active source ("Using manual total: N mi (odometer/
  ELD)" vs. "Using settlements total: N mi") with a one-tap action to
  either open the override editor (`ModalSheet` + `Field`, saves via
  `useUpdateTruck()` then `refreshTrucks()` + `invalidateFinancialData()`
  so every screen reading `activeTruck` or truck-derived stats picks up
  the change) or revert to settlements (`handleUseSettlementsInstead()`,
  clears the column back to null). `canonicalCpm` recomputes from
  `resolveMilesTotal()`'s resolved total, not the raw calculated one.
  KNOWN LIMITATION, flagged not hidden: the override lives on the
  per-truck `trucks` row, but `useFleetStats()` is a fleet-wide (not
  per-truck) query — applying a single active truck's override to a
  fleet-wide total is only fully correct for the common single-truck
  case (CLAUDE.md invariant #7's "n=1 is just the default presentation"
  reasoning); a true multi-truck-aware override would need its own
  per-truck stats plumbing, deferred as a v1.x follow-up rather than
  silently claimed as fully correct for every fleet size.
  SETTLEMENTS SCREEN (spec item B.3's "inline miles input on each
  settlement row... plus a per-week editor"): the settlements list row
  now shows an amber "⚠️ Miles missing — tap to add" in place of the
  mileage figure whenever `x.miles` is falsy, and the settlement detail
  sheet's existing Miles field gained the same amber treatment plus
  inline editable input (`settlementsScreen.milesEditLabel`/
  `milesEditLabelMissing`/`milesSaveFailedTitle`, all 7 locales) —
  editing here writes directly to that settlement's own `miles` column
  (the per-week figure `calcMiles()` itself reads), not the truck-level
  manual override.
  DUPLICATE SURFACING (spec item B.4): Scorecard shows an orange "N
  duplicate settlement week(s) ignored — you may want to delete them"
  banner whenever `duplicateWeeksIgnored > 0`, directly under the KPI
  card.
  REVENUE/LOADED MILE (spec item B.2's "show revenue per total mile AND
  per loaded mile" — per-TOTAL-mile already existed as `revenuePerMile`,
  reading from the canonical CPM's own total): added as its own row,
  computed directly in the Scorecard screen component
  (`grossRevenue / loadedMiles`, only rendered when `loadedMiles > 0`) —
  deliberately NOT added inside `calcScorecard()` itself, which stays an
  untouched verbatim legacy `rScore()` port per this file's own standing
  rule.
  Tests: `src/stats/__tests__/miles.test.ts` (new, 11 tests) — MAX()
  reconciliation both directions, loaded/empty tracked independently,
  deadhead% including the null-on-zero case, multi-truck-same-week NOT
  deduped, same-truck-same-week duplicate correctly deduped (keeps the
  higher total), null `week_ending` skipped, multi-week summing, and
  every `resolveMilesTotal()` branch (null/undefined/manual/zero-or-
  negative-treated-as-unset). `src/data/__tests__/dashboardStats.test.ts`
  gained 3 tests: the loads pre-fetch shortcut (never re-queries `loads`
  when already passed), the fallback-fetch path, and an end-to-end
  duplicate-week dedup case seeding two same-truck-same-week settlement
  rows and asserting the returned `totalMiles`/`duplicateWeeksIgnored`/
  `cpm.costPerMile` all reflect the deduped figure, not a doubled one.
  Full suite: 68 suites / 1678 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (7 new `scorecard.*`/`settlementsScreen.*`
  keys, hi/uk as untranslated English copies per invariant #11).

- FULL PARITY FOLLOW-UP, PART A — ONE REFRESH PATH (owner decision
  2026-08-05, web v2026.08.05-W chase). Web's `rAll()` was called in 19
  places but never DEFINED — every refresh silently threw, so editing
  the truck cost basis never moved CPM. Audited whether the mobile
  equivalent (`app/src/data/queryInvalidation.ts`'s
  `invalidateFinancialData()`) has the SAME class of gap: it does exist
  and IS wired into nearly every mutation-bearing screen already, but a
  grep audit of every `.mutateAsync(` call site under `app/(tabs)` found
  4 screens calling only a bare per-table entityHooks mutation (whose own
  `onSuccess` invalidates just `[table]` with the default `refetchType:
  'active'`, which skips any inactive/unmounted screen's own cached
  query) with NO broader invalidation at all: `trucks.tsx`,
  `equipment.tsx` (both feed the CPM "Why?" breakdown and the
  depreciation election, PARTS C/E below — this is the exact "truck cost
  basis doesn't move CPM" bug named in the prompt), `drivers.tsx`
  (feeds `sumDeductibleDriverPayroll()`, CLAUDE.md invariant #7, which
  Tax Estimator reads), and `compliance.tsx` (had a narrow one-off
  `compliance_items`-only invalidation in ONE handler, not the other
  three). All 4 now call `invalidateFinancialData(queryClient)` after
  every insert/update/delete/toggle, matching the convention every other
  screen already followed. `ceo-mode.tsx` was the only OTHER screen with
  zero `invalidateFinancialData` calls — audited and confirmed correct
  as-is: its one mutation (`useUpdateProfile()`) already invalidates its
  own `'profile'` key internally, no broader dependency exists.
  Tests: `queryInvalidation.test.ts` gained a dedicated "ONE REFRESH
  PATH" test pinning the exact query-key contract the prompt's four
  named mutation categories require — truck cost basis
  (`trucks`/`equipment`/`loans`), equity (`capital_transactions`/
  `capital-account-summary`/`profile`), miles (`settlements`), and
  categories (`deductions`/`user_categories`) must all appear in
  `invalidateFinancialData()`'s own invalidated-key list. A filesystem-
  scanning test (grepping every screen source file for the call) was
  considered and deliberately NOT added — inconsistent with this
  codebase's established "pure-function tests only" convention and
  fragile against refactors; the query-key contract test is the durable
  regression guard, the grep audit itself was a one-time manual sweep.
  Full suite: 67 suites / 1628 tests pass; `tsc --noEmit` clean.

- FULL PARITY WITH WEB v2026.08.05-K, PART F — CASCADE DELETE, ASSET
  REGISTER, DEDUCTIONS FILTER (owner decision 2026-08-05).
  1. **CASCADE DELETE, the real gap**: `deductionMutations.ts`'s
     `cleanupOrphanedDocument()` (already used by `deductions.tsx`'s
     delete handler) used to only delete the `documents` DB ROW — the
     actual uploaded file stayed in Storage forever, an invisible orphan.
     Now reads the row's `storage_path` first and removes the Storage
     object too (same `documents` bucket every upload writes to) BEFORE
     deleting the row; a Storage-removal failure is logged but never
     blocks the DB-row delete, since a broken "View Document" link (row
     survives, storage_path 404s) is worse than a harmless orphaned
     Storage object (row is gone, nothing points at it, sweepable later).
     Second real gap: `maintenance.tsx`'s own delete handler never called
     `cleanupOrphanedDocument()` at all — a maintenance record's linked
     document/photo was NEVER cleaned up on delete, only a deduction's.
     Fixed by wiring the same call there (fuel_purchases/tolls have no
     `document_id` column at all, confirmed by re-checking their schemas,
     so no equivalent gap exists for them). Truck Health's "last done"
     mark needed NO code change — `calcTruckHealth()` already recomputes
     baselines live from whatever `maintenance_records` rows currently
     exist (no separate cached value to go stale), confirmed by re-
     reading `src/truck/health.ts`'s `buildBaselines()`. Delete
     confirmations on both screens now list what else gets removed
     (`deductions.deleteConfirmBody`/`maintenance.deleteConfirmBody`) —
     previously a bare title with no body text at all.
  2. **Asset Register — audited, confirmed ALREADY unified**: the list
     (`filteredAssets`), the stat cards (`buildAssetCategoryBreakdown`),
     and the category filter pills all already derive from the SAME
     `buildAssetRegister(deductions, todayIso)` call and the SAME
     `ASSET_CATEGORIES` constant (`src/stats/assetRegister.ts`) — no
     divergent "EQUIP-coded rows vs. category list" bug exists in this
     codebase (that class of bug was specific to the web app this pass
     is chasing parity with). The one real, fixed gap: selecting a
     category filter with zero matching rows showed a generic "no
     assets" message even when OTHER categories had real assets — now
     shows `assetRegister.emptyFilterNote` plus a "Show All" link
     (`assetRegister.showAllLink`) that resets the filter, instead of a
     dead-end blank screen.
  3. **Deductions screen — segmented origin filter** (spec item F.3):
     the screen already showed BOTH Out-of-Pocket and Withheld sections
     stacked, each with its own subtotal — a new All/Out-of-pocket/
     Settlement pill row (`deductions.originFilterAll/OutOfPocket/
     Withheld`) now lets a user show ONLY one section at a time, using
     the exact same `groupDeductions()`/`isSettlementDed()` origin split
     the stacked-sections view already computed — no new filtering
     logic, just a toggle over which of the two existing sections render.
  Tests: `deductionMutations.test.ts` (new) — exercises the REAL
  `cleanupOrphanedDocument()` against an in-memory fake Supabase client:
  a document with no remaining references gets both its row AND Storage
  object removed; a document still referenced by a deduction/settlement/
  maintenance_records row is untouched (row AND storage); a document
  with no `storage_path` skips the Storage call entirely. Required
  extending `fakeSupabase.ts`'s `.select()` to actually support
  `{count:'exact', head:true}` (previously a no-op — `count` was always
  `undefined`, which meant the 3 "still referenced" test cases silently
  passed for the wrong reason: `cleanupOrphanedDocument` was deleting
  referenced documents anyway, not correctly detecting them as
  referenced — caught by the new tests failing, not a pre-existing
  bug in the real function) and `.storage.from().remove()` (previously
  entirely absent), both now shared by every other test file that
  imports `fakeSupabase.ts`. Full suite: 67 suites / 1627 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (`Settlement`
  correctly kept untranslated per the glossary's DO-NOT-TRANSLATE list
  in every locale's new `originFilterWithheld` string).

- FULL PARITY WITH WEB v2026.08.05-K, PART B — ACCOUNTANT PACKAGE REWORK
  (owner decision 2026-08-05). The owner's accountant needs OUT-OF-POCKET
  expenses only (the carrier's own accountant already has the withheld
  side) — this is now the screen's DEFAULT scope, not an afterthought.
  1. **ORIGIN RULE, the missing piece** (docs/PENDING_SQL.md §43):
     `deductions.source` already distinguished settlement/import/manual,
     but `maintenance_records` and `tolls` had NO equivalent column at
     all — a settlement's own maintenance/toll line items were
     structurally indistinguishable from a standalone out-of-pocket
     import. New `source` columns (same 3-value enum) on both tables,
     backfilled for existing rows (a transponder toll defaults to
     withheld; a maintenance row linked to a standalone `docType:
     'maintenance'` document defaults to out-of-pocket, everything else
     to withheld — matching the spec's own stated default). `fuel_
     purchases` needed no new column — its existing nullable
     `settlement_id` already IS the origin signal (also reused by PART
     C's canonical expense engine's own double-count guard).
     `mapExtraction.ts`'s settlement/standalone maintenance mappers and
     the settlement toll mapper now stamp `source` explicitly; every
     manual-entry screen (`maintenance.tsx`, `tolls.tsx`,
     `truck-health.tsx`'s Mark as Done) stamps `source: 'manual'`.
  2. **`src/stats/accountantPackage.ts` gained a whole new, additive
     pipeline** on top of the original `buildAccountantPackage()` (kept,
     untouched, no other caller): `matchesAccountantScope()` (the 3-way
     out-of-pocket/withheld/combined filter, driven by the ORIGIN RULE
     above) → `buildLineItems()` (deductions + fuel + maintenance + tolls
     flattened into ONE typed, period+scope-filtered, zero-amount-row-
     skipped list — CLAUDE.md's C.1 "zero-cost rows never reach the
     report" requirement lives here) → `buildScheduleCTotals()` (category
     subtotals with each category's Schedule C line attached, PART A's
     `scheduleCLineFor()`) → `buildLumperFees()` (a dedicated table,
     filtered straight from the same line items) →
     `buildPerDiemBlock()` (MONTH figure and YEAR-TO-DATE figure computed
     side by side, both via the existing `calcPerDiemDays()` — never
     re-derived, only re-scoped which settlements are summed) →
     `buildCapitalAssets()` (reads `trucks`/`equipment`'s EXISTING
     purchase_price/purchase_date/financing columns, §36 — never counted
     in expense totals, labeled "depreciable, your CPA's decision") →
     `buildOwnersEquity()` (reuses Part E's `summarizeContributions()` —
     cash + linked contributions counted ONCE EACH and summed, never a
     hidden constant; `unmatchedOwnerPaidCount` is a WARNING, never a
     silent mis-total, whenever this period's owner-paid line items
     outnumber the linked contributions that should have auto-synced for
     them).
  3. **Screen rework** (`accountant-package.tsx`, fully rewritten): Year
     pill row (populated from every year that actually has a settlement,
     plus the current year) / Month pill row (+ "All Year") / Scope pill
     row (Out-of-pocket only — default — / Settlement-withheld only /
     Everything combined, with an explanatory note under the out-of-
     pocket choice). SECTION ORDER matches the spec exactly: header
     (company name — Unit N · year/make/model, cleanly omitted when
     unset) → summary tiles (gross income + a conditional "+ $X
     reimbursements" sub-line, reading the EXISTING `reimbursements`
     table by period; deductible expenses; a compact per-diem figure) →
     dedicated Per Diem section (month + YTD, side by side) → an
     implausible-date warning card (`findImplausibleDates()`, PART D.2 —
     this is the first screen it's actually wired into) → Lumper Fees
     table (above the category table, not buried at the bottom) →
     category expense table with BOLD, larger category headers (each
     showing its Schedule C line) and grand total → Capital Assets →
     Owner's Equity (with its own unmatched-owner-paid warning) → 4
     exports. EVERY ROW is tappable-to-edit (`CategoryPicker`, the SAME
     shared component `deductions.tsx` already uses) and deletable (✕,
     confirmed). Changing a fuel/maintenance/toll row's category
     (spec item B.4) converts it into a manual deduction row so the new
     category actually sticks — insert the new deduction FIRST, delete
     the original typed row only after the insert succeeds. A row's
     category-grouping in the UI resolves through the SAME
     `resolveScheduleCBucket()` `buildScheduleCTotals()` itself uses
     (not a raw `category` string match) — a custom category whose
     Schedule C bucket differs from its own name (e.g. "Detention
     Software" → "ELD & Communications") would otherwise silently vanish
     from its bucket's row list while still counting toward the bucket's
     total, a real display bug caught and fixed before commit. OWNER-PAID
     rows (`isPersonalPayment(payment_method)`) render with a subtle
     amber row background + a "💰 OWNER PAID" badge inline (screen, PDF,
     and the Excel export's own inline row highlight).
  4. **4 exports**: PDF month / PDF year (existing `expo-print`
     `printToFileAsync()` pattern, extended with the new sections) and
     Excel month / Excel year — the SAME HTML template rendered to a
     `.xls`-extensioned file with MIME `application/vnd.ms-excel`
     (Excel opens an HTML table given this extension/MIME, a standard,
     dependency-free trick — no new native module needed). Both share
     ONE `buildReportHtml(year, month)` function so the screen, the PDF,
     and the Excel export can never disagree about what a given
     period/scope actually contains.
  Tests: `accountantPackage.test.ts` gained full coverage for every new
  function — `matchesAccountantScope`'s 3-way matrix,
  `buildLineItems`'s zero-row-skip/ORIGIN-RULE/period-filter/owner-paid-
  detection cases, `buildScheduleCTotals`'s Schedule-C-line attachment,
  `buildLumperFees`, `buildPerDiemBlock`'s month-vs-YTD scoping,
  `buildCapitalAssets` (truck + trailer + equipment as separate rows,
  never a row with no purchase price), and `buildOwnersEquity` (cash +
  linked summed once each, a draw never counts, the unmatched-warning
  triggers/clears correctly). Full suite: 66 suites / 1614 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (glossary test
  re-passed clean — every new string was written scope-checked against
  the DO-NOT-TRANSLATE list up front this time, no post-hoc fix needed).

- FULL PARITY WITH WEB v2026.08.05-K, PART D — DATES + SPREAD-ORDER AUDIT
  (owner decision 2026-08-05).
  1. **One-time date repair migration** (docs/PENDING_SQL.md §42) — a
     PL/pgSQL `repair_implausible_date(d, year_floor, year_ceiling)`
     function applies the SAME year↔day-swap rule
     `app/src/import/dateGuard.ts`'s `trySwapYearAndDay()` already applies
     at IMPORT time to every ALREADY-STORED dated column: `settlements.
     week_ending`, `loads.pickup_date`/`delivery_date`/`load_date`,
     `deductions.ded_date`, `reimbursements.reimb_date`, `fuel_purchases.
     purchase_date`, `maintenance_records.service_date`, `tolls.
     toll_date`. Implausible = before 2020 or beyond next year, computed
     dynamically off `current_date` at the time the SQL runs (never a
     hardcoded year, so the migration stays correct whenever it's
     actually applied) — only repairs a row when the swapped reading is
     BOTH a real calendar date AND itself lands inside the plausible
     window; a genuinely unrecoverable date is left untouched rather than
     "fixed" into a wrong one, and stays flaggable (item 2 below).
  2. **`isImplausibleDate()`/`findImplausibleDates()`**
     (`app/src/import/dateGuard.ts`) — the pure, client-side counterpart
     for "flag any remaining impossible date in the report with a red
     banner": same before-2020-or-beyond-next-year window as §42's SQL
     migration, so the two can never disagree about what counts as
     implausible. Not yet wired into a screen — the Accountant Package
     rework (FULL PARITY part B, not yet built at time of this entry) is
     where the actual red banner lives; these two functions are ready for
     that screen to import directly.
  3. **SPREAD-ORDER AUDIT, confirmed NOT a bug in this codebase** — the
     spec's described failure mode (`{ id, _batch, source:'settlement',
     ...aiRow }`, where spreading the untrusted AI payload LAST lets it
     clobber id/source/batch tags set BEFORE it) was checked against
     every object-spread in `app/src/data/aiImportSave.ts` (there are 12)
     and every array-spread in `app/src/import/mapExtraction.ts` (there
     are 4, all array CONCATENATION, not object spreads). Every one of
     aiImportSave.ts's object spreads already follows the SAFE order —
     `{ ...mapping.settlement, document_id: documentId, ... }`, spreading
     an ALREADY-MAPPED insert object (built by mapExtraction.ts's own
     literal-field mappers, never a raw spread of untyped AI JSON) FIRST,
     then overriding the real id fields LAST, exactly the pattern the
     spec recommends. Deeper reason this bug class can't reach this
     codebase at all: `mapExtraction.ts`'s mapper functions (mapSettlement/
     mapFuel/mapMaintenance/mapPurchase/...) build BRAND-NEW literal
     objects reading only specific NAMED fields off the AI's JSON
     (`s.weekEnding`, `x.desc`, `x.amount`, ...) — none of them ever does
     `{ ...aiRow }`, so an unexpected/malicious field in the raw AI
     response has no path into a saved row's `source`/`settlement_id`/
     `document_id`/`id` regardless of spread order. Verified with a new
     end-to-end regression test (`aiImportSave.settlementChildren.test.ts`)
     that runs the REAL `saveExtraction()` against a settlement deduction
     line item carrying its own (adversarial) `source`/`settlement_id`/
     `document_id`/`id`-shaped fields at runtime (bypassing TypeScript via
     an explicit cast, since the `Extraction` type has no such fields to
     begin with) and proves the saved row's tags are always the
     app-controlled ones, never the payload's.
  Tests: `dateGuard.test.ts` gained `isImplausibleDate`/
  `findImplausibleDates` coverage (plausible/before-2020/beyond-next-year/
  boundary/null cases). Full suite: 66 suites / 1576 tests pass; `tsc
  --noEmit` clean.

- FULL PARITY WITH WEB v2026.08.05-K, PART C — ARITHMETIC CORRECTNESS
  (owner decision 2026-08-05). Audit finding, root cause of every item
  below: `fuel_purchases`/`maintenance_records`/`tolls` are their OWN
  tables, never mirrored into `deductions` — `calcTrueProfit()`/
  `calcCpm()`/`buildProfitAnalysis()`'s `netIncome` ALL silently missed a
  standalone (non-settlement) fuel receipt, maintenance invoice, or toll
  charge entirely, since every one of them only ever summed `deductions`.
  (`buildAccountantPackage()` already folded fuel/maintenance in — this
  pass extends that same fix to every OTHER "what's my profit/cost"
  figure, the spec's "ONE canonical expense engine.")
  1. **`sumCanonicalExpenses()`** (`src/stats/trueProfit.ts`, exported) is
     now the shared total both `calcTrueProfit()`/
     `buildWeeklyTrueProfitTrend()` and `buildProfitAnalysis()`
     (`src/stats/profitAnalysis.ts`) read from: deductions (via the
     EXISTING `reducesTrueProfit()`, unchanged — still excludes Meals/
     Advance Repayment/Escrow & Deposits) + fuel_purchases + maintenance
     + tolls. DOUBLE-COUNT GUARD: a SETTLEMENT-LINKED fuel_purchases row
     (`settlement_id` set — mapSettlement() extracts both the itemized
     fuel section AND the settlement's own fuel_advance chargeback from
     the same document) is excluded from the total, since its cost is
     already represented by the settlement's own withheld deduction —
     only STANDALONE fuel (`settlement_id` null) is added. First attempt
     at this guard tried excluding the WITHHELD DEDUCTION's category
     instead (assuming fuel_purchases was always the more authoritative
     source) — caught by `trueProfit.test.ts`'s own pre-existing negative-
     settlement regression test, which proved that under-counts a real
     genuinely-deductible withheld Fuel & DEF row that has NO
     corresponding fuel_purchases entry at all; the settlement_id-based
     filter (excluding the fuel_purchases SIDE, never the deduction side)
     is the correct, safer direction. `maintenance_records`/`tolls` have
     no settlement_id column to filter by at all — added unconditionally,
     matching `buildAccountantPackage()`'s own established precedent (no
     `chargebackType` maps to "Maintenance & Repairs" at all, so no
     double-count risk exists there; a `tolls_transponder` chargeback
     colliding with an itemized toll row is a rare, accepted edge case,
     not a regression this pass introduces). Wired into all 5 true-profit
     consumers (Home, Scorecard, CEO Mode, Share Weekly Profit, Profit
     Analysis) — each now fetches fuel/maintenance/tolls (CEO Mode/Profit
     Analysis gained a fleet-wide, non-truck-scoped maintenance query
     distinct from Truck Health's own truck-scoped one, so this figure
     can never disagree with Home's for a multi-truck fleet).
  2. **CPM = canonical cost per TOTAL mile with a per-bucket breakdown**
     (`src/stats/cpm.ts` `calcCanonicalCpm()`) — replaces the Scorecard
     screen's only real CPM display (grep-confirmed the ONE UI call site
     app-wide), which read `FleetStats.cpm` (the legacy `calcCpm()`'s raw
     "ALL deductions unconditionally" total — counting a per-diem-covered
     meal, an advance repayment, or a refundable escrow deposit as if
     they were real operating costs). Buckets: Fuel & DEF, Maintenance &
     Repairs (folding Truck Parts/Tires/Major Repairs/Truck Wash),
     Insurance, Permits & Road Taxes, Tolls, Parking & Lodging, ELD &
     Software, Dispatch & Factoring, Dues, Professional Services, Driver
     Pay, Loan/Lease Payment, Other — shown as a new "Cost/Mile
     Breakdown" card under the existing Cost/Mile KPI row, plus an
     "Excluded (meals, advances, escrow)" informational line. Loan/lease
     payment is estimated from Loan Center (`loans` table,
     `normalizeToWeeklyPayment()` converts each loan's free-text
     `frequency` to its weekly-equivalent, summed and scaled by
     `settlementCount`) ONLY when no settlement-withheld
     'Truck/Trailer Payments' deduction already exists — otherwise the
     withheld row alone represents that cost, and adding the estimate on
     top would double it. `calcCpm()` (the old legacy-verbatim function)
     is left in place, untouched, for any future caller that specifically
     wants the literal `rDash()` figure.
  3. **Best/Worst Lanes — three real bugs in `rankLoadsByRpm()`**
     (`src/stats/cashFlowTrend.ts`, shared by Cash Flow's full 5-and-5
     list and Home's 3-and-3 teaser): (a) DE-DUPLICATES by
     `order_number|origin|destination` before ranking — a re-imported
     settlement or a load logged twice no longer pads a ranking with the
     same lane counted more than once (keeps the first-seen row, same
     convention as Capital Account's `findDuplicateTransactionIds()`);
     (b) EXCLUDES implausible rates outside $0.80–$12/loaded-mile (almost
     always a mis-read amount/mileage — a decimal-point OCR error, a
     swapped total-vs-per-mile field) into a new `excluded` array, shown
     as an amber "N load(s) excluded — rate looks mis-read... fix on the
     Loads page" notice on the Cash Flow screen rather than silently
     corrupting best/worst/avgRpm; (c) `avgRpm` is now TOTAL REVENUE ÷
     TOTAL LOADED MILES (a mileage-weighted average) instead of the
     unweighted mean of each load's own rate — a handful of tiny,
     high-rate loads no longer skews the average far above what the
     fleet is actually earning per mile.
  4. **Mark as Done's cost prompt reworded** (Truck Health,
     `truckHealth.markDoneCostLabel`) from "Cost (optional)" to "What did
     it cost you out of pocket? (0 if nothing)" per the spec's exact
     framing — the field itself (defaulting to `'0'`, already flowing
     into a real `maintenance_records.cost` the same as any invoiced
     record) was already correct; only the label undersold that a $0
     self-service repair is a deliberate, common answer, not a skipped
     field. Zero-amount maintenance/fuel/toll/deduction rows were
     confirmed to ALREADY not pollute any total (`buildAccountantPackage`/
     `calcCanonicalCpm`'s own `add()` helpers both already guard `if
     (!amount) return`) — the remaining "skip $0 rows in the report's
     LINE-ITEM LISTING" half of this spec item is Part B's Accountant
     Package rework (not yet built at time of this entry), since the
     current `buildAccountantPackage()` only returns bucketed totals, no
     individual line items yet.
  Tests: `trueProfit.test.ts` gained a dedicated "canonical expense
  engine" describe block (standalone fuel/maintenance/tolls subtract;
  settlement-linked fuel does NOT double-count; a standalone fuel
  purchase with no matching deduction is a real, previously-missed
  expense; backward-compat default-empty-arrays) plus a
  `buildWeeklyTrueProfitTrend` window-scoping case.
  `profitAnalysis.test.ts`'s existing "sums only rows within the trailing
  window" test's own `netIncome` expectation was corrected from 2800 to
  1850 — the OLD value was itself proof of the bug (fuelExpense/
  maintenanceExpense were computed and asserted as their own tiles in
  that SAME test but never actually subtracted into netIncome); a new
  settlement-linked-fuel case added alongside it. `cpm.test.ts` gained a
  `calcCanonicalCpm`/`normalizeToWeeklyPayment` describe block (exclusion,
  bucketing, settlement-linked-fuel guard, loan-payment-only-if-not-
  withheld, divide-by-zero). `cashFlowTrend.test.ts`'s `rankLoadsByRpm`
  suite gained dedup/exclusion/weighted-average cases; its own pre-
  existing "ranks best/worst" test had a fixture bug fixed alongside
  (all 3 loads shared the same default `origin: 'A', destination: 'B',
  order_number: null`, which the new dedup logic would have collapsed to
  1 row — each now gets a distinct `order_number`). Full suite: 66 suites
  / 1568 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (the glossary test caught a real slip mid-pass: the Spanish/
  Russian/Arabic translations of the new `cpmExcludedTotal` string
  translated "escrow" instead of keeping it in the DO-NOT-TRANSLATE
  glossary's Latin script — fixed before commit).

- FULL PARITY WITH WEB v2026.08.05-K, PART E — CAPITAL ACCOUNT (owner
  decision 2026-08-05, "worst bug of the day" class fixes — see PART A
  above and PARTS B-D/F/G elsewhere in this pass). Audited this app's
  existing capital-account code against every item in the spec first:
  items E.1 (no "Record Money In" action / no inline-editable manual
  rows) and E.5 (Tax-Free Remaining clamped at $0, hiding a real negative
  balance) were genuine gaps/bugs here; items E.2 (orphan-cleanup
  deleting manual equity) and E.4's "no hidden base constant tripling the
  total" were confirmed ALREADY NOT PRESENT in this codebase by design —
  `capital_transactions.linked_deduction_id` is `on delete cascade`
  (docs/SCHEMA.sql) so a linked contribution can never outlive its
  deduction without any cleanup job needed at all (the legacy-backup
  importer's own comment, `importLegacyBackup.ts`, already calls this out
  explicitly: "structurally impossible here"), and contribution totals
  have always summed real `capital_transactions` rows only, never a
  hidden seeded constant.
  1. **Tax-Free Remaining no longer clamped at $0**
     (`app/src/stats/capitalAccount.ts` `calcCapitalAccount()`) — legacy's
     OWN `rCapital()` clamped the DISPLAYED number
     (`Math.max(0,capRemain)`) while the screen's color logic already
     compared the UNCLAMPED value for red/green, a real inconsistency: the
     figure silently floored at $0 even when the color already knew it
     was negative. `taxFreeRemaining` is now the live, unclamped value;
     `capital-account.tsx` shows a red "⚠️ You've drawn past your
     capital — further draws come out of profit" banner
     (`capitalAccount.pastCapitalWarning`) whenever it goes negative.
  2. **Record Contribution + inline delete for manual rows**
     (spec item E.1) — a new "➕ Record Contribution" button/sheet mirrors
     the existing draw flow. `HistoryRow` now distinguishes a MANUAL
     contribution (deletable, ✕) from a LINKED one (`linked_deduction_id`
     set — stays read-only, 🔗, tap-through to the deduction, "edit the
     deduction instead" — unchanged). A manual contribution's delete
     confirmation (`capitalAccount.deleteContributionConfirmTitle`) is
     separate copy from the existing draw-delete confirmation.
  3. **Equity moves cash, not tax — genuinely wired this pass** (spec item
     E.3): recording/deleting a MANUAL draw or contribution on this
     screen previously touched ONLY `capital_transactions` —
     `profiles.business_balance` was left completely untouched by that
     action (only ever moved by settlement import or the separate
     "Update Business Balance" manual-correction button), even though the
     Dashboard/Cash-Flow-starting-balance/Accountant-Package all read
     `business_balance` as if it already reflected every cash movement.
     Fixed with the SAME atomic-delta pattern as
     `settlements.business_balance_credit` (§37/§38) — reusing the
     EXISTING `apply_business_balance_delta(p_user_id, p_delta)` RPC, no
     new SQL function needed. `capital_transactions.
     business_balance_applied` (docs/PENDING_SQL.md §41) tracks exactly
     how much of THAT transaction has been applied so far (signed:
     positive for a contribution, negative for a draw) so a delete
     reverses the EXACT applied amount — read from the row, never
     re-derived from its current `amount`/`tx_type` — with no drift.
     `app/src/data/capitalTransactions.ts`'s new
     `useRecordManualCapitalTransaction()`/
     `useDeleteManualCapitalTransaction()` wrap the plain insert/delete
     with this RPC call, invalidating `capital_transactions`,
     `capital-account-summary`, AND `profile` (the Dashboard/Cash-Flow
     balance figures) together. SCOPE DECISION, deliberately narrow: this
     applies to MANUAL (non-linked) draws/contributions ONLY — a LINKED
     contribution (auto-synced from a personally-paid deduction via
     `deductionMutations.ts`'s `planContributionSync()`) represents
     equity the owner built by paying a business expense out of pocket;
     no cash actually moved into business checking for that event, so it
     must NOT also credit `business_balance` (doing so would fabricate a
     deposit that never happened) — `manualTransactionBalanceDelta()`'s
     own header comment documents this reasoning; the linked path keeps
     using the plain `useInsertCapitalTransaction`/
     `useDeleteCapitalTransaction` hooks, untouched. Verified (and
     directly tested) that this change reaches NOTHING in the tax
     engine — `calcCapitalAccount()`'s signature has no `tax_config`/
     `deductions` input at all, so a $5,000 draw or a $60,000
     contribution structurally cannot alter a tax estimate through this
     code path, matching the spec's own required test.
  4. **"Remove duplicate entries" action** (spec item E.4) —
     `findDuplicateTransactionIds()` groups by `(tx_type, tx_date,
     amount)`, keeps the first-seen row per group, and — critically —
     skips every row with `linked_deduction_id` set entirely (a linked
     row is never eligible to be flagged OR removed as a "duplicate," no
     matter how many share its date+amount, since it's driven by its own
     deduction, not user data-entry error). The screen only shows the
     "🧹 Remove Duplicate Entries" button when at least one real duplicate
     exists.
  5. **Contribution breakdown line** (spec item E.4's "cash transfers $X
     (n) · paid personally $Y (m)") — `summarizeContributions()` splits
     manual (cash) vs. linked (paid-personally) contributions; the screen
     shows a "no cash-transfer contributions yet" note
     (`capitalAccount.noCashTransferNote`) whenever every contribution on
     the account is linked and none is a real cash deposit.
  6. **"Draws and contributions move cash, not taxable income" note**
     (spec item E.3's required UI copy) — shown as a permanent
     `MutedText` line under the Business Balance card
     (`capitalAccount.cashMovesNotTaxNote`).
  Tests: `src/stats/__tests__/capitalAccount.test.ts` gained coverage for
  the unclamped negative `taxFreeRemaining`, `manualTransactionBalanceDelta`
  (contribution = positive, draw = negative), `findDuplicateTransactionIds`
  (same date+amount flagged, a lone manual contribution survives, a
  LINKED row is never touched even when it collides on date+amount, a
  contribution never cross-matches a draw), and `summarizeContributions`
  (cash vs. linked split, the "no cash transfer" signal). i18n: 8 new
  `capitalAccount.*` keys across all 7 locales (es/ru/ar/tr fully
  translated; hi/uk as untranslated English copies per invariant #11),
  key-parity confirmed. Full suite: 66 suites / 1544 tests pass; `tsc
  --noEmit` clean.

- IMPORT FAILURE VISIBILITY + AUDIT (owner decision 2026-08-02, device
  feedback: "settlement imports failing frequently"):
  1. **Rich, step-tagged errors**: `saveExtraction()` (`aiImportSave.ts`)
     no longer throws bare/anonymous errors — every write goes through a
     new `SaveExtractionError` (`src/data/saveExtractionError.ts`)
     tagging exactly which of ~27 granular steps failed (upload / documents
     row / settlement row / which child table's insert / the balance RPC /
     ...) plus the underlying Postgres error's message/code/hint/details,
     AND a snapshot of what was already durably saved before the failing
     step (`partial: {documentId, settlementId, settlementSaved,
     childRowsSaved, oldRowsCleanedUp, balanceUpdated}` — there is still no
     single transaction wrapping the whole save, a known v1.1 "full RPC
     transaction for imports" backlog item, so a later step's failure does
     NOT mean nothing was saved). The import screen's error card groups
     the 27 steps into 10 user-legible buckets for the visible headline
     (`src/import/errorStepGroups.ts` — "Saving loads" vs "Saving fuel"
     vs "Saving withheld deductions" all read as "saving your settlement's
     records" to a non-developer; the exact granular step stays in the
     Copy Details report for real debugging) and shows a "Copy Details"
     button (reusing `ScreenErrorBoundary`'s build-info + Clipboard
     pattern) with the full report. AI-extraction failures
     (`aiImportCall.ts`'s `AiImportError`) and local file-read/compression
     failures get the same Copy Details treatment via
     `buildAiImportErrorReport()`/`buildLocalErrorReport()`.
  2. **Four previously-silent failures now throw**: `aiImportSave.ts`'s
     loans upsert loop, the personal-payment `capital_transactions`
     insert, the `loan_agreement` docType's truck/trailer/equipment
     asset-link update (and its own trucks/equipment lookup), and the
     maintenance-warranty reimbursement insert ALL used to discard their
     `{error}` entirely — a failure in any of them was completely
     invisible, the import screen reported success while that one row
     silently never saved. All four now throw a step-tagged
     `SaveExtractionError` like every other write in the file.
     `fakeSupabase.ts` gained error-injection support
     (`createFakeSupabase(seed, {failures: [...]})`) specifically to let
     `aiImportSave.errorReporting.test.ts` prove all four actually throw
     now, plus the step-tagging/partial-state/duplicate-race behavior,
     against the real `saveExtraction()`.
  3. **`apply_business_balance_delta` RPC audit** (docs/PENDING_SQL.md
     §38, NOT YET RUN as of this writing): the signature was already
     correct (`p_user_id uuid, p_delta numeric`, matching the client's
     call exactly) and a failure already correctly aborts the whole save
     (throws) — but a genuine bug was found: `update ... returning
     business_balance into new_balance` left `new_balance` as `NULL`
     (PL/pgSQL does not raise on a 0-row UPDATE by default) whenever the
     `WHERE` clause matched zero rows (a mismatched `p_user_id`/
     `auth.uid()`, or a missing profiles row) — the RPC returned `NULL`
     with `error: null`, so the client believed the balance update
     succeeded when it silently never touched anything. Fixed with a
     single `if not found then raise exception ... using errcode =
     'P0002'` right after the UPDATE — now a real, visible error the
     client reports as step `'balance-update'`.
  4. **§34/§37 unique-index race, addressed**: `findExistingSettlement()`'s
     check-then-insert-or-update is not atomic — a double-tap on Save
     (or two devices importing the same account's same settlement week
     within the same instant) could race past the check and hit
     `settlements_user_week_truck_uidx`/`_notruck_uidx` on INSERT.
     `SaveExtractionError.isDuplicateSettlementRace` (true when
     `step === 'settlements-save'` and the Postgres error code is
     `23505`, unique_violation) lets the import screen show a specific,
     actionable "this week may have just been imported — check
     Settlements before retrying" message instead of a raw constraint-
     violation string. The import screen also gained a synchronous
     `savingRef` double-tap guard (checked/set before any `await`, reset
     in `finally`) closing the narrow window where two fast taps could
     both start `saveExtraction()` before React re-renders the Save
     button away.
  5. **File-size guard audited, left at 10 MB**: correctly checked
     client-side (post-compression for photos, pre-upload for PDFs) and
     server-side (base64-length-derived estimate) before any network
     call — belt and suspenders, no bug found. Flagged as an open risk,
     not changed: a legitimate multi-page camera-scanned settlement PDF
     could plausibly exceed 10 MB; worth monitoring real-world import
     failures for this specific cause before raising it blind.
  6. **`ai-import`'s own failure modes, audited and hardened**
     (`supabase/functions/ai-import/index.ts`): `ANTHROPIC_MAX_TOKENS`
     raised 8000 → 16000 — a busy multi-page settlement's full structured
     JSON extraction (many loads/tolls/withheld deductions) can genuinely
     need more than 8000 output tokens, and a truncated response used to
     fail every JSON.parse() fallback attempt and surface as a generic,
     misleading `parse_failed`. The response's own `stop_reason ===
     "max_tokens"` is now checked FIRST and returns a new, specific
     `"truncated"` error type ("try splitting a multi-page settlement
     into smaller batches") instead. The Anthropic fetch itself gained a
     client-controlled `ANTHROPIC_TIMEOUT_MS` (55s, via `AbortController`)
     instead of relying on the platform's own undocumented execution
     ceiling, plus ONE retry (`MAX_ANTHROPIC_ATTEMPTS = 2`,
     `RETRY_BACKOFF_MS` 800ms) for genuinely transient failures (a
     network-level throw, or a 5xx/529-overloaded response) — never for a
     4xx, which a retry can't fix. A new `"timeout"` error type
     distinguishes "this took too long" from a plain network error. Both
     new types get their own `friendlyAiImportError()` messages
     (`aiImportCall.ts`).

- NEGATIVE SETTLEMENTS + MILES TRAPS + ESCROW (owner decision 2026-08-02,
  verified against a real statement: W/E 2026-07-24, 0 miles, $5.16
  revenue, $1,160.51 deductions, net -$1,155.35 — the owner OWES the
  carrier that week). Three fixes:
  1. **Negative net pay never credits business_balance**: `newCredit =
     mapping.netPay > 0 ? mapping.netPay : 0` in `aiImportSave.ts` clamped
     a losing week's net pay to $0 before computing the balance delta —
     a losing week silently left `business_balance` untouched instead of
     DECREASING it by what's actually owed. Fixed: `newCredit =
     mapping.netPay` (the signed figure, uncapped either direction) — the
     delta math itself (`newCredit - previousCredit`, docs/PENDING_SQL.md
     §37's `apply_business_balance_delta` RPC) was already correct and
     needed no change. `business_balance` has no DB check constraint
     enforcing `>= 0` (docs/SCHEMA.sql), so allowing it to go negative
     required no schema change. `SaveExtractionResult.netPayAdded` can
     now be negative; the import result screen, the Settlements list row,
     the Settlements detail sheet, and both Dashboard business-balance
     cards all show a red "you owe the carrier" / "you owe this much
     overall" label whenever the figure is negative (`oweCarrier`/
     `businessBalanceOwed` i18n keys, all 7 locales) rather than reading
     as an unusually small positive number. `calcTrueProfit()`/
     `calcCashFlowForecast()`/every other true-profit-derived figure
     already never clamped negative math (verified, not changed).
  2. **MILES TRAP**: carrier statements routinely print a cumulative
     "LTD MILES"/"MILES QTD"/"YTD MILES" figure right next to the week's
     own revenue/loads section — the AI extraction had a real, verified
     case of grabbing that lifetime figure as `settlement.totalMiles`
     for a week with ZERO loads. Fixed two ways: (a) the `ai-import`
     extraction prompt gained an explicit instruction that `totalMiles`
     must be THIS WEEK's own figure only, never LTD/QTD/YTD, and should
     match the sum of the week's own loads' mileage; (b) a new client-side
     deterministic guard, `app/src/import/milesGuard.ts`'s
     `sanitizeExtractionMiles()` — applied once in `aiImportCall.ts`
     immediately after the extraction is received (same placement as
     `dateGuard.ts`'s `sanitizeExtractionDates()`, so every downstream
     consumer — `mapSettlement()` AND the import preview's
     `applyDefaultPerDiemDays()` — sees the corrected value automatically,
     with no separate fix needed at either call site): (1) no loads this
     week but a nonzero `totalMiles` → silently corrected to 0 (unambiguous
     — zero loads means zero miles driven for pay); (2) loads exist with
     real mileage but `totalMiles` is more than 1.5× their own summed
     mileage → the loads' own sum is used instead, AND the extraction's
     `confidence` is downgraded to `"low"` so the existing needs-review
     machinery (`src/import/needsReview.ts`, CLAUDE.md invariant #14)
     surfaces it for confirmation — rule 1 is a certainty (no flag needed),
     rule 2 is a judgment call (flagged). This drives per-diem (0 miles =
     0 days), CPM, and RPM correctly since all three read the corrected,
     already-saved `settlements.miles`/loads figures, not the raw AI
     output.
  3. **ESCROW vs EXPENSE**: a performance bond / escrow reserve / tire
     fund / emergency fund / maintenance reserve settlement deduction is
     a REFUNDABLE DEPOSIT the carrier holds on the driver's behalf, not a
     business expense — a real statement had a "PERFORMNCE BOND" line
     (OCR-damaged spelling) that needed this treatment. New category
     `'Escrow & Deposits'` added to `CANONICAL_CATEGORIES` and
     `NON_DEDUCTIBLE_CATEGORIES` (`app/src/import/category.ts`), and to
     `src/stats/trueProfit.ts`'s `TRUE_PROFIT_EXCLUDED_CATEGORIES` (same
     treatment as Meals/Advance Repayment — excluded from true profit,
     Cash Flow's trailing-expense averages, and every other
     true-profit-derived figure, since the money never left the business
     as a real cost). Classified via TWO signals with the AI's own
     structured `chargebackType: "escrow_reserve"` (ai-import prompt,
     `docs/INDUSTRY_TAXONOMY.md` §A) as primary, and a client-side text
     regex, `isEscrowDeposit()` (`app/src/import/category.ts`), as a
     safety net that catches OCR-damaged spellings (verified against
     "PERFORMNCE BOND") even when the AI didn't set chargebackType —
     same priority/pattern as the existing `isRestaurantPurchase()`
     meals detector. Deliberately does NOT match a bare "security
     deposit" (an existing, different ai-import non-deductible-trap
     concept — a deposit the DRIVER paid, not one the carrier holds).
     Smart default, freely user-editable per row (same as every other
     category). A running "what does the carrier currently hold" balance
     — `src/stats/escrowBalance.ts`'s `calcEscrowBalance()`, a simple
     cumulative sum (no refund/release tracking exists yet in this app,
     so this is a HELD total, not net-of-refunds; a future refund docType
     would need its own product decision to net against this) — is shown
     on the Settlements screen whenever it's greater than $0.
  Tests: `src/import/__tests__/milesGuard.test.ts` (new),
  `src/import/__tests__/category.test.ts` (escrow detection + category
  additions), `src/stats/__tests__/trueProfit.test.ts` (escrow exclusion
  + uncapped-negative math), and
  `src/data/__tests__/aiImportSave.negativeSettlement.test.ts` (new) —
  an end-to-end test using the EXACT real-statement numbers from the
  device report (gross $5.16, deductions $1,160.51 = $66.95 meals +
  $550.00 advance repayment + $100.00 escrow + $443.56 genuinely
  deductible, net -$1,155.35, 0 per-diem days, business_balance
  decreasing by the full $1,155.35, true profit correctly computing
  -$438.40 from the $443.56 deductible portion only) through the REAL
  `saveExtraction()` against the fake Supabase client.

- PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
  review, "CRITICAL" set — see PROMPTS.md's backlog entry for the same
  date for the deferred "second tier"/"backlog" items this pass also
  triaged):
  1. **Storage deletion integrity** (`delete-account`/`reset-data` Edge
     Functions): `deleteStorageFolder()` used to ignore every list()/
     remove() error, hardcode a 3-level-deep recursion, and never
     paginate past list()'s 1000-item page — the caller still returned
     `success:true` regardless. Rewritten: `walkAndDelete()` recurses to
     whatever depth the folder tree actually has (no hardcoded limit),
     `listAllEntries()` paginates in 1000-item pages until exhausted, and
     every failure is collected into `{failedPaths, errors}` — the
     handler now returns a 502 with "Some files could not be removed —
     please try again" instead of `success:true` on ANY partial failure.
     Both functions' STORAGE step is naturally idempotent/safe to re-run
     (list() on an already-emptied folder returns `[]`, remove() on an
     already-gone path is a no-op), so a failed attempt is always
     retryable — delete-account still deletes the auth user LAST, so a
     storage failure leaves the account intact for a retry; reset-data
     still resets `profiles`' data fields LAST, same reasoning.
  2. **Business balance on settlement re-import**
     (`app/src/data/aiImportSave.ts`): a re-import used to credit
     `business_balance` NOTHING at all (gated on `!isReimport`), so a
     corrected net pay (e.g. 2000 -> 2500) left the balance permanently
     wrong. Fixed via `settlements.business_balance_credit`
     (docs/PENDING_SQL.md §37, NOT YET RUN against the live project as of
     this writing) — tracks how much of THIS settlement's net pay has
     actually been credited so far; every save (new or re-import)
     computes `delta = newCredit - previousCredit` (0 for a brand-new
     settlement) and applies just that delta. The update itself is now a
     single atomic Postgres statement via the new
     `apply_business_balance_delta(p_user_id, p_delta)` RPC (`security
     invoker`, scoped to `user_id = auth.uid()`) instead of a client-side
     select-then-update (a real race between two concurrent imports
     before this). `SaveExtractionResult.netPayAdded` can now be
     NEGATIVE (a corrected net pay lower than before) — the import
     screen's `balanceAdded` i18n string had its hardcoded "+" removed
     from all 7 locales; the sign is now computed in JS
     (`(delta > 0 ? '+' : '') + money(delta)`), since `money()` already
     renders its own "-" for a negative amount.
  3. **Validate before writing** (`saveExtraction()`): the settlement
     week_ending check and the driver_payment driver-required check both
     used to run AFTER the Storage upload and the `documents` insert — a
     rejected import left an orphaned uploaded file and an orphaned
     `documents` row. Both checks now run as step 0, before any
     Storage/DB write; `mapSettlement()` is computed once there and
     reused (never called twice).
  4. **Re-import ordering** (`saveExtraction()`): the old order deleted
     the previous week's child rows (loads/fuel/reimbursements/withheld
     deductions/driver_payments) BEFORE inserting the new batch — if any
     new insert failed partway through, the previous week's data was
     already gone with nothing to replace it. Now: the previous batch's
     row ids are captured (read-only) BEFORE any write, every new row is
     inserted first, and only once every insert has succeeded are the
     captured old ids deleted (`delete().in('id', oldIds)` — by explicit
     id, never a fresh `eq('settlement_id', ...)` match, since the newly-
     inserted rows share that same settlement_id and must never be swept
     up in the same delete).
  5. **PDF/file size guard**: files over 10 MB are rejected client-side
     (`app/(tabs)/import/index.tsx`, checked via `expo-file-system`'s
     `File.size` / `DocumentPickerAsset.size` before ever base64-encoding)
     with a friendly "This file is too large — try splitting it or
     exporting a smaller version" message (all 7 locales), and again
     server-side in `ai-import` (`approxDecodedBytes = base64Length *
     3/4`, since decoding the full string just to check its size would
     defeat the point) — belt and suspenders, never trusting the client
     check alone.
  6. **exportAllData**: `equipment` (docs/PENDING_SQL.md §36) was added
     to both Edge Functions' `TABLES_IN_DELETION_ORDER` but never to
     `src/data/exportAllData.ts`'s `EXPORT_TABLES`, so a full-data export
     silently omitted every equipment row — the same class of gap
     invariant #24/the DATA-FLOW CONSISTENCY audit already found and
     fixed for query invalidation. `src/data/__tests__/
     exportAllData.test.ts` mirrors `TABLES_IN_DELETION_ORDER` as a
     regression guard, same pattern as `queryInvalidation.test.ts`.
     Settings' "Export All My Data" button also gained real scope text
     (`exportAllDataNote`, all 7 locales) — it never said the original
     uploaded photos/PDFs aren't included in the JSON export.
  7. **Schema consolidation**: `supabase/migrations/
     0002_consolidated_pending_sql.sql` replays every APPLIED
     docs/PENDING_SQL.md section (1, 3-36 — §2 needed no SQL, §37 is not
     yet run) as one file, assembled programmatically from that file's
     own fenced SQL blocks. Investigating this surfaced a real, separate
     finding: `0001_init.sql` is NOT a clean "before any PENDING_SQL
     section" baseline — it already contains some later tables (`drivers`
     from §13, `user_categories` from §21, `compliance_items` from §23)
     while still missing others (`tax_config`, `tax_year_data`,
     `household_members`/`household_income`, `equipment`) and `profiles`
     is missing at least 7 columns later sections added. Because of that
     drift, every statement in 0002 is written idempotent (`create table
     if not exists` / `add column if not exists` / drop-then-recreate for
     policies and triggers / named indexes with `if not exists` /
     constraint adds wrapped in a `do $$ ... exception when
     duplicate_object` block) rather than assuming a specific starting
     point — safe to run against either a fresh project (after
     `0001_init.sql`) or the current live project (every statement is a
     no-op for whatever already exists). Two real bugs were caught and
     fixed while assembling it: §17's two SQL blocks are fenced in
     EXPLANATION order in the prose, not execution order (the doc's own
     text says "Run the column-add FIRST" despite that block being fenced
     second) — 0002 runs it first; §34's prose has a second fenced block
     that's a DIAGNOSTIC query for the person doing the manual apply, not
     part of the migration — excluded. This was assembled from
     docs/PENDING_SQL.md's own text, NOT verified against the live
     database (no credentials in this environment to do that) — review
     against the actual Supabase dashboard schema before trusting it for
     anything destructive.
  Second-tier fixes also completed this pass (PROMPTS.md's backlog entry
  covers what was deferred instead): `AuthContext.signOut()` now clears
  the persisted React Query cache (`queryClient.clear()` +
  `asyncStoragePersister.removeClient()`) — it used to leave the previous
  session's financial data sitting in AsyncStorage for the next person
  who signs in on the same device to briefly see. Reset All Data now
  calls the new `removeFinancialDataFromCache()` (real `removeQueries()`,
  not `invalidateQueries()` — synchronous and unconditional, not
  dependent on a refetch succeeding before the app might be backgrounded)
  before its existing `invalidateFinancialData()` call.
  `fetchFleetStats()`/`fetchDriverStats()` (`src/data/dashboardStats.ts`)
  each used to issue their OWN full-table `deductions` query even though
  deductions are always user-wide, never truck/driver-scoped — an
  N-truck, M-driver account's Dashboard Fleet Overview issued N+M
  identical redundant fetches. Both now accept an optional pre-fetched
  `deductions` array (`computeFleetStats()` extracted as the shared pure
  aggregation); Home passes its own already-fetched `useDeductions()`
  result into every per-truck/per-driver call.

- CRITICAL DATA BUG — settlement child rows, true profit's own math, Cash
  Flow expenses, dashboard reorder (device feedback 2026-07-31, "2
  settlements imported: Fuel/Reimbursements empty, Cash Flow shows only
  revenue, Best/Worst Lanes empty, Customize Dashboard's simple editor
  changes nothing"). Five separate, independently-confirmed root causes,
  found by tracing the actual write→read path end to end rather than
  guessing:
  1. **Date-fallback bug, `mapExtraction.ts`'s `mapSettlement()`**: every
     fuel/reimbursement/withheld-deduction/toll/maintenance row with no
     PER-LINE date of its own fell back to the extraction's TOP-LEVEL
     `d.date` — which the AI extraction prompt deliberately leaves empty
     for `docType:'settlement'` (settlements use `settlement.weekEnding`
     as their authoritative date, per the DATE HARDENING rounds above).
     Every such row therefore saved with `purchase_date`/`reimb_date`/
     `ded_date`/`toll_date`/`service_date` = NULL. Fixed: a single
     `settlementFallbackDate = s.weekEnding || d.date || undefined`
     computed once in `mapSettlement()`, threaded through
     `toFuelInsert()`/`toReimbInsert()`/`toTollInsert()` (which gained a
     `fallbackDate` param it didn't have before) and the inline
     deductions/maintenance mappers.
  2. **`MonthGroupedList` collapsed the 'unknown' bucket by default**: a
     null-dated row (bug 1, or any other cause) lands in
     `monthGroups.ts`'s `'unknown'` bucket, which always sorts LAST — and
     the collapse-by-default predicate (`monthKey !== thisMonth`) treated
     it like any other past month, collapsing it. The combination meant
     an entire screen's worth of rows could render as a single collapsed
     "▸ Unknown · N items · $X" header at the very bottom of the list —
     which reads as "completely empty" to a user skimming the screen even
     though `groupByMonth()` itself never drops rows. Fixed: the current
     month AND the 'unknown' bucket both now start expanded; only real
     past months default to collapsed (`UNKNOWN_MONTH_KEY` exported from
     `monthGroups.ts` for this check).
  3. **`calcTrueProfit()`/`buildWeeklyTrueProfitTrend()` (`src/stats/
     trueProfit.ts`) silently excluded EVERY settlement-withheld
     deduction**, not just the two intentional exceptions (a per-diem-
     covered meal, an Advance Repayment). Root cause: `mapSettlement()`
     stamps `tax_deductible:false` on EVERY withheld row unconditionally
     (invariant #1's defense-in-depth, so a withheld chargeback is never
     double-counted as a TAX deduction) — but `isDeductibleExpense()`
     (`tax_deductible !== false`) was reused here to decide whether a row
     reduces TRUE PROFIT, a different question entirely. That silently
     skipped every withheld dollar (fuel advance, insurance, ELD fees,
     tolls, escrow...) instead of subtracting it — directly contradicting
     this module's own header comment ("gross − every deduction row,
     withheld + out-of-pocket, once" — verified against
     `profitLoss.ts`'s "gross − withheld already equals settlement net by
     definition" identity) and OVERSTATING true profit by the full
     withheld amount on every settlement, on every screen that reads it
     (Home, Scorecard, CEO Mode, Share Weekly Profit, Profit Analysis —
     this was live in the already-shipped "True-profit consistency"
     update). The existing test suite didn't catch it because its own
     withheld-row fixture set `tax_deductible:true` — a shape
     `mapSettlement()` never actually produces. Fixed: new
     `reducesTrueProfit()` predicate — a row counts if `source ===
     'settlement'` (it left the check, period) OR it's a real deductible
     out-of-pocket expense, UNLESS its category is a Meal (per diem
     covered) or Advance Repayment, which stay excluded regardless of
     source. `profitAnalysis.ts`'s `netIncome` had the identical bug
     (same `isDeductibleExpense` reuse) and got the identical fix.
  4. **Cash Flow's budget forecast had zero connection to
     settlement-derived EXPENSES** (only Weekly Revenue had a trailing-
     average fallback, from the earlier DATA-FLOW AUDIT FIX). Fixed:
     `cashFlowForecast.ts` gained `trailingWeeklyFuelAverage()` (trailing
     28-day average of net fuel cost from `fuel_purchases`) and
     `trailingWeeklyOtherExpenseAverage()` (trailing 28-day average of
     `reducesTrueProfit()`-qualifying withheld deductions, excluding
     Fuel & DEF to avoid double-counting against the fuel average, plus
     tolls) — same "manual entry always wins, this only fills the gap
     while empty, labeled 'from your settlements'" pattern as Weekly
     Revenue. `cash-flow.tsx`'s itemized breakdown rows (which used to
     read the raw, possibly-empty `budget.fuelWeekly`/`budget.otherWeekly`
     form strings directly) now read `forecastInputs.fuelWeekly`/
     `otherWeekly` so the breakdown list and the top stat cards can never
     disagree about what's actually being subtracted.
  5. **Customize Dashboard's Simple editor (`SimpleCustomizeDashboardModal`)
     genuinely saved and invalidated correctly — Home just couldn't show
     the effect**: Home's customized-layout rendering always rendered the
     4 sections in the fixed `SECTION_IDS` order (with unsectioned cards
     always trailing last), completely ignoring WHERE in the user's own
     flat, reordered list those sections' cards actually landed. Since
     most default-visible cards sit in DIFFERENT default sections,
     reordering two of them via the Simple editor's single flat arrows
     list produced literally zero visible change on Home — matching "the
     arrows/toggles change nothing" exactly, even though the save →
     invalidate → refetch data path itself worked. Fixed:
     `dashboardLayout.ts`'s new `buildCustomizedDashboardBlocks()` groups
     the flat, already-reordered `visible` list into blocks (one per
     section, one singleton per unsectioned card) and orders the BLOCKS
     THEMSELVES by the earliest flat-list index any of their member cards
     holds — so moving a card earlier in the Simple editor now visibly
     moves its whole section (or itself, if unsectioned) earlier on Home,
     while same-section cards still render together under one header, in
     their own relative order.
  Tests: `src/data/__tests__/aiImportSave.settlementChildren.test.ts`
  (new) is the requested end-to-end proof — imports a realistic
  settlement (fuel/reimbursements/loads/withheld deductions, none with
  their own per-line dates) through the REAL `saveExtraction()` against
  the fake Supabase client, then feeds the actual saved rows through the
  actual screen-facing calculations (`groupByMonth`, `calcTrueProfit`,
  the new trailing-average functions, `rankLoadsByRpm`) — proving the
  whole chain, not just that a mapper returns the right shape in
  isolation. `src/stats/__tests__/dashboardLayout.test.ts` gained
  `buildCustomizedDashboardBlocks` coverage, including the exact
  reordering-across-sections regression this bug report describes.

- TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31, follow-up to the UX
  mega-pass's Net-to-Owner audit fix, which fixed Home but flagged that
  Scorecard/CEO Mode/Share Weekly Profit still used the wrong figure).
  ONE canonical calculation now: `app/src/stats/trueProfit.ts`'s
  `calcTrueProfit()` (aggregate) / `buildWeeklyTrueProfitTrend()` (weekly
  series, same `{weekEnding, gross, net}` shape as `cashFlowTrend.ts`'s
  `buildWeeklyTrend()` so it's a drop-in replacement) — `profit =
  grossRevenue − every deductible expense (withheld + out-of-pocket
  alike, tax_deductible !== false)`. Two things this gets right: (1)
  always starts from GROSS and subtracts every deduction row once, never
  from a settlement's own `net` (which already has withheld chargebacks
  baked in) plus ALSO subtracting deductions again — proven equal to the
  net-pay shortcut by `profitLoss.ts`'s own header comment, but this
  module always takes the gross route so no caller has to reason about
  which rows are already "in" `net`; (2) EXCLUDES deductions marked
  `tax_deductible: false` — `NON_DEDUCTIBLE_CATEGORIES`
  (`src/import/category.ts`): a Meal already covered by the per diem
  allowance, or an Advance Repayment (literally returning already-
  received money, never a real expense). Deliberately NOT used by
  `buildProfitLoss()` (Operating P&L, a verbatim legacy `rOper()` port —
  counts every deduction unconditionally, by design, for accountant/
  legacy-parity purposes) or `calcScorecard()` (a verbatim legacy
  `rScore()` port, same "operating" ALL-deductions definition by design,
  used for the 0-100 score/grade only) — both stay exactly as documented;
  this module is for every OTHER "what's my profit" dollar figure.
  **Before → after, per screen:**
  - **Home**: Net to Owner card was `grossRevenue − totalDeductions`
    (ALL deductions unconditionally, the mega-pass's own fix) → now
    `calcTrueProfit()`. Its sparkline, the Hero Card's headline number +
    chart (via `calcHeroPeriod`, fed a true-profit-derived series), the
    Overview trio's "Net Profit" tile, and Goal Progress's current-week
    figure were all `revenue − ALL expenses` for the week → now the
    true-profit weekly trend. (The Overview trio's own "Expenses" tile is
    UNCHANGED on purpose — it's the broader "everything spent" total,
    matching the "Total Deductions" card elsewhere; only "Net Profit"
    needed the exclusion.)
  - **Scorecard**: the "Weekly" trend list showed `buildWeeklyTrend()`'s
    bare settlement `.net` (pay only, zero out-of-pocket expenses
    subtracted at all) → now the true-profit weekly trend. The 0-100
    score/grade and its `netPerMile` ratio (shown on Scorecard's own
    Share card) are UNCHANGED — verbatim legacy parity, see above.
  - **CEO Mode / AI Coach**: `thisWeekRevenue`/`thisWeekProfit` cards,
    the Share card, Goal Progress's `latestWeek` input, and — critically —
    the AI Coach briefing's OWN PROMPT TEXT ("This week's revenue: X,
    profit: Y") were all sourced from `buildWeeklyTrend()`'s bare `.net`
    → now the true-profit weekly trend, one shared source (`weeklyTrend`)
    fixing every one of these at once.
  - **Share Weekly Profit**: the "Profit" metric on the share card was
    `selected.net` (the one settlement's own net pay) → now looked up
    from the true-profit weekly trend for the selected week (aggregating
    every settlement sharing that `week_ending`, same convention per
    diem dedup already uses for a multi-truck fleet).
  - **Profit Analysis**: `buildProfitAnalysis()`'s `netIncome` was
    `sum(settlement.net)` — didn't subtract ANY out-of-pocket deduction
    at all, not just fuel/maintenance (which this rollup already tracks
    separately) → the function gained a `deductions` parameter and now
    computes true profit for the window. The screen's own "Weekly" trend
    list had the same `buildWeeklyTrend()` bug as Scorecard/CEO
    Mode → fixed identically. (Home's and CEO Mode's OWN calls to
    `buildProfitAnalysis()` were updated to pass real deduction data too,
    for consistency, even though neither currently displays
    `.netIncome` — only `.fuelPctOfRevenue`/`.revenue`.)
  Tests (`src/stats/__tests__/trueProfit.test.ts`,
  `src/stats/__tests__/profitAnalysis.test.ts`): a dataset with a
  settlement's `net` plus separate out-of-pocket receipts proves the
  formula never double-counts a withheld chargeback already reflected in
  `net`; a Meal-covered-by-per-diem row and an Advance Repayment row are
  each proven to leave profit completely unchanged whether present or
  absent.

- BETA FEEDBACK ROUND 2 — NEEDS-REVIEW VISIBILITY (owner decision
  2026-07-31, device tester report): items the AI flagged as needing
  review are now visually loud everywhere they appear, via one shared
  pure definition (`app/src/import/needsReview.ts`) two underlying
  signals both get the identical treatment for, per the directive ("low-
  confidence AI extractions use the same treatment"): (1) a deduction
  description prefixed `"NEEDS REVIEW: "` at save time (CLAUDE.md
  invariants #3/#14 — an unrecognized-but-financial document, or a fee
  line with nothing to fold into); (2) any extraction with
  `documents.parsed_json.confidence === 'low'` (CLAUDE.md invariant #14),
  looked up via a settlement/transaction's `document_id` where the row
  itself carries no confidence of its own. The shared visual —
  `app/src/components/NeedsReviewBadge.tsx`'s `needsReviewRowStyle()`
  (amber `borderStartWidth`/`borderStartColor`, logical not
  `borderLeftWidth` per invariant #11's RTL rule — Arabic renders it
  trailing automatically) + `NeedsReviewChip` (a small "Needs review"
  chip) — is wired into every row in Deductions, Settlements, Documents
  (both the list row and the viewer), and Transactions, each screen also
  gaining a "Needs review only" filter toggle
  (`needsReview.filterOnly`). `TappableCard` (`src/components/ui.tsx`)
  gained an optional `style` prop to make this possible on the screens
  that use it (Settlements/Documents/Transactions), since it previously
  had no way to accept an external style override.
  `app/src/data/documentsFilter.ts`'s `filterDocuments()` gained a
  `needsReviewOnly` option (tested) rather than the Documents screen
  filtering ad hoc, keeping the pure filter logic in one place. Amber —
  not red — is the deliberate color choice: red already means "expense/
  cost/negative" everywhere else in this app, so reusing it here would
  read as an error rather than "please confirm this." Home gained a
  PERSISTENT counter chip (`NeedsReviewCounterChip`, only rendered when
  `needsReviewDeductions.length > 0`) separate from the existing rotating
  AI Insight card — the rotating card only shows a needs-review message
  when that happens to be the one daily-selected insight among several
  candidate types, so it wasn't reliably visible; the new chip always
  shows and taps straight through to Deductions with the "Needs review
  only" filter pre-enabled via a `?filter=needsReview` route param.

- BETA FEEDBACK ROUND 2 — BACK NAVIGATION, THE ACTUAL FIX (owner decision
  2026-07-31, device tester report: "back lands on Settlements instead
  of Home" — the prior `backBehavior="initialRoute"` change did NOT fix
  it in practice). Root cause this time confirmed by reading the
  INSTALLED expo-router/react-navigation source in `node_modules`
  (`@react-navigation/routers/src/StackRouter.tsx`,
  `expo-router/build/global-state/routing.js`), not guessed a second
  time: every screen under `app/(tabs)/more/` shares ONE nested Stack
  navigator (`more/_layout.tsx`). Cross-tab `router.push('/(tabs)/more/X')`
  calls (Home cards, Reports hub, CEO Mode, Scorecard, ...) dispatch a
  PUSH action against that Stack's OWN existing state — StackRouter's
  PUSH handler always appends to `state.routes`, there is no implicit
  reset for an already-mounted nested navigator. Visiting different Home
  cards across a session (cash-flow, later settlements, later
  tax-estimator, ...) without returning all the way to Home in between
  silently left the "more" stack several screens deep, so back popped
  through THAT accumulated history, landing on whatever unrelated screen
  was still sitting there. `backBehavior="initialRoute"` only governs
  what happens once a tab's own stack is already EMPTY — it never
  addressed the accumulation itself, which is why it didn't fix the
  reported bug. Fix: `app/src/navigation/useResetStackOnTabBlur.ts`,
  called once from `more/index.tsx` (the shared stack's always-mounted
  root screen) — resets that stack to just its root every time the
  "more" tab loses focus, via `navigation.getParent().addListener('blur',
  ...)` + `navigation.dispatch(StackActions.popToTop())`. This means
  re-entering "more" from ANY origin always starts clean
  (`[index, target]`, never a stale accumulation), making back
  deterministic and bounded: at most 2 presses to Home (target ->
  more/index -> Home) instead of unbounded/unpredictable. Applies
  identically to the header back arrow and the Android hardware back
  button (both dispatch through the same navigator tree). Zero changes
  needed at any of the 20+ existing `router.push('/(tabs)/more/X')` call
  sites — the fix lives in exactly one place.
  `app/src/navigation/backIntent.ts`'s `backTargetFor(href)` is the
  resulting per-route intent table (`'home'` vs `'moreIndex'`),
  regression-guarded against every route in `navRegistry.ts` by
  `src/navigation/__tests__/backIntent.test.ts`. See
  `docs/DATA_FLOW.md`'s new "Navigation intent" section for the full
  "how routes must be opened from now on" rule. Known, honestly-flagged
  remaining limitation: this guarantees back is never unbounded/wrong,
  but a screen opened from Home still takes 2 back-presses to reach Home
  (through more/index), not 1 — true 1-press-to-opener for every
  cross-tab screen would require moving these ~30 screens off the shared
  "more" Stack onto the root stack (sibling of `(tabs)`), a much larger
  structural migration intentionally NOT done in this pass; flagged here
  as a scoped-out follow-up rather than silently claimed as fully solved.

- BETA FEEDBACK ROUND (owner decision 2026-07-31, real device tester
  report). Four items:
  1. MONTH GROUPING: every long chronological list gets collapsible month
     sections — implemented ONCE as `app/src/stats/monthGroups.ts` (pure
     `groupByMonth()`: buckets rows into `{monthKey, count, total, rows}`,
     descending, a row with no parseable date lands in a trailing
     `'unknown'` bucket rather than being dropped) +
     `app/src/components/monthGroups/useMonthCollapse.ts` (session-scoped
     collapse state — a module-level `Map`, deliberately NOT
     AsyncStorage/a saved profile field, keyed by `${screenKey}:
     ${monthKey}`, so it survives a screen unmount/remount for the life
     of the JS process and resets on a real app restart, exactly matching
     "remembered... for the session") +
     `app/src/components/monthGroups/MonthGroupedList.tsx` (the header
     row: month label + item count + $ total, tap to expand/collapse;
     current month expanded by default, every older month collapsed).
     `MonthGroupedList` deliberately does NOT impose a single row-
     container style — it takes a `renderRows(rows)` slot rather than a
     per-row renderer, because this app's list screens already render a
     month's worth of rows two different ways (Settlements/Loads/
     Documents: one TappableCard per row; Reimbursements/Deductions/Fuel/
     Tolls/Other Income/Maintenance: bordered rows inside one shared
     Card) and forcing a single container would have meant restructuring
     visuals nobody asked to change. Wired into Settlements,
     Reimbursements, Deductions (both the out-of-pocket and withheld
     sections independently — `screenKey`s `deductions-outOfPocket`/
     `deductions-withheld` — each keeps its own overall total displayed
     above the grouped list now, instead of inline in the same card as
     the rows), Fuel (tractor/reefer sections independently), Tolls,
     Loads, Other Income, Documents, and Maintenance — 9 screens total
     (the 8 named explicitly plus Maintenance, judged the same kind of
     long chronological list). Registries that aren't primarily date-
     browsed lists (Trucks, Drivers, Equipment, Compliance, Loans, Asset
     Register, Bank Statements, Credit Cards) were deliberately left
     alone — `MonthGroupedList` is available for any of them later via
     the exact same 3-file import.
  2. HOME HEADER: the mid-page company-name + email Card (non-functional
     when tapped) is gone. Company name now renders in the Dashboard's
     top bar, under the wordmark where the tagline normally sits —
     `BrandWordmark` (`app/src/components/BrandWordmark.tsx`) gained an
     opt-in `companyName` prop that swaps in for the tagline only when
     passed and non-empty; every OTHER `BrandWordmark` call site (CEO
     Mode's own in-page header block, share-card footers, the wide
     sidebar) is untouched and keeps showing the real tagline, since this
     is per-call-site, not a global behavior change. The whole header
     title block (`DashboardHeaderTitle` in `app/(tabs)/_layout.tsx`) is
     now a `Pressable` straight to Settings (`/(tabs)/more/settings`,
     where the Business Profile section already lives). Email is dropped
     from Home entirely — it was never actionable there and belongs in
     Settings.
  3. EXPENSES BREAKDOWN: added a `'ytd'` third option to
     `MoneyBreakdownRange` (`app/(tabs)/index.tsx`) alongside This Month/
     Last Month — same donut + legend + tap-through-to-Deductions
     behavior, just a wider date window (matches this calendar year
     regardless of month, the same YTD convention every other YTD figure
     in the app already uses — not a rolling 365 days).
  4. VISUAL CONSISTENCY: satisfied as a direct consequence of item 1 —
     all 9 list screens now share the literal same month-header
     component/styling/tap-target size, so "consistent headers, spacing,
     tap targets" across those screens is structural, not a matter of
     each screen separately matching a style guide.

- UX MEGA-PASS item H — PER DIEM RE-CHECK (owner decision 2026-07-31,
  device evidence: re-verify `calcPerDiemDays` end to end). Traced the
  full pipeline and found it correct at every stage, already covered by
  `src/tax/__tests__/perDiem.test.ts`'s existing 0-mile/dedup/clamp
  cases: (1) import preview — `applyDefaultPerDiemDays()` smart-defaults
  a new settlement's `perDiemDays` to 0 for a 0-mile "home week," 7
  otherwise, editable via `withPerDiemDays()`; (2) save —
  `mapExtraction.ts`'s `mapSettlement()` writes
  `clampPerDiemDays(s.perDiemDays ?? defaultPerDiemDaysForMiles(miles))`,
  the same smart default as a fallback if the preview step was somehow
  skipped; (3) settlement detail (`settlements.tsx`) — freely editable
  after the fact; (4) `fetchFleetStats()` selects `per_diem_days` and
  calls `calcPerDiemDays(rows)`, which SUMS whatever's stored per
  settlement (deduped by `week_ending`, taking the MIN on a multi-truck
  fleet's same-week duplicate) — it never re-derives from miles, so a
  user's manual edit always sticks. Computed a concrete 2-settlement
  dataset to verify end to end: one full OTR week (W/E 2026-07-18, 2,500
  mi, `per_diem_days: 7`) + one home week (W/E 2026-07-25, 0 mi,
  `per_diem_days: 0`) → `calcPerDiemDays()` returns **7**, matching the
  expected 7 + 0 = 7 exactly (verified by direct test run, not just
  manual arithmetic). The one real gap found: the day-count breakdown was
  only visible after tapping into a settlement's detail sheet, not at a
  glance in the Settlements list — added
  `settlementsScreen.perDiemDaysCount` ("{{count}}/7 per diem days") to
  each list row so the breakdown is visible without an extra tap, per the
  directive's "show the day count breakdown per settlement somewhere
  visible."

- UX MEGA-PASS item G — CHARTS & HOME LAYOUT (owner decision 2026-07-31):
  (1) the Hero Card gets period tabs — This Week / Last Week / 1M / 3M /
  6M / Yearly — driving the number, delta, AND chart together via the new
  `app/src/stats/heroPeriod.ts`'s `calcHeroPeriod()`. thisWeek/lastWeek
  stay the pre-existing straight two-settlement-week comparison (weekly
  is this app's only revenue granularity, CLAUDE.md invariant #9);
  1M/3M/6M/yearly sum every week's net within a rolling N-day window
  (30/90/180/365) and compare it to the immediately PRECEDING equal-
  length window — a rolling comparison, not the unrelated "YTD Per Diem
  Days" stat's calendar-year convention, so every non-weekly period's
  delta is defined the same consistent way. The "vs last week" $-delta
  copy only shows for the two weekly periods; every other period shows a
  new generic "vs previous period" string
  (`dashboard.hero.vsPreviousPeriodAmount`). (2) The Dashboard's Overview
  chart (`RevenueExpenseChart`, the `revenueExpenseTrend` card) was the
  one remaining thick-opaque-bar holdout — restyled to the same thin-line
  `buildPolylinePoints()`/`buildAreaPoints()` primitive (src/stats/
  chartHelpers.ts) Hero/Cash-Flow already use (CLAUDE.md's CHART LANGUAGE
  CONSISTENCY invariant), two lines (revenue green, expenses red) sharing
  one Y-axis domain via `buildPolylinePoints`'s `domain` param — plotting
  them independently would have made a false visual comparison. (3) Cash
  Flow's 4-week balance timeline section (the `cashFlowScreen.
  timelineTitle` Card, `forecast.weeks` row list) was removed from
  `app/(tabs)/more/cash-flow.tsx` per the directive — the underlying
  `weeks` field stays computed in the forecast stats module (unused by
  any screen now, not deleted, in case a future screen wants it) rather
  than being torn out of the pure calculation. (4) Recent Loads' route
  text (`{{order}} · {{origin}} → {{destination}}`) had no `flex`/
  `numberOfLines` constraint sharing a row with the revenue amount — a
  long route could overflow past the card edge or squeeze the amount
  column on narrower phones (and, less visibly, tablets with more cards
  per row). Fixed with `flex:1`+`numberOfLines={1}` on the route text and
  `flexShrink:0` on the amount — `MutedText` (`src/components/ui.tsx`)
  gained a `numberOfLines` passthrough prop to make this possible, since
  it didn't forward one before. (5) AUDIT FINDING — the Dashboard's "Net
  to Owner" card was reading `stats.netRevenue`: the sum of each
  settlement's own `net` field, i.e. net PAY (gross minus carrier-
  WITHHELD deductions only) — it silently ignored every out-of-pocket
  business expense (fuel, maintenance, store purchases — any deduction
  with `source != 'settlement'`), overstating what the owner actually
  nets by exactly that amount. Verified against `src/stats/profitLoss.ts`
  (Operating P&L)'s `buildProfitLoss()`, whose own header comment proves
  the correct formula: `netIncome = grossRevenue - totalDeductions(ALL)`
  is mathematically identical to `netRevenue - outOfPocketDeductions`
  ("gross - withheld already equals settlement net by definition").
  Fixed: the card and its sparkline (previously `weeklyNetTrend`'s bare
  per-week `.net`, same bug at per-week granularity) now both derive from
  `fullWeeklyRevenueExpenseTrend`'s `revenue - expenses`, which already
  nets ALL deductions correctly (it's the same source the Hero Card and
  the newly-restyled Overview chart use). NOT fixed in this pass, flagged
  as a known follow-up: the identical "settlement net, not true profit"
  pattern also feeds `buildWeeklyTrend()`'s `.net` field, which is what
  Scorecard's weekly trend, CEO Mode's "This Week Profit" card, and Share
  Weekly Profit's "Profit" metric all display — each reads as "profit"
  but is actually settlement net pay, the same conceptual gap this audit
  found and fixed for the Dashboard specifically. Fixing those three
  needs its own pass (they're a different card/screen from the one this
  audit item named) rather than a scope-creeping side effect here.

- UX MEGA-PASS item E — DOCUMENT TITLES (owner decision 2026-07-31,
  device evidence: a document's title/label must reflect the actual
  store or document subject, e.g. "Walmart," not the raw docType label
  "Store/Amazon Purchase"). `documents.parsed_json` always holds the FULL
  raw `Extraction` regardless of docType (D3 audit trail,
  `aiImportSave.ts`), and `Extraction.vendor` is populated by the AI-
  import prompt for any document that names a vendor/shop on its face —
  not just purchase receipts. `app/src/data/documentTitle.ts`'s pure
  `deriveDocumentTitle(parsedJson, fallbackLabel)` reads that vendor and
  falls back to the docType's own `docTypeMeta(...).label` when none was
  extracted (unchanged behavior for docTypes that never carry a vendor,
  e.g. a bank statement). Wired into both the Documents list row and the
  viewer's `SheetTitle` (`app/(tabs)/more/documents.tsx`) — the docType
  label is kept as a secondary muted line whenever it differs from the
  title, so the document category is never lost, just demoted from
  "the only thing you see" to "context under the actual name." The
  viewer's close X came for free from item B's ModalSheet upgrade.

- UX MEGA-PASS item D — IMPORT FLOW (owner decision 2026-07-31): (1)
  payment method was already auto-detected at Save time
  (`normalizePaymentMethod(extraction.purchase?.paymentMethod)`,
  `app/(tabs)/import/index.tsx`) but had NO editable UI anywhere in the
  preview — a wrong AI guess had no fix short of editing the deduction
  after the fact. The import preview now shows the same 9-pill payment-
  method picker Deductions uses (`app/(tabs)/import/index.tsx`'s local
  `Pill`), for `amazon`/`store` (purchase) extractions only, wired
  through a new pure helper, `app/src/import/paymentMethods.ts`'s
  `withPaymentMethod(extraction, method)` — mirrors `dateGuard.ts`'s
  `withPrimaryExtractionDate()`/`perDiem.ts`'s `withPerDiemDays()` pattern
  so the screen's single `extraction` state stays the one source of truth
  Save reads from, no separate override state to drift out of sync. (2)
  The post-save screen's single "Import Another" button is now three:
  **View Record** (opens `/(tabs)/more/documents?openId=<documentId>` —
  `SaveExtractionResult.documentId` is always available regardless of
  docType, and the Documents viewer's existing "linked records" list
  already jumps from there to the actual settlement/deduction/maintenance
  row, so this reuses 100% existing plumbing rather than adding a new
  per-docType route table), **Import Another** (unchanged, calls the
  existing `reset()`), and **Done** (routes to `/(tabs)`, Home).

- UX MEGA-PASS item B — MODAL/SHEET CONSISTENCY (owner decision
  2026-07-31, device evidence: "deduction edit has no save/cancel/close
  and doesn't scroll and doesn't save"). Root cause: the shared
  `ModalSheet` (`app/src/components/ui.tsx`) had no height cap and never
  wrapped its children in a ScrollView — on a sheet with enough content
  (category picker + tax-deductible pills + amount field + all 9 payment-
  method pills), the card grew taller than the viewport and the overlay's
  centered, non-scrolling layout silently clipped the overflow, so Save/
  Cancel at the bottom were rendered but physically unreachable —
  "doesn't save" was a reachability symptom, not a mutation bug (the
  `updateDeduction.mutateAsync({ id, values })` call itself was already
  correct). Some screens (Settlements, Trucks, Maintenance, etc.) had
  independently worked around this with their own ad-hoc
  `<ScrollView style={{ maxHeight: 480 }}>` wrapper; others (Deductions,
  Capital Account, Loans, ...) had not, which is why the bug was
  inconsistent across screens. Fixed centrally, once, with zero required
  call-site changes: `ModalSheet` now (1) caps `modalCard` to 85% of the
  window height and wraps `children` in its own `ScrollView`
  (`keyboardShouldPersistTaps="handled"`) so a sheet ALWAYS scrolls
  instead of silently overflowing; (2) renders a consistent ✕ close button
  in the top-right corner wired to the same `onClose` every call site
  already passes, satisfying "every modal/sheet gets a consistent header:
  title + X close" without an API change; (3) wraps the overlay in a
  `KeyboardAvoidingView` so an open keyboard never covers Save either. The
  now-redundant ad-hoc `<ScrollView style={{ maxHeight: N }}>` wrappers
  were removed from every screen that had one (truck-health, asset-
  register, equipment, drivers, trucks, compliance, maintenance, tax-
  estimator, settlements, documents) to avoid nesting two same-axis
  ScrollViews — bank-statements.tsx's inner `maxHeight: 360` ScrollView
  around its transaction list was deliberately left alone, since that one
  bounds a sub-list inside a longer sheet rather than duplicating the
  sheet's own scroll. The Import tab (reached via the raised center [+]
  button / action sheet, not a natural back-push, and — as its own
  sibling `Tabs.Screen` — with no default back arrow) gained an explicit
  `headerLeft` ✕ close button (`ImportCloseButton` in
  `app/(tabs)/_layout.tsx`) that routes straight to Home, same "always a
  way out" principle. Any FUTURE sheet just uses `ModalSheet` — the
  close X, scroll, and keyboard-avoidance come for free.

- UX MEGA-PASS item A — NAVIGATION ROOT CAUSE (owner decision 2026-07-31,
  device evidence: "back always lands on Truck page," "per diem card opens
  Tax Estimator," "Recent Loads opens Cash Flow"). Two distinct root
  causes, one pass: (1) `app/(tabs)/_layout.tsx`'s `<Tabs>` never set
  `backBehavior`, so it defaulted to React Navigation's `'history'` — once
  a tab's own stack is back at its root, hardware/gesture back jumps to
  whichever OTHER tab was most recently active, not Home. `truck-health`
  (href: null, but still its own sibling `Tabs.Screen`, not a route nested
  under `more`) is reached from many shortcuts (Home's Truck Status card,
  Reports' Intelligence group), so it was very often "the last other tab,"
  making it the constant back target. Fixed by setting
  `backBehavior="initialRoute"` — back now deterministically returns to
  this navigator's initial route (index / Home) once a tab's stack is
  exhausted. (2) Dashboard card destinations were ad-hoc inline
  `router.push()` calls scattered through `app/(tabs)/index.tsx` with no
  single place to audit — several routed to a generic catch-all instead of
  their actual content (per diem cards → Tax Estimator, which has no per
  diem breakdown at all; Recent Loads → Cash Flow instead of Loads). Fixed
  by extracting one table, `app/src/stats/dashboardLayout.ts`'s
  `DASHBOARD_CARD_ROUTES` (card id → route), which `index.tsx`'s
  `goToCard()` helper reads instead of hardcoding a push per card — per
  diem cards now route to Settlements (where `per_diem_days` actually
  lives and is user-editable, CLAUDE.md invariant #25), Recent Loads
  routes to Loads. `src/stats/__tests__/dashboardLayout.test.ts` regression-
  guards both the specific reported bugs and the general "every route
  starts with `/(tabs)/`" sanity check. Any future card with a fixed
  destination goes in this table, not an inline `router.push()`.
