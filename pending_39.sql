-- docs/PENDING_SQL.md §39 — profiles.cf_insurance_weekly
-- (Cash Flow auto-fill fix, owner decision 2026-08-04, device report)
--
-- A real carrier settlement withholds FOUR separate insurance charges
-- EVERY WEEK (bobtail/deadhead, physical damage, occupational accident,
-- cargo/workers comp) — not a monthly bill. The old cf_insurance_monthly
-- field is the wrong shape; this adds a new WEEKLY column rather than
-- reinterpreting the old one in place, so a user's already-saved monthly
-- figure is never silently misread as weekly (a 4.33x error).
-- cf_insurance_monthly is left in place, unused going forward.
--
-- Run this directly in the Supabase SQL editor.

alter table profiles
  add column cf_insurance_weekly numeric(12,2);
