# Accounting Model

> Two layers, never conflated: source of record (row origin via `source` + `settlement_id`) vs general ledger (grand totals).
> Grand totals never filter by source; only the settlement-linked fuel double-count guard excludes rows.
> Owner decision 2026-08-28; audit found the model already correct except one fixed bug.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- ACCOUNTING MODEL — TWO LAYERS, NEVER CONFLATED (owner decision
  2026-08-28, verification pass following the Prime operating-statement
  reconciliation work above). The owner stated a binding sub-ledger/
  general-ledger rule and asked for it to be audited end to end, not
  built from scratch — this entry records what was CONFIRMED already
  correct vs. the one real bug found and fixed.
  **LAYER 1 (source of record) — schema audit, item 1**: `deductions`
  already has both `settlement_id uuid references settlements on delete
  cascade` ("set for withheld items") and `source text default 'manual'
  check (source in ('settlement','import','manual'))` (`docs/SCHEMA.sql`);
  `maintenance_records`/`tolls` gained the equivalent `settlement_id` +
  `source` pair in §61 (confirmed live — `docs/SCHEMA.sql` itself is a
  static baseline that was never updated to reflect §61's columns, a
  pre-existing, harmless documentation gap noted here rather than fixed,
  out of this pass's scope; the live TS types in `app/src/types/db.ts`
  and the actual migration in §61 both confirm the columns are real).
  **No new column/migration was needed** — the carrier distinction the
  owner asked about ("Prime settlement" vs. some other carrier's
  settlement) already lives at the SETTLEMENT level (`settlements.
  carrier`, checked via `isPrimeCarrier()`/`findCarrierCodeMatch()`'s
  established carrier-isolation gate) and every child row inherits it
  transitively via `settlement_id` — a second `source` value like
  `'prime_settlement'` would be redundant with `source==='settlement'` +
  a `settlement_id` pointing at a carrier-confirmed-Prime row, and would
  invite the two ever drifting apart. **Structural finding, stated
  honestly**: the owner's own framing named "any out-of-pocket line
  documented WITHIN a Prime settlement" as part of the Prime sub-ledger —
  traced `app/src/import/mapExtraction.ts`'s `mapSettlement()` end to end
  and confirmed this case does NOT currently exist in the data model:
  every deduction/maintenance/toll row it produces from a settlement's
  own extraction is UNCONDITIONALLY stamped `source: 'settlement'`
  (deductions additionally get `payment_method: 'Settlement Withheld'`,
  `tax_deductible: false`) — there is no code path that produces an
  out-of-pocket-shaped row from settlement extraction today. This doesn't
  change the model's correctness (an out-of-pocket line, if this ever
  changes, would simply need its own mapper decision at that time), just
  narrows what "the Prime sub-ledger" concretely contains right now:
  settlement revenue + settlement-withheld deductions/maintenance/tolls,
  full stop.
  **LAYER 2 (general ledger) — item 2, audited, already correct, no fix
  needed**: traced `computeKpis()` (`src/stats/kpi.ts`), `sumCanonicalExpenses()`/
  `calcTrueProfit()`/`buildWeeklyTrueProfitTrend()` (`src/stats/
  trueProfit.ts`), and `buildProfitAnalysis()` (`src/stats/
  profitAnalysis.ts`) — none of them filter by `source` when computing a
  GRAND total; `reducesTrueProfit()` returns `true` for `source ===
  'settlement'` unconditionally AND for every other row via
  `isDeductibleExpense()` (excluding only the three established non-
  expense categories — Meals/Advance Repayment/Escrow & Deposits, which
  apply regardless of source). The one existing exclusion —
  settlement-linked `fuel_purchases` rows skipped in
  `sumCanonicalExpenses()` — is a DOUBLE-COUNT GUARD (the same physical
  fuel cost already has its own withheld-deduction line), not a
  sub-ledger exclusion, and was left untouched. Confirmed Dashboard
  (`app/(tabs)/index.tsx`), Scorecard, and AI Coach
  (`src/data/aiCoachSummary.ts` → `buildWeeklyTrueProfitTrend()`) all
  route through these same canonical functions. One legitimate, deliberate
  nuance flagged (not a bug): AI Coach's own weekly figures are anchored
  to `settlements`' own `week_ending` values, so a zero-settlement period
  correctly shows "no data" there rather than a dollar figure — a
  different, still-correct answer from Profit Analysis/Dashboard's
  period-based $0-revenue-nonzero-expense case, not a disagreement.
  **THE ONE REAL BUG FOUND AND FIXED, item 3** — the standing YTD
  reconciliation (`app/(tabs)/more/settlements.tsx`'s `primeYtdMismatches`
  memo, built in the immediately-preceding Prime operating-statement pass)
  computed its own `ours` input from `dedQuery.data ?? []`/
  `fuelQuery.data ?? []`/etc. — the FULL, unfiltered account-wide dataset,
  including every manually-added deduction. Since `checkPrimeYtdReconciliation()`
  itself was already correctly designed to take a pre-computed `ours` and
  never re-derive it (`src/import/primeOperatingStatement.ts`'s own header
  comment already said as much), the bug was entirely at this ONE call
  site: a user with real, unrelated manual receipts on the books would
  see `ours.expenses` inflated above what Prime's own YTD statement
  reports, risking a false "your numbers don't match Prime's" banner
  purely because of entries Prime never saw. Fixed with a new exported
  `filterToPrimeSettlementSubledger()` (`primeOperatingStatement.ts`) —
  reduces a raw settlements+deductions+fuel+maintenance+tolls dataset down
  to ONLY the rows that trace back to a `carrier`-confirmed-Prime
  settlement (via `settlement_id`, never a `source` check alone, so a
  hypothetical future non-Prime carrier's own settlement-derived rows
  would also be correctly excluded) — wired into `settlements.tsx`'s
  memo, which now scopes its `computeKpis()` call through this filter
  before ever computing `ours`.
  **Item 4 — settlement delete leaves manual rows untouched**: confirmed
  structurally correct by construction (a manually-added deduction's
  `settlement_id` is always `null` — `mapPurchase()`/`mapGenericDeduction()`
  never set it, confirmed by reading `mapExtraction.ts` directly — and
  Postgres's `on delete cascade` can never match a null FK value against
  any specific deleted parent id) and now PROVEN, not just asserted, by a
  new test in `src/data/__tests__/settlementDeletion.test.ts`: a manually-
  added $1,372.98 deduction (the owner's own reported figure) survives a
  settlement delete byte-identical while that settlement's own withheld
  deduction is removed.
  Tests: `src/import/__tests__/primeOperatingStatement.test.ts` gained a
  new `filterToPrimeSettlementSubledger` describe block — excludes a
  manually-added row, excludes a different carrier's settlement-linked
  row, and (the literal proof of the bug+fix) a dedicated test that
  reconciles a Prime settlement cleanly on its own, then proves adding an
  unrelated $500 manual deduction to the same account leaves the
  filtered-and-scoped reconciliation result byte-identical — with a
  direct CONTRAST case showing the OLD unfiltered approach would have
  wrongly inflated `expenses.total` to $1,200 and flagged a real mismatch
  against Prime's own reported $700. `src/data/__tests__/
  settlementDeletion.test.ts` gained the item-4 proof described above.
  Full suite: 130 suites / 3541 tests pass; `tsc --noEmit` clean. No new
  `docs/PENDING_SQL.md` section — item 1's audit confirmed the existing
  schema already fully supports this model. No Edge Function was touched
  — this is a pure client-side verification+fix pass; no redeploy needed
  for `ai-import`/`ai-advisor`/`reset-data`/`delete-account`/
  `referral-sync`. No new i18n strings. No new native dependency — ships
  via a normal `eas update`.
