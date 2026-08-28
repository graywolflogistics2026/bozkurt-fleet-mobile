-- docs/PENDING_SQL.md §72 — REMOVE BUSINESS BALANCE TRACKING (owner
-- decision 2026-08-27). profiles.business_balance has been a recurring
-- source of drift/confusion across multiple prior passes (§37/§38/§59/§60/
-- §70 all exist specifically because this estimate kept getting out of
-- sync with reality). The owner has decided the app's own balance ESTIMATE
-- adds no value over the owner's own real bank balance — it is retired as
-- a displayed/computed feature everywhere, but every underlying column/
-- table stays in place, INERT, so this is fully reversible later without a
-- data migration. See CLAUDE.md's own dated entry for this pass for the
-- full client-side audit.

-- Part A — drop the §70 reversal trigger. The function itself
-- (reverse_settlement_business_balance_credit()) is intentionally left
-- defined — only the trigger binding is removed — so restoring this is
-- exactly the two-line CREATE TRIGGER statement already on file in §70,
-- no function rewrite needed. Necessary because a settlement carrying a
-- STALE, pre-this-pass business_balance_credit value could otherwise
-- still decrement business_balance on delete even though nothing writes
-- that credit anymore.
drop trigger if exists trg_reverse_settlement_business_balance_credit on settlements;

-- Part B — the three §60 manual capital-transaction RPCs, balance-delta
-- application removed, capital_transactions row write unchanged. Draws,
-- contributions, reimbursements, and everything Capital Account's own
-- four-flow summary/Net Position/tax-free-remaining computation depends
-- on are unaffected — those are computed directly from capital_transactions
-- rows + profiles.initial_capital, never from profiles.business_balance.
-- business_balance_applied is now always written as 0 (informational-only
-- column, nothing reads it anymore — 0 is the honest value: "this
-- transaction did not move any tracked balance").
create or replace function record_manual_capital_transaction(
  p_user_id uuid,
  p_tx_type text,
  p_amount numeric,
  p_tx_date date,
  p_note text,
  p_linked_deduction_id uuid default null
)
returns capital_transactions
language plpgsql
security invoker
as $$
declare
  v_row capital_transactions;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'record_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'record_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  insert into capital_transactions (user_id, tx_type, amount, tx_date, note, linked_deduction_id, business_balance_applied)
  values (p_user_id, p_tx_type, p_amount, p_tx_date, p_note, p_linked_deduction_id, 0)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function record_manual_capital_transaction(uuid, text, numeric, date, text, uuid) to authenticated;

create or replace function update_manual_capital_transaction(
  p_id uuid,
  p_user_id uuid,
  p_tx_type text,
  p_amount numeric,
  p_tx_date date,
  p_note text
)
returns capital_transactions
language plpgsql
security invoker
as $$
declare
  v_row capital_transactions;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'update_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;
  if p_tx_type not in ('contribution', 'draw') then
    raise exception 'update_manual_capital_transaction: invalid tx_type %', p_tx_type;
  end if;

  update capital_transactions
  set amount = p_amount, tx_date = p_tx_date, note = p_note, business_balance_applied = 0
  where id = p_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'update_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function update_manual_capital_transaction(uuid, uuid, text, numeric, date, text) to authenticated;

create or replace function delete_manual_capital_transaction(
  p_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'delete_manual_capital_transaction: user mismatch' using errcode = '28000';
  end if;

  delete from capital_transactions where id = p_id and user_id = p_user_id;

  if not found then
    raise exception 'delete_manual_capital_transaction: no capital_transactions row % for user %', p_id, p_user_id
      using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function delete_manual_capital_transaction(uuid, uuid) to authenticated;
