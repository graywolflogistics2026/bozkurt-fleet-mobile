-- docs/PENDING_SQL.md §48 — profiles.tutorial_seen_at
-- (FULL PARITY follow-up, owner decision 2026-08-05, spec item I)

alter table profiles
  add column tutorial_seen_at timestamptz;
