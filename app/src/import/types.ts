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
  // Meals & advance repayments (owner decision 2026-07-17, mirrors web
  // v2026.07.17-D): a plain repayment of a PRIOR advance (e.g. an
  // extended-warranty or company-store credit) — loan principal, distinct
  // from `cash_advance` (a NEW advance being deducted back) and
  // `loan_payment` (a routed truck/equipment loan payment).
  | 'advance_repayment'
  | 'other_chargeback';

export type ExtractedRevenueItem = { desc?: string; order?: string; amount?: number; incomeType?: IncomeType };
// code: the line's own 2-letter carrier code when printed (Prime "PR" =
// personal-payment reimbursement — the R1 offset limit for PERSONAL PYMNT
// RCV on Prime's operating statement).
export type ExtractedReimbursementItem = { code?: string; desc?: string; ref?: string; amount?: number };
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
  // DATE ANCHOR (owner decision 2026-07-30, definitive fix): the header's
  // unambiguous print date ("DATE:", commonly M/D/YY, printed ~1 day
  // before the settlement week) — used to resolve which digit-order
  // reading of the ambiguous "SETTLEMENTS DATE:" (weekEnding, commonly
  // YY/MM/DD) is correct (dateGuard.ts resolveWeekEndingWithAnchor()).
  printDate?: string;
  // PRINTED DATES (owner decision 2026-10-29): each date exactly as
  // printed, as text — the app parses them (src/import/printedDates.ts);
  // the model never interprets a date. Prime: SETTLEMENT DATE and the
  // statement WEEK ENDING are YY/MM/DD ("26/08/14"), the print DATE M/D/YY.
  settlementDateRaw?: string;
  printDateRaw?: string;
  statementWeekEndingRaw?: string;
  // The owner's answer to the date question on the import preview (Yes,
  // or a picked date) — Save checks it is for exactly this weekEnding.
  dateConfirmed?: import("./printedDates").DateConfirmation | null;
  // PER DIEM INTELLIGENCE (owner decision 2026-07-30): smart-defaulted
  // client-side from totalMiles (src/tax/perDiem.ts
  // defaultPerDiemDaysForMiles()) once the extraction is received — the AI
  // itself never sets this, it's not part of the ai-import schema.
  // Editable on the import preview before save; 0-7.
  perDiemDays?: number;
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
  // BANK DEPOSIT IS READ, NEVER COMPUTED (owner decision 2026-10-13): the
  // amount the statement says was deposited/paid to the bank (e.g. Prime's
  // "DIRECT DEPOSIT TO BANK"), when such a line is printed. The AMOUNT
  // only — never a routing, account or any other bank digits.
  depositAmount?: number | string;
  // The printed label each header total was read from (e.g. netPay: "NET
  // AMOUNT DUE UNIT"). Page-by-page merging (ai-import chunking.ts) only
  // calls two values a conflict when they came from the SAME label.
  totalLabels?: Partial<Record<'grossRevenue' | 'reimbursements' | 'totalDeductions' | 'netPay' | 'depositAmount', string>>;
  totalMiles?: number;
  loadedMiles?: number;
  // Batch C item 6 (2026-10-30, ai-import): every printed WEEKLY miles
  // total with its exact label ("LOADED MILES", "DEADHEAD", "TOTAL
  // MILES"); a deadhead pay line without miles has miles null. Read by
  // src/import/milesSplit.ts for carriers other than Prime.
  milesLines?: { label?: string | null; miles?: number | string | null }[];
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
  // PRIME OPERATING STATEMENT (owner decision, USE PRIME'S "STATEMENT OF
  // INCOME AND EXPENSE" AS THE VERIFICATION SOURCE OF TRUTH pass) — the
  // carrier's OWN verified figures, extracted ONLY when the AI confirms
  // the carrier is Prime Inc from the document's own letterhead (see
  // ai-import/index.ts's carrier-gated prompt block) AND a Perryman &
  // Associates-style operating-statement page is actually present.
  // Present-but-zero and absent are BOTH treated as "nothing to
  // reconcile against" by src/import/primeOperatingStatement.ts — this
  // field existing at all is not itself a confirmation of anything; the
  // carrier-isolation gate is the settlement's own `carrier` field,
  // checked independently and deterministically after extraction, never
  // trusted from the model's own behavior alone.
  //
  // PRIME STATEMENT AS SOURCE (owner decision 2026-10-13,
  // docs/decisions/prime-statement-source.md): every line of the WEEKS
  // column plus every printed subtotal, ALL SIGNED AS PRINTED (a trailing
  // minus = negative). src/import/settlementStatement.ts self-checks them
  // and src/import/primeStatementLines.ts classifies each line.
  operating?: {
    lines?: { section?: string; label?: string; amount?: number | string }[];
    weekMiles?: number;
    weekTotalFreightRevenue?: number | string;
    weekTotalOtherRevenue?: number | string;
    weekTotalRevenue?: number | string;
    weekTotalFuelOilTax?: number | string;
    weekTotalRepair?: number | string;
    weekTotalTires?: number | string;
    weekTotalMiscellaneous?: number | string;
    weekTotalVariableCosts?: number | string;
    weekTotalOutOfPocket?: number | string;
    weekTotalFixedCost?: number | string;
    weekTotalOtherIncomeAndExpense?: number | string;
    weekTotalOperatingExpenses?: number | string;
    weekTotalStatement?: number | string;
    // Balance-sheet page "SETTLEMENT TO OPERATOR" (WEEKS column) and the
    // recap page's "DIRECT DEPOSIT" line.
    settlementToOperator?: number | string;
    directDeposit?: number | string;
    // BALANCE FORWARD (owner decision 2026-10-17): PRIOR WEEK BALANCE
    // FORWARD, signed as printed on the statement cash flow / p4 recap
    // ("1,202.92-" = the owner owed Prime = negative), and TOTAL CASH
    // FLOW = TOTAL STATEMENT + balance forward = SETTLEMENT TO OPERATOR.
    priorWeekBalanceForward?: number | string;
    weekTotalCashFlow?: number | string;
    // The statement page's own week ending (header printed YY/MM/DD), ISO.
    weekEnding?: string;
    ytdTotalRevenue?: number;
    ytdMiles?: number;
    ytdTotalStatement?: number;
    // YTD SETTLEMENT TO OPERATOR — what Prime paid the operator this year.
    ytdSettlementToOperator?: number;
    weeksInService?: number;
    // HELD BY CARRIER (owner decision 2026-10-29), each as printed:
    // the balance sheet's PERF BD/EMGCY FD (YTD TOTAL column); page 3's
    // PERFORMANCE BOND/EMER FUND PAID account (prior balance, this week,
    // balance); the interest page's annual rate in percent (3.83).
    perfBondEmergencyFundYtd?: number | string;
    escrowPriorBalance?: number | string;
    escrowThisWeek?: number | string;
    escrowBalance?: number | string;
    escrowInterestRatePct?: number | string;
    // OLD LAYOUTS (before this pass) — never extracted any more, read only
    // from older stored parsed_json for the standing YTD check.
    ytdRevenue?: number;
    ytdNet?: number;
  };
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

// AI feature package (owner decision 2026-07-10, PRODUCT DECISION —
// compliance tracker) — one shared shape for the 5 new "compliance
// document" docTypes below (type mirrors the docType exactly), all
// routing to compliance_items (docs/PENDING_SQL.md §23), found-or-updated
// by (user_id, type) rather than duplicated on every re-import.
export type ComplianceDocType =
  | 'medical_card'
  | 'inspection_report'
  | 'registration_cab_card'
  | 'irs_2290_schedule1'
  | 'insurance_policy';
export type ExtractedCompliance = {
  type?: ComplianceDocType;
  label?: string;
  dueDate?: string;
  issueDate?: string;
};

// ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
// DECISION) — a loan/financing agreement document (truck, trailer, or
// other equipment note). On save (aiImportSave.ts) creates a Loan Center
// row from lender/amount/apr/payment/frequency/nextDue; assetType/
// assetName are used ONLY to auto-match an existing truck/trailer/
// equipment row to link the new loan to (never a forced picker — same
// "less aggressive than truck/driver match" spirit as driverMatch.ts).
export type LoanAgreementAssetType = 'truck' | 'trailer' | 'equipment' | 'other';
export type ExtractedLoanAgreement = {
  lender?: string;
  amount?: number;
  apr?: number;
  payment?: number;
  frequency?: string;
  nextDue?: string;
  assetType?: LoanAgreementAssetType;
  assetName?: string;
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
  | 'medical_card'
  | 'inspection_report'
  | 'registration_cab_card'
  | 'irs_2290_schedule1'
  // 'insurance_policy' (compliance — the policy DOCUMENT, tracks its own
  // renewal/expiry date via compliance_items) is deliberately distinct
  // from the existing 'insurance' financialDoc kind (a bill/statement,
  // routes to deductions as an expense) — same underlying topic, two
  // different document purposes, never conflated.
  | 'insurance_policy'
  | 'loan_agreement'
  | 'other';

export type ExtractionPageMapEntry = {
  page: number;
  kind: string;
  role: 'content' | 'attachment' | 'stored';
  status: 'read' | 'failed' | 'unread' | 'pending';
  cause?: string;
};

export type Extraction = {
  docType: DocType;
  date?: string;
  vendor?: string;
  // DOCUMENT TITLES (owner decision 2026-09-23) — the AI's own short,
  // human-readable title for this document (ai-import prompt).
  title?: string;
  totalAmount?: number;
  taxDeductible?: boolean;
  bizPct?: number;
  // Universal AI capture (owner decision 2026-07-10) — 'low' whenever any
  // key field is blurry/ambiguous/guessed; the import preview highlights
  // these for the user to confirm before saving (CLAUDE.md invariant: the
  // NEEDS REVIEW convention extends to whole documents, not just line
  // items). Always 'low' for docType 'other' by prompt design.
  confidence?: 'high' | 'low';
  // Set only by the client when the user saved a settlement whose printed
  // totals did not add up ("Save anyway, flagged needs-review" —
  // src/import/settlementReconciliation.ts flagReconciliationOverride()):
  // the failed checks, kept in documents.parsed_json for the audit trail.
  reconciliationOverride?: unknown[];
  // SIMPLE IMPORT FLOW (batch D2): the one gate's result at save time
  // (src/import/settlementGate.ts withGateAudit()), for audit only.
  settlementGate?: Record<string, unknown>;
  // Item 6 (owner decision 2026-10-17): the statement gate passed but a
  // line-item total, a per-group check or a check outside the gate
  // differs — saved as-is, needs-review; never the line route.
  reviewWarnings?: unknown[];
  // RESUMABLE IMPORT JOBS (owner decision 2026-10-13): set by ai-import's
  // page-by-page jobs (supabase/functions/ai-import/jobEngine.ts) — every
  // page of the PDF with its kind, its role (content / attachment / stored)
  // and whether it was read; the total page count; and statement totals
  // two pages read differently (chunking.ts).
  pageMap?: ExtractionPageMapEntry[];
  pagesTotal?: number;
  // The PDF's own CreationDate (Info dictionary), YYYY-MM-DD, set by
  // ai-import — a cross-check for the printed dates (printedDates.ts).
  pdfCreationDate?: string;
  mergeConflicts?: { path: string; values: number[] }[];
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
  compliance?: ExtractedCompliance;
  loanAgreement?: ExtractedLoanAgreement;
};
