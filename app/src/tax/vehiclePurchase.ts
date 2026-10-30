import { calcCurrentYearDepreciation, type DepreciationMethod } from '@/src/tax/depreciation';
import { yearOf, isDateOnly } from '@/src/lib/dateOnly';

// VEHICLE PURCHASE AND TAX TREATMENT (owner decision 2026-10-30, master
// plan batch B). The trace behind this module: the truck's choice lived in
// `depreciation_method` (full/macrs/spread/ask), read by the Tax Estimator
// through sumFleetDepreciation() (src/data/taxEstimate.ts) — but "full"
// stayed $0 unless a separate "year placed in service" was typed
// (depreciation.ts: no year -> not configured; the purchase date was never
// used), "ask my CPA" is $0 by design, and "don't deduct" did not exist.
//
// The owner's three choices (trucks.purchase_tax_treatment, PENDING_SQL §81):
// - deduct_purchase_year: the price lowers the estimate's taxable income in
//   the purchase-date year (an estimate — the tax professional decides the
//   real treatment);
// - no_deduction: no effect;
// - preparer_decides (default): no effect; listed in the Accountant Package
//   as an open capital item.
// No depreciation law is encoded here. A truck WITHOUT a treatment keeps its
// existing election exactly (calcCurrentYearDepreciation), so no other tax
// case changes. The price never enters weekly profit or RPM/CPM/PPM — only
// the existing truck cost-basis estimate does (truckCostBasis.ts).

export type VehicleTaxTreatment = 'deduct_purchase_year' | 'no_deduction' | 'preparer_decides';
export const VEHICLE_TAX_TREATMENTS: VehicleTaxTreatment[] = ['deduct_purchase_year', 'no_deduction', 'preparer_decides'];
export const DEFAULT_VEHICLE_TAX_TREATMENT: VehicleTaxTreatment = 'preparer_decides';

export type VehicleTaxInput = {
  id?: string;
  unit_number?: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
  cost_basis_ownership_mode: 'paid' | 'loan' | 'lease' | null;
  purchase_tax_treatment?: VehicleTaxTreatment | null;
  purchase_document_id?: string | null;
  depreciation_method: DepreciationMethod | null;
  depreciation_year_placed_in_service: number | null;
  depreciation_spread_years: number | null;
  trailer_purchase_price: number | null;
  trailer_depreciation_method: DepreciationMethod | null;
  trailer_depreciation_year_placed_in_service: number | null;
  trailer_depreciation_spread_years: number | null;
};

export function purchaseYear(t: Pick<VehicleTaxInput, 'purchase_date'>): number | null {
  return t.purchase_date && isDateOnly(t.purchase_date) ? yearOf(t.purchase_date) : null;
}

// The treatment shown and applied: the owner's choice, else the default.
// `explicit` is false for a truck that never saved a choice (its existing
// election, if any, still applies — see vehicleTaxLine()).
export function effectiveTreatment(t: Pick<VehicleTaxInput, 'purchase_tax_treatment'>): { treatment: VehicleTaxTreatment; explicit: boolean } {
  return t.purchase_tax_treatment ? { treatment: t.purchase_tax_treatment, explicit: true } : { treatment: DEFAULT_VEHICLE_TAX_TREATMENT, explicit: false };
}

export type VehicleTaxLine = {
  // Lowers the estimate's net profit for this tax year.
  amount: number;
  // 'treatment' = the owner's three-way choice decided it; 'election' = the
  // truck's older depreciation election (no treatment saved yet).
  source: 'treatment' | 'election' | 'none';
  // The deduct choice is set but there is no purchase date / price yet.
  missingDateOrPrice: boolean;
  requiresCpaNote: boolean;
  openCapitalItem: boolean;
};

export function vehicleTaxLine(t: VehicleTaxInput, taxYear: number): VehicleTaxLine {
  const price = Number(t.purchase_price ?? 0);
  const lease = t.cost_basis_ownership_mode === 'lease';
  if (t.purchase_tax_treatment) {
    if (lease) return { amount: 0, source: 'none', missingDateOrPrice: false, requiresCpaNote: false, openCapitalItem: false };
    if (t.purchase_tax_treatment === 'deduct_purchase_year') {
      const year = purchaseYear(t);
      if (!year || price <= 0) return { amount: 0, source: 'treatment', missingDateOrPrice: true, requiresCpaNote: false, openCapitalItem: false };
      return { amount: year === taxYear ? price : 0, source: 'treatment', missingDateOrPrice: false, requiresCpaNote: false, openCapitalItem: false };
    }
    if (t.purchase_tax_treatment === 'no_deduction') {
      return { amount: 0, source: 'treatment', missingDateOrPrice: false, requiresCpaNote: false, openCapitalItem: false };
    }
    return { amount: 0, source: 'treatment', missingDateOrPrice: false, requiresCpaNote: false, openCapitalItem: price > 0 };
  }
  // No treatment saved: the existing election, unchanged.
  const election = calcCurrentYearDepreciation(
    {
      purchasePrice: t.purchase_price,
      ownershipMode: t.cost_basis_ownership_mode,
      method: t.depreciation_method,
      yearPlacedInService: t.depreciation_year_placed_in_service,
      spreadYears: t.depreciation_spread_years,
    },
    'tractor',
    taxYear
  );
  const undecided = !t.depreciation_method || t.depreciation_method === 'ask';
  return {
    amount: election.currentYearDepreciation,
    source: election.currentYearDepreciation > 0 ? 'election' : 'none',
    missingDateOrPrice: false,
    requiresCpaNote: election.requiresCpaNote,
    openCapitalItem: !lease && price > 0 && undecided,
  };
}

export type FleetVehicleTax = {
  // Everything that lowers the estimate (tractor lines + trailer elections).
  total: number;
  // The part that came from the owner's "deduct in the purchase year" choice.
  purchaseDeductionTotal: number;
  anyRequiresCpaNote: boolean;
  anyMissingDateOrPrice: boolean;
};

export function sumFleetVehicleTax(trucks: VehicleTaxInput[], taxYear: number): FleetVehicleTax {
  let total = 0;
  let purchaseDeductionTotal = 0;
  let anyRequiresCpaNote = false;
  let anyMissingDateOrPrice = false;
  for (const t of trucks) {
    const line = vehicleTaxLine(t, taxYear);
    total += line.amount;
    if (line.source === 'treatment') purchaseDeductionTotal += line.amount;
    if (line.requiresCpaNote) anyRequiresCpaNote = true;
    if (line.missingDateOrPrice) anyMissingDateOrPrice = true;
    if (t.trailer_purchase_price) {
      const trailer = calcCurrentYearDepreciation(
        {
          purchasePrice: t.trailer_purchase_price,
          ownershipMode: null,
          method: t.trailer_depreciation_method,
          yearPlacedInService: t.trailer_depreciation_year_placed_in_service,
          spreadYears: t.trailer_depreciation_spread_years,
        },
        'trailer',
        taxYear
      );
      total += trailer.currentYearDepreciation;
      if (trailer.requiresCpaNote) anyRequiresCpaNote = true;
    }
  }
  return { total, purchaseDeductionTotal, anyRequiresCpaNote, anyMissingDateOrPrice };
}

// Warn when the purchase deduction is bigger than the estimated income it
// is taken from (the estimate then shows a business loss).
export function vehicleDeductionExceedsIncome(deduction: number, netProfitBeforeVehicle: number): boolean {
  return deduction > 0 && deduction > Math.max(0, netProfitBeforeVehicle);
}

// What the Accountant Package prints as the truck's treatment:
// the saved choice, else 'election' when an older depreciation election
// decides it, else the default (preparer decides).
export type CapitalTreatmentLabel = VehicleTaxTreatment | 'election';

export function capitalTreatmentLabel(t: Pick<VehicleTaxInput, 'purchase_tax_treatment' | 'depreciation_method'>): CapitalTreatmentLabel {
  if (t.purchase_tax_treatment) return t.purchase_tax_treatment;
  if (t.depreciation_method && t.depreciation_method !== 'ask') return 'election';
  return DEFAULT_VEHICLE_TAX_TREATMENT;
}

// An open capital item: a purchased (not leased) truck whose treatment is
// still the preparer's decision.
export function isOpenCapitalItem(
  t: Pick<VehicleTaxInput, 'purchase_price' | 'cost_basis_ownership_mode' | 'purchase_tax_treatment' | 'depreciation_method'>
): boolean {
  if (!t.purchase_price || Number(t.purchase_price) <= 0 || t.cost_basis_ownership_mode === 'lease') return false;
  return capitalTreatmentLabel(t) === 'preparer_decides';
}

// The Trucks form's "effect on your estimate" preview: the fleet's vehicle
// tax with this truck's unsaved values in place of its saved row (or added,
// for a new truck), run through the SAME estimate (`estimateFor` wraps
// calcTaxEstimate — src/data/taxEstimate.ts estimateForNetProfit()).
export type VehicleChoicePreview<E> = {
  before: E;
  after: E;
  beforeDeduction: number;
  afterDeduction: number;
  exceedsIncome: boolean;
};

export function previewVehicleChoice<E>(
  savedTrucks: VehicleTaxInput[],
  candidate: VehicleTaxInput,
  taxYear: number,
  netProfitBeforeVehicle: number,
  estimateFor: (netProfit: number) => E
): VehicleChoicePreview<E> {
  const beforeTax = sumFleetVehicleTax(savedTrucks, taxYear);
  const replaced = candidate.id ? savedTrucks.some((t) => t.id === candidate.id) : false;
  const nextTrucks = replaced ? savedTrucks.map((t) => (t.id === candidate.id ? candidate : t)) : [...savedTrucks, candidate];
  const afterTax = sumFleetVehicleTax(nextTrucks, taxYear);
  return {
    before: estimateFor(netProfitBeforeVehicle - beforeTax.total),
    after: estimateFor(netProfitBeforeVehicle - afterTax.total),
    beforeDeduction: beforeTax.total,
    afterDeduction: afterTax.total,
    exceedsIncome: vehicleDeductionExceedsIncome(afterTax.purchaseDeductionTotal, netProfitBeforeVehicle),
  };
}
