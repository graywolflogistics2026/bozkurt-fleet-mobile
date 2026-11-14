-- §88 CARRIER PAYROLL DRIVERS (owner decision 2026-11-13). Safe to run twice.
-- Run in the Supabase SQL Editor, ONE PART AT A TIME, in order:
--   PART 1 PREVIEW  (read-only)  -> check the numbers below
--   PART 2 WRITE    (schema + backfill of 11/06 and 11/13, one transaction)
--   PART 3 VERIFY   (read-only)
-- Attribution only: no settlement, deduction, capital or profit row changes
-- (PART 2 only adds columns, the driver, two driver_payments rows and the
-- team_week label). Source of the backfill: documents.parsed_json (the full
-- extraction saved with each week), so it works even where the week's line
-- rows were not saved. The driver's name is NOT in the saved data: the
-- driver is created as "BOZKME" and the Drivers screen asks "Who is BOZKME?"
-- once (or the next imported week fills it from the payroll recap page).

-- =====================================================================
-- PART 1 — PREVIEW (read-only). Run alone first.
-- =====================================================================
-- 1a. The wage lines saved with each week (expected: 6 lines per week,
--     DF DU DU WC WD 2S, every description ending in BOZKME; driver_code
--     BOZKME on every line).
select s.week_ending,
       s.id as settlement_id,
       wi->>'code' as code,
       wi->>'desc' as description,
       (wi->>'amount')::numeric as amount,
       (regexp_match(upper(trim(wi->>'desc')), '\s([A-Z][A-Z0-9]{2,9})$'))[1] as driver_code,
       (doc.parsed_json->'settlement'->>'totalWageExpense')::numeric as total_wage_expense
from settlements s
join documents doc on doc.id = s.document_id
cross join lateral jsonb_array_elements(coalesce(doc.parsed_json->'settlement'->'wageItems', '[]'::jsonb)) wi
where s.week_ending in ('2026-11-06', '2026-11-13')
order by s.week_ending, wi->>'code';

-- 1b. What PART 2 will write, per week and driver. Expected:
--   2026-11-06 BOZKME wages 665.11 taxes 60.73 work_comp 79.66 total 805.50
--   2026-11-13 BOZKME wages 913.06 taxes 76.85 work_comp 109.15 total 1099.06
--   team_week true on both (each prints "+ TEAM" on its revenue lines).
-- 0 rows or a missing driver_code = the saved data does not allow the
-- backfill: re-import that week after the eas update instead.
with lines as (
  select s.id as settlement_id, s.user_id, s.week_ending,
         upper(trim(wi->>'code')) as code,
         (wi->>'amount')::numeric as amount,
         nullif((regexp_match(upper(trim(wi->>'desc')), '\s([A-Z][A-Z0-9]{2,9})$'))[1], '') as line_code,
         (doc.parsed_json->'settlement'->>'totalWageExpense')::numeric as twe,
         regexp_replace(regexp_replace(upper(coalesce(doc.parsed_json->'settlement'->>'carrier', '')), '[.,]', '', 'g'), '\s+', ' ', 'g') as carrier_key,
         exists (select 1 from jsonb_array_elements(coalesce(doc.parsed_json->'settlement'->'revenueItems', '[]'::jsonb)) r
                 where r->>'desc' ~* '\+\s*TEAM\y') as team_week
  from settlements s
  join documents doc on doc.id = s.document_id
  cross join lateral jsonb_array_elements(coalesce(doc.parsed_json->'settlement'->'wageItems', '[]'::jsonb)) wi
  where s.week_ending in ('2026-11-06', '2026-11-13')
), clean as (
  select *, case when line_code in ('FOR','COST','PAID','BNF','TAX','TAXES','WAGE','WAGES','COMP','PAY','FEE','WELLNESS','DRIVER') then null else line_code end as dcode
  from lines where trim(carrier_key) = 'PRIME INC'
), codes as (
  select settlement_id, array_agg(distinct dcode) as codes from clean where code = 'WD' and dcode is not null group by settlement_id
), per as (
  select c.settlement_id, c.user_id, c.week_ending, bool_or(c.team_week) as team_week,
         case when c.dcode = any(k.codes) then c.dcode when cardinality(k.codes) = 1 then k.codes[1] end as driver_code,
         cardinality(k.codes) as n_drivers,
         round(coalesce(sum(c.amount) filter (where c.code in ('WD','2S')), 0), 2) as wages,
         round(coalesce(sum(c.amount) filter (where c.code in ('DF','DU')), 0), 2) as employer_taxes,
         round(coalesce(sum(c.amount) filter (where c.code = 'WC'), 0), 2) as work_comp,
         round(sum(c.amount), 2) as line_sum,
         max(c.twe) as twe
  from clean c join codes k using (settlement_id)
  group by 1, 2, 3, 5, 6
)
select week_ending, driver_code, wages, employer_taxes, work_comp,
       case when n_drivers = 1 and twe > 0 then round(twe, 2) else line_sum end as total,
       line_sum, team_week
from per where driver_code is not null
order by week_ending, driver_code;

-- 1c. Drivers already on file (a driver you typed in by hand is NOT
--     linked: PART 2 creates a separate carrier-payroll driver "BOZKME").
select id, name, compensation_type, active from drivers order by created_at;

-- =====================================================================
-- PART 2 — WRITE (schema + backfill). Safe to run twice.
-- =====================================================================
begin;

alter table drivers add column if not exists carrier text;
alter table drivers add column if not exists carrier_driver_code text;
alter table drivers add column if not exists paid_via_carrier_payroll boolean not null default false;
create unique index if not exists drivers_user_carrier_code_uidx
  on drivers (user_id, carrier, carrier_driver_code) where carrier_driver_code is not null;

alter table driver_payments add column if not exists work_comp numeric(12,2) not null default 0;
alter table driver_payments add column if not exists total_cost numeric(12,2);
alter table driver_payments add column if not exists source text not null default 'manual';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'driver_payments_source_check') then
    alter table driver_payments add constraint driver_payments_source_check check (source in ('manual', 'settlement'));
  end if;
end $$;

alter table settlements add column if not exists team_week boolean;

-- The per-week figures of 1b, kept for the three statements below.
create temp table cp88 on commit drop as
with lines as (
  select s.id as settlement_id, s.user_id, s.week_ending,
         upper(trim(wi->>'code')) as code,
         (wi->>'amount')::numeric as amount,
         nullif((regexp_match(upper(trim(wi->>'desc')), '\s([A-Z][A-Z0-9]{2,9})$'))[1], '') as line_code,
         (doc.parsed_json->'settlement'->>'totalWageExpense')::numeric as twe,
         regexp_replace(regexp_replace(upper(coalesce(doc.parsed_json->'settlement'->>'carrier', '')), '[.,]', '', 'g'), '\s+', ' ', 'g') as carrier_key,
         exists (select 1 from jsonb_array_elements(coalesce(doc.parsed_json->'settlement'->'revenueItems', '[]'::jsonb)) r
                 where r->>'desc' ~* '\+\s*TEAM\y') as team_week
  from settlements s
  join documents doc on doc.id = s.document_id
  cross join lateral jsonb_array_elements(coalesce(doc.parsed_json->'settlement'->'wageItems', '[]'::jsonb)) wi
  where s.week_ending in ('2026-11-06', '2026-11-13')
), clean as (
  select *, case when line_code in ('FOR','COST','PAID','BNF','TAX','TAXES','WAGE','WAGES','COMP','PAY','FEE','WELLNESS','DRIVER') then null else line_code end as dcode
  from lines where trim(carrier_key) = 'PRIME INC'
), codes as (
  select settlement_id, array_agg(distinct dcode) as codes from clean where code = 'WD' and dcode is not null group by settlement_id
), per as (
  select c.settlement_id, c.user_id, c.week_ending, bool_or(c.team_week) as team_week,
         case when c.dcode = any(k.codes) then c.dcode when cardinality(k.codes) = 1 then k.codes[1] end as driver_code,
         cardinality(k.codes) as n_drivers,
         round(coalesce(sum(c.amount) filter (where c.code in ('WD','2S')), 0), 2) as wages,
         round(coalesce(sum(c.amount) filter (where c.code in ('DF','DU')), 0), 2) as employer_taxes,
         round(coalesce(sum(c.amount) filter (where c.code = 'WC'), 0), 2) as work_comp,
         round(sum(c.amount), 2) as line_sum,
         max(c.twe) as twe
  from clean c join codes k using (settlement_id)
  group by 1, 2, 3, 5, 6
)
select settlement_id, user_id, week_ending, team_week, driver_code, wages, employer_taxes, work_comp,
       case when n_drivers = 1 and twe > 0 then round(twe, 2) else line_sum end as total
from per where driver_code is not null;

-- The driver (one per user + carrier + code). Name = the code until the
-- owner answers "Who is BOZKME?" on the Drivers screen.
insert into drivers (user_id, name, carrier, carrier_driver_code, paid_via_carrier_payroll, compensation_type, active)
select distinct c.user_id, c.driver_code, 'PRIME INC', c.driver_code, true, 'w2_employee', true
from cp88 c
where not exists (select 1 from drivers d where d.user_id = c.user_id and d.carrier = 'PRIME INC' and d.carrier_driver_code = c.driver_code);

-- One driver_payments row per week and driver (attribution only).
insert into driver_payments (user_id, driver_id, settlement_id, date, gross_pay, employer_taxes, work_comp, total_cost, source, notes)
select c.user_id, d.id, c.settlement_id, c.week_ending, c.wages, c.employer_taxes, c.work_comp, c.total, 'settlement', 'W-2 via carrier payroll'
from cp88 c
join drivers d on d.user_id = c.user_id and d.carrier = 'PRIME INC' and d.carrier_driver_code = c.driver_code
where not exists (select 1 from driver_payments p where p.settlement_id = c.settlement_id and p.driver_id = d.id and p.source = 'settlement');

-- The "+ TEAM" label of the two weeks (only where not set yet).
update settlements s set team_week = x.team_week
from (select settlement_id, bool_or(team_week) as team_week from cp88 group by settlement_id) x
where s.id = x.settlement_id and s.team_week is null;

commit;

-- =====================================================================
-- PART 3 — VERIFY (read-only). Expected:
--   one driver BOZKME, PRIME INC, paid_via_carrier_payroll true, w2_employee
--   2026-11-06 665.11 / 60.73 / 79.66 / 805.50 settlement
--   2026-11-13 913.06 / 76.85 / 109.15 / 1099.06 settlement
--   year to date total 1,904.56, 2 paid weeks
-- =====================================================================
select d.name, d.carrier, d.carrier_driver_code, d.paid_via_carrier_payroll, d.compensation_type,
       p.date, p.gross_pay, p.employer_taxes, p.work_comp, p.total_cost, p.source, s.week_ending, s.team_week
from drivers d
join driver_payments p on p.driver_id = d.id
left join settlements s on s.id = p.settlement_id
where d.paid_via_carrier_payroll
order by p.date;

select count(*) as paid_weeks, sum(total_cost) as ytd_total
from driver_payments
where source = 'settlement' and date >= '2026-01-01';
