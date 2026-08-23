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
  one-off — including numeric fields, not just names: its `ensureTruck()`
  used to fall back `fleet_mpg` to `8.9` (the original owner's actual MPG)
  when a backup's health data omitted it, which is exactly the identity
  leak this rule forbids (bug fixed 2026-07-30) — a missing value falls
  back to `null`, never a specific owner's number. The same class of bug
  existed in the Cash Flow 30-day forecast (`app/src/stats/
  cashFlowForecast.ts`, `app/app/(tabs)/more/cash-flow.tsx`): its budget
  inputs (truck payment, fuel, other weekly expenses) defaulted to the
  original owner's own numbers ($1145/$1800/$500) directly in the
  calculation whenever `profiles.cf_*` was null — so even a perfect Reset
  All Data (invariant #24) silently "came back" because the FORM/MATH
  refilled them, not the database. Every Cash Flow budget input now
  contributes exactly `$0` when unset; the 25% tax reserve is the one
  field allowed to appear as a labeled UI suggestion
  (`taxReservePctSuggestion`) but is never applied to the math unless the
  user actually enters it. Any future numeric default sourced from
  `legacy/index.html` (a form placeholder, a `||`/`??` fallback, a seeded
  constant) must be checked against this rule before being ported: legacy
  business LOGIC (formulas, thresholds, tax math) is fair game to port
  verbatim per the rule above, but a legacy DATA VALUE (this owner's
  actual truck payment, MPG, balance, truck unit) is never a valid
  fallback for another user's empty field. A first-launch onboarding
  wizard (PROMPTS.md Session 9b) is the
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
     Session 8 scope decisions: the health math lives ONLY in
     `app/src/truck/health.ts`'s `calcTruckHealth()` — a pure, unit-tested
     TS port of legacy's `rHealth()`/`applyMaintToHealth()`, same "every
     calculation is a tested app/src/ function, never a SQL view" pattern
     as CPM/per diem/tax estimate/driver payroll. The `truck_health` SQL
     view in `supabase/migrations/0001_init.sql` is NOT used by the app —
     it predates this invariant and stays in the schema unused rather than
     being dropped, but no screen may query it; a `0` baseline (no record,
     no override) would render a false "OVERDUE" on a brand-new truck with
     real existing mileage, which `calcTruckHealth()` avoids via a
     `'no_data'` status (neutral "no records yet" prompt) that the SQL
     view has no equivalent for. `truck_health_config.overrides` (manual
     baseline entry) has no editing UI yet — deliberately deferred, since
     the seeded-intervals-plus-no_data-prompt empty state already satisfies
     the "clean, not broken-looking" requirement for a fresh truck.
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
      `settlement_id` from the settlement match) instead of duplicating
      them (`app/src/data/aiImportSave.ts`, owner decision 2026-07-09,
      mirrors the web app's v2026.07.09-A behavior). Maintenance/tolls/
      loans are NOT part of this replace. A replace must not re-credit
      `business_balance` with that week's net pay a second time. The match
      key is `(user_id, week_ending, truck_id)` — NOT `(user_id,
      week_ending)` alone (bug fixed 2026-07-30, docs/PENDING_SQL.md §34):
      a fleet with 2+ trucks routinely has every truck settle on the same
      `week_ending`, and matching without `truck_id` silently replaced one
      truck's settlement with another's. `findExistingSettlement()`
      (`aiImportSave.ts`) is the one shared lookup for this match — used
      both by the actual save/replace decision and by the import preview's
      "this week is already imported, saving will replace it" banner, so
      the two can never disagree. A settlement with no resolvable
      `week_ending` must never silently save under an empty-string match
      key (two such settlements would collide with each other) — the save
      throws instead, since the preview's date field already requires the
      user to see/set this value. DATE HARDENING round 3 (bug fixed
      2026-07-30, root cause of "every settlement replaces the last one"):
      the ai-import extraction prompt's round-2 "prefer the near-today
      reading" instruction (for resolving a year/day-order ambiguity in a
      date that IS printed on the document) was being over-applied to
      INVENT a `weekEnding` when the real one couldn't be found at all,
      landing every settlement on ~today and making them all collide on
      the replace match key. The prompt now has an explicit, settlement-
      specific addition forbidding that: `weekEnding` must come only from
      the document's own printed week-ending/settlement-date text, never
      from today's date, and must be left `""` (never guessed) when
      genuinely absent. Client-side, `app/src/import/dateGuard.ts`'s
      `isSettlementWeekEndingMissing()` renders the preview's date field as
      a prominent, required "Week Ending" field for settlements and blocks
      Save until the user has confirmed a value — this is what actually
      enforces the invariant on-device even if a future prompt regression
      lets the model guess again. Carrier-portal filename false-duplicates
      (e.g. Prime exports every week under one fixed filename) are also
      excluded from the duplicate-import warning for settlements
      specifically (`app/src/import/duplicateCheck.ts`) — only a genuine
      content match (docType + `week_ending` + amount) flags a settlement
      as a possible duplicate, a filename match alone never does. DATE
      HARDENING round 4 — settlement date anchor (owner decision
      2026-07-30, DEFINITIVE FIX, owner's own field diagnosis): carrier
      statements print an unambiguous header print date ("DATE:",
      commonly M/D/YY) about a day before the ambiguous "SETTLEMENTS
      DATE:" (commonly YY/MM/DD, = weekEnding). `settlement.printDate` is
      now extracted alongside weekEnding; `app/src/import/dateGuard.ts`'s
      `resolveWeekEndingWithAnchor(printDate, weekEndingCandidate)`
      deterministically picks whichever digit-order reading of weekEnding
      (as extracted, or year/day-swapped per `trySwapYearAndDay()`) falls
      within `[printDate, printDate+7 days]` — a window tight enough that
      only the correct reading can ever land inside it — and takes
      priority over round 2's "closest to today" heuristic in
      `sanitizeExtractionDates()` whenever printDate is present. Returns
      null (never a guess) when printDate is missing or neither reading
      fits, same as every other rule in this list.
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
      i18n TERMINOLOGY RULE (owner decision, extends this invariant's
      "standard terms may stay English" into a binding glossary rather
      than a case-by-case judgment call): `docs/I18N_GLOSSARY.md` is the
      canonical DO-NOT-TRANSLATE list (per diem, coolant, DPF, DEF, ELD,
      IFTA, IRP, HVUT/2290, settlement(s), linehaul, fuel surcharge,
      detention, layover, lumper, bobtail, deadhead, reefer, APU, CDL,
      DOT, MC number, escrow, factoring, Schedule C, 1099, W-2, K-1,
      S-Corp, LLC) — every term on it stays in English (Latin script
      embedded in the sentence) in every locale's UI strings AND in
      AI-generated free text, no exceptions. Enforced by
      `app/src/i18n/__tests__/glossary.test.ts`, which asserts every
      glossary term found in `en.json` also appears in the corresponding
      key of every other locale file — a translation pass that
      accidentally translates a glossary term fails `npx jest`, not just
      review. Binding on PROMPTS.md Session 9c (Hindi/Ukrainian real
      translation) same as every other locale.
  17. ~~CUSTOMIZABLE DASHBOARD~~ — RETIRED (owner decision 2026-08-02, see
      the DASHBOARD SIMPLIFICATION decision block below). Home is now a
      FIXED layout; this invariant no longer binds. Kept here, struck
      through, for history — do not re-implement any part of it without a
      fresh owner decision superseding the retirement.
      Original text follows, historical only:
      CUSTOMIZABLE DASHBOARD (owner decision 2026-07-10, PRODUCT DECISION,
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
      / `company_driver_w2` / `contractor_1099` / `trainee` /
      `lease_operator` (5th value, docs/PENDING_SQL.md §31, device
      feedback round 2, owner decision 2026-07-13), set during onboarding.
      `company_driver_w2` is the only value that changes rendering: it
      hides owner-only modules (Schedule C deductions, Capital Account,
      S-Corp election) and centers per-diem/W-2 tracking instead;
      `contractor_1099`/`trainee`/`owner_operator`/`lease_operator` all get
      the full Schedule C experience unchanged. `lease_operator` (leases a
      truck from another operator/carrier rather than owning it) is kept
      as its own distinct value rather than folded into `owner_operator`
      so a future carrier-lease-specific feature has something to key off
      without another migration — but it must never be treated as
      `company_driver_w2`. `role = null` (skipped the wizard, or a
      pre-existing account) MUST behave identically to `owner_operator` —
      never a third, undocumented behavior.
  19. CUSTOM CATEGORIES + TAX SAFETY RAIL (owner decision 2026-07-10,
      PRODUCT DECISION, binding): users may create their own income and
      expense categories beyond `CANONICAL_CATEGORIES`
      (docs/INDUSTRY_TAXONOMY.md §B) via `user_categories`
      (docs/PENDING_SQL.md §21 — entirely optional/additive, zero rows
      means every picker just shows the canonical list, same "n=0/1 is
      just the default presentation" spirit as invariant #7). Every
      category picker (deduction edit, manual add, import preview —
      PROMPTS.md Session 9a) must show canonical + the user's own active
      categories together, with an inline "+ New category" option — never
      two separate, un-mergeable lists. A custom EXPENSE category can NEVER
      silently fall out of the P&L/tax estimate: creating one requires a
      `schedule_c_bucket` mapping (defaults to `"Misc"` when the user
      doesn't pick one, `app/src/data/userCategories.ts`
      `applyScheduleCDefault()`), enforced by a DB check constraint too,
      not just app-level validation. A custom INCOME category has no
      bucket — it rolls straight into gross income, there is no Schedule C
      expense line for income. AI classification may suggest a user's
      custom categories too — `ai-import` accepts `customCategories` in
      its request body and instructs the model to pick from that exact
      list rather than inventing a new custom name itself (never let the
      AI silently create categories the user never defined).
  20. NO ARBITRARY USER-DEFINED SCHEMA COLUMNS (owner decision 2026-07-10,
      PRODUCT DECISION, binding — flexible fields instead of free-form
      columns): a user may never add their own ad-hoc column to any table.
      Every financial record already carries a system description
      (`description`/`note(s)`) plus an optional `tags` text field
      (docs/PENDING_SQL.md §22) for the user's own ad-hoc labeling/
      filtering — between custom categories (#19), `tags`, and `notes`,
      there is no legitimate need this app has ever hit that isn't already
      covered by one of these three, additive mechanisms. Why this is a
      hard invariant, not just a preference: a free-form user-defined
      column would have no place in the tax engine's fixed field list
      (CLAUDE.md invariant #6's tax constants, `calcTaxEstimate.ts`'s
      fixed input shape) or the Accountant Package's Schedule C rollup
      (PROMPTS.md Session 9b) — either the column gets silently ignored by
      every report (defeating the point of adding it) or every report
      would need to special-case an open-ended, per-user schema (breaking
      invariant #6's "no tax constant lives in app code, one shared
      constant, not a hundred user-specific ones" principle). `tags` is
      deliberately a single free-text field, not a normalized tags table
      or array column, to keep it that simple.
  21. COMPLIANCE TRACKER (owner decision 2026-07-10, PRODUCT DECISION,
      binding — AI feature package): `compliance_items`
      (docs/PENDING_SQL.md §23) covers 8 categories (medical card, annual
      DOT inspection, IRP registration, HVUT 2290, IFTA quarterly filings,
      insurance policy renewals, CDL expiry, drug-consortium enrollment);
      5 of them (`medical_card`, `annual_inspection`, `irp_registration`,
      `hvut_2290`, `insurance_policy`) auto-populate from matching
      ai-import docTypes — extracting a due/expiry date finds-or-updates
      the ONE matching row per `(user_id, type)` rather than duplicating
      it on every re-scan (`app/src/import/mapExtraction.ts`
      `mapCompliance()`). The AI never guesses a due date — a document
      with no visible expiration/due date is still archived (D3 audit
      trail) but creates no compliance item, same "never guess, flag
      instead" spirit as every other extraction rule. `ifta_filing`/`cdl`/
      `drug_consortium` have no extracting docType yet — manual-entry only
      until a real source document type is identified (v1.x if ever).
  22. NO EXTERNAL-DATA FEATURES (owner decision 2026-07-10, PRODUCT
      DECISION, binding — AI feature package, CEO Mode item): every AI/
      insight feature in this app (CEO Mode briefing, Profit Analysis,
      Maintenance Pattern Insights, AI Advisor) is composed ONLY from data
      the user's own account already holds — settlements, deductions,
      maintenance, compliance items, etc. NO live ELD integration, NO
      fuel-price feeds, NO inventory tracking, and no other pull from a
      third-party API for these features — not now, not as backlog, not
      without a fresh, explicit owner decision that supersedes this one.
      Profit Analysis's industry-benchmark comparison (PROMPTS.md Session
      9a) is the one adjacent case worth spelling out: it compares against
      PUBLISHED, static benchmark ranges (a `benchmarks` table with source
      + year, clearly labeled "industry reference, not peer data" in the
      UI) — never live anonymized peer data pulled from other users of
      this app. True anonymized peer benchmarking is deliberately deferred
      to v2+, once a real user base exists, and even then must be designed
      against invariant #13 (user data is private) from day one — never
      retrofitted onto data collected before that design existed.
  23. VIEW-ONLY MODE IS RETIRED (owner decision 2026-07-12, PRODUCT
      DECISION, binding — Session 9b parity-gap decision #4): legacy's
      `gw_readonly` device-local read-only toggle (FEATURE_INVENTORY.md
      §3.9 — intended for a spouse/other device to view a shared JSON
      backup without editing it) has NO equivalent in this app and never
      will as a device-local flag. It is formally obsolete under the
      multi-tenant model: every user already has their own
      `auth.uid()`-scoped account with RLS enforcing invariant #13, so
      "give someone read-only access to MY data" is a cross-account
      sharing problem, not a local UI lock. Its future replacement (an
      accountant/spouse read-only share link, scoped to one recipient,
      revocable, read-only by construction not by a client-side flag) is
      PROMPTS.md Backlog — a genuinely new feature requiring its own
      schema/RLS design, not a resurrection of `gw_readonly`. No mobile
      screen should ever gain a "View-Only Mode" toggle again without a
      fresh owner decision superseding this one.
  24. RESET ALL DATA — exact kept/cleared list (owner decision
      2026-07-30, tablet-testing fix, binding): `supabase/functions/
      reset-data/index.ts` wipes every business-data table (settlements,
      deductions, fuel, maintenance, loads, trucks, drivers, documents,
      etc. — `TABLES_IN_DELETION_ORDER`) plus the matching Storage files,
      but never deletes the `profiles` row or the `auth.users` account
      itself (unlike Delete Account). Within `profiles`, exactly two
      buckets:
      - CLEARED (`PROFILE_DATA_RESET`): `business_balance`,
        `initial_capital` (both reset to `0`, not null — they're
        always-a-number balances, never "unset"); `weekly_goal`; every
        Cash Flow forecast budget input (`cf_bank_balance`,
        `cf_weekly_revenue`, `cf_truck_payment`, `cf_fuel_weekly`,
        `cf_insurance_monthly` — deprecated (docs/PENDING_SQL.md §39,
        owner decision 2026-08-04), cleared anyway for tidiness —
        `cf_insurance_weekly`, `cf_other_weekly`, `cf_tax_reserve_pct`,
        docs/PENDING_SQL.md §29); `dashboard_layout`;
        `dashboard_sections_collapsed`.
      - KEPT (never touched by the reset, on purpose): `company_name`,
        `owner_name`, `home_state`, `dot_number`, `mc_number`, `locale`,
        `role`, `tos_accepted_at`/`tos_version`,
        `onboarding_completed_at`. `entity_type`/`filing_status`/every
        other tax-profile field lives on `tax_config`, a table this
        function has never touched (see its own file-header comment) —
        nothing to keep-or-clear there, it's simply out of scope by
        table, same as it always was.
      `onboarding_completed_at` moved from CLEARED to KEPT this pass —
      before 2026-07-30 it was deliberately nulled so the onboarding
      wizard could be re-tested without a fresh account; it's now treated
      as an identity/prefs field like the rest of that list, so Reset All
      Data no longer forces the wizard to run again. Any FUTURE new
      `profiles` column must be explicitly sorted into one of these two
      buckets before shipping — there is no default; an unlisted column
      is silently KEPT (an `.update()` with an explicit field list never
      touches columns it doesn't name), which is exactly how
      `dashboard_layout`/`dashboard_sections_collapsed` were missed and
      kept reappearing after a reset until this pass added them. The
      client mirror (`app/src/data/queryInvalidation.ts`'s
      `invalidateFinancialData()`) must invalidate every react-query key
      that reads a CLEARED field — `'profile'` (the full-row
      `useProfile()` fetch, distinct from AuthContext's own narrower one)
      and `'dashboard-layout'` are both required there for the same
      reason: a correct server-side reset with a stale client cache still
      *looks* like the bug to the user.
  25. PER DIEM INTELLIGENCE + ASSET PURCHASE & FINANCING (owner decision
      2026-07-30, PRODUCT DECISION, mega-pass parts B/C): per diem is no
      longer a flat 7 days × distinct settlement weeks — every settlement
      carries its own `per_diem_days` (0-7, `docs/PENDING_SQL.md` §35),
      smart-defaulted at import/save time from miles
      (`app/src/tax/perDiem.ts` `defaultPerDiemDaysForMiles()`: 0 miles ->
      0 days "home week," else 7) and freely editable on both the import
      preview and the settlement detail screen afterward.
      `calcPerDiemDays()` SUMS whatever's stored per settlement — it never
      re-derives from miles itself, so a user's edit always sticks — and
      dedupes a repeated `week_ending` (a multi-truck fleet settling every
      truck the same week) by taking the MIN value among the duplicates,
      never summing them (the same calendar week can't count as
      away-from-home twice). Every asset (truck, trailer, or unlimited
      "other equipment" via the new `equipment` table, docs/PENDING_SQL.md
      §36) carries its own `purchase_price`/`purchase_date`/`financing`
      (`'cash'|'loan'`) — a trailer's financing is independent of its
      tractor's even though both live in the same `trucks` row (mirrors
      the existing `trailer_*` fold-in pattern). A loan links via
      `loan_id`/`trailer_loan_id`/`equipment.loan_id` to the SAME `loans`
      table every other Loan Center entry already uses — payments keep
      flowing through the existing principal/interest logic unchanged,
      this is only the asset-side pointer to "which loan financed this."
      Populated either by uploading a financing document (ai-import
      docType `loan_agreement` — extracts lender/amount/apr/payment/
      frequency/nextDue/assetType/assetName, always creates the Loan
      Center row unconditionally) or by manual entry
      (`app/src/components/AssetFinancingFields.tsx`, shared by the Trucks
      and Equipment screens). Asset linking from an import is
      auto-matched by assetName against unit_number/trailer_unit_number/
      equipment.name (`app/src/import/loanAssetMatch.ts`
      `resolveLoanAssetMatch()`) and — same "less aggressive than truck/
      driver match, never forces a picker" spirit as `driverMatch.ts` —
      the loan is ALWAYS created in Loan Center regardless of whether a
      match is found; linking is a bonus, never a blocking extra step.
      `loan_id`/`trailer_loan_id`/`equipment.loan_id` are `on delete set
      null` (never a plain FK) because Reset All Data and Delete Account
      both delete `loans` before `trucks`/`equipment` in their deletion
      order — a plain FK would make either flow fail outright.
      `"equipment"` was added to both Edge Functions'
      `TABLES_IN_DELETION_ORDER` and to `queryInvalidation.ts`'s
      `AFFECTED_TABLES` in the same pass (see invariant #24 and the data-
      flow audit below) — a new table wired into Reset without also being
      wired into invalidation is exactly the class of bug that audit
      exists to catch.
- DATA-FLOW CONSISTENCY (owner decision 2026-07-30, mega-pass part A):
  `docs/DATA_FLOW.md` maps every mutation (import new/replace, manual
  add/edit/delete per entity, Mark-as-Done, capital tx, budget save,
  Reset, Delete Account) to every screen/stat that must reflect it — the
  reference to check before assuming a screen "just doesn't update."
  That audit found and fixed two concrete gaps: (1) 8 tables Reset All
  Data wipes (`trucks`, `drivers`, `driver_payments`, `household_income`,
  `household_members`, `compliance_items`, `maintenance_intervals`,
  `truck_health_config`) were silently missing from
  `queryInvalidation.ts`'s `AFFECTED_TABLES`, so those screens kept
  showing pre-reset data — `app/src/data/__tests__/queryInvalidation.test.ts`
  now regression-guards this by mirroring `TABLES_IN_DELETION_ORDER`; (2)
  Cash Flow's "Weekly Revenue" forecast input had zero connection to the
  `settlements` table at all (a manually-typed budget number only), so it
  stayed $0 after every import — `trailingWeeklyRevenueAverage()`
  (`app/src/stats/cashFlowForecast.ts`) now fills it from the trailing
  4-week actual settlement gross average, labeled "from your settlements"
  in the UI, whenever the user hasn't entered their own number; a manual
  entry always overrides it, and the SAVED value still persists `null`
  when empty so the average keeps recomputing live from the latest
  imports rather than freezing.
- CUSTOMIZE DASHBOARD DIAGNOSTICS (owner decision 2026-07-30, device
  feedback round 4): a triple-tap on the screen title reveals a small,
  deliberately plain diagnostics panel (rendering mode, card count,
  layout JSON length, query status, last caught error) — temporary
  instrumentation for device bug reports, not a permanent UI feature.
  Two real silent-failure bugs found by this pass's review and fixed
  alongside it: the loading card's `!draft` condition could stay true
  forever if the `profiles` fetch itself errored (now falls back to
  `mergeDashboardLayout(null)` so the screen is always usable even when
  the fetch failed); `DraggableFlatList`'s error boundary
  (`DragListErrorBoundary`) only catches RENDER-path errors, never one
  thrown inside `onDragEnd`'s event-handler callback — that callback now
  has its own try/catch as a second safety net, both permanently
  downgrading to the guaranteed-safe arrows-only `FlatList`.
- CUSTOMIZE DASHBOARD — CRASH-ON-MOUNT, the actual root cause (owner
  decision 2026-07-30, decisive device evidence: a white flash then the
  screen closes, before first paint, so the diagnostics panel above never
  even got a chance to render): every fix up to this point was downstream
  of the real bug — `dashboard-customize.tsx` imported
  `react-native-draggable-flatlist` (built on reanimated + gesture-
  handler) STATICALLY at module scope. If that native module fails to
  link/initialize in a release build, evaluating the screen's own module
  throws before React renders anything at all — no error boundary,
  wherever placed, can catch a throw during `require()`/module
  evaluation, because the component tree that would contain the boundary
  never gets built. Fixed two ways, together: (1)
  `app/src/dashboard/dragModuleLoader.ts`'s `loadDragModule()` — the ONLY
  reference to the drag module anywhere in the file is now a type-only
  `import type` (erased entirely at compile time, zero runtime
  reference); the real module is loaded lazily, inside a `useEffect`
  (never during the synchronous render), wrapped so ANY failure resolves
  to `null` instead of propagating — the arrows-only baseline is
  therefore always what's rendered on first paint (dragModule starts
  `null`), upgrading to drag-plus-arrows only after a load that has
  already proven it won't crash; (2) `app/src/components/
  ScreenErrorBoundary.tsx` — a reusable, generic screen-level error
  boundary that renders the error message + component stack ON SCREEN
  (not just console), now wrapping the whole Customize Dashboard screen.
  The two are complementary, not redundant: the boundary is the safety
  net for anything that could still go wrong AFTER the module
  successfully loads; the lazy loader is what prevents the crash from
  ever reaching a boundary in the first place. Available for reuse on any
  other screen with a similarly risky native-module dependency. Follow-up
  (device evidence: a PERSISTENT white screen after that fix landed —
  changed behavior from the earlier white-flash-then-close, meaning an
  update DID reach the device): audited `ScreenErrorBoundary` end to end
  (already 100% dark-themed colors, reinforced with an explicit
  `flex:1`/`colors.bg` outer wrapper so the dark background is guaranteed
  to paint full-screen regardless of the navigator's own flex chain) and
  the arrows-only baseline (found and fixed a real gap: `draft` used to
  start `null` and only populate once `layoutQuery` resolved, so first
  paint showed an EMPTY card list — not literally white given `Screen`'s
  own dark background, but a real violation of "must render synchronously
  with a hard default layout, no query-await before first paint"). `draft`
  now initializes via `useState(() => mergeDashboardLayout(null))` — a
  pure, synchronous call, so the full default card list is what's on
  screen before the network round-trip even starts; a `hydrated` flag
  (not `draft` itself) tracks whether the user's real saved layout has
  arrived, gating Save (never silently overwrite an unseen real layout
  with the placeholder default) without ever gating the cards themselves.
- CHART LANGUAGE CONSISTENCY (owner decision 2026-07-30): every trend
  chart app-wide draws from one shared, tested primitive —
  `app/src/stats/chartHelpers.ts`'s `buildPolylinePoints()`/
  `buildAreaPoints()` (extracted from the Dashboard hero card's own
  hand-rolled SVG math) — a thin 1-2px `react-native-svg` `Polyline`,
  optionally with a subtle translucent `Polygon` fill underneath
  ("Apple Stocks style"). Cash Flow's Weekly Trend chart was the one
  holdout still using thick opaque bars; restyled to match (gross = thin
  accent-blue line, no fill; net = thin green/red line with a subtle
  fill, colored by its most recent value's sign). Any NEW trend chart
  must use these shared helpers rather than hand-rolling bars again.
- NAV PARITY (owner decision 2026-07-30, device evidence: "Documents"
  missing from the wide-screen sidebar's TOOLS group despite being
  reachable from the More tab): `app/(tabs)/more/index.tsx` used to
  maintain its OWN separately hand-written item list — Equipment and then
  Documents were each added there but never to `WideSidebar.tsx`'s
  `GROUPS` (which WideSidebar AND `MenuSheet.tsx` both already rendered
  directly, so they were ALREADY guaranteed identical to each other — the
  actual divergence was between those two and the More tab's flat list).
  `app/src/navigation/navRegistry.ts` is now the ONE shared registry
  every nav surface derives from — `WideSidebar.tsx` re-exports
  `GROUPS`/`isActiveRoute` from it (so `MenuSheet.tsx` and
  `app/(tabs)/reports.tsx`'s existing imports don't need to change), and
  `more/index.tsx` calls its `moreTabItems()` (the full registry minus
  the 5 routes that already have their own bottom-tab icon — Home,
  Transactions, Import, Deductions, Truck Health — named explicitly via
  `TAB_BAR_HREFS`, not inferred). A route added to ONE nav surface but not
  another is now structurally impossible — there is only one list left to
  add it to. `src/navigation/__tests__/navRegistry.test.ts` regression-
  guards the exact reported bug (Documents under tools, Equipment under
  business) plus the general "every non-tab-bar route appears in
  moreTabItems" invariant. The orphaned `more.*` i18n block (labelKeys the
  old separate list used, since replaced by the registry's `nav.*` keys)
  was deleted from all 7 locales — confirmed unused everywhere first.
- NAV SIMPLIFICATION / FEATURE FLAGS (owner decision 2026-07-30): Bank
  Statement and Credit Cards are hidden from every nav surface (phone
  Menu, wide sidebar, Reports hub — all of which render through
  `navRegistry.ts`, so this is one change, not three) behind
  `app/src/config/featureFlags.ts`'s `FEATURE_FLAGS.bankCreditCards`
  (default `false`). This is the established pattern for "turn a feature
  off without deleting it": `navRegistry.ts` keeps the full, unfiltered
  route list as `RAW_NAV_GROUPS` and exports a flag-filtered `NAV_GROUPS`
  (`filterNavGroupsByFlags()`, pure and directly testable) as the one
  thing every surface actually renders from — flipping the flag back to
  `true` restores both routes everywhere instantly, no code/table/test
  changes needed. Capital Account is explicitly NOT gated by this flag
  (owner-contribution flow, draw tracking, and tax basis depend on it —
  confirmed decision). Existing `bank_statements`/`bank_transactions`/
  `credit_cards` rows are untouched and still readable by anything that
  queries them directly (e.g. Accountant Package's own aggregate) — the
  flag only gates NAVIGATION and NEW rows. The legacy-backup importer
  (`app/src/data/legacyImport/importLegacyBackup.ts`, the only actual
  "import" pathway for these two entities — ai-import's docType schema
  has never covered bank/card statements) checks the same flag for its
  3 relevant entities (Credit Cards; Bank statements' card-type AND
  checking-type rows, both landing in `bank_statements`) and, when off,
  skips writing new rows and pushes a plain informational line to the
  import result's existing `warnings` array (never styled as a failure)
  when the backup payload actually contained rows of that type — "politely
  say the feature is currently disabled," never a silent skip and never
  an error. Any FUTURE feature that needs this same "hide without delete"
  treatment should follow the identical pattern: a new `FEATURE_FLAGS` key
  + gating at the single registry/import choke point, never scattered
  per-screen conditionals.
- RUNTIME VISIBILITY (owner decision 2026-07-30 — "which JS is on this
  device should never be a guess again"): `app/src/lib/buildInfo.ts`'s
  `getBuildInfo()`/`formatBuildInfoLine()` — app version
  (`Constants.expoConfig?.version`), the EAS Update id (`Updates.updateId`,
  the single most reliable "which bundle actually loaded" signal, shown
  short-form), and a git commit hash (`app.config.js`'s build-time
  injection of `EAS_BUILD_GIT_COMMIT_HASH`, an env var EAS Build sets
  automatically on every cloud build — null for a local dev-client run).
  `app.json` was converted to `app.config.js` (dynamic config) SOLELY to
  read that env var at build time; every other field is unchanged. Shown
  in Settings' footer AND on `ScreenErrorBoundary`'s crash screen (with a
  "Copy Details" button bundling build info + error + both stacks via
  `expo-clipboard`) — both read from this one module so they can never
  disagree about the format. The pure formatting half
  (`app/src/lib/buildInfoFormat.ts`) has zero expo-constants/expo-updates
  imports so it stays unit-testable and safely importable from
  `ScreenErrorBoundary` (the last line of defense) without adding a new
  native-module dependency to worry about there.
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
- Dark theme colors (owner decision 2026-07-10, Session 9e-B10, "BOZKA AI"
  design language — SUPERSEDES the earlier rule below): `app/src/theme.ts`'s
  `colors` constant is deeper blacks (`bg:#08080c`, `side:#101015`,
  `card:#16161d`, `card2:#1c1c26`, `border:#26262f`, `text:#f0f0f5`,
  `muted:#8a8a99`) with a blue-600 accent (`accent:#2563eb`, the
  `#2563eb` family). The 4 semantic signal colors (green/red/orange/
  purple) are UNCHANGED. `theme.ts`'s own header comment carries the
  original legacy-CSS-variable values for history; no other file may
  hardcode a color from that old palette going forward — always import
  from `theme.ts`. (Superseded rule, kept for context: dark theme colors
  used to come verbatim from the CSS variables in legacy/index.html.)
- UX MEGA-PASS item A — NAVIGATION ROOT CAUSE (owner decision 2026-07-31,
  device evidence: "back always lands on Truck page," "per diem card opens
  Tax Estimator," "Recent Loads opens Cash Flow"). Two distinct root
  causes, one pass: (1) `app/(tabs)/_layout.tsx`'s `<Tabs>` never set
  `backBehavior`, so it defaulted to React Navigation's `'history'` — once
  a tab's own stack is back at its root, hardware/gesture back jumps to
  whichever OTHER tab was most recently active, not Home. `truck-health`
  (href: null, but still its own sibling `Tabs.Screen`, not a route nested
  under `more`) is reached from many shortcuts (Home's Truck Status card,
  Reports' Intelligence group), so it was very often "the last other tab,"
  making it the constant back target. Fixed by setting
  `backBehavior="initialRoute"` — back now deterministically returns to
  this navigator's initial route (index / Home) once a tab's stack is
  exhausted. (2) Dashboard card destinations were ad-hoc inline
  `router.push()` calls scattered through `app/(tabs)/index.tsx` with no
  single place to audit — several routed to a generic catch-all instead of
  their actual content (per diem cards → Tax Estimator, which has no per
  diem breakdown at all; Recent Loads → Cash Flow instead of Loads). Fixed
  by extracting one table, `app/src/stats/dashboardLayout.ts`'s
  `DASHBOARD_CARD_ROUTES` (card id → route), which `index.tsx`'s
  `goToCard()` helper reads instead of hardcoding a push per card — per
  diem cards now route to Settlements (where `per_diem_days` actually
  lives and is user-editable, CLAUDE.md invariant #25), Recent Loads
  routes to Loads. `src/stats/__tests__/dashboardLayout.test.ts` regression-
  guards both the specific reported bugs and the general "every route
  starts with `/(tabs)/`" sanity check. Any future card with a fixed
  destination goes in this table, not an inline `router.push()`.
- UX MEGA-PASS item B — MODAL/SHEET CONSISTENCY (owner decision
  2026-07-31, device evidence: "deduction edit has no save/cancel/close
  and doesn't scroll and doesn't save"). Root cause: the shared
  `ModalSheet` (`app/src/components/ui.tsx`) had no height cap and never
  wrapped its children in a ScrollView — on a sheet with enough content
  (category picker + tax-deductible pills + amount field + all 9 payment-
  method pills), the card grew taller than the viewport and the overlay's
  centered, non-scrolling layout silently clipped the overflow, so Save/
  Cancel at the bottom were rendered but physically unreachable —
  "doesn't save" was a reachability symptom, not a mutation bug (the
  `updateDeduction.mutateAsync({ id, values })` call itself was already
  correct). Some screens (Settlements, Trucks, Maintenance, etc.) had
  independently worked around this with their own ad-hoc
  `<ScrollView style={{ maxHeight: 480 }}>` wrapper; others (Deductions,
  Capital Account, Loans, ...) had not, which is why the bug was
  inconsistent across screens. Fixed centrally, once, with zero required
  call-site changes: `ModalSheet` now (1) caps `modalCard` to 85% of the
  window height and wraps `children` in its own `ScrollView`
  (`keyboardShouldPersistTaps="handled"`) so a sheet ALWAYS scrolls
  instead of silently overflowing; (2) renders a consistent ✕ close button
  in the top-right corner wired to the same `onClose` every call site
  already passes, satisfying "every modal/sheet gets a consistent header:
  title + X close" without an API change; (3) wraps the overlay in a
  `KeyboardAvoidingView` so an open keyboard never covers Save either. The
  now-redundant ad-hoc `<ScrollView style={{ maxHeight: N }}>` wrappers
  were removed from every screen that had one (truck-health, asset-
  register, equipment, drivers, trucks, compliance, maintenance, tax-
  estimator, settlements, documents) to avoid nesting two same-axis
  ScrollViews — bank-statements.tsx's inner `maxHeight: 360` ScrollView
  around its transaction list was deliberately left alone, since that one
  bounds a sub-list inside a longer sheet rather than duplicating the
  sheet's own scroll. The Import tab (reached via the raised center [+]
  button / action sheet, not a natural back-push, and — as its own
  sibling `Tabs.Screen` — with no default back arrow) gained an explicit
  `headerLeft` ✕ close button (`ImportCloseButton` in
  `app/(tabs)/_layout.tsx`) that routes straight to Home, same "always a
  way out" principle. Any FUTURE sheet just uses `ModalSheet` — the
  close X, scroll, and keyboard-avoidance come for free.
- UX MEGA-PASS item C — CUSTOMIZE DASHBOARD PLAIN FALLBACK (owner decision
  2026-07-31, device evidence: "still broken; also unreachable from the
  'Good morning' header link" — the 4th device report on this screen
  despite three prior rounds of hardening `app/(tabs)/more/
  dashboard-customize.tsx` itself: crash-on-mount fix, synchronous-first-
  paint fix, error boundary, on-screen diagnostics). Rather than a 5th
  attempt at hardening a screen that depends on a native drag module and
  lives behind its own route — either one a fresh place for a device-
  specific failure to hide — the Dashboard's "Customize" header link no
  longer navigates to that route at all. It now opens
  `app/src/components/SimpleCustomizeDashboardModal.tsx` directly, in
  place, via `ModalSheet` (so it gets item B's close X/scroll/keyboard-
  avoidance for free): pure local component state, zero external
  libraries (no `react-native-draggable-flatlist`, no reanimated/gesture-
  handler dependency at all), show/hide toggles + ▲▼ reorder only — the
  same `useDashboardLayout`/`useUpdateDashboardLayout` hooks and
  `DashboardCardConfig`/`mergeDashboardLayout` types as the fancy screen,
  just a dumber, bulletproof renderer on top. This is now the PRIMARY
  path. The fancy screen (drag, per-card labels, section assignment) is
  demoted to a secondary, opt-in "Advanced editor" button inside this
  modal — still fully intact, still reachable, just no longer the only
  door in. `dashboardCustomize.simpleSubtitle`/`advancedEditor` are the
  two new i18n keys this required (all 7 locales, hi/uk as untranslated
  English copies per invariant #11). Any future "this screen might not
  mount" risk elsewhere in the app should default to this same pattern —
  a plain, dependency-free primary path with the risky/fancy version kept
  as an opt-in upgrade, not the reverse.
- UX MEGA-PASS item D — IMPORT FLOW (owner decision 2026-07-31): (1)
  payment method was already auto-detected at Save time
  (`normalizePaymentMethod(extraction.purchase?.paymentMethod)`,
  `app/(tabs)/import/index.tsx`) but had NO editable UI anywhere in the
  preview — a wrong AI guess had no fix short of editing the deduction
  after the fact. The import preview now shows the same 9-pill payment-
  method picker Deductions uses (`app/(tabs)/import/index.tsx`'s local
  `Pill`), for `amazon`/`store` (purchase) extractions only, wired
  through a new pure helper, `app/src/import/paymentMethods.ts`'s
  `withPaymentMethod(extraction, method)` — mirrors `dateGuard.ts`'s
  `withPrimaryExtractionDate()`/`perDiem.ts`'s `withPerDiemDays()` pattern
  so the screen's single `extraction` state stays the one source of truth
  Save reads from, no separate override state to drift out of sync. (2)
  The post-save screen's single "Import Another" button is now three:
  **View Record** (opens `/(tabs)/more/documents?openId=<documentId>` —
  `SaveExtractionResult.documentId` is always available regardless of
  docType, and the Documents viewer's existing "linked records" list
  already jumps from there to the actual settlement/deduction/maintenance
  row, so this reuses 100% existing plumbing rather than adding a new
  per-docType route table), **Import Another** (unchanged, calls the
  existing `reset()`), and **Done** (routes to `/(tabs)`, Home).
- UX MEGA-PASS item E — DOCUMENT TITLES (owner decision 2026-07-31,
  device evidence: a document's title/label must reflect the actual
  store or document subject, e.g. "Walmart," not the raw docType label
  "Store/Amazon Purchase"). `documents.parsed_json` always holds the FULL
  raw `Extraction` regardless of docType (D3 audit trail,
  `aiImportSave.ts`), and `Extraction.vendor` is populated by the AI-
  import prompt for any document that names a vendor/shop on its face —
  not just purchase receipts. `app/src/data/documentTitle.ts`'s pure
  `deriveDocumentTitle(parsedJson, fallbackLabel)` reads that vendor and
  falls back to the docType's own `docTypeMeta(...).label` when none was
  extracted (unchanged behavior for docTypes that never carry a vendor,
  e.g. a bank statement). Wired into both the Documents list row and the
  viewer's `SheetTitle` (`app/(tabs)/more/documents.tsx`) — the docType
  label is kept as a secondary muted line whenever it differs from the
  title, so the document category is never lost, just demoted from
  "the only thing you see" to "context under the actual name." The
  viewer's close X came for free from item B's ModalSheet upgrade.
- UX MEGA-PASS item F — SHARE WEEKLY PROFIT (owner decision 2026-07-31):
  the entire capture/destinations/clipboard pipeline was extracted out of
  `app/(tabs)/more/share-profit.tsx` into `app/src/components/shareCard/`
  — `shareDestinations.ts` (the destination list), `useShareCapture.ts`
  (the ViewShot-capture + clipboard/Linking/system-share-sheet logic,
  content-agnostic — caption and pre-translated alert strings are passed
  in per call, not closed over), `useShareMessages.ts` (builds those
  strings once via `t()`), `ShareDestinationsRow.tsx` (the button row),
  and `ShareCardModal.tsx` (a `ModalSheet`-based wrapper bundling all of
  the above for a screen that just wants a share button, not a whole
  screen). This is what "same share-card pipeline" means below. (1)
  WhatsApp, SMS/Messages, and Copy Image added to
  `shareDestinations.ts`'s `SHARE_DESTINATIONS` — Copy Image is a pure
  clipboard action (`dest.key === 'copy'`, no `scheme`, never calls
  `Linking.openURL`) rather than a literal "Copy Link," since this app
  has no hosted image/link URL to copy (CLAUDE.md invariant #22, no
  external-data features/backend) — copying the branded image + caption
  straight to the clipboard is the one coherent thing "copy" can mean
  here. (2) The metric-toggle row's on-screen card is now keyed
  (`key={cardKey}`, derived from the exact inputs that determine its
  content: included metrics + selected week) so the ViewShot child View
  fully re-mounts on every toggle/week change, rather than relying on a
  third-party native view wrapper's own diffing to catch a state update —
  a defensive fix for the reported "toggling MPG doesn't change the
  rendered card" symptom. (3) A week picker (horizontal pill row, only
  shown when 2+ settlements exist) lets any past week be shared, not just
  the latest — `selected` (the settlement being shared) replaces the old
  hardcoded `latest` throughout. (4) AI Coach (`ceo-mode.tsx`) and
  Scorecard (`scorecard.tsx`) both gained a "📤 Share" header link that
  opens a `ShareCardModal` with content appropriate to each screen — CEO
  Mode's business score + this week's revenue/profit, Scorecard's score/
  grade + revenue-per-mile/net-per-mile — through the identical
  destinations row and capture pipeline Share Weekly Profit uses, per the
  directive's "same share-card pipeline, appropriate content."
- UX MEGA-PASS item G — CHARTS & HOME LAYOUT (owner decision 2026-07-31):
  (1) the Hero Card gets period tabs — This Week / Last Week / 1M / 3M /
  6M / Yearly — driving the number, delta, AND chart together via the new
  `app/src/stats/heroPeriod.ts`'s `calcHeroPeriod()`. thisWeek/lastWeek
  stay the pre-existing straight two-settlement-week comparison (weekly
  is this app's only revenue granularity, CLAUDE.md invariant #9);
  1M/3M/6M/yearly sum every week's net within a rolling N-day window
  (30/90/180/365) and compare it to the immediately PRECEDING equal-
  length window — a rolling comparison, not the unrelated "YTD Per Diem
  Days" stat's calendar-year convention, so every non-weekly period's
  delta is defined the same consistent way. The "vs last week" $-delta
  copy only shows for the two weekly periods; every other period shows a
  new generic "vs previous period" string
  (`dashboard.hero.vsPreviousPeriodAmount`). (2) The Dashboard's Overview
  chart (`RevenueExpenseChart`, the `revenueExpenseTrend` card) was the
  one remaining thick-opaque-bar holdout — restyled to the same thin-line
  `buildPolylinePoints()`/`buildAreaPoints()` primitive (src/stats/
  chartHelpers.ts) Hero/Cash-Flow already use (CLAUDE.md's CHART LANGUAGE
  CONSISTENCY invariant), two lines (revenue green, expenses red) sharing
  one Y-axis domain via `buildPolylinePoints`'s `domain` param — plotting
  them independently would have made a false visual comparison. (3) Cash
  Flow's 4-week balance timeline section (the `cashFlowScreen.
  timelineTitle` Card, `forecast.weeks` row list) was removed from
  `app/(tabs)/more/cash-flow.tsx` per the directive — the underlying
  `weeks` field stays computed in the forecast stats module (unused by
  any screen now, not deleted, in case a future screen wants it) rather
  than being torn out of the pure calculation. (4) Recent Loads' route
  text (`{{order}} · {{origin}} → {{destination}}`) had no `flex`/
  `numberOfLines` constraint sharing a row with the revenue amount — a
  long route could overflow past the card edge or squeeze the amount
  column on narrower phones (and, less visibly, tablets with more cards
  per row). Fixed with `flex:1`+`numberOfLines={1}` on the route text and
  `flexShrink:0` on the amount — `MutedText` (`src/components/ui.tsx`)
  gained a `numberOfLines` passthrough prop to make this possible, since
  it didn't forward one before. (5) AUDIT FINDING — the Dashboard's "Net
  to Owner" card was reading `stats.netRevenue`: the sum of each
  settlement's own `net` field, i.e. net PAY (gross minus carrier-
  WITHHELD deductions only) — it silently ignored every out-of-pocket
  business expense (fuel, maintenance, store purchases — any deduction
  with `source != 'settlement'`), overstating what the owner actually
  nets by exactly that amount. Verified against `src/stats/profitLoss.ts`
  (Operating P&L)'s `buildProfitLoss()`, whose own header comment proves
  the correct formula: `netIncome = grossRevenue - totalDeductions(ALL)`
  is mathematically identical to `netRevenue - outOfPocketDeductions`
  ("gross - withheld already equals settlement net by definition").
  Fixed: the card and its sparkline (previously `weeklyNetTrend`'s bare
  per-week `.net`, same bug at per-week granularity) now both derive from
  `fullWeeklyRevenueExpenseTrend`'s `revenue - expenses`, which already
  nets ALL deductions correctly (it's the same source the Hero Card and
  the newly-restyled Overview chart use). NOT fixed in this pass, flagged
  as a known follow-up: the identical "settlement net, not true profit"
  pattern also feeds `buildWeeklyTrend()`'s `.net` field, which is what
  Scorecard's weekly trend, CEO Mode's "This Week Profit" card, and Share
  Weekly Profit's "Profit" metric all display — each reads as "profit"
  but is actually settlement net pay, the same conceptual gap this audit
  found and fixed for the Dashboard specifically. Fixing those three
  needs its own pass (they're a different card/screen from the one this
  audit item named) rather than a scope-creeping side effect here.
- UX MEGA-PASS item H — PER DIEM RE-CHECK (owner decision 2026-07-31,
  device evidence: re-verify `calcPerDiemDays` end to end). Traced the
  full pipeline and found it correct at every stage, already covered by
  `src/tax/__tests__/perDiem.test.ts`'s existing 0-mile/dedup/clamp
  cases: (1) import preview — `applyDefaultPerDiemDays()` smart-defaults
  a new settlement's `perDiemDays` to 0 for a 0-mile "home week," 7
  otherwise, editable via `withPerDiemDays()`; (2) save —
  `mapExtraction.ts`'s `mapSettlement()` writes
  `clampPerDiemDays(s.perDiemDays ?? defaultPerDiemDaysForMiles(miles))`,
  the same smart default as a fallback if the preview step was somehow
  skipped; (3) settlement detail (`settlements.tsx`) — freely editable
  after the fact; (4) `fetchFleetStats()` selects `per_diem_days` and
  calls `calcPerDiemDays(rows)`, which SUMS whatever's stored per
  settlement (deduped by `week_ending`, taking the MIN on a multi-truck
  fleet's same-week duplicate) — it never re-derives from miles, so a
  user's manual edit always sticks. Computed a concrete 2-settlement
  dataset to verify end to end: one full OTR week (W/E 2026-07-18, 2,500
  mi, `per_diem_days: 7`) + one home week (W/E 2026-07-25, 0 mi,
  `per_diem_days: 0`) → `calcPerDiemDays()` returns **7**, matching the
  expected 7 + 0 = 7 exactly (verified by direct test run, not just
  manual arithmetic). The one real gap found: the day-count breakdown was
  only visible after tapping into a settlement's detail sheet, not at a
  glance in the Settlements list — added
  `settlementsScreen.perDiemDaysCount` ("{{count}}/7 per diem days") to
  each list row so the breakdown is visible without an extra tap, per the
  directive's "show the day count breakdown per settlement somewhere
  visible."
- BETA FEEDBACK ROUND (owner decision 2026-07-31, real device tester
  report). Four items:
  1. MONTH GROUPING: every long chronological list gets collapsible month
     sections — implemented ONCE as `app/src/stats/monthGroups.ts` (pure
     `groupByMonth()`: buckets rows into `{monthKey, count, total, rows}`,
     descending, a row with no parseable date lands in a trailing
     `'unknown'` bucket rather than being dropped) +
     `app/src/components/monthGroups/useMonthCollapse.ts` (session-scoped
     collapse state — a module-level `Map`, deliberately NOT
     AsyncStorage/a saved profile field, keyed by `${screenKey}:
     ${monthKey}`, so it survives a screen unmount/remount for the life
     of the JS process and resets on a real app restart, exactly matching
     "remembered... for the session") +
     `app/src/components/monthGroups/MonthGroupedList.tsx` (the header
     row: month label + item count + $ total, tap to expand/collapse;
     current month expanded by default, every older month collapsed).
     `MonthGroupedList` deliberately does NOT impose a single row-
     container style — it takes a `renderRows(rows)` slot rather than a
     per-row renderer, because this app's list screens already render a
     month's worth of rows two different ways (Settlements/Loads/
     Documents: one TappableCard per row; Reimbursements/Deductions/Fuel/
     Tolls/Other Income/Maintenance: bordered rows inside one shared
     Card) and forcing a single container would have meant restructuring
     visuals nobody asked to change. Wired into Settlements,
     Reimbursements, Deductions (both the out-of-pocket and withheld
     sections independently — `screenKey`s `deductions-outOfPocket`/
     `deductions-withheld` — each keeps its own overall total displayed
     above the grouped list now, instead of inline in the same card as
     the rows), Fuel (tractor/reefer sections independently), Tolls,
     Loads, Other Income, Documents, and Maintenance — 9 screens total
     (the 8 named explicitly plus Maintenance, judged the same kind of
     long chronological list). Registries that aren't primarily date-
     browsed lists (Trucks, Drivers, Equipment, Compliance, Loans, Asset
     Register, Bank Statements, Credit Cards) were deliberately left
     alone — `MonthGroupedList` is available for any of them later via
     the exact same 3-file import.
  2. HOME HEADER: the mid-page company-name + email Card (non-functional
     when tapped) is gone. Company name now renders in the Dashboard's
     top bar, under the wordmark where the tagline normally sits —
     `BrandWordmark` (`app/src/components/BrandWordmark.tsx`) gained an
     opt-in `companyName` prop that swaps in for the tagline only when
     passed and non-empty; every OTHER `BrandWordmark` call site (CEO
     Mode's own in-page header block, share-card footers, the wide
     sidebar) is untouched and keeps showing the real tagline, since this
     is per-call-site, not a global behavior change. The whole header
     title block (`DashboardHeaderTitle` in `app/(tabs)/_layout.tsx`) is
     now a `Pressable` straight to Settings (`/(tabs)/more/settings`,
     where the Business Profile section already lives). Email is dropped
     from Home entirely — it was never actionable there and belongs in
     Settings.
  3. EXPENSES BREAKDOWN: added a `'ytd'` third option to
     `MoneyBreakdownRange` (`app/(tabs)/index.tsx`) alongside This Month/
     Last Month — same donut + legend + tap-through-to-Deductions
     behavior, just a wider date window (matches this calendar year
     regardless of month, the same YTD convention every other YTD figure
     in the app already uses — not a rolling 365 days).
  4. VISUAL CONSISTENCY: satisfied as a direct consequence of item 1 —
     all 9 list screens now share the literal same month-header
     component/styling/tap-target size, so "consistent headers, spacing,
     tap targets" across those screens is structural, not a matter of
     each screen separately matching a style guide.
- BETA FEEDBACK ROUND 2 — BACK NAVIGATION, THE ACTUAL FIX (owner decision
  2026-07-31, device tester report: "back lands on Settlements instead
  of Home" — the prior `backBehavior="initialRoute"` change did NOT fix
  it in practice). Root cause this time confirmed by reading the
  INSTALLED expo-router/react-navigation source in `node_modules`
  (`@react-navigation/routers/src/StackRouter.tsx`,
  `expo-router/build/global-state/routing.js`), not guessed a second
  time: every screen under `app/(tabs)/more/` shares ONE nested Stack
  navigator (`more/_layout.tsx`). Cross-tab `router.push('/(tabs)/more/X')`
  calls (Home cards, Reports hub, CEO Mode, Scorecard, ...) dispatch a
  PUSH action against that Stack's OWN existing state — StackRouter's
  PUSH handler always appends to `state.routes`, there is no implicit
  reset for an already-mounted nested navigator. Visiting different Home
  cards across a session (cash-flow, later settlements, later
  tax-estimator, ...) without returning all the way to Home in between
  silently left the "more" stack several screens deep, so back popped
  through THAT accumulated history, landing on whatever unrelated screen
  was still sitting there. `backBehavior="initialRoute"` only governs
  what happens once a tab's own stack is already EMPTY — it never
  addressed the accumulation itself, which is why it didn't fix the
  reported bug. Fix: `app/src/navigation/useResetStackOnTabBlur.ts`,
  called once from `more/index.tsx` (the shared stack's always-mounted
  root screen) — resets that stack to just its root every time the
  "more" tab loses focus, via `navigation.getParent().addListener('blur',
  ...)` + `navigation.dispatch(StackActions.popToTop())`. This means
  re-entering "more" from ANY origin always starts clean
  (`[index, target]`, never a stale accumulation), making back
  deterministic and bounded: at most 2 presses to Home (target ->
  more/index -> Home) instead of unbounded/unpredictable. Applies
  identically to the header back arrow and the Android hardware back
  button (both dispatch through the same navigator tree). Zero changes
  needed at any of the 20+ existing `router.push('/(tabs)/more/X')` call
  sites — the fix lives in exactly one place.
  `app/src/navigation/backIntent.ts`'s `backTargetFor(href)` is the
  resulting per-route intent table (`'home'` vs `'moreIndex'`),
  regression-guarded against every route in `navRegistry.ts` by
  `src/navigation/__tests__/backIntent.test.ts`. See
  `docs/DATA_FLOW.md`'s new "Navigation intent" section for the full
  "how routes must be opened from now on" rule. Known, honestly-flagged
  remaining limitation: this guarantees back is never unbounded/wrong,
  but a screen opened from Home still takes 2 back-presses to reach Home
  (through more/index), not 1 — true 1-press-to-opener for every
  cross-tab screen would require moving these ~30 screens off the shared
  "more" Stack onto the root stack (sibling of `(tabs)`), a much larger
  structural migration intentionally NOT done in this pass; flagged here
  as a scoped-out follow-up rather than silently claimed as fully solved.
- BETA FEEDBACK ROUND 2 — NEEDS-REVIEW VISIBILITY (owner decision
  2026-07-31, device tester report): items the AI flagged as needing
  review are now visually loud everywhere they appear, via one shared
  pure definition (`app/src/import/needsReview.ts`) two underlying
  signals both get the identical treatment for, per the directive ("low-
  confidence AI extractions use the same treatment"): (1) a deduction
  description prefixed `"NEEDS REVIEW: "` at save time (CLAUDE.md
  invariants #3/#14 — an unrecognized-but-financial document, or a fee
  line with nothing to fold into); (2) any extraction with
  `documents.parsed_json.confidence === 'low'` (CLAUDE.md invariant #14),
  looked up via a settlement/transaction's `document_id` where the row
  itself carries no confidence of its own. The shared visual —
  `app/src/components/NeedsReviewBadge.tsx`'s `needsReviewRowStyle()`
  (amber `borderStartWidth`/`borderStartColor`, logical not
  `borderLeftWidth` per invariant #11's RTL rule — Arabic renders it
  trailing automatically) + `NeedsReviewChip` (a small "Needs review"
  chip) — is wired into every row in Deductions, Settlements, Documents
  (both the list row and the viewer), and Transactions, each screen also
  gaining a "Needs review only" filter toggle
  (`needsReview.filterOnly`). `TappableCard` (`src/components/ui.tsx`)
  gained an optional `style` prop to make this possible on the screens
  that use it (Settlements/Documents/Transactions), since it previously
  had no way to accept an external style override.
  `app/src/data/documentsFilter.ts`'s `filterDocuments()` gained a
  `needsReviewOnly` option (tested) rather than the Documents screen
  filtering ad hoc, keeping the pure filter logic in one place. Amber —
  not red — is the deliberate color choice: red already means "expense/
  cost/negative" everywhere else in this app, so reusing it here would
  read as an error rather than "please confirm this." Home gained a
  PERSISTENT counter chip (`NeedsReviewCounterChip`, only rendered when
  `needsReviewDeductions.length > 0`) separate from the existing rotating
  AI Insight card — the rotating card only shows a needs-review message
  when that happens to be the one daily-selected insight among several
  candidate types, so it wasn't reliably visible; the new chip always
  shows and taps straight through to Deductions with the "Needs review
  only" filter pre-enabled via a `?filter=needsReview` route param.
- TRUE-PROFIT CONSISTENCY (owner decision 2026-07-31, follow-up to the UX
  mega-pass's Net-to-Owner audit fix, which fixed Home but flagged that
  Scorecard/CEO Mode/Share Weekly Profit still used the wrong figure).
  ONE canonical calculation now: `app/src/stats/trueProfit.ts`'s
  `calcTrueProfit()` (aggregate) / `buildWeeklyTrueProfitTrend()` (weekly
  series, same `{weekEnding, gross, net}` shape as `cashFlowTrend.ts`'s
  `buildWeeklyTrend()` so it's a drop-in replacement) — `profit =
  grossRevenue − every deductible expense (withheld + out-of-pocket
  alike, tax_deductible !== false)`. Two things this gets right: (1)
  always starts from GROSS and subtracts every deduction row once, never
  from a settlement's own `net` (which already has withheld chargebacks
  baked in) plus ALSO subtracting deductions again — proven equal to the
  net-pay shortcut by `profitLoss.ts`'s own header comment, but this
  module always takes the gross route so no caller has to reason about
  which rows are already "in" `net`; (2) EXCLUDES deductions marked
  `tax_deductible: false` — `NON_DEDUCTIBLE_CATEGORIES`
  (`src/import/category.ts`): a Meal already covered by the per diem
  allowance, or an Advance Repayment (literally returning already-
  received money, never a real expense). Deliberately NOT used by
  `buildProfitLoss()` (Operating P&L, a verbatim legacy `rOper()` port —
  counts every deduction unconditionally, by design, for accountant/
  legacy-parity purposes) or `calcScorecard()` (a verbatim legacy
  `rScore()` port, same "operating" ALL-deductions definition by design,
  used for the 0-100 score/grade only) — both stay exactly as documented;
  this module is for every OTHER "what's my profit" dollar figure.
  **Before → after, per screen:**
  - **Home**: Net to Owner card was `grossRevenue − totalDeductions`
    (ALL deductions unconditionally, the mega-pass's own fix) → now
    `calcTrueProfit()`. Its sparkline, the Hero Card's headline number +
    chart (via `calcHeroPeriod`, fed a true-profit-derived series), the
    Overview trio's "Net Profit" tile, and Goal Progress's current-week
    figure were all `revenue − ALL expenses` for the week → now the
    true-profit weekly trend. (The Overview trio's own "Expenses" tile is
    UNCHANGED on purpose — it's the broader "everything spent" total,
    matching the "Total Deductions" card elsewhere; only "Net Profit"
    needed the exclusion.)
  - **Scorecard**: the "Weekly" trend list showed `buildWeeklyTrend()`'s
    bare settlement `.net` (pay only, zero out-of-pocket expenses
    subtracted at all) → now the true-profit weekly trend. The 0-100
    score/grade and its `netPerMile` ratio (shown on Scorecard's own
    Share card) are UNCHANGED — verbatim legacy parity, see above.
  - **CEO Mode / AI Coach**: `thisWeekRevenue`/`thisWeekProfit` cards,
    the Share card, Goal Progress's `latestWeek` input, and — critically —
    the AI Coach briefing's OWN PROMPT TEXT ("This week's revenue: X,
    profit: Y") were all sourced from `buildWeeklyTrend()`'s bare `.net`
    → now the true-profit weekly trend, one shared source (`weeklyTrend`)
    fixing every one of these at once.
  - **Share Weekly Profit**: the "Profit" metric on the share card was
    `selected.net` (the one settlement's own net pay) → now looked up
    from the true-profit weekly trend for the selected week (aggregating
    every settlement sharing that `week_ending`, same convention per
    diem dedup already uses for a multi-truck fleet).
  - **Profit Analysis**: `buildProfitAnalysis()`'s `netIncome` was
    `sum(settlement.net)` — didn't subtract ANY out-of-pocket deduction
    at all, not just fuel/maintenance (which this rollup already tracks
    separately) → the function gained a `deductions` parameter and now
    computes true profit for the window. The screen's own "Weekly" trend
    list had the same `buildWeeklyTrend()` bug as Scorecard/CEO
    Mode → fixed identically. (Home's and CEO Mode's OWN calls to
    `buildProfitAnalysis()` were updated to pass real deduction data too,
    for consistency, even though neither currently displays
    `.netIncome` — only `.fuelPctOfRevenue`/`.revenue`.)
  Tests (`src/stats/__tests__/trueProfit.test.ts`,
  `src/stats/__tests__/profitAnalysis.test.ts`): a dataset with a
  settlement's `net` plus separate out-of-pocket receipts proves the
  formula never double-counts a withheld chargeback already reflected in
  `net`; a Meal-covered-by-per-diem row and an Advance Repayment row are
  each proven to leave profit completely unchanged whether present or
  absent.
- CRITICAL DATA BUG — settlement child rows, true profit's own math, Cash
  Flow expenses, dashboard reorder (device feedback 2026-07-31, "2
  settlements imported: Fuel/Reimbursements empty, Cash Flow shows only
  revenue, Best/Worst Lanes empty, Customize Dashboard's simple editor
  changes nothing"). Five separate, independently-confirmed root causes,
  found by tracing the actual write→read path end to end rather than
  guessing:
  1. **Date-fallback bug, `mapExtraction.ts`'s `mapSettlement()`**: every
     fuel/reimbursement/withheld-deduction/toll/maintenance row with no
     PER-LINE date of its own fell back to the extraction's TOP-LEVEL
     `d.date` — which the AI extraction prompt deliberately leaves empty
     for `docType:'settlement'` (settlements use `settlement.weekEnding`
     as their authoritative date, per the DATE HARDENING rounds above).
     Every such row therefore saved with `purchase_date`/`reimb_date`/
     `ded_date`/`toll_date`/`service_date` = NULL. Fixed: a single
     `settlementFallbackDate = s.weekEnding || d.date || undefined`
     computed once in `mapSettlement()`, threaded through
     `toFuelInsert()`/`toReimbInsert()`/`toTollInsert()` (which gained a
     `fallbackDate` param it didn't have before) and the inline
     deductions/maintenance mappers.
  2. **`MonthGroupedList` collapsed the 'unknown' bucket by default**: a
     null-dated row (bug 1, or any other cause) lands in
     `monthGroups.ts`'s `'unknown'` bucket, which always sorts LAST — and
     the collapse-by-default predicate (`monthKey !== thisMonth`) treated
     it like any other past month, collapsing it. The combination meant
     an entire screen's worth of rows could render as a single collapsed
     "▸ Unknown · N items · $X" header at the very bottom of the list —
     which reads as "completely empty" to a user skimming the screen even
     though `groupByMonth()` itself never drops rows. Fixed: the current
     month AND the 'unknown' bucket both now start expanded; only real
     past months default to collapsed (`UNKNOWN_MONTH_KEY` exported from
     `monthGroups.ts` for this check).
  3. **`calcTrueProfit()`/`buildWeeklyTrueProfitTrend()` (`src/stats/
     trueProfit.ts`) silently excluded EVERY settlement-withheld
     deduction**, not just the two intentional exceptions (a per-diem-
     covered meal, an Advance Repayment). Root cause: `mapSettlement()`
     stamps `tax_deductible:false` on EVERY withheld row unconditionally
     (invariant #1's defense-in-depth, so a withheld chargeback is never
     double-counted as a TAX deduction) — but `isDeductibleExpense()`
     (`tax_deductible !== false`) was reused here to decide whether a row
     reduces TRUE PROFIT, a different question entirely. That silently
     skipped every withheld dollar (fuel advance, insurance, ELD fees,
     tolls, escrow...) instead of subtracting it — directly contradicting
     this module's own header comment ("gross − every deduction row,
     withheld + out-of-pocket, once" — verified against
     `profitLoss.ts`'s "gross − withheld already equals settlement net by
     definition" identity) and OVERSTATING true profit by the full
     withheld amount on every settlement, on every screen that reads it
     (Home, Scorecard, CEO Mode, Share Weekly Profit, Profit Analysis —
     this was live in the already-shipped "True-profit consistency"
     update). The existing test suite didn't catch it because its own
     withheld-row fixture set `tax_deductible:true` — a shape
     `mapSettlement()` never actually produces. Fixed: new
     `reducesTrueProfit()` predicate — a row counts if `source ===
     'settlement'` (it left the check, period) OR it's a real deductible
     out-of-pocket expense, UNLESS its category is a Meal (per diem
     covered) or Advance Repayment, which stay excluded regardless of
     source. `profitAnalysis.ts`'s `netIncome` had the identical bug
     (same `isDeductibleExpense` reuse) and got the identical fix.
  4. **Cash Flow's budget forecast had zero connection to
     settlement-derived EXPENSES** (only Weekly Revenue had a trailing-
     average fallback, from the earlier DATA-FLOW AUDIT FIX). Fixed:
     `cashFlowForecast.ts` gained `trailingWeeklyFuelAverage()` (trailing
     28-day average of net fuel cost from `fuel_purchases`) and
     `trailingWeeklyOtherExpenseAverage()` (trailing 28-day average of
     `reducesTrueProfit()`-qualifying withheld deductions, excluding
     Fuel & DEF to avoid double-counting against the fuel average, plus
     tolls) — same "manual entry always wins, this only fills the gap
     while empty, labeled 'from your settlements'" pattern as Weekly
     Revenue. `cash-flow.tsx`'s itemized breakdown rows (which used to
     read the raw, possibly-empty `budget.fuelWeekly`/`budget.otherWeekly`
     form strings directly) now read `forecastInputs.fuelWeekly`/
     `otherWeekly` so the breakdown list and the top stat cards can never
     disagree about what's actually being subtracted.
  5. **Customize Dashboard's Simple editor (`SimpleCustomizeDashboardModal`)
     genuinely saved and invalidated correctly — Home just couldn't show
     the effect**: Home's customized-layout rendering always rendered the
     4 sections in the fixed `SECTION_IDS` order (with unsectioned cards
     always trailing last), completely ignoring WHERE in the user's own
     flat, reordered list those sections' cards actually landed. Since
     most default-visible cards sit in DIFFERENT default sections,
     reordering two of them via the Simple editor's single flat arrows
     list produced literally zero visible change on Home — matching "the
     arrows/toggles change nothing" exactly, even though the save →
     invalidate → refetch data path itself worked. Fixed:
     `dashboardLayout.ts`'s new `buildCustomizedDashboardBlocks()` groups
     the flat, already-reordered `visible` list into blocks (one per
     section, one singleton per unsectioned card) and orders the BLOCKS
     THEMSELVES by the earliest flat-list index any of their member cards
     holds — so moving a card earlier in the Simple editor now visibly
     moves its whole section (or itself, if unsectioned) earlier on Home,
     while same-section cards still render together under one header, in
     their own relative order.
  Tests: `src/data/__tests__/aiImportSave.settlementChildren.test.ts`
  (new) is the requested end-to-end proof — imports a realistic
  settlement (fuel/reimbursements/loads/withheld deductions, none with
  their own per-line dates) through the REAL `saveExtraction()` against
  the fake Supabase client, then feeds the actual saved rows through the
  actual screen-facing calculations (`groupByMonth`, `calcTrueProfit`,
  the new trailing-average functions, `rankLoadsByRpm`) — proving the
  whole chain, not just that a mapper returns the right shape in
  isolation. `src/stats/__tests__/dashboardLayout.test.ts` gained
  `buildCustomizedDashboardBlocks` coverage, including the exact
  reordering-across-sections regression this bug report describes.
- PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
  review, "CRITICAL" set — see PROMPTS.md's backlog entry for the same
  date for the deferred "second tier"/"backlog" items this pass also
  triaged):
  1. **Storage deletion integrity** (`delete-account`/`reset-data` Edge
     Functions): `deleteStorageFolder()` used to ignore every list()/
     remove() error, hardcode a 3-level-deep recursion, and never
     paginate past list()'s 1000-item page — the caller still returned
     `success:true` regardless. Rewritten: `walkAndDelete()` recurses to
     whatever depth the folder tree actually has (no hardcoded limit),
     `listAllEntries()` paginates in 1000-item pages until exhausted, and
     every failure is collected into `{failedPaths, errors}` — the
     handler now returns a 502 with "Some files could not be removed —
     please try again" instead of `success:true` on ANY partial failure.
     Both functions' STORAGE step is naturally idempotent/safe to re-run
     (list() on an already-emptied folder returns `[]`, remove() on an
     already-gone path is a no-op), so a failed attempt is always
     retryable — delete-account still deletes the auth user LAST, so a
     storage failure leaves the account intact for a retry; reset-data
     still resets `profiles`' data fields LAST, same reasoning.
  2. **Business balance on settlement re-import**
     (`app/src/data/aiImportSave.ts`): a re-import used to credit
     `business_balance` NOTHING at all (gated on `!isReimport`), so a
     corrected net pay (e.g. 2000 -> 2500) left the balance permanently
     wrong. Fixed via `settlements.business_balance_credit`
     (docs/PENDING_SQL.md §37, NOT YET RUN against the live project as of
     this writing) — tracks how much of THIS settlement's net pay has
     actually been credited so far; every save (new or re-import)
     computes `delta = newCredit - previousCredit` (0 for a brand-new
     settlement) and applies just that delta. The update itself is now a
     single atomic Postgres statement via the new
     `apply_business_balance_delta(p_user_id, p_delta)` RPC (`security
     invoker`, scoped to `user_id = auth.uid()`) instead of a client-side
     select-then-update (a real race between two concurrent imports
     before this). `SaveExtractionResult.netPayAdded` can now be
     NEGATIVE (a corrected net pay lower than before) — the import
     screen's `balanceAdded` i18n string had its hardcoded "+" removed
     from all 7 locales; the sign is now computed in JS
     (`(delta > 0 ? '+' : '') + money(delta)`), since `money()` already
     renders its own "-" for a negative amount.
  3. **Validate before writing** (`saveExtraction()`): the settlement
     week_ending check and the driver_payment driver-required check both
     used to run AFTER the Storage upload and the `documents` insert — a
     rejected import left an orphaned uploaded file and an orphaned
     `documents` row. Both checks now run as step 0, before any
     Storage/DB write; `mapSettlement()` is computed once there and
     reused (never called twice).
  4. **Re-import ordering** (`saveExtraction()`): the old order deleted
     the previous week's child rows (loads/fuel/reimbursements/withheld
     deductions/driver_payments) BEFORE inserting the new batch — if any
     new insert failed partway through, the previous week's data was
     already gone with nothing to replace it. Now: the previous batch's
     row ids are captured (read-only) BEFORE any write, every new row is
     inserted first, and only once every insert has succeeded are the
     captured old ids deleted (`delete().in('id', oldIds)` — by explicit
     id, never a fresh `eq('settlement_id', ...)` match, since the newly-
     inserted rows share that same settlement_id and must never be swept
     up in the same delete).
  5. **PDF/file size guard**: files over 10 MB are rejected client-side
     (`app/(tabs)/import/index.tsx`, checked via `expo-file-system`'s
     `File.size` / `DocumentPickerAsset.size` before ever base64-encoding)
     with a friendly "This file is too large — try splitting it or
     exporting a smaller version" message (all 7 locales), and again
     server-side in `ai-import` (`approxDecodedBytes = base64Length *
     3/4`, since decoding the full string just to check its size would
     defeat the point) — belt and suspenders, never trusting the client
     check alone.
  6. **exportAllData**: `equipment` (docs/PENDING_SQL.md §36) was added
     to both Edge Functions' `TABLES_IN_DELETION_ORDER` but never to
     `src/data/exportAllData.ts`'s `EXPORT_TABLES`, so a full-data export
     silently omitted every equipment row — the same class of gap
     invariant #24/the DATA-FLOW CONSISTENCY audit already found and
     fixed for query invalidation. `src/data/__tests__/
     exportAllData.test.ts` mirrors `TABLES_IN_DELETION_ORDER` as a
     regression guard, same pattern as `queryInvalidation.test.ts`.
     Settings' "Export All My Data" button also gained real scope text
     (`exportAllDataNote`, all 7 locales) — it never said the original
     uploaded photos/PDFs aren't included in the JSON export.
  7. **Schema consolidation**: `supabase/migrations/
     0002_consolidated_pending_sql.sql` replays every APPLIED
     docs/PENDING_SQL.md section (1, 3-36 — §2 needed no SQL, §37 is not
     yet run) as one file, assembled programmatically from that file's
     own fenced SQL blocks. Investigating this surfaced a real, separate
     finding: `0001_init.sql` is NOT a clean "before any PENDING_SQL
     section" baseline — it already contains some later tables (`drivers`
     from §13, `user_categories` from §21, `compliance_items` from §23)
     while still missing others (`tax_config`, `tax_year_data`,
     `household_members`/`household_income`, `equipment`) and `profiles`
     is missing at least 7 columns later sections added. Because of that
     drift, every statement in 0002 is written idempotent (`create table
     if not exists` / `add column if not exists` / drop-then-recreate for
     policies and triggers / named indexes with `if not exists` /
     constraint adds wrapped in a `do $$ ... exception when
     duplicate_object` block) rather than assuming a specific starting
     point — safe to run against either a fresh project (after
     `0001_init.sql`) or the current live project (every statement is a
     no-op for whatever already exists). Two real bugs were caught and
     fixed while assembling it: §17's two SQL blocks are fenced in
     EXPLANATION order in the prose, not execution order (the doc's own
     text says "Run the column-add FIRST" despite that block being fenced
     second) — 0002 runs it first; §34's prose has a second fenced block
     that's a DIAGNOSTIC query for the person doing the manual apply, not
     part of the migration — excluded. This was assembled from
     docs/PENDING_SQL.md's own text, NOT verified against the live
     database (no credentials in this environment to do that) — review
     against the actual Supabase dashboard schema before trusting it for
     anything destructive.
  Second-tier fixes also completed this pass (PROMPTS.md's backlog entry
  covers what was deferred instead): `AuthContext.signOut()` now clears
  the persisted React Query cache (`queryClient.clear()` +
  `asyncStoragePersister.removeClient()`) — it used to leave the previous
  session's financial data sitting in AsyncStorage for the next person
  who signs in on the same device to briefly see. Reset All Data now
  calls the new `removeFinancialDataFromCache()` (real `removeQueries()`,
  not `invalidateQueries()` — synchronous and unconditional, not
  dependent on a refetch succeeding before the app might be backgrounded)
  before its existing `invalidateFinancialData()` call.
  `fetchFleetStats()`/`fetchDriverStats()` (`src/data/dashboardStats.ts`)
  each used to issue their OWN full-table `deductions` query even though
  deductions are always user-wide, never truck/driver-scoped — an
  N-truck, M-driver account's Dashboard Fleet Overview issued N+M
  identical redundant fetches. Both now accept an optional pre-fetched
  `deductions` array (`computeFleetStats()` extracted as the shared pure
  aggregation); Home passes its own already-fetched `useDeductions()`
  result into every per-truck/per-driver call.
- NEGATIVE SETTLEMENTS + MILES TRAPS + ESCROW (owner decision 2026-08-02,
  verified against a real statement: W/E 2026-07-24, 0 miles, $5.16
  revenue, $1,160.51 deductions, net -$1,155.35 — the owner OWES the
  carrier that week). Three fixes:
  1. **Negative net pay never credits business_balance**: `newCredit =
     mapping.netPay > 0 ? mapping.netPay : 0` in `aiImportSave.ts` clamped
     a losing week's net pay to $0 before computing the balance delta —
     a losing week silently left `business_balance` untouched instead of
     DECREASING it by what's actually owed. Fixed: `newCredit =
     mapping.netPay` (the signed figure, uncapped either direction) — the
     delta math itself (`newCredit - previousCredit`, docs/PENDING_SQL.md
     §37's `apply_business_balance_delta` RPC) was already correct and
     needed no change. `business_balance` has no DB check constraint
     enforcing `>= 0` (docs/SCHEMA.sql), so allowing it to go negative
     required no schema change. `SaveExtractionResult.netPayAdded` can
     now be negative; the import result screen, the Settlements list row,
     the Settlements detail sheet, and both Dashboard business-balance
     cards all show a red "you owe the carrier" / "you owe this much
     overall" label whenever the figure is negative (`oweCarrier`/
     `businessBalanceOwed` i18n keys, all 7 locales) rather than reading
     as an unusually small positive number. `calcTrueProfit()`/
     `calcCashFlowForecast()`/every other true-profit-derived figure
     already never clamped negative math (verified, not changed).
  2. **MILES TRAP**: carrier statements routinely print a cumulative
     "LTD MILES"/"MILES QTD"/"YTD MILES" figure right next to the week's
     own revenue/loads section — the AI extraction had a real, verified
     case of grabbing that lifetime figure as `settlement.totalMiles`
     for a week with ZERO loads. Fixed two ways: (a) the `ai-import`
     extraction prompt gained an explicit instruction that `totalMiles`
     must be THIS WEEK's own figure only, never LTD/QTD/YTD, and should
     match the sum of the week's own loads' mileage; (b) a new client-side
     deterministic guard, `app/src/import/milesGuard.ts`'s
     `sanitizeExtractionMiles()` — applied once in `aiImportCall.ts`
     immediately after the extraction is received (same placement as
     `dateGuard.ts`'s `sanitizeExtractionDates()`, so every downstream
     consumer — `mapSettlement()` AND the import preview's
     `applyDefaultPerDiemDays()` — sees the corrected value automatically,
     with no separate fix needed at either call site): (1) no loads this
     week but a nonzero `totalMiles` → silently corrected to 0 (unambiguous
     — zero loads means zero miles driven for pay); (2) loads exist with
     real mileage but `totalMiles` is more than 1.5× their own summed
     mileage → the loads' own sum is used instead, AND the extraction's
     `confidence` is downgraded to `"low"` so the existing needs-review
     machinery (`src/import/needsReview.ts`, CLAUDE.md invariant #14)
     surfaces it for confirmation — rule 1 is a certainty (no flag needed),
     rule 2 is a judgment call (flagged). This drives per-diem (0 miles =
     0 days), CPM, and RPM correctly since all three read the corrected,
     already-saved `settlements.miles`/loads figures, not the raw AI
     output.
  3. **ESCROW vs EXPENSE**: a performance bond / escrow reserve / tire
     fund / emergency fund / maintenance reserve settlement deduction is
     a REFUNDABLE DEPOSIT the carrier holds on the driver's behalf, not a
     business expense — a real statement had a "PERFORMNCE BOND" line
     (OCR-damaged spelling) that needed this treatment. New category
     `'Escrow & Deposits'` added to `CANONICAL_CATEGORIES` and
     `NON_DEDUCTIBLE_CATEGORIES` (`app/src/import/category.ts`), and to
     `src/stats/trueProfit.ts`'s `TRUE_PROFIT_EXCLUDED_CATEGORIES` (same
     treatment as Meals/Advance Repayment — excluded from true profit,
     Cash Flow's trailing-expense averages, and every other
     true-profit-derived figure, since the money never left the business
     as a real cost). Classified via TWO signals with the AI's own
     structured `chargebackType: "escrow_reserve"` (ai-import prompt,
     `docs/INDUSTRY_TAXONOMY.md` §A) as primary, and a client-side text
     regex, `isEscrowDeposit()` (`app/src/import/category.ts`), as a
     safety net that catches OCR-damaged spellings (verified against
     "PERFORMNCE BOND") even when the AI didn't set chargebackType —
     same priority/pattern as the existing `isRestaurantPurchase()`
     meals detector. Deliberately does NOT match a bare "security
     deposit" (an existing, different ai-import non-deductible-trap
     concept — a deposit the DRIVER paid, not one the carrier holds).
     Smart default, freely user-editable per row (same as every other
     category). A running "what does the carrier currently hold" balance
     — `src/stats/escrowBalance.ts`'s `calcEscrowBalance()`, a simple
     cumulative sum (no refund/release tracking exists yet in this app,
     so this is a HELD total, not net-of-refunds; a future refund docType
     would need its own product decision to net against this) — is shown
     on the Settlements screen whenever it's greater than $0.
  Tests: `src/import/__tests__/milesGuard.test.ts` (new),
  `src/import/__tests__/category.test.ts` (escrow detection + category
  additions), `src/stats/__tests__/trueProfit.test.ts` (escrow exclusion
  + uncapped-negative math), and
  `src/data/__tests__/aiImportSave.negativeSettlement.test.ts` (new) —
  an end-to-end test using the EXACT real-statement numbers from the
  device report (gross $5.16, deductions $1,160.51 = $66.95 meals +
  $550.00 advance repayment + $100.00 escrow + $443.56 genuinely
  deductible, net -$1,155.35, 0 per-diem days, business_balance
  decreasing by the full $1,155.35, true profit correctly computing
  -$438.40 from the $443.56 deductible portion only) through the REAL
  `saveExtraction()` against the fake Supabase client.
- IMPORT FAILURE VISIBILITY + AUDIT (owner decision 2026-08-02, device
  feedback: "settlement imports failing frequently"):
  1. **Rich, step-tagged errors**: `saveExtraction()` (`aiImportSave.ts`)
     no longer throws bare/anonymous errors — every write goes through a
     new `SaveExtractionError` (`src/data/saveExtractionError.ts`)
     tagging exactly which of ~27 granular steps failed (upload / documents
     row / settlement row / which child table's insert / the balance RPC /
     ...) plus the underlying Postgres error's message/code/hint/details,
     AND a snapshot of what was already durably saved before the failing
     step (`partial: {documentId, settlementId, settlementSaved,
     childRowsSaved, oldRowsCleanedUp, balanceUpdated}` — there is still no
     single transaction wrapping the whole save, a known v1.1 "full RPC
     transaction for imports" backlog item, so a later step's failure does
     NOT mean nothing was saved). The import screen's error card groups
     the 27 steps into 10 user-legible buckets for the visible headline
     (`src/import/errorStepGroups.ts` — "Saving loads" vs "Saving fuel"
     vs "Saving withheld deductions" all read as "saving your settlement's
     records" to a non-developer; the exact granular step stays in the
     Copy Details report for real debugging) and shows a "Copy Details"
     button (reusing `ScreenErrorBoundary`'s build-info + Clipboard
     pattern) with the full report. AI-extraction failures
     (`aiImportCall.ts`'s `AiImportError`) and local file-read/compression
     failures get the same Copy Details treatment via
     `buildAiImportErrorReport()`/`buildLocalErrorReport()`.
  2. **Four previously-silent failures now throw**: `aiImportSave.ts`'s
     loans upsert loop, the personal-payment `capital_transactions`
     insert, the `loan_agreement` docType's truck/trailer/equipment
     asset-link update (and its own trucks/equipment lookup), and the
     maintenance-warranty reimbursement insert ALL used to discard their
     `{error}` entirely — a failure in any of them was completely
     invisible, the import screen reported success while that one row
     silently never saved. All four now throw a step-tagged
     `SaveExtractionError` like every other write in the file.
     `fakeSupabase.ts` gained error-injection support
     (`createFakeSupabase(seed, {failures: [...]})`) specifically to let
     `aiImportSave.errorReporting.test.ts` prove all four actually throw
     now, plus the step-tagging/partial-state/duplicate-race behavior,
     against the real `saveExtraction()`.
  3. **`apply_business_balance_delta` RPC audit** (docs/PENDING_SQL.md
     §38, NOT YET RUN as of this writing): the signature was already
     correct (`p_user_id uuid, p_delta numeric`, matching the client's
     call exactly) and a failure already correctly aborts the whole save
     (throws) — but a genuine bug was found: `update ... returning
     business_balance into new_balance` left `new_balance` as `NULL`
     (PL/pgSQL does not raise on a 0-row UPDATE by default) whenever the
     `WHERE` clause matched zero rows (a mismatched `p_user_id`/
     `auth.uid()`, or a missing profiles row) — the RPC returned `NULL`
     with `error: null`, so the client believed the balance update
     succeeded when it silently never touched anything. Fixed with a
     single `if not found then raise exception ... using errcode =
     'P0002'` right after the UPDATE — now a real, visible error the
     client reports as step `'balance-update'`.
  4. **§34/§37 unique-index race, addressed**: `findExistingSettlement()`'s
     check-then-insert-or-update is not atomic — a double-tap on Save
     (or two devices importing the same account's same settlement week
     within the same instant) could race past the check and hit
     `settlements_user_week_truck_uidx`/`_notruck_uidx` on INSERT.
     `SaveExtractionError.isDuplicateSettlementRace` (true when
     `step === 'settlements-save'` and the Postgres error code is
     `23505`, unique_violation) lets the import screen show a specific,
     actionable "this week may have just been imported — check
     Settlements before retrying" message instead of a raw constraint-
     violation string. The import screen also gained a synchronous
     `savingRef` double-tap guard (checked/set before any `await`, reset
     in `finally`) closing the narrow window where two fast taps could
     both start `saveExtraction()` before React re-renders the Save
     button away.
  5. **File-size guard audited, left at 10 MB**: correctly checked
     client-side (post-compression for photos, pre-upload for PDFs) and
     server-side (base64-length-derived estimate) before any network
     call — belt and suspenders, no bug found. Flagged as an open risk,
     not changed: a legitimate multi-page camera-scanned settlement PDF
     could plausibly exceed 10 MB; worth monitoring real-world import
     failures for this specific cause before raising it blind.
  6. **`ai-import`'s own failure modes, audited and hardened**
     (`supabase/functions/ai-import/index.ts`): `ANTHROPIC_MAX_TOKENS`
     raised 8000 → 16000 — a busy multi-page settlement's full structured
     JSON extraction (many loads/tolls/withheld deductions) can genuinely
     need more than 8000 output tokens, and a truncated response used to
     fail every JSON.parse() fallback attempt and surface as a generic,
     misleading `parse_failed`. The response's own `stop_reason ===
     "max_tokens"` is now checked FIRST and returns a new, specific
     `"truncated"` error type ("try splitting a multi-page settlement
     into smaller batches") instead. The Anthropic fetch itself gained a
     client-controlled `ANTHROPIC_TIMEOUT_MS` (55s, via `AbortController`)
     instead of relying on the platform's own undocumented execution
     ceiling, plus ONE retry (`MAX_ANTHROPIC_ATTEMPTS = 2`,
     `RETRY_BACKOFF_MS` 800ms) for genuinely transient failures (a
     network-level throw, or a 5xx/529-overloaded response) — never for a
     4xx, which a retry can't fix. A new `"timeout"` error type
     distinguishes "this took too long" from a plain network error. Both
     new types get their own `friendlyAiImportError()` messages
     (`aiImportCall.ts`).
- MULTI-PAGE SETTLEMENT CHUNKING (owner decision 2026-08-02, device
  evidence: "The AI service took too long to respond (over 55s)" — real
  Prime settlements are 8 pages and consistently exceeded the prior
  pass's `ANTHROPIC_TIMEOUT_MS`). Root cause was two-layered: the client
  had NO timeout at all (an unbounded wait on whatever the network/
  platform did), and the single 55s server-side attempt was never going
  to survive a genuinely large document however it was retried. Fixed
  end to end rather than just raising a number:
  1. **Platform ceiling, verified not assumed**: checked Supabase's own
     docs (https://supabase.com/docs/guides/functions/limits) rather than
     trusting the commonly-cited "400s" figure — that number is for
     background work continued via `EdgeRuntime.waitUntil()` AFTER a
     response is already sent, which `ai-import` never does (it always
     awaits its own single response). The real ceiling for THIS
     function's synchronous request/response execution model is **150s**,
     on both Free and Pro plans — the load-bearing constraint for every
     budget below.
  2. **Deterministic PDF chunking**: `supabase/functions/ai-import/
     chunking.ts` is a new, deliberately Deno-free, dependency-free pure
     module (page-range arithmetic + JSON merge only) — unit-tested
     directly from the app's Jest suite via a relative import
     (`app/src/import/__tests__/chunking.test.ts`, 14 tests) without
     needing a Deno runtime in CI, avoiding a second copy of the same
     algorithm to keep in sync (same "each Edge Function is self-
     contained" convention as `delete-account`/`reset-data`'s duplicated
     `deleteStorageFolder()` — `ChunkExtraction` is a minimal LOCAL type,
     not an import of `app/src/import/types.ts`'s `Extraction`).
     `computeChunkPageRanges()` splits a PDF into non-overlapping 1-
     indexed page ranges; `mergeChunkedExtractions()` combines one
     extraction per chunk back into a single result: header/summary
     SCALARS (weekEnding, carrier, grossRevenue, netPay, totalMiles, ...)
     take chunk[0]'s value UNCONDITIONALLY for numerics — a `0` is very
     often a legitimate value (e.g. a genuine 0-mile home week, the exact
     miles-trap case CLAUDE.md's NEGATIVE SETTLEMENTS pass already
     hardened) and "first non-zero across chunks" would wrongly skip past
     a correct 0 in favor of a later chunk's guess; line-item ARRAYS
     (loads, fuel, deductions, maintenance, tolls items, loans) are
     concatenated across every chunk in page order, safe because page
     ranges never overlap so the same physical line can never appear
     twice; tolls subtotals/the optional "operating" section scan every
     chunk for the first meaningful value since they're not guaranteed to
     be on page 1; `confidence` is ALWAYS forced `"low"` on a 2+-chunk
     merge regardless of what any individual chunk reported, so CLAUDE.md
     invariant #14's needs-review machinery always surfaces a merged
     result for the user to confirm before saving — a multi-chunk merge
     is inherently more guess-prone (heuristic header placement, array-
     concatenation assumes clean boundaries) than one coherent read.
     `buildChunkPromptAddendum()` tells the model it's seeing only a page
     subset and to leave any field not visible on THOSE pages at its
     normal schema default rather than guessing/reconstructing it — the
     merge's "chunk[0] priority" rule depends on this instruction
     actually being followed.
  3. **Three-path server orchestration** (`index.ts`'s `Deno.serve`
     handler, budgets sized to leave real margin under the 150s ceiling
     for the function's OWN non-Anthropic overhead too — the daily-import
     count query, pdf-lib parsing/splitting, prompt building, JSON
     merging — not just the Anthropic call time): (a) an image — one
     call, `IMAGE_TIMEOUT_MS` (60s), the standard 2-attempt retry, no
     chunking (images are single-page); (b) a PDF at or under
     `CHUNK_PAGE_THRESHOLD` (3) pages, OR one whose page count couldn't
     even be determined (pdf-lib failed to parse it, so chunking isn't
     possible anyway) — ONE quick, deliberately NO-RETRY attempt at the
     full document first (`PDF_SINGLE_ATTEMPT_TIMEOUT_MS`, 40s; most small
     PDFs succeed here, fast); ONLY a `timeout` or `truncated` result (not
     a clean 4xx/parse-failure/refusal, which chunking can't fix) falls
     back automatically to chunking at `FALLBACK_PAGES_PER_CHUNK` (1)
     page per chunk — extending "truncated" into this retry-once trigger
     was a deliberate choice: hitting the token ceiling is the same class
     of "too much content in one call" problem a timeout is; (c) a PDF
     over the threshold — straight to chunking at `PAGES_PER_CHUNK` (3)
     pages/chunk, no wasted single-call attempt first. Every chunk in a
     batch is called via `Promise.all` (parallel), which is what keeps
     the WHOLE chunked operation bounded by the slowest SINGLE chunk
     instead of the sum of all of them — essential to staying under 150s.
     Worst-case wall-clock, computed not guessed: path (b)'s fallback ≈
     40s + (50s × 2 attempts + 0.8s backoff, parallel-bounded) ≈ 140.8s
     (~9s margin under 150s); path (c) alone ≈ 100.8s (~49s margin). Any
     single chunk's terminal failure fails the WHOLE extraction rather
     than silently returning an incomplete merge — a partial-but-quiet
     result (missing a whole page's worth of deductions/loads) would
     violate CLAUDE.md invariant #3's "no dollar silently lost"
     convention more than a clear error would.
     `callAnthropicMessages()`/the new `extractOnePass()` wrapper (JSON-
     parse/stop_reason handling factored out so it's reusable per-chunk,
     not duplicated) both now take `timeoutMs`/`maxAttempts` as CALLER-
     supplied parameters instead of fixed globals, since the three paths
     each need a different budget.
  4. **Client-side timeout, added (there was none before)**:
     `aiImportCall.ts`'s `callAiImport()` now passes `timeout` to
     `supabase.functions.invoke()` — `PDF_CLIENT_TIMEOUT_MS` (190s,
     satisfying the "at least 180s" ask with real margin over path (b)'s
     ~140.8s server-side worst case) for PDFs, `IMAGE_CLIENT_TIMEOUT_MS`
     (130s, shorter per the report, with margin over the image path's
     ~120.8s worst case) for images. A client-side timeout abort surfaces
     from `@supabase/functions-js` as a `FunctionsFetchError` whose
     `context` is the raw `AbortError`/`DOMException`, NOT a `Response` —
     detected explicitly (`context.name === 'AbortError'`) BEFORE the
     existing `ctx.json()` Response-parsing path, which would otherwise
     silently fall through to a generic `'network_error'` and lose the
     "this was a timeout, not a connectivity problem" distinction.
  5. **"Still working" progress UI**: the import screen's working-phase
     spinner used to show one static label through the whole AI call, no
     matter how long it ran — indistinguishable from a frozen app on a
     genuinely multi-minute chunked extraction. A `startStillWorkingTimer()`/
     `clearStillWorkingTimer()` pair (`app/(tabs)/import/index.tsx`)
     swaps `workingLabel` to `importScreen.stillWorkingLargeDoc` ("Still
     working — large documents can take a couple of minutes.") 15s into
     the AI call if it hasn't resolved yet, cleared the moment the call
     actually settles (success or failure) so it never lingers into a
     later phase — wired into both the photo and PDF import paths. New
     key added to all 7 locales (`hi`/`uk` as untranslated English copies
     per invariant #11, same as every other string added since that
     rule).
  6. **Reduce work per call, audited**: `ANTHROPIC_MAX_TOKENS` stays at
     16000 (chunking gives even MORE headroom per call now, not less, per
     the explicit ask to keep it); lowering scanned-image resolution was
     confirmed ALREADY satisfied for photo uploads (`processImage()`
     already downscales to 1600px width via `expo-image-manipulator`
     before ever calling `ai-import`). Two optimizations considered and
     deliberately NOT implemented, flagged rather than silently skipped:
     stripping financially-blank pages before sending (not cheaply
     detectable without an extra AI pass or rasterizing+OCR-ing every
     page first — the cost of detecting it could exceed the cost of just
     sending it); lowering DPI of a raster image EMBEDDED inside a PDF
     page (`pdf-lib` can split/merge pages but cannot re-rasterize an
     embedded image at a lower resolution without a much heavier
     rendering dependency this function doesn't have) — both left as
     explicitly-flagged future work, not silently absent.
  Tests: `app/src/import/__tests__/chunking.test.ts` (14 tests) covers
  `computeChunkPageRanges`, `buildChunkPromptAddendum`, and
  `mergeChunkedExtractions` — including a real-world regression case
  using the exact numbers from the NEGATIVE SETTLEMENTS pass's own fixture
  (W/E 2026-07-24, $5.16 gross, -$1,155.35 net, 0 miles, $1,160.51 in
  deductions split across simulated header/deduction chunks) to prove the
  merge reproduces a genuine multi-page statement's numbers exactly. The
  orchestration logic itself (the three-path branching, the Deno-only
  `getPdfPageCount()`/`splitPdfIntoChunks()` helpers) is NOT unit-tested —
  no Deno test runtime is available in this environment; `chunking.ts`
  carries 100% of the testable, deterministic logic by design specifically
  so this gap is as small as possible.
- DASHBOARD SIMPLIFICATION (owner decision 2026-08-02, binding — "remove
  Customize entirely and ship one well-designed fixed layout"): Home
  (`app/(tabs)/index.tsx`) is a FIXED, non-customizable layout now,
  exactly this order, nothing else:
  a) Hero profit card (period tabs + area chart) — unchanged.
  b) Revenue / Expenses / Net Profit trio with % deltas — unchanged.
  c) Business Balance slim card — unchanged, including the negative-
     balance "you owe the carrier" red treatment.
  d) AI Coach card (`AiCoachCard`, new) — a FIXED entry point into the
     `ceo-mode` briefing screen, replacing the old rotating AI Insight
     card. Same visual container/treatment as the retired card (icon +
     bold title + one sentence, tappable) but the content no longer
     rotates through candidate insight types — it's a static invitation
     into AI Coach. Deliberately reuses the EXISTING `ceoMode.title`/
     `ceoMode.subtitle` i18n strings ("AI Coach" / "Your weekly business
     briefing, composed from your own data.") instead of adding new
     keys — no 7-locale translation pass needed for this card.
  e) Recent Loads, then Best/Worst Lanes (`BestWorstLanesCard`, new) —
     reuses `src/stats/cashFlowTrend.ts`'s existing `rankLoadsByRpm()`
     (already powering Cash Flow's own "Best & Worst Lanes" section)
     capped at 3 each (a Home teaser, not a duplicate of the full
     screen — tapping through goes to Cash Flow for the complete
     5-and-5 ranked list). Also reuses existing i18n
     (`cashFlowScreen.lanesTitle`/`bestLanes`/`worstLanes`) rather than
     adding dashboard-scoped duplicates of the same text.
  REMOVED from Home entirely (invariant #17 above is retired, struck
  through, kept for history): the Fleet Health Score gauge, the rotating
  AI Insight card, the Capital Account strip, the needs-review counter
  chip, and every card that lived inside the 4 collapsible Overview/
  Money/On-the-Road/Taxes sections (the tax row, per-diem summary, the
  Revenue-vs-Expenses trend + monthly overlay chart, the Expenses
  Breakdown donut, Goal Progress, the Road Days heat map, the truck
  mini-card, the S-corp preview, 1099-NEC reminders, and fleet/driver
  overview) — none of that underlying data or functionality was deleted
  from the PRODUCT, only from the Home screen: Capital Account, Tax
  Estimator, Truck Health, Profit Analysis, Scorecard, and Cash Flow all
  remain full screens reachable from the Menu exactly as before.
  **Deleted outright** (fully dead once Home no longer references them,
  confirmed by grep before removal — nothing else in the app imported
  them): `app/(tabs)/more/dashboard-customize.tsx` (the fancy drag-editor
  screen), `src/components/SimpleCustomizeDashboardModal.tsx` (the plain-
  fallback editor UX MEGA-PASS item C introduced), `src/dashboard/
  dragModuleLoader.ts` + its test (the lazy drag-module loader that
  screen depended on), `src/data/dashboardLayout.ts` (the
  `useDashboardLayout`/`useUpdateDashboardLayout`/
  `useUpdateSectionsCollapsed` hooks — nothing reads/writes
  `profiles.dashboard_layout`/`dashboard_sections_collapsed` anymore),
  `src/stats/dashboardLayout.ts` + its test (the card-id/route/label/
  section registry + `buildCustomizedDashboardBlocks()` the whole feature
  was built on), and — because they lost their only caller once the Fleet
  Health gauge and Expenses Breakdown donut left Home —
  `src/components/CircularGauge.tsx` and `src/components/DonutChart.tsx`.
  Six Home-only pure stats modules also lost their only caller and were
  deleted with their tests: `aiInsights.ts`, `roadDaysHeatmap.ts`,
  `fleetHealthScore.ts`, `taxProgress.ts`, `goalProgress.ts`,
  `cpmTrend.ts`, `trendRange.ts` (all confirmed via grep to have zero
  importers outside Home and their own test files before deletion).
  `'dashboard-layout'` was removed from `queryInvalidation.ts`'s
  `AFFECTED_AGGREGATES` (and its regression test) since nothing queries
  that key anymore. Nav: the `/(tabs)/more/dashboard-customize` entry was
  removed from `navRegistry.ts`'s `GROUPS` (which every nav surface —
  phone Menu, wide sidebar, Reports hub — derives from, so this is one
  edit, not three, per the NAV PARITY invariant above) and its
  `Stack.Screen` from `more/_layout.tsx`; the orphaned `nav.
  dashboardCustomize`/`dashboard.customize`/the entire `dashboardCustomize.*`
  i18n block were deleted from all 7 locale files (same "confirmed unused
  everywhere first, then delete" convention as the NAV PARITY invariant's
  orphaned `more.*` block cleanup). `ScreenErrorBoundary.tsx` (a reusable,
  generic component still used by `settings.tsx` and others) had its
  design-history comments referencing the deleted `dashboard-customize.tsx`/
  `dragModuleLoader.ts` lightly trimmed rather than left dangling, but the
  component itself is untouched — it remains available for reuse on any
  future screen with a risky native-module dependency.
  **Deliberately NOT deleted**: `profiles.dashboard_layout`/
  `dashboard_sections_collapsed` DB columns (harmless, no migration —
  Reset All Data still clears them as a no-op) and the many Home-specific
  i18n strings for the removed cards (`dashboard.aiInsights.*`,
  `dashboard.fleetHealth.*`, `dashboard.moneyBreakdown.*`,
  `dashboard.taxProgress.*`, `dashboard.goalProgress.*`,
  `dashboard.roadDaysHeatmap.*`, `dashboard.capitalAccountTitle`,
  `dashboard.truckCardLabel`, `dashboard.fleetOverviewTitle`,
  `dashboard.driverOverviewTitle`, `dashboard.necReminder*`,
  `dashboard.scorpPayroll*`, `dashboard.yearFallbackBanner`,
  `needsReview.homeCounter`) — a deliberate scope decision, not an
  oversight: no test in this repo enforces "every i18n key must be
  used," deleting ~50 keys across 7 locale files precisely and safely is
  a large, error-prone undertaking for zero functional benefit, and
  leaving them costs nothing (unused JSON entries, never rendered). If a
  future pass wants that cleanup, do it as its own explicit task.
  PARITY.md's Dashboard section and PROMPTS.md (both the original
  Session 9a item 8 / Personalization-package item 1 specs, marked
  RETIRED in place for history, and a new Backlog entry) were updated to
  match — per-card customization may return in a v2 pass, but only on a
  fresh, explicit owner decision, not as a standing roadmap item.
  Tests: `tsc --noEmit` clean; the full `jest` suite (64 suites — down
  from 73, matching the 9 deleted test files) passes; all 7 locale files
  confirmed to still have identical key sets after the i18n cleanup
  (`glossary.test.ts` re-passed as the existing parity guard).
- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 2 — "STILL FAILING" FIX (owner
  decision 2026-08-03, device evidence: real Prime settlements STILL
  timed out after the 2026-08-02 chunking pass — "Could not process this
  multi-page document (4 sections attempted): ...over 50s"). Diagnosis
  requested first, answered plainly: NO, a chunk was never re-sending the
  whole document — `splitPdfIntoChunks()` (index.ts) genuinely crops each
  chunk to only its own pages via pdf-lib's `copyPages()`/`addPage()`,
  confirmed by reading the code line by line before writing anything new.
  The real, separate root causes:
  1. **A genuine retry-doubling bug**: `callAnthropicMessages()`'s catch
     block retried on ANY caught error — including an `AbortError` from
     OUR OWN client-side timeout — before ever checking whether it was an
     abort. A chunk that timed out at (the prior pass's) 50s silently got
     a full SECOND 50s attempt before surfacing the "over 50s" message,
     meaning real failures were taking ~2x as long as the error implied.
     Fixed: an abort now returns the `timeout` error immediately, no
     retry — retry is reserved for a genuine transient failure (a real
     network throw, or a 5xx/529 response), which a repeat attempt can
     actually help with.
  2. **Parallel contention across chunks**: the prior pass fired all of a
     document's 3-page chunks at Anthropic simultaneously via
     `Promise.all`. Real-world evidence (still failing at the raised
     budget) points to this adding genuine contention/queueing risk on
     top of each call's own processing time, exactly as the bug report
     suspected ("parallel adds rate-limit and memory risk").
  **New strategy — "prefer what demonstrably works," pragmatic default
  over exhaustive coverage**: `SETTLEMENT_MAX_PAGES = 3` (index.ts) caps
  extraction at the FIRST 3 pages by default — the header/revenue/
  reimbursement/deduction/recap sections of a carrier settlement are
  always there; the operating-statement/EZ-Pass/repair-invoice pages that
  typically follow are a duplicate YTD rollup and separate documents the
  user can import on their own. This isn't gated on docType (unknown
  until AFTER extraction) — it applies to any oversized PDF, which in
  practice means settlements, since that's what triggers this path.
  Two paths now, replacing the prior pass's three:
  1. **Single call** (`totalPages <= SETTLEMENT_MAX_PAGES`, or a PDF whose
     page count pdf-lib couldn't even determine — page-capping isn't
     possible anyway, so the whole original file is sent as-is):
     `SINGLE_CALL_TIMEOUT_MS` (90s), the standard 5xx-only retry.
  2. **Sequential, page-by-page** (`totalPages > SETTLEMENT_MAX_PAGES`):
     pages 1, 2, 3 — ONE AT A TIME, in order, NEVER in parallel, NEVER
     page 4+. `SEQUENTIAL_PAGE_TIMEOUT_MS` (40s) per page. STOPS at the
     first page that fails rather than attempting the rest (sequential,
     not parallel, means a doomed later page never wastes time
     alongside — or contends with — an earlier one). This is a REAL
     increase in per-page budget despite 40s being less than the old
     50s: the old 50s covered 3 PAGES per call (~17s/page); this is 40s
     for exactly ONE page — roughly 2.3x more time per page, with zero
     parallel contention.
  Both budgets are sized against Supabase's VERIFIED 150s wall-clock
  ceiling for a synchronous request/response Edge Function invocation:
  single-call worst case ≈91s (~59s margin); sequential worst case ≈123s
  for all 3 pages (~25s margin for pdf-lib parsing/splitting ×3, the
  daily-import-count query, response serialization).
  **Graceful degradation, never lose the whole import again**: if page 1
  succeeds but page 2 or 3 fails, the sequential path SAVES whatever
  pages succeeded before the failure instead of discarding everything —
  `mergeSequentialPageResults()` (chunking.ts, pure and unit-tested, same
  "chunking.ts carries 100% of the testable logic" convention as the
  prior pass) merges only the pages before the first failure and forces
  `confidence: 'low'` whenever the result doesn't cover every page of the
  original document (whether by deliberate 3-page cap or a mid-sequence
  failure) — reusing the EXISTING needs-review machinery (invariant #14)
  rather than inventing a second one. Every response that doesn't cover
  every original page — capped-by-design or failure-truncated alike —
  now carries a `pagesProcessed: {through, total}` field alongside `data`;
  `aiImportCall.ts` forwards it, and the import preview screen shows a
  plain "📄 Partial document imported — imported pages 1-N of M, later
  pages weren't processed, import them separately if needed" banner (new
  `importScreen.pagesProcessed*` i18n keys, all 7 locales) rather than
  silently looking complete when it isn't. A total failure (page 1 itself
  fails) still surfaces page 1's own real error, same as before.
  **Timeouts raised end to end, not just server-side**: client
  (`aiImportCall.ts`) `PDF_CLIENT_TIMEOUT_MS` raised 190s → 240s per the
  explicit ask, `IMAGE_CLIENT_TIMEOUT_MS` 130s → 120s (still shorter than
  the PDF budget, images are always one `IMAGE_TIMEOUT_MS`(90s, raised
  from 60s) call). **Measured per-call duration (item 6 of the bug
  report), answered honestly**: this dev environment cannot make a real
  Anthropic API call to measure actual latency — rather than invent a
  number, `callAnthropicMessages()` now logs the REAL elapsed ms for
  every attempt (`console.log`, visible via `supabase functions logs
  ai-import`), so the next genuine device import reports the true
  per-call budget instead of a guess.
  Tests: `app/src/import/__tests__/chunking.test.ts` gained 6 new tests
  for `mergeSequentialPageResults()` — first-page failure returns null
  (nothing to save), a single successful page passes through untruncated
  when it's the whole document, truncated results force `confidence:
  'low'`, stopping at the first failed page merges only the pages before
  it (never a page that would have come after), a fully-covered 3-page
  merge is not marked truncated, and a real-world-shaped 3-of-12-page
  case reproduces the exact NEGATIVE SETTLEMENTS fixture numbers. Full
  suite: 64 suites / 1475 tests pass; `tsc --noEmit` clean; all 7 locales
  confirmed key-parity after adding the 2 new `importScreen.*` keys.
- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 3 — NO MORE PAGE CAP + HARD
  RECONCILIATION GUARD (owner decision 2026-08-03, device evidence: round
  2's 3-page cap DID fix the timeout — "Partial document imported — pages
  1-3 of 11" came back correctly, with the right week/loads/miles/gross —
  but the deduction LINE ITEMS on that real 11-page settlement live past
  page 3. The result showed Net Pay $0.00 and Deductions $0.00 while the
  AI's own summary text said "Total deductions from truck: $4,637.15" —
  gross income with zero recorded expenses. Saving that would be a real
  tax-accuracy bug, not just an incomplete import: CLAUDE.md invariant #1's
  net-pay tax model depends on out-of-pocket/withheld deductions actually
  being captured). Two changes, together:
  1. **No fixed page cap, ever** — there is no page count that's safe to
     assume covers every settlement's financial sections, so capping
     itself was the bug, not its size. Replaced with a CLIENT-DRIVEN
     CONTINUATION protocol: `ai-import` processes a document in small,
     safe batches (`PAGES_PER_BATCH = 3` pages, sequential, never
     parallel — same per-page granularity and contention-avoidance as
     round 2) and, whenever a batch fully succeeds but pages remain,
     returns `nextPageStart` + `rawPageExtractions` (the raw per-page
     extractions gathered so far) instead of a terminal result.
     `aiImportCall.ts`'s `callAiImport()` loops: sees `nextPageStart`,
     calls `ai-import` AGAIN passing those two values straight through,
     SEQUENTIALLY (one full round-trip at a time, never concurrent),
     until the whole document is covered or a page genuinely fails. This
     is what makes "process ALL pages" compatible with Supabase's
     VERIFIED 150s-per-invocation wall-clock ceiling (round 1) even for a
     document with dozens of pages: no single invocation ever tries to
     cover more than `PAGES_PER_BATCH` pages, so the per-invocation budget
     math is UNCHANGED from round 2 (≈123s worst case, ~25s margin) no
     matter how many total batches a long settlement needs — the platform
     ceiling is never at risk regardless of document length. The merge
     logic itself never moved off the server — `chunking.ts`'s existing,
     tested `mergeSequentialPageResults()` still does 100% of the actual
     merging (the server just feeds it the combined prior+new extraction
     list each round); the client's only job is to store and resend the
     raw array between calls, never to reimplement any merge semantics.
     Defensive-only ceilings added on both sides (`MAX_TOTAL_PAGES = 60`
     server-side, a 60-round loop cap client-side) guard against a
     pathological/corrupt PDF driving an unbounded number of round-trips
     — real settlements are nowhere near this long. The import screen's
     "still working" message now updates per round-trip
     (`importScreen.processingPageProgress`, "Processing page N of M…")
     instead of showing one static label for however long a many-page
     document's full sequence takes.
  2. **Settlement reconciliation hard guard, must-have** — a new pure,
     unit-tested `checkSettlementReconciliation()`
     (`app/src/import/settlementReconciliation.ts`) BLOCKS Save entirely
     (no override — a half-settlement that looks complete is worse than
     no settlement) whenever either of two concrete, high-confidence
     signals fires: (a) the settlement's own stated `totalDeductions`
     figure doesn't match what the `deductions` line items actually sum
     to (beyond a $1 rounding tolerance — deliberately narrow, per the
     bug report's own framing "prefer the AI's stated section totals as a
     cross-check EVERYWHERE," not a broader gross-minus-deductions-
     equals-net arithmetic identity that would false-positive on
     legitimate cases this app already handles, like escrow holdbacks or
     NEGATIVE SETTLEMENTS' real negative nets); (b) `netPay` is exactly
     `0` (or missing) while `grossRevenue` is nonzero — the precise
     signature of a never-reached net-pay figure, not a real business
     outcome (a real settlement's net is essentially never EXACTLY
     $0.00). Wired into the import screen's Save button `disabled` prop
     AND as a second, defense-in-depth check inside `handleSave()` itself
     (same "double guard" pattern as the existing double-tap-guard/
     duplicate-race checks), with a red (not the usual amber) blocking
     banner listing the specific issue(s) and telling the user to
     reimport, or add the missing amounts as standalone deductions from
     the Deductions screen (settlements have no manual-add UI of their
     own — a standalone deduction is the one real fallback that exists
     today for capturing the expense even if the settlement itself can't
     be saved). Deliberately does NOT gate on `pagesProcessed`/truncation
     status — it re-checks the ACTUAL numbers on every settlement
     extraction regardless of how it was obtained, as defense in depth
     against any other path that could produce the same incomplete shape.
  Tests: `app/src/import/__tests__/settlementReconciliation.test.ts` (new,
  10 tests) — passes a complete/reconciled settlement, a genuinely
  deduction-free one, a legitimate NEGATIVE SETTLEMENTS case (negative net
  is fine, only an exact-zero net alongside nonzero gross blocks), item
  4's own example (stated $4,637.15 vs. summed $500), the exact reported
  failure mode (gross $8,235.47, net $0, deductions $0), a missing-net
  case, rounding tolerance, and both signals firing at once.
  `app/src/import/__tests__/chunking.test.ts` gained an 11-page,
  8-deduction-page test proving `mergeSequentialPageResults()` correctly
  accumulates deductions spread across many pages into a complete,
  correctly-summed, non-zero-net result when every page succeeds — the
  actual multi-invocation orchestration (`extractPageBatch`/
  `priorPageExtractions` continuation in index.ts) is Deno-only and not
  unit-tested here, same "no Deno runtime available" gap as every prior
  pass's server orchestration logic. Full suite: 65 suites / 1498 tests
  pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity
  (glossary test caught and fixed one real slip — the Spanish
  translation of the new reconciliation strings initially translated
  "settlement" to "liquidación," violating the DO-NOT-TRANSLATE glossary
  rule; fixed before commit). Measured per-call timing (item 6, both
  rounds): still cannot be produced from this dev sandbox — the
  `console.log` timing added in round 2 remains the mechanism for getting
  real numbers from the next actual device import
  (`supabase functions logs ai-import`).
- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 4 — SINGLE CALL IS THE DEFAULT
  AGAIN (owner decision 2026-08-03, "STOP AND SIMPLIFY" device evidence:
  round 3's batch-continuation design made things WORSE — a real 11-page
  settlement's banner read "Imported pages 1-1 of 11," meaning the
  client's round-trip loop stopped after a single page, capturing gross
  revenue but $0 net/deductions again via a different failure mode than
  round 2's fixed cap). Four passes in, "prioritize WORKING over elegant"
  was the explicit instruction. Restored the ORIGINAL, previously-working
  shape: ONE call over the WHOLE document is the DEFAULT for every
  document, image or PDF, any page count — exactly like this function's
  very first implementation, before any chunking pass — carrying forward
  only the two real, verified improvements from rounds 1-2 (the raised
  timeout budget, the retry-on-timeout bug fix). The round-3 continuation
  protocol was NOT deleted — it became the FALLBACK, entered ONLY when
  the single call itself returns `timeout` or `truncated` (a clean
  4xx/parse-failure/refusal is not something splitting into pages can
  fix, so those still surface as a normal error). This inverted round 3's
  priority exactly as instructed: single call first, chunking is the
  exception, not the reverse. Every decision (single-call outcome,
  fallback trigger, per-batch/per-page result) was logged so the next
  real device test's function logs would show exactly what happened
  instead of guessing again — this pass's own numbers were explicitly
  marked PROVISIONAL pending real measured data, which arrived in round 5
  below.
- MULTI-PAGE SETTLEMENT CHUNKING, ROUND 5 — MEASURED EVIDENCE (owner
  decision 2026-08-03, binding numbers — record these so nobody re-
  guesses these thresholds again). Real per-page Anthropic call durations
  from Supabase's own `ai-import` function logs (round 4's per-attempt
  `console.log`):
  ```
  03:01:37  attempt 1/2: 23866ms, status 200   (page succeeded)
  03:02:17  attempt 1/2: 40003ms, TIMED OUT    (killed at round 3's 40s cap)
  02:37:59  attempt 1/2: 39121ms, status 200   (barely made it under 40s)
  ```
  Owner's own diagnosis, confirmed by these numbers: **this was a BUDGET
  problem, not an architecture problem.** A single page can legitimately
  need up to (and apparently sometimes just past) 40 seconds — the
  system's own 40s `AbortController` was killing legitimate, still-
  working calls. THAT is why round 4's device test showed "Imported
  pages 1-1 of 11": page 2 didn't fail because of a real error, it failed
  because the timeout was too tight, and round 3/4's design then stopped
  the entire continuation at that first failure (round 3's
  `mergeSequentialPageResults` treated any failure as a hard stop).
  **Three changes, precisely targeted at the evidence:**
  1. **`PAGE_TIMEOUT_MS` raised 40s → 110s** (per-page, first attempt) —
     comfortable margin over the ~40s worst case actually observed, while
     leaving real headroom under Supabase's VERIFIED 150s wall-clock
     ceiling for one invocation.
  2. **`PAGES_PER_BATCH` reduced 3 → 2** — fewer pages attempted per
     invocation keeps the common-case invocation short. Combined with
     dynamic per-invocation time-budget tracking (next point), the SAME
     code stays safe even if a page takes far longer than the 24-40s
     typically measured — a fixed "2 pages always fits" assumption would
     be the exact same class of guess that caused this bug, since the
     measured evidence shows single-page duration is NOT constant (23.9s
     to >40s within the SAME document).
  3. **A single-page timeout is no longer fatal to the whole document.**
     `runPageWithRetry()` (index.ts) gives a timed-out page ONE extra
     attempt at a shorter `PAGE_RETRY_TIMEOUT_MS` (30s) budget; if that
     ALSO fails (or there isn't enough remaining invocation budget to
     even try), the page is recorded MISSING and the loop moves on to
     EVERY remaining page regardless — "the loop must always attempt
     every page" (owner decision), never stopping the whole document over
     one bad page. A non-timeout failure (4xx/parse-failure/refusal) is
     never retried — that's not what a retry can fix — and marks the page
     missing immediately instead of wasting the retry budget.
  **Gap-tolerant merge** (`chunking.ts`'s `mergeAllPages()`, replacing
  round 3's stop-at-first-failure `mergeSequentialPageResults()`): pages
  are now tagged with their own page NUMBER (not positional order), so a
  missing MIDDLE page no longer prevents LATER pages from being merged —
  the exact "1 of 11" bug is now structurally impossible, since nothing
  ever stops the loop early over a single page's failure. `confidence` is
  forced `'low'` whenever ANY page is missing, regardless of how many
  merged cleanly — same needs-review trigger as before, just gap-aware.
  A genuinely incomplete result still can't be saved: the settlement
  reconciliation hard guard (`settlementReconciliation.ts`, unchanged
  this pass — verified still correct) independently catches the
  resulting mismatched totals (summed deductions vs. the statement's own
  stated total; net pay showing exactly $0 while gross is nonzero) and
  blocks Save regardless of which mechanism produced the incomplete data.
  **Dynamic time-budget tracking** (why a fixed page count alone isn't
  safe): `remainingInvocationBudgetMs()` (index.ts, computed fresh INSIDE
  the `Deno.serve` handler on every request — a module-level constant
  would only reflect the FIRST invocation's start time, since Deno keeps
  this module loaded across many invocations) tracks real elapsed wall-
  clock time since THIS invocation started; every page attempt's own
  timeout is capped at `min(PAGE_TIMEOUT_MS, remaining budget - 5s safety
  margin)` (`HARD_INVOCATION_BUDGET_MS = 145_000`, 5s under Supabase's
  150s ceiling; `MIN_USEFUL_BUDGET_MS = 20_000` — below this, don't even
  start another attempt). If there isn't enough budget left to safely
  attempt (or retry) another page, the loop stops THERE — not mid-attempt
  — and hands off to a fresh invocation via `nextPageStart`, which gets
  its own full 150s budget. This guarantees the platform's hard ceiling
  is never at risk no matter how slow any individual page turns out to
  be — "more round trips is fine — they are cheap" (owner decision).
  **Wire protocol extended** to carry page NUMBERS, not just counts:
  request gains `priorMissingPages: number[]` alongside the existing
  `priorPageExtractions` (now `{page, extraction}[]`, tagged); response
  gains `rawMissingPages`/`pagesProcessed: {total, missingPages: number[]}`
  (replacing the old `{through, total}` shape, which couldn't represent a
  gap). `aiImportCall.ts`'s `callAiImport()` round-trip loop threads all
  of this through unchanged in spirit (still sequential, one round-trip
  at a time, never concurrent) and now logs every round
  (`console.log('[ai-import client] round N: ...')`) alongside index.ts's
  own per-page/per-invocation logs — "the next diagnosis takes one
  screenshot" (owner decision). The import screen's
  `pagesProcessedBody` banner now lists the SPECIFIC missing page
  numbers (`"Imported {{covered}} of {{total}} pages. Page(s)
  {{missingPages}} could not be processed..."`) instead of a contiguous
  "pages 1-N" range, since gaps are now representable and worth surfacing
  precisely.
  Tests: `app/src/import/__tests__/chunking.test.ts`'s
  `mergeSequentialPageResults` suite was replaced with `mergeAllPages`
  coverage — a middle page failing does NOT stop later pages from being
  merged (the exact bug this fixes, reproduced directly), confidence
  forced low on any gap, the 11-page/8-deduction-page full-coverage case
  carried over, plus a new "retried-then-skipped page" case matching the
  measured-evidence scenario. `app/src/data/__tests__/aiImportCall.test.ts`
  (new) is the requested regression suite for this whole area against a
  mocked `supabase.functions.invoke`: an 11-page document completes all 6
  expected round trips (`ceil(11/2)`) with the continuation state
  correctly threaded through each one; a page that fails even after the
  server's retry does NOT kill the run — the loop continues and the
  final result honestly reports `pagesProcessed: {total, missingPages}`;
  a small single-call document makes exactly one request; the
  `onProgress` callback fires once per intermediate round, never on the
  terminal one; a genuine server error on any round trip stops the loop
  immediately rather than being silently absorbed. Full suite: 66 suites
  / 1504 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity after updating `pagesProcessedBody`'s interpolation params.
  `settlementReconciliation.ts` and its 10 tests were verified unchanged
  and still passing — it operates purely on the final merged extraction's
  own fields, independent of however many pages/retries/gaps produced it,
  so it needed no changes to keep blocking an incomplete save correctly.
- CASH FLOW AUTO-FILL FROM SETTLEMENT DATA (owner decision 2026-08-04,
  device report: the Insurance field showed 0 and was monthly-only, while
  a real carrier withholds FOUR separate insurance charges EVERY WEEK —
  bobtail/deadhead, physical damage, occupational accident, cargo/workers
  comp). Two root causes, one pass:
  1. **Wrong shape**: `cf_insurance_monthly` (docs/PENDING_SQL.md §29)
     assumed a manually-entered monthly bill; a carrier's insurance
     withholding is weekly, per-settlement, and already sitting in the
     user's own imported data — it should never have needed manual entry
     at all.
  2. **Miscategorized on import**: the settlement JSON extraction schema's
     own deduction category enum includes the literal string `"Insurance"`
     (not either canonical `'Insurance—Truck'`/`'Insurance—Health'` value)
     — a line landing there via the loose `x.category` fallback (no
     chargebackType set) was an unrecognized category string, invisible
     to any category-based filter.
  **Fix**: `app/src/import/category.ts`'s new `isInsuranceChargeback()` —
  a text-based fallback (same "AI classification is primary, regex is
  the safety net" pattern as `isEscrowDeposit()`/`isRestaurantPurchase()`)
  matching the real abbreviated carrier codes from the device report
  (`BT/DH INS`, `PHY DAM`, `OCCUP ACC`, `CARGO`, `WORKERS COMP`) plus
  spelled-out/generic insurance wording — wired into
  `mapExtraction.ts`'s `mapSettlement()` at the SAME override priority as
  escrow/restaurant detection, so a settlement-withheld insurance line
  now reliably lands as `'Insurance—Truck'` regardless of whether the AI
  set chargebackType.
  **New column, not a reinterpretation** (docs/PENDING_SQL.md §39):
  `profiles.cf_insurance_weekly` — `cf_insurance_monthly` is left in
  place, unused, same "harmless deprecated column" precedent as
  `dashboard_layout` after the Customize Dashboard retirement. A renamed/
  reinterpreted column would have silently misread an already-saved
  monthly figure as weekly (a 4.33x error) for any existing user.
  **Auto-fill extended to every input with real data behind it** (not
  just Insurance) — `app/src/stats/cashFlowForecast.ts` gained
  `trailingWeeklyInsuranceAverage()` and `trailingWeeklyTruckPaymentAverage()`,
  both using a NEW shared `trailingWeeklyWithheldAverage()` helper that
  groups settlement-withheld (`source==='settlement'`) deductions by
  `ded_date` (which for a withheld row IS the settlement's own
  `week_ending`, `mapSettlement()`'s `settlementFallbackDate`) and
  averages the trailing 4 distinct weeks — the SAME "distinct settlement
  weeks, not a raw calendar window" pattern `trailingWeeklyRevenueAverage`
  already used, deliberately different from `trailingWeeklyFuelAverage`/
  `trailingWeeklyOtherExpenseAverage`'s 28-day-window approach (fuel/
  generic-other data isn't tied to a settlement week the way a carrier
  withholding is). `trailingWeeklyOtherExpenseAverage` now EXCLUDES
  `'Insurance—Truck'`/`'Insurance—Health'`/`'Truck/Trailer Payments'`
  (alongside the existing `'Fuel & DEF'` exclusion) so these dollars are
  never double-counted into both a dedicated field AND "Other Weekly."
  `insuranceMonthly` was renamed `insuranceWeekly` throughout
  `CashFlowBudgetInputs`/`calcCashFlowForecast()` — the old `/4.33`
  monthly→weekly conversion is gone; it now sums into weekly expenses
  directly like every other budget input.
  **Manual override survives a new import, with an explicit reset
  action**: a new pure `mergeForecastInputsWithAverages()` function
  (previously this merge logic was inline in the screen's own
  `useMemo`) makes "an empty field falls back to the trailing average;
  a manual entry always wins" directly unit-testable without mounting
  the screen. `cash-flow.tsx` gained a shared `AutoFillField` component
  (replacing 5 near-identical hand-rolled field blocks) used by all 5
  auto-fillable inputs (Weekly Revenue, Fuel, Insurance, Truck Payment,
  Other) — an empty field shows the "avg of last 4 weeks: $X" caption
  (`cashFlowScreen.weeklyRevenueFromSettlements`, reused across all 5 for
  consistency); once the user types a manual value, the caption is
  replaced by a "↺ Reset to average ($X)" action
  (`cashFlowScreen.resetToAverage`, new key, all 7 locales) that clears
  the field rather than requiring the user to manually select-all-and-
  delete. Truck Payment (label already said "(wk)" even before this
  pass) and Insurance both gained this auto-fill treatment for the first
  time; Weekly Revenue/Fuel/Other keep their existing averages, now with
  the same reset action they lacked before.
  Tests: `app/src/import/__tests__/category.test.ts` gained
  `isInsuranceChargeback()` coverage (the exact real carrier codes,
  spelled-out variants, and a false-positive check).
  `app/src/import/__tests__/mapExtraction.test.ts` proves a settlement
  deduction landing on the schema's generic `"Insurance"` category still
  resolves to `'Insurance—Truck'` via the text fallback, and that a
  correctly-set `chargebackType` still works unchanged.
  `app/src/stats/__tests__/cashFlowForecast.test.ts` gained coverage for
  both new trailing averages (including the exact 4-separate-weekly-
  insurance-lines shape from the device report), the "Other Weekly"
  double-counting exclusion, and `mergeForecastInputsWithAverages()`
  (empty falls back, a manual override survives a simulated new import
  changing the average, an explicit `0` is a real value not "empty").
  A pre-existing integration test
  (`aiImportSave.settlementChildren.test.ts`) needed updating — its
  fixture's unlabeled "Weekly insurance" deduction used to fall into the
  generic "Other" bucket by accident (no category match existed before
  this pass); it now correctly lands in the dedicated Insurance average
  instead, exactly proving the fix end to end rather than in isolation.
  Full suite: 66 suites / 1520 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity.
- FULL PARITY WITH WEB v2026.08.05-K, PART A — CATEGORY TAXONOMY (owner
  decision 2026-08-05, accounting-correctness + accountant-package pass —
  see PARTS B-G below for the rest of this multi-part pass).
  `app/src/import/category.ts` `CANONICAL_CATEGORIES` gains 6 new
  categories (Fuel Additives, Truck Parts, Major Repairs & Overhauls,
  Truck Wash & Detailing, Warranty & Service Contracts, Lumper Fees) and
  renames `Professional Services` → `Legal & Professional Services`
  (Schedule C Line 17's official wording) — old rows saved under either
  that or the even-older `Legal & Accounting Fees` are re-classified by a
  one-time SQL migration (docs/PENDING_SQL.md §40), a deliberate change
  from this taxonomy's previous "free text, no migration, old rows just
  display as-is" convention: the new Accountant Package groups/subtotals
  by EXACT category string, so a stale string would silently create an
  orphaned second bucket instead of rolling up with its renamed
  successor. The same migration folds the ORIGINAL single-user web app's
  `Fixed`/`Variable` 3-bucket classification into `Misc` — the CURRENT
  canonical `Other` catch-all is deliberately left untouched, since it's
  a distinct, valid, still-in-use category (CLAUDE.md invariant #14), not
  a legacy string being retired.
  CRITICAL BUG FIX: `supabase/functions/ai-import/index.ts`'s settlement
  deductions schema had a STALE, SHORTER category enum baked into its
  JSON-schema example string — 7 old values (`Software & Subscriptions|
  Legal & Accounting Fees|Insurance|Licensing & Permits|Fixed|Variable|
  Other`) that didn't even match the current `CANONICAL_CATEGORIES` the
  app's own picker reads from, meaning the AI could return (and did
  return) a category string the app doesn't recognize. Replaced with
  `CATEGORY_ENUM_STRING`, generated from the same canonical list
  (manually kept in sync — this Deno function can't import a TS module
  from `app/`, same constraint as every other "keep in sync" comment in
  that file; docs/INDUSTRY_TAXONOMY.md §B is the source of truth to check
  first).
  SETTLEMENT-LINE CLASSIFIER: a real device statement's unmapped
  chargeback codes (EXTEND WR PURCH, ACCOUNTING SERV, FED HWY TAX, QUAL/
  GEO RENTAL, EZ FAST LN, PRIME POINT-OF-SALE, COMPANY STORE, WIRE
  CHARGE, STATEMENT PREPARATION, ADV FOR OUTSIDE LUMPER) were all landing
  in "Misc" with zero accountant-usable detail — an $18k Misc pile on one
  real account. `classifySettlementLine()` (`category.ts`) is now the ONE
  ordered rule list `mapExtraction.ts`'s `mapSettlement()` reads a
  settlement-withheld deduction's category from, replacing the previous
  inline 3-branch ternary chain (isRestaurantPurchase → isEscrowDeposit →
  isInsuranceChargeback) with a fuller ordered list, checked ahead of the
  AI's own `chargebackType` and the older loose `category` string (both
  remain as fallbacks). ORDER MATTERS, and is now directly tested
  (`category.test.ts`): a LUMPER-shaped advance ("ADV FOR OUTSIDE
  LUMPER") is checked BEFORE the generic advance rule so the bare word
  "ADV" doesn't misclassify it as a repayment; a plain/generic `ADVANCE`
  line wins over the warranty rule (the ORIGINAL "EXTEND WR PURCH" line —
  the actual purchase — is a real deductible expense, but a LATER
  "ADVANCE" line repaying it in installments is not a new expense).
  Also added: `isFuelAdditive()`, `isTruckPart()` (a CONSUMED part —
  alternator, belts, filters — distinct from `Tools & Equipment`'s
  reusable TOOL), `isTruckWash()` (word-boundary-guarded so "windshield
  washer fluid" never false-hits), `isWarrantyService()`, `isLumperFee()`,
  `isGenericAdvance()`, `isMajorRepairOverhaul(text, amount)` (requires
  BOTH the >$2,500 threshold AND a major-component keyword — applied at
  `mapExtraction.ts`'s `mapPurchase()` call site, which has both a
  description and an amount, rather than inside `guessCategory()`, whose
  signature has no amount param), and `isLodging()` (extended for inn/
  lodge/Airbnb/truck-parking reservations, guarded so "Inner tube" never
  matches `\binn\b`). `guessCategory()` also gained a shop-invoice-with-
  labor rule (→ Maintenance & Repairs) and reclassified GPS/load-board
  brands (Garmin, DAT, Truckstop.com, "load board") from Software &
  Subscriptions to ELD & Communications per the spec's explicit "ELD/GPS/
  load board" grouping.
  SCHEDULE C LINE: `SCHEDULE_C_LINE`/`scheduleCLineFor()` (`category.ts`)
  maps every canonical category to a Schedule C line for the Accountant
  Package (informational only, CLAUDE.md invariant #8) — `Major Repairs &
  Overhauls` shares numeric line 21 with `Maintenance & Repairs` but
  carries its own footnoted `'21*'` value rather than silently blending
  into routine repairs; `Insurance—Health`/`Meals (per diem covered)`/
  `Advance Repayment`/`Escrow & Deposits` map to `null` (not a Schedule C
  line at all, or excluded entirely).
  Tests: `category.test.ts` gained coverage for every new detection
  function, `scheduleCLineFor()` across every canonical category, and
  `classifySettlementLine()`'s full code list plus both ORDER MATTERS
  cases (lumper-beats-generic-advance, generic-advance-beats-warranty).
  Full suite passes; `tsc --noEmit` clean. No new user-facing i18n
  strings were needed for this part — category names are domain values
  that stay English in every locale (CLAUDE.md invariant #11).
- FULL PARITY WITH WEB v2026.08.05-K, PART E — CAPITAL ACCOUNT (owner
  decision 2026-08-05, "worst bug of the day" class fixes — see PART A
  above and PARTS B-D/F/G elsewhere in this pass). Audited this app's
  existing capital-account code against every item in the spec first:
  items E.1 (no "Record Money In" action / no inline-editable manual
  rows) and E.5 (Tax-Free Remaining clamped at $0, hiding a real negative
  balance) were genuine gaps/bugs here; items E.2 (orphan-cleanup
  deleting manual equity) and E.4's "no hidden base constant tripling the
  total" were confirmed ALREADY NOT PRESENT in this codebase by design —
  `capital_transactions.linked_deduction_id` is `on delete cascade`
  (docs/SCHEMA.sql) so a linked contribution can never outlive its
  deduction without any cleanup job needed at all (the legacy-backup
  importer's own comment, `importLegacyBackup.ts`, already calls this out
  explicitly: "structurally impossible here"), and contribution totals
  have always summed real `capital_transactions` rows only, never a
  hidden seeded constant.
  1. **Tax-Free Remaining no longer clamped at $0**
     (`app/src/stats/capitalAccount.ts` `calcCapitalAccount()`) — legacy's
     OWN `rCapital()` clamped the DISPLAYED number
     (`Math.max(0,capRemain)`) while the screen's color logic already
     compared the UNCLAMPED value for red/green, a real inconsistency: the
     figure silently floored at $0 even when the color already knew it
     was negative. `taxFreeRemaining` is now the live, unclamped value;
     `capital-account.tsx` shows a red "⚠️ You've drawn past your
     capital — further draws come out of profit" banner
     (`capitalAccount.pastCapitalWarning`) whenever it goes negative.
  2. **Record Contribution + inline delete for manual rows**
     (spec item E.1) — a new "➕ Record Contribution" button/sheet mirrors
     the existing draw flow. `HistoryRow` now distinguishes a MANUAL
     contribution (deletable, ✕) from a LINKED one (`linked_deduction_id`
     set — stays read-only, 🔗, tap-through to the deduction, "edit the
     deduction instead" — unchanged). A manual contribution's delete
     confirmation (`capitalAccount.deleteContributionConfirmTitle`) is
     separate copy from the existing draw-delete confirmation.
  3. **Equity moves cash, not tax — genuinely wired this pass** (spec item
     E.3): recording/deleting a MANUAL draw or contribution on this
     screen previously touched ONLY `capital_transactions` —
     `profiles.business_balance` was left completely untouched by that
     action (only ever moved by settlement import or the separate
     "Update Business Balance" manual-correction button), even though the
     Dashboard/Cash-Flow-starting-balance/Accountant-Package all read
     `business_balance` as if it already reflected every cash movement.
     Fixed with the SAME atomic-delta pattern as
     `settlements.business_balance_credit` (§37/§38) — reusing the
     EXISTING `apply_business_balance_delta(p_user_id, p_delta)` RPC, no
     new SQL function needed. `capital_transactions.
     business_balance_applied` (docs/PENDING_SQL.md §41) tracks exactly
     how much of THAT transaction has been applied so far (signed:
     positive for a contribution, negative for a draw) so a delete
     reverses the EXACT applied amount — read from the row, never
     re-derived from its current `amount`/`tx_type` — with no drift.
     `app/src/data/capitalTransactions.ts`'s new
     `useRecordManualCapitalTransaction()`/
     `useDeleteManualCapitalTransaction()` wrap the plain insert/delete
     with this RPC call, invalidating `capital_transactions`,
     `capital-account-summary`, AND `profile` (the Dashboard/Cash-Flow
     balance figures) together. SCOPE DECISION, deliberately narrow: this
     applies to MANUAL (non-linked) draws/contributions ONLY — a LINKED
     contribution (auto-synced from a personally-paid deduction via
     `deductionMutations.ts`'s `planContributionSync()`) represents
     equity the owner built by paying a business expense out of pocket;
     no cash actually moved into business checking for that event, so it
     must NOT also credit `business_balance` (doing so would fabricate a
     deposit that never happened) — `manualTransactionBalanceDelta()`'s
     own header comment documents this reasoning; the linked path keeps
     using the plain `useInsertCapitalTransaction`/
     `useDeleteCapitalTransaction` hooks, untouched. Verified (and
     directly tested) that this change reaches NOTHING in the tax
     engine — `calcCapitalAccount()`'s signature has no `tax_config`/
     `deductions` input at all, so a $5,000 draw or a $60,000
     contribution structurally cannot alter a tax estimate through this
     code path, matching the spec's own required test.
  4. **"Remove duplicate entries" action** (spec item E.4) —
     `findDuplicateTransactionIds()` groups by `(tx_type, tx_date,
     amount)`, keeps the first-seen row per group, and — critically —
     skips every row with `linked_deduction_id` set entirely (a linked
     row is never eligible to be flagged OR removed as a "duplicate," no
     matter how many share its date+amount, since it's driven by its own
     deduction, not user data-entry error). The screen only shows the
     "🧹 Remove Duplicate Entries" button when at least one real duplicate
     exists.
  5. **Contribution breakdown line** (spec item E.4's "cash transfers $X
     (n) · paid personally $Y (m)") — `summarizeContributions()` splits
     manual (cash) vs. linked (paid-personally) contributions; the screen
     shows a "no cash-transfer contributions yet" note
     (`capitalAccount.noCashTransferNote`) whenever every contribution on
     the account is linked and none is a real cash deposit.
  6. **"Draws and contributions move cash, not taxable income" note**
     (spec item E.3's required UI copy) — shown as a permanent
     `MutedText` line under the Business Balance card
     (`capitalAccount.cashMovesNotTaxNote`).
  Tests: `src/stats/__tests__/capitalAccount.test.ts` gained coverage for
  the unclamped negative `taxFreeRemaining`, `manualTransactionBalanceDelta`
  (contribution = positive, draw = negative), `findDuplicateTransactionIds`
  (same date+amount flagged, a lone manual contribution survives, a
  LINKED row is never touched even when it collides on date+amount, a
  contribution never cross-matches a draw), and `summarizeContributions`
  (cash vs. linked split, the "no cash transfer" signal). i18n: 8 new
  `capitalAccount.*` keys across all 7 locales (es/ru/ar/tr fully
  translated; hi/uk as untranslated English copies per invariant #11),
  key-parity confirmed. Full suite: 66 suites / 1544 tests pass; `tsc
  --noEmit` clean.
- FULL PARITY WITH WEB v2026.08.05-K, PART C — ARITHMETIC CORRECTNESS
  (owner decision 2026-08-05). Audit finding, root cause of every item
  below: `fuel_purchases`/`maintenance_records`/`tolls` are their OWN
  tables, never mirrored into `deductions` — `calcTrueProfit()`/
  `calcCpm()`/`buildProfitAnalysis()`'s `netIncome` ALL silently missed a
  standalone (non-settlement) fuel receipt, maintenance invoice, or toll
  charge entirely, since every one of them only ever summed `deductions`.
  (`buildAccountantPackage()` already folded fuel/maintenance in — this
  pass extends that same fix to every OTHER "what's my profit/cost"
  figure, the spec's "ONE canonical expense engine.")
  1. **`sumCanonicalExpenses()`** (`src/stats/trueProfit.ts`, exported) is
     now the shared total both `calcTrueProfit()`/
     `buildWeeklyTrueProfitTrend()` and `buildProfitAnalysis()`
     (`src/stats/profitAnalysis.ts`) read from: deductions (via the
     EXISTING `reducesTrueProfit()`, unchanged — still excludes Meals/
     Advance Repayment/Escrow & Deposits) + fuel_purchases + maintenance
     + tolls. DOUBLE-COUNT GUARD: a SETTLEMENT-LINKED fuel_purchases row
     (`settlement_id` set — mapSettlement() extracts both the itemized
     fuel section AND the settlement's own fuel_advance chargeback from
     the same document) is excluded from the total, since its cost is
     already represented by the settlement's own withheld deduction —
     only STANDALONE fuel (`settlement_id` null) is added. First attempt
     at this guard tried excluding the WITHHELD DEDUCTION's category
     instead (assuming fuel_purchases was always the more authoritative
     source) — caught by `trueProfit.test.ts`'s own pre-existing negative-
     settlement regression test, which proved that under-counts a real
     genuinely-deductible withheld Fuel & DEF row that has NO
     corresponding fuel_purchases entry at all; the settlement_id-based
     filter (excluding the fuel_purchases SIDE, never the deduction side)
     is the correct, safer direction. `maintenance_records`/`tolls` have
     no settlement_id column to filter by at all — added unconditionally,
     matching `buildAccountantPackage()`'s own established precedent (no
     `chargebackType` maps to "Maintenance & Repairs" at all, so no
     double-count risk exists there; a `tolls_transponder` chargeback
     colliding with an itemized toll row is a rare, accepted edge case,
     not a regression this pass introduces). Wired into all 5 true-profit
     consumers (Home, Scorecard, CEO Mode, Share Weekly Profit, Profit
     Analysis) — each now fetches fuel/maintenance/tolls (CEO Mode/Profit
     Analysis gained a fleet-wide, non-truck-scoped maintenance query
     distinct from Truck Health's own truck-scoped one, so this figure
     can never disagree with Home's for a multi-truck fleet).
  2. **CPM = canonical cost per TOTAL mile with a per-bucket breakdown**
     (`src/stats/cpm.ts` `calcCanonicalCpm()`) — replaces the Scorecard
     screen's only real CPM display (grep-confirmed the ONE UI call site
     app-wide), which read `FleetStats.cpm` (the legacy `calcCpm()`'s raw
     "ALL deductions unconditionally" total — counting a per-diem-covered
     meal, an advance repayment, or a refundable escrow deposit as if
     they were real operating costs). Buckets: Fuel & DEF, Maintenance &
     Repairs (folding Truck Parts/Tires/Major Repairs/Truck Wash),
     Insurance, Permits & Road Taxes, Tolls, Parking & Lodging, ELD &
     Software, Dispatch & Factoring, Dues, Professional Services, Driver
     Pay, Loan/Lease Payment, Other — shown as a new "Cost/Mile
     Breakdown" card under the existing Cost/Mile KPI row, plus an
     "Excluded (meals, advances, escrow)" informational line. Loan/lease
     payment is estimated from Loan Center (`loans` table,
     `normalizeToWeeklyPayment()` converts each loan's free-text
     `frequency` to its weekly-equivalent, summed and scaled by
     `settlementCount`) ONLY when no settlement-withheld
     'Truck/Trailer Payments' deduction already exists — otherwise the
     withheld row alone represents that cost, and adding the estimate on
     top would double it. `calcCpm()` (the old legacy-verbatim function)
     is left in place, untouched, for any future caller that specifically
     wants the literal `rDash()` figure.
  3. **Best/Worst Lanes — three real bugs in `rankLoadsByRpm()`**
     (`src/stats/cashFlowTrend.ts`, shared by Cash Flow's full 5-and-5
     list and Home's 3-and-3 teaser): (a) DE-DUPLICATES by
     `order_number|origin|destination` before ranking — a re-imported
     settlement or a load logged twice no longer pads a ranking with the
     same lane counted more than once (keeps the first-seen row, same
     convention as Capital Account's `findDuplicateTransactionIds()`);
     (b) EXCLUDES implausible rates outside $0.80–$12/loaded-mile (almost
     always a mis-read amount/mileage — a decimal-point OCR error, a
     swapped total-vs-per-mile field) into a new `excluded` array, shown
     as an amber "N load(s) excluded — rate looks mis-read... fix on the
     Loads page" notice on the Cash Flow screen rather than silently
     corrupting best/worst/avgRpm; (c) `avgRpm` is now TOTAL REVENUE ÷
     TOTAL LOADED MILES (a mileage-weighted average) instead of the
     unweighted mean of each load's own rate — a handful of tiny,
     high-rate loads no longer skews the average far above what the
     fleet is actually earning per mile.
  4. **Mark as Done's cost prompt reworded** (Truck Health,
     `truckHealth.markDoneCostLabel`) from "Cost (optional)" to "What did
     it cost you out of pocket? (0 if nothing)" per the spec's exact
     framing — the field itself (defaulting to `'0'`, already flowing
     into a real `maintenance_records.cost` the same as any invoiced
     record) was already correct; only the label undersold that a $0
     self-service repair is a deliberate, common answer, not a skipped
     field. Zero-amount maintenance/fuel/toll/deduction rows were
     confirmed to ALREADY not pollute any total (`buildAccountantPackage`/
     `calcCanonicalCpm`'s own `add()` helpers both already guard `if
     (!amount) return`) — the remaining "skip $0 rows in the report's
     LINE-ITEM LISTING" half of this spec item is Part B's Accountant
     Package rework (not yet built at time of this entry), since the
     current `buildAccountantPackage()` only returns bucketed totals, no
     individual line items yet.
  Tests: `trueProfit.test.ts` gained a dedicated "canonical expense
  engine" describe block (standalone fuel/maintenance/tolls subtract;
  settlement-linked fuel does NOT double-count; a standalone fuel
  purchase with no matching deduction is a real, previously-missed
  expense; backward-compat default-empty-arrays) plus a
  `buildWeeklyTrueProfitTrend` window-scoping case.
  `profitAnalysis.test.ts`'s existing "sums only rows within the trailing
  window" test's own `netIncome` expectation was corrected from 2800 to
  1850 — the OLD value was itself proof of the bug (fuelExpense/
  maintenanceExpense were computed and asserted as their own tiles in
  that SAME test but never actually subtracted into netIncome); a new
  settlement-linked-fuel case added alongside it. `cpm.test.ts` gained a
  `calcCanonicalCpm`/`normalizeToWeeklyPayment` describe block (exclusion,
  bucketing, settlement-linked-fuel guard, loan-payment-only-if-not-
  withheld, divide-by-zero). `cashFlowTrend.test.ts`'s `rankLoadsByRpm`
  suite gained dedup/exclusion/weighted-average cases; its own pre-
  existing "ranks best/worst" test had a fixture bug fixed alongside
  (all 3 loads shared the same default `origin: 'A', destination: 'B',
  order_number: null`, which the new dedup logic would have collapsed to
  1 row — each now gets a distinct `order_number`). Full suite: 66 suites
  / 1568 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (the glossary test caught a real slip mid-pass: the Spanish/
  Russian/Arabic translations of the new `cpmExcludedTotal` string
  translated "escrow" instead of keeping it in the DO-NOT-TRANSLATE
  glossary's Latin script — fixed before commit).
- FULL PARITY WITH WEB v2026.08.05-K, PART D — DATES + SPREAD-ORDER AUDIT
  (owner decision 2026-08-05).
  1. **One-time date repair migration** (docs/PENDING_SQL.md §42) — a
     PL/pgSQL `repair_implausible_date(d, year_floor, year_ceiling)`
     function applies the SAME year↔day-swap rule
     `app/src/import/dateGuard.ts`'s `trySwapYearAndDay()` already applies
     at IMPORT time to every ALREADY-STORED dated column: `settlements.
     week_ending`, `loads.pickup_date`/`delivery_date`/`load_date`,
     `deductions.ded_date`, `reimbursements.reimb_date`, `fuel_purchases.
     purchase_date`, `maintenance_records.service_date`, `tolls.
     toll_date`. Implausible = before 2020 or beyond next year, computed
     dynamically off `current_date` at the time the SQL runs (never a
     hardcoded year, so the migration stays correct whenever it's
     actually applied) — only repairs a row when the swapped reading is
     BOTH a real calendar date AND itself lands inside the plausible
     window; a genuinely unrecoverable date is left untouched rather than
     "fixed" into a wrong one, and stays flaggable (item 2 below).
  2. **`isImplausibleDate()`/`findImplausibleDates()`**
     (`app/src/import/dateGuard.ts`) — the pure, client-side counterpart
     for "flag any remaining impossible date in the report with a red
     banner": same before-2020-or-beyond-next-year window as §42's SQL
     migration, so the two can never disagree about what counts as
     implausible. Not yet wired into a screen — the Accountant Package
     rework (FULL PARITY part B, not yet built at time of this entry) is
     where the actual red banner lives; these two functions are ready for
     that screen to import directly.
  3. **SPREAD-ORDER AUDIT, confirmed NOT a bug in this codebase** — the
     spec's described failure mode (`{ id, _batch, source:'settlement',
     ...aiRow }`, where spreading the untrusted AI payload LAST lets it
     clobber id/source/batch tags set BEFORE it) was checked against
     every object-spread in `app/src/data/aiImportSave.ts` (there are 12)
     and every array-spread in `app/src/import/mapExtraction.ts` (there
     are 4, all array CONCATENATION, not object spreads). Every one of
     aiImportSave.ts's object spreads already follows the SAFE order —
     `{ ...mapping.settlement, document_id: documentId, ... }`, spreading
     an ALREADY-MAPPED insert object (built by mapExtraction.ts's own
     literal-field mappers, never a raw spread of untyped AI JSON) FIRST,
     then overriding the real id fields LAST, exactly the pattern the
     spec recommends. Deeper reason this bug class can't reach this
     codebase at all: `mapExtraction.ts`'s mapper functions (mapSettlement/
     mapFuel/mapMaintenance/mapPurchase/...) build BRAND-NEW literal
     objects reading only specific NAMED fields off the AI's JSON
     (`s.weekEnding`, `x.desc`, `x.amount`, ...) — none of them ever does
     `{ ...aiRow }`, so an unexpected/malicious field in the raw AI
     response has no path into a saved row's `source`/`settlement_id`/
     `document_id`/`id` regardless of spread order. Verified with a new
     end-to-end regression test (`aiImportSave.settlementChildren.test.ts`)
     that runs the REAL `saveExtraction()` against a settlement deduction
     line item carrying its own (adversarial) `source`/`settlement_id`/
     `document_id`/`id`-shaped fields at runtime (bypassing TypeScript via
     an explicit cast, since the `Extraction` type has no such fields to
     begin with) and proves the saved row's tags are always the
     app-controlled ones, never the payload's.
  Tests: `dateGuard.test.ts` gained `isImplausibleDate`/
  `findImplausibleDates` coverage (plausible/before-2020/beyond-next-year/
  boundary/null cases). Full suite: 66 suites / 1576 tests pass; `tsc
  --noEmit` clean.
- FULL PARITY WITH WEB v2026.08.05-K, PART B — ACCOUNTANT PACKAGE REWORK
  (owner decision 2026-08-05). The owner's accountant needs OUT-OF-POCKET
  expenses only (the carrier's own accountant already has the withheld
  side) — this is now the screen's DEFAULT scope, not an afterthought.
  1. **ORIGIN RULE, the missing piece** (docs/PENDING_SQL.md §43):
     `deductions.source` already distinguished settlement/import/manual,
     but `maintenance_records` and `tolls` had NO equivalent column at
     all — a settlement's own maintenance/toll line items were
     structurally indistinguishable from a standalone out-of-pocket
     import. New `source` columns (same 3-value enum) on both tables,
     backfilled for existing rows (a transponder toll defaults to
     withheld; a maintenance row linked to a standalone `docType:
     'maintenance'` document defaults to out-of-pocket, everything else
     to withheld — matching the spec's own stated default). `fuel_
     purchases` needed no new column — its existing nullable
     `settlement_id` already IS the origin signal (also reused by PART
     C's canonical expense engine's own double-count guard).
     `mapExtraction.ts`'s settlement/standalone maintenance mappers and
     the settlement toll mapper now stamp `source` explicitly; every
     manual-entry screen (`maintenance.tsx`, `tolls.tsx`,
     `truck-health.tsx`'s Mark as Done) stamps `source: 'manual'`.
  2. **`src/stats/accountantPackage.ts` gained a whole new, additive
     pipeline** on top of the original `buildAccountantPackage()` (kept,
     untouched, no other caller): `matchesAccountantScope()` (the 3-way
     out-of-pocket/withheld/combined filter, driven by the ORIGIN RULE
     above) → `buildLineItems()` (deductions + fuel + maintenance + tolls
     flattened into ONE typed, period+scope-filtered, zero-amount-row-
     skipped list — CLAUDE.md's C.1 "zero-cost rows never reach the
     report" requirement lives here) → `buildScheduleCTotals()` (category
     subtotals with each category's Schedule C line attached, PART A's
     `scheduleCLineFor()`) → `buildLumperFees()` (a dedicated table,
     filtered straight from the same line items) →
     `buildPerDiemBlock()` (MONTH figure and YEAR-TO-DATE figure computed
     side by side, both via the existing `calcPerDiemDays()` — never
     re-derived, only re-scoped which settlements are summed) →
     `buildCapitalAssets()` (reads `trucks`/`equipment`'s EXISTING
     purchase_price/purchase_date/financing columns, §36 — never counted
     in expense totals, labeled "depreciable, your CPA's decision") →
     `buildOwnersEquity()` (reuses Part E's `summarizeContributions()` —
     cash + linked contributions counted ONCE EACH and summed, never a
     hidden constant; `unmatchedOwnerPaidCount` is a WARNING, never a
     silent mis-total, whenever this period's owner-paid line items
     outnumber the linked contributions that should have auto-synced for
     them).
  3. **Screen rework** (`accountant-package.tsx`, fully rewritten): Year
     pill row (populated from every year that actually has a settlement,
     plus the current year) / Month pill row (+ "All Year") / Scope pill
     row (Out-of-pocket only — default — / Settlement-withheld only /
     Everything combined, with an explanatory note under the out-of-
     pocket choice). SECTION ORDER matches the spec exactly: header
     (company name — Unit N · year/make/model, cleanly omitted when
     unset) → summary tiles (gross income + a conditional "+ $X
     reimbursements" sub-line, reading the EXISTING `reimbursements`
     table by period; deductible expenses; a compact per-diem figure) →
     dedicated Per Diem section (month + YTD, side by side) → an
     implausible-date warning card (`findImplausibleDates()`, PART D.2 —
     this is the first screen it's actually wired into) → Lumper Fees
     table (above the category table, not buried at the bottom) →
     category expense table with BOLD, larger category headers (each
     showing its Schedule C line) and grand total → Capital Assets →
     Owner's Equity (with its own unmatched-owner-paid warning) → 4
     exports. EVERY ROW is tappable-to-edit (`CategoryPicker`, the SAME
     shared component `deductions.tsx` already uses) and deletable (✕,
     confirmed). Changing a fuel/maintenance/toll row's category
     (spec item B.4) converts it into a manual deduction row so the new
     category actually sticks — insert the new deduction FIRST, delete
     the original typed row only after the insert succeeds. A row's
     category-grouping in the UI resolves through the SAME
     `resolveScheduleCBucket()` `buildScheduleCTotals()` itself uses
     (not a raw `category` string match) — a custom category whose
     Schedule C bucket differs from its own name (e.g. "Detention
     Software" → "ELD & Communications") would otherwise silently vanish
     from its bucket's row list while still counting toward the bucket's
     total, a real display bug caught and fixed before commit. OWNER-PAID
     rows (`isPersonalPayment(payment_method)`) render with a subtle
     amber row background + a "💰 OWNER PAID" badge inline (screen, PDF,
     and the Excel export's own inline row highlight).
  4. **4 exports**: PDF month / PDF year (existing `expo-print`
     `printToFileAsync()` pattern, extended with the new sections) and
     Excel month / Excel year — the SAME HTML template rendered to a
     `.xls`-extensioned file with MIME `application/vnd.ms-excel`
     (Excel opens an HTML table given this extension/MIME, a standard,
     dependency-free trick — no new native module needed). Both share
     ONE `buildReportHtml(year, month)` function so the screen, the PDF,
     and the Excel export can never disagree about what a given
     period/scope actually contains.
  Tests: `accountantPackage.test.ts` gained full coverage for every new
  function — `matchesAccountantScope`'s 3-way matrix,
  `buildLineItems`'s zero-row-skip/ORIGIN-RULE/period-filter/owner-paid-
  detection cases, `buildScheduleCTotals`'s Schedule-C-line attachment,
  `buildLumperFees`, `buildPerDiemBlock`'s month-vs-YTD scoping,
  `buildCapitalAssets` (truck + trailer + equipment as separate rows,
  never a row with no purchase price), and `buildOwnersEquity` (cash +
  linked summed once each, a draw never counts, the unmatched-warning
  triggers/clears correctly). Full suite: 66 suites / 1614 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (glossary test
  re-passed clean — every new string was written scope-checked against
  the DO-NOT-TRANSLATE list up front this time, no post-hoc fix needed).
- FULL PARITY WITH WEB v2026.08.05-K, PART F — CASCADE DELETE, ASSET
  REGISTER, DEDUCTIONS FILTER (owner decision 2026-08-05).
  1. **CASCADE DELETE, the real gap**: `deductionMutations.ts`'s
     `cleanupOrphanedDocument()` (already used by `deductions.tsx`'s
     delete handler) used to only delete the `documents` DB ROW — the
     actual uploaded file stayed in Storage forever, an invisible orphan.
     Now reads the row's `storage_path` first and removes the Storage
     object too (same `documents` bucket every upload writes to) BEFORE
     deleting the row; a Storage-removal failure is logged but never
     blocks the DB-row delete, since a broken "View Document" link (row
     survives, storage_path 404s) is worse than a harmless orphaned
     Storage object (row is gone, nothing points at it, sweepable later).
     Second real gap: `maintenance.tsx`'s own delete handler never called
     `cleanupOrphanedDocument()` at all — a maintenance record's linked
     document/photo was NEVER cleaned up on delete, only a deduction's.
     Fixed by wiring the same call there (fuel_purchases/tolls have no
     `document_id` column at all, confirmed by re-checking their schemas,
     so no equivalent gap exists for them). Truck Health's "last done"
     mark needed NO code change — `calcTruckHealth()` already recomputes
     baselines live from whatever `maintenance_records` rows currently
     exist (no separate cached value to go stale), confirmed by re-
     reading `src/truck/health.ts`'s `buildBaselines()`. Delete
     confirmations on both screens now list what else gets removed
     (`deductions.deleteConfirmBody`/`maintenance.deleteConfirmBody`) —
     previously a bare title with no body text at all.
  2. **Asset Register — audited, confirmed ALREADY unified**: the list
     (`filteredAssets`), the stat cards (`buildAssetCategoryBreakdown`),
     and the category filter pills all already derive from the SAME
     `buildAssetRegister(deductions, todayIso)` call and the SAME
     `ASSET_CATEGORIES` constant (`src/stats/assetRegister.ts`) — no
     divergent "EQUIP-coded rows vs. category list" bug exists in this
     codebase (that class of bug was specific to the web app this pass
     is chasing parity with). The one real, fixed gap: selecting a
     category filter with zero matching rows showed a generic "no
     assets" message even when OTHER categories had real assets — now
     shows `assetRegister.emptyFilterNote` plus a "Show All" link
     (`assetRegister.showAllLink`) that resets the filter, instead of a
     dead-end blank screen.
  3. **Deductions screen — segmented origin filter** (spec item F.3):
     the screen already showed BOTH Out-of-Pocket and Withheld sections
     stacked, each with its own subtotal — a new All/Out-of-pocket/
     Settlement pill row (`deductions.originFilterAll/OutOfPocket/
     Withheld`) now lets a user show ONLY one section at a time, using
     the exact same `groupDeductions()`/`isSettlementDed()` origin split
     the stacked-sections view already computed — no new filtering
     logic, just a toggle over which of the two existing sections render.
  Tests: `deductionMutations.test.ts` (new) — exercises the REAL
  `cleanupOrphanedDocument()` against an in-memory fake Supabase client:
  a document with no remaining references gets both its row AND Storage
  object removed; a document still referenced by a deduction/settlement/
  maintenance_records row is untouched (row AND storage); a document
  with no `storage_path` skips the Storage call entirely. Required
  extending `fakeSupabase.ts`'s `.select()` to actually support
  `{count:'exact', head:true}` (previously a no-op — `count` was always
  `undefined`, which meant the 3 "still referenced" test cases silently
  passed for the wrong reason: `cleanupOrphanedDocument` was deleting
  referenced documents anyway, not correctly detecting them as
  referenced — caught by the new tests failing, not a pre-existing
  bug in the real function) and `.storage.from().remove()` (previously
  entirely absent), both now shared by every other test file that
  imports `fakeSupabase.ts`. Full suite: 67 suites / 1627 tests pass;
  `tsc --noEmit` clean; all 7 locales confirmed key-parity (`Settlement`
  correctly kept untranslated per the glossary's DO-NOT-TRANSLATE list
  in every locale's new `originFilterWithheld` string).
- FULL PARITY FOLLOW-UP, PART A — ONE REFRESH PATH (owner decision
  2026-08-05, web v2026.08.05-W chase). Web's `rAll()` was called in 19
  places but never DEFINED — every refresh silently threw, so editing
  the truck cost basis never moved CPM. Audited whether the mobile
  equivalent (`app/src/data/queryInvalidation.ts`'s
  `invalidateFinancialData()`) has the SAME class of gap: it does exist
  and IS wired into nearly every mutation-bearing screen already, but a
  grep audit of every `.mutateAsync(` call site under `app/(tabs)` found
  4 screens calling only a bare per-table entityHooks mutation (whose own
  `onSuccess` invalidates just `[table]` with the default `refetchType:
  'active'`, which skips any inactive/unmounted screen's own cached
  query) with NO broader invalidation at all: `trucks.tsx`,
  `equipment.tsx` (both feed the CPM "Why?" breakdown and the
  depreciation election, PARTS C/E below — this is the exact "truck cost
  basis doesn't move CPM" bug named in the prompt), `drivers.tsx`
  (feeds `sumDeductibleDriverPayroll()`, CLAUDE.md invariant #7, which
  Tax Estimator reads), and `compliance.tsx` (had a narrow one-off
  `compliance_items`-only invalidation in ONE handler, not the other
  three). All 4 now call `invalidateFinancialData(queryClient)` after
  every insert/update/delete/toggle, matching the convention every other
  screen already followed. `ceo-mode.tsx` was the only OTHER screen with
  zero `invalidateFinancialData` calls — audited and confirmed correct
  as-is: its one mutation (`useUpdateProfile()`) already invalidates its
  own `'profile'` key internally, no broader dependency exists.
  Tests: `queryInvalidation.test.ts` gained a dedicated "ONE REFRESH
  PATH" test pinning the exact query-key contract the prompt's four
  named mutation categories require — truck cost basis
  (`trucks`/`equipment`/`loans`), equity (`capital_transactions`/
  `capital-account-summary`/`profile`), miles (`settlements`), and
  categories (`deductions`/`user_categories`) must all appear in
  `invalidateFinancialData()`'s own invalidated-key list. A filesystem-
  scanning test (grepping every screen source file for the call) was
  considered and deliberately NOT added — inconsistent with this
  codebase's established "pure-function tests only" convention and
  fragile against refactors; the query-key contract test is the durable
  regression guard, the grep audit itself was a one-time manual sweep.
  Full suite: 67 suites / 1628 tests pass; `tsc --noEmit` clean.
- FULL PARITY FOLLOW-UP, PART B — CANONICAL MILES (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item B). Web computed miles
  as a raw `sum(settlements.miles)` independently in several places, with
  no dedup — a duplicate settlement week (two rows sharing the same
  truck+week_ending, structurally rare on mobile thanks to CLAUDE.md
  invariant #10's unique constraint, but real for any row saved before
  that constraint existed or a legacy-backup import) silently DOUBLED
  the miles total, which cascades into CPM/RPM being wrong by the same
  factor. `app/src/stats/miles.ts`'s `calcMiles(settlements, loads)` is
  now the ONE shared calculation: (1) dedupes by `${truck_id}|
  ${week_ending}` (NOT `week_ending` alone — a real multi-truck fleet
  routinely has every truck settle the same week, which must NOT be
  treated as a duplicate) keeping whichever duplicate has the higher
  reconciled total and counting the rest as `duplicateWeeksIgnored`; (2)
  per week, `totalMiles = MAX(the settlement's own printed total, that
  week's loads' loaded+empty sum)` — never SUMMED, which would double-
  count whichever source is more complete; loaded/empty stay exactly
  what the loads table says even when the settlement's own total wins
  (never inflated to force a match); (3) exposes `loadedMiles`/
  `emptyMiles`/`deadheadPct` (null, never NaN, when totalMiles is 0)
  aggregated across all weeks. `app/src/data/dashboardStats.ts`'s
  `computeFleetStats()`/`fetchFleetStats()`/`fetchDriverStats()` all now
  route through `calcMiles()` (fetching `loads` alongside settlements) —
  `FleetStats` gained `loadedMiles`/`emptyMiles`/`deadheadPct`/
  `duplicateWeeksIgnored`. `calcCpm()` itself is UNCHANGED (still divides
  by whatever total it's given — CLAUDE.md's existing CPM invariant that
  it divides by TOTAL miles, not loaded, is preserved); only the total
  fed into it is now the deduped/reconciled figure.
  MANUAL TOTAL OVERRIDE (spec item B.3, docs/PENDING_SQL.md §44 —
  `trucks.manual_total_miles_override numeric(12,2)`, NOT YET RUN as of
  this writing): an odometer/ELD-sourced total the user enters
  supersedes `calcMiles()`'s own calculated total for CPM/RPM purposes
  only — loaded/empty/deadhead% stay from the weekly calc regardless
  (an odometer reading has no loaded-vs-empty split of its own).
  `resolveMilesTotal(calculated, manualOverride)` (`miles.ts`) is the
  pure switch: a positive override wins, otherwise falls back to the
  calculated total, returning which `source` is active so the UI can
  label it. Wired into Scorecard (`app/(tabs)/more/scorecard.tsx`): a
  banner names the active source ("Using manual total: N mi (odometer/
  ELD)" vs. "Using settlements total: N mi") with a one-tap action to
  either open the override editor (`ModalSheet` + `Field`, saves via
  `useUpdateTruck()` then `refreshTrucks()` + `invalidateFinancialData()`
  so every screen reading `activeTruck` or truck-derived stats picks up
  the change) or revert to settlements (`handleUseSettlementsInstead()`,
  clears the column back to null). `canonicalCpm` recomputes from
  `resolveMilesTotal()`'s resolved total, not the raw calculated one.
  KNOWN LIMITATION, flagged not hidden: the override lives on the
  per-truck `trucks` row, but `useFleetStats()` is a fleet-wide (not
  per-truck) query — applying a single active truck's override to a
  fleet-wide total is only fully correct for the common single-truck
  case (CLAUDE.md invariant #7's "n=1 is just the default presentation"
  reasoning); a true multi-truck-aware override would need its own
  per-truck stats plumbing, deferred as a v1.x follow-up rather than
  silently claimed as fully correct for every fleet size.
  SETTLEMENTS SCREEN (spec item B.3's "inline miles input on each
  settlement row... plus a per-week editor"): the settlements list row
  now shows an amber "⚠️ Miles missing — tap to add" in place of the
  mileage figure whenever `x.miles` is falsy, and the settlement detail
  sheet's existing Miles field gained the same amber treatment plus
  inline editable input (`settlementsScreen.milesEditLabel`/
  `milesEditLabelMissing`/`milesSaveFailedTitle`, all 7 locales) —
  editing here writes directly to that settlement's own `miles` column
  (the per-week figure `calcMiles()` itself reads), not the truck-level
  manual override.
  DUPLICATE SURFACING (spec item B.4): Scorecard shows an orange "N
  duplicate settlement week(s) ignored — you may want to delete them"
  banner whenever `duplicateWeeksIgnored > 0`, directly under the KPI
  card.
  REVENUE/LOADED MILE (spec item B.2's "show revenue per total mile AND
  per loaded mile" — per-TOTAL-mile already existed as `revenuePerMile`,
  reading from the canonical CPM's own total): added as its own row,
  computed directly in the Scorecard screen component
  (`grossRevenue / loadedMiles`, only rendered when `loadedMiles > 0`) —
  deliberately NOT added inside `calcScorecard()` itself, which stays an
  untouched verbatim legacy `rScore()` port per this file's own standing
  rule.
  Tests: `src/stats/__tests__/miles.test.ts` (new, 11 tests) — MAX()
  reconciliation both directions, loaded/empty tracked independently,
  deadhead% including the null-on-zero case, multi-truck-same-week NOT
  deduped, same-truck-same-week duplicate correctly deduped (keeps the
  higher total), null `week_ending` skipped, multi-week summing, and
  every `resolveMilesTotal()` branch (null/undefined/manual/zero-or-
  negative-treated-as-unset). `src/data/__tests__/dashboardStats.test.ts`
  gained 3 tests: the loads pre-fetch shortcut (never re-queries `loads`
  when already passed), the fallback-fetch path, and an end-to-end
  duplicate-week dedup case seeding two same-truck-same-week settlement
  rows and asserting the returned `totalMiles`/`duplicateWeeksIgnored`/
  `cpm.costPerMile` all reflect the deduped figure, not a doubled one.
  Full suite: 68 suites / 1678 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (7 new `scorecard.*`/`settlementsScreen.*`
  keys, hi/uk as untranslated English copies per invariant #11).
- FULL PARITY FOLLOW-UP, PART C — CPM DONE THE WAY OWNER-OPERATORS DO IT
  (owner decision 2026-08-05, web v2026.08.05-W chase, spec item C).
  TRUCK COST BASIS (docs/PENDING_SQL.md §45, NOT YET RUN as of this
  writing — `trucks.cost_basis_ownership_mode` (`'paid'|'loan'|'lease'`),
  `cost_basis_loan_monthly_payment`, `cost_basis_paid_spread_months`,
  `cost_basis_warranty_cost`, `cost_basis_warranty_term_months`;
  `purchase_price` from docs/PENDING_SQL.md §36 is reused as-is for the
  'paid' mode's spread) replaces CPM's previous "sum every Loan Center
  row on the account and multiply by settlement count" approach — a
  synthetic estimate with no relationship to the ACTIVE truck's own
  financing that produced $8.48/mi on web (spec item C.2, "NEVER a
  synthetic loan estimate"). `app/src/stats/truckCostBasis.ts`'s
  `calcTruckCostBasisWeekly(truck, carrierAlreadyWithholdsLoanPayment)`
  is the one rule set: `lease` adds $0 (the settlement withholding
  already counts it — adding a second figure would double it); `loan`
  uses the FIXED `cost_basis_loan_monthly_payment` the owner enters once
  (never re-derived from a Loan Center schedule, which may not exist for
  this truck or may reflect a refinance this module can't reason about),
  skipped when the carrier already withholds it; `paid` spreads
  `purchase_price / cost_basis_paid_spread_months`. An extended warranty
  (`cost_basis_warranty_cost / cost_basis_warranty_term_months`) is a
  separate fixed cost added on top of whichever mode applies. Editable on
  the Trucks screen's existing add/edit form, right under Purchase &
  Financing — an unconfigured truck (`cost_basis_ownership_mode` null)
  contributes exactly $0, never a guess, with a "not set" prompt in the
  CPM "Why?" breakdown (below) rather than silently assuming zero fixed
  cost is correct.
  FIXED vs VARIABLE (spec item C.3): `app/src/stats/cpm.ts`'s
  `CanonicalCpmResult` gained `fixedTotal`/`variableTotal`/
  `fixedCostPerMile`/`variableCostPerMile`, and every `CpmBucket` now
  carries its own `type: 'fixed'|'variable'`
  (`CPM_BUCKET_TYPE` — Insurance/Permits/ELD & Software/Dues/Professional
  Services/Loan-Lease Payment are fixed; Fuel/Maintenance/Tolls/Parking &
  Lodging/Dispatch & Factoring/Driver Pay are variable; an unmapped
  category defaults to variable, the safer assumption for "how much does
  one more mile cost"). Scorecard shows this as one line: "Variable
  $X/mi adds cash today. Total $Y/mi covers everything"
  (`scorecard.fixedVariableSummary`).
  EXCLUDED ONE-OFFS (spec item C.2's "exclude multi-year one-offs and
  vehicle purchases from per-mile while keeping them as expenses/
  assets"): `calcCanonicalCpm()` now excludes (a) any deduction category
  `'Major Repairs & Overhauls'` (the existing >$2,500 major-component
  threshold from the category-taxonomy pass) and (b) any deduction whose
  description matches `app/src/import/category.ts`'s new
  `isVehiclePurchaseOneOff()` (down payment/truck-trailer-tractor-vehicle
  purchase phrasing — covers a purchase logged as a plain deduction
  instead of via `trucks.purchase_price`) from the per-mile figure
  ENTIRELY — a five-figure one-time cost divided across one week's miles
  would spike CPM to something meaningless. These rows are NEVER excluded
  from P&L/tax/true-profit — this function doesn't touch those totals —
  only from CPM's own per-mile math. Returned as `excludedOneOffs:
  {description, amount, reason}[]`, kept deliberately separate from the
  pre-existing `excludedTotal` (Meals/Advance Repayment/Escrow — non-
  expenses, not one-offs) so the Why? breakdown can label each correctly.
  WARNINGS (spec item C.4's "warn when CPM > $4 or miles missing"):
  Scorecard shows a red banner when `costPerMile > 4`
  (`scorecard.cpmTooHighWarning`) and an orange one when
  `statsQuery.data.totalMiles <= 0` (`scorecard.milesMissingWarning`).
  "WHY?" BREAKDOWN (spec item C.4's "keep the card clean, full breakdown
  behind a 'Why?' action"): the KPI card's Cost/Mile row now shows a
  small "Why?" link instead of an always-visible bucket list (the
  previous pass's inline `cpmBreakdownTitle` Card was removed). Opens a
  `ModalSheet` with: total/loaded/empty miles + deadhead % (from
  `calcMiles()`, PART B); RPM/PPM; every cost bucket with its per-mile
  share and fixed/variable tag; fixed vs. variable subtotals; "how your
  fixed truck cost was spread" (the truck cost basis's own ownership
  mode + weekly truck payment + weekly warranty, or a "not set" prompt
  linking to the Trucks screen); the excluded-one-offs list with an
  explanatory note; the pre-existing excluded (meals/advances/escrow)
  total; and — spec item C.4's own explicit ask — every settlement with
  revenue but no miles, each with an inline miles `Field` + Save button
  wired to the same `useUpdateSettlement()`/`invalidateFinancialData()`
  pattern as Settlements' own inline editing (PART B), reachable right
  from the breakdown that's actually affected by the gap instead of only
  from the Settlements screen.
  Tests: `src/stats/__tests__/truckCostBasis.test.ts` (new, 8 tests) —
  unconfigured/lease/loan/paid modes, the loan-skip-when-withheld guard,
  a zero-months divide-by-zero guard, warranty as an additive fixed cost,
  and the weeklyFixedTotal sum. `src/stats/__tests__/cpm.test.ts` gained
  5 tests — the fixed/variable split, a truck-cost-basis payment
  classified fixed, a Major Repairs & Overhauls one-off excluded from
  cost/mile while listed separately, and a vehicle-purchase-shaped
  deduction (e.g. "Truck down payment") excluded the same way.
  Full suite: 69 suites / 1720 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (new `scorecard.why*`/`scorecard.cpmType.*`/
  `scorecard.ownershipMode.*` and `trucks.costBasis*`/
  `trucks.ownershipMode.*` keys, hi/uk as untranslated English copies).
- FULL PARITY FOLLOW-UP, PART D — EXPENSE TOTAL EXPLAINER (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item D). Tapping Home's
  "Expenses" tile (the Revenue/Expenses/Net Profit trio, DASHBOARD
  SIMPLIFICATION above) used to just navigate to Deductions — it now
  opens a breakdown in place, via `app/src/stats/expenseTotalExplainer.ts`'s
  `buildExpenseTotalExplainer()`: total/fixed/variable (reusing CPM's own
  `bucketFor()`/`typeFor()`, now exported from `src/stats/cpm.ts`, so the
  Explainer and the CPM "Why?" breakdown, PART C, can never disagree about
  what counts as fixed vs. variable) plus the 12 largest rows for the
  SAME week window the tile's own number already covers
  (`buildWeeklyRevenueExpenseTrend()`'s `weekStartFromEnding()` boundary,
  now exported from `src/stats/cashFlowTrend.ts`) — so the breakdown's
  total always matches the tile exactly, never a second, slightly-
  different figure. Any row over 15% of the (included) total is flagged
  "possible depreciable asset — check with your CPA"
  (`isPossibleDepreciableAsset`, informational only, never reclassifies
  or excludes the row on that basis). A vehicle-purchase-shaped
  description (`app/src/import/category.ts`'s `isVehiclePurchaseOneOff()`,
  introduced in PART C) is auto-excluded from the total/buckets/largest-
  rows list entirely — the same "capital purchase, not an operating
  expense, still counted in P&L/tax" principle as CPM's own exclusion —
  with the excluded amount shown as its own informational line rather
  than silently vanishing. Each of the 12 rows has a 🗑️ delete action
  right in the breakdown (spec item D's "12 largest DELETABLE rows"),
  reusing the exact same confirm-then-delete pattern Deductions' own
  screen uses (`deductions.deleteConfirmTitle`/`deleteConfirmBody`,
  `cleanupOrphanedDocument()` for a linked document, the DB's `on delete
  cascade` for a linked capital contribution per CLAUDE.md invariant #5)
  so deleting from Home behaves identically to deleting from Deductions,
  not a second, thinner delete path.
  Tests: `src/stats/__tests__/expenseTotalExplainer.test.ts` (new, 5
  tests) — the fixed/variable split, the top-12 cap and descending sort,
  the >15% depreciable-asset flag (plus a 0-total divide-by-zero guard),
  and the vehicle-purchase auto-exclusion (from the total, the buckets,
  AND the largest-rows list).
  Full suite: 70 suites / 1725 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`dashboard.expenseExplainer.*`, hi/uk as
  untranslated English copies per invariant #11).
- FULL PARITY FOLLOW-UP, PART E — DEPRECIATION ELECTION (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item E). Purchased trucks/
  trailers only. `app/src/tax/depreciation.ts`'s `calcCurrentYearDepreciation()`
  computes ONE tax year's depreciation expense from an owner's election:
  method `'full'` (Section 179/bonus — 100% expensed in the placed-in-
  service year, $0 every year after), `'macrs'` (IRS Pub. 946 half-year-
  convention percentages — tractor 3-year property `33.33/44.45/14.81/
  7.41`, trailer 5-year property `20/32/19.2/11.52/11.52/5.76`, applied
  by recovery year, $0 once the table is exhausted), `'spread'` (straight
  line over the owner's own chosen number of years, defaulting to 5 when
  unset), or `'ask'` (defers to the CPA — $0 in the estimate, flagged
  with `requiresCpaNote` rather than guessing a method on the owner's
  behalf). A truck whose `cost_basis_ownership_mode` (PART C) is
  `'lease'` skips entirely (`skippedAsLease: true`) — the owner doesn't
  own a leased truck, so it's never depreciable, regardless of any other
  field. An unconfigured asset (no method, no purchase price, or no year
  placed in service) contributes exactly $0 with `isConfigured: false`
  — never a guess. THE MACRS PERCENTAGE TABLES ARE HARDCODED, not sourced
  from `tax_year_data` — a deliberate, documented exception to CLAUDE.md
  invariant #6: they're fixed by IRC §168/Pub. 946 structure and do NOT
  change per tax year (unlike brackets/SE-tax rate/per diem, which DO and
  which invariant #6 requires sourcing server-side) — same "fixed by IRS
  form/code structure, not an annually-published figure" precedent
  already established by `app/src/import/category.ts`'s `SCHEDULE_C_LINE`
  mapping. Deliberately kept SEPARATE from PART C's `truckCostBasis.ts`
  "economic monthly spread" (a paid-off truck's CPM/per-mile cost TODAY)
  — the two numbers answer different questions and must never be
  confused or summed together.
  `docs/PENDING_SQL.md` §46 (NOT YET RUN as of this writing) adds
  `trucks.depreciation_method`/`depreciation_year_placed_in_service`/
  `depreciation_spread_years` (tractor) and the `trailer_`-prefixed
  equivalents (independent of the tractor's own election, same "trailer
  financing is independent of its tractor's" pattern as CLAUDE.md
  invariant #25). `sumFleetDepreciation()` sums current-year depreciation
  across every truck AND its own trailer (via `useTrucksList()`, which —
  unlike `useActiveTruck()` — includes retired trucks too, since a
  retired-but-still-owned truck can still generate a real depreciation
  deduction).
  TAX ESTIMATE WIRING: `app/src/data/taxEstimate.ts`'s `useTaxEstimate()`
  now subtracts `depreciationTotal` from net profit BEFORE calling
  `calcTaxEstimate()` (that function itself, a verbatim legacy port, is
  UNCHANGED) and exposes `depreciationTotal`/`depreciationRequiresCpaNote`/
  `netProfitBeforeDepreciation` in its bundle so the Tax Estimator screen
  can show depreciation as its own visible line (spec item E's explicit
  ask) rather than silently folding it into net profit: "Net Profit
  (before depreciation)" → "Depreciation: -$X" → the existing "Net
  Profit" row (now the post-depreciation figure, unchanged formula/
  position) — only rendered when `depreciationTotal > 0`, so an account
  with no purchased/configured trucks sees zero change to this screen. An
  orange CPA-decision note appears below the breakdown whenever any asset
  is set to `'ask'`.
  TRUCKS SCREEN: a new "Depreciation Election (tax)" section (tractor)
  and, only when a trailer purchase price is entered, a second "Trailer
  Depreciation Election (tax)" section — 4-pill method picker, year-
  placed-in-service field (hidden for 'ask'), spread-years field (only
  for 'spread'), and a "not set" prompt (amber) whenever no method is
  chosen yet, exactly matching PART C's Cost Basis section's own "not
  set" convention. When the tractor's cost-basis ownership mode is
  'lease', the whole depreciation picker is replaced by a plain
  "Leased — depreciation doesn't apply" note instead of showing controls
  that would have no effect.
  GLOSSARY: `MACRS` and `Section 179` added to `docs/I18N_GLOSSARY.md`'s
  DO-NOT-TRANSLATE list and `glossary.test.ts`'s `GLOSSARY_TERMS` — both
  are IRS-specific terms with no natural translation, same rationale as
  every other glossary entry. Catching this ALSO caught a pre-existing,
  unrelated miss: the Accountant Package's `capitalAssetsNote` string
  (from an earlier pass) already used "Section 179" in `en.json` but
  Spanish had translated it to "la Sección 179" — fixed as part of this
  pass's glossary addition, confirming the glossary test's own value
  (a term added for a NEW feature caught an OLD, previously-unenforced
  drift).
  Tests: `src/tax/__tests__/depreciation.test.ts` (new, 14 tests) — every
  method's math (full/macrs both tables/spread with and without an
  explicit year count/ask), the lease skip, the not-yet-placed-in-service
  $0 case, the unconfigured-$0 case, and `sumFleetDepreciation()`'s
  tractor+trailer independence (including a leased tractor with a
  purchased trailer depreciating only the trailer) and CPA-note
  aggregation. Full suite: 71 suites / 1757 tests pass; `tsc --noEmit`
  clean; all 7 locales confirmed key-parity, including the newly-enforced
  MACRS/Section 179 glossary terms.
- FULL PARITY FOLLOW-UP, PART F — CAPITAL ACCOUNT "DATA-LOSS BUG" AUDIT
  (owner decision 2026-08-05, web v2026.08.05-W chase, spec item F,
  flagged by the owner as the highest-priority item in this pass). Full
  re-audit of every mechanism that can remove a `capital_transactions`
  row, specifically checking for the web app's reported failure class: an
  "orphan cleanup" sweep that scans existing rows and deletes ones that
  merely LOOK orphaned (wrong on this app's data model, since a manual
  cash contribution has no deduction to be orphaned FROM in the first
  place — it would be silently swept up as a false positive).
  **Confirmed this codebase has no such sweep, and cannot grow one by
  accident**: there is exactly ONE way a row disappears without an
  explicit user tap — the DB's own `linked_deduction_id ... on delete
  cascade` FK (`docs/SCHEMA.sql`) — which by construction can only ever
  fire for a LINKED row whose OWN deduction was deleted; a manual row's
  `linked_deduction_id` is always `NULL`, so no FK on earth points at it.
  The one app-level removal path, `deductionMutations.ts`'s
  `applyContributionSync()`'s `'remove'` action, deletes by an EXACT id
  already resolved via `fetchLinkedContributionId(userId, deductionId)`
  (an exact `linked_deduction_id` match) — never a scan-and-guess. There
  is no orphan-EXISTENCE-check-then-delete pattern anywhere for
  `capital_transactions` (unlike `deductionMutations.ts`'s own
  `cleanupOrphanedDocument()`, which IS that pattern, but for `documents`/
  Storage, a completely different table with no such invariant to
  protect). `app/src/data/legacyImport/importLegacyBackup.ts`'s own
  header comment already documented this exact conclusion from a prior
  pass ("Remove orphaned contributions... structurally impossible here").
  Every OTHER spec item F sub-point was independently verified as ALREADY
  implemented by the immediately-preceding "FULL PARITY WITH WEB
  v2026.08.05-K, PART E" pass (above): no double-counting cash+linked
  (`summarizeContributions()` sums the two buckets separately, never
  both), no hidden base constant (`calcCapitalAccount()`'s
  `effectiveContribution = initialCapital + totalContributions`, no
  seeded figure), the "remove duplicate entries" action and the "cash
  transfers $X (n) · paid personally $Y (m)" breakdown line both already
  ship on the Capital Account screen, `taxFreeRemaining` is already
  live/unclamped/red-when-negative, and equity already moves
  `business_balance` via the tracked, reversible
  `business_balance_applied` delta (`useRecordManualCapitalTransaction`/
  `useDeleteManualCapitalTransaction`, `app/src/data/capitalTransactions.ts`)
  — confirmed this flows to Home/Cash Flow (both read
  `useCapitalAccountSummary()`, which reads `profiles.business_balance`,
  invalidated via the same `invalidateFinancialData()`/`'profile'` key
  every mutation here already calls) and that the tax estimate is
  provably unaffected (`calcTaxEstimate()`'s own input signature has no
  capital-account field at all — verified again by reading
  `app/src/data/taxEstimate.ts` fresh, not just trusting the prior pass's
  claim). No "explicit idempotent restore" action was added, because
  there is no wrongful-deletion path for it to restore FROM — the
  existing "➕ Record Contribution" button already IS the explicit,
  non-magical way to add equity back if a user made a manual entry
  mistake, and adding a second "restore" mechanism on top would be the
  kind of magic-auto-reseed the spec's own point (1) explicitly warns
  against ("never auto-seed equity").
  The ONE real, if narrow, gap this audit found: `applyContributionSync()`'s
  `'remove'` action had a single-row test proving it deletes the intended
  row, but nothing proving it LEAVES OTHER ROWS ALONE — the exact
  property this whole audit is about. Fixed by extending
  `src/data/__tests__/deductionMutations.test.ts` with a 3-row scenario
  (two different deductions' own linked contributions + one manual cash
  contribution) proving that removing ONE deduction's sync plan deletes
  only that one linked row, leaving the other deduction's linked
  contribution AND the manual contribution both untouched.
  Full suite: 71 suites / 1758 tests pass; `tsc --noEmit` clean.
- FULL PARITY FOLLOW-UP, PART G — CATEGORY LEARNING LAYER (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item G). Every manual
  re-categorization of a deduction now teaches a normalized keyword→
  category rule, per user (`category_learning_rules`, docs/PENDING_SQL.md
  §47, NOT YET RUN as of this writing). `app/src/import/categoryLearning.ts`
  is the one pure module: `normalizeKeyword()` takes the first 3
  significant, non-stopword, non-numeric-only tokens of a description
  (e.g. "AMAZON.COM ORDER #123-4567" → "amazon com order") — deliberately
  dropping the numeric order-id suffix so the SAME vendor across many
  receipts keeps matching even though the trailing digits differ every
  time. `matchLearnedCategory()` is FUZZY (spec's own word): exact/
  substring match first (the common, fast path), then a word-level
  Levenshtein-distance fallback (within 25% of the longer string) for
  typo/OCR-damaged vendor names. `applyLearnedCategories()` is applied
  to a batch of mapped deduction rows BEFORE they're saved — spec's
  "applied before the built-in guesser" — a learned rule wins over
  whatever the AI/`guessCategory()` fallback already assigned, since it
  represents the user's own explicit, repeated correction; the one
  exception is the generic-fallback docType's `categoryOverride` (the
  NEEDS-REVIEW confirm flow, CLAUDE.md invariant #14) — an even more
  explicit, just-given signal that a learned rule never overrides.
  **Where a rule gets taught**: `app/src/data/categoryLearningRules.ts`'s
  `useLearnCategoryCorrection()` — called (best-effort, `.mutate()` not
  awaited, never blocks the actual save) from both places a user can
  hand-edit a deduction's category: `deductions.tsx`'s edit-save handler
  and `accountant-package.tsx`'s category-picker save handler — ONLY when
  the new category genuinely differs from what was already there (not a
  re-save of the same value). Upserts on `(user_id, keyword)`: correcting
  the same vendor again overwrites the category (most recent correction
  wins) and bumps `hit_count`, never creates a duplicate row.
  **Where a rule gets applied at import time**: `app/src/data/aiImportSave.ts`'s
  `saveExtraction()` fetches the user's rules ONCE (`fetchLearningRules()`,
  wrapped in try/catch defaulting to `[]` — this feature must never be
  able to BREAK an import, including before §47 has been run and the
  table doesn't exist yet) and applies them to all three
  deduction-producing paths: the settlement's own `mapping.deductions`
  batch, each purchase line item (`mapPurchase()`'s output), and the
  generic-fallback single row.
  **Prompt-context only, never training** (spec's own explicit
  requirement, stated plainly in the viewer UI too): the same rules are
  also forwarded to `ai-import` as a "USER CORRECTIONS" text block
  appended to the extraction prompt (`app/src/data/aiImportCall.ts`'s
  `callAiImport()` gained a `learningRules` param threaded the identical
  way `customCategories` already was;
  `supabase/functions/ai-import/index.ts`'s `buildExtractionPrompt()`
  appends `USER CORRECTIONS (...): "keyword" -> category; ...` right
  after the existing custom-categories block) — capped at 30 rules
  client-side (`buildUserCorrectionsPromptText()`, unused server-side
  since the server just joins whatever array it receives, but kept as
  the one shared cap definition) to keep the prompt bounded for a
  long-time user. This is PLAIN TEXT PROMPT CONTEXT for that one request
  only — no fine-tuning, no persistent model change, exactly like every
  other `APPROVED ADDITION` block in that prompt.
  **Viewer** (`app/(tabs)/more/category-learning.tsx`, wired into
  `navRegistry.ts`'s `tools` group — one shared registry edit, same NAV
  PARITY pattern as every other route): lists every rule (keyword →
  category, correction count), per-row delete, and a "Clear All" action.
  A permanent note states plainly: "This only adjusts the hints sent
  along with your own future imports — the AI model itself is never
  trained or fine-tuned on your data."
  **Wired into the standing 4-point new-table checklist** (Reset All
  Data's `TABLES_IN_DELETION_ORDER`, Delete Account's same list,
  `queryInvalidation.ts`'s `AFFECTED_TABLES`, `exportAllData.ts`'s
  `EXPORT_TABLES` — the exact "a new table wired into Reset but not
  invalidation" bug class CLAUDE.md's own PRE-LAUNCH HARDENING pass
  found and fixed for `equipment`) — `category_learning_rules` was added
  to all four in this same change, right alongside `user_categories`,
  which every one of those four lists already had.
  Tests: `src/import/__tests__/categoryLearning.test.ts` (new, 15 tests)
  — `normalizeKeyword()`'s tokenization/stopword/numeric-stripping/cap
  behavior, `matchLearnedCategory()`'s exact/substring/fuzzy-typo/
  no-match cases, `applyLearnedCategories()`'s override/pass-through
  behavior, and `buildUserCorrectionsPromptText()`'s formatting/30-rule
  cap. Full suite: 72 suites / 1773 tests pass; `tsc --noEmit` clean; all
  7 locales confirmed key-parity (`nav.categoryLearning`/
  `categoryLearning.*` keys, hi/uk as untranslated English copies).
- FULL PARITY FOLLOW-UP, PART H — SMALLER FIXES (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item H). Two real items;
  every other sub-point was confirmed already shipped by prior passes
  (the settlement-line classifier, zero-cost-row skipping, Mark-as-Done's
  cost-prompt wording, bold category headers + truck identifier in the
  Accountant Package header/exports, the per-diem month+YTD block, the
  Lumper Fees table above expenses, and the year selector — all already
  covered by the FULL PARITY pass's own PART A/B/C/D entries above, no
  further change needed).
  1. **MISC CONCENTRATION WARNING (spec H.1)**:
     `app/src/stats/accountantPackage.ts`'s `checkMiscConcentration()` —
     pure, takes the already-computed `ScheduleCLineTotal[]` (never
     re-derives a total independently, so it can't disagree with what the
     screen already shows) and flags when the "Misc" bucket exceeds 20%
     of the period's grand total, returning `null` (never a false
     positive) when there's no Misc bucket or the grand total is 0.
     Informational only — never blocks Save/export. Shown on the
     Accountant Package screen (amber `Card`, same treatment as the
     existing implausible-date warning) AND in both PDF/Excel exports
     (`buildReportHtml()`, right after the implausible-date warning
     block) so a CPA opening the exported file sees the same signal the
     owner saw in-app.
  2. **AI-IMPORT IDENTITY AUDIT (spec H.7)**: re-verified end to end,
     confirmed ALREADY FIXED by an earlier pass (owner decision
     2026-07-09, PRODUCT DECISION — predates this FOLLOW-UP spec by
     nearly a month). `supabase/functions/ai-import/index.ts`'s raw
     `LEGACY_EXTRACTION_PROMPT` constant still CONTAINS the literal
     "Graywolf Logistics LLC (Ali Bozkurt, Prime Inc. owner-operator,
     Unit 830157)" / "Ali Bozkurt is OTR truck driver..." text — but only
     as the exact-match anchor for two `.replace()` patches
     (`IDENTITY_LINE_BEFORE`/`AFTER`, `OTR_RULE_BEFORE`/`AFTER`) already
     wired into `buildExtractionPrompt()`'s replace chain; the ACTUAL
     prompt text sent to Anthropic on every request already reads
     "Parse this document for an owner-operator trucking business" /
     "the user is an OTR truck driver" — fully generic, no leak. Grepped
     the entire `supabase/functions/` and `app/src/` trees for
     "Graywolf"/"Ali Bozkurt"/"830157"/"Bozkurt Fleet OS" (as a hardcoded
     VALUE, not the product brand — which CLAUDE.md's own top rule
     explicitly allows) beyond this one already-patched spot and found
     none — every other hit was either a test fixture's arbitrary sample
     value (`Prime Inc.`/`830157` as a plausible carrier/unit number in
     `chunking.test.ts`/`storagePath.test.ts`/`truckMatch.test.ts`, no
     different from using any other placeholder) or a comment documenting
     that THIS app deliberately does NOT do what legacy did
     (`ai-advisor/index.ts`'s own header comment). No code change was
     needed for this item — the web app's reported bug does not exist on
     mobile, confirmed by reading the actual code path, not assumed.
  Tests: `src/stats/__tests__/accountantPackage.test.ts` gained a
  `checkMiscConcentration` describe block (4 tests — over/at-threshold,
  no-Misc-bucket, zero-total divide-by-zero guard). Full suite: 72
  suites / 1777 tests pass; `tsc --noEmit` clean; all 7 locales confirmed
  key-parity (`accountantPackage.miscConcentrationWarning`, "Misc" kept
  untranslated as a domain category name per invariant #11).
- FULL PARITY FOLLOW-UP, PART J — SUPPORT EMAIL (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item J).
  `app/src/brand.ts` gained `SUPPORT_EMAIL = 'bozkatruckingai@gmail.com'`
  — a dedicated product support address, deliberately never the owner's
  own personal email, the same identity-separation principle as
  CLAUDE.md's very first invariant (this is a clean multi-tenant
  product). `app/src/lib/supportEmail.ts`'s `buildSupportMailtoUrl()` is
  the one shared `mailto:` builder every touch point below uses — a
  plain `Linking.openURL('mailto:...')` call (react-native's own API,
  already proven elsewhere in this app for the share-card deep link, per
  `useShareCapture.ts`) rather than adding a new native dependency like
  `expo-mail-composer` (so this ships via a normal EAS Update, no new
  build required). The body always includes build version/EAS update id/
  commit hash (`app/src/lib/buildInfo.ts`'s existing `getBuildInfo()`,
  same module Settings' footer and the crash screen already read from)
  and platform (`Platform.OS`) — optionally a user id and/or screen name/
  error message depending on the caller — and NEVER any financial data
  (settlements, deductions, balances, tax figures); there is no code path
  in `buildSupportMailtoUrl()` that could even reach a financial value,
  since its input type only has build/platform/user/screen/error fields.
  **Settings** (`app/(tabs)/more/settings.tsx`): new "Support" section
  (right after Legal) with "Contact Support" and "Report a Problem"
  buttons — both open the same mailto builder with a different subject
  line, including the signed-in user's own id (in scope here via
  `session?.user.id`). A caught `Linking.openURL()` failure (no mail app
  configured) falls back to an `Alert` naming `SUPPORT_EMAIL` directly so
  the user isn't stuck with a silently-failed tap.
  **Crash screen** (`app/src/components/ScreenErrorBoundary.tsx`): gained
  an "Email This Error" button next to the existing "Copy Details" one,
  via a new required `emailLabel` prop (this is a class component with no
  hook access, so labels are always caller-supplied, same pattern as
  `title`/`copyLabel`/`copiedLabel`) — sends screen name + error message +
  build info + platform, no user id (this component has no
  `AuthContext`/`session` access, confirmed by reading its `Props`/class
  body — a future caller could thread one through as an additional prop
  if ever needed). AUDIT NOTE, honestly flagged rather than silently
  assumed: a repo-wide grep found `ScreenErrorBoundary` is not currently
  wrapped around ANY live screen (its own header comment already says it
  was built for the now-deleted Customize Dashboard screen and kept as "a
  reusable, generic safety net" for later use) — this pass still updates
  the component correctly since CLAUDE.md's own convention is to keep it
  ready for the next screen that needs it, but the button has no current
  way to actually be seen by a user until some screen adopts the
  boundary.
  **Terms of Use / Privacy Policy**: both the source docs
  (`docs/TERMS_OF_USE_DRAFT.md` §12, `docs/PRIVACY_POLICY_DRAFT.md` §8)
  and the LIVE in-app text (`app/src/config/termsOfUse.ts`'s `TOS_BODY`
  gained a new "11. Contact" section it didn't have before at all;
  `app/src/config/privacyPolicy.ts`'s `PRIVACY_BODY` had its existing "8.
  Contact" placeholder filled via `${SUPPORT_EMAIL}` template
  interpolation) now name `SUPPORT_EMAIL` — replacing
  `TERMS_OF_USE_DRAFT.md`'s own placeholder, which had literally
  suggested the owner's personal `graywolflogistics@myyahoo.com` as an
  example, exactly the kind of identity leak this pass is about
  eliminating. Both stay marked "final formal legal-notice address
  pending attorney review" — filling in a real support inbox is not the
  same as attorney sign-off on the surrounding legal text, which these
  drafts still require before anything here is publishable (unchanged
  from before this pass). `TOS_VERSION` was deliberately NOT bumped — a
  contact-email addition isn't a substantive change to what a user
  agreed to, so it shouldn't force an unnecessary re-acceptance prompt
  (CLAUDE.md invariant #8's re-prompt-on-version-change mechanism is for
  real Terms changes).
  **Custom SMTP steps** (spec's own explicit ask, an operator/dashboard
  task, not a code change): documented as a new section in
  `docs/ADMIN_RUNBOOK.md` ("Custom SMTP") — exact Supabase Dashboard path
  (Project Settings → Authentication → SMTP Settings), what to configure
  (sender email/name, host/port/credentials from a provider), the
  recommendation to use a real transactional-email provider (Resend/
  Postmark/SendGrid) rather than raw consumer Gmail SMTP once volume
  grows (Google throttles/flags automated sends from a free Gmail
  account), and the explicit confirmation that no app code change is
  required for any of it (Supabase Auth is what sends these emails, the
  app only ever triggers them via `supabase.auth.*` calls).
  Tests: `src/lib/__tests__/supportEmail.test.ts` (new, 5 tests) —
  targets `SUPPORT_EMAIL`, includes subject/build-info/platform, includes
  the user id only when provided, includes screen/error only when
  provided (the crash-report shape), and a dedicated proof the body never
  contains anything dollar-figure-shaped. Full suite: 73 suites / 1782
  tests pass; `tsc --noEmit` clean; all 7 locales confirmed key-parity
  (`settings.support*`/`settings.contactSupportButton`/
  `settings.reportProblemButton`/`settings.noMailApp*`, hi/uk as
  untranslated English copies per invariant #11).
- FULL PARITY FOLLOW-UP, PART I — FIRST-RUN TUTORIAL (owner decision
  2026-08-05, web v2026.08.05-W chase, spec item I). A 6-slide illustrated
  walkthrough — Snap it · AI reads it · You confirm · It lands everywhere
  · Your documents are kept · Ready for your accountant — shown once,
  gated between ToS acceptance and the onboarding wizard, and replayable
  any time from Settings > "How It Works" and the Import screen's empty-
  state "See how" link.
  **Gating**: `docs/PENDING_SQL.md` §48 (NOT YET RUN as of this writing)
  adds `profiles.tutorial_seen_at` (null = never seen, same "set once,
  never reset" pattern as `onboarding_completed_at`, §28).
  `AuthContext.tsx` gained `needsTutorial` (true once `!needsTos` and the
  column is null) and `needsOnboarding` now ALSO requires `!needsTutorial`
  — the tutorial must clear before onboarding ever shows, matching the
  spec's own explicit ordering. `app/src/navigation/rootRedirect.ts`'s
  pure gate function (`resolveRootRedirect()`) got a new priority rung
  slotted between the existing `tos`/`onboarding` lines: `needsTos` →
  `needsTutorial` → `needsOnboarding` → `(tabs)`. `app/app/_layout.tsx`
  registers the new `tutorial` Stack.Screen and threads `needsTutorial`
  into the redirect effect, same pattern as every other gated screen.
  **Screen** (`app/app/tutorial.tsx`): reads an optional `?replay=true`
  param. First-run (no param): finishing (Skip or reaching the last
  slide's Done) marks `tutorial_seen_at` then explicitly
  `router.replace('/onboarding')` — same explicit-navigate pattern as
  `onboarding.tsx`'s own `finishOnboarding()`, chosen over relying on the
  root-redirect effect to notice the profile change (faster, no extra
  render flash); the profile write is best-effort (a failure just means
  the tutorial shows again next launch, never worth blocking the user
  over). Replay (`?replay=true`): finishing just calls `router.back()`
  and never touches `tutorial_seen_at` again.
  **Pager** (`app/src/components/TutorialPager.tsx`): the ONE shared
  component every entry point renders — a plain horizontal
  `ScrollView` with `pagingEnabled` (native swipe support, no gesture
  library needed), dot indicators (tappable to jump), a "Skip" link
  top-right, and a bottom Next/Done `PrimaryButton`. REDUCED-MOTION-SAFE
  BY CONSTRUCTION: there is no `Animated`/`Reanimated`/autoplay anywhere
  in this component — every page transition is 100% user-driven (a swipe
  or a tap), so there's no auto-advancing motion an OS "reduce motion"
  setting would ever need to suppress. PHONE+TABLET: slide width comes
  from `onLayout` (never a hardcoded pixel value), so it scales cleanly
  to any screen size; the illustration itself is capped at
  `min(220, width * 0.55)` so it never grows absurdly large on a tablet.
  **Visuals** (`app/src/onboarding/slideVisuals.tsx`): ONE registry
  (`SLIDE_VISUALS`, slide id → component) — today every slide renders an
  in-app `react-native-svg` line-art scene (no new native dependency,
  works offline, zero asset weight). `app/assets/tour/README.md`
  documents the exact future PNG filenames (`tour-01-snap.png` ...
  `tour-06-report.png`) a future pass would drop in to upgrade to real
  illustrated artwork — the registry is the ONE place that swap would
  happen; the pager and every entry point read through it and would
  never need to change.
  **Content** (`app/src/onboarding/tutorialSlides.ts`): the ONE shared
  slide list (id + title/body i18n keys) every entry point reads from —
  first-run and every replay path render byte-identical content, can
  never drift apart.
  **Reset All Data**: `tutorial_seen_at` was deliberately left OUT of
  `reset-data`'s `PROFILE_DATA_RESET` field list — same KEPT bucket as
  `onboarding_completed_at` (CLAUDE.md invariant #24) — an explicit
  decision, not an oversight the way `dashboard_layout` was originally
  missed: a user resetting their business data shouldn't be forced to
  re-watch the tutorial any more than they should be forced back through
  the onboarding wizard.
  **Scope decision on "every major empty state"**: wired into the two
  entry points the spec names explicitly (Settings, Import's empty
  state) — Import is the highest-value placement since it's literally
  where the "snap it" flow the tutorial explains begins. Other empty
  states (Documents, Settlements, Deductions, ...) render through a
  shared list component (`MonthGroupedList`) whose `emptyLabel` prop is
  plain text with no slot for an inline link — extending that component's
  API for this was judged out of scope for this pass and is flagged here
  as a deliberate, not silent, scope limit rather than claimed as full
  coverage.
  Tests: `src/onboarding/__tests__/tutorialSlides.test.ts` (new, 4
  tests) — exact 6-slide count/order/id-uniqueness/non-empty-keys, plus
  `tutorialSlideIndex()`'s lookup. `src/navigation/__tests__/
  rootRedirect.test.ts` gained 2 new tests (the tutorial gate fires, and
  it blocks the onboarding gate from firing even when both are
  incomplete) plus updated the "fully-cleared" sweep to include the new
  `tutorial` segment. `jest.config.js`'s `testMatch` gained
  `src/onboarding/**/*.test.ts` (a new source directory, previously
  unlisted — would have silently collected 0 tests otherwise). Full
  suite: 74 suites / 1806 tests pass; `tsc --noEmit` clean; all 7 locales
  confirmed key-parity (`tutorial.*` — Settings' "How It Works" button
  and Import's "See how" link both read `tutorial.howItWorksButton`/
  `tutorial.seeHowLink` directly rather than duplicating a second key,
  hi/uk as untranslated English copies per invariant #11; "Schedule C"
  correctly kept untranslated in the final slide's body per the
  glossary).
- IMPORT SAVE BUG FIX — empty-string dates/numerics never reach the
  database (owner decision 2026-08-23, device evidence: "Failed while
  saving loads/fuel/deductions — invalid input syntax for type date:
  \"\"" from the step-tagged error UI). Root cause: every AI-extracted
  field in `app/src/import/types.ts`'s `Extraction` type is typed as
  optional `string` (never `string | null`), so the model can return a
  key with an EMPTY-STRING value rather than omitting it; several date/
  numeric fallback chains across `mapExtraction.ts`/`aiImportSave.ts`
  used `??` (nullish coalescing), which only treats `null`/`undefined`
  as "absent" — a present-but-empty `''` sailed straight through to a
  Postgres `date`/`numeric` column, which rejects `''` (only a real
  value or `NULL` is valid). `||`-based chains were already safe (falsy
  includes `''`); this was specifically a `??` bug.
  1. **`app/src/import/dateGuard.ts`'s `toDateOrNull(value)`** is now the
     ONE guard every date written to the database routes through:
     `null`/undefined/non-string/whitespace-only/anything that isn't a
     real calendar date all return `null`. It's stricter than the
     existing lenient `parseIsoDate()` alone — that helper's
     `Date.UTC()` arithmetic silently ROLLS OVER an out-of-range month/
     day (month 13 becomes January of the next year) instead of
     rejecting it, so `toDateOrNull()` round-trips the parsed date's own
     year/month/day back against the original digits (same pattern
     `trySwapYearAndDay()` already uses in the same file) and returns
     `null` on any mismatch.
  2. **`app/src/import/mapExtraction.ts`'s `numOrNull(v)`** is the
     nullable counterpart to the existing `num(v, fallback=0)` — used
     wherever a `0` fallback would falsely claim "we know this is zero"
     on a nullable numeric column (gallons, loan balance/payment/APR,
     warranty years, document amount) as opposed to a NOT NULL column
     with a real 0 default, which keeps using `num()`.
  3. **Every mapper in `mapExtraction.ts` routes its own date/numeric
     fields through these two** (settlements, loads, fuel, maintenance,
     tolls, deductions, reimbursements, compliance, driver payments,
     loan agreements) — `mapSettlement()`'s own
     `settlementFallbackDate = toDateOrNull(s.weekEnding) ??
     toDateOrNull(d.date) ?? undefined` is the ONE settlement-level
     fallback every child mapper (`toFuelInsert()`/`toTollInsert()`, the
     inline load/deduction/maintenance mappers) receives as a
     `fallbackDate` param — implementing the exact "row's own date, else
     week_ending, else document date, else NULL" chain from the bug
     report: a child row is never rejected just because the AI left its
     own date blank. `aiImportSave.ts`'s `capital_transactions` insert
     (`tx_date: toDateOrNull(d.date) ?? new Date().toISOString().slice(0,
     10)`, a `NOT NULL` column) and `documents.amount`
     (`numOrNull(d.totalAmount)`) got the identical fix.
  4. **Resilient batch insert, `aiImportSave.ts`'s
     `insertBatchResilient()`**: loads/fuel_purchases/deductions/
     reimbursements/maintenance_records/tolls each try a fast full-batch
     `.insert()` first; on any failure, falls back to inserting ONE ROW
     AT A TIME, collecting `{table, description, reason}` for whichever
     rows still fail into `SaveExtractionResult.skippedRows` rather than
     discarding the whole import over one bad row. Carefully preserves
     the PRE-EXISTING re-import safety invariant (CLAUDE.md invariant
     #10's "old rows are deleted only after every new row succeeds"): on
     a REIMPORT, a persisting per-row failure still THROWS a
     `SaveExtractionError` (never silently deletes last week's data over
     an incomplete replacement); on a brand-new import (no prior data at
     risk), a partial failure is tolerated and reported instead. The
     import screen (`app/(tabs)/import/index.tsx`) shows an amber
     `importScreen.skippedRowsWarning` banner listing exactly which rows
     were skipped and why, whenever `skippedRows.length > 0`.
  Tests: `app/src/import/__tests__/dateGuard.test.ts` gained a
  `toDateOrNull` describe block (valid passthrough, empty/whitespace/
  "N/A"/null/undefined → null, malformed calendar date → null,
  whitespace-trimming). `app/src/import/__tests__/mapExtraction.test.ts`
  gained a `numOrNull` describe block plus edge-case coverage inside
  `mapSettlement`/`mapFuel`/`mapMaintenance`/`mapGenericDeduction`/
  `mapCompliance` (empty-string/malformed dates and numerics sanitizing
  correctly, settlement week_ending fallback, a string warrantyCredit
  like `"150.00"` still creating a correct numeric reimbursement despite
  JS's loose `>` comparison coercion risk). `app/src/data/__tests__/
  aiImportSave.errorReporting.test.ts` gained an "IMPORT SAVE BUG FIX
  (resilient batch insert)" block (transient-failure recovery, a
  persistent NEW-import failure reported not thrown, a persistent
  REIMPORT failure still throwing, good rows in the same batch still
  saving alongside a skipped one) and had its two pre-existing tests
  that asserted the OLD always-throw-on-any-failure behavior updated to
  match this deliberate behavior change. `app/src/data/__tests__/
  aiImportSave.settlementChildren.test.ts` gained an end-to-end
  "empty-string/malformed dates and numerics never reach the database"
  block proving a realistic malformed extraction (empty pickup/delivery
  dates, `'N/A'` gallons/amount, empty loan balance/payment/nextDue)
  saves without throwing, with every child row correctly inheriting the
  settlement's `week_ending` and every bad numeric landing as `null`.
  Full suite: 74 suites / 1839 tests pass; `tsc --noEmit` clean; all 7
  locales confirmed key-parity (`importScreen.skippedRowsWarning`, hi/uk
  as untranslated English copies per invariant #11).
