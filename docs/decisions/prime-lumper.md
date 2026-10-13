# Prime Lumper

> Lumper payments on the "For Prime Inc Drivers" report (owner decisions 2026-09-19 onward).
> Prime settlement-withheld lumper lines are shown read-only under Lumpers: the one exception to the origin rule.
> Plus the permanent manual-entry path for lumpers.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- LUMPER PAYMENTS MISSING FROM THE REPORT (owner decision 2026-09-19). No
  new PENDING_SQL section — every write in this fix goes through columns
  §74/§75 already added.
  **DIAGNOSIS (traced end to end before any fix, per the owner's own
  explicit ask)**: the mapping table (Lumper Fees -> Lumpers), the origin
  rule (`isEligibleForAccountantReport()`), the historical backfill
  (`findAccountantCategoryBackfillCandidates()`), the report screen's own
  filter (`eligibleDeductionRowsForReport()`), and `classifySettlementLine()`'s
  own lumper-first ordering (a lumper-shaped ADVANCE line resolves to
  category 'Lumper Fees', never 'Advance Repayment', even before this
  pass) were ALL already correct for a genuine out-of-pocket `deductions`
  row — none of the user's own three hypotheses (H1 origin-tag error, H2
  category-name mismatch, H3 stale backfill) held up against a direct
  code trace. The CONFIRMED, actionable root cause instead: a lumper fee
  the driver pays personally at the dock, then gets reimbursed for
  through a settlement's own `reimbursementItems` section, NEVER created
  a matching `deductions` row anywhere in this app at all — `reimbursements`
  (a completely separate table) has no category column, so the expense
  side of that transaction was invisible to this report (and, separately
  and more consequentially, to true profit/tax: the settlement's own
  printed net-pay figure already includes the reimbursement as a credit,
  so without a matching expense the driver's real cash outlay was never
  recognized anywhere in the app's own totals — an overstatement this
  same fix corrects). This environment has no live database access, so
  "specific row examples from the account" could not be produced by a
  remote query — instead, a real, on-device diagnostic was built (below)
  so the check runs against the user's own actual rows, the same "hand
  the user a live tool" pattern this codebase already uses for Verify
  Balance/Daily Tip Diagnostics.
  **THE FIX**: `mapExtraction.ts`'s `mapSettlement()` now scans
  `s.reimbursementItems` for anything matching the SAME shared, carrier-
  neutral `isLumperFee()` detector `classifySettlementLine()`/
  `guessCategory()` already use, and creates a companion `deductions` row
  for each — `category: 'Lumper Fees'`, `source: 'import'` (genuinely
  out-of-pocket, NEVER 'settlement', so the origin rule correctly
  includes it), `accountant_category` computed directly via
  `suggestAccountantCategory()` at construction time (never left waiting
  on a manual Auto-fill tap), `payment_method: null` (deliberately never
  guessed — CLAUDE.md invariant #2's personal-payment/capital-
  contribution confirmation flow must never fire off an assumption about
  how the driver paid), `truck_id`/`driver_id` matching the rest of the
  settlement's own rows, `tax_deductible: true`. Appended AFTER the
  withheld-deduction batch inside the same array, so
  `applyCarrierCodeCategories()`/`applyLearnedCategories()`
  (`aiImportSave.ts`, run on the WHOLE array right after `mapSettlement()`
  returns) apply uniformly with zero special-casing — neither function
  ever touches `source`, only `category`/`tax_deductible`, so the
  companion row's already-correct origin tag can never be silently
  overwritten. **A genuine re-import-duplication risk found and fixed in
  the same pass**: `aiImportSave.ts`'s re-import old-deduction-id capture
  query was scoped `.eq('source', 'settlement')` — harmless before this
  fix (every deduction with `settlement_id` set was ALWAYS
  `source==='settlement'`), but this new companion row breaks that
  assumption; without widening the filter, re-importing the same
  settlement would have silently created a brand-new duplicate lumper
  expense on every re-import, forever. `settlement_id` is exclusively
  ever assigned by this one code path, so dropping the `source` filter
  entirely (capturing every deduction tied to this settlement regardless
  of source) is provably safe — it can only ever be a withheld chargeback
  or a lumper companion, both freshly re-derived from the same extraction
  on every import and correctly replaced together.
  **HISTORICAL BACKFILL, for reimbursements saved before this fix
  existed**: `categoryMapping.ts`'s new `findLumperReimbursementGaps()`
  — since reimbursements and deductions have no direct link column, this
  is a deliberately conservative heuristic (same date + same amount means
  "already has a companion," explicitly checking only OUT-OF-POCKET
  existing deductions as a candidate companion — a settlement-withheld
  row sharing the same date/amount is a different transaction, never
  mistaken for the companion). Surfaced on the Prime Driver Expenses
  screen as a second, explicit, reviewable "🔄 Create N missing lumper
  expense entries from reimbursements" button, same non-destructive
  "Auto-fill" convention as the existing category backfill beside it —
  never silent, never automatic for historical data.
  **DIAGNOSTIC PANEL** (the "report the real cause with specific row
  examples" ask, satisfied the only way actually possible from this
  environment): `categoryMapping.ts`'s new `diagnoseLumperDeductions()`
  — every deduction that names a lumper (by category OR by description
  text, directly testing H2's own hypothesis) with its real source/
  category/accountant_category and a precise `reason`
  (`excluded_settlement_withheld` / `category_mismatch` /
  `missing_accountant_category` / `eligible`) — a collapsible "🔍
  Diagnose lumper payments" panel on the report screen shows every real
  row plus the reimbursement-gap count, so the user can see exactly why
  any given lumper payment is or isn't on the report, on their own
  device, against their own real data.
  Tests: `categoryMapping.test.ts` gained a `diagnoseLumperDeductions`
  block (H1/H2/H3 each individually reproduced and correctly
  distinguished by `reason`, a non-lumper row excluded from the diagnosis
  entirely, an advance-repaid non-lumper-worded line correctly untouched)
  and a `findLumperReimbursementGaps` block (a genuine gap, a non-lumper
  reimbursement never flagged, an existing out-of-pocket companion
  correctly suppresses the flag, a SETTLEMENT-WITHHELD row sharing the
  same date+amount is explicitly proven NOT to suppress it, idempotency,
  and the full mixed scenario — out-of-pocket/settlement-withheld/
  advance-repaid/gap all in one dataset). A new dedicated end-to-end
  test file, `aiImportSave.lumperReimbursement.test.ts`, proves the fix
  through the REAL `saveExtraction()`: a settlement with a plain
  settlement-withheld lumper deduction, an ADVANCE-shaped lumper
  deduction (both `source: 'settlement'`, both correctly excluded despite
  sharing category 'Lumper Fees'), and a lumper-named reimbursement — the
  companion deduction is created correctly (source/category/
  accountant_category/tax_deductible/payment_method all verified), the
  original reimbursement row is left untouched (additive, not a
  replacement), and feeding the real saved rows through the REAL
  `eligibleDeductionRowsForReport()` proves exactly one row — the
  genuine out-of-pocket companion — reaches the report; plus a
  non-lumper-reimbursement negative case and a RE-IMPORT case proving the
  companion is replaced, never duplicated, on a second import of the same
  settlement. A pre-existing fixture in
  `aiImportSave.settlementChildren.test.ts` already contained a
  lumper-worded reimbursement item (`{desc: 'Lumper fee', amount: 75}`) —
  its 3 affected assertions were updated to the new, correct numbers
  (deductions count 1→2, true profit 3800→3725, the SPREAD-ORDER AUDIT
  test's row now found by description rather than assumed at a fixed
  array index) rather than weakened, proving the fix through an
  ALREADY-EXISTING realistic fixture, not just a purpose-built one. Full
  suite: 137 suites / 3701 tests pass (+~30 new); `tsc --noEmit` clean;
  all 7 locales confirmed key-parity (12 new `primeDriverExpenses.*` keys
  — es/ru/tr/hi/ar fully translated, "lumper"/"settlement" kept in Latin
  script per the glossary in every translation, uk as an untranslated
  English copy per invariant #11; glossary test re-passed clean, 1668
  checks). No SQL/Edge Function changes — every fix in this pass is pure
  client-side JS/TS reading/writing columns §74/§75 already added. Ships
  via a normal `eas update`.

- PRIME LUMPER EXCEPTION ON "FOR PRIME INC DRIVERS" + PERMANENT MANUAL
  CONTROL (owner decision 2026-09-23, final after two same-day reversals —
  this entry supersedes both). Verified against the owner's real Prime
  settlement PDFs: Prime never puts a lumper in the Reimbursement section.
  It prints a REVENUE line `LM <order> OUTSIDE LUMPER` (not persisted) and
  a withheld DEDUCTION `WA <order> ADV FOR OUTSIDE LUMPER` (source=
  'settlement', ~$1–2.55 above the lumper itself: wire/Comchek fee).
  The owner's accountant can't read that structure, and this screen exists
  to translate Prime's format — so, for the LUMPERS category ONLY, on THIS
  report ONLY, for Prime settlements ONLY, the origin rule does not apply:
  eligibleDeductionRowsForReport() (src/stats/primeDriverExpenses.ts)
  shows every settlement-withheld lumper line (isWithheldLumperAdvance(),
  by category OR description) under Lumpers, read LIVE, origin
  'prime_settlement', READ-ONLY on the screen (no edit/delete: it is the
  real withheld row, and changing it would move true profit/tax). Excluded
  only when its settlement's recorded carrier is known and not Prime
  (nonPrimeSettlementIds(); a null carrier counts as Prime). NOTHING ELSE
  CHANGES: the row keeps source='settlement', tax_deductible=false, and
  never gets an accountant_category, so Deductions, KPIs, true profit, CPM,
  tax and the Accountant Package treat it exactly as before — proven in
  ONE test ("PRIME LUMPER EXCEPTION — on this report, invisible everywhere
  else") plus the existing canonical source audit. Every other accountant
  category keeps the strict origin rule (same test: a withheld wash and
  toll on the same settlement stay at $0). No double counting: a
  reimbursement-section lumper on a settlement that also withholds a
  lumper line gets no out-of-pocket companion (mapSettlement() and
  findLumperReimbursementGaps() both veto it), and the "add missing
  lumpers" banner never offers withheld rows (they're already shown).
  Out-of-pocket lumpers still reach the report via a manual/receipt Lumper
  Fees deduction, a reimbursement-only lumper (companion deduction), or
  manual Add Expense. Known gap: a Prime `LM OUTSIDE LUMPER` revenue line
  with no withheld advance is not detected (revenueItems are not persisted
  and no real example exists yet) — manual Add Expense covers it.
  GUARANTEES (same day, src/data/__tests__/aiImportSave.primeLumperReport.test.ts,
  real saveExtraction() end to end): (1) not month-specific — the screen
  passes the full unfiltered deductions list, and only
  buildPrimeDriverExpenseMonth() picks a month by ded_date (= week ending);
  (2) a new or back-dated import shows up in its own month with no extra
  step (the import screen's unscoped invalidateFinancialData() refetches
  deductions + settlements); (3) counted once — a same week+truck
  re-import replaces (saveExtraction()); the same document imported once
  with a truck and once "not truck-specific" (missed by the week+truck
  match) is deduped by the report, one-for-one on date + description +
  cents (two DIFFERENT trucks' identical lines are both kept); a
  reimbursement + withheld lumper on one settlement shows only the withheld
  line (import refuses the companion; the report also skips a companion
  saved by the Sep 19 build before that refusal existed). Also: a pure-JS year/month/day DatePickerField on the add and edit
  sheets (no native module, ships via EAS Update); deduction-sourced rows'
  date is editable from the report (writes deductions.ded_date, never a
  copy); the view jumps to the row's month after add/edit.
