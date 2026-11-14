-- §87 PR OWNER MONEY IN BACKFILL, 07/17 ONLY (owner decision 2026-11-13)
-- The 07/17 week was saved with lines_not_saved = true, so its PR 3,999.00
-- credit row and its Capital Account contribution were never written (code
-- fixed in 100e768). This writes exactly what the fixed code writes
-- (aiImportSave.ts PR block): one PR credit deduction on the settlement and
-- one id-linked contribution with the same tx_type and note.
-- Touches ONE settlement only: week ending 2026-07-17, statement PR total
-- 3,999.00, no PR row yet. 08/21 already has its PR row + contribution and is
-- never selected. Safe to run twice (the second run finds a PR row and writes
-- nothing). Writes nothing unless exactly one settlement matches.

-- 1) PREVIEW (read-only). Expect exactly ONE row: 2026-07-17, pr_total 3999.00.
select s.id, s.user_id, s.week_ending, s.truck_id,
       s.statement->>'linesNotSaved' as lines_not_saved,
       (s.statement->'prime'->>'prReimbursementTotal')::numeric as pr_total
from settlements s
where s.week_ending = '2026-07-17'
  and (s.statement->'prime'->>'prReimbursementTotal')::numeric = 3999.00
  and not exists (select 1 from deductions d where d.settlement_id = s.id and upper(coalesce(d.code, '')) = 'PR');

-- 2) WRITE. Run only if the preview returned exactly one row.
with cand as (
  select s.id as settlement_id, s.user_id, s.truck_id, s.driver_id, s.document_id, s.week_ending,
         round((s.statement->'prime'->>'prReimbursementTotal')::numeric, 2) as pr_total
  from settlements s
  where s.week_ending = '2026-07-17'
    and (s.statement->'prime'->>'prReimbursementTotal')::numeric = 3999.00
    and not exists (select 1 from deductions d where d.settlement_id = s.id and upper(coalesce(d.code, '')) = 'PR')
), target as (
  select * from cand where (select count(*) from cand) = 1
), ded as (
  insert into deductions (user_id, truck_id, driver_id, settlement_id, document_id, ded_date, code, description,
                          amount, category, payment_method, source, tax_deductible, economic_class, direction)
  select user_id, truck_id, driver_id, settlement_id, document_id, week_ending, 'PR', 'PERSONAL PYMNT RCV',
         -pr_total, null, 'Settlement Withheld', 'settlement', false, 'PERSONAL', 'credit'
  from target
  returning id, user_id, ded_date, amount, description
)
insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id)
select user_id, 'contribution', abs(amount), ded_date, description || ' — owner money in (Prime settlement)', id
from ded;

-- 3) VERIFY (read-only). Expect 2026-07-17 3999.00 and the existing 2026-08-21 1.00.
select s.week_ending, c.tx_type, c.tx_date, c.amount, c.note, d.code, d.amount as deduction_amount
from capital_transactions c
join deductions d on d.id = c.linked_deduction_id
left join settlements s on s.id = d.settlement_id
where c.note like '%owner money in%'
order by c.tx_date;
