import { calcTaxEstimate } from '@/src/tax/calcTaxEstimate';
import { sumFleetDepreciation } from '@/src/tax/depreciation';
import { fixtureTaxYearData } from '@/src/tax/__tests__/fixtures';
import {
  capitalTreatmentLabel,
  isOpenCapitalItem,
  previewVehicleChoice,
  sumFleetVehicleTax,
  vehicleDeductionExceedsIncome,
  vehicleTaxLine,
  type VehicleTaxInput,
  type VehicleTaxTreatment,
} from '@/src/tax/vehiclePurchase';
import { buildCapitalAssets } from '@/src/stats/accountantPackage';
import { capitalAssetDetail } from '@/src/stats/accountantPackageReport';
import { computeKpis } from '@/src/stats/kpi';
import type { TaxEstimateInputs } from '@/src/tax/types';
import type { Truck } from '@/src/types/db';

// Batch B (owner decision 2026-10-30): truck 283940, bought 2026-03-15 for
// $85,000 cash, with each of the three tax choices.
const YEAR = 2026;
const NET_BEFORE_VEHICLE = 120000;

const baseInputs: TaxEstimateInputs = {
  taxYearData: fixtureTaxYearData,
  filingStatus: 'mfj',
  state: 'TX',
  includeStateTax: true,
  entityType: 'sole_prop',
  scorpSalary: null,
  netProfit: 0,
};
const estimateFor = (netProfit: number) => calcTaxEstimate({ ...baseInputs, netProfit });

function truck(overrides: Partial<VehicleTaxInput & Truck> = {}): VehicleTaxInput & Truck {
  return {
    id: 'tr283940',
    user_id: 'u1',
    unit_number: '283940',
    vin: null,
    year: null,
    make: null,
    model: null,
    engine: null,
    current_odometer: null,
    fleet_mpg: null,
    apu_hours: null,
    is_active: true,
    trailer_unit_number: null,
    trailer_vin: null,
    trailer_year: null,
    trailer_make: null,
    trailer_model: null,
    purchase_price: 85000,
    purchase_date: '2026-03-15',
    financing: 'cash',
    loan_id: null,
    trailer_purchase_price: null,
    trailer_purchase_date: null,
    trailer_financing: null,
    trailer_loan_id: null,
    tags: null,
    cost_basis_ownership_mode: 'paid',
    depreciation_method: null,
    depreciation_year_placed_in_service: null,
    depreciation_spread_years: null,
    trailer_depreciation_method: null,
    trailer_depreciation_year_placed_in_service: null,
    trailer_depreciation_spread_years: null,
    purchase_tax_treatment: null,
    purchase_document_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as VehicleTaxInput & Truck;
}

// What the Tax Estimator shows (src/data/taxEstimate.ts does exactly this).
function taxEstimatorView(trucks: VehicleTaxInput[]) {
  const v = sumFleetVehicleTax(trucks, YEAR);
  const estimate = estimateFor(NET_BEFORE_VEHICLE - v.total);
  const withoutPurchase = v.purchaseDeductionTotal === 0 ? estimate : estimateFor(NET_BEFORE_VEHICLE - v.total + v.purchaseDeductionTotal);
  return { v, estimate, homeReserveMain: withoutPurchase.weeklyTaxReserve, homeReserveWith: estimate.weeklyTaxReserve };
}

describe('vehicle purchase tax treatment — each choice on truck 283940', () => {
  const before = estimateFor(NET_BEFORE_VEHICLE);

  it('deduct in the purchase year: taxable income drops by the price, only in that year', () => {
    const t = truck({ purchase_tax_treatment: 'deduct_purchase_year' });
    expect(vehicleTaxLine(t, YEAR).amount).toBe(85000);
    expect(vehicleTaxLine(t, 2027).amount).toBe(0);
    const view = taxEstimatorView([t]);
    expect(view.v.purchaseDeductionTotal).toBe(85000);
    expect(view.estimate.netProfit).toBe(35000);
    expect(view.estimate.totalTax).toBeLessThan(before.totalTax);
    // Home: the main reserve is NOT lowered; the "with" line is.
    expect(view.homeReserveMain).toBeCloseTo(before.weeklyTaxReserve, 6);
    expect(view.homeReserveWith).toBeLessThan(view.homeReserveMain);
  });

  it("don't deduct: no effect on the estimate", () => {
    const view = taxEstimatorView([truck({ purchase_tax_treatment: 'no_deduction' })]);
    expect(view.estimate).toEqual(before);
    expect(view.homeReserveMain).toBe(before.weeklyTaxReserve);
  });

  it('my tax professional decides: no effect, listed as an open capital item', () => {
    const t = truck({ purchase_tax_treatment: 'preparer_decides', purchase_document_id: 'doc1' });
    expect(taxEstimatorView([t]).estimate).toEqual(before);
    expect(isOpenCapitalItem(t)).toBe(true);
    const [row] = buildCapitalAssets([t], [], new Map([['doc1', 'Bill of sale 283940.pdf']]));
    expect(row).toMatchObject({
      type: 'truck',
      name: '283940',
      date: '2026-03-15',
      price: 85000,
      treatment: 'preparer_decides',
      openItem: true,
      documentName: 'Bill of sale 283940.pdf',
    });
    const html = capitalAssetDetail(row, {
      treatmentLabels: {
        deduct_purchase_year: 'Treatment: deduct in the purchase year',
        no_deduction: 'Treatment: not deducted',
        preparer_decides: 'Treatment: preparer decides',
        election: 'Treatment: depreciation election',
      },
      openItemTag: 'OPEN ITEM',
      documentLabel: 'Purchase document',
    });
    expect(html).toContain('Treatment: preparer decides');
    expect(html).toContain('Purchase document: Bill of sale 283940.pdf');
    expect(html).toContain('OPEN ITEM');
  });

  it('a truck with no saved choice defaults to "preparer decides" (no effect, open item)', () => {
    const t = truck();
    expect(taxEstimatorView([t]).estimate).toEqual(before);
    expect(capitalTreatmentLabel(t)).toBe('preparer_decides');
    expect(buildCapitalAssets([t], [])[0].openItem).toBe(true);
  });

  it('deduct and no-deduct are not open items; a leased truck never deducts', () => {
    expect(isOpenCapitalItem(truck({ purchase_tax_treatment: 'deduct_purchase_year' }))).toBe(false);
    expect(isOpenCapitalItem(truck({ purchase_tax_treatment: 'no_deduction' }))).toBe(false);
    const lease = truck({ cost_basis_ownership_mode: 'lease', purchase_tax_treatment: 'deduct_purchase_year' });
    expect(vehicleTaxLine(lease, YEAR).amount).toBe(0);
    expect(isOpenCapitalItem(lease)).toBe(false);
  });

  it('deduct without a purchase date or price: $0 and a warning, never a guess', () => {
    const noDate = vehicleTaxLine(truck({ purchase_tax_treatment: 'deduct_purchase_year', purchase_date: null }), YEAR);
    expect(noDate).toMatchObject({ amount: 0, missingDateOrPrice: true });
    const noPrice = vehicleTaxLine(truck({ purchase_tax_treatment: 'deduct_purchase_year', purchase_price: null }), YEAR);
    expect(noPrice).toMatchObject({ amount: 0, missingDateOrPrice: true });
  });

  it('warns when the deduction exceeds the estimated income', () => {
    expect(vehicleDeductionExceedsIncome(85000, 120000)).toBe(false);
    expect(vehicleDeductionExceedsIncome(85000, 60000)).toBe(true);
    expect(vehicleDeductionExceedsIncome(85000, -5000)).toBe(true);
    expect(vehicleDeductionExceedsIncome(0, -5000)).toBe(false);
  });
});

describe('no other tax case changes', () => {
  const elections: Array<Partial<VehicleTaxInput>> = [
    { depreciation_method: null },
    { depreciation_method: 'ask' },
    { depreciation_method: 'full', depreciation_year_placed_in_service: 2026 },
    { depreciation_method: 'full', depreciation_year_placed_in_service: 2025 },
    { depreciation_method: 'macrs', depreciation_year_placed_in_service: 2024 },
    { depreciation_method: 'spread', depreciation_year_placed_in_service: 2025, depreciation_spread_years: 5 },
    { cost_basis_ownership_mode: 'lease', depreciation_method: 'full', depreciation_year_placed_in_service: 2026 },
    { trailer_purchase_price: 40000, trailer_depreciation_method: 'macrs', trailer_depreciation_year_placed_in_service: 2026 },
    { trailer_purchase_price: 40000, trailer_depreciation_method: 'ask' },
  ];
  it.each(elections.map((e, i) => [i, e]))('election case %i: identical to the old sumFleetDepreciation()', (_i, e) => {
    const trucks = [truck(e), truck({ ...e, id: 'tr2', purchase_price: 60000 })];
    const oldWay = sumFleetDepreciation(trucks, YEAR);
    const newWay = sumFleetVehicleTax(trucks, YEAR);
    expect(newWay.total).toBe(oldWay.total);
    expect(newWay.anyRequiresCpaNote).toBe(oldWay.anyRequiresCpaNote);
    expect(newWay.purchaseDeductionTotal).toBe(0);
  });

  it('a saved choice replaces an older election for that truck only', () => {
    const older = { depreciation_method: 'full' as const, depreciation_year_placed_in_service: 2026 };
    const fleet = [truck({ ...older, purchase_tax_treatment: 'no_deduction' }), truck({ ...older, id: 'tr2', purchase_price: 60000 })];
    expect(sumFleetVehicleTax(fleet, YEAR).total).toBe(sumFleetDepreciation([fleet[1]], YEAR).total);
  });
});

describe('weekly profit and RPM/CPM/PPM never include the price', () => {
  const settlements = [{ id: 's1', truck_id: 'tr283940', week_ending: '2026-08-21', gross: 4783.75, net: 1884.73, miles: 2327, carrier: 'Prime Inc' }];
  const kpis = (treatment: VehicleTaxTreatment | null) =>
    computeKpis({
      trucks: [truck({ purchase_tax_treatment: treatment })] as never,
      settlements: settlements as never,
      loads: [],
      deductions: [],
      fuelPurchases: [],
      maintenanceRecords: [],
      tolls: [],
      reimbursements: [],
      truckScope: 'tr283940',
      window: { startIso: '2026-08-15', endIso: '2026-08-21' },
    });

  it('every KPI is identical across the three choices', () => {
    const base = kpis(null);
    for (const choice of ['deduct_purchase_year', 'no_deduction', 'preparer_decides'] as const) {
      expect(kpis(choice)).toEqual(base);
    }
  });
});

describe('all views update together from the one saved row', () => {
  it('the Trucks preview equals what the Tax Estimator, Home and Accountant Package show after saving', () => {
    const saved = truck({ purchase_tax_treatment: 'preparer_decides' });
    for (const choice of ['deduct_purchase_year', 'no_deduction', 'preparer_decides'] as const) {
      const edited = truck({ purchase_tax_treatment: choice });
      const preview = previewVehicleChoice([saved], edited, YEAR, NET_BEFORE_VEHICLE, estimateFor);
      const afterSave = taxEstimatorView([edited]);
      expect(preview.before).toEqual(taxEstimatorView([saved]).estimate);
      expect(preview.after).toEqual(afterSave.estimate);
      expect(buildCapitalAssets([edited], [])[0].treatment).toBe(choice);
      expect(buildCapitalAssets([edited], [])[0].openItem).toBe(choice === 'preparer_decides');
    }
  });

  it('the preview for a NEW truck adds it to the fleet instead of replacing one', () => {
    const existing = truck({ purchase_tax_treatment: 'deduct_purchase_year' });
    const added = truck({ id: undefined as never, unit_number: '300', purchase_price: 50000, purchase_tax_treatment: 'deduct_purchase_year' });
    const preview = previewVehicleChoice([existing], added, YEAR, NET_BEFORE_VEHICLE, estimateFor);
    expect(preview.beforeDeduction).toBe(85000);
    expect(preview.afterDeduction).toBe(135000);
    expect(preview.exceedsIncome).toBe(true);
  });
});
