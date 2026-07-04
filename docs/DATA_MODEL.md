# Legacy → Postgres mapping (quick reference)

| Legacy (localStorage) | New table | Notes |
|---|---|---|
| DB.sett | settlements | unique (user, week_ending) |
| DB.loads | loads | FK → settlements, cascade |
| DB.fuel.tr / DB.fuel.re | fuel_purchases | fuel_type column; +state for IFTA |
| DB.ded | deductions | source column encodes withheld vs out-of-pocket |
| DB.maint | maintenance_records | engine_hours for APU |
| DB.tolls.ez / dw | tolls | network column |
| DB.reimb | reimbursements | |
| DB.docs | documents | + storage_path (file archive) |
| DB.assets.tr | trucks | multi-truck ready |
| CAPITAL.draws + extraContributions | capital_transactions | unified; FK cascade replaces hand-coded cleanup |
| CAPITAL.contribution ($60K) | profiles.initial_capital | |
| gw_bizbal | profiles.business_balance | |
| (was profiles.filing_status) | tax_config.filing_status | moved 2026-07-03 (owner decision) — tax engine is product-ready, not single-user; tax_config also adds tax_year, state, include_state_tax so the estimator isn't hardcoded to one household/year. Federal brackets/deadlines/state-tax data live in the server-side `tax_year_data` table (see below), never in this table or app code — see CLAUDE.md. |
| (new, no legacy source — sole prop only) | tax_config.entity_type / scorp_salary / scorp_payroll_tax_handled | added 2026-07-03 (owner decision) — sole_prop/smllc share the legacy SE-tax-on-full-profit math unchanged (smllc is a UI label only); scorp branches SE tax to scorp_salary only, rest as distributions. See CLAUDE.md and PROMPTS.md Sessions 5 & 7. |
| (was: hardcoded in legacy calcTax(); briefly planned as app/src/tax/brackets/{year}.ts) | tax_year_data | added 2026-07-03 (owner decision, D10) — NOT user-scoped, one row per tax_year, shared by every user. Holds federal_brackets, standard_deduction, se_tax, per_diem, quarterly_deadlines, state_tax as jsonb, plus published/notes. Readable by all authenticated users, writable only by service_role — an admin seeds/updates it directly (docs/ADMIN_RUNBOOK.md), no app release needed for a new tax year. 2026 row seeded verbatim from legacy calcTax; **LIVE**: state_tax verified and `published=true` as of 2026-07-03 — see docs/ADMIN_RUNBOOK.md for the exact figures used. See CLAUDE.md invariant #6. |
| (new, no legacy source — legacy calcTax's "Spouse Income" field was a single number, not a real entity) | household_members / household_income | added 2026-07-03 (owner decision, D11), applied retroactively — SQL was already run live before being documented here. household_members holds each person (name, relation: spouse/child/other) whose income feeds the household's tax estimate; household_income is one row per member per tax_year per income source (income_type: w2_wages/self_employment/other), with document_id optionally linking back to the `documents` row the ai-import 'w2' docType produced. See docs/SCHEMA.sql and docs/PENDING_SQL.md. |
| gw_health | maintenance_intervals (per-truck, user-editable, seeded from legacy constants) + truck_health_config.overrides (manual baseline only) + computed view | baselines derived from maintenance_records; interval LENGTHS are no longer constants |
| LOANS / CARDS | loans / credit_cards | |
| BANK_STMTS / CHK_STMTS | bank_statements + bank_transactions | normalized |
| gw_readonly, gw_autosave | profiles.settings jsonb | per-user now, not per-device |

Fleet scalability (owner decision 2026-07-03): no schema change — `truck_id`
already flows through settlements, fuel_purchases, maintenance_records, and
the health tables (D4). Scaling from 1 to 100 trucks is entirely an app-layer
concern (active-truck context, per-truck vs. fleet-wide aggregation, truck
matching on import) — see CLAUDE.md and PROMPTS.md Sessions 3/5/8.
