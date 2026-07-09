# CLAUDE.md — Standing rules for this repo

- `legacy/index.html` is the source of truth for business logic. When in doubt,
  match its behavior and cite the function name you ported. It is NOT a
  source of truth for identity — `legacy/index.html` bakes in one specific
  owner's name, company, and truck as a matter of it being a single-file,
  single-user app; the mobile app is a clean multi-tenant product (owner
  decision 2026-07-09, PRODUCT DECISION). New users start with ZERO data
  and no owner-specific defaults anywhere: no hardcoded company name
  ("Bozkurt Fleet OS" the product brand is fine; "Graywolf Logistics LLC"
  as a value is not), no hardcoded truck (unit number, year/make/model —
  the legacy-backup importer reads truck identity FROM the backup file's
  `DB.assets.tr`, never a specific truck), no non-zero business-balance/
  capital default. The legacy-backup importer (`app/src/data/legacyImport/`)
  is a generic migration feature for any web-app user, not an Ali-specific
  one-off. A first-launch onboarding wizard (PROMPTS.md Session 9b) is the
  only place a user's own company/truck/balance get set.
- Never weaken these invariants:
  1. Settlement-withheld deductions are never counted as tax deductions
     (net-pay model: income = net settlement pay; expenses = out-of-pocket only
     + per diem $64/day).
  2. Payment methods are exactly 9 generic values: Business Checking,
     Business Credit Card, Personal Checking, Personal Credit Card, Cash,
     Venmo, Cash App, Zelle Personal, Zelle Business (see
     app/src/import/paymentMethods.ts) — never a bank-brand string like
     "BofA Business"; map any legacy/free-text value into one of these 9.
     isPersonal = NOT /business/i AND /personal|cash|venmo|zelle/i (the
     NOT-business guard is why "Zelle Business" correctly reads as
     business-paid despite matching /zelle/i). A personal-payment purchase
     creates/updates an id-linked capital contribution ONLY after an
     explicit confirmation dialog (asked once per receipt, not per line
     item) — declining saves the deduction with no contribution. Deleting or
     editing a deduction that DOES have a linked contribution still syncs it
     (add/update/remove — never duplicate); this sync rule is unconditional,
     the confirmation gate only applies to creating a NEW contribution at
     import time.
  3. Store purchases book qty × unit price per item. NO separate "Sales tax
     & fees" row and NO separate service/add-on row: sales tax, shipping/
     handling, and any add-on/service/protection-plan line (any name —
     "Add-on services", "... service (for X)", "Walmart Protection Plan",
     "installation/delivery service", etc.) fold into the REAL items' costs
     PROPORTIONALLY (any remainder cent goes to the largest item) so the
     booked total always equals the receipt's grand total to the cent — no
     dollar is silently lost, and none of it is left sitting in its own
     line either. If a fee/service line names its parent via "(for X)" (or
     the item name otherwise makes the parent obvious), fold it directly
     into that item instead of the proportional split. Each item's
     description gets an "(incl. $X tax/fees/services)" suffix showing how
     much of its booked cost is folded-in tax/fees/services. If a receipt
     contains ONLY service/fee lines (no real item to fold into), keep them
     as their own row(s), each description prefixed "NEEDS REVIEW: ".
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
  8. This app provides ESTIMATES, not tax/legal/financial advice.
     (a) Every screen showing tax figures (Dashboard tax cards, tax
     estimator, S-Corp preview, quarterly payments, per diem) must include a
     persistent small-print line: "Estimates only — not tax advice. Verify
     with your CPA." (b) UI copy must always say "Estimated" / "~" before
     tax figures — never present a tax number as definitive. (c) AI Advisor
     responses get an automatic footer: "General information, not
     professional tax advice." (d) `profiles.tos_accepted_at`/`tos_version`
     (docs/SCHEMA.sql, D12) gate all data entry on first launch until Terms
     of Use are accepted, and re-prompt whenever `tos_version` changes
     (PROMPTS.md Session 3) — see docs/TERMS_OF_USE_DRAFT.md (attorney-review
     draft, not itself legal advice) and Settings > Legal (PROMPTS.md
     Session 10) for the paired Privacy Policy.
  9. Per diem days are DETERMINISTIC: 7 × the number of distinct settlement
     weeks (deduped by `week_ending`) — `app/src/tax/perDiem.ts`
     `calcPerDiemDays()` takes only `week_ending` values, nothing else.
     Never derive per diem from AI-extracted load `pickup_date`/
     `delivery_date` — those columns stay in `loads` (docs/PENDING_SQL.md
     §8) and keep being populated for possible future use, but re-running
     the same extraction can produce different dates run to run, which
     would make the tax engine's own output non-reproducible.
  10. Re-importing a settlement for a `week_ending` that already exists
      REPLACES that week's batch-tagged rows (settlement, loads, fuel,
      reimbursements, withheld deductions — all keyed off the stable
      `settlement_id` from the settlement upsert) instead of duplicating
      them (`app/src/data/aiImportSave.ts`, owner decision 2026-07-09,
      mirrors the web app's v2026.07.09-A behavior). Maintenance/tolls/
      loans are NOT part of this replace. A replace must not re-credit
      `business_balance` with that week's net pay a second time.
- The UI never shows a raw internal doc-type code (e.g. `'amazon'`) — always
  go through `DOC_TYPE_META`'s human label (e.g. "Store/Amazon Purchase").
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
