-- docs/PENDING_SQL.md §42 — one-time date repair migration
-- (FULL PARITY pass, owner decision 2026-08-05, spec item D.1)

create or replace function repair_implausible_date(d date, year_floor int, year_ceiling int)
returns date
language plpgsql
as $$
declare
  yr int := extract(year from d)::int;
  mo int := extract(month from d)::int;
  dy int := extract(day from d)::int;
  century int := (yr / 100) * 100;
  swapped_year int := century + dy;
  swapped_day int := yr % 100;
  candidate date;
begin
  if yr >= year_floor and yr <= year_ceiling then
    return d; -- already plausible, no repair needed
  end if;
  if swapped_day < 1 or swapped_day > 31 then
    return d; -- can't form a valid day-of-month from the swap — leave as-is
  end if;
  begin
    candidate := make_date(swapped_year, mo, swapped_day);
  exception when others then
    return d; -- not a real calendar date (e.g. day 31 in April) — leave as-is
  end;
  if swapped_year < year_floor or swapped_year > year_ceiling then
    return d; -- the swapped reading is ALSO implausible — leave as-is
  end if;
  return candidate;
end;
$$;

do $$
declare
  y_floor int := 2020;
  y_ceiling int := extract(year from current_date)::int + 1;
begin
  update settlements set week_ending = repair_implausible_date(week_ending, y_floor, y_ceiling)
    where week_ending is not null and (extract(year from week_ending) < y_floor or extract(year from week_ending) > y_ceiling);

  update loads set pickup_date = repair_implausible_date(pickup_date, y_floor, y_ceiling)
    where pickup_date is not null and (extract(year from pickup_date) < y_floor or extract(year from pickup_date) > y_ceiling);
  update loads set delivery_date = repair_implausible_date(delivery_date, y_floor, y_ceiling)
    where delivery_date is not null and (extract(year from delivery_date) < y_floor or extract(year from delivery_date) > y_ceiling);
  update loads set load_date = repair_implausible_date(load_date, y_floor, y_ceiling)
    where load_date is not null and (extract(year from load_date) < y_floor or extract(year from load_date) > y_ceiling);

  update deductions set ded_date = repair_implausible_date(ded_date, y_floor, y_ceiling)
    where ded_date is not null and (extract(year from ded_date) < y_floor or extract(year from ded_date) > y_ceiling);

  update reimbursements set reimb_date = repair_implausible_date(reimb_date, y_floor, y_ceiling)
    where reimb_date is not null and (extract(year from reimb_date) < y_floor or extract(year from reimb_date) > y_ceiling);

  update fuel_purchases set purchase_date = repair_implausible_date(purchase_date, y_floor, y_ceiling)
    where purchase_date is not null and (extract(year from purchase_date) < y_floor or extract(year from purchase_date) > y_ceiling);

  update maintenance_records set service_date = repair_implausible_date(service_date, y_floor, y_ceiling)
    where service_date is not null and (extract(year from service_date) < y_floor or extract(year from service_date) > y_ceiling);

  update tolls set toll_date = repair_implausible_date(toll_date, y_floor, y_ceiling)
    where toll_date is not null and (extract(year from toll_date) < y_floor or extract(year from toll_date) > y_ceiling);
end $$;
