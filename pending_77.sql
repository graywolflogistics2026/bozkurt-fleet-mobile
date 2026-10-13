-- docs/PENDING_SQL.md §77 — SETTLEMENT STATEMENT FIGURES (owner decision 2026-10-13)
-- Prime statement as source, source labels, read deposit. No backfill (D9).
alter table settlements add column if not exists statement jsonb;

-- Read-only verification (one row, data_type jsonb):
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'settlements' and column_name = 'statement';
