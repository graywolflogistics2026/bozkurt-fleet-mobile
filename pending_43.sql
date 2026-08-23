-- docs/PENDING_SQL.md §43 — maintenance_records.source / tolls.source
-- (Accountant Package ORIGIN RULE, owner decision 2026-08-05, FULL PARITY pass item B.1)

alter table maintenance_records
  add column source text not null default 'import'
    check (source in ('settlement', 'import', 'manual'));

alter table tolls
  add column source text not null default 'import'
    check (source in ('settlement', 'import', 'manual'));

update maintenance_records m
  set source = case
    when exists (
      select 1 from documents d
      where d.id = m.document_id and d.parsed_json ->> 'docType' = 'maintenance'
    ) then 'import'
    else 'settlement'
  end;

update tolls
  set source = case when network in ('ezpass', 'drivewyze') then 'settlement' else 'import' end;
