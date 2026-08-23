import { calcCurrentYearDepreciation, sumFleetDepreciation, type DepreciationElectionInput } from '@/src/tax/depreciation';

const base: DepreciationElectionInput = {
  purchasePrice: 120000,
  ownershipMode: 'paid',
  method: null,
  yearPlacedInService: 2025,
  spreadYears: null,
};

describe('calcCurrentYearDepreciation', () => {
  it('is unconfigured with $0 when nothing is set yet — never a silent guess', () => {
    const result = calcCurrentYearDepreciation({ ...base, method: null }, 'tractor', 2026);
    expect(result.isConfigured).toBe(false);
    expect(result.currentYearDepreciation).toBe(0);
  });

  it('is unconfigured with $0 when purchasePrice or yearPlacedInService is missing', () => {
    expect(calcCurrentYearDepreciation({ ...base, method: 'full', purchasePrice: null }, 'tractor', 2026).isConfigured).toBe(false);
    expect(calcCurrentYearDepreciation({ ...base, method: 'full', yearPlacedInService: null }, 'tractor', 2026).isConfigured).toBe(false);
  });

  it('skips entirely for a leased truck, regardless of any other field', () => {
    const result = calcCurrentYearDepreciation({ ...base, ownershipMode: 'lease', method: 'macrs' }, 'tractor', 2026);
    expect(result.skippedAsLease).toBe(true);
    expect(result.currentYearDepreciation).toBe(0);
  });

  it('"ask" defers to the CPA — $0 in the estimate, flagged with a note', () => {
    const result = calcCurrentYearDepreciation({ ...base, method: 'ask' }, 'tractor', 2026);
    expect(result.requiresCpaNote).toBe(true);
    expect(result.currentYearDepreciation).toBe(0);
    expect(result.isConfigured).toBe(true);
  });

  it('"full" (Section 179/bonus) expenses 100% in the placed-in-service year only', () => {
    const yearOne = calcCurrentYearDepreciation({ ...base, method: 'full', yearPlacedInService: 2026 }, 'tractor', 2026);
    expect(yearOne.currentYearDepreciation).toBe(120000);
    const yearTwo = calcCurrentYearDepreciation({ ...base, method: 'full', yearPlacedInService: 2026 }, 'tractor', 2027);
    expect(yearTwo.currentYearDepreciation).toBe(0);
  });

  it('"macrs" applies the tractor 3-year table by recovery year', () => {
    const yearPlacedInService = 2026;
    const y1 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'tractor', 2026);
    const y2 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'tractor', 2027);
    const y3 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'tractor', 2028);
    const y4 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'tractor', 2029);
    const y5 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'tractor', 2030);
    expect(y1.currentYearDepreciation).toBeCloseTo(120000 * 0.3333, 2);
    expect(y2.currentYearDepreciation).toBeCloseTo(120000 * 0.4445, 2);
    expect(y3.currentYearDepreciation).toBeCloseTo(120000 * 0.1481, 2);
    expect(y4.currentYearDepreciation).toBeCloseTo(120000 * 0.0741, 2);
    expect(y5.currentYearDepreciation).toBe(0); // fully depreciated after 4 years
  });

  it('"macrs" applies the trailer 5-year table, distinct from the tractor table', () => {
    const yearPlacedInService = 2026;
    const y1 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'trailer', 2026);
    const y6 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'trailer', 2031);
    const y7 = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService }, 'trailer', 2032);
    expect(y1.currentYearDepreciation).toBeCloseTo(120000 * 0.2, 2);
    expect(y6.currentYearDepreciation).toBeCloseTo(120000 * 0.0576, 2);
    expect(y7.currentYearDepreciation).toBe(0); // fully depreciated after 6 years
  });

  it('"spread" (straight line) divides evenly across the chosen years, then stops', () => {
    const yearPlacedInService = 2026;
    const input: DepreciationElectionInput = { ...base, method: 'spread', spreadYears: 4, yearPlacedInService };
    expect(calcCurrentYearDepreciation(input, 'tractor', 2026).currentYearDepreciation).toBe(30000);
    expect(calcCurrentYearDepreciation(input, 'tractor', 2029).currentYearDepreciation).toBe(30000);
    expect(calcCurrentYearDepreciation(input, 'tractor', 2030).currentYearDepreciation).toBe(0);
  });

  it('"spread" defaults to 5 years when spreadYears is unset', () => {
    const input: DepreciationElectionInput = { ...base, method: 'spread', spreadYears: null, yearPlacedInService: 2026 };
    expect(calcCurrentYearDepreciation(input, 'tractor', 2026).currentYearDepreciation).toBe(24000);
  });

  it('returns $0 for a tax year before the asset was placed in service', () => {
    const result = calcCurrentYearDepreciation({ ...base, method: 'macrs', yearPlacedInService: 2027 }, 'tractor', 2026);
    expect(result.currentYearDepreciation).toBe(0);
    expect(result.isConfigured).toBe(true);
  });
});

describe('sumFleetDepreciation', () => {
  it('sums current-year depreciation across every truck and its own trailer independently', () => {
    const result = sumFleetDepreciation(
      [
        {
          purchase_price: 120000,
          cost_basis_ownership_mode: 'paid',
          depreciation_method: 'full',
          depreciation_year_placed_in_service: 2026,
          depreciation_spread_years: null,
          trailer_purchase_price: 30000,
          trailer_depreciation_method: 'full',
          trailer_depreciation_year_placed_in_service: 2026,
          trailer_depreciation_spread_years: null,
        },
      ],
      2026
    );
    expect(result.total).toBe(150000);
    expect(result.anyRequiresCpaNote).toBe(false);
  });

  it('a leased tractor with a purchased trailer only depreciates the trailer', () => {
    const result = sumFleetDepreciation(
      [
        {
          purchase_price: 120000,
          cost_basis_ownership_mode: 'lease',
          depreciation_method: 'full',
          depreciation_year_placed_in_service: 2026,
          depreciation_spread_years: null,
          trailer_purchase_price: 30000,
          trailer_depreciation_method: 'full',
          trailer_depreciation_year_placed_in_service: 2026,
          trailer_depreciation_spread_years: null,
        },
      ],
      2026
    );
    expect(result.total).toBe(30000);
  });

  it('flags anyRequiresCpaNote when at least one asset defers to "ask"', () => {
    const result = sumFleetDepreciation(
      [
        {
          purchase_price: 120000,
          cost_basis_ownership_mode: 'paid',
          depreciation_method: 'ask',
          depreciation_year_placed_in_service: 2026,
          depreciation_spread_years: null,
          trailer_purchase_price: null,
          trailer_depreciation_method: null,
          trailer_depreciation_year_placed_in_service: null,
          trailer_depreciation_spread_years: null,
        },
      ],
      2026
    );
    expect(result.total).toBe(0);
    expect(result.anyRequiresCpaNote).toBe(true);
  });

  it('a truck with no trailer purchase price skips the trailer entirely (no $0-shaped noise)', () => {
    const result = sumFleetDepreciation(
      [
        {
          purchase_price: 120000,
          cost_basis_ownership_mode: 'paid',
          depreciation_method: 'full',
          depreciation_year_placed_in_service: 2026,
          depreciation_spread_years: null,
          trailer_purchase_price: null,
          trailer_depreciation_method: null,
          trailer_depreciation_year_placed_in_service: null,
          trailer_depreciation_spread_years: null,
        },
      ],
      2026
    );
    expect(result.total).toBe(120000);
  });
});
