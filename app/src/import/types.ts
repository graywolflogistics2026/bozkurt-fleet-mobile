// Shapes returned by the ai-import Edge Function — mirrors the JSON
// schemas embedded in its extraction prompt VERBATIM (see
// supabase/functions/ai-import/index.ts LEGACY_EXTRACTION_PROMPT, ported
// from legacy/index.html's handleFile()). Every field is optional/loosely
// typed on purpose: this is model-extracted JSON, not a DB row — never
// trust it hasn't dropped a key.

// docs/INDUSTRY_TAXONOMY.md §A (industry knowledge base, owner decision
// 2026-07-10, PRODUCT DECISION) — classifies each settlement income/
// chargeback line. Extraction-only for now (audit-trailed in
// documents.parsed_json); chargebackType additionally maps to a display
// category on the saved withheld-deduction row (mapExtraction.ts
// mapSettlement(), category.ts CHARGEBACK_CATEGORY_LABEL). incomeType has
// no persistence destination yet — see docs/INDUSTRY_TAXONOMY.md's Wiring
// status (revenueItems has no dedicated table, same as
// government_or_misc_income).
export type IncomeType =
  | 'linehaul'
  | 'fuel_surcharge'
  | 'accessorial'
  | 'reimbursement'
  | 'bonus'
  | 'trailer_rent'
  | 'ifta_refund'
  | 'other_income';
export type ChargebackType =
  | 'fuel_advance'
  | 'insurance_bobtail'
  | 'insurance_physical_damage'
  | 'insurance_occ_acc'
  | 'insurance_cargo'
  | 'insurance_workers_comp'
  | 'eld_communications'
  | 'plates_permits'
  | 'escrow_reserve'
  | 'lease_purchase_payment'
  | 'trailer_fee'
  | 'cash_advance'
  | 'loan_payment'
  | 'drug_consortium'
  | 'tolls_transponder'
  | 'admin_processing_fee'
  | 'factoring_fee'
  | 'dispatch_fee'
  | 'other_chargeback';

export type ExtractedRevenueItem = { desc?: string; order?: string; amount?: number; incomeType?: IncomeType };
export type ExtractedReimbursementItem = { desc?: string; ref?: string; amount?: number };
export type ExtractedLoad = {
  order?: string;
  from?: string;
  to?: string;
  loadedMiles?: number;
  emptyMiles?: number;
  revenue?: number;
  rate?: number;
  shipper?: string;
  // Not part of the strict schema, but legacy's saveImport() tolerates the
  // AI including these anyway (legacy/index.html:2513) — kept optional.
  pickupDate?: string;
  deliveryDate?: string;
  date?: string;
  dropDate?: string;
};
export type ExtractedFuel = {
  date?: string;
  location?: string;
  state?: string;
  gallons?: number;
  amount?: number;
  discount?: number;
};
export type ExtractedSettlementDeduction = {
  code?: string;
  desc?: string;
  balance?: number;
  amount?: number;
  category?: string;
  // docs/INDUSTRY_TAXONOMY.md §A — when present, takes priority over the
  // loose `category` string above (mapSettlement() maps it to a canonical
  // display category via CHARGEBACK_CATEGORY_LABEL).
  chargebackType?: ChargebackType;
};
export type ExtractedSettlementMaintenance = {
  invoice?: string;
  unit?: string;
  desc?: string;
  odometer?: number;
  serviceType?: string;
  parts?: number;
  labor?: number;
  total?: number;
  covered?: number;
};
export type ExtractedToll = { date?: string; amount?: number; plaza?: string; location?: string };
export type ExtractedLoan = { name: string; balance?: number; payment?: number; frequency?: string; nextDue?: string };

export type ExtractedSettlement = {
  weekEnding?: string;
  carrier?: string;
  unit?: string;
  // Payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION):
  // carrier settlements print both the unit number (above, "unit") and the
  // driver's name — used to auto-match against trucks.unit_number /
  // drivers.name at import time (app/src/import/truckMatch.ts,
  // app/src/import/driverMatch.ts).
  driverName?: string;
  grossRevenue?: number;
  reimbursements?: number;
  totalDeductions?: number;
  netPay?: number;
  totalMiles?: number;
  loadedMiles?: number;
  revenueItems?: ExtractedRevenueItem[];
  reimbursementItems?: ExtractedReimbursementItem[];
  loads?: ExtractedLoad[];
  tractorFuel?: ExtractedFuel[];
  reeferFuel?: ExtractedFuel[];
  deductions?: ExtractedSettlementDeduction[];
  maintenance?: ExtractedSettlementMaintenance[];
  tolls?: {
    ezpass?: { total?: number; items?: ExtractedToll[] };
    drivewyze?: { total?: number; items?: ExtractedToll[] };
  };
  loans?: ExtractedLoan[];
};

export type ExtractedStandaloneFuel = {
  type?: 'tractor' | 'reefer';
  station?: string;
  location?: string;
  state?: string;
  gallons?: number;
  pricePerGallon?: number;
  gross?: number;
  discount?: number;
  net?: number;
};

export type ExtractedMaintenance = {
  invoice?: string;
  shop?: string;
  unit?: string;
  description?: string;
  odometer?: number;
  serviceType?: string;
  parts?: number;
  labor?: number;
  total?: number;
  warrantyCredit?: number;
  netCost?: number;
};

// warrantyYears/warrantyFor — owner decision 2026-07-07 (web app
// v2026.07.07-H): items may carry a warranty length (halves ok, e.g. 2.5)
// and, for a fee/service line, which item it covers.
export type ExtractedPurchaseItem = {
  name?: string;
  qty?: number;
  price?: number;
  warrantyYears?: number;
  warrantyFor?: string;
};
export type ExtractedPurchase = {
  orderNumber?: string;
  items?: ExtractedPurchaseItem[];
  subtotal?: number;
  tax?: number;
  total?: number;
  paymentMethod?: string;
};

export type ExtractedW2 = {
  employer?: string;
  employeeName?: string;
  taxYear?: number;
  box1Wages?: number;
  box2FederalWithheld?: number;
};

// Universal AI capture (owner decision 2026-07-10, PRODUCT DECISION) — a
// receipt/confirmation of a payment TO one of the owner's OWN drivers
// (payroll check stub, Zelle/Venmo/Cash App confirmation where the
// recipient is a driver, not a store). Routes to the driver_payments table
// (docs/PENDING_SQL.md §16), never `deductions`.
export type ExtractedDriverPayment = {
  driverName?: string;
  amount?: number;
  method?: string;
  notes?: string;
};

// Universal AI capture — one shared shape for the 5 new "generic business
// financial document" docTypes below (kind mirrors the docType exactly).
// insurance/lease_rent/factoring_statement/utility_subscription route to
// `deductions`; government_or_misc_income is INCOME with no dedicated
// ledger yet (v1.x backlog, PROMPTS.md) — archived (document + parsed_json
// audit trail) but no financial row created, same treatment as 'w2'.
export type FinancialDocKind =
  | 'insurance'
  | 'lease_rent'
  | 'factoring_statement'
  | 'government_or_misc_income'
  | 'utility_subscription';
export type ExtractedFinancialDoc = {
  kind?: FinancialDocKind;
  description?: string;
  amount?: number;
  reference?: string;
  period?: string;
};

export type DocType =
  | 'settlement'
  | 'fuel'
  | 'maintenance'
  | 'amazon'
  | 'store'
  | 'toll'
  | 'loan'
  | 'w2'
  | 'driver_payment'
  | 'insurance'
  | 'lease_rent'
  | 'factoring_statement'
  | 'government_or_misc_income'
  | 'utility_subscription'
  | 'other';

export type Extraction = {
  docType: DocType;
  date?: string;
  vendor?: string;
  totalAmount?: number;
  taxDeductible?: boolean;
  bizPct?: number;
  // Universal AI capture (owner decision 2026-07-10) — 'low' whenever any
  // key field is blurry/ambiguous/guessed; the import preview highlights
  // these for the user to confirm before saving (CLAUDE.md invariant: the
  // NEEDS REVIEW convention extends to whole documents, not just line
  // items). Always 'low' for docType 'other' by prompt design.
  confidence?: 'high' | 'low';
  // AI's best-guess category for an unrecognized-but-clearly-financial
  // document (docType 'other') — never silently guessed into the wrong
  // ledger; shown in the preview and used as the deduction category only
  // after the user reviews/confirms (mapGenericDeduction()).
  suggestedCategory?: string;
  summary?: string;
  settlement?: ExtractedSettlement;
  fuel?: ExtractedStandaloneFuel;
  maintenance?: ExtractedMaintenance;
  purchase?: ExtractedPurchase;
  w2?: ExtractedW2;
  driverPayment?: ExtractedDriverPayment;
  financialDoc?: ExtractedFinancialDoc;
};
