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
        `cf_insurance_monthly`, `cf_other_weekly`, `cf_tax_reserve_pct`,
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
