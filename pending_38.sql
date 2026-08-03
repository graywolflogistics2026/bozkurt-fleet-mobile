-- docs/PENDING_SQL.md §38 — apply_business_balance_delta() raises on
-- zero-row update (pre-launch hardening, owner decision 2026-08-02,
-- "settlement imports failing frequently" audit)
--
-- Bug: `update profiles set ... returning business_balance into
-- new_balance` leaves new_balance NULL (never assigned) when the WHERE
-- clause matches ZERO rows (a mismatched p_user_id/auth.uid(), or a
-- profiles row that doesn't exist for that user). PL/pgSQL does NOT
-- raise an error for a 0-row UPDATE by default, so the RPC returned NULL
-- with error: null — the client believed the balance update succeeded
-- when it silently never touched anything.
--
-- Fix: a single `if not found then raise exception ...` check right
-- after the UPDATE ... RETURNING INTO. FOUND is a PL/pgSQL built-in
-- reflecting whether the most recent statement affected any rows. Now a
-- 0-row update is a real, visible Postgres error (errcode 'P0002') that
-- the client's SaveExtractionError reports as step 'balance-update'
-- instead of a quiet no-op.
--
-- create or replace function is idempotent — safely replaces the §37
-- version in place. No column/table changes, no data migration needed.
--
-- Run this directly in the Supabase SQL editor.

create or replace function apply_business_balance_delta(p_user_id uuid, p_delta numeric)
returns numeric
language plpgsql
security invoker
as $$
declare
  new_balance numeric;
begin
  update profiles
  set business_balance = coalesce(business_balance, 0) + p_delta
  where user_id = p_user_id and user_id = auth.uid()
  returning business_balance into new_balance;
  if not found then
    raise exception 'apply_business_balance_delta: no profiles row updated for user %', p_user_id
      using errcode = 'P0002';
  end if;
  return new_balance;
end;
$$;
