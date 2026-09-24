-- docs/PENDING_SQL.md §76 — DOCUMENT TITLES (owner decision 2026-09-23)
-- Additive and nullable: existing rows keep title = NULL (shown as the
-- generic docType label and listed in the "Needs a title" review queue).
alter table documents
  add column title text,
  add column title_source text check (title_source in ('ai', 'record', 'user'));
