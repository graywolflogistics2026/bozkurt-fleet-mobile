-- docs/PENDING_SQL.md §79 — truck nickname + license plate (batch A item 2, 2026-10-30).
-- Additive only: two new nullable columns, nothing dropped or altered.
-- RLS: trucks_owner_all already covers every column. No profiles column, no new table.

alter table trucks add column if not exists nickname text;
alter table trucks add column if not exists plate text;

-- READ-ONLY CHECK (run separately, after): both rows should appear, data_type = text.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'trucks' and column_name in ('nickname', 'plate')
order by column_name;
