-- docs/PENDING_SQL.md §71 — USAGE ANALYTICS (owner decision, privacy-safe,
-- owner-only). Records ONLY the bare event — which screen was opened or
-- which action was started/completed, when, by which user id — never a
-- financial value, a description, a document's contents, or anything else
-- about what the user actually did. See CLAUDE.md's own dated entry for
-- this pass for the full client-side wiring.

create table if not exists app_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('screen', 'action')),
  name text not null,
  status text check (status in ('started', 'completed')),
  created_at timestamptz not null default now(),
  -- A 'screen' event never carries a status (opening a screen has no
  -- lifecycle); an 'action' event always does (started or completed) —
  -- this is what makes the "actions started vs completed" recipe below
  -- meaningful rather than a guess about which rows are which.
  constraint app_usage_events_status_matches_kind check (
    (kind = 'screen' and status is null) or (kind = 'action' and status is not null)
  )
);

create index if not exists app_usage_events_user_id_idx on app_usage_events(user_id);
create index if not exists app_usage_events_created_at_idx on app_usage_events(created_at);
create index if not exists app_usage_events_name_idx on app_usage_events(name);

alter table app_usage_events enable row level security;

-- INSERT-ONLY, and only your own rows. Deliberately NO select/update/delete
-- policy for the authenticated or anon role at all — RLS defaults to deny
-- once enabled, so a normal user (including the account whose events these
-- are) can never read this table back through the app. Only the
-- service_role Postgres role (which has BYPASSRLS) or the Supabase SQL
-- Editor's own postgres/table-owner role (which also bypasses RLS by
-- default, no FORCE ROW LEVEL SECURITY needed) can ever read it — exactly
-- "only the service role can read."
drop policy if exists app_usage_events_insert_own on app_usage_events;
create policy app_usage_events_insert_own on app_usage_events
  for insert
  with check (
    user_id = auth.uid()
    -- Server-side enforcement of the opt-out (owner decision — "add a
    -- plain setting the user can turn off"): re-checks the LIVE
    -- profiles row on every single insert, never a value the client
    -- could have cached stale. This is the actual privacy guarantee;
    -- the client-side short-circuit (src/data/usageTracking.ts) only
    -- exists so an opted-out device doesn't bother making the call.
    and coalesce((select p.usage_analytics_opt_out from profiles p where p.user_id = auth.uid()), false) = false
  );

alter table profiles add column if not exists usage_analytics_opt_out boolean not null default false;
