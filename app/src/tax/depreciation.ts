// DEPRECIATION ELECTION (owner decision 2026-08-05, FULL PARITY follow-up
// item E) — purchased trucks/trailers only. This is a TAX concept,
// deliberately separate from CPM's "economic monthly spread" of a
// paid-off truck's purchase price (app/src/stats/truckCostBasis.ts,
// PART C) — that spread is about understanding per-mile cost TODAY, this
// module is about the actual tax-deductible depreciation EXPENSE for the
// current tax year. The two numbers are unrelated and must never be
// confused or added together.
//
// The MACRS half-year-convention percentages below are fixed by IRS Pub.
// 946 / IRC §168's recovery-period tables — they do NOT change per tax
// year (unlike brackets, SE-tax rate, or per diem, which DO and which
// CLAUDE.md invariant #6 requires sourcing from `tax_year_data`).
// Hardcoding them here follows the same "fixed by IRS form/code
// structure, not an annually-published figure" precedent already
// established by app/src/import/category.ts's `SCHEDULE_C_LINE` mapping.
export type DepreciationMethod = 'full' | 'macrs' | 'spread' | 'ask';
export type DepreciationAssetType = 'tractor' | 'trailer';

// 3-year property (tractors), half-year convention.
const MACRS_TRACTOR_3YR = [0.3333, 0.4445, 0.1481, 0.0741];
// 5-year property (trailers), half-year convention.
const MACRS_TRAILER_5YR = [0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576];

const DEFAULT_SPREAD_YEARS = 5;

export type DepreciationElectionInput = {
  purchasePrice: number | null;
  // 'lease' (app/src/stats/truckCostBasis.ts's cost_basis_ownership_mode,
  // PART C) means the owner doesn't own the asset — never depreciable,
  // skipped entirely regardless of any other field.
  ownershipMode: 'paid' | 'loan' | 'lease' | null;
  method: DepreciationMethod | null;
  yearPlacedInService: number | null;
  // Only used when method === 'spread'; defaults to 5 years when unset.
  spreadYears: number | null;
};

export type DepreciationLineResult = {
  currentYearDepreciation: number;
  // false when the truck genuinely has nothing configured yet (no
  // guess — the UI shows a "not set" prompt in this case, never $0
  // presented as a real computed answer).
  isConfigured: boolean;
  // method === 'ask' — the owner deferred this to their CPA; shown as its
  // own note, current-year depreciation stays $0 in the estimate rather
  // than guessing a method on the owner's behalf.
  requiresCpaNote: boolean;
  skippedAsLease: boolean;
};

export function calcCurrentYearDepreciation(
  input: DepreciationElectionInput,
  assetType: DepreciationAssetType,
  taxYear: number
): DepreciationLineResult {
  if (input.ownershipMode === 'lease') {
    return { currentYearDepreciation: 0, isConfigured: false, requiresCpaNote: false, skippedAsLease: true };
  }
  if (!input.method || !input.purchasePrice || input.purchasePrice <= 0 || !input.yearPlacedInService) {
    return { currentYearDepreciation: 0, isConfigured: false, requiresCpaNote: false, skippedAsLease: false };
  }
  if (input.method === 'ask') {
    return { currentYearDepreciation: 0, isConfigured: true, requiresCpaNote: true, skippedAsLease: false };
  }

  const recoveryYear = taxYear - input.yearPlacedInService + 1;
  if (recoveryYear < 1) {
    // Not yet placed in service as of this tax year.
    return { currentYearDepreciation: 0, isConfigured: true, requiresCpaNote: false, skippedAsLease: false };
  }

  if (input.method === 'full') {
    // Section 179 / bonus depreciation: 100% expensed in the
    // placed-in-service year, $0 every year after.
    return {
      currentYearDepreciation: recoveryYear === 1 ? input.purchasePrice : 0,
      isConfigured: true,
      requiresCpaNote: false,
      skippedAsLease: false,
    };
  }

  if (input.method === 'macrs') {
    const table = assetType === 'tractor' ? MACRS_TRACTOR_3YR : MACRS_TRAILER_5YR;
    const pct = table[recoveryYear - 1] ?? 0;
    return { currentYearDepreciation: input.purchasePrice * pct, isConfigured: true, requiresCpaNote: false, skippedAsLease: false };
  }

  // 'spread' — straight line over the owner's chosen number of years.
  const years = input.spreadYears && input.spreadYears > 0 ? input.spreadYears : DEFAULT_SPREAD_YEARS;
  const inRange = recoveryYear <= years;
  return {
    currentYearDepreciation: inRange ? input.purchasePrice / years : 0,
    isConfigured: true,
    requiresCpaNote: false,
    skippedAsLease: false,
  };
}

export type TruckDepreciationInput = {
  purchase_price: number | null;
  cost_basis_ownership_mode: 'paid' | 'loan' | 'lease' | null;
  depreciation_method: DepreciationMethod | null;
  depreciation_year_placed_in_service: number | null;
  depreciation_spread_years: number | null;
  trailer_purchase_price: number | null;
  trailer_depreciation_method: DepreciationMethod | null;
  trailer_depreciation_year_placed_in_service: number | null;
  trailer_depreciation_spread_years: number | null;
};

export type FleetDepreciationResult = {
  total: number;
  // true when ANY asset's method is 'ask' — the tax estimate shows one
  // shared CPA-decision note rather than one per asset.
  anyRequiresCpaNote: boolean;
};

// Sums current-year depreciation across every truck AND its folded-in
// trailer (CLAUDE.md invariant #25's "trailer's financing is independent
// of its tractor's" — same independence applies to depreciation).
export function sumFleetDepreciation(trucks: TruckDepreciationInput[], taxYear: number): FleetDepreciationResult {
  let total = 0;
  let anyRequiresCpaNote = false;

  for (const t of trucks) {
    const tractor = calcCurrentYearDepreciation(
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
    total += tractor.currentYearDepreciation;
    if (tractor.requiresCpaNote) anyRequiresCpaNote = true;

    if (t.trailer_purchase_price) {
      const trailer = calcCurrentYearDepreciation(
        {
          purchasePrice: t.trailer_purchase_price,
          // Trailers have no separate lease concept yet (only
          // 'cash'|'loan' financing, CLAUDE.md invariant #25) — never
          // skipped as a lease.
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

  return { total, anyRequiresCpaNote };
}
