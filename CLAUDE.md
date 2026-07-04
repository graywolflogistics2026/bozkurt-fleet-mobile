# CLAUDE.md — Standing rules for this repo

- `legacy/index.html` is the source of truth for business logic. When in doubt,
  match its behavior and cite the function name you ported.
- Never weaken these invariants:
  1. Settlement-withheld deductions are never counted as tax deductions
     (net-pay model: income = net settlement pay; expenses = out-of-pocket only
     + per diem $64/day).
  2. Personal-payment purchases (Personal Card / Cash / Zelle / Venmo) always
     create/update an id-linked capital contribution; deleting or editing the
     deduction syncs the contribution (add/update/remove — never duplicate).
  3. Store purchases book qty × unit price per item PLUS a "Sales tax & fees"
     line so the booked total always equals the invoice grand total. No dollar
     is silently lost.
  4. Truck Health intervals are per-truck, user-editable settings, not code
     constants — every truck is different and each owner tunes their own
     service schedule in Settings. The legacy values (oil 50,000 mi fixed;
     fuel filter bundled with oil; DPF mpg-based; transmission 500k synthetic
     / 250k conventional; differential 500k synthetic / 100k conventional;
     air filter 100k; air dryer 250k; chassis 30k; APU every 2,000 engine
     hours; coolant extender 300k / full replace 600k; DEF filter 300k) are
     SEED DEFAULTS copied into `maintenance_intervals` when a truck is
     created (see docs/SCHEMA.sql) — not permanent constants to hard-code.
     Disabling a category (`enabled=false`) hides it from Truck Health.
  5. Every delete cascades: linked capital contributions, document records
     (duplicate detection), fuel purchases (ON DELETE CASCADE from
     settlements — matches legacy deleteSett()'s hard-delete of that week's
     fuel rows, not a soft/orphaning detach), and maintenance-derived health
     values.
  6. NO tax constant may live in app code — no bracket table, standard
     deduction, SE-tax rate, per diem rate, quarterly deadline, or state tax
     table is ever hardcoded or bundled into a TypeScript module. Every one
     of them is read (and cached offline) from the server-side
     `tax_year_data` table (docs/SCHEMA.sql) — NOT user-scoped, one row per
     tax year, readable by all authenticated users, writable only by
     service_role (an admin seeds/updates it — docs/ADMIN_RUNBOOK.md). This
     is what makes the tax engine product-ready, not single-user, and lets
     a new tax year or a corrected figure ship with no app release
     (tax_config table on the user side: tax_year, filing_status, state,
     include_state_tax, entity_type, scorp_salary,
     scorp_payroll_tax_handled — see docs/SCHEMA.sql). If the current tax
     year's row is missing or unpublished, fall back to the latest
     published year and show a banner — never silently compute with an
     empty/default bracket table. The 2026 federal bracket tables and
     SE-tax math seeded into `tax_year_data` are the verbatim port of
     legacy calcTax() (including that legacy uses the same bracket table
     for 'single' and 'hoh' — do not "fix" that).
     entity_type='sole_prop' and 'smllc' MUST share the identical
     computation path (smllc is a UI label only, never a math branch);
     'scorp' is the only entity_type that branches SE tax (applies to
     scorp_salary only, not full net profit) and relabels Capital Account
     draws as distributions.
  7. No code path may assume a single truck. truck_id flows through every
     query (settlements, fuel, maintenance, health, notifications); a
     single-truck account is just the n=1 presentation of the exact same
     fleet-wide logic (active-truck context hides the picker and any
     fleet-only UI when count===1), never a separate code path that has to
     be kept in sync with the multi-truck one.
- All Anthropic API calls happen server-side (Supabase Edge Functions).
  The mobile app never holds the API key.
- The AI extraction prompt in legacy/index.html is battle-tuned. Port it
  verbatim; do not rewrite it.
- Every table has Row Level Security. Every query filters by authenticated user.
- Supabase Storage paths (buckets `documents` and `backups`) always start with
  `{user_id}/` — this is what the storage.objects RLS policies key off of
  (see supabase/migrations/0001_init.sql). Build paths as:
    documents bucket: {user_id}/{month}/Payroll/Week-N/{filename}
                       {user_id}/{month}/Equipment-Deductions/{store}/{filename}
                       {user_id}/{month}/{Category}/{filename}   (fuel, maintenance,
                         tolls, loans, bank/checking statements — see
                         buildDocFolderParts()/orgFolderName() in legacy/index.html
                         for the exact category-folder mapping)
    backups bucket:    {user_id}/backups/{timestamped filename}
  Never write to a bucket path that doesn't start with the current user's
  auth.uid() — the RLS policy will reject it.
- TypeScript strict mode; no `any` in the data layer.
- Dark theme colors come from the CSS variables in legacy/index.html.
