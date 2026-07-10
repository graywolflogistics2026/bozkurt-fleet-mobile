// Shapes returned by the ai-import Edge Function — mirrors the JSON
// schemas embedded in its extraction prompt VERBATIM (see
// supabase/functions/ai-import/index.ts LEGACY_EXTRACTION_PROMPT, ported
// from legacy/index.html's handleFile()). Every field is optional/loosely
// typed on purpose: this is model-extracted JSON, not a DB row — never
// trust it hasn't dropped a key.

export type ExtractedRevenueItem = { desc?: string; order?: string; amount?: number };
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

export type DocType = 'settlement' | 'fuel' | 'maintenance' | 'amazon' | 'store' | 'toll' | 'loan' | 'w2' | 'other';

export type Extraction = {
  docType: DocType;
  date?: string;
  vendor?: string;
  totalAmount?: number;
  taxDeductible?: boolean;
  bizPct?: number;
  summary?: string;
  settlement?: ExtractedSettlement;
  fuel?: ExtractedStandaloneFuel;
  maintenance?: ExtractedMaintenance;
  purchase?: ExtractedPurchase;
  w2?: ExtractedW2;
};
