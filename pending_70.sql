-- docs/PENDING_SQL.md §70 — SETTLEMENT DELETE ORPHANS (owner decision,
-- device report: deleting every settlement left business_balance wrong,
-- and loans had no way to show they came from a settlement). See
-- CLAUDE.md's own dated entry for this pass for the full audit.
--
-- PART A — BALANCE REVERSAL, AN AFTER DELETE TRIGGER (not a client-side
-- fix): a plain client-side "delete then reverse" two-step has the exact
-- same non-atomicity risk §60's own capital-transaction RPCs were built
-- to close, AND it would completely miss the truck-cascade path — when a
-- truck is deleted, Postgres deletes every one of its settlements
-- directly via the trucks.id -> settlements.truck_id FK cascade, never
-- going through any app code at all. A trigger fires for EVERY row
-- delete regardless of what triggered it (a direct client delete, a
-- truck-cascade delete, or an admin/service-role action), so it's the
-- only mechanism that actually covers all three paths with one piece of
-- logic. SECURITY DEFINER (not invoker): unlike the §60 RPCs, this
-- trigger takes no caller-supplied parameters to validate — OLD.user_id/
-- OLD.business_balance_credit come directly from the real row already
-- being deleted, so there's no impersonation risk to guard against, and
-- SECURITY DEFINER is what lets the reversal succeed uniformly whether
-- the delete was issued by a normal authenticated user (auth.uid() set)
-- or a service-role Edge Function (auth.uid() is null there — an
-- invoker-rights trigger checking auth.uid() would silently no-op for
-- reset-data/delete-account). Both of those callers already tolerate
-- this trigger firing mid-operation: reset-data explicitly zeroes
-- business_balance afterward regardless (invariant #24), and
-- delete-account destroys the whole profiles row anyway.

create or replace function reverse_settlement_business_balance_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.business_balance_credit, 0) <> 0 then
    update profiles
    set business_balance = coalesce(business_balance, 0) - old.business_balance_credit
    where user_id = old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_reverse_settlement_business_balance_credit on settlements;
create trigger trg_reverse_settlement_business_balance_credit
after delete on settlements
for each row
execute function reverse_settlement_business_balance_credit();

-- PART B — LOAN PROVENANCE (never a silent leftover, per item 4's own
-- framing: a loan legitimately outlives the one settlement that happens
-- to have last mentioned it — one loan is upserted-by-name across MANY
-- settlements over months, so a plain settlement_id FK with ON DELETE
-- CASCADE would be actively wrong here (it would destroy a real,
-- standing financial obligation the instant its most-recently-touching
-- settlement got deleted). ON DELETE SET NULL instead: the loan survives
-- unconditionally, and settlement_id simply clears to NULL once whatever
-- settlement last updated it is gone — combined with the new `source`
-- column, this is what "unlinked and marked" means concretely: a loan
-- can always be identified as settlement-derived (source='settlement')
-- even once its own settlement_id has gone null, rather than looking
-- like an unexplained manual entry.

alter table loans add column if not exists settlement_id uuid references settlements on delete set null;
alter table loans add column if not exists source text not null default 'manual';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loans_source_check'
  ) then
    alter table loans add constraint loans_source_check check (source in ('settlement','import','manual'));
  end if;
end $$;
create index if not exists loans_settlement_id_idx on loans(settlement_id);
