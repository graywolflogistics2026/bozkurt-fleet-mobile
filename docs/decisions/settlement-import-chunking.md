# Settlement Import Chunking

> Multi-page settlement extraction: chunking rounds 1-5 (owner decisions 2026-08-02 to 2026-08-04).
> Ended with single call as the default, based on measured evidence.
> Read before touching multi-page import or page caps.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- MULTI-PAGE SETTLEMENT CHUNKING (owner decision 2026-08-02, device
  evidence: "The AI service took too long to respond (over 55s)" — real
  Prime settlements are 8 pages and consistently exceeded the prior
  pass's `ANTHROPIC_TIMEOUT_MS`). Root cause was two-layered: the client
  had NO timeout at all (an unbounded wait on whatever the network/
  platform did), and the single 55s server-side attempt was never going
  to survive a genuinely large document however it was retried. Fixed
  end to end rather than just raising a number:
  1. **Platform ceiling, verified not assumed**: checked Supabase's own
     docs (https://supabase.com/docs/guides/functions/limits) rather than
     trusting the commonly-cited "400s" figure — that number is for
     background work continued via `EdgeRuntime.waitUntil()` AFTER a
     response is already sent, which `ai-import` never does (it always
     awaits its own single response). The real ceiling for THIS
     function's synchronous request/response execution model is **150s**,
     on both Free and Pro plans — the load-bearing constraint for every
     budget below.
  2. **Deterministic PDF chunking**: `supabase/functions/ai-import/
     chunking.ts` is a new, deliberately Deno-free, dependency-free pure
     module (page-range arithmetic + JSON merge only) — unit-tested
     directly from the app's Jest suite via a relative import
     (`app/src/import/__tests__/chunking.test.ts`, 14 tests) without
     needing a Deno runtime in CI, avoiding a second copy of the same
     algorithm to keep in sync (same "each Edge Function is self-
     contained" convention as `delete-account`/`reset-data`'s duplicated
     `deleteStorageFolder()` — `ChunkExtraction` is a minimal LOCAL type,
     not an import of `app/src/import/types.ts`'s `Extraction`).
     `computeChunkPageRanges()` splits a PDF into non-overlapping 1-
     indexed page ranges; `mergeChunkedExtractions()` combines one
     extraction per chunk back into a single result: header/summary
     SCALARS (weekEnding, carrier, grossRevenue, netPay, totalMiles, ...)
     take chunk[0]'s value UNCONDITIONALLY for numerics — a `0` is very
     often a legitimate value (e.g. a genuine 0-mile home week, the exact
     miles-trap case CLAUDE.md's NEGATIVE SETTLEMENTS pass already
     hardened) and "first non-zero across chunks" would wrongly skip past
     a correct 0 in favor of a later chunk's guess; line-item ARRAYS
     (loads, fuel, deductions, maintenance, tolls items, loans) are
     concatenated across every chunk in page order, safe because page
     ranges never overlap so the same physical line can never appear
     twice; tolls subtotals/the optional "operating" section scan every
     chunk for the first meaningful value since they're not guaranteed to
     be on page 1; `confidence` is ALWAYS forced `"low"` on a 2+-chunk
     merge regardless of what any individual chunk reported, so CLAUDE.md
     invariant #14's needs-review machinery always surfaces a merged
     result for the user to confirm before saving — a multi-chunk merge
     is inherently more guess-prone (heuristic header placement, array-
     concatenation assumes clean boundaries) than one coherent read.
     `buildChunkPromptAddendum()` tells the model it's seeing only a page
     subset and to leave any field not visible on THOSE pages at its
     normal schema default rather than guessing/reconstructing it — the
     merge's "chunk[0] priority" rule depends on this instruction
     actually being followed.
  3. **Three-path server orchestration** (`index.ts`'s `Deno.serve`
     handler, budgets sized to leave real margin under the 150s ceiling
     for the function's OWN non-Anthropic overhead too — the daily-import
     count query, pdf-lib parsing/splitting, prompt building, JSON
     merging — not just the Anthropic call time): (a) an image — one
     call, `IMAGE_TIMEOUT_MS` (60s), the standard 2-attempt retry, no
     chunking (images are single-page); (b) a PDF at or under
     `CHUNK_PAGE_THRESHOLD` (3) pages, OR one whose page count couldn't
     even be determined (pdf-lib failed to parse it, so chunking isn't
     possible anyway) — ONE quick, deliberately NO-RETRY attempt at the
     full document first (`PDF_SINGLE_ATTEMPT_TIMEOUT_MS`, 40s; most small
     PDFs succeed here, fast); ONLY a `timeout` or `truncated` result (not
     a clean 4xx/parse-failure/refusal, which chunking can't fix) falls
     back automatically to chunking at `FALLBACK_PAGES_PER_CHUNK` (1)
     page per chunk — extending "truncated" into this retry-once trigger
     was a deliberate choice: hitting the token ceiling is the same class
     of "too much content in one call" problem a timeout is; (c) a PDF
     over the threshold — straight to chunking at `PAGES_PER_CHUNK` (3)
     pages/chunk, no wasted single-call attempt first. Every chunk in a
     batch is called via `Promise.all` (parallel), which is what keeps
     the WHOLE chunked operation bounded by the slowest SINGLE chunk
     instead of the sum of all of them — essential to staying under 150s.
     Worst-case wall-clock, computed not guessed: path (b)'s fallback ≈
     40s + (50s × 2 attempts + 0.8s backoff, parallel-bounded) ≈ 140.8s
     (~9s margin under 150s); path (c) alone ≈ 100.8s (~49s margin). Any
     single chunk's terminal failure fails the WHOLE extraction rather
     than silently returning an incomplete merge — a partial-but-quiet
     result (missing a whole page's worth of deductions/loads) would
     violate CLAUDE.md invariant #3's "no dollar silently lost"
     convention more than a clear error would.
     `callAnthropicMessages()`/the new `extractOnePass()` wrapper (JSON-
     parse/stop_reason handling factored out so it's reusable per-chunk,
     not duplicated) both now take `timeoutMs`/`maxAttempts` as CALLER-
     supplied parameters instead of fixed globals, since the three paths
     each need a different budget.
  4. **Client-side timeout, added (there was none before)**:
     `aiImportCall.ts`'s `callAiImport()` now passes `timeout` to
     `supabase.functions.invoke()` — `PDF_CLIENT_TIMEOUT_MS` (190s,
     satisfying the "at least 180s" ask with real margin over path (b)'s
     ~140.8s server-side worst case) for PDFs, `IMAGE_CLIENT_TIMEOUT_MS`
     (130s, shorter per the report, with margin over the image path's
     ~120.8s worst case) for images. A client-side timeout abort surfaces
     from `@supabase/functions-js` as a `FunctionsFetchError` whose
     `context` is the raw `AbortError`/`DOMException`, NOT a `Response` —
     detected explicitly (`context.name === 'AbortError'`) BEFORE the
     existing `ctx.json()` Response-parsing path, which would otherwise
     silently fall through to a generic `'network_error'` and lose the
     "this was a timeout, not a connectivity problem" distinction.
  5. **"Still working" progress UI**: the import screen's working-phase
     spinner used to show one static label through the whole AI call, no
     matter how long it ran — indistinguishable from a frozen app on a
     genuinely multi-minute chunked extraction. A `startStillWorkingTimer()`/
     `clearStillWorkingTimer()` pair (`app/(tabs)/import/index.tsx`)
     swaps `workingLabel` to `importScreen.stillWorkingLargeDoc` ("Still
     working — large documents can take a couple of minutes.") 15s into
     the AI call if it hasn't resolved yet, cleared the moment the call
     actually settles (success or failure) so it never lingers into a
     later phase — wired into both the photo and PDF import paths. New
     key added to all 7 locales (`hi`/`uk` as untranslated English copies
     per invariant #11, same as every other string added since that
     rule).
  6. **Reduce work per call, audited**: `ANTHROPIC_MAX_TOKENS` stays at
     16000 (chunking gives even MORE headroom per call now, not less, per
     the explicit ask to keep it); lowering scanned-image resolution was
     confirmed ALREADY satisfied for photo uploads (`processImage()`
     already downscales to 1600px width via `expo-image-manipulator`
     before ever calling `ai-import`). Two optimizations considered and
     deliberately NOT implemented, flagged rather than silently skipped:
     stripping financially-blank pages before sending (not cheaply
     detectable without an extra AI pass or rasterizing+OCR-ing every
     page first — the cost of detecting it could exceed the cost of just
     sending it); lowering DPI of a raster image EMBEDDED inside a PDF
     page (`pdf-lib` can split/merge pages but cannot re-rasterize an
     embedded image at a lower resolution without a much heavier
     rendering dependency this function doesn't have) — both left as
     explicitly-flagged future work, not silently absent.
  Tests: `app/src/import/__tests__/chunking.test.ts` (14 tests) covers
  `computeChunkPageRanges`, `buildChunkPromptAddendum`, and
  `mergeChunkedExtractions` — including a real-world regression case
  using the exact numbers from the NEGATIVE SETTLEMENTS pass's own fixture
  (W/E 2026-07-24, $5.16 gross, -$1,155.35 net, 0 miles, $1,160.51 in
  deductions split across simulated header/deduction chunks) to prove the
  merge reproduces a genuine multi-page statement's numbers exactly. The
  orchestration logic itself (the three-path branching, the Deno-only
  `getPdfPageCount()`/`splitPdfIntoChunks()` helpers) is NOT unit-tested —
  no Deno test runtime is available in this environment; `chunking.ts`
  carries 100% of the testable, deterministic logic by design specifically
  so this gap is as small as possible.

- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 2 — "STILL FAILING" FIX (owner
  decision 2026-08-03, device evidence: real Prime settlements STILL
  timed out after the 2026-08-02 chunking pass — "Could not process this
  multi-page document (4 sections attempted): ...over 50s"). Diagnosis
  requested first, answered plainly: NO, a chunk was never re-sending the
  whole document — `splitPdfIntoChunks()` (index.ts) genuinely crops each
  chunk to only its own pages via pdf-lib's `copyPages()`/`addPage()`,
  confirmed by reading the code line by line before writing anything new.
  The real, separate root causes:
  1. **A genuine retry-doubling bug**: `callAnthropicMessages()`'s catch
     block retried on ANY caught error — including an `AbortError` from
     OUR OWN client-side timeout — before ever checking whether it was an
     abort. A chunk that timed out at (the prior pass's) 50s silently got
     a full SECOND 50s attempt before surfacing the "over 50s" message,
     meaning real failures were taking ~2x as long as the error implied.
     Fixed: an abort now returns the `timeout` error immediately, no
     retry — retry is reserved for a genuine transient failure (a real
     network throw, or a 5xx/529 response), which a repeat attempt can
     actually help with.
  2. **Parallel contention across chunks**: the prior pass fired all of a
     document's 3-page chunks at Anthropic simultaneously via
     `Promise.all`. Real-world evidence (still failing at the raised
     budget) points to this adding genuine contention/queueing risk on
     top of each call's own processing time, exactly as the bug report
     suspected ("parallel adds rate-limit and memory risk").
  **New strategy — "prefer what demonstrably works," pragmatic default
  over exhaustive coverage**: `SETTLEMENT_MAX_PAGES = 3` (index.ts) caps
  extraction at the FIRST 3 pages by default — the header/revenue/
  reimbursement/deduction/recap sections of a carrier settlement are
  always there; the operating-statement/EZ-Pass/repair-invoice pages that
  typically follow are a duplicate YTD rollup and separate documents the
  user can import on their own. This isn't gated on docType (unknown
  until AFTER extraction) — it applies to any oversized PDF, which in
  practice means settlements, since that's what triggers this path.
  Two paths now, replacing the prior pass's three:
  1. **Single call** (`totalPages <= SETTLEMENT_MAX_PAGES`, or a PDF whose
     page count pdf-lib couldn't even determine — page-capping isn't
     possible anyway, so the whole original file is sent as-is):
     `SINGLE_CALL_TIMEOUT_MS` (90s), the standard 5xx-only retry.
  2. **Sequential, page-by-page** (`totalPages > SETTLEMENT_MAX_PAGES`):
     pages 1, 2, 3 — ONE AT A TIME, in order, NEVER in parallel, NEVER
     page 4+. `SEQUENTIAL_PAGE_TIMEOUT_MS` (40s) per page. STOPS at the
     first page that fails rather than attempting the rest (sequential,
     not parallel, means a doomed later page never wastes time
     alongside — or contends with — an earlier one). This is a REAL
     increase in per-page budget despite 40s being less than the old
     50s: the old 50s covered 3 PAGES per call (~17s/page); this is 40s
     for exactly ONE page — roughly 2.3x more time per page, with zero
     parallel contention.
  Both budgets are sized against Supabase's VERIFIED 150s wall-clock
  ceiling for a synchronous request/response Edge Function invocation:
  single-call worst case ≈91s (~59s margin); sequential worst case ≈123s
  for all 3 pages (~25s margin for pdf-lib parsing/splitting ×3, the
  daily-import-count query, response serialization).
  **Graceful degradation, never lose the whole import again**: if page 1
  succeeds but page 2 or 3 fails, the sequential path SAVES whatever
  pages succeeded before the failure instead of discarding everything —
  `mergeSequentialPageResults()` (chunking.ts, pure and unit-tested, same
  "chunking.ts carries 100% of the testable logic" convention as the
  prior pass) merges only the pages before the first failure and forces
  `confidence: 'low'` whenever the result doesn't cover every page of the
  original document (whether by deliberate 3-page cap or a mid-sequence
  failure) — reusing the EXISTING needs-review machinery (invariant #14)
  rather than inventing a second one. Every response that doesn't cover
  every original page — capped-by-design or failure-truncated alike —
  now carries a `pagesProcessed: {through, total}` field alongside `data`;
  `aiImportCall.ts` forwards it, and the import preview screen shows a
  plain "📄 Partial document imported — imported pages 1-N of M, later
  pages weren't processed, import them separately if needed" banner (new
  `importScreen.pagesProcessed*` i18n keys, all 7 locales) rather than
  silently looking complete when it isn't. A total failure (page 1 itself
  fails) still surfaces page 1's own real error, same as before.
  **Timeouts raised end to end, not just server-side**: client
  (`aiImportCall.ts`) `PDF_CLIENT_TIMEOUT_MS` raised 190s → 240s per the
  explicit ask, `IMAGE_CLIENT_TIMEOUT_MS` 130s → 120s (still shorter than
  the PDF budget, images are always one `IMAGE_TIMEOUT_MS`(90s, raised
  from 60s) call). **Measured per-call duration (item 6 of the bug
  report), answered honestly**: this dev environment cannot make a real
  Anthropic API call to measure actual latency — rather than invent a
  number, `callAnthropicMessages()` now logs the REAL elapsed ms for
  every attempt (`console.log`, visible via `supabase functions logs
  ai-import`), so the next genuine device import reports the true
  per-call budget instead of a guess.
  Tests: `app/src/import/__tests__/chunking.test.ts` gained 6 new tests
  for `mergeSequentialPageResults()` — first-page failure returns null
  (nothing to save), a single successful page passes through untruncated
  when it's the whole document, truncated results force `confidence:
  'low'`, stopping at the first failed page merges only the pages before
  it (never a page that would have come after), a fully-covered 3-page
  merge is not marked truncated, and a real-world-shaped 3-of-12-page
  case reproduces the exact NEGATIVE SETTLEMENTS fixture numbers. Full
  suite: 64 suites / 1475 tests pass; `tsc --noEmit` clean; all 7 locales
  confirmed key-parity after adding the 2 new `importScreen.*` keys.

- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 3 — NO MORE PAGE CAP + HARD
  RECONCILIATION GUARD (owner decision 2026-08-03, device evidence: round
  2's 3-page cap DID fix the timeout — "Partial document imported — pages
  1-3 of 11" came back correctly, with the right week/loads/miles/gross —
  but the deduction LINE ITEMS on that real 11-page settlement live past
  page 3. The result showed Net Pay $0.00 and Deductions $0.00 while the
  AI's own summary text said "Total deductions from truck: $4,637.15" —
  gross income with zero recorded expenses. Saving that would be a real
  tax-accuracy bug, not just an incomplete import: CLAUDE.md invariant #1's
  net-pay tax model depends on out-of-pocket/withheld deductions actually
  being captured). Two changes, together:
  1. **No fixed page cap, ever** — there is no page count that's safe to
     assume covers every settlement's financial sections, so capping
     itself was the bug, not its size. Replaced with a CLIENT-DRIVEN
     CONTINUATION protocol: `ai-import` processes a document in small,
     safe batches (`PAGES_PER_BATCH = 3` pages, sequential, never
     parallel — same per-page granularity and contention-avoidance as
     round 2) and, whenever a batch fully succeeds but pages remain,
     returns `nextPageStart` + `rawPageExtractions` (the raw per-page
     extractions gathered so far) instead of a terminal result.
     `aiImportCall.ts`'s `callAiImport()` loops: sees `nextPageStart`,
     calls `ai-import` AGAIN passing those two values straight through,
     SEQUENTIALLY (one full round-trip at a time, never concurrent),
     until the whole document is covered or a page genuinely fails. This
     is what makes "process ALL pages" compatible with Supabase's
     VERIFIED 150s-per-invocation wall-clock ceiling (round 1) even for a
     document with dozens of pages: no single invocation ever tries to
     cover more than `PAGES_PER_BATCH` pages, so the per-invocation budget
     math is UNCHANGED from round 2 (≈123s worst case, ~25s margin) no
     matter how many total batches a long settlement needs — the platform
     ceiling is never at risk regardless of document length. The merge
     logic itself never moved off the server — `chunking.ts`'s existing,
     tested `mergeSequentialPageResults()` still does 100% of the actual
     merging (the server just feeds it the combined prior+new extraction
     list each round); the client's only job is to store and resend the
     raw array between calls, never to reimplement any merge semantics.
     Defensive-only ceilings added on both sides (`MAX_TOTAL_PAGES = 60`
     server-side, a 60-round loop cap client-side) guard against a
     pathological/corrupt PDF driving an unbounded number of round-trips
     — real settlements are nowhere near this long. The import screen's
     "still working" message now updates per round-trip
     (`importScreen.processingPageProgress`, "Processing page N of M…")
     instead of showing one static label for however long a many-page
     document's full sequence takes.
  2. **Settlement reconciliation hard guard, must-have** — a new pure,
     unit-tested `checkSettlementReconciliation()`
     (`app/src/import/settlementReconciliation.ts`) BLOCKS Save entirely
     (no override — a half-settlement that looks complete is worse than
     no settlement) whenever either of two concrete, high-confidence
     signals fires: (a) the settlement's own stated `totalDeductions`
     figure doesn't match what the `deductions` line items actually sum
     to (beyond a $1 rounding tolerance — deliberately narrow, per the
     bug report's own framing "prefer the AI's stated section totals as a
     cross-check EVERYWHERE," not a broader gross-minus-deductions-
     equals-net arithmetic identity that would false-positive on
     legitimate cases this app already handles, like escrow holdbacks or
     NEGATIVE SETTLEMENTS' real negative nets); (b) `netPay` is exactly
     `0` (or missing) while `grossRevenue` is nonzero — the precise
     signature of a never-reached net-pay figure, not a real business
     outcome (a real settlement's net is essentially never EXACTLY
     $0.00). Wired into the import screen's Save button `disabled` prop
     AND as a second, defense-in-depth check inside `handleSave()` itself
     (same "double guard" pattern as the existing double-tap-guard/
     duplicate-race checks), with a red (not the usual amber) blocking
     banner listing the specific issue(s) and telling the user to
     reimport, or add the missing amounts as standalone deductions from
     the Deductions screen (settlements have no manual-add UI of their
     own — a standalone deduction is the one real fallback that exists
     today for capturing the expense even if the settlement itself can't
     be saved). Deliberately does NOT gate on `pagesProcessed`/truncation
     status — it re-checks the ACTUAL numbers on every settlement
     extraction regardless of how it was obtained, as defense in depth
     against any other path that could produce the same incomplete shape.
  Tests: `app/src/import/__tests__/settlementReconciliation.test.ts` (new,
  10 tests) — passes a complete/reconciled settlement, a genuinely
  deduction-free one, a legitimate NEGATIVE SETTLEMENTS case (negative net
  is fine, only an exact-zero net alongside nonzero gross blocks), item
  4's own example (stated $4,637.15 vs. summed $500), the exact reported
  failure mode (gross $8,235.47, net $0, deductions $0), a missing-net
  case, rounding tolerance, and both signals firing at once.
  `app/src/import/__tests__/chunking.test.ts` gained an 11-page,
  8-deduction-page test proving `mergeSequentialPageResults()` correctly
  accumulates deductions spread across many pages into a complete,
  correctly-summed, non-zero-net result when every page succeeds — the
  actual multi-invocation orchestration (`extractPageBatch`/
  `priorPageExtractions` continuation in index.ts) is Deno-only and not
  unit-tested here, same "no Deno runtime available" gap as every prior
  pass's server orchestration logic. Full suite: 65 suites / 1498 tests
  pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity
  (glossary test caught and fixed one real slip — the Spanish
  translation of the new reconciliation strings initially translated
  "settlement" to "liquidación," violating the DO-NOT-TRANSLATE glossary
  rule; fixed before commit). Measured per-call timing (item 6, both
  rounds): still cannot be produced from this dev sandbox — the
  `console.log` timing added in round 2 remains the mechanism for getting
  real numbers from the next actual device import
  (`supabase functions logs ai-import`).

- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 4 — SINGLE CALL IS THE DEFAULT
  AGAIN (owner decision 2026-08-03, "STOP AND SIMPLIFY" device evidence:
  round 3's batch-continuation design made things WORSE — a real 11-page
  settlement's banner read "Imported pages 1-1 of 11," meaning the
  client's round-trip loop stopped after a single page, capturing gross
  revenue but $0 net/deductions again via a different failure mode than
  round 2's fixed cap). Four passes in, "prioritize WORKING over elegant"
  was the explicit instruction. Restored the ORIGINAL, previously-working
  shape: ONE call over the WHOLE document is the DEFAULT for every
  document, image or PDF, any page count — exactly like this function's
  very first implementation, before any chunking pass — carrying forward
  only the two real, verified improvements from rounds 1-2 (the raised
  timeout budget, the retry-on-timeout bug fix). The round-3 continuation
  protocol was NOT deleted — it became the FALLBACK, entered ONLY when
  the single call itself returns `timeout` or `truncated` (a clean
  4xx/parse-failure/refusal is not something splitting into pages can
  fix, so those still surface as a normal error). This inverted round 3's
  priority exactly as instructed: single call first, chunking is the
  exception, not the reverse. Every decision (single-call outcome,
  fallback trigger, per-batch/per-page result) was logged so the next
  real device test's function logs would show exactly what happened
  instead of guessing again — this pass's own numbers were explicitly
  marked PROVISIONAL pending real measured data, which arrived in round 5
  below.

- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 5 — MEASURED EVIDENCE (owner
  decision 2026-08-03, binding numbers — record these so nobody re-
  guesses these thresholds again). Real per-page Anthropic call durations
  from Supabase's own `ai-import` function logs (round 4's per-attempt
  `console.log`):
  ```
  03:01:37  attempt 1/2: 23866ms, status 200   (page succeeded)
  03:02:17  attempt 1/2: 40003ms, TIMED OUT    (killed at round 3's 40s cap)
  02:37:59  attempt 1/2: 39121ms, status 200   (barely made it under 40s)
  ```
  Owner's own diagnosis, confirmed by these numbers: **this was a BUDGET
  problem, not an architecture problem.** A single page can legitimately
  need up to (and apparently sometimes just past) 40 seconds — the
  system's own 40s `AbortController` was killing legitimate, still-
  working calls. THAT is why round 4's device test showed "Imported
  pages 1-1 of 11": page 2 didn't fail because of a real error, it failed
  because the timeout was too tight, and round 3/4's design then stopped
  the entire continuation at that first failure (round 3's
  `mergeSequentialPageResults` treated any failure as a hard stop).
  **Three changes, precisely targeted at the evidence:**
  1. **`PAGE_TIMEOUT_MS` raised 40s → 110s** (per-page, first attempt) —
     comfortable margin over the ~40s worst case actually observed, while
     leaving real headroom under Supabase's VERIFIED 150s wall-clock
     ceiling for one invocation.
  2. **`PAGES_PER_BATCH` reduced 3 → 2** — fewer pages attempted per
     invocation keeps the common-case invocation short. Combined with
     dynamic per-invocation time-budget tracking (next point), the SAME
     code stays safe even if a page takes far longer than the 24-40s
     typically measured — a fixed "2 pages always fits" assumption would
     be the exact same class of guess that caused this bug, since the
     measured evidence shows single-page duration is NOT constant (23.9s
     to >40s within the SAME document).
  3. **A single-page timeout is no longer fatal to the whole document.**
     `runPageWithRetry()` (index.ts) gives a timed-out page ONE extra
     attempt at a shorter `PAGE_RETRY_TIMEOUT_MS` (30s) budget; if that
     ALSO fails (or there isn't enough remaining invocation budget to
     even try), the page is recorded MISSING and the loop moves on to
     EVERY remaining page regardless — "the loop must always attempt
     every page" (owner decision), never stopping the whole document over
     one bad page. A non-timeout failure (4xx/parse-failure/refusal) is
     never retried — that's not what a retry can fix — and marks the page
     missing immediately instead of wasting the retry budget.
  **Gap-tolerant merge** (`chunking.ts`'s `mergeAllPages()`, replacing
  round 3's stop-at-first-failure `mergeSequentialPageResults()`): pages
  are now tagged with their own page NUMBER (not positional order), so a
  missing MIDDLE page no longer prevents LATER pages from being merged —
  the exact "1 of 11" bug is now structurally impossible, since nothing
  ever stops the loop early over a single page's failure. `confidence` is
  forced `'low'` whenever ANY page is missing, regardless of how many
  merged cleanly — same needs-review trigger as before, just gap-aware.
  A genuinely incomplete result still can't be saved: the settlement
  reconciliation hard guard (`settlementReconciliation.ts`, unchanged
  this pass — verified still correct) independently catches the
  resulting mismatched totals (summed deductions vs. the statement's own
  stated total; net pay showing exactly $0 while gross is nonzero) and
  blocks Save regardless of which mechanism produced the incomplete data.
  **Dynamic time-budget tracking** (why a fixed page count alone isn't
  safe): `remainingInvocationBudgetMs()` (index.ts, computed fresh INSIDE
  the `Deno.serve` handler on every request — a module-level constant
  would only reflect the FIRST invocation's start time, since Deno keeps
  this module loaded across many invocations) tracks real elapsed wall-
  clock time since THIS invocation started; every page attempt's own
  timeout is capped at `min(PAGE_TIMEOUT_MS, remaining budget - 5s safety
  margin)` (`HARD_INVOCATION_BUDGET_MS = 145_000`, 5s under Supabase's
  150s ceiling; `MIN_USEFUL_BUDGET_MS = 20_000` — below this, don't even
  start another attempt). If there isn't enough budget left to safely
  attempt (or retry) another page, the loop stops THERE — not mid-attempt
  — and hands off to a fresh invocation via `nextPageStart`, which gets
  its own full 150s budget. This guarantees the platform's hard ceiling
  is never at risk no matter how slow any individual page turns out to
  be — "more round trips is fine — they are cheap" (owner decision).
  **Wire protocol extended** to carry page NUMBERS, not just counts:
  request gains `priorMissingPages: number[]` alongside the existing
  `priorPageExtractions` (now `{page, extraction}[]`, tagged); response
  gains `rawMissingPages`/`pagesProcessed: {total, missingPages: number[]}`
  (replacing the old `{through, total}` shape, which couldn't represent a
  gap). `aiImportCall.ts`'s `callAiImport()` round-trip loop threads all
  of this through unchanged in spirit (still sequential, one round-trip
  at a time, never concurrent) and now logs every round
  (`console.log('[ai-import client] round N: ...')`) alongside index.ts's
  own per-page/per-invocation logs — "the next diagnosis takes one
  screenshot" (owner decision). The import screen's
  `pagesProcessedBody` banner now lists the SPECIFIC missing page
  numbers (`"Imported {{covered}} of {{total}} pages. Page(s)
  {{missingPages}} could not be processed..."`) instead of a contiguous
  "pages 1-N" range, since gaps are now representable and worth surfacing
  precisely.
  Tests: `app/src/import/__tests__/chunking.test.ts`'s
  `mergeSequentialPageResults` suite was replaced with `mergeAllPages`
  coverage — a middle page failing does NOT stop later pages from being
  merged (the exact bug this fixes, reproduced directly), confidence
  forced low on any gap, the 11-page/8-deduction-page full-coverage case
  carried over, plus a new "retried-then-skipped page" case matching the
  measured-evidence scenario. `app/src/data/__tests__/aiImportCall.test.ts`
  (new) is the requested regression suite for this whole area against a
  mocked `supabase.functions.invoke`: an 11-page document completes all 6
  expected round trips (`ceil(11/2)`) with the continuation state
  correctly threaded through each one; a page that fails even after the
  server's retry does NOT kill the run — the loop continues and the
  final result honestly reports `pagesProcessed: {total, missingPages}`;
  a small single-call document makes exactly one request; the
  `onProgress` callback fires once per intermediate round, never on the
  terminal one; a genuine server error on any round trip stops the loop
  immediately rather than being silently absorbed. Full suite: 66 suites
  / 1504 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity after updating `pagesProcessedBody`'s interpolation params.
  `settlementReconciliation.ts` and its 10 tests were verified unchanged
  and still passing — it operates purely on the final merged extraction's
  own fields, independent of however many pages/retries/gaps produced it,
  so it needed no changes to keep blocking an incomplete save correctly.
