-- docs/PENDING_SQL.md §78 — RESUMABLE PAGE-BY-PAGE IMPORT JOBS (owner decision 2026-10-13)
-- 17-page stall redesign A-H + amendments + "scale to any page count" add-on.
-- Run BEFORE redeploying ai-import. Idempotent: safe to run twice.

-- 1. New columns on import_jobs (all nullable or defaulted; no data change).
alter table import_jobs add column if not exists page_plan jsonb;
alter table import_jobs add column if not exists page_results jsonb not null default '{}'::jsonb;
alter table import_jobs add column if not exists progress jsonb;
alter table import_jobs add column if not exists heartbeat_at timestamptz;
alter table import_jobs add column if not exists lease_owner text;
alter table import_jobs add column if not exists lease_until timestamptz;
alter table import_jobs add column if not exists error_page integer;
alter table import_jobs add column if not exists invocation_count integer not null default 0;

-- 2. Two new job statuses: 'paused' (between runs of one job) and
--    'needs_decision' ("This file has N pages. Read the first 40 now?").
alter table import_jobs drop constraint if exists import_jobs_status_check;
alter table import_jobs add constraint import_jobs_status_check
  check (status in ('queued', 'processing', 'paused', 'waiting_to_retry', 'needs_decision', 'ready', 'failed'));

-- 3. Two new ai_usage_log call types, logged for cost only (never counted
--    against the monthly allowance, which counts call_type = 'ai_import').
alter table ai_usage_log drop constraint if exists ai_usage_log_call_type_check;
alter table ai_usage_log add constraint ai_usage_log_call_type_check
  check (call_type in ('ai_import', 'ai_advisor', 'ai_import_classify', 'ai_import_pages'));

-- 4. Lease: one run at a time owns a job. Granted only to the server key.
create or replace function import_job_claim(p_job_id uuid, p_owner text, p_lease_seconds integer)
returns boolean
language sql
set search_path = public
as $$
  with claimed as (
    update import_jobs
    set lease_owner = p_owner,
        lease_until = now() + make_interval(secs => p_lease_seconds),
        heartbeat_at = now(),
        invocation_count = invocation_count + 1
    where id = p_job_id
      and (lease_until is null or lease_until < now() or lease_owner = p_owner)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function import_job_release(p_job_id uuid, p_owner text)
returns void
language sql
set search_path = public
as $$
  update import_jobs set lease_owner = null, lease_until = null
  where id = p_job_id and lease_owner = p_owner;
$$;

-- 5. One page's result, written atomically by the lease owner only; a page
--    already 'done' is never overwritten (steps are idempotent per page).
create or replace function import_job_put_page(p_job_id uuid, p_owner text, p_page integer, p_result jsonb)
returns boolean
language sql
set search_path = public
as $$
  with written as (
    update import_jobs j
    set page_results = coalesce(j.page_results, '{}'::jsonb) || jsonb_build_object(p_page::text, p_result),
        pages_done = (
          select count(*)::int
          from jsonb_each(coalesce(j.page_results, '{}'::jsonb) || jsonb_build_object(p_page::text, p_result)) e
          where e.value ->> 'status' = 'done'
        ),
        heartbeat_at = now(),
        updated_at = now()
    where j.id = p_job_id
      and j.lease_owner = p_owner
      and j.lease_until > now()
      and coalesce(j.page_results -> (p_page::text) ->> 'status', '') <> 'done'
    returning 1
  )
  select exists (select 1 from written);
$$;

-- 6. Credit consumption for a job run that has no user session (a later
--    run of a chain). Same body as consume_ai_import_credit() (§59), but
--    the user comes from a parameter — so it is granted ONLY to the server
--    key, never to signed-in users.
create or replace function consume_ai_import_credit_for(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id uuid;
begin
  if p_user_id is null then
    raise exception 'consume_ai_import_credit_for: no user' using errcode = '22004';
  end if;
  select id into v_pack_id
  from ai_credit_purchases
  where user_id = p_user_id
    and credits_remaining > 0
    and (expires_at is null or expires_at > now())
  order by (expires_at is null) asc, expires_at asc
  for update
  limit 1;
  if v_pack_id is null then
    return null;
  end if;
  update ai_credit_purchases set credits_remaining = credits_remaining - 1 where id = v_pack_id;
  return v_pack_id;
end;
$$;

revoke all on function import_job_claim(uuid, text, integer) from public, anon, authenticated;
revoke all on function import_job_release(uuid, text) from public, anon, authenticated;
revoke all on function import_job_put_page(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function consume_ai_import_credit_for(uuid) from public, anon, authenticated;
grant execute on function import_job_claim(uuid, text, integer) to service_role;
grant execute on function import_job_release(uuid, text) to service_role;
grant execute on function import_job_put_page(uuid, text, integer, jsonb) to service_role;
grant execute on function consume_ai_import_credit_for(uuid) to service_role;

-- 7. After Save while attachment pages are still being read: keep only the
--    attachment results on the job (the content pages' extractions and
--    result_json are deleted), remember the saved document. Called by the
--    signed-in user for their own job (RLS + auth.uid()). Returns
--    'deleted' when nothing is left to read (the row is deleted instead).
create or replace function import_job_saved(p_job_id uuid, p_document_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pending integer;
begin
  select count(*) into v_pending
  from import_jobs j,
       jsonb_array_elements(coalesce(j.page_plan -> 'pages', '[]'::jsonb)) p
  where j.id = p_job_id
    and j.user_id = auth.uid()
    and p ->> 'role' = 'attachment'
    and coalesce(j.page_results -> (p ->> 'page') ->> 'status', '') not in ('done', 'failed');
  if coalesce(v_pending, 0) = 0 then
    delete from import_jobs where id = p_job_id and user_id = auth.uid();
    return 'deleted';
  end if;
  update import_jobs
  set document_id = p_document_id,
      result_json = null,
      status = 'processing',
      page_results = (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(coalesce(page_results, '{}'::jsonb)) e
        where e.value ->> 'role' = 'attachment'
      ),
      updated_at = now()
  where id = p_job_id and user_id = auth.uid();
  return 'attachments_continue';
end;
$$;

revoke all on function import_job_saved(uuid, uuid) from public, anon;
grant execute on function import_job_saved(uuid, uuid) to authenticated;

-- Read-only verification: 8 columns, 4 functions + import_job_saved.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'import_jobs'
  and column_name in ('page_plan', 'page_results', 'progress', 'heartbeat_at', 'lease_owner', 'lease_until', 'error_page', 'invocation_count')
order by column_name;

select proname
from pg_proc
where proname in ('import_job_claim', 'import_job_release', 'import_job_put_page', 'consume_ai_import_credit_for', 'import_job_saved')
order by proname;
