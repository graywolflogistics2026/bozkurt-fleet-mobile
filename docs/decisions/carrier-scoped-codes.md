# Carrier Scoped Codes

> Carrier codes mean something only at the issuing carrier; maps apply only on a verified carrier match.
> Prime Inc is the only seeded carrier (`carrier_code_maps`, `docs/CARRIER_CODES.md`); unknown carriers use the generic classifier.
> Includes the known pre-existing gap and Prime's operating statement as verification source of truth.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- CARRIER-SCOPED PAYROLL/SETTLEMENT CODES — HARD INVARIANT (owner
  decision, docs/PENDING_SQL.md §52, ✅ APPLIED 2026-08-24; ai-import
  redeployed, client update published to preview). A two-letter carrier
  settlement/payroll chargeback
  code (e.g. "DH", "BT", "AP") means what it means AT THE CARRIER THAT
  ISSUED THE STATEMENT ONLY — never applied globally, never guessed from
  the user's profile, a prior import, or any other carrier's own
  documents. This binds every current AND future code-classification
  surface in this app; a code map is applied only when the carrier
  actually, verifiably matches, and an unmatched/unknown carrier always
  falls back to the generic, carrier-agnostic description-based
  classifier — never to another carrier's code meanings.
  DATA MODEL: `carrier_code_maps` (global reference data, one row per
  carrier+code, admin-maintained — same "everyone reads, only
  service_role writes" pattern as `tax_year_data`/`ai_usage_config`) —
  seeded with PRIME INC's full 205-code list this pass, reconciled by
  hand from an owner-provided reference sheet (`docs/CARRIER_CODES.md` is
  the human-readable mirror, including the handful of rows flagged
  "verify against Prime documentation" where the source scan was
  genuinely unclear — marked `category: null` rather than guessed, per
  the spec's own "where ambiguous, leave it to the description classifier
  rather than guessing"). Every OTHER carrier starts with ZERO seeded
  rows. `settlements.carrier` persists the AI's own extracted carrier
  text verbatim (new this pass — previously extracted but never stored).
  `category_learning_rules.carrier` (nullable — null = universal, the
  only kind that existed before this column, applies regardless of
  carrier; a real value scopes a rule to that one carrier only) extends
  the existing correction-learning layer the same way.
  CLASSIFICATION PIPELINE, ORDER MATTERS (`app/src/data/aiImportSave.ts`,
  right before a settlement's deductions are saved): (1)
  `applyCarrierCodeCategories()` (`app/src/import/carrierCodes.ts`) —
  carrier-scoped by construction, using the settlement's OWN just-
  extracted `carrier` field (normalized via `normalizeCarrierKey()`),
  never a guess; (2) `classifySettlementLine()` (`category.ts`, already
  applied inside `mapSettlement()`) — the generic, carrier-agnostic
  fallback; (3) the AI's own `chargebackType`; (4) the raw `category`
  string; (5) `applyLearnedCategories()` (also carrier-scoped now) — the
  user's own explicit, repeated correction always wins over every
  automatic step before it. `findCarrierCodeMatch()` filters to the
  matching carrier's own rows FIRST, before any text matching — a code
  fragment that happens to coincide with a DIFFERENT carrier's code can
  structurally never match (proven directly: `carrierCodes.test.ts`'s own
  fixture reuses the literal code "DH" under two different carriers with
  two different meanings, and proves each carrier only ever resolves its
  own).
  PROMPT-SIDE HANDLING, AN HONEST TRADEOFF: `ai-import` makes a SINGLE
  Anthropic call per document (this app's established architecture,
  reinforced by the recent cost-control/usage-limit work) — the carrier
  itself isn't known until AFTER extraction, so "pass ONLY the matching
  carrier's map into the prompt" literally isn't possible before a first
  call completes. Resolved by passing EVERY seeded carrier's own code map
  (today: just Prime) into the prompt, each wrapped in its own explicit
  "ONLY IF you can confirm THIS carrier from the document's own
  letterhead — otherwise ignore this list entirely" instruction
  (`buildCarrierCodePromptBlock()`, mirrored inline in
  `ai-import/index.ts`'s `buildExtractionPrompt()`, forwarded by the
  client via a new `carrierCodeMaps` request-body field,
  `app/src/data/carrierCodeMaps.ts`'s `useCarrierCodeMaps()`). This is a
  soft hint the model may or may not follow correctly — the REAL isolation
  guarantee is the deterministic step (1) above, which only ever looks at
  the settlement's own actually-extracted carrier text, never what the
  model claims to have used.
  KNOWN PRE-EXISTING GAP, NOT retroactively fixed this pass (flagged, not
  silently ignored): `category.ts`'s `classifySettlementLine()` — the
  generic, carrier-agnostic fallback in step (2) above — already embeds
  several regexes derived FROM Prime's own chargeback code text
  ("EXTEND WR PURCH", "ACCOUNTING SERV", "QUAL RENTAL"/"GEO RENTAL", "EZ
  FAST LN", "COMPANY STORE", "WIRE CHARGE", "STATEMENT PREPARATION",
  "PRIME POINT-OF-SALE", from the FULL PARITY pass's own SETTLEMENT-LINE
  CLASSIFIER work) and applies them to EVERY carrier's settlement, not
  just Prime's — the exact class of bug this new invariant exists to
  prevent going forward, just predating the invariant itself. The
  `ai-import` extraction prompt's own line ~345 "APPROVED ADDITION
  (settlement-line classifier + new categories...)" block has the
  identical issue in prompt form. Both were left AS-IS this pass
  (rewriting a "battle-tuned" prompt block and a widely-exercised regex
  classifier carries real regression risk for zero pressing benefit today
  — nothing currently seeds a second carrier to actually collide with
  Prime's own codes) — a genuine v1.x follow-up if/when a second carrier
  is seeded with overlapping code text, not a silent gap.
  SCOPE DECISION: `app/(tabs)/more/accountant-package.tsx`'s own learn-
  correction call site stays UNIVERSAL-ONLY (no carrier ever attached) —
  its `LineItem` type (`src/stats/accountantPackage.ts`) is a flattened,
  source-agnostic reporting row with no `settlement_id` to trace a
  carrier from, unlike `deductions.tsx`'s own edit-save handler (which
  DOES look the carrier up via `fetchCarrierForDeduction()` — a real,
  wired lookup, not a stub) — extending `LineItem` to carry this would be
  its own, separate scope, not attempted this pass.
  DELIVERABLES: 92 suites / 2213 tests pass (carrierCodes.test.ts's own
  17 tests directly prove the 3 explicitly-required scenarios: the same
  code "DH" resolves differently under two carriers, an unknown/unmatched
  carrier falls back to null — never a guess, and a description
  containing a Prime code/label fragment never matches under a different
  carrier); `tsc --noEmit` clean. `ai-import` was modified (new
  `carrierCodeMaps` prompt block) and has been redeployed; `ai-advisor`/
  `reset-data`/`delete-account` were NOT touched. No native rebuild
  needed — pure JS/TS plus SQL/Edge Function work, no new native
  dependency, shipped via a normal `eas update`, published to preview. No
  i18n changes this pass (no new user-facing strings — the carrier code
  map is prompt-context and internal classification data, never rendered
  directly to a user).

- CARRIER-SCOPED PAYROLL/SETTLEMENT CODES — KNOWN PRE-EXISTING GAP,
  RESOLVED (owner decision 2026-08-24, cleanup follow-up to the pass
  above): the gap flagged immediately above — Prime-derived code
  fragments baked into the GLOBAL, carrier-agnostic path — is now fixed.
  `category.ts`'s `classifySettlementLine()` no longer contains any
  carrier-specific code TEXT; the `ai-import` prompt's own "settlement-
  line classifier" block had its equivalent carrier-specific sentence
  removed too (its generic six-new-categories description and its two
  trailing generic sentences — shop-invoice-with-labor, split parts-vs-
  tools — both stayed, since neither names any carrier's own code).
  MOVED into `carrier_code_maps`, scoped to `'PRIME INC'`
  (docs/PENDING_SQL.md §53, docs/CARRIER_CODES.md's new "real-world text
  bridges" sub-table): "EXTEND WR PURCH", "ACCOUNTING SERV" (abbreviated),
  "EZ FAST LN", "WIRE CHARGE", "FUEL CARD CHARGE", "TRIP XPRESS",
  "STATEMENT PREPARATION", "PRIME POINT-OF-SALE" (hyphenated) — 8 new
  bridge rows, needed because `findCarrierCodeMatch()` only matches a
  literal word-boundary substring in one direction, and each of these
  real-world-observed text forms doesn't exactly match the spelling of
  its corresponding §52 reference-sheet row (e.g. "EZ FAST LN" vs. the
  seeded label "EZ FAST LN TOLL"). Two fragments needed NO new row: "IMAGE
  TRIPS" already exact-matches the seeded `IM`/`FDEX 02` row's own label,
  and "ADV FOR OUTSIDE LUMPER" already matches the seeded `LM`/`LMPR` row's
  label "OUTSIDE LUMPER" as a literal substring (and separately, the
  generic classifier's own bare "lumper" rule — see below — catches it for
  any carrier regardless).
  KEPT GENERIC, a judgment call diverging from the prior pass's own
  informal "flagged" list — stated plainly here rather than silently
  decided: `FED_HWY_TAX_RE` ("FED HWY TAX" — the abbreviated form of a
  real, universal IRS tax name, not a Prime-invented term), the
  `ELD_COMMS_CHARGE_RE` fragments "QUAL RENTAL"/"GEO RENTAL"/"NAVIGATION
  CHARGE" (Qualcomm and Geotab are real third-party ELD/telematics vendor
  brand names many carriers could plausibly reference in their own
  words), and `COMPANY_STORE_RE` ("COMPANY STORE" — a common, industry-
  wide trucking concept, not unique Prime terminology) — despite the
  prior pass's own note having named all three among the "flagged"
  fragments. `WARRANTY_SERVICE_RE`/`isLumperFee()`'s `LUMPER_FEE_RE`/
  `ACCOUNTING_SERVICE_RE`/`TOLLS_SCALES_CHARGE_RE`/
  `BANK_MERCHANT_CHARGE_RE` all kept their spelled-out generic wording
  (extended warranty/service contract, bare lumper, trust service/
  bookkeeping, PrePass/Drivewyze/scale/weigh station/EZPass, bank fee/
  wire fee/merchant fee/processing fee/card fee) and lost only their
  carrier-specific fragment. `STATEMENT_PREP_RE`/`CARRIER_POS_MEAL_RE`
  were deleted entirely (no safe generic remnant existed in either —
  "statement preparation" and a bare "point-of-sale" purchase are both
  Prime-specific enough that nothing generic was left to keep;
  `isRestaurantPurchase()` alone still covers the Meals fallback).
  NOTE: `isInsuranceChargeback()`'s own carrier-code-flavored fragments
  ("BT/DH INS", "PHY DAM", "OCCUP ACC", "CARGO", "WORKERS COMP" — added
  by the earlier CASH FLOW AUTO-FILL pass, a separate CLAUDE.md entry
  predating even the carrier-isolation invariant) were deliberately left
  untouched — out of scope for this specific cleanup, which targeted only
  what the prior pass's own "KNOWN PRE-EXISTING GAP" note named; flagged
  here as a separate, later candidate for the same treatment, not
  silently ignored.
  DELIVERABLES: 92 suites / 2215 tests pass (`category.test.ts` gained a
  dedicated CARRIER ISOLATION test proving none of the 9 carrier-specific
  fragments resolve through `classifySettlementLine()` anymore, plus a
  paired test proving the identical text DOES resolve once scoped to
  `'PRIME INC'` via `findCarrierCodeMatch()` and does NOT resolve under a
  different carrier — proving the behavior moved, not vanished); `tsc
  --noEmit` clean. `ai-import` was modified (prompt text only, no
  behavior/schema change) and has been redeployed; `ai-advisor`/
  `reset-data`/`delete-account` were NOT touched. No native rebuild
  needed — pure JS/TS/SQL/prompt-text work, no new native dependency,
  shipped via a normal `eas update`, published to preview. No i18n
  changes (no new user-facing strings). docs/PENDING_SQL.md §53 (8 new
  `carrier_code_maps` rows) is ✅ APPLIED.

- USE PRIME'S OPERATING STATEMENT AS THE VERIFICATION SOURCE OF TRUTH
  (owner decision, 2026-08-28). Prime Inc's own settlement statements
  routinely include a Perryman & Associates operating-statement page
  (docs/CARRIER_CODES.md's own "AS/ACCOUNTING SERVICE" chargeback row is
  literally the cost of this page: "Cost of using Perryman & Associates &
  includes the cost of the operating statement") — the carrier's OWN
  verified weekly/YTD/LTD revenue, miles, and expenses, which this app's
  own extraction is now cross-checked against, never the reverse.
  **CARRIER ISOLATION, the hard invariant this whole feature is gated
  behind**: every function in `app/src/import/primeOperatingStatement.ts`
  re-checks the carrier ITSELF (never trusts a caller to have
  pre-filtered) via `isPrimeCarrier()` (`normalizeCarrierKey()` against
  the literal `'PRIME INC'` key `carrier_code_maps` is already seeded
  with, CLAUDE.md's own CARRIER-SCOPED PAYROLL/SETTLEMENT CODES
  invariant #52) — a non-Prime or unrecognized carrier (Landstar,
  Schneider, Werner, empty, anything else) makes every exported function
  a silent no-op: no mismatch flagged, no YTD check, nothing extracted,
  falling back to exactly today's behavior. Proven by
  `src/import/__tests__/primeOperatingStatement.test.ts`'s own "CARRIER
  ISOLATION" block, mirroring `carrierCodes.test.ts`'s existing "Prime
  codes never leak" test — a deliberately mismatched operating-statement
  fixture that WOULD flag all 3 fields under Prime is proven to trigger
  NOTHING under Landstar/Schneider/Werner/empty/undefined/null, and a
  fictitious "Prime Logistics Partners" (a substring match, not an exact
  one) is proven not to count as Prime either.
  **HONEST LIMITATION, stated plainly**: this was built with NO real
  Prime settlement PDF available in this sandbox to inspect. The field
  inventory is inferred from (a) `docs/CARRIER_CODES.md`'s own real
  chargeback vocabulary, which confirms the page's existence and that
  Perryman & Associates prepares it, and (b) this app's own pre-existing
  (previously completely unused — grepped, zero callers anywhere)
  `settlement.operating` extraction field, which already had
  `ytdRevenue`/`ytdExpenses`/`ytdNet`/`weeksInService` from an earlier
  pass — this pass only WIDENED it (`weekRevenue`/`weekMiles`/
  `weekExpenses`/`weekNet`, `ytdMiles`, `ltdRevenue`/`ltdMiles`) rather
  than inventing a parallel schema. Deliberately did NOT attempt a
  category-by-category expense breakdown cross-check — there is no way
  to confirm, without a real document, whether Prime's operating
  statement breaks expenses into named categories at all (as opposed to
  one summary total), or whether any such breakdown would even use this
  app's own `CANONICAL_CATEGORIES` vocabulary; inventing that mapping
  would be exactly the "add categories unilaterally" mistake the owner's
  own instruction warned against, so this is reported as a known
  limitation rather than silently worked around. Scoped instead to the
  four figures any operating statement of this kind virtually certainly
  reports: revenue, miles, total expenses, net.
  **Extraction, carrier-gated the identical "ONLY IF confirmed" way the
  existing carrier-code prompt block already uses**:
  `supabase/functions/ai-import/index.ts`'s settlement JSON schema
  widened `operating`'s object literal; a new, HARD-CODED-to-"Prime Inc"
  prompt instruction (deliberately separate from the `carrierCodeMaps`-
  driven block above it, so seeding a second carrier's own code map
  later can never accidentally also trigger Prime-shaped
  operating-statement expectations against it) tells the model to
  populate `settlement.operating` from the weekly/YTD/LTD columns of a
  Perryman & Associates-style page ONLY when the document's own
  letterhead confirms Prime Inc, and to leave it entirely at its zero/
  empty defaults otherwise — never estimated or reconstructed from
  elsewhere in the document. `app/src/import/types.ts`'s
  `ExtractedSettlement.operating` gained the matching TypeScript shape
  (previously extracted server-side into a loose
  `Record<string, unknown>` in `chunking.ts` but never even typed on the
  client, confirmed via grep to have zero client-side readers before
  this pass).
  **Item 2 — per-settlement cross-check**:
  `checkPrimeOperatingStatementWeekly()`/`applyPrimeOperatingStatementCheck()`
  are pure, extraction-only functions (no account/DB data needed) wired
  into `app/src/data/aiImportCall.ts`'s existing sanitize-guard chain —
  a new `sanitizeExtraction()` composes
  `applyPrimeOperatingStatementCheck(sanitizeExtractionMiles(sanitizeExtractionDates(extraction)))`,
  applied at both of that file's existing call sites (the terminal
  result and the in-progress partial preview), same placement convention
  `milesGuard.ts`'s `sanitizeExtractionMiles()` already established. A
  mismatch beyond tolerance downgrades `confidence` to `'low'` — the
  EXISTING needs-review machinery (`src/import/needsReview.ts`, CLAUDE.md
  invariant #14) is what actually surfaces it, never a second, parallel
  review mechanism. Tolerance: **$1 for dollar figures**, reusing
  `settlementReconciliation.ts`'s own established rounding-tolerance
  precedent rather than inventing a new one; **1 mile** for mileage
  (no cent-level rounding risk the way dollars have — a genuine
  discrepancy is virtually always tens of miles or more). A
  present-but-zero operating-statement figure is treated as "not
  actually printed" (never compared against, since the prompt tells the
  model to leave an unseen field at its default) rather than a real
  $0/0-mile claim to reconcile against.
  **Item 3 — standing YTD reconciliation**: `checkPrimeYtdReconciliation()`
  compares THIS app's own YTD (computed via the SAME canonical
  `computeKpis()` every other screen already uses — never a second
  calculation) against the YTD figures Prime's own MOST RECENT operating
  statement reported. `readPrimeYtdSnapshotFromParsedJson()`/
  `findMostRecentPrimeYtdSnapshot()` read this straight out of
  `documents.parsed_json` — **no new column or table needed at all**,
  since `parsed_json` already stores the FULL raw extraction verbatim
  (CLAUDE.md's own D3 audit-trail invariant, invariant #14) — the widened
  `operating` field is already persisted there automatically for any
  Prime settlement the instant it's extracted, confirmed by reading
  `aiImportSave.ts`'s own document-insert (`parsed_json: d`, the whole
  extraction object). Tolerance for YTD is deliberately LOOSER than the
  per-week check: 0.5% of Prime's own reported YTD figure, floored at
  $25/25 miles — a YTD total accumulates many weeks' worth of Prime's own
  rounding, so the flat $1/1-mile weekly tolerance would flag spurious
  noise on almost every real account; a genuinely missing/duplicated week
  is virtually always far outside this looser band. Wired into
  `app/(tabs)/more/settlements.tsx` as a new orange-bordered banner card
  (shown only when a mismatch exists) reading "Your year-to-date revenue
  here is $X; Prime's own statement says $Y — worth checking" per field —
  purely informational, NEVER overrides this app's own stored figures,
  never blocks a save. **Scope decision**: deliberately computed from
  fleet-wide data (never the screen's own truck-scoped
  `settlementsQuery`) and only rendered when the current view is
  genuinely fleet-wide (`isAllTrucks`, or a single-truck account where
  "all trucks" and "the one truck" are the same set) — Prime's own
  operating statement covers the whole leased operator's business, not
  one truck within it, so comparing it against a narrowed, single-truck
  view would be a real apples-to-oranges mismatch, not a genuine
  reconciliation.
  **Item 4 — category coverage, reported not implemented**: given the
  honest limitation above (no confirmed category-level breakdown exists
  to check against), no new category was added this pass. If a real
  Prime operating statement is later confirmed to break expenses into
  named categories, that mapping should be verified against an actual
  document before any category is added — not inferred from
  `docs/CARRIER_CODES.md`'s own settlement-line chargeback-code table,
  which is a DIFFERENT section of the statement (the itemized
  deductions) already fully covered by the existing
  `carrier_code_maps`/`classifySettlementLine()` machinery.
  **Tests**: `src/import/__tests__/primeOperatingStatement.test.ts` (new,
  37 tests) — a realistic Prime-vocabulary layout reconciling cleanly
  (including within-tolerance and zero-field-skip cases); the artificial
  mismatch case for each of revenue/miles/expenses individually and
  combined, proving `confidence` downgrades to `'low'` while the
  underlying figures themselves are left untouched (informational only);
  the standing YTD check triggering/not-triggering correctly, including
  a zero-value Prime field never being compared against;
  `readPrimeYtdSnapshotFromParsedJson()`'s own defense-in-depth carrier
  re-check; `findMostRecentPrimeYtdSnapshot()` picking the latest
  qualifying settlement and correctly skipping a newer Prime settlement
  that lacks operating data in favor of an older one that has it; and
  the full carrier-isolation block described above. Full suite: 130
  suites / 3537 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (5 new `settlementsScreen.primeYtd*` keys — es/ru/tr/hi/ar
  fully translated, "Prime" kept as the literal carrier name — a proper
  noun, never translated — in every locale, "YTD" deliberately spelled
  out as "year-to-date" in the English source string rather than left as
  a bare, non-glossary-listed acronym, matching this app's own
  established RPM/CPM-style "spell it out per language" precedent; uk as
  an untranslated English copy per invariant #11).
  **Deliverables**: `supabase/functions/ai-import/index.ts` was modified
  (the widened `operating` schema literal + the new Prime-only prompt
  block) and **needs redeploying**; `ai-advisor`/`reset-data`/
  `delete-account`/`referral-sync` were NOT touched. No new
  `docs/PENDING_SQL.md` section — this feature needed zero new columns
  or tables, entirely built from already-extracted/computed data (see
  item 3 above). No new native dependency — pure client-side JS/TS plus
  one Edge Function prompt/schema change — ships via a normal
  `eas update` once the Edge Function above has been redeployed.
