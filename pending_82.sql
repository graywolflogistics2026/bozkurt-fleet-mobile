-- PENDING_SQL §82 — WEEK REVIEW + CERTIFY, LOADED / EMPTY MILES PER WEEK
-- (owner decision 2026-10-30, master plan batch C items 5 and 6).
-- New nullable settlements columns + two trigger functions. Nothing
-- dropped or altered. Safe to run twice.

-- Item 6: the week's loaded / empty split (src/import/milesSplit.ts).
alter table settlements add column if not exists loaded_miles numeric;
alter table settlements add column if not exists empty_miles numeric;
alter table settlements add column if not exists miles_split_source text;
alter table settlements add column if not exists miles_split_label text;
alter table settlements add column if not exists miles_split_flag text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settlements_miles_split_source_check' and conrelid = 'public.settlements'::regclass) then
    alter table settlements add constraint settlements_miles_split_source_check
      check (miles_split_source is null or miles_split_source in ('loads', 'statement', 'derived', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settlements_miles_split_nonneg_check' and conrelid = 'public.settlements'::regclass) then
    alter table settlements add constraint settlements_miles_split_nonneg_check
      check ((loaded_miles is null or loaded_miles >= 0) and (empty_miles is null or empty_miles >= 0));
  end if;
end $$;

-- Item 5: "Review this week" — items marked "Looks right" and the
-- certification (when, which text version, which app version).
alter table settlements add column if not exists review_acknowledged text[];
alter table settlements add column if not exists certified_at timestamptz;
alter table settlements add column if not exists certification_text_version text;
alter table settlements add column if not exists certification_app_version text;

-- Any later edit of the week clears its certification and its "Looks
-- right" marks: (1) an edit of the settlement row itself (any column other
-- than these four and updated_at), (2) an insert/update/delete of a row
-- linked to it by settlement_id.
create or replace function settlements_clear_certification()
returns trigger
language plpgsql
as $$
declare
  review_cols text[] := array['review_acknowledged', 'certified_at', 'certification_text_version', 'certification_app_version', 'updated_at'];
begin
  if (to_jsonb(new) - review_cols) is distinct from (to_jsonb(old) - review_cols) then
    new.review_acknowledged := null;
    new.certified_at := null;
    new.certification_text_version := null;
    new.certification_app_version := null;
  end if;
  return new;
end;
$$;

drop trigger if exists settlements_clear_certification on settlements;
create trigger settlements_clear_certification
  before update on settlements
  for each row execute function settlements_clear_certification();

create or replace function settlement_child_clears_certification()
returns trigger
language plpgsql
as $$
declare
  ids uuid[];
begin
  if tg_op = 'INSERT' then
    ids := array[new.settlement_id];
  elsif tg_op = 'DELETE' then
    ids := array[old.settlement_id];
  else
    ids := array[new.settlement_id, old.settlement_id];
  end if;
  update settlements
     set review_acknowledged = null,
         certified_at = null,
         certification_text_version = null,
         certification_app_version = null
   where id = any(ids)
     and (certified_at is not null or review_acknowledged is not null);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['loads', 'fuel_purchases', 'deductions', 'reimbursements', 'maintenance_records', 'tolls', 'driver_payments'] loop
    execute format('drop trigger if exists %I on %I', t || '_clears_certification', t);
    execute format(
      'create trigger %I after insert or update or delete on %I for each row execute function settlement_child_clears_certification()',
      t || '_clears_certification', t
    );
  end loop;
end $$;

-- Read-only check (9 column rows; then 8 trigger rows):
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'settlements'
--   and column_name in ('loaded_miles','empty_miles','miles_split_source','miles_split_label','miles_split_flag',
--                       'review_acknowledged','certified_at','certification_text_version','certification_app_version')
-- order by column_name;
--
-- select event_object_table, trigger_name from information_schema.triggers
-- where trigger_name like '%certification%' group by 1, 2 order by 1;
