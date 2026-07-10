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
     draws as distributions. entity_type gained a 4th value,
     'multi_member_llc' (owner decision 2026-07-10, PRODUCT DECISION,
     docs/PENDING_SQL.md §18) — scopes the whole estimate to just that
     member's `ownership_pct` (0-100, `tax_config.ownership_pct`) share of
     net profit before AGI/SE-tax/brackets ever apply
     (`calcTaxEstimate.ts`'s `ownerShareOfProfit`); `netProfit` itself stays
     the full LLC profit, unscoped, so a fleet-wide dashboard figure is
     never silently altered by one member's ownership %. 'scorp' also
     gained an employer-payroll-tax estimate this pass: unless
     `scorp_payroll_tax_handled` is true (the owner attests a payroll
     provider already accounts for it), the engine estimates the
     employer-side FICA cost of `scorp_salary` from
     `tax_year_data.se_tax.employer_fica` and subtracts it from
     `ownerShareOfProfit` as a real business expense — this is what "the
     existing reasonable-salary preview promoted to full flow with
     owner-salary W-2 treatment" means. `tax_year_data` gained two more
     server-sourced constants this pass (docs/PENDING_SQL.md §17), same
     "never hardcode, never silently compute empty" rule as every other
     constant here: `se_tax.employer_fica` (7.65% employer-side FICA match,
     used for both the scorp owner-salary estimate above and driver W-2
     "true cost of employee") and `nec_1099` (`{threshold, filing_deadline}`
     — the IRS 1099-NEC $600/Jan-31 filing rule; see invariant #7's driver
     compensation-types extension for how this drives the Dashboard
     reminder). Both are optional/graceful-fallback fields (same pattern as
     `per_diem.full_daily_rate`) since they gate an informational banner,
     not a computed tax AMOUNT, until docs/PENDING_SQL.md §17 has run.
  7. No code path may assume a single truck. truck_id flows through every
     query (settlements, fuel, maintenance, health, notifications); a
     single-truck account is just the n=1 presentation of the exact same
     fleet-wide logic (active-truck context hides the picker and any
     fleet-only UI when count===1), never a separate code path that has to
     be kept in sync with the multi-truck one. Users may add unlimited
     trucks (2nd, 3rd, ...Nth), each seeding its own maintenance_intervals
     on creation (Truck Health stays per-active-truck; a fleet-wide
     aggregation view is separate, gated on 2+ trucks). Drivers (owner
     decision 2026-07-09, PRODUCT DECISION) extend this the same way but
     are OPTIONAL, not mandatory like trucks: the `drivers` table
     (docs/PENDING_SQL.md §13) and `driver_id` on settlements/loads/
     fuel_purchases/withheld-deductions (§14) exist so payroll can be
     auto-routed, but an account with zero driver rows — or a settlement
     with no driver name extracted — behaves exactly as before, `driver_id`
     staying null, no picker ever forced (`app/src/import/driverMatch.ts`
     `resolveDriverMatch()`, deliberately less aggressive than
     `resolveTruckMatch()`). Payroll auto-routing: the ai-import settlement
     schema carries `unit` (the truck's unit number — existing since the
     Session 6 fleet-scalability work) and `driverName`; on import, `unit`
     is matched against `trucks.unit_number` (exact) and `driverName`
     against `drivers.name` (case-insensitive, trimmed) to auto-tag the
     settlement and all its rows. No match on either → the import preview
     shows a picker to choose an existing truck/driver OR create one
     inline (`app/app/(tabs)/import/index.tsx`) — the newly created row
     persists normally, so it auto-matches on every future import without
     any separate alias/memory mechanism. Driver compensation types (owner
     decision 2026-07-10, PRODUCT DECISION, extends this invariant):
     `drivers.compensation_type` is one of `w2_employee` / `1099_contractor`
     / `team_split` / `trainee` (docs/PENDING_SQL.md §15); `pay_type`/
     `pay_rate` are informational display fields only — the tax engine
     (`app/src/tax/driverPayroll.ts`) NEVER derives an amount from them,
     only from actual recorded `driver_payments` rows (§16, `on delete
     cascade` from `drivers` — unlike every other `driver_id`, which is `on
     delete set null` — because a payment record has no meaning without the
     driver it paid). `sumDeductibleDriverPayroll()` reduces the owner's net
     profit by `gross_pay + employer_taxes` uniformly across all four
     compensation types (1099 = "Contract Labor", W-2 = wages + employer
     FICA = "true cost of employee", team_split/trainee = the driver's
     settlement share) — `employer_taxes` defaults to 0 and is only ever
     populated for `w2_employee` payments, which is what keeps this one
     formula instead of a type-specific branch. A driver's YTD 1099 total
     crossing the IRS $600 threshold (`tax_year_data.nec_1099`, §17) surfaces
     a Dashboard reminder to file a 1099-NEC (`calcContractLaborYtd()`).
     team_split/trainee: the import preview shows a "driver's share of this
     settlement" input whenever the resolved/selected driver has that
     compensation_type (`app/app/(tabs)/import/index.tsx`
     `showsDriverSplitInput`) — entering an amount creates a `driver_payment`
     linked to the new settlement; re-importing that settlement replaces it
     (CLAUDE.md invariant #10's re-import-replace behavior extends to this
     row too, not just settlement/loads/fuel/reimbursements/deductions).
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
  11. Multi-language support (owner decision 2026-07-09, PRODUCT DECISION,
      binding; Hindi/Ukrainian added same-day addendum): target languages
      are English (default), Spanish, Russian, Arabic, Turkish, Hindi, and
      Ukrainian (7 total; only Arabic is RTL) —
      `app/src/i18n/locales/{en,es,ru,ar,tr,hi,uk}.json`, `en.json` is the
      source of truth (every new key is added there first, then
      translated into the other six — `app/src/i18n/index.ts` has a
      static parity check script pattern; keep all 7 files' key sets
      identical). `hi.json`/`uk.json` currently ship as untranslated
      copies of `en.json` (selectable, structurally complete, English
      text) — real translation is PROMPTS.md's Session 9c, not to be done
      piecemeal; when doing it, Ukrainian and Russian are distinct
      languages and must be translated independently, never by adapting
      `ru.json`. NO hardcoded user-facing string may ship in a screen —
      every string goes through `useTranslation()`'s `t()` (or, outside a
      component, the default `i18n` export's `i18n.t()`, e.g.
      `app/src/lib/confirmOwnerContribution.ts`). First-launch: the app
      opens in the device's OS language when it's one of the 7 supported
      (Arabic in RTL); anything else falls back to English
      (`resolveInitialLocale()`). A manual choice in Settings > Language is
      cached locally (`app/src/i18n/localeStorage.ts`) AND written to
      `profiles.locale`, and always wins over the device language
      afterwards, on every device the user signs into (synced in
      `AuthContext.fetchProfile()`). Arabic requires RTL: use logical
      style properties (`marginStart`/`marginEnd`/`start`/`end`), never
      `marginLeft`/`marginRight`/absolute `left`/`right` — `I18nManager.
      forceRTL()` only takes effect after a native reload, so switching
      to/from Arabic in Settings shows a "restart required" prompt
      (`app/src/i18n/rtl.ts`). Every session's verification step includes
      an RTL smoke-check (switch to Arabic, confirm no clipped/overlapping
      layout) — see PROMPTS.md. What does NOT get translated: user data
      (deduction descriptions, store names, notes), AI-extracted content,
      the enumerated domain values that CLAUDE.md invariant #2/payment
      methods and the deduction category list rely on regex/exact-string
      matching against (their pill labels stay English on purpose — see
      `app/app/(tabs)/deductions.tsx`), and legal documents (Terms of Use
      stays English-only until attorney review, docs/TERMS_OF_USE_DRAFT.md).
  12. NO LOCATION (owner decision 2026-07-10, PRODUCT DECISION, binding):
      this app does not collect or track user location. No location
      permission (`expo-location` or any equivalent) is ever requested, no
      GPS reading is ever taken, and no location-derived value (lat/long,
      geofence, route trace, mileage-by-GPS) is ever stored in any table —
      `loads.loaded_miles`/`empty_miles` and `settlements.miles` come
      exclusively from AI-extracted settlement documents (odometer/carrier-
      reported figures), never a device sensor. This must be reflected in
      the Session 10 privacy policy ("we do not collect location") and in
      the app's own permission manifest (no `NSLocationWhenInUseUsageDescription`/
      `ACCESS_FINE_LOCATION` entries). A future opt-in IFTA mile tracker
      using real GPS is explicitly OUT OF SCOPE for now — parked in
      PROMPTS.md's backlog as a v2+, explicitly-opt-in-only feature that
      would need its own separate owner decision and permission prompt,
      never silently bundled into an existing feature.
  13. USER DATA IS PRIVATE (owner decision 2026-07-10, PRODUCT DECISION,
      binding): each user's financial data (settlements, deductions, loads,
      fuel, capital account, everything RLS-scoped to `auth.uid()`) is
      private to that user. The operator (Bozkurt Fleet OS / whoever runs
      the Supabase project) does not access an individual user's data
      except (a) with that user's explicit consent, given for a specific
      support request, or (b) where legally required (e.g. a valid
      subpoena). This is an operational/access-policy invariant, not a
      schema one — every table already has RLS (invariant below) that
      technically prevents user-to-user access; this invariant is about
      what the OPERATOR (who has service_role access) may do, and must be
      stated plainly in the Session 10 privacy policy ("your financial data
      is yours — we don't look at it without your permission"). Only
      aggregate, anonymized product metrics (user counts, feature-usage
      counts, import volumes, error rates — never a query scoped to one
      user's own rows for product-analytics purposes) may be collected for
      operations; any analytics/telemetry integration added in a future
      session must be audited against this invariant before being wired
      in, not after.
  14. UNIVERSAL AI CAPTURE — every routing rule (owner decision 2026-07-10,
      PRODUCT DECISION, binding): every business income & expense document
      must be capturable by photo/PDF and auto-routed to the right ledger
      with minimal user effort. Every captured document ends up as exactly
      one of: an income row / an expense (deduction) row / a capital
      transaction / an informational archive-only entry — with the
      original file in Storage and the full raw extraction in
      `documents.parsed_json` (D3 audit trail) regardless of which bucket
      it lands in. Settlement extraction is carrier-agnostic — the AI
      extracts generic fields (carrier, week, gross, deductions, net,
      miles, loads, driver/unit) from ANY carrier's settlement layout, no
      single carrier's format is ever assumed
      (`supabase/functions/ai-import/index.ts`'s
      "carrier-agnostic settlement extraction" addition). docTypes are
      added incrementally as new document categories become common enough
      to warrant their own routing (`driver_payment` → `driver_payments`
      table, never `deductions`; `insurance`/`lease_rent`/
      `factoring_statement`/`utility_subscription` → `deductions` via
      `mapFinancialDocDeduction()`; `government_or_misc_income` is INCOME
      with no dedicated ledger yet — archived only, no financial row
      created, same treatment as `w2`, until a real income ledger exists —
      see PROMPTS.md's "Supported document types" backlog table for
      current status per type). An unknown-but-clearly-financial document
      NEVER gets silently dropped or silently guessed into the wrong
      ledger — it falls back to docType `'other'` with an AI-suggested
      category (`suggestedCategory`) and is saved as a deduction prefixed
      `"NEEDS REVIEW: "` (extending invariant #3's NEEDS REVIEW convention
      from line items to whole documents), always with `confidence:"low"`.
      Every extraction carries a top-level `confidence:"high"|"low"` flag
      (`app/src/import/types.ts` `Extraction.confidence`); the import
      preview surfaces a review banner whenever it's `"low"`, prompting the
      user to confirm fields before saving rather than trusting a guess.
      Full coverage of every docType is a POST-LAUNCH v1.x track, not a
      Session 10 blocker — the launch-blocking core set is settlements
      (any carrier), store receipts, fuel, maintenance, W-2, bank/card
      statements, and driver payments (PROMPTS.md). Every new docType still
      obeys every other invariant unmodified: no separate tax/service rows
      (#3), the 9 payment methods + personal-payment confirmation (#2),
      accountant-readable naming, warranty extraction, per-truck/driver
      routing (#7) — universal capture is additive routing breadth, never
      a second set of rules.
  15. LOCALE-AWARE FORMATTING (owner decision 2026-07-10, PRODUCT DECISION,
      binding — personalization & onboarding package, item 3): every date,
      currency, and number displayed anywhere in the app follows the user's
      selected locale (invariant #11's 7 supported locales), via the
      standard `Intl` APIs (`toLocaleString()`/`toLocaleDateString()`) —
      never a hardcoded `'en-US'`. USD stays the CURRENCY (this app never
      converts an amount to another currency); only its FORMATTING
      localizes (symbol position, decimal/thousands separators, digit
      script). `app/src/i18n/format.ts` is the ONE shared module for this —
      `useFormatters()` inside a component (`money()`/`number()`/`date()`/
      `dateTime()`, all bound to the current `i18n.language`), or the plain
      `formatMoney()`/`formatNumber()`/`formatDate()`/`formatDateTime()`
      functions (which take an explicit `locale` argument) for a non-
      component call site — never a screen-local `money()` helper hardcoding
      a locale again. Scope decision (2026-07-10 pass): this invariant
      governs values that already go through explicit `Intl`-style
      formatting (currency amounts, and call sites that were already
      calling `toLocaleString()`/`toLocaleDateString()`); it does NOT
      retroactively wrap every raw stored date string (e.g. a deduction's
      `ded_date`) in `Intl.DateTimeFormat` — that's a larger, separate
      per-screen pass, not done this session. AI-generated free-text
      (docType `summary`, AI Advisor replies) is covered by invariant #16
      below, not this one — that's a translation concern (what LANGUAGE the
      text is in), this invariant is a formatting concern (how a number/
      date/currency figure is DISPLAYED).
  16. AI IN USER'S LANGUAGE (owner decision 2026-07-10, PRODUCT DECISION,
      binding — personalization & onboarding package, item 4): `ai-import`
      and `ai-advisor` (Edge Functions) accept an optional `locale` in
      their request body and, when it's one of invariant #11's 6 non-
      English supported locales, instruct the model to write free-text it
      composes itself (a document's `summary`, an AI Advisor reply) in that
      language — standard financial/trucking terms may stay English when
      there's no natural equivalent (e.g. "per diem", "ELD", "IFTA"). This
      NEVER applies to enum-like fields (`docType`, `category`,
      `chargebackType`, `incomeType`, `serviceType`, `paymentMethod`) or to
      text copied verbatim from the source document (vendor names, item
      names) — only to text the model generates in its own words, same
      "don't translate the domain values invariant #11 already carves out"
      principle. `app/src/data/aiImportCall.ts`'s `callAiImport()` forwards
      the app's current `i18n.language`; `app/(tabs)/import/index.tsx`'s
      call sites pass it. `ai-advisor` accepts the same `locale` field as
      groundwork — no app screen calls it yet (PROMPTS.md Session 9b "AI
      Advisor"), that screen just has to pass `i18n.language`/
      `profiles.locale` when it's built, no further server-side work.
  17. CUSTOMIZABLE DASHBOARD (owner decision 2026-07-10, PRODUCT DECISION,
      binding, not yet implemented — PROMPTS.md Session 9a): every
      dashboard card (the full parity set + Capital strip + any future
      card) must support drag-to-reorder, show/hide, and rename (a user's
      custom label overrides the i18n default; clearing it restores the
      i18n default — the override is never a replacement string baked over
      the translation, so switching app language still re-translates a
      card whose label the user never customized). Layout persists in
      `profiles.dashboard_layout` (docs/PENDING_SQL.md §19) per user, with
      a "Reset to default" action (`dashboard_layout = null`). No code path
      may hardcode the Dashboard's card list/order as the only possible
      arrangement once this ships — the default order becomes just that,
      a default, same spirit as invariant #7's "single truck is just the
      n=1 presentation" rule.
  18. ROLE-BASED APP MODE (owner decision 2026-07-10, PRODUCT DECISION,
      binding, not yet implemented — PROMPTS.md Session 9b, expanded
      onboarding wizard supersedes the earlier shorter spec):
      `profiles.role` (docs/PENDING_SQL.md §20) is one of `owner_operator`
      / `company_driver_w2` / `contractor_1099` / `trainee`, set during
      onboarding. `company_driver_w2` is the only value that changes
      rendering: it hides owner-only modules (Schedule C deductions,
      Capital Account, S-Corp election) and centers per-diem/W-2 tracking
      instead; `contractor_1099` (and `trainee`/`owner_operator`) get the
      full Schedule C experience unchanged. `role = null` (skipped the
      wizard, or a pre-existing account) MUST behave identically to
      `owner_operator` — never a third, undocumented behavior.
- The UI never shows a raw internal doc-type code (e.g. `'amazon'`) — always
  go through `useDocTypeMeta()`'s human label (e.g. "Store/Amazon Purchase"),
  never the old `DOC_TYPE_META` constant name (renamed — icons are locale-
  independent and live in `DOC_TYPE_ICON`, label/route text is localized).
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
