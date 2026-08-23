-- docs/PENDING_SQL.md §40 — category taxonomy rename migration
-- (FULL PARITY pass, owner decision 2026-08-05)

update deductions set category = 'Legal & Professional Services'
  where category in ('Professional Services', 'Legal & Accounting Fees');
update deductions set category = 'Insurance—Truck' where category = 'Insurance';
update deductions set category = 'Permits, Licenses & Road Taxes' where category = 'Licensing & Permits';
update deductions set category = 'Truck Supplies & Equipment' where category = 'Truck Supplies';
update deductions set category = 'Safety Gear & Workwear' where category = 'Safety Equipment';
update deductions set category = 'Misc' where category in ('Fixed', 'Variable');

update user_categories set schedule_c_bucket = 'Legal & Professional Services'
  where schedule_c_bucket in ('Professional Services', 'Legal & Accounting Fees');
update user_categories set schedule_c_bucket = 'Insurance—Truck' where schedule_c_bucket = 'Insurance';
update user_categories set schedule_c_bucket = 'Permits, Licenses & Road Taxes' where schedule_c_bucket = 'Licensing & Permits';
update user_categories set schedule_c_bucket = 'Truck Supplies & Equipment' where schedule_c_bucket = 'Truck Supplies';
update user_categories set schedule_c_bucket = 'Safety Gear & Workwear' where schedule_c_bucket = 'Safety Equipment';
update user_categories set schedule_c_bucket = 'Misc' where schedule_c_bucket in ('Fixed', 'Variable');
