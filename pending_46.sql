-- docs/PENDING_SQL.md §46 — trucks depreciation election
-- (FULL PARITY follow-up, owner decision 2026-08-05, spec item E)

alter table trucks
  add column depreciation_method text check (depreciation_method in ('full','macrs','spread','ask')),
  add column depreciation_year_placed_in_service integer,
  add column depreciation_spread_years integer,
  add column trailer_depreciation_method text check (trailer_depreciation_method in ('full','macrs','spread','ask')),
  add column trailer_depreciation_year_placed_in_service integer,
  add column trailer_depreciation_spread_years integer;
