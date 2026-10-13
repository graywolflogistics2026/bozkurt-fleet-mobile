# Cash Flow Forecast

> Cash Flow: auto-fill from settlements, 30-day forecast built from the user's own data, recurring-charge classifier.
> No owner-specific default numbers (see the first standing rule); manual entry always overrides.
> Balance concept removed 2026-08-27 (see balance-removal.md).

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- CASH FLOW AUTO-FILL FROM SETTLEMENT DATA (owner decision 2026-08-04,
  device report: the Insurance field showed 0 and was monthly-only, while
  a real carrier withholds FOUR separate insurance charges EVERY WEEK —
  bobtail/deadhead, physical damage, occupational accident, cargo/workers
  comp). Two root causes, one pass:
  1. **Wrong shape**: `cf_insurance_monthly` (docs/PENDING_SQL.md §29)
     assumed a manually-entered monthly bill; a carrier's insurance
     withholding is weekly, per-settlement, and already sitting in the
     user's own imported data — it should never have needed manual entry
     at all.
  2. **Miscategorized on import**: the settlement JSON extraction schema's
     own deduction category enum includes the literal string `"Insurance"`
     (not either canonical `'Insurance—Truck'`/`'Insurance—Health'` value)
     — a line landing there via the loose `x.category` fallback (no
     chargebackType set) was an unrecognized category string, invisible
     to any category-based filter.
  **Fix**: `app/src/import/category.ts`'s new `isInsuranceChargeback()` —
  a text-based fallback (same "AI classification is primary, regex is
  the safety net" pattern as `isEscrowDeposit()`/`isRestaurantPurchase()`)
  matching the real abbreviated carrier codes from the device report
  (`BT/DH INS`, `PHY DAM`, `OCCUP ACC`, `CARGO`, `WORKERS COMP`) plus
  spelled-out/generic insurance wording — wired into
  `mapExtraction.ts`'s `mapSettlement()` at the SAME override priority as
  escrow/restaurant detection, so a settlement-withheld insurance line
  now reliably lands as `'Insurance—Truck'` regardless of whether the AI
  set chargebackType.
  **New column, not a reinterpretation** (docs/PENDING_SQL.md §39):
  `profiles.cf_insurance_weekly` — `cf_insurance_monthly` is left in
  place, unused, same "harmless deprecated column" precedent as
  `dashboard_layout` after the Customize Dashboard retirement. A renamed/
  reinterpreted column would have silently misread an already-saved
  monthly figure as weekly (a 4.33x error) for any existing user.
  **Auto-fill extended to every input with real data behind it** (not
  just Insurance) — `app/src/stats/cashFlowForecast.ts` gained
  `trailingWeeklyInsuranceAverage()` and `trailingWeeklyTruckPaymentAverage()`,
  both using a NEW shared `trailingWeeklyWithheldAverage()` helper that
  groups settlement-withheld (`source==='settlement'`) deductions by
  `ded_date` (which for a withheld row IS the settlement's own
  `week_ending`, `mapSettlement()`'s `settlementFallbackDate`) and
  averages the trailing 4 distinct weeks — the SAME "distinct settlement
  weeks, not a raw calendar window" pattern `trailingWeeklyRevenueAverage`
  already used, deliberately different from `trailingWeeklyFuelAverage`/
  `trailingWeeklyOtherExpenseAverage`'s 28-day-window approach (fuel/
  generic-other data isn't tied to a settlement week the way a carrier
  withholding is). `trailingWeeklyOtherExpenseAverage` now EXCLUDES
  `'Insurance—Truck'`/`'Insurance—Health'`/`'Truck/Trailer Payments'`
  (alongside the existing `'Fuel & DEF'` exclusion) so these dollars are
  never double-counted into both a dedicated field AND "Other Weekly."
  `insuranceMonthly` was renamed `insuranceWeekly` throughout
  `CashFlowBudgetInputs`/`calcCashFlowForecast()` — the old `/4.33`
  monthly→weekly conversion is gone; it now sums into weekly expenses
  directly like every other budget input.
  **Manual override survives a new import, with an explicit reset
  action**: a new pure `mergeForecastInputsWithAverages()` function
  (previously this merge logic was inline in the screen's own
  `useMemo`) makes "an empty field falls back to the trailing average;
  a manual entry always wins" directly unit-testable without mounting
  the screen. `cash-flow.tsx` gained a shared `AutoFillField` component
  (replacing 5 near-identical hand-rolled field blocks) used by all 5
  auto-fillable inputs (Weekly Revenue, Fuel, Insurance, Truck Payment,
  Other) — an empty field shows the "avg of last 4 weeks: $X" caption
  (`cashFlowScreen.weeklyRevenueFromSettlements`, reused across all 5 for
  consistency); once the user types a manual value, the caption is
  replaced by a "↺ Reset to average ($X)" action
  (`cashFlowScreen.resetToAverage`, new key, all 7 locales) that clears
  the field rather than requiring the user to manually select-all-and-
  delete. Truck Payment (label already said "(wk)" even before this
  pass) and Insurance both gained this auto-fill treatment for the first
  time; Weekly Revenue/Fuel/Other keep their existing averages, now with
  the same reset action they lacked before.
  Tests: `app/src/import/__tests__/category.test.ts` gained
  `isInsuranceChargeback()` coverage (the exact real carrier codes,
  spelled-out variants, and a false-positive check).
  `app/src/import/__tests__/mapExtraction.test.ts` proves a settlement
  deduction landing on the schema's generic `"Insurance"` category still
  resolves to `'Insurance—Truck'` via the text fallback, and that a
  correctly-set `chargebackType` still works unchanged.
  `app/src/stats/__tests__/cashFlowForecast.test.ts` gained coverage for
  both new trailing averages (including the exact 4-separate-weekly-
  insurance-lines shape from the device report), the "Other Weekly"
  double-counting exclusion, and `mergeForecastInputsWithAverages()`
  (empty falls back, a manual override survives a simulated new import
  changing the average, an explicit `0` is a real value not "empty").
  A pre-existing integration test
  (`aiImportSave.settlementChildren.test.ts`) needed updating — its
  fixture's unlabeled "Weekly insurance" deduction used to fall into the
  generic "Other" bucket by accident (no category match existed before
  this pass); it now correctly lands in the dedicated Insurance average
  instead, exactly proving the fix end to end rather than in isolation.
  Full suite: 66 suites / 1520 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity.

- CASH FLOW 30-DAY FORECAST — BUILT FROM THE USER'S OWN DATA (owner
  decision, binding, replaces the manual-budget-entry design in full,
  docs/PENDING_SQL.md §57). The forecast used to require the user to type
  5 weekly budget figures by hand (Weekly Revenue/Truck Payment/Fuel/
  Insurance/Other), defaulting to a blank/zero screen until they did, even
  with months of real settlement history already on file. It now
  classifies the user's own trailing settlements/deductions/fuel/
  maintenance/tolls and layers in known dated bills from Documents &
  Renewals — a real forecast exists the instant settlements exist, with
  zero manual entry required.
  1. **CLASSIFICATION, three new pure modules**:
     `app/src/stats/cashFlowClassification.ts`'s `classifyCashFlowSpending()`
     splits the trailing 12 weeks of spend into RECURRING FIXED (a charge
     appearing in ≥60% of observed weeks with ≤25% coefficient of
     variation in its own amount, minimum 2 occurrences — frequency +
     variance, never a hardcoded category list: a totally unrecognized
     custom category like "Dispatch Software" qualifies exactly the same
     way insurance/permits/ELD do), VARIABLE PER MILE (the spec's own
     explicit 4 categories — Fuel & DEF, Fuel Additives, Maintenance &
     Repairs, Tolls & Scales — never run through the frequency test, each
     gets its own real $/mile rate = trailing total $ ÷ trailing total
     miles), and ONE-OFFS (everything that fails the fixed test — a
     $7,200 extended-warranty purchase seen once is excluded from the
     weekly projection entirely, never smeared into a false weekly
     average). Grouping uses a shared Monday-anchored ISO week key
     (`isoWeekKey()`) so a recurring bill paid either via settlement
     withholding or out-of-pocket still groups consistently week over
     week. `app/src/stats/cashFlowPeriodic.ts`'s
     `buildPeriodicForecastItems()` pulls HVUT 2290/IRP/insurance-policy-
     renewal/annual-inspection due dates from `compliance_items` falling
     in the next 30 days and drops each into the exact week it's due —
     the amount comes from the linked document's own real `amount` column
     when one exists (`buildDocumentAmountLookup()`), or is left `null`
     (never guessed) with the UI offering to enter it — HONESTY item 5's
     "never invent a number with no basis" applied literally to the one
     place in this pass where a real number genuinely isn't always
     available. `app/src/stats/cashFlowForecast.ts` is the assembly
     layer: `buildSpendEvents()` merges deductions/fuel/maintenance/tolls
     into one flat list (excluding Meals/Advance Repayment/Escrow via the
     existing `reducesTrueProfit()` — never a real cash outflow to
     project — and excluding settlement-linked `fuel_purchases` rows, the
     SAME canonical-expense-engine double-count guard `trueProfit.ts`'s
     `sumCanonicalExpenses()` already established, so this new module
     never disagrees with the rest of the app about what counts as a real
     expense); `buildCashFlowForecast()` produces the week-by-week table;
     `buildCashFlowForecastFromData()` is the one end-to-end entry point
     the screen calls with raw query data.
  2. **INCOME, adjusted for how many settlements actually landed**:
     `trailingWeeklyNetIncomeAverage()`/`trailingWeeklyMilesAverage()`
     reuse the SAME "divide by however many distinct weeks were actually
     found, never a fixed denominator" convention this app established
     back in the original DATA-FLOW AUDIT FIX — a genuine $0-net "home
     week" settlement that DID land still counts as one of the weeks
     (correctly pulls the average down); a week with no settlement at all
     is simply absent from the map and never assumed to be $0, so it can
     never silently halve the average the way a fixed divide-by-4 would.
     `upcomingReimbursementsByWeek()` adds any reimbursement already on
     file dated within the forecast window itself (a one-time, dated
     event) to that specific week's income rather than smoothing it into
     the weekly rate.
  3. **OUTPUT — real week-by-week, not a flat 4× repeat**: the OLD
     forecast's own "weeks" array just repeated one steady-state week's
     numbers 4 times with a running balance; the new one still uses one
     steady-state income/fixed/variable figure per week (same spirit) but
     now genuinely varies week to week via the PERIODIC layer — a
     compliance due date landing in week 2 shows up ONLY in week 2's own
     row, correctly denting that week's ending balance. Each
     `CashFlowWeekProjection` carries opening/income/fixed/variable/
     periodic/ending plus that week's own periodic items; the result's
     `tightestWeekIndex` identifies the lowest ending balance across all
     4 weeks, and the screen renders a plain "Tightest point: $1,240 on
     Sep 12 — the 2026 HVUT 2290 lands that week" line
     (`cashFlowScreen.tightestPointWithReason`, falling back to the
     reason-free `tightestPointLine` when nothing periodic caused it).
  4. **TRANSPARENT AND EDITABLE**: every one of the 3 weekly figures
     (Income/Fixed/Variable) shows its real basis caption — "avg of last
     N week(s)" for income, "N recurring charge(s) detected" for fixed,
     "$X/mi × Y mi" for variable — and a tap-to-edit affordance
     (`OverridableStat`, replacing the old screen's private, per-instance
     `AutoFillField`) opens an inline Field; saving persists to one of 3
     new `profiles` columns (`cf_income_override`/`cf_fixed_override`/
     `cf_variable_override`, docs/PENDING_SQL.md §57) which always wins
     over the computed figure and is marked with a "your override" basis
     caption plus a "↺ Reset to average" action that clears it back to
     null. A periodic item's own amount is independently overridable too
     — a flexible per-item jsonb map (`cf_periodic_overrides`,
     `compliance_items.id -> amount`) rather than a normalized column,
     same "flexible per-key user state" pattern as `profiles.nudge_state`.
     Overrides are proven by test to survive a subsequent import that
     changes the underlying computed average (item 6's own explicit ask)
     — the SAME override object still wins regardless of what the fresh
     classification/average recomputes to, since it's stored and read
     completely independently of the live computation.
  5. **HONESTY**: `CashFlowForecastResult.reliable` is `false` whenever
     fewer than 3 distinct weeks of history exist (`weeksOfHistory`, the
     max of the income-average's own weeksFound and the classifier's own
     weeksObserved) — the screen shows an amber banner ("A couple more
     settlements and this gets reliable — N week(s) of history so far")
     but ALWAYS still renders the full forecast underneath it, never
     hides it — "show what IS known rather than nothing." The screen's
     own empty state only fires when the account has LITERALLY ZERO
     settlements ever (`hasSettlements`) — "never show a blank forecast
     when settlements exist," satisfied structurally: 1+ settlements
     always produces a real (possibly just-flagged-unreliable) forecast,
     never a blank budget-entry form.
  6. **Screen rewrite** (`app/(tabs)/more/cash-flow.tsx`): kept — Bank
     Balance and Tax Reserve % (the only two genuinely manual, non-
     derivable inputs), the existing Weekly Trend chart and Best/Worst
     Lanes sections (out of scope for this pass, untouched). Removed —
     the 5 old AutoFillField budget inputs and their own trailing-average
     hooks (`trailingWeeklyRevenueAverage`/`trailingWeeklyFuelAverage`/
     `trailingWeeklyOtherExpenseAverage`/`trailingWeeklyInsuranceAverage`/
     `trailingWeeklyTruckPaymentAverage`/`mergeForecastInputsWithAverages`/
     `calcCashFlowForecast`/`CashFlowBudgetInputs` — all deleted outright,
     confirmed to have zero other callers app-wide before removal, unlike
     this codebase's usual "leave harmless dead code" precedent, since an
     entire parallel forecast ENGINE sitting unused would be a much
     larger footprint than a few orphaned i18n strings). Added — the
     Weekly Assumptions card (3 `OverridableStat` rows), a Recurring
     Fixed Charges breakdown list, a Variable Cost per Mile breakdown
     list, a one-offs transparency note ("$7,200 excluded — 1 one-time
     item(s), not expected to repeat"), a Known Upcoming periodic-items
     list (with an inline amount-entry Field when the linked document has
     no `amount` on file), the tightest-point line, the reliability
     banner, and 4 `WeekCard`s (one per forecast week) replacing the old
     flat forecast table.
  7. **Deprecated columns, not deleted** (same established precedent as
     `cf_insurance_monthly`): `cf_weekly_revenue`/`cf_truck_payment`/
     `cf_fuel_weekly`/`cf_insurance_weekly`/`cf_other_weekly` are left in
     place, unused, on `profiles` — no migration needed, nothing reads
     them anymore. `reset-data`'s `PROFILE_DATA_RESET` was updated to
     clear all 4 NEW columns (CLAUDE.md invariant #24's own rule: an
     unlisted new `profiles` column is silently KEPT, not the safe
     default — a reset account must not retain a stale manual override);
     no query-invalidation change needed since these are new fields on
     the already-invalidated `'profile'` row, not a new table.
  Tests: `cashFlowClassification.test.ts` (new, 14 tests — fixed
  detection by frequency+variance including an unrecognized custom
  category, a wildly-inconsistent-amount charge correctly rejected as
  fixed, a once-seen charge never called recurring, variable $/mile rate
  computation with a divide-by-zero guard, a large one-off excluded from
  the weekly total, and a full realistic 12-week mixed dataset separating
  all three buckets correctly in one pass — the exact "classification
  separates fixed/variable/periodic on a realistic dataset" ask).
  `cashFlowPeriodic.test.ts` (new, 10 tests — a renewal inside the 30-day
  window lands with the right date, boundary dates included/excluded
  correctly, only the 4 real periodic-bill types included even when a
  personal compliance type shares the same due date, amount sourced from
  a real linked document or left null, never guessed).
  `cashFlowForecast.test.ts` (rewritten, 18 tests — spend-event exclusion
  rules, the 0-mile/0-net "home week" correctly counted not silently
  halving the average, upcoming-reimbursement week bucketing, the full
  week-by-week assembly including a periodic item landing in its exact
  week and tightest-week detection, all 4 override-survives-a-changed-
  average cases, and one full `buildCashFlowForecastFromData()` end-to-
  end realistic-dataset test). A pre-existing test in
  `aiImportSave.settlementChildren.test.ts` was updated (not weakened) to
  prove the same settlement-linked-fuel double-count guard fires
  correctly against a real saved settlement, rather than asserting the
  old engine's own (inconsistent-with-the-rest-of-the-app) double-
  counting behavior. Full suite: 99 suites / 2436 tests pass; `tsc
  --noEmit` clean; all 7 locales confirmed key-parity (es/ru/ar/tr fully
  translated, hi/uk as untranslated English copies per invariant #11;
  glossary test re-passed clean). No Edge Function redeploy needed (the
  one Deno-side change, `reset-data`'s `PROFILE_DATA_RESET`, still needs
  redeploying once docs/PENDING_SQL.md §57 has been run). No new native
  dependency — pure JS/TS plus one small SQL migration — ships via a
  normal `eas update`.

- CASH FLOW RECURRING-CHARGE CLASSIFIER — TOO STRICT FOR A YOUNG ACCOUNT,
  AND NOT CORRECTABLE (owner decision, device report: "Fixed expenses $0
  · 0 recurring charges detected" despite weekly Insurance/Permits/ELD
  chargebacks in nearly every settlement). docs/PENDING_SQL.md §66,
  **NOT YET APPLIED**; no Edge Function changes.
  **DIAGNOSIS (instrumented before any fix, per the owner's own explicit
  ask — "don't guess")**: a throwaway diagnostic test run against a
  PERFECTLY clean 6-settlement/6-week dataset (identical weekly Insurance/
  Permits/ELD amounts every week) already passed under the OLD thresholds
  — `classifyCashFlowSpending()`'s math itself was never wrong for an
  ideal case. The real failure mode, confirmed by instrumenting a second,
  more realistic dataset: a charge that resolves correctly under the SAME
  category in only SOME of a young account's real weeks (3-4 of 6 —
  plausible from real-world OCR/text variance in how a carrier's own
  chargeback line reads week to week, matching the report's own "nearly
  every week" framing, not "literally every week") was held to the exact
  same 60%-of-weeks-observed ratio + a flat 2-occurrence floor that an
  ESTABLISHED, many-months account is held to — a ratio that is not a
  statistically meaningful signal yet over only a handful of data points.
  Two hypotheses were tested and ruled out directly rather than assumed:
  the rows genuinely reach `classifyCashFlowSpending()` (confirmed via
  `buildSpendEvents()`'s own output), and `weeksObserved` is NOT diluted
  by variable-category (fuel/maintenance/toll) events landing in extra
  weeks beyond the settlement weeks (the ISO-week grouping already
  correctly collapses same-week events regardless of which bucket they
  land in).
  **THE THRESHOLD FIX**: `src/stats/cashFlowClassification.ts` replaces
  the old flat `frequency >= 60%` + `occurrences >= 2` pair with ONE
  scaled function, `requiredOccurrencesFor(weeksObserved)` — for an
  account with 6 or fewer observed weeks, only 3 occurrences are required
  (the owner's own explicit "allow classification from 3 occurrences"),
  with an ABSOLUTE floor of 2 occurrences preserved regardless of how few
  weeks exist (a charge seen exactly ONCE can never be "recurring," full
  stop — a real regression this pass caught in its own pre-existing test
  suite: `min(3, weeksObserved)` alone would have let a single random fee
  in a brand-new 1-week account pass, since "occurring in the only 1 week
  observed so far" trivially satisfies "3 occurrences" when weeksObserved
  itself is 1). Above 6 weeks, the function converges back toward the
  original 60% ratio (now occurrence-based: `max(3, ceil(weeksObserved *
  0.6))`), so an established account's own behavior is materially
  unchanged. The variance (CV ≤ 25%) threshold was left as-is — the
  report's own $30.43/$30.43/$29.99 example already computes to ~0.7% CV,
  nowhere near the existing threshold, confirmed by test rather than
  assumed.
  **SHOW AND LET ME CORRECT IT** (owner's own explicit item 3,
  "detection is a convenience, not a cage"): `RecurringFixedCharge`
  gained a `source: 'auto' | 'manual'` tag, and a new pure
  `mergeRecurringCharges(detected, overrides)` combines the classifier's
  own detected list with the user's own corrections — an edited amount
  (still tagged `'auto'`, since the detection itself is still real, only
  the dollar amount was corrected), a removal (`removed: true`, excludes
  an otherwise-detected category entirely), or a brand-new manually-added
  charge for a category the classifier never detected at all (tagged
  `'manual'`, `occurrences: 0`). Persisted in a new
  `profiles.cf_recurring_charges` jsonb column (docs/PENDING_SQL.md §66),
  keyed by CATEGORY STRING — the SAME key the classifier itself groups
  by — so a correction survives the next re-classification of the same
  category untouched, exactly like `cf_periodic_overrides` (§57) already
  does for periodic items; the client already reads it via `?? {}`, so
  the screen stays fully usable (falls back to showing exactly what the
  classifier detected, unedited) even before the migration has actually
  been run. `buildCashFlowForecast()` now computes `weeklyFixed` from the
  MERGED list (`mergeRecurringCharges(classification.fixed,
  overrides.recurringCharges)`), not the classifier's own raw, uncorrected
  `weeklyFixedTotal` — a correction now actually changes the projected
  weekly figure. The older, coarser `cf_fixed_override` (override the
  WHOLE weekly total in one shot) is left completely unchanged and still
  wins over the merged per-charge sum when set — a deliberately additive,
  non-breaking layer under it, not a replacement.
  `app/(tabs)/more/cash-flow.tsx`'s "Recurring Fixed Charges" card now
  lists every merged charge individually — tap to edit its amount inline,
  a ✕ to remove it (with a "{{category}} removed · Restore" link so a
  removal is never a one-way door), each row labeled "seen N of M weeks"
  (detected) or "Added by you" (manual) — plus an always-visible "+ Add a
  recurring charge" action (a plain category-name + weekly-amount form)
  for anything the classifier missed entirely.
  **NEVER PRESENT "$0 FIXED" AS FACT** (owner's own explicit item 4): the
  card's empty state — shown identically whether the real reason is "not
  enough history yet" or "the classifier genuinely found nothing" (the
  owner's own explicit "either way" framing, never two different
  messages implying one case is more certain than the other) — is now
  "Not enough history yet — add your fixed costs manually," with the same
  "+ Add a recurring charge" action right there, replacing the old bare
  "$0 · 0 recurring charges detected" line that read as a confident,
  final answer.
  **TESTS** (item 5, all three explicitly requested): a realistic
  6-settlement dataset (`cashFlowClassification.test.ts`) where Insurance
  resolves in all 6 weeks (with the report's own $30.43/$30.43/$29.99
  variation), Permits in 4 of 6, and ELD in exactly 3 of 6 (the literal
  floor) — all three detected, the one-off $6,500 extended-warranty line
  excluded and never inflating the weekly total. `requiredOccurrencesFor()`
  gets its own dedicated coverage (the young-account floor, the
  never-from-a-single-occurrence guard, and the established-account
  convergence). `mergeRecurringCharges()` gets full coverage (pass-
  through, edit, removal, manual addition) plus the literal "a manually
  added recurring charge survives new imports" case — the SAME overrides
  object applied against a classification that changed shape (simulating
  a fresh import) still contributes the manual charge unchanged.
  `cashFlowForecast.test.ts` gained the same "survives a new import" proof
  one level up, through the real `buildCashFlowForecast()`, plus a direct
  proof that `weeklyFixed`/`fixedCharges` are genuinely empty (never a
  silently-wrong non-zero number) when nothing is detected and nothing was
  manually added — two PRE-EXISTING tests in that file needed updating
  (they patched `classification.weeklyFixedTotal` directly without a real
  `fixed` array, a shortcut that stopped reflecting reality once
  `buildCashFlowForecast()` started reading the merged per-charge list
  instead of that pre-computed total). Full suite: 118 suites / 3,026
  tests pass (+37 new); `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (6 new `cashFlowScreen.*` keys — es/ru/tr/hi/ar fully
  translated, uk as an untranslated English copy per invariant #11;
  "Insurance—Truck" kept as a literal example placeholder in every locale,
  matching this app's own "domain category names stay English" convention).
  `docs/PENDING_SQL.md` §66 (`profiles.cf_recurring_charges jsonb`,
  mirrored as `pending_66.sql` at the repo root) is **NOT YET APPLIED** —
  `supabase/functions/reset-data/index.ts` was updated to clear this new
  column on Reset All Data and needs redeploying once §66 has actually
  been run; no other Edge Function was touched. Every other change in
  this pass is pure client-side JS/TS and ships via a normal `eas update`
  regardless of whether §66 has been run yet (the client degrades
  gracefully either way, per its own `?? {}` fallback).

- CASH FLOW CLASSIFIER — STILL $0 ON REAL DATA, THE ACTUAL CAUSE (owner
  decision, device report immediately following the threshold fix above:
  the classifier still detected nothing on the real account, even though
  the recurring-charges UI now renders). No SQL/Edge Function changes.
  **DIAGNOSIS (instrumented against realistic invoice-numbered
  descriptions, not the account's own literal rows — this environment
  has no way to read a real user's data, only the anon-key/RLS-blocked
  schema probe used for the two prior §65/§66 confirmations, which
  cannot return real rows — flagged honestly rather than silently
  assumed)**: item 2's own hypothesis (grouping by an unstable key, e.g.
  the raw description with an invoice number embedded) was checked
  directly and RULED OUT — `classifyCashFlowSpending()` has only ever
  grouped by `SpendEvent.category`, never by description, and
  `buildSpendEvents()` sets `category` from the deduction row's own
  `category` DB column, never from `description`. The REAL bug was one
  step further upstream, in what gets WRITTEN to that `category` column
  in the first place: `src/import/mapExtraction.ts`'s `mapSettlement()`
  resolves a withheld deduction's category via
  `classifySettlementLine(x.desc) || chargebackType-label || x.category
  || null` — and `classifySettlementLine()`'s own two regexes for
  exactly the categories named in the report had real, confirmed gaps:
  `ELD_COMMS_CHARGE_RE` matched ONLY Qualcomm/Geotab "RENTAL" phrasing or
  "navigation charge" — a plain, extremely common "ELD FEE"/"ELD CHARGE"
  line (which is what most real carrier statements actually print) never
  matched at all; `FED_HWY_TAX_RE` matched "permit(s)"/"license(s)"
  literally or "fed hwy tax," but never "IRP" (International Registration
  Plan) — the single most common abbreviation a real carrier settlement
  prints for a plate-registration withholding, and one the codebase's
  OWN OTHER, more general `guessCategory()` function (used for imported
  documents, a different context) already recognized correctly
  (`/permit|licensing|...|irp|ucr\b|hvut|form 2290|.../`) — a real,
  confirmed inconsistency between the two functions, not a guess. Proven
  directly: a realistic 6-week dataset of `MAYFR BT/DH INS A623338`-style
  invoice-numbered withheld deduction lines, run through the ACTUAL
  `classifySettlementLine()` (not a shortcut that hands the classifier a
  pre-decided category), classified Insurance—Truck correctly on every
  row (its own regex already covers "BT/DH INS") but returned `null` for
  every IRP and ELD row before this fix — confirming Insurance was never
  the problem, and Permits/ELD were.
  **THE FIX**: `src/import/category.ts`'s `FED_HWY_TAX_RE` gained
  `\birp\b|\bifta\b|\bhvut\b|form\s*2290|\b2290\b|\bucr\b`;
  `ELD_COMMS_CHARGE_RE` gained `\beld\b|communications?\s*charge|\belog\b`
  — all universal industry/regulatory terms (IRP/IFTA/HVUT/2290/ELD are
  never one carrier's own invented terminology, matching this file's own
  existing "fair game for the generic classifier" rule for exactly this
  class of term), word-boundary-guarded the same way every other regex in
  this file already is. Re-run against the same realistic dataset: all
  three categories now resolve correctly and consistently.
  **WIRING VERIFIED END TO END** (item 3's own explicit ask — "a detected
  recurring charge that doesn't reach the total is its own bug"): a new
  test builds 6 settlement weeks through the REAL `mapSettlement()`
  (never a shortcut), feeds the resulting saved-shaped deduction rows
  through the REAL `buildCashFlowForecastFromData()` (the exact function
  the Cash Flow screen itself calls), and asserts `result.classification.
  fixed`, `result.fixedCharges` (the merged, screen-facing list), AND
  `result.weeklyFixed` (the actual dollar figure the forecast projects)
  all reflect the same three categories with the correct summed amount —
  proving detection, merging, AND the forecast total all agree, not just
  the classifier in isolation.
  **TESTS** (item 4, "a REALISTIC carrier dataset — descriptions with
  invoice numbers and slight amount variance, charges withheld in the
  settlement rather than paid out of pocket — not clean synthetic rows"):
  the new `cashFlowForecast.test.ts` test above is exactly this — every
  one of its 18 deduction rows is produced by the real `mapSettlement()`
  from `MAYFR ... A######`-style descriptions with a real invoice suffix
  per week, `source: 'settlement'` throughout, with the report's own
  $30.43/$30.43/$29.99 insurance variation. This is a genuinely different
  (and stronger) test than this pass's own prior "6-settlement dataset"
  coverage, which — confirmed by re-reading it — constructed `SpendEvent`
  objects with an explicit, pre-decided `category` field directly,
  bypassing `classifySettlementLine()` entirely; that gap is exactly why
  the earlier synthetic tests passed while the real account didn't, per
  the owner's own diagnosis. Full suite: 118 suites / 3,027 tests pass
  (+1 new end-to-end test; the category.ts regex widening needed no new
  unit tests of its own since the existing `category.test.ts`/
  `carrierCodes.test.ts` suites already re-passed clean against the wider
  patterns); `tsc --noEmit` clean. No SQL/Edge Function changes — every
  fix in this pass is pure client-side JS/TS (a text-classification regex
  and one new test). Ships via a normal `eas update`.
