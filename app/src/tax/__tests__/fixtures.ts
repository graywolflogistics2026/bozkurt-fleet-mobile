import type { TaxYearData } from '@/src/types/db';

// Federal/SE/per-diem/quarterly figures mirror the LIVE 2026 tax_year_data
// row (docs/PENDING_SQL.md §3b), ported verbatim from legacy calcTax() when
// that row was seeded. The CA `bracket` table below is a TEST-ONLY,
// synthetic fixture with round numbers, deliberately NOT the real FTB
// Schedule X/Y/Z figures — the live row does hold the real, verified
// numeric arrays for CA (confirmed 2026-07-05, see docs/ADMIN_RUNBOOK.md),
// but per that runbook's own guidance, no copy of the real inflation-
// indexed thresholds should live outside the database either, including
// here — this fixture just needs SOME valid BracketTable shape to exercise
// the bracket-loop code path deterministically. MA's `flat` rate (5%) is
// its real, stable, long-published rate — used here so the
// flat_adjustments surtax path has something real to layer on top of, per
// ADMIN_RUNBOOK's note that MA's own bare rate isn't itemized yet.
export const fixtureTaxYearData: TaxYearData = {
  tax_year: 2026,
  federal_brackets: {
    mfj: [
      [0, 23850, 0.1],
      [23850, 96950, 0.12],
      [96950, 206700, 0.22],
      [206700, 394600, 0.24],
      [394600, 501050, 0.32],
      [501050, 751600, 0.35],
      [751600, null, 0.37],
    ],
    single: [
      [0, 11925, 0.1],
      [11925, 48475, 0.12],
      [48475, 103350, 0.22],
      [103350, 197300, 0.24],
      [197300, 250525, 0.32],
      [250525, 626350, 0.35],
      [626350, null, 0.37],
    ],
    hoh: [
      [0, 11925, 0.1],
      [11925, 48475, 0.12],
      [48475, 103350, 0.22],
      [103350, 197300, 0.24],
      [197300, 250525, 0.32],
      [250525, 626350, 0.35],
      [626350, null, 0.37],
    ],
  },
  standard_deduction: { mfj: 30000, single: 15000, hoh: 22500 },
  se_tax: { rate: 0.153, factor: 0.9235, ss_wage_base: 184500 },
  per_diem: { daily_rate: 64, deductible_pct: 100 },
  quarterly_deadlines: [
    ['Q1', '2026-04-15'],
    ['Q2', '2026-06-15'],
    ['Q3', '2026-09-15'],
    ['Q4', '2027-01-15'],
  ],
  state_tax: {
    no_tax: ['TX', 'FL', 'TN', 'WA', 'NV', 'SD', 'WY', 'AK', 'NH'],
    flat: { NC: 0.0399, GA: 0.0499, UT: 0.0445, OH: 0.0275, IL: 0.0495, PA: 0.0307, MA: 0.05 },
    flat_adjustments: {
      OH: { exempt_below: 26050 },
      MA: { surtax_rate: 0.04, surtax_over: 1000000 },
    },
    bracket: {
      CA: {
        single: [
          [0, 10000, 0.01],
          [10000, 50000, 0.04],
          [50000, 100000, 0.06],
          [100000, null, 0.09],
        ],
        mfj: [
          [0, 20000, 0.01],
          [20000, 100000, 0.04],
          [100000, 200000, 0.06],
          [200000, null, 0.09],
        ],
        hoh: [
          [0, 15000, 0.01],
          [15000, 75000, 0.04],
          [75000, 150000, 0.06],
          [150000, null, 0.09],
        ],
      },
    },
    fallback_effective_rate: 0.045,
  },
  published: true,
  notes: 'Test fixture',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
