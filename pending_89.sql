-- §89 AI CONSENT ON PROFILES (owner decision 2026-11-23). Mirror of docs/PENDING_SQL.md §89.
-- Run in the Supabase SQL Editor. Run PART 1 first, then PART 2, then PART 3.
-- Ship order: this SQL -> eas update -> wait until phones have it -> redeploy ai-advisor and ai-import.

-- PART 1 — PREVIEW (read-only). Expected: no rows (the columns do not exist yet).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('ai_consent_at', 'ai_consent_version');

-- PART 2 — APPLY (idempotent; adds two nullable columns, changes no existing value).
alter table public.profiles add column if not exists ai_consent_at timestamptz;
alter table public.profiles add column if not exists ai_consent_version text;

comment on column public.profiles.ai_consent_at is
  'AI consent (App Store 5.1.2(i), §89): when the user allowed sending data to Anthropic; null = not allowed (never asked, Not now, or withdrawn).';
comment on column public.profiles.ai_consent_version is
  'AI consent (§89): version of the consent text the user last answered (Allow or Not now); a different app version asks again.';

-- PART 3 — VERIFY (read-only). Expected: 2 rows (ai_consent_at timestamp with time zone,
-- ai_consent_version text); asked = 0 and allowed = 0 until users answer in the app.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('ai_consent_at', 'ai_consent_version')
order by column_name;

select count(*) filter (where ai_consent_version is not null) as asked,
       count(*) filter (where ai_consent_at is not null) as allowed
from public.profiles;
