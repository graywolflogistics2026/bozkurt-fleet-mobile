-- §86 PRIME CODES 2S, SF, CU, NQ (owner decision 2026-11-13, K3 approved)
-- Idempotent: inserts each row only when (carrier, code) has no row with a
-- null sub_code, then sets the approved values, so it can run twice.
-- Only reference data (carrier_code_maps, global); no user data is touched.

insert into carrier_code_maps (carrier, code, sub_code, label, description, category, is_deductible, income_or_chargeback, economic_class, notes)
select v.carrier, v.code, null, v.label, v.description, v.category, v.is_deductible, 'chargeback', v.economic_class, v.notes
from (values
  ('PRIME INC', '2S', 'WELLNESS BENEFIT', 'Wellness benefit charged in the WAGE EXPENSE section for the operator''s company driver', 'Wages & Payroll Taxes (W-2)', true, 'WAGES', 'Owner decision 2026-11-13 (K3). Seen 11/06 1.24, 11/13 3.45.'),
  ('PRIME INC', 'SF', 'STATE FUEL TAX', 'State fuel tax; a FUEL TAX ADJUSTMENT credit nets against it in the same group', 'Fuel & DEF', true, 'EXPENSE_VARIABLE', 'Owner decision 2026-11-13 (K3).'),
  ('PRIME INC', 'CU', 'CAFE PURCHASE', 'Cafe purchase charged through the statement (e.g. ** CAFE SLC, UT **), like PO POINT OF SALE', 'Meals (per diem covered)', false, 'PERSONAL', 'Owner decision 2026-11-13 (K3). Seen 11/13 63.06.'),
  ('PRIME INC', 'NQ', 'NQ COMMUNICATION', 'Communication charge', 'ELD & Communications', true, 'EXPENSE_VARIABLE', 'Owner decision 2026-11-13 (K3).')
) as v(carrier, code, label, description, category, is_deductible, economic_class, notes)
where not exists (
  select 1 from carrier_code_maps m
  where m.carrier = v.carrier and m.code = v.code and m.sub_code is null
);

update carrier_code_maps set category = 'Wages & Payroll Taxes (W-2)', is_deductible = true, income_or_chargeback = 'chargeback', economic_class = 'WAGES'
  where carrier = 'PRIME INC' and code = '2S' and sub_code is null;
update carrier_code_maps set category = 'Fuel & DEF', is_deductible = true, income_or_chargeback = 'chargeback', economic_class = 'EXPENSE_VARIABLE'
  where carrier = 'PRIME INC' and code = 'SF' and sub_code is null;
update carrier_code_maps set category = 'Meals (per diem covered)', is_deductible = false, income_or_chargeback = 'chargeback', economic_class = 'PERSONAL'
  where carrier = 'PRIME INC' and code = 'CU' and sub_code is null;
update carrier_code_maps set category = 'ELD & Communications', is_deductible = true, income_or_chargeback = 'chargeback', economic_class = 'EXPENSE_VARIABLE'
  where carrier = 'PRIME INC' and code = 'NQ' and sub_code is null;
