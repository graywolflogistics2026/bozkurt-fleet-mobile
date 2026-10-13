# Usage Limits

> AI cost control + usage limits by fleet size + credit packs (FIVE ADDITIONS parts 4-5, owner decision 2026-08-24, §51).
> Graceful degradation when AI calls fail or limits are hit.
> Parts 1-3 of the same entry are in docs/CHANGELOG.md.

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

  PART 4 — COST CONTROL & GRACEFUL DEGRADATION: every ai-import AND
  ai-advisor call now writes one row to the new `ai_usage_log` table
  (success/failure + reason), inserted via the caller's own JWT-scoped
  client (RLS `user_id = auth.uid()` on INSERT — safe, since it's the
  SERVER doing the insert on behalf of the authenticated caller).
  `src/import/friendlyAiFailure.ts`'s `classifyAiImportFailureCategory()`
  collapses `anthropic_error`→billing/auth, `rate_limited`→rate-limit,
  `timeout`/`truncated`→timeout/overload, and `network_error`→offline
  into the spec's exact 4 shared, localized messages
  (`importScreen.friendlyFailure.*`) — every OTHER error type keeps its
  own existing, already-specific message. `service_status` (everyone
  reads, service-role/admin writes — docs/ADMIN_RUNBOOK.md's post/clear
  recipe) plus a client-side automatic fallback
  (`src/data/serviceStatus.ts`'s `useAiFailureTracker()` — a react-query-
  cache-backed, AsyncStorage-persisted consecutive-failure counter shared
  live across every screen that reads it, clearing on the next success)
  both feed the ONE `<ServiceStatusBanner />` shown on Home and Import.
  "QUEUE INSTEAD OF FAIL" (item 4) was scoped down HONESTLY rather than
  built as a full multi-item persisted queue: `fileMeta` (the picked
  file's uri/mediaType/name) was ALREADY not cleared until an explicit
  reset, so `handleRetryImport()` re-runs the SAME already-picked file
  with one tap (no re-picking) on the error screen — this covers "retry
  the one that just failed," not "a list of several past failures you
  can each retry independently"; the latter would need real binary-file
  persistence across app restarts, not attempted this pass.
  PART 5 — USAGE LIMITS BY FLEET SIZE + CREDIT PACKS:
  `app/src/usage/aiUsage.ts` is the pure, tested client-side mirror
  (allowance calc, 80%/100% thresholds, credit-consumption order,
  Catch-Up-pack 90-day expiry, backfill-session detection) of the ACTUAL
  enforcement, which lives entirely server-side in
  `supabase/functions/ai-import/index.ts` (`checkAiImportUsageAllowed()`
  — checked ONLY on a fresh top-level request, never mid-continuation,
  querying `ai_usage_config`/`trucks`/`ai_usage_log`/
  `ai_credit_purchases` all via the caller's own JWT; `logAiUsage()`;
  `consumeOneCreditIfOverAllowance()`). "A multi-page settlement counts
  ONCE; retries after a service failure don't count" is enforced by only
  ever logging/counting a TERMINAL response (`!nextPageStart`) — a
  continuation round is logged but never counted, a failed round is
  logged as a failure and never counted at all — mirrored exactly by the
  client-side `shouldCountAiImportUsage(hasNextPageStart, hadError)`
  pure function this pass's test suite pins. Credit consumption is
  re-checked FRESH at the terminal point (never trusted from an earlier,
  separate Edge Function invocation — a multi-round document's rounds
  are independent HTTP requests, nothing survives in memory between
  them) rather than threaded through the continuation protocol. Settings
  shows "AI imports this month: X of Y (N truck(s)) · Extra credits: Z"
  with the reset date (`src/data/aiUsageDisplay.ts`, display-only — the
  server remains the sole enforcement point) plus the 4 credit-pack
  offers once the soft (80%) or hard (100%) limit is hit — informational
  only, "Contact support to add a credit pack," since billing isn't
  built yet (item 6: purchases are recorded as owner-granted
  `ai_credit_purchases` rows via the same admin SQL recipe as lifetime
  plans, docs/ADMIN_RUNBOOK.md). A lightweight, in-session (not
  persisted) backfill-session detector
  (`detectBackfillSession()` — 3+ imported documents dated in a past
  month within one session) offers the Catch-Up Year pack contextually
  after a save, phrased as help. Neither `ai_usage_log`/
  `ai_credit_purchases`/`ai_usage_config`/`service_status` needed adding
  to `reset-data`'s or `delete-account`'s explicit table lists — they're
  account-level (item 8's "balances survive a reset of business data"),
  and the two user-scoped ones (`ai_usage_log`/`ai_credit_purchases`)
  already cascade-delete via their own `user_id ... on delete cascade`
  FK when `delete-account`'s existing `auth.admin.deleteUser()` call
  removes the real `auth.users` row.
  DELIVERABLES: 91 suites / 2191 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`alerts.nudges.*`/`alerts.coachNudges.*`/
  `deductions.reimburse*`/`capitalAccount.flow*`/`settings.aiUsage*`/
  `settings.weeklyGoal*`/`importScreen.friendlyFailure.*`/
  `importScreen.usageLimitReached*`/`serviceStatus.*` — es/ru/ar/tr fully
  translated, hi/uk as untranslated English copies per invariant #11).
  `ai-import` and `ai-advisor` were BOTH modified this pass (usage
  gate/logging and logging respectively) and have been redeployed;
  `reset-data`/`delete-account` were NOT touched this pass (confirmed no
  table-list change needed, see PART 5 above) — no redeploy needed for
  either. No native rebuild needed — every change is pure JS/TS plus
  SQL/Edge Function work, no new native dependency added; the client
  side shipped via a normal `eas update`, published to preview. `Card`
  (`src/components/ui.tsx`) gained an optional `style` prop this pass
  (needed for
  `ServiceStatusBanner`'s orange border) — a small, backward-compatible
  addition, every existing `<Card>` call site unaffected.
