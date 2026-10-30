-- PENDING_SQL §81 — TRUCK PURCHASE TAX TREATMENT + PURCHASE DOCUMENT
-- (owner decision 2026-10-30, master plan batch B). Two new nullable
-- columns on trucks; nothing dropped or altered. Safe to run twice.

alter table trucks add column if not exists purchase_tax_treatment text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trucks_purchase_tax_treatment_check'
      and conrelid = 'public.trucks'::regclass
  ) then
    alter table trucks add constraint trucks_purchase_tax_treatment_check
      check (purchase_tax_treatment is null
             or purchase_tax_treatment in ('deduct_purchase_year', 'no_deduction', 'preparer_decides'));
  end if;
end $$;

alter table trucks add column if not exists purchase_document_id uuid references documents on delete set null;

-- Read-only check (two rows; then one constraint row):
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'trucks'
--   and column_name in ('purchase_tax_treatment', 'purchase_document_id')
-- order by column_name;
--
-- select conname from pg_constraint
-- where conrelid = 'public.trucks'::regclass
--   and conname = 'trucks_purchase_tax_treatment_check';
