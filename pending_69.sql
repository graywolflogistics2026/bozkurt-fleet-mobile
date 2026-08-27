-- docs/PENDING_SQL.md §69 — REFERRAL NUDGE "surface at the right moments"
-- (owner decision, Part 2 of the AI Coach daily-tips request). One of the
-- 4 named moments is "after their first accountant export" — this app had
-- no existing signal anywhere for "has this user ever exported the
-- Accountant Package," so a real one was needed rather than guessing.
-- Set once, client-side, right after a successful PDF or Excel export
-- (app/(tabs)/more/accountant-package.tsx); the referral nudge only checks
-- "is this non-null," never re-derives a count.

alter table profiles add column if not exists accountant_package_exported_at timestamptz;
