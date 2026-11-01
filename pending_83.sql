-- PENDING_SQL §83 — PROFIT EXPLAINER "possible duplicate: keep"
-- (owner decision 2026-10-30, master plan batch D item 8).
-- One new nullable column on four tables. Nothing dropped or altered.
-- Safe to run twice.

alter table deductions add column if not exists duplicate_kept_at timestamptz;
alter table fuel_purchases add column if not exists duplicate_kept_at timestamptz;
alter table maintenance_records add column if not exists duplicate_kept_at timestamptz;
alter table tolls add column if not exists duplicate_kept_at timestamptz;

-- Read-only check: four rows, one per table.
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public' and column_name = 'duplicate_kept_at'
order by table_name;
