-- docs/PENDING_SQL.md §64 — DELETE A TRUCK: truck_id FK cascade fix
-- (owner decision). REWRITTEN after a real Supabase SQL Editor failure:
-- the original version declared a loop variable whose SELECT only
-- projected `conname`/`conrelid::regclass::text as tbl`, then referenced
-- a field (`con.conrelid`) that was never actually part of that record's
-- shape ("record has no field conrelid"). This version selects exactly
-- the fields it goes on to use, nothing more, nothing renamed away.
--
-- Fixes 5 foreign keys that default to RESTRICT (no `on delete` clause
-- was specified when each was created) so a truck can never actually be
-- deleted while it still has any settlement/fuel/maintenance/deduction/
-- toll row pointing at it. For each of the 5 tables, this:
--   1. Looks up the REAL constraint name dynamically via pg_constraint
--      (never guessed/hardcoded) — and asserts there is EXACTLY ONE such
--      foreign key before touching anything, aborting loudly instead of
--      silently operating on the wrong constraint if that ever isn't true.
--   2. Skips the table entirely if it's already ON DELETE CASCADE
--      (confdeltype = 'c') — safe to paste and re-run this whole script
--      as many times as needed.
--   3. Drops the existing constraint and re-adds it — same original
--      name, so nothing else needs to know a new name was invented —
--      as ON DELETE CASCADE.
-- The whole block runs inside ONE transaction: if anything raises
-- partway through (e.g. the exactly-one-FK assertion fails for some
-- table), every earlier change in this same run is rolled back too —
-- either all 5 tables end up fixed, or none of them do.
--
-- NOT EXECUTED AGAINST A LIVE DATABASE: this environment has no psql/
-- postgres/docker available (verified — `which psql`, `which postgres`,
-- `which docker` all report "not found"), so this could only be
-- hand-traced against Postgres's own documented pg_constraint columns
-- and PL/pgSQL syntax, not literally run. Please run the verification
-- query at the bottom immediately after and confirm every row reads
-- CASCADE before relying on this for anything destructive.

begin;

do $$
declare
  target text;
  match_count int;
  fk_name text;
  fk_delete_type text;
begin
  foreach target in array array['settlements', 'fuel_purchases', 'maintenance_records', 'deductions', 'tolls']
  loop
    -- Exactly one FK from this table to trucks is expected — each of
    -- these 5 tables has only ever had truck_id reference trucks
    -- (confirmed against docs/SCHEMA.sql / PENDING_SQL.md §6 / §63).
    -- Abort the whole transaction rather than silently touching the
    -- wrong constraint if that assumption doesn't hold on this database.
    select count(*) into match_count
    from pg_constraint
    where contype = 'f'
      and conrelid = target::regclass
      and confrelid = 'trucks'::regclass;

    if match_count <> 1 then
      raise exception 'Expected exactly one foreign key from % to trucks, found % — aborting, nothing changed', target, match_count;
    end if;

    select conname, confdeltype::text
    into fk_name, fk_delete_type
    from pg_constraint
    where contype = 'f'
      and conrelid = target::regclass
      and confrelid = 'trucks'::regclass;

    if fk_delete_type = 'c' then
      raise notice '%.% is already ON DELETE CASCADE — skipping', target, fk_name;
    else
      execute format('alter table %I drop constraint %I', target, fk_name);
      execute format(
        'alter table %I add constraint %I foreign key (truck_id) references trucks(id) on delete cascade',
        target, fk_name
      );
      raise notice 'Updated %.% (truck_id) to ON DELETE CASCADE', target, fk_name;
    end if;
  end loop;
end $$;

commit;

-- VERIFICATION — run this separately, right after, and confirm every one
-- of the 5 rows below reads delete_rule = 'CASCADE'.
select
  conrelid::regclass::text as table_name,
  conname as constraint_name,
  case confdeltype
    when 'c' then 'CASCADE'
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
    else confdeltype::text
  end as delete_rule
from pg_constraint
where contype = 'f'
  and confrelid = 'trucks'::regclass
  and conrelid in (
    'settlements'::regclass, 'fuel_purchases'::regclass,
    'maintenance_records'::regclass, 'deductions'::regclass,
    'tolls'::regclass
  )
order by table_name;
