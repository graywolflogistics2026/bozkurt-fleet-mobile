-- docs/PENDING_SQL.md §47 — category_learning_rules
-- (FULL PARITY follow-up, owner decision 2026-08-05, spec item G)

create table category_learning_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  keyword      text not null,
  category     text not null,
  hit_count    int not null default 1,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (user_id, keyword)
);

alter table category_learning_rules enable row level security;
create policy "category_learning_rules_owner_all" on category_learning_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
