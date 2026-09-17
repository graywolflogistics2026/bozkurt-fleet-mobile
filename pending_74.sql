-- docs/PENDING_SQL.md §74 — "FOR PRIME INC DRIVERS" OUT-OF-POCKET
-- EXPENSE TRACKER (owner decision 2026-09-17). A brand-new, standalone
-- table — deliberately NOT `deductions` — for a manual-entry-only screen
-- that exists purely to match a specific monthly report format the
-- user's accountant requires. `category` is one of the 16 fixed,
-- accountant-template values in
-- app/src/primeDriverExpenses/categories.ts's
-- PRIME_DRIVER_EXPENSE_CATEGORIES — a completely separate vocabulary
-- from CANONICAL_CATEGORIES, kept in sync here by hand (same "TS enum
-- and SQL check constraint kept in sync manually" convention as every
-- other category-shaped check constraint in this schema).
create table prime_driver_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exp_date date not null,
  amount numeric(12,2) not null,
  category text not null check (category in (
    'Lumpers',
    'Cash Tolls/Parking Fees',
    'Scales',
    'Equipment/Operating Supplies',
    'Safety/Weather Gear',
    'Cash Fuel',
    'Oil & Additives',
    'Truck & Trailer Wash',
    'Repairs',
    'Communication',
    'Advertising',
    'Office Supplies',
    'Lodging',
    'Laundry/Showers',
    'Bank/ATM Fees',
    'Misc'
  )),
  note text,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create index prime_driver_expenses_user_id_idx on prime_driver_expenses(user_id, exp_date desc);

alter table prime_driver_expenses enable row level security;
create policy "prime_driver_expenses_select_own" on prime_driver_expenses
  for select using (auth.uid() = user_id);
create policy "prime_driver_expenses_insert_own" on prime_driver_expenses
  for insert with check (auth.uid() = user_id);
create policy "prime_driver_expenses_update_own" on prime_driver_expenses
  for update using (auth.uid() = user_id);
create policy "prime_driver_expenses_delete_own" on prime_driver_expenses
  for delete using (auth.uid() = user_id);

-- `user_id ... on delete cascade` means delete-account needs NO explicit
-- table-list entry (same precedent as import_jobs/ai_credit_purchases —
-- auth.admin.deleteUser() cleans it up automatically); reset-data DOES
-- need one (it never deletes the auth user) — already added to
-- TABLES_IN_DELETION_ORDER there. `document_id ... on delete set null`
-- mirrors deductions.document_id's own pattern (an attached receipt's
-- `documents` row can be cleaned up independently without taking the
-- expense row down with it).
