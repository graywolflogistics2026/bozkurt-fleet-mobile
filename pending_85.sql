-- §85 DIAGNOSTICS: database functions from pg_proc (owner decision 2026-11-03)
-- Mirror of docs/PENDING_SQL.md §85. Idempotent. Read-only: returns function NAMES only.
create or replace function public.diagnose_missing_functions(p_names text[])
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(n order by n), '{}'::text[])
  from unnest(p_names) as n
  where not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = n
  );
$$;

revoke all on function public.diagnose_missing_functions(text[]) from public;
grant execute on function public.diagnose_missing_functions(text[]) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verification (read-only). Expect {} (all 8 exist):
select public.diagnose_missing_functions(array[
  'import_job_claim','import_job_release','import_job_put_page','import_job_saved',
  'consume_ai_import_credit_for','document_linked_rows','preview_document_delete','delete_document_cascade'
]);
