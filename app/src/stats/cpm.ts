export type CpmResult = {
  revenuePerMile: number | null;
  costPerMile: number | null;
  profitPerMile: number | null;
};

// Verbatim port of legacy rDash()'s cost-per-mile block (legacy/index.html:1364-1372):
//   const rpm=grossRev/totalMiles, cpm=totalCost/totalMiles, ppm=rpm-cpm;
// `totalDeductions` here is ALL deductions (settlement-withheld AND
// out-of-pocket combined) — the same figure the Dashboard's "Total
// Deductions" card shows. This is intentionally a DIFFERENT total than the
// tax engine's net-profit expense figure, which uses only out-of-pocket
// deductions (source != 'settlement') — legacy keeps CPM and the tax
// estimator as two separate views of expenses, and this port preserves
// that rather than unifying them.
export function calcCpm(grossRevenue: number, totalDeductions: number, totalMiles: number): CpmResult {
  if (totalMiles <= 0) return { revenuePerMile: null, costPerMile: null, profitPerMile: null };
  const revenuePerMile = grossRevenue / totalMiles;
  const costPerMile = totalDeductions / totalMiles;
  return { revenuePerMile, costPerMile, profitPerMile: revenuePerMile - costPerMile };
}

// legacy: $('d-ppm').style.color = ppm>0.5?'var(--grn)':ppm>0?'var(--org)':'var(--red)'
export function ppmColor(ppm: number): 'green' | 'orange' | 'red' {
  if (ppm > 0.5) return 'green';
  if (ppm > 0) return 'orange';
  return 'red';
}

// FULL PARITY pass (owner decision 2026-08-05, spec item C.4) — CPM =
// OPERATING cost per TOTAL mile, built from the SAME canonical expense
// engine as calcTrueProfit() (src/stats/trueProfit.ts's
// sumCanonicalExpenses(), which already excludes Meals/Advance
// Repayment/Escrow & Deposits and folds in fuel/maintenance/tolls, not
// just the `deductions` table) — replacing the old calcCpm()'s raw "ALL
// deductions, unconditionally" total, which counted non-deductible
// non-expenses (a per-diem-covered meal, an advance repayment, a
// refundable escrow deposit) as if they were real operating costs.
// calcCpm() above is left in place, untouched, for any caller that still
// wants the literal legacy `rDash()` figure — this is the NEW canonical
// CPM every screen should read from.
import { reducesTrueProfit } from '@/src/stats/trueProfit';
import { isVehiclePurchaseOneOff } from '@/src/import/category';

export type CpmCostType = 'fixed' | 'variable';
export type CpmBucket = { category: string; amount: number; type: CpmCostType };

// FULL PARITY follow-up (owner decision 2026-08-05, spec item C.2) — a
// deduction excluded from the per-mile figure because it's a multi-year
// one-off (a major repair/overhaul) or a vehicle purchase logged as a
// plain deduction rather than an asset's own purchase_price. Kept
// separate from `excludedTotal` (which covers Meals/Advance
// Repayment/Escrow — non-expenses, not one-offs) so the "Why?" breakdown
// can list exactly which real expenses were deliberately left out of CPM
// and why, per the spec's "show... excluded one-offs."
export type CpmExcludedOneOff = { description: string; amount: number; reason: 'major_repair_overhaul' | 'vehicle_purchase' };

export type CanonicalCpmResult = {
  revenuePerMile: number | null;
  costPerMile: number | null;
  profitPerMile: number | null;
  buckets: CpmBucket[];
  // Meals/Advance Repayment/Escrow & Deposits + the truck/trailer PURCHASE
  // price (never passed into this function at all — CLAUDE.md invariant
  // #25's asset purchase_price lives on trucks/equipment, not a deduction
  // row) + owner draws/income taxes (never deduction rows either) — shown
  // as a single informational total so a user can see what was
  // deliberately left OUT of the cost-per-mile figure, per the spec's
  // "show... the excluded total."
  excludedTotal: number;
  excludedOneOffs: CpmExcludedOneOff[];
  // FIXED vs VARIABLE split (spec item C.3) — "variable $X/mi adds cash
  // today, total $Y/mi covers everything." fixedCostPerMile +
  // variableCostPerMile === costPerMile (modulo rounding).
  fixedTotal: number;
  variableTotal: number;
  fixedCostPerMile: number | null;
  variableCostPerMile: number | null;
};

// Maps a canonical (or legacy/custom) category string to the wider CPM
// bucket label the spec groups by — several fine-grained categories
// (e.g. Truck Parts vs. Tires vs. Truck Wash & Detailing) intentionally
// collapse into one CPM bucket ("Maintenance & Repairs") since the
// per-mile breakdown is meant to answer "where does my money go" at a
// glance, not replicate the full Schedule C category list.
const CPM_BUCKET_MAP: Record<string, string> = {
  'Fuel & DEF': 'Fuel & DEF',
  'Fuel Additives': 'Fuel & DEF',
  'Maintenance & Repairs': 'Maintenance & Repairs',
  'Major Repairs & Overhauls': 'Maintenance & Repairs',
  'Truck Parts': 'Maintenance & Repairs',
  Tires: 'Maintenance & Repairs',
  'Truck Wash & Detailing': 'Maintenance & Repairs',
  'Insurance—Truck': 'Insurance',
  'Permits, Licenses & Road Taxes': 'Permits & Road Taxes',
  'Tolls & Scales': 'Tolls',
  'Parking & Lodging': 'Parking & Lodging',
  'ELD & Communications': 'ELD & Software',
  'Software & Subscriptions': 'ELD & Software',
  'Dispatch & Factoring Fees': 'Dispatch & Factoring',
  'Association Dues': 'Dues',
  'Legal & Professional Services': 'Professional Services',
  'Contract Labor (1099)': 'Driver Pay',
  'Wages & Payroll Taxes (W-2)': 'Driver Pay',
  'Truck/Trailer Payments': 'Loan/Lease Payment',
};

const CPM_EXCLUDED_CATEGORIES = new Set(['Meals (per diem covered)', 'Advance Repayment', 'Escrow & Deposits']);

// FIXED vs VARIABLE (spec item C.3) — a fixed cost is owed regardless of
// how many miles are driven this week (insurance, permits, software,
// dues, professional services, the truck payment/warranty itself); a
// variable cost scales with activity (fuel, repairs tied to wear, tolls,
// dispatch/factoring's percentage-of-revenue fee, driver pay tied to
// loads). An unmapped/custom category defaults to 'variable' — the safer
// assumption for "how much extra does one more mile cost me."
const CPM_BUCKET_TYPE: Record<string, CpmCostType> = {
  'Fuel & DEF': 'variable',
  'Maintenance & Repairs': 'variable',
  Insurance: 'fixed',
  'Permits & Road Taxes': 'fixed',
  Tolls: 'variable',
  'Parking & Lodging': 'variable',
  'ELD & Software': 'fixed',
  'Dispatch & Factoring': 'variable',
  Dues: 'fixed',
  'Professional Services': 'fixed',
  'Driver Pay': 'variable',
  'Loan/Lease Payment': 'fixed',
  Other: 'variable',
};

// Exported for app/src/stats/expenseTotalExplainer.ts (spec item D) so
// the Expense Total Explainer's fixed/variable split uses the exact same
// classification as the CPM "Why?" breakdown — one shared definition of
// "fixed" and "variable," never two.
export function typeFor(bucket: string): CpmCostType {
  return CPM_BUCKET_TYPE[bucket] ?? 'variable';
}

// Loan Center rows (loans table) store a recurring `payment` + free-text
// `frequency` ("monthly", "weekly", "bi-weekly", ...) rather than a
// normalized cadence — this converts one loan's payment to its
// weekly-equivalent so a CPM caller can sum every loan and multiply by
// the number of settlement weeks the rest of its totals cover. An
// unrecognized/missing frequency defaults to monthly, the most common
// truck-loan cadence, rather than silently treating it as $0.
export function normalizeToWeeklyPayment(payment: number, frequency: string | null | undefined): number {
  const f = (frequency ?? '').toLowerCase();
  if (f.includes('bi') || f.includes('every 2') || f.includes('fortnight')) return payment / 2;
  if (f.includes('week')) return payment;
  if (f.includes('quarter')) return (payment * 4) / 52;
  if (f.includes('year') || f.includes('annual')) return payment / 52;
  return (payment * 12) / 52; // monthly, or unrecognized — treat as monthly
}

// Exported for app/src/stats/expenseTotalExplainer.ts — see typeFor()'s
// comment above.
export function bucketFor(category: string | null | undefined): string {
  if (!category) return 'Other';
  return CPM_BUCKET_MAP[category] ?? 'Other';
}

type CpmDeduction = {
  amount: number | null;
  source?: string | null;
  category?: string | null;
  tax_deductible: boolean | null;
  description?: string | null;
};
type CpmFuel = { amount: number | null; discount?: number | null; settlement_id?: string | null };
type CpmMaintenance = { cost: number | null };
type CpmToll = { amount: number | null };

// Shared so a caller (Scorecard) can decide whether to even ask
// src/stats/truckCostBasis.ts for a loan-payment figure BEFORE calling
// calcCanonicalCpm — calcCanonicalCpm applies the identical check
// internally as its own double-count guard.
export function carrierWithholdsLoanPayment(deductions: Pick<CpmDeduction, 'source' | 'category'>[]): boolean {
  return deductions.some((d) => d.source === 'settlement' && d.category === 'Truck/Trailer Payments');
}

// `truckFixedCostTotal`/`carrierAlreadyWithholdsLoanPayment` implement the
// spec's "ONLY charge the truck's own cost basis when the carrier isn't
// already withholding a loan/lease payment (otherwise counted twice)"
// rule: a settlement whose withheld deductions already include a
// 'Truck/Trailer Payments' category row (chargebackType `loan_payment`/
// `lease_purchase_payment`) has that cost counted via the deductions
// bucket already — adding the truck cost basis's own estimate on top
// would double it. `truckFixedCostTotal` is the caller's own
// src/stats/truckCostBasis.ts `calcTruckCostBasisWeekly()` result,
// already multiplied by the number of settlement weeks this call covers
// — NEVER a synthetic estimate derived from unrelated Loan Center rows
// (the bug that produced $8.48/mi on web, spec item C.2).
export function calcCanonicalCpm(
  grossRevenue: number,
  totalMiles: number,
  deductions: CpmDeduction[],
  fuelPurchases: CpmFuel[],
  maintenanceRecords: CpmMaintenance[],
  tolls: CpmToll[],
  truckFixedCostTotal = 0
): CanonicalCpmResult {
  const carrierAlreadyWithholdsLoanPayment = carrierWithholdsLoanPayment(deductions);

  const buckets = new Map<string, number>();
  function add(category: string, amount: number) {
    if (!amount) return;
    buckets.set(category, (buckets.get(category) ?? 0) + amount);
  }

  let excludedTotal = 0;
  const excludedOneOffs: CpmExcludedOneOff[] = [];
  for (const d of deductions) {
    const amount = Number(d.amount ?? 0);
    if (CPM_EXCLUDED_CATEGORIES.has(d.category ?? '')) {
      excludedTotal += amount;
      continue;
    }
    if (!reducesTrueProfit(d)) continue; // e.g. an out-of-pocket row marked non-deductible for some other reason
    // Multi-year one-offs (spec item C.2): a major repair/overhaul or a
    // vehicle-purchase-shaped deduction would spike CPM to something
    // meaningless if divided across one week's miles — excluded from the
    // per-mile figure while still counting normally toward P&L/tax
    // (this function never touches those totals).
    if (d.category === 'Major Repairs & Overhauls') {
      excludedOneOffs.push({ description: d.description ?? d.category, amount, reason: 'major_repair_overhaul' });
      continue;
    }
    if (isVehiclePurchaseOneOff(d.description ?? undefined)) {
      excludedOneOffs.push({ description: d.description ?? 'Vehicle purchase', amount, reason: 'vehicle_purchase' });
      continue;
    }
    add(bucketFor(d.category), amount);
  }

  const standaloneFuel = fuelPurchases.filter((f) => !f.settlement_id);
  const fuelTotal = standaloneFuel.reduce((sum, f) => sum + Math.max(0, Number(f.amount ?? 0) - Number(f.discount ?? 0)), 0);
  add('Fuel & DEF', fuelTotal);

  const maintTotal = maintenanceRecords.reduce((sum, m) => sum + Number(m.cost ?? 0), 0);
  add('Maintenance & Repairs', maintTotal);

  const tollsTotal = tolls.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  add('Tolls', tollsTotal);

  if (!carrierAlreadyWithholdsLoanPayment && truckFixedCostTotal > 0) {
    add('Loan/Lease Payment', truckFixedCostTotal);
  }

  const totalCost = [...buckets.values()].reduce((sum, v) => sum + v, 0);
  const bucketList = [...buckets.entries()]
    .map(([category, amount]) => ({ category, amount, type: typeFor(category) }))
    .sort((a, b) => b.amount - a.amount);

  const fixedTotal = bucketList.filter((b) => b.type === 'fixed').reduce((sum, b) => sum + b.amount, 0);
  const variableTotal = bucketList.filter((b) => b.type === 'variable').reduce((sum, b) => sum + b.amount, 0);

  if (totalMiles <= 0) {
    return {
      revenuePerMile: null,
      costPerMile: null,
      profitPerMile: null,
      buckets: bucketList,
      excludedTotal,
      excludedOneOffs,
      fixedTotal,
      variableTotal,
      fixedCostPerMile: null,
      variableCostPerMile: null,
    };
  }
  const revenuePerMile = grossRevenue / totalMiles;
  const costPerMile = totalCost / totalMiles;
  return {
    revenuePerMile,
    costPerMile,
    profitPerMile: revenuePerMile - costPerMile,
    buckets: bucketList,
    excludedTotal,
    excludedOneOffs,
    fixedTotal,
    variableTotal,
    fixedCostPerMile: fixedTotal / totalMiles,
    variableCostPerMile: variableTotal / totalMiles,
  };
}
