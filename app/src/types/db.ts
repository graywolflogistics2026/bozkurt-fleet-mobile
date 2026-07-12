// Hand-written row types mirroring the LIVE Supabase schema — docs/SCHEMA.sql
// plus everything applied on top of it per docs/PENDING_SQL.md sections 1, 3,
// 4, 5 (tax_config, tax_year_data, household_*, profiles.tos_* — and note
// profiles.filing_status was DROPPED, moved to tax_config.tax_year).
// `supabase gen types` has not been run against this project yet (see
// PENDING_SQL.md "Also still open"); these are maintained by hand until then.

export type Truck = {
  id: string;
  user_id: string;
  unit_number: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  engine: string | null;
  current_odometer: number | null;
  fleet_mpg: number | null;
  apu_hours: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
export type TruckInsert = Partial<Omit<Truck, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type TruckUpdate = Partial<Omit<Truck, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// docs/PENDING_SQL.md §13 (multi-truck fleet + drivers + payroll
// auto-routing, PRODUCT DECISION 2026-07-09) — optional entity; an account
// with zero rows here behaves exactly as before.
// compensation_type/pay_type/pay_rate: docs/PENDING_SQL.md §15 (driver
// compensation types, owner decision 2026-07-10). pay_rate is informational
// display only — the tax engine (app/src/tax/driverPayroll.ts) never
// derives an amount from it, only from actual recorded DriverPayment rows.
export type CompensationType = 'w2_employee' | '1099_contractor' | 'team_split' | 'trainee';
export type Driver = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  license: string | null;
  active: boolean;
  default_truck_id: string | null;
  compensation_type: CompensationType;
  pay_type: 'per_mile' | 'percent' | 'flat' | null;
  pay_rate: number | null;
  created_at: string;
  updated_at: string;
};
export type DriverInsert = Partial<Omit<Driver, 'id' | 'created_at' | 'updated_at'>> & { user_id: string; name: string };
export type DriverUpdate = Partial<Omit<Driver, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// docs/PENDING_SQL.md §16 (driver compensation types, owner decision
// 2026-07-10) — what the owner actually paid a driver; the tax engine's
// sole source for driver payroll expense (never derived from
// drivers.pay_rate). employer_taxes defaults to 0 and is only ever
// populated for compensation_type='w2_employee' payments; this is what lets
// sumDeductibleDriverPayroll() treat gross_pay + employer_taxes as a
// uniform deductible-expense formula with no type-specific branch.
export type DriverPayment = {
  id: string;
  user_id: string;
  driver_id: string;
  settlement_id: string | null;
  date: string;
  gross_pay: number;
  employer_taxes: number;
  notes: string | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type DriverPaymentInsert = Partial<Omit<DriverPayment, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  driver_id: string;
  date: string;
};
export type DriverPaymentUpdate = Partial<Omit<DriverPayment, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type DocumentRow = {
  id: string;
  user_id: string;
  filename: string | null;
  doc_type: string | null;
  doc_date: string | null;
  amount: number | null;
  storage_path: string | null;
  parsed_json: Record<string, unknown> | null;
  imported_at: string;
  updated_at: string;
};
export type DocumentInsert = Partial<Omit<DocumentRow, 'id' | 'imported_at' | 'updated_at'>> & { user_id: string };
export type DocumentUpdate = Partial<Omit<DocumentRow, 'id' | 'user_id' | 'imported_at' | 'updated_at'>>;

export type Settlement = {
  id: string;
  user_id: string;
  truck_id: string | null;
  driver_id: string | null; // docs/PENDING_SQL.md §14 (payroll auto-routing)
  document_id: string | null;
  week_ending: string;
  gross: number;
  net: number;
  miles: number;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type SettlementInsert = Partial<Omit<Settlement, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  week_ending: string;
};
export type SettlementUpdate = Partial<Omit<Settlement, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type Load = {
  id: string;
  user_id: string;
  settlement_id: string | null;
  driver_id: string | null; // docs/PENDING_SQL.md §14 (payroll auto-routing)
  load_date: string | null;
  pickup_date: string | null; // docs/PENDING_SQL.md §8 — re-added for exact per-diem day-counting
  delivery_date: string | null;
  order_number: string | null;
  origin: string | null;
  destination: string | null;
  loaded_miles: number;
  empty_miles: number;
  revenue: number;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type LoadInsert = Partial<Omit<Load, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type LoadUpdate = Partial<Omit<Load, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type FuelPurchase = {
  id: string;
  user_id: string;
  truck_id: string | null; // added retroactively, docs/PENDING_SQL.md §6 (Session 6)
  settlement_id: string | null;
  driver_id: string | null; // docs/PENDING_SQL.md §14 (payroll auto-routing)
  fuel_type: 'tractor' | 'reefer';
  purchase_date: string | null;
  location: string | null;
  state: string | null;
  gallons: number | null;
  amount: number | null;
  discount: number;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type FuelPurchaseInsert = Partial<Omit<FuelPurchase, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  fuel_type: 'tractor' | 'reefer';
};
export type FuelPurchaseUpdate = Partial<Omit<FuelPurchase, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// Tax rule (net-pay model, CLAUDE.md invariant #1): deductible = rows where
// source !== 'settlement'. Withheld rows are display-only.
export type Deduction = {
  id: string;
  user_id: string;
  settlement_id: string | null;
  driver_id: string | null; // docs/PENDING_SQL.md §14 — settlement-withheld rows only (payroll auto-routing)
  document_id: string | null;
  ded_date: string | null;
  code: string | null;
  description: string | null;
  amount: number;
  category: string | null;
  store: string | null;
  payment_method: string | null;
  source: 'settlement' | 'import' | 'manual';
  warranty_years: number | null; // docs/PENDING_SQL.md §7 — halves ok (e.g. 2.5)
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type DeductionInsert = Partial<Omit<Deduction, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  amount: number;
};
export type DeductionUpdate = Partial<Omit<Deduction, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// Tax-free remaining = profiles.initial_capital + sum(contribution) - sum(draw)
export type CapitalTransaction = {
  id: string;
  user_id: string;
  tx_type: 'contribution' | 'draw';
  amount: number;
  tx_date: string;
  note: string | null;
  linked_deduction_id: string | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type CapitalTransactionInsert = Partial<Omit<CapitalTransaction, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  tx_type: 'contribution' | 'draw';
  amount: number;
  tx_date: string;
};
export type CapitalTransactionUpdate = Partial<
  Omit<CapitalTransaction, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

export type MaintenanceRecord = {
  id: string;
  user_id: string;
  truck_id: string | null;
  document_id: string | null;
  service_date: string | null;
  service_type: string | null;
  description: string | null;
  odometer: number | null;
  engine_hours: number | null;
  cost: number;
  vendor: string | null;
  invoice_number: string | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type MaintenanceRecordInsert = Partial<Omit<MaintenanceRecord, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
};
export type MaintenanceRecordUpdate = Partial<Omit<MaintenanceRecord, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type MaintenanceInterval = {
  id: string;
  user_id: string;
  truck_id: string;
  category: string;
  tracking_mode: 'miles' | 'hours' | 'mpg_based';
  interval_miles: number | null;
  interval_hours: number | null;
  bundled_with_category: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export type MaintenanceIntervalUpdate = Partial<
  Omit<MaintenanceInterval, 'id' | 'user_id' | 'truck_id' | 'category' | 'created_at' | 'updated_at'>
>;

// Manual baseline overrides ONLY for categories with no backing
// maintenance_records row (docs/SCHEMA.sql DECISION D2).
export type TruckHealthConfig = {
  truck_id: string;
  user_id: string;
  overrides: Record<string, { odometer?: number; hours?: number }>;
  created_at: string;
  updated_at: string;
};

export type Toll = {
  id: string;
  user_id: string;
  network: 'ezpass' | 'drivewyze' | 'other' | null;
  toll_date: string | null;
  amount: number | null;
  plaza: string | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type TollInsert = Partial<Omit<Toll, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type TollUpdate = Partial<Omit<Toll, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type Reimbursement = {
  id: string;
  user_id: string;
  settlement_id: string | null; // docs/PENDING_SQL.md §9 — batch tag for settlement re-import-replace
  reimb_date: string | null;
  description: string | null;
  reference: string | null;
  amount: number | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type ReimbursementInsert = Partial<Omit<Reimbursement, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
};
export type ReimbursementUpdate = Partial<Omit<Reimbursement, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type LoanRow = {
  id: string;
  user_id: string;
  name: string | null;
  lender: string | null;
  original_amount: number | null;
  balance: number | null;
  payment: number | null;
  frequency: string | null;
  apr: number | null;
  next_due: string | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type LoanInsert = Partial<Omit<LoanRow, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type LoanUpdate = Partial<Omit<LoanRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type CreditCardRow = {
  id: string;
  user_id: string;
  name: string | null;
  last_four: string | null;
  credit_limit: number | null;
  balance: number | null;
  apr: number | null;
  due_day: number | null;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type CreditCardInsert = Partial<Omit<CreditCardRow, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type CreditCardUpdate = Partial<Omit<CreditCardRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type BankStatement = {
  id: string;
  user_id: string;
  account_type: 'card' | 'checking';
  statement_month: string | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
};
export type BankStatementInsert = Partial<Omit<BankStatement, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  account_type: 'card' | 'checking';
};

export type BankTransaction = {
  id: string;
  statement_id: string;
  user_id: string;
  tx_date: string | null;
  description: string | null;
  category: string | null;
  tx_type: 'charge' | 'payment' | 'deposit' | 'withdrawal' | null;
  amount: number | null;
  deductible: boolean;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type BankTransactionInsert = Partial<Omit<BankTransaction, 'id' | 'created_at' | 'updated_at'>> & {
  statement_id: string;
  user_id: string;
};

// docs/PENDING_SQL.md §21 (custom categories, owner decision 2026-07-10,
// PRODUCT DECISION) — optional/additive entity; zero rows here means every
// picker just shows CANONICAL_CATEGORIES (docs/INDUSTRY_TAXONOMY.md §B).
// Tax safety rail: schedule_c_bucket is required (app defaults to "Misc")
// for kind='expense' so a custom expense category can never silently fall
// out of the P&L/tax estimate — enforced by a DB check constraint too, not
// just this app-level type. kind='income' rows have no bucket; a custom
// income category rolls straight into gross income.
export type UserCategory = {
  id: string;
  user_id: string;
  name: string;
  kind: 'income' | 'expense';
  schedule_c_bucket: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type UserCategoryInsert = Partial<Omit<UserCategory, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  name: string;
  kind: 'income' | 'expense';
};
export type UserCategoryUpdate = Partial<Omit<UserCategory, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// docs/PENDING_SQL.md §23 (AI feature package — compliance tracker, owner
// decision 2026-07-10, PRODUCT DECISION). Optional/additive — zero rows
// means an empty tracker. type covers all 8 categories named in the spec;
// only 5 (see ComplianceType below) auto-populate via ai-import
// (app/src/import/mapExtraction.ts mapCompliance()) — ifta_filing/cdl/
// drug_consortium are manual-entry only for now. recurrence is nullable,
// never auto-derived by the AI — set on the Session 9b screen.
export type ComplianceType =
  | 'medical_card'
  | 'annual_inspection'
  | 'irp_registration'
  | 'hvut_2290'
  | 'ifta_filing'
  | 'insurance_policy'
  | 'cdl'
  | 'drug_consortium'
  | 'other';
export type ComplianceItem = {
  id: string;
  user_id: string;
  type: ComplianceType;
  label: string;
  due_date: string;
  recurrence: 'none' | 'annual' | 'biennial' | 'quarterly' | null;
  source_document_id: string | null;
  created_at: string;
  updated_at: string;
};
export type ComplianceItemInsert = Partial<Omit<ComplianceItem, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  type: ComplianceType;
  label: string;
  due_date: string;
};
export type ComplianceItemUpdate = Partial<Omit<ComplianceItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type Profile = {
  user_id: string;
  company_name: string | null;
  owner_name: string | null;
  locale: string | null; // app UI language override — null = follow device (multi-language support, owner decision 2026-07-09)
  home_state: string | null;
  business_balance: number;
  initial_capital: number;
  settings: Record<string, unknown>;
  tos_accepted_at: string | null;
  tos_version: string | null;
  // docs/PENDING_SQL.md §19 (customizable dashboard) — unenforced shape documented there; null until Session 9a ships.
  dashboard_layout: Record<string, unknown> | null;
  // docs/PENDING_SQL.md §20 (expanded onboarding wizard) — null/'owner_operator' both mean the full owner-operator experience.
  role: 'owner_operator' | 'company_driver_w2' | 'contractor_1099' | 'trainee' | null;
  // docs/PENDING_SQL.md §24 (AI feature package — CEO Mode briefing) — null means "no goal set", never treated as $0.
  weekly_goal: number | null;
  created_at: string;
  updated_at: string;
};
export type ProfileUpdate = Partial<
  Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>
>;

// entity_type: 'multi_member_llc' added retroactively, docs/PENDING_SQL.md
// §18 (entity selection, owner decision 2026-07-10) — ownership_pct is only
// meaningful for that entity_type (see calcTaxEstimate.ts ownerShareOfProfit).
export type TaxConfig = {
  user_id: string;
  tax_year: number;
  filing_status: 'single' | 'mfj' | 'hoh';
  state: string;
  include_state_tax: boolean;
  entity_type: 'sole_prop' | 'smllc' | 'multi_member_llc' | 'scorp';
  scorp_salary: number | null;
  scorp_payroll_tax_handled: boolean;
  ownership_pct: number | null;
};

// Server-side, centrally-updatable tax constants (D10) — the ONLY place any
// screen may read tax constants from (CLAUDE.md invariant #6).
export type TaxYearData = {
  tax_year: number;
  federal_brackets: Record<'mfj' | 'single' | 'hoh', Array<[number, number | null, number]>>;
  standard_deduction: Record<'mfj' | 'single' | 'hoh', number>;
  // employer_fica: added retroactively, docs/PENDING_SQL.md §17 (driver
  // compensation types, owner decision 2026-07-10) — the employer-side FICA
  // match rate (7.65%), read by both the W-2 driver true-cost-of-employee
  // calc (app/src/tax/driverPayroll.ts) and the scorp owner-salary employer
  // payroll tax estimate (calcTaxEstimate.ts). Optional/graceful fallback
  // like full_daily_rate below until the migration has run.
  se_tax: { rate: number; factor: number; ss_wage_base?: number; employer_fica?: number };
  // full_daily_rate: the pre-reduction IRS transportation-industry meal
  // rate (e.g. $80) that daily_rate ($64) is 80% of — optional, purely for
  // the Dashboard's "@$64/day (80% of $80)" caption (docs/PENDING_SQL.md
  // §10); daily_rate/deductible_pct alone remain what calcPerDiemDeduction()
  // actually computes with, unchanged.
  per_diem: { daily_rate: number; deductible_pct: number; full_daily_rate?: number };
  quarterly_deadlines: Array<[string, string]>;
  state_tax: {
    no_tax: string[];
    flat: Record<string, number>;
    flat_adjustments?: Record<string, { exempt_below?: number; surtax_rate?: number; surtax_over?: number }>;
    bracket?: Record<string, unknown>;
    fallback_effective_rate: number;
  };
  // nec_1099: added retroactively, docs/PENDING_SQL.md §17 — the IRS
  // 1099-NEC filing threshold/deadline (CLAUDE.md invariant #6: no tax
  // constant lives in app code). Optional — app/src/tax/driverPayroll.ts
  // falls back to a hardcoded $600/no-deadline-shown behavior until this
  // migration has run.
  nec_1099?: { threshold: number; filing_deadline: string };
  published: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// docs/PENDING_SQL.md §26 (misc income ledger, PROMPTS.md Session 9a) — the
// real income ledger CLAUDE.md invariant #14 flagged as missing for
// docType 'government_or_misc_income' (previously archive-only, no
// financial row). Also the target of the "manual add income" form legacy
// has no equivalent of — a user-entered row (stimulus, tax refund credited
// to the business, detention pay outside a settlement, etc.) that should
// roll into gross income without inventing a fake settlement or load. No
// category/bucket — income never carries a Schedule C bucket (only
// expenses do, CLAUDE.md invariant #19).
export type MiscIncome = {
  id: string;
  user_id: string;
  document_id: string | null;
  income_date: string | null;
  description: string | null;
  source: string | null; // free text, e.g. "IRS", "State of Texas" — NOT a payment method
  amount: number;
  tags: string | null; // docs/PENDING_SQL.md §22 (flexible fields, owner decision 2026-07-10)
  created_at: string;
  updated_at: string;
};
export type MiscIncomeInsert = Partial<Omit<MiscIncome, 'id' | 'created_at' | 'updated_at'>> & {
  user_id: string;
  amount: number;
};
export type MiscIncomeUpdate = Partial<Omit<MiscIncome, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

// docs/PENDING_SQL.md §25 (Profit Analysis v1, PROMPTS.md Session 9a,
// CLAUDE.md invariant #22 — NO external-data features) — NOT user-scoped,
// admin-seeded PUBLISHED industry reference ranges, same "server-sourced
// constant, never hardcoded, never live peer data" pattern as
// tax_year_data. metric is a stable key the app switches on
// ('fuel_pct_of_revenue' | 'maintenance_cost_per_mile' today); low/high
// bound a reference range, not a single number, since real fleets vary.
export type Benchmark = {
  id: string;
  metric: string;
  label: string;
  low: number;
  high: number;
  unit: 'percent' | 'usd_per_mile';
  source: string;
  year: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};
