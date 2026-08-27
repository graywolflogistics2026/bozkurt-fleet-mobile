-- §66 — profiles.cf_recurring_charges
-- CASH FLOW RECURRING CHARGES — SHOW AND LET ME CORRECT IT (owner
-- decision). See docs/PENDING_SQL.md §66 and CLAUDE.md's dated entry for
-- this pass for full context. Idempotent, safe to re-run.

alter table profiles add column if not exists cf_recurring_charges jsonb not null default '{}'::jsonb;
