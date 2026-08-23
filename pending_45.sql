-- docs/PENDING_SQL.md §45 — trucks cost basis
-- (FULL PARITY follow-up, owner decision 2026-08-05, spec item C.1)

alter table trucks
  add column cost_basis_ownership_mode text check (cost_basis_ownership_mode in ('paid','loan','lease')),
  add column cost_basis_loan_monthly_payment numeric(12,2),
  add column cost_basis_paid_spread_months integer,
  add column cost_basis_warranty_cost numeric(12,2),
  add column cost_basis_warranty_term_months integer;
