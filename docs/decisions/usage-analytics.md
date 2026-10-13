# Usage Analytics

> Privacy-safe, owner-only usage analytics (screen/action events only, never financial data).
> PENDING_SQL §71 deliberately NOT applied (analytics deferred); `pending_71.sql` kept.
> Must stay consistent with invariant #13 (user data is private).

Moved verbatim from CLAUDE.md on 2026-10-13 (original file order).

- USAGE ANALYTICS — PRIVACY-SAFE, OWNER-ONLY (owner decision,
  docs/PENDING_SQL.md §71, NOT YET APPLIED). "So I can learn which
  screens are actually used before deciding what to simplify." Records
  ONLY the bare event — which screen was opened or which action was
  started/completed, a timestamp, and the user id — NEVER a financial
  value, a description, a document's contents, or anything else about
  what the user actually did.
  **Table + RLS**: `app_usage_events` (`kind: 'screen'|'action'`, `name`,
  `status: 'started'|'completed'|null`, a CHECK constraint pairing status
  to kind so a screen row can never accidentally carry one). ONE insert
  policy (`user_id = auth.uid()` AND a live re-check of the new
  `profiles.usage_analytics_opt_out` column) — deliberately NO select/
  update/delete policy at all, RLS defaults to deny once enabled, so a
  regular user (including whoever the events belong to) can never read
  this table back through the app; only the `service_role` Postgres role
  (has `BYPASSRLS`) or the Supabase SQL Editor's own `postgres`/table-
  owner role (bypasses RLS by default, no `FORCE ROW LEVEL SECURITY`
  needed) can. `user_id` is `on delete cascade` from `auth.users`, same
  established precedent as `ai_usage_log`/`ai_credit_purchases` — already
  cleaned up automatically by `delete-account`'s existing
  `auth.admin.deleteUser()` call, no explicit Edge Function table-list
  entry; deliberately NOT added to `reset-data`'s
  `TABLES_IN_DELETION_ORDER` either — operational/telemetry data for
  product decisions, not user business data, same reasoning
  `ai_usage_log`/`service_status` are excluded for.
  **Opt-out enforced TWICE**: client-side
  (`src/data/usageTracking.ts`'s `shouldTrack()` short-circuits before
  ever attempting the insert) AND server-side (the INSERT policy's own
  `with check` re-reads the LIVE `profiles` row on every write, never a
  value the client could have cached stale) — the server-side check is
  the real, authoritative guarantee; the client-side one only avoids a
  wasted network call.
  **Architecture, pure/impure split** (same convention as
  `dailyTips.ts`/`proactiveCoach.ts`): `src/analytics/usageTracking.ts`
  is pure — `buildScreenOpenEvent()`/`buildActionEvent()`/`shouldTrack()`/
  `normalizeScreenName()`, fully unit-tested. `src/data/usageTracking.ts`'s
  `useUsageTracking()` hook binds the current user id + live opt-out
  preference once (`useAuth()` + `useProfile()`, react-query dedupes
  concurrent callers by query key so mounting this from several screens
  at once never issues extra requests) and exposes
  `trackScreenOpen`/`trackAction` — both always fire-and-forget, wrapped
  in try/catch, never throw, never block the real feature the user is
  actually using (same "never let a side channel affect the main flow"
  principle as `buildAndUploadBackupSnapshot()`/
  `recordExportedForReferralNudge()` elsewhere in this app).
  **Screens — automatic, comprehensive, zero per-screen wiring**: ONE
  navigation observer in `app/_layout.tsx`'s `RootLayoutNav` (already has
  `useSegments()`; gained `usePathname()` alongside it) fires
  `trackScreenOpen(pathname)` whenever the pathname genuinely changes and
  a session exists — covers every current AND future screen automatically,
  never needing the "was this route wired in" audit every OTHER
  whole-app-coverage feature in this codebase (daily tips, the nav
  registry) has needed a coverage-map test for.
  **Actions — a representative started/completed pair, not an exhaustive
  audit**: `document_import` (`app/(tabs)/import/index.tsx`'s
  `handleSave()` — started right after the double-tap guard, completed
  right after `setPhase('done')`) is the single most decision-relevant
  lifecycle in the app (this file's own multi-pass MULTI-PAGE SETTLEMENT
  CHUNKING/BACKGROUND IMPORT history is the reason why); named
  `document_import`, not `settlement_import`, since `handleSave()` saves
  every docType, not just settlements. `accountant_package_export_pdf`/
  `accountant_package_export_excel` (`accountant-package.tsx`'s
  `handleExportPdf()`/`handleExportExcel()`, started at the top,
  completed right alongside the existing `recordExportedForReferralNudge()`
  call) give the admin recipes a second, independent action family to
  demonstrate the mechanism. Deliberately scoped — wiring every button in
  the app is out of scope for this pass; the infra is generic and ready
  for more actions to be tracked later.
  **Settings toggle**: "Usage Analytics" (Settings > Data) — this app's
  first boolean `Switch` (no prior on/off toggle existed anywhere in
  Settings, every other choice is the existing `Pill` picker pattern),
  backed by `useUpdateProfile()` the same way every other profile field
  in this screen already saves.
  **Privacy Policy disclosure**: a new numbered section (both
  `src/config/privacyPolicy.ts`'s in-app `PRIVACY_BODY` and
  `docs/PRIVACY_POLICY_DRAFT.md`, renumbering the sections after it,
  `PRIVACY_VERSION` bumped for the "as of" date) states plainly what's
  collected, that it's never financial content, that no user (including
  the account it belongs to) can read it back through the app, and that
  it can be turned off any time with nothing else about the app changing.
  **`docs/ADMIN_RUNBOOK.md`** gained a new "Usage Analytics" section with
  4 recipes, each excluding the owner/dev account by default (the same
  `p.plan is distinct from 'owner'` pattern as AI Cost Control, so
  personal testing never skews the numbers used for a real simplify-what
  decision): screens ranked by unique users and by total opens; screens
  never opened by anyone (diffed against a pasted-in, hand-maintained
  list of every known route — SQL has no way to know the app's own route
  table dynamically, same caveat as every other hand-maintained list in
  that file); actions started vs. completed (the drop-off/abandonment
  count); and both of the above split by account age (new — under 30
  days — vs. established).
  Tests: `src/analytics/__tests__/usageTracking.test.ts` (new, 11 tests)
  — every builder's exact output shape (screen events carry no status,
  action events always carry a real one), the opt-out gate's 3 states
  (default-on, unloaded-defaults-to-on, explicitly-off), and
  `normalizeScreenName()`'s trailing-slash/empty-string handling.
  `jest.config.js`'s `testMatch` gained `src/analytics/**/*.test.ts` (a
  new source directory, previously unlisted — would have silently
  collected 0 tests otherwise, same class of gap the onboarding
  directory once hit). The React hook half (`useUsageTracking()`, the
  root-layout observer) is not independently unit-tested — same
  standing "no React Native rendering harness in this repo" limitation
  every other hook-heavy feature in this codebase has flagged honestly
  rather than fabricating coverage. Full suite: 122 suites / 3,420 tests
  pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity (2 new
  `settings.usageAnalytics*` keys — es/ru/tr/hi/ar fully translated, uk
  as an untranslated English copy per invariant #11).
  `docs/PENDING_SQL.md` §71 (mirrored as `pending_71.sql` at the repo
  root) is **NOT YET APPLIED** — until it's run, `usage_analytics_opt_out`
  is an unknown column (the Settings toggle would fail to save) and the
  `app_usage_events` table doesn't exist (every `trackScreenOpen`/
  `trackAction` call fails silently, caught by its own try/catch, no
  crash — matching this app's own "a new column/table always degrades
  gracefully until its migration has run" convention). No Edge Function
  was touched — every change is pure client-side JS/TS plus this one
  pending SQL migration; no redeploy needed for
  `ai-import`/`ai-advisor`/`reset-data`/`delete-account`/`referral-sync`.
  Ships via a normal `eas update` once §71 has been run.
