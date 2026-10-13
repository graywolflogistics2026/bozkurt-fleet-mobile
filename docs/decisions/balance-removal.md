# Balance Removal

> Business-balance tracking removed (owner decision 2026-08-27, SIX-ITEM FINAL PASS item 1).
> UI and every client write path removed; columns/tables left inert and reversible.
> Server side: PENDING_SQL §72 (pending_72.sql) — status UNCONFIRMED; check query in docs/PENDING_SQL.md §72.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

  1. **REMOVE BUSINESS BALANCE TRACKING (binding owner decision — no
     longer a bug-fix target, a retired feature)**: the estimate has been
     a recurring drift/confusion source across §37/§38/§59/§60/§70 and
     both prior 2026-08-27 passes — the owner decided it adds no value
     over the owner's own real bank balance. Removed as a displayed/
     computed feature everywhere; every underlying column/table is left
     INERT (not dropped), fully reversible. Exhaustive grep-first audit
     (51 files hit on `business_balance|businessBalance|cf_bank_balance`)
     before touching anything.
     **UI removed**: Dashboard's `CashBalanceSlimCard` (`app/(tabs)/
     index.tsx`, deleted with its lone call site and the now-dead
     `useCapitalAccountSummary()` query on that screen); Capital
     Account's Business Balance card, "🔍 Verify Balance"/"🏦 Reconcile
     Balance" actions and both ModalSheets, `handleReconcileBalance()`
     (`app/(tabs)/more/capital-account.tsx`) — `src/stats/
     businessBalanceLedger.ts` and its test were deleted outright (zero
     other references after removal, confirmed by grep); Cash Flow's
     bank-balance input, `handleSaveBudget()`'s `cf_bank_balance` write,
     and the whole opening/closing-balance concept (`app/(tabs)/more/
     cash-flow.tsx`, `src/stats/cashFlowForecast.ts`, `src/stats/
     cashFlowMonthly.ts`) — the 30-day forecast and Monthly View now
     project income/fixed/variable/periodic/**net** per period with no
     running total at all; `CashFlowWeekProjection`/`CashFlowMonthProjection`
     dropped `openingBalance`/`closingBalance` in favor of a plain `net`
     field, `buildCashFlowForecast()`/`buildMonthlyCashFlowOverview()`
     dropped their `bankBalance`/`todayBalance` parameters entirely (the
     Monthly engine's old bidirectional balance-chaining walk — genuinely
     unnecessary once there's no balance to chain — collapsed to 12
     independent per-month computations, a real simplification, not just
     a deletion). "Tightest point"/`tightestWeekIndex`/
     `findTightestMonthIndex()` renamed `weakestWeekIndex`/
     `findTightestMonthIndex()` (kept name, redefined) to mean the
     WEAKEST-NET period, never a lowest-balance one — UI copy/badges
     renamed to match (`weakestBadge`/`monthWeakestBadge`/
     `weakestPointLine`/`weakestMonthLine`, `netLabel` replacing
     `endingBalanceLabel`/`openingBalanceLabel`).
     **Every write path neutralized** (not just hidden): `aiImportSave.ts`
     no longer calls `apply_settlement_business_balance_credit` on
     settlement import/re-import — `findExistingSettlement()`'s own
     return type/select dropped `business_balance_credit` entirely (now
     just `{id}`); `SaveExtractionResult.netPayAdded` was removed from the
     type/return/import-screen display (`importScreen.balanceAdded` i18n
     key deleted) rather than left permanently `null`. Onboarding's
     "Opening business balance" step (`app/onboarding.tsx`, was step 7 of
     9) was removed OUTRIGHT, not just its write — an unpersisted input
     would have been actively confusing — `STEP_COUNT` 9→8,
     `STEP_ACTIONS` and the `case 7`/`case 8` render switch renumbered,
     `isOptionalStep` corrected (`onboarding.steps.openingBalance.*`
     deleted from all 7 locales). `bank-statements.tsx`'s "Update Business
     Balance To…" checking-statement action and its dedicated
     `src/lib/confirmBusinessBalanceUpdate.ts` (fully orphaned, zero other
     references — deleted outright) were removed; the screen still shows
     the statement's own opening/closing figures, just doesn't write
     either into `profiles` anymore. `legacyImport/importLegacyBackup.ts`'s
     `updateBusinessBalance()` (writing a legacy backup's `bizBalance`
     into `profiles`) deleted, its caller's warning-push removed. Two
     smaller consumers found and fixed in the same audit:
     `aiCoachSummary.ts`'s `taxReserveShortfall` recommendation input
     (compared the quarterly tax payment against a now-permanently-frozen
     balance) hardcoded to `null` — disabled outright rather than left
     comparing against an increasingly-stale number, since
     `buildRecommendationCandidates()` already treats `null` as "don't
     offer this one"; `dailyTips.ts`'s `detectTipCapitalAccount()` dropped
     its `businessBalance` OR-condition, keeping `initialCapital` alone
     (a real, live, still-correctly-computed contributions figure) as the
     trigger. `reset-data`'s existing `business_balance: 0` reset line and
     `backupSnapshot.ts`'s read-only export of the column were
     deliberately left as-is — harmless (an inert-column reset; a backup
     naturally still exports whatever's on file).
     **New PENDING_SQL §72, NOT YET APPLIED** (mirrored as `pending_72.sql`
     at the repo root): drops the §70 `AFTER DELETE` reversal trigger on
     `settlements` (function definition left intact — restoring is a
     straight copy-paste of §70's own `CREATE TRIGGER` statement) — needed
     because an OLD settlement row still carrying a pre-this-pass
     `business_balance_credit` value would otherwise still decrement
     `business_balance` on delete even though nothing writes that credit
     anymore; and `CREATE OR REPLACE`s the three §60 manual-capital-
     transaction RPCs (`record_manual_capital_transaction`/
     `update_manual_capital_transaction`/`delete_manual_capital_transaction`)
     to drop their balance-delta application while keeping the
     `capital_transactions` row write byte-identical — `business_balance_applied`
     now always written as `0` (informational-only column, nothing reads
     it anymore; `0` is the honest value). **Confirmed unaffected**:
     Capital Account's contributions/draws/reimbursements/four-flow
     summary/Net Position/tax-free-remaining — `calcCapitalAccount()`/
     `summarizeCapitalFlows()` compute directly from `capital_transactions`
     rows + `profiles.initial_capital`, never from `business_balance`
     (re-verified by reading both functions fresh, not assumed). Client
     code ships independently via `eas update` — the RPCs would just also
     silently apply a now-invisible delta server-side until §72 lands,
     harmless since nothing reads it.
     Tests: `aiImportSave.settlement.test.ts`'s balance-delta tests
     rewritten to prove `profiles.business_balance` is NEVER touched by a
     new import, a corrected re-import, a negative-net-pay week, a RETRY,
     or a delete (previously proved a delta was applied correctly — now
     proves no delta is applied at all);
     `aiImportSave.negativeSettlement.test.ts` likewise;
     `aiImportSave.errorReporting.test.ts`'s balance-RPC-failure test
     replaced with one proving a settlement save completes successfully
     even with that (now-unreachable) RPC configured to fail — the
     positive-space proof that the call is genuinely never made, not just
     that failing it produces no error; `cashFlowForecast.test.ts`/
     `cashFlowMonthly.test.ts` rewritten around `net` instead of opening/
     closing balances, including a dedicated "months are independent, no
     shared chain" test replacing the old balance-chaining suite;
     `missingDataNudges.test.ts`/`dailyTips.test.ts` updated for the
     dropped `cfBankBalance`/`businessBalance` fields. Full suite re-run
     clean after every edit in this item (128 suites / 3,496 tests, see
     the pass-level summary above).
