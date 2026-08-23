-- docs/PENDING_SQL.md §41 — capital_transactions.business_balance_applied
-- (FULL PARITY pass, owner decision 2026-08-05, spec item E.3)

alter table capital_transactions
  add column business_balance_applied numeric(12,2) not null default 0;
