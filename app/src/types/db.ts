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
  document_id: string | null;
  week_ending: string;
  gross: number;
  net: number;
  miles: number;
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
  load_date: string | null;
  order_number: string | null;
  origin: string | null;
  destination: string | null;
  loaded_miles: number;
  empty_miles: number;
  revenue: number;
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
  fuel_type: 'tractor' | 'reefer';
  purchase_date: string | null;
  location: string | null;
  state: string | null;
  gallons: number | null;
  amount: number | null;
  discount: number;
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
  document_id: string | null;
  ded_date: string | null;
  code: string | null;
  description: string | null;
  amount: number;
  category: string | null;
  store: string | null;
  payment_method: string | null;
  source: 'settlement' | 'import' | 'manual';
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
  created_at: string;
  updated_at: string;
};
export type TollInsert = Partial<Omit<Toll, 'id' | 'created_at' | 'updated_at'>> & { user_id: string };
export type TollUpdate = Partial<Omit<Toll, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type Reimbursement = {
  id: string;
  user_id: string;
  reimb_date: string | null;
  description: string | null;
  reference: string | null;
  amount: number | null;
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
  created_at: string;
  updated_at: string;
};
export type BankTransactionInsert = Partial<Omit<BankTransaction, 'id' | 'created_at' | 'updated_at'>> & {
  statement_id: string;
  user_id: string;
};

export type Profile = {
  user_id: string;
  company_name: string | null;
  owner_name: string | null;
  home_state: string | null;
  business_balance: number;
  initial_capital: number;
  settings: Record<string, unknown>;
  tos_accepted_at: string | null;
  tos_version: string | null;
  created_at: string;
  updated_at: string;
};
export type ProfileUpdate = Partial<
  Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>
>;

export type TaxConfig = {
  user_id: string;
  tax_year: number;
  filing_status: 'single' | 'mfj' | 'hoh';
  state: string;
  include_state_tax: boolean;
  entity_type: 'sole_prop' | 'smllc' | 'scorp';
  scorp_salary: number | null;
  scorp_payroll_tax_handled: boolean;
};

// Server-side, centrally-updatable tax constants (D10) — the ONLY place any
// screen may read tax constants from (CLAUDE.md invariant #6).
export type TaxYearData = {
  tax_year: number;
  federal_brackets: Record<'mfj' | 'single' | 'hoh', Array<[number, number | null, number]>>;
  standard_deduction: Record<'mfj' | 'single' | 'hoh', number>;
  se_tax: { rate: number; factor: number; ss_wage_base?: number };
  per_diem: { daily_rate: number; deductible_pct: number };
  quarterly_deadlines: Array<[string, string]>;
  state_tax: {
    no_tax: string[];
    flat: Record<string, number>;
    flat_adjustments?: Record<string, { exempt_below?: number; surtax_rate?: number; surtax_over?: number }>;
    bracket?: Record<string, unknown>;
    fallback_effective_rate: number;
  };
  published: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
