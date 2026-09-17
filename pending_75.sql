-- docs/PENDING_SQL.md §75 — MAP EXISTING OUT-OF-POCKET DEDUCTIONS INTO
-- THE 16 ACCOUNTANT CATEGORIES (owner decision 2026-09-17). See that
-- section for the full reasoning, especially the ORIGIN RULE (this
-- column must only ever be set on a row where source != 'settlement' —
-- enforced entirely in application code, see
-- app/src/primeDriverExpenses/categoryMapping.ts).

alter table deductions add column if not exists accountant_category text
  check (accountant_category in (
    'Lumpers', 'Cash Tolls/Parking Fees', 'Scales',
    'Equipment/Operating Supplies', 'Safety/Weather Gear', 'Cash Fuel',
    'Oil & Additives', 'Truck & Trailer Wash', 'Repairs', 'Communication',
    'Advertising', 'Office Supplies', 'Lodging', 'Laundry/Showers',
    'Bank/ATM Fees', 'Misc'
  ));

alter table profiles add column if not exists prime_driver_days_override jsonb not null default '{}'::jsonb;
