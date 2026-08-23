-- docs/PENDING_SQL.md §44 — trucks.manual_total_miles_override
-- (FULL PARITY follow-up, owner decision 2026-08-05, spec item B.3)

alter table trucks
  add column manual_total_miles_override numeric(12,2);
