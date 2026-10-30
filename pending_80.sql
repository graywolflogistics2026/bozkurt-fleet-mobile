-- docs/PENDING_SQL.md §80 — delete a document and everything linked (batch A item 7, 2026-10-30).
-- New functions only: no table, no column, no constraint is created, dropped or altered.
-- settlements.document_id keeps its existing rule (no ON DELETE); the delete
-- function deletes or un-links the settlement itself before the document.
--
-- Reuses the existing atomic paths instead of a parallel delete:
--   * settlement children (loads, fuel, reimbursements, withheld deductions,
--     maintenance, tolls) go by the FK cascades on settlement_id (§61, §64);
--   * the §70 trigger reverse_settlement_business_balance_credit() fires on
--     every settlement row removed;
--   * capital contributions and auto-created equipment go by the
--     linked_deduction_id cascades (§60/§62, §73);
--   * loans are a standing obligation and are KEPT (§70 Part B), only
--     un-linked by their own ON DELETE SET NULL.
-- Everything runs inside the one function call = one transaction: all or nothing.

begin;

-- Internal: every row a document delete touches, with its kind:
--   derived  = created by importing this document (settlement and its children,
--              their linked contributions/equipment, the import job, the
--              driver's settlement share);
--   attached = a record that only has this file attached;
--   kept     = linked but never deleted (loans).
create or replace function document_linked_rows(p_doc_id uuid, p_uid uuid)
returns table (tbl text, row_id uuid, amount numeric, kind text)
language sql
stable
security definer
set search_path = public
as $$
  with
  sett as (select s.id from settlements s where s.document_id = p_doc_id and s.user_id = p_uid),
  ded as (
    select d.id, d.amount, case when d.settlement_id in (select id from sett) then 'derived' else 'attached' end as kind
    from deductions d
    where d.user_id = p_uid and (d.settlement_id in (select id from sett) or d.document_id = p_doc_id)
  ),
  maint as (
    select m.id, m.cost, case when m.settlement_id in (select id from sett) then 'derived' else 'attached' end as kind
    from maintenance_records m
    where m.user_id = p_uid and (m.settlement_id in (select id from sett) or m.document_id = p_doc_id)
  )
  select 'settlements', s.id, s.gross, 'derived' from settlements s where s.id in (select id from sett)
  union all select 'loads', l.id, l.revenue, 'derived' from loads l where l.user_id = p_uid and l.settlement_id in (select id from sett)
  union all select 'fuel_purchases', f.id, f.amount, 'derived' from fuel_purchases f where f.user_id = p_uid and f.settlement_id in (select id from sett)
  union all select 'reimbursements', r.id, r.amount, 'derived' from reimbursements r where r.user_id = p_uid and r.settlement_id in (select id from sett)
  union all select 'tolls', t.id, t.amount, 'derived' from tolls t where t.user_id = p_uid and t.settlement_id in (select id from sett)
  union all select 'deductions', d.id, d.amount, d.kind from ded d
  union all select 'maintenance_records', m.id, m.cost, m.kind from maint m
  union all select 'capital_transactions', c.id, c.amount, (select d.kind from ded d where d.id = c.linked_deduction_id)
    from capital_transactions c where c.user_id = p_uid and c.linked_deduction_id in (select id from ded)
  union all select 'equipment', e.id, e.purchase_price, (select d.kind from ded d where d.id = e.linked_deduction_id)
    from equipment e where e.user_id = p_uid and e.linked_deduction_id in (select id from ded)
  union all select 'driver_payments', p.id, p.gross_pay, 'derived' from driver_payments p where p.user_id = p_uid and p.settlement_id in (select id from sett)
  union all select 'import_jobs', j.id, null::numeric, 'derived' from import_jobs j where j.user_id = p_uid and j.document_id = p_doc_id
  union all select 'prime_driver_expenses', x.id, x.amount, 'attached' from prime_driver_expenses x where x.user_id = p_uid and x.document_id = p_doc_id
  union all select 'misc_income', x.id, x.amount, 'attached' from misc_income x where x.user_id = p_uid and x.document_id = p_doc_id
  union all select 'household_income', x.id, x.annual_amount, 'attached' from household_income x where x.user_id = p_uid and x.document_id = p_doc_id
  union all select 'compliance_items', x.id, null::numeric, 'attached' from compliance_items x where x.user_id = p_uid and x.source_document_id = p_doc_id
  union all select 'bank_statements', x.id, null::numeric, 'attached' from bank_statements x where x.user_id = p_uid and x.document_id = p_doc_id
  union all select 'loans', x.id, x.balance, 'kept' from loans x where x.user_id = p_uid and x.settlement_id in (select id from sett)
$$;

-- Never callable from the app directly (it takes a user id); only the two
-- functions below call it, always with auth.uid().
revoke all on function document_linked_rows(uuid, uuid) from public, anon, authenticated;

-- PREVIEW: counts, dollar totals and ids by table, plus the settlement(s).
-- Read-only. Another user's document, or one already deleted: status 'not_found'.
create or replace function preview_document_delete(p_doc_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc documents%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into v_doc from documents where id = p_doc_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'document', jsonb_build_object(
      'id', v_doc.id, 'filename', v_doc.filename, 'doc_type', v_doc.doc_type,
      'doc_date', v_doc.doc_date, 'amount', v_doc.amount, 'storage_path', v_doc.storage_path
    ),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'week_ending', s.week_ending, 'gross', s.gross, 'net', s.net, 'truck_id', s.truck_id) order by s.week_ending)
      from settlements s where s.document_id = p_doc_id and s.user_id = v_uid
    ), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', g.tbl, 'kind', g.kind, 'count', g.n, 'amount', g.total, 'ids', g.ids
      ) order by g.tbl, g.kind)
      from (
        select r.tbl, r.kind, count(*) as n, coalesce(sum(r.amount), 0) as total, jsonb_agg(r.row_id) as ids
        from document_linked_rows(p_doc_id, v_uid) r
        group by r.tbl, r.kind
      ) g
    ), '[]'::jsonb)
  );
end;
$$;

-- DELETE: p_mode 'all' = the file and everything derived and attached;
-- 'file_only' = the file only, every record kept (links cleared).
-- Idempotent: a second call (or another user's id) returns 'not_found' and
-- changes nothing. Returns the storage path so the app removes the file
-- AFTER this transaction commits (orphan cleanup retries a failed removal).
create or replace function delete_document_cascade(p_doc_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc documents%rowtype;
  v_deleted jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_mode not in ('all', 'file_only') then
    raise exception 'Unknown delete mode: %', p_mode using errcode = '22023';
  end if;
  select * into v_doc from documents where id = p_doc_id and user_id = v_uid for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(jsonb_object_agg(g.tbl, g.n), '{}'::jsonb) into v_deleted
  from (
    select r.tbl, count(*) as n from document_linked_rows(p_doc_id, v_uid) r
    where p_mode = 'all' and r.kind <> 'kept'
    group by r.tbl
  ) g;

  if p_mode = 'all' then
    -- The driver's settlement share is derived from this settlement
    -- (its FK is SET NULL, so it would otherwise stay as a payroll expense).
    delete from driver_payments
      where user_id = v_uid
        and settlement_id in (select id from settlements where document_id = p_doc_id and user_id = v_uid);
    -- Whole settlement: children, contributions and equipment cascade; the
    -- §70 trigger runs; loans are un-linked and kept.
    delete from settlements where document_id = p_doc_id and user_id = v_uid;
    -- Attached records (contributions/equipment cascade from deductions).
    delete from deductions where document_id = p_doc_id and user_id = v_uid;
    delete from maintenance_records where document_id = p_doc_id and user_id = v_uid;
    delete from prime_driver_expenses where document_id = p_doc_id and user_id = v_uid;
    delete from misc_income where document_id = p_doc_id and user_id = v_uid;
    delete from household_income where document_id = p_doc_id and user_id = v_uid;
    delete from compliance_items where source_document_id = p_doc_id and user_id = v_uid;
    delete from bank_statements where document_id = p_doc_id and user_id = v_uid;
    delete from import_jobs where document_id = p_doc_id and user_id = v_uid;
  else
    -- settlements.document_id has no ON DELETE rule: clear it first. Every
    -- other link is ON DELETE SET NULL and clears with the document.
    update settlements set document_id = null where document_id = p_doc_id and user_id = v_uid;
  end if;

  delete from documents where id = p_doc_id and user_id = v_uid;

  return jsonb_build_object(
    'status', 'deleted',
    'mode', p_mode,
    'storage_path', v_doc.storage_path,
    'deleted', v_deleted
  );
end;
$$;

revoke all on function preview_document_delete(uuid) from public, anon;
revoke all on function delete_document_cascade(uuid, text) from public, anon;
grant execute on function preview_document_delete(uuid) to authenticated;
grant execute on function delete_document_cascade(uuid, text) to authenticated;

commit;

-- READ-ONLY CHECK (run separately, after): three rows; prosecdef = true for all;
-- can_app_call = false for document_linked_rows, true for the other two.
select p.proname,
       p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'execute') as can_app_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('document_linked_rows', 'preview_document_delete', 'delete_document_cascade')
order by p.proname;
