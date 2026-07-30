# One-time repair — DATE HARDENING round 2 (owner decision 2026-07-30)

Existing rows imported before this pass can have a year/day-swapped date
baked in from the same carrier-header ambiguity the app-side fix now
guards against (see `app/src/import/dateGuard.ts`): a document actually
dated e.g. 2026-07-24 (carrier header printed `26/07/24`, YY/MM/DD) got
saved as `2024-07-26` (year and day transposed, month untouched). This is
a **manual, one-time SQL repair** run directly in the Supabase SQL editor
— same convention as `docs/ADMIN_RUNBOOK.md` — not an app feature, and not
something the client repairs automatically on its own (no code path
should ever silently rewrite a user's saved data without them seeing it
happen).

**Always run the PREVIEW query for a table first and actually look at the
rows it returns before running that table's UPDATE.** The swap is only
applied when (a) the stored date is more than 13 months before today AND
(b) swapping its year and day lands within a plausible recent window (13
months back through 1 month forward) — the same two-sided check
`correctImplausibleDate()` uses — but a genuinely old, correctly-dated
row is still possible in principle, so eyeball the preview rather than
running every UPDATE blind.

## 1. Create the helper function (once, drop it at the end)

```sql
create or replace function try_swap_year_and_day(d date)
returns date
language plpgsql
as $$
declare
  y int := extract(year from d);
  m int := extract(month from d);
  day_of_month int := extract(day from d);
  century int := (y / 100) * 100;
  swapped_year int := century + day_of_month;
  swapped_day int := y % 100;
  result date;
begin
  if swapped_day < 1 or swapped_day > 31 then
    return null;
  end if;
  begin
    result := make_date(swapped_year, m, swapped_day);
  exception when others then
    return null; -- e.g. day 31 in a 30-day month — not a real date
  end;
  return result;
end;
$$;
```

## 2. Preview + repair, per table

Run the PREVIEW for a table, review the `old_date`/`candidate_new_date`
columns, then run that table's UPDATE only once you're satisfied.

### settlements.week_ending

```sql
-- PREVIEW
select id, user_id, week_ending as old_date, try_swap_year_and_day(week_ending) as candidate_new_date
from settlements
where week_ending < (current_date - interval '13 months')
  and try_swap_year_and_day(week_ending) is not null
  and try_swap_year_and_day(week_ending) between (current_date - interval '13 months') and (current_date + interval '1 month');

-- REPAIR
update settlements
set week_ending = try_swap_year_and_day(week_ending)
where week_ending < (current_date - interval '13 months')
  and try_swap_year_and_day(week_ending) is not null
  and try_swap_year_and_day(week_ending) between (current_date - interval '13 months') and (current_date + interval '1 month');
```

### loads (load_date, pickup_date, delivery_date)

```sql
-- PREVIEW (all three columns at once, one row per load with any candidate fix)
select id, user_id,
  load_date as old_load_date, try_swap_year_and_day(load_date) as new_load_date,
  pickup_date as old_pickup_date, try_swap_year_and_day(pickup_date) as new_pickup_date,
  delivery_date as old_delivery_date, try_swap_year_and_day(delivery_date) as new_delivery_date
from loads
where (load_date < (current_date - interval '13 months') and try_swap_year_and_day(load_date) between (current_date - interval '13 months') and (current_date + interval '1 month'))
   or (pickup_date < (current_date - interval '13 months') and try_swap_year_and_day(pickup_date) between (current_date - interval '13 months') and (current_date + interval '1 month'))
   or (delivery_date < (current_date - interval '13 months') and try_swap_year_and_day(delivery_date) between (current_date - interval '13 months') and (current_date + interval '1 month'));

-- REPAIR (each column independently — only touches a column when ITS OWN swap qualifies)
update loads set load_date = try_swap_year_and_day(load_date)
where load_date < (current_date - interval '13 months')
  and try_swap_year_and_day(load_date) is not null
  and try_swap_year_and_day(load_date) between (current_date - interval '13 months') and (current_date + interval '1 month');

update loads set pickup_date = try_swap_year_and_day(pickup_date)
where pickup_date < (current_date - interval '13 months')
  and try_swap_year_and_day(pickup_date) is not null
  and try_swap_year_and_day(pickup_date) between (current_date - interval '13 months') and (current_date + interval '1 month');

update loads set delivery_date = try_swap_year_and_day(delivery_date)
where delivery_date < (current_date - interval '13 months')
  and try_swap_year_and_day(delivery_date) is not null
  and try_swap_year_and_day(delivery_date) between (current_date - interval '13 months') and (current_date + interval '1 month');
```

### fuel_purchases.purchase_date

```sql
-- PREVIEW
select id, user_id, purchase_date as old_date, try_swap_year_and_day(purchase_date) as candidate_new_date
from fuel_purchases
where purchase_date < (current_date - interval '13 months')
  and try_swap_year_and_day(purchase_date) is not null
  and try_swap_year_and_day(purchase_date) between (current_date - interval '13 months') and (current_date + interval '1 month');

-- REPAIR
update fuel_purchases
set purchase_date = try_swap_year_and_day(purchase_date)
where purchase_date < (current_date - interval '13 months')
  and try_swap_year_and_day(purchase_date) is not null
  and try_swap_year_and_day(purchase_date) between (current_date - interval '13 months') and (current_date + interval '1 month');
```

### deductions.ded_date

```sql
-- PREVIEW
select id, user_id, ded_date as old_date, try_swap_year_and_day(ded_date) as candidate_new_date
from deductions
where ded_date < (current_date - interval '13 months')
  and try_swap_year_and_day(ded_date) is not null
  and try_swap_year_and_day(ded_date) between (current_date - interval '13 months') and (current_date + interval '1 month');

-- REPAIR
update deductions
set ded_date = try_swap_year_and_day(ded_date)
where ded_date < (current_date - interval '13 months')
  and try_swap_year_and_day(ded_date) is not null
  and try_swap_year_and_day(ded_date) between (current_date - interval '13 months') and (current_date + interval '1 month');
```

**Deliberately NOT touched by this repair**: `loans.next_due` and any
compliance `due_date` — these are forward-looking fields (a due date is
supposed to be in the future), not "when did this happen" document dates,
so the same recency heuristic doesn't apply to them (matches
`sanitizeExtractionDates()`'s scoping — see its file comment).

## 3. Per diem — no separate action needed

`app/src/tax/perDiem.ts`'s `calcPerDiemDays()` recomputes `7 × distinct
settlement weeks` fresh from whatever `settlements.week_ending` values
exist, every time it's called — it's a pure function over live data, not
a stored/cached count. Once step 2's `settlements` UPDATE runs, per diem
is automatically correct on the very next read. If the repair causes two
previously-distinct week_ending values to collapse into one (two
mis-dated settlements both correcting to the same real week), the
`Set`-based dedup already treats that as one week — which is the correct
outcome, not a bug to work around.

## 4. Clean up

```sql
drop function try_swap_year_and_day(date);
```
