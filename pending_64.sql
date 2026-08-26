-- docs/PENDING_SQL.md §64 — DELETE A TRUCK: truck_id FK cascade fix
-- (owner decision, adversarial-audit finding). Fixes 5 FKs that default
-- to RESTRICT (no `on delete` clause specified at creation) so a truck
-- can never actually be deleted while it has any settlement/fuel/
-- maintenance/deduction/toll row. See docs/PENDING_SQL.md §64 for the
-- full rationale (why the constraint name is looked up dynamically
-- rather than guessed, what's deliberately left unchanged, and the
-- business-balance/tax/capital consistency statement).

-- 64a. Drop whichever constraint currently enforces settlements/
-- fuel_purchases/maintenance_records/deductions/tolls.truck_id -> trucks,
-- by its ACTUAL name (never guessed).
do $$
declare
  con record;
  match_count int;
begin
  for con in
    select c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'trucks'::regclass
      and c.conrelid in (
        'settlements'::regclass, 'fuel_purchases'::regclass,
        'maintenance_records'::regclass, 'deductions'::regclass,
        'tolls'::regclass
      )
  loop
    select count(*) into match_count
    from pg_constraint
    where contype = 'f' and confrelid = 'trucks'::regclass and conrelid = con.conrelid::regclass;
    if match_count <> 1 then
      raise exception 'expected exactly one FK from % to trucks, found %', con.tbl, match_count;
    end if;
    execute format('alter table %s drop constraint %I', con.tbl, con.conname);
  end loop;
end $$;

-- 64b. Re-add all 5 as ON DELETE CASCADE, under a fixed name.
do $$ begin
  alter table settlements add constraint settlements_truck_id_fkey
    foreign key (truck_id) references trucks(id) on delete cascade;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table fuel_purchases add constraint fuel_purchases_truck_id_fkey
    foreign key (truck_id) references trucks(id) on delete cascade;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table maintenance_records add constraint maintenance_records_truck_id_fkey
    foreign key (truck_id) references trucks(id) on delete cascade;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table deductions add constraint deductions_truck_id_fkey
    foreign key (truck_id) references trucks(id) on delete cascade;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table tolls add constraint tolls_truck_id_fkey
    foreign key (truck_id) references trucks(id) on delete cascade;
exception when duplicate_object then null;
end $$;
