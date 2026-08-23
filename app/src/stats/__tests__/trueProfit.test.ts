import { calcTrueProfit, buildWeeklyTrueProfitTrend, isDeductibleExpense, reducesTrueProfit } from '@/src/stats/trueProfit';
import type { Deduction, Settlement } from '@/src/types/db';

function sett(overrides: Partial<Settlement>): Settlement {
  return {
    id: 's1',
    user_id: 'u1',
    truck_id: null,
    driver_id: null,
    document_id: null,
    week_ending: '2026-07-18',
    gross: 3000,
    net: 2500,
    miles: 2500,
    per_diem_days: 7,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Settlement;
}

function ded(overrides: Partial<Deduction>): Deduction {
  return {
    id: 'd1',
    user_id: 'u1',
    settlement_id: null,
    driver_id: null,
    document_id: null,
    ded_date: '2026-07-18',
    code: null,
    description: null,
    amount: 100,
    category: 'Misc',
    store: null,
    payment_method: null,
    source: 'manual',
    tax_deductible: true,
    notes: null,
    tags: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Deduction;
}

describe('reducesTrueProfit', () => {
  it('excludes Escrow & Deposits regardless of source', () => {
    expect(reducesTrueProfit({ source: 'settlement', category: 'Escrow & Deposits', tax_deductible: false })).toBe(false);
    expect(reducesTrueProfit({ source: 'manual', category: 'Escrow & Deposits', tax_deductible: true })).toBe(false);
  });

  it('counts a withheld row that is neither Meals, Advance Repayment, nor Escrow & Deposits', () => {
    expect(reducesTrueProfit({ source: 'settlement', category: 'Insurance—Truck', tax_deductible: false })).toBe(true);
  });
});

describe('isDeductibleExpense', () => {
  it('is true when tax_deductible is true', () => {
    expect(isDeductibleExpense({ tax_deductible: true })).toBe(true);
  });
  it('is false when tax_deductible is explicitly false', () => {
    expect(isDeductibleExpense({ tax_deductible: false })).toBe(false);
  });
});

describe('calcTrueProfit', () => {
  it('matches a hand-computed dataset: settlement net + out-of-pocket receipts', () => {
    // One settlement: gross 3000, net 2500 (500 withheld as a chargeback,
    // already reflected in `net` — this test proves we don't double-count it).
    const settlements = [sett({ gross: 3000, net: 2500 })];
    const deductions = [
      // The withheld chargeback itself, as its own deductions row.
      ded({ id: 'withheld', amount: 500, source: 'settlement', tax_deductible: true }),
      // Out-of-pocket fuel/store receipts.
      ded({ id: 'fuel', amount: 300, source: 'manual', tax_deductible: true }),
      ded({ id: 'store', amount: 150, source: 'manual', tax_deductible: true }),
    ];
    // 3000 - (500 + 300 + 150) = 2050
    expect(calcTrueProfit(settlements, deductions)).toBe(2050);
  });

  it('never double-counts a withheld chargeback already reflected in settlement.net', () => {
    // If we naively did settlement.net (2500) - outOfPocket (450), we'd
    // get 2050 too by coincidence here — but the REAL regression this
    // guards is starting from gross and subtracting ALL deductible rows
    // exactly once, not from net (which already excludes the withheld
    // portion) and ALSO subtracting the withheld row again.
    const settlements = [sett({ gross: 3000, net: 2500 })];
    const deductions = [ded({ id: 'withheld', amount: 500, source: 'settlement', tax_deductible: true })];
    expect(calcTrueProfit(settlements, deductions)).toBe(2500); // == settlement.net, not 2000
  });

  it('excludes a Meal (per diem covered) deduction — non-deductible rows never change profit', () => {
    const settlements = [sett({ gross: 3000, net: 3000 })];
    const deductions = [
      ded({ id: 'fuel', amount: 300, tax_deductible: true }),
      ded({ id: 'meal', amount: 40, category: 'Meals (per diem covered)', tax_deductible: false }),
    ];
    expect(calcTrueProfit(settlements, deductions)).toBe(2700); // meal excluded entirely
  });

  it('excludes an Advance Repayment deduction — never a real expense', () => {
    const settlements = [sett({ gross: 3000, net: 3000 })];
    const deductions = [
      ded({ id: 'fuel', amount: 300, tax_deductible: true }),
      ded({ id: 'advance', amount: 800, category: 'Advance Repayment', tax_deductible: false }),
    ];
    expect(calcTrueProfit(settlements, deductions)).toBe(2700); // advance repayment excluded entirely
  });

  it('excludes an Escrow & Deposits deduction — a refundable deposit, never a real expense (owner decision 2026-08-02)', () => {
    const settlements = [sett({ gross: 3000, net: 3000 })];
    const deductions = [
      ded({ id: 'fuel', amount: 300, tax_deductible: true }),
      ded({ id: 'escrow', amount: 100, source: 'settlement', category: 'Escrow & Deposits', tax_deductible: false }),
    ];
    expect(calcTrueProfit(settlements, deductions)).toBe(2700); // escrow excluded entirely
  });

  it('a negative-gross-relative settlement still computes correctly, uncapped (never clamped to 0)', () => {
    // Verified against a real statement: W/E 2026-07-24, 0 miles, gross
    // $5.16, deductions $1,160.51 total (66.95 meals + 550.00 advance
    // repayment + 100.00 escrow excluded from true profit — a refundable
    // deposit/non-expense, same as meals/advance repayment; 443.56
    // genuinely deductible). NOTE: true profit here (-438.4) is
    // deliberately DIFFERENT from the settlement's own reported net pay
    // (-1155.35, gross minus EVERY withheld row including the excluded
    // ones) — that distinction, and the business-balance-delta/per-diem
    // consequences of the real net pay, are covered end-to-end in
    // src/data/__tests__/aiImportSave.negativeSettlement.test.ts.
    const settlements = [sett({ gross: 5.16, net: -1155.35, miles: 0, week_ending: '2026-07-24' })];
    const deductions = [
      ded({ id: 'meal', amount: 66.95, source: 'settlement', category: 'Meals (per diem covered)', tax_deductible: false }),
      ded({ id: 'advance', amount: 550, source: 'settlement', category: 'Advance Repayment', tax_deductible: false }),
      ded({ id: 'escrow', amount: 100, source: 'settlement', category: 'Escrow & Deposits', tax_deductible: false }),
      ded({ id: 'other', amount: 443.56, source: 'settlement', category: 'Fuel & DEF', tax_deductible: false }),
    ];
    // 5.16 - 443.56 = -438.4 (only the truly-deductible portion counts —
    // the other 716.95 in withheld rows are excluded non-expenses).
    expect(calcTrueProfit(settlements, deductions)).toBeCloseTo(-438.4, 2);
  });

  it('sums across multiple settlements and deductions', () => {
    const settlements = [sett({ id: 's1', gross: 1000 }), sett({ id: 's2', gross: 2000, week_ending: '2026-07-25' })];
    const deductions = [ded({ amount: 100 }), ded({ amount: 200 })];
    expect(calcTrueProfit(settlements, deductions)).toBe(2700);
  });

  it('is 0 with no settlements and no deductions', () => {
    expect(calcTrueProfit([], [])).toBe(0);
  });
});

describe('calcTrueProfit — canonical expense engine (owner decision 2026-08-05, FULL PARITY pass item C.2)', () => {
  it('subtracts standalone fuel/maintenance/tolls, not just deductions', () => {
    const settlements = [sett({ gross: 5000 })];
    const deductions = [ded({ amount: 100 })];
    const fuel = [{ amount: 500, discount: 20, settlement_id: null }];
    const maintenance = [{ cost: 300 }];
    const tolls = [{ amount: 50 }];
    // 5000 - 100(ded) - 480(fuel net of discount) - 300(maint) - 50(toll) = 4070
    expect(calcTrueProfit(settlements, deductions, fuel, maintenance, tolls)).toBe(4070);
  });

  it('excludes a SETTLEMENT-LINKED fuel purchase (already represented by the settlement\'s own withheld deductions) — no double count', () => {
    const settlements = [sett({ gross: 5000 })];
    const deductions = [ded({ amount: 100, source: 'settlement', category: 'Fuel & DEF' })];
    const linkedFuel = [{ amount: 480, discount: 0, settlement_id: 'sett-1' }];
    // The withheld Fuel & DEF deduction counts (100); the settlement-linked
    // fuel_purchases row does NOT get added on top of it.
    expect(calcTrueProfit(settlements, deductions, linkedFuel)).toBe(4900);
  });

  it('a standalone fuel purchase (settlement_id null) with no matching deduction is a real, previously-missed expense', () => {
    const settlements = [sett({ gross: 5000, net: 5000 })];
    const standaloneFuel = [{ amount: 480, discount: 0, settlement_id: null }];
    expect(calcTrueProfit(settlements, [], standaloneFuel)).toBe(4520);
  });

  it('defaults fuel/maintenance/tolls to empty arrays for backward compatibility', () => {
    const settlements = [sett({ gross: 3000 })];
    const deductions = [ded({ amount: 200 })];
    expect(calcTrueProfit(settlements, deductions)).toBe(2800);
  });
});

describe('buildWeeklyTrueProfitTrend', () => {
  it('produces a {weekEnding, gross, net} point per week, net excluding non-deductible rows', () => {
    const settlements = [sett({ week_ending: '2026-07-18', gross: 3000 })];
    const deductions = [
      ded({ ded_date: '2026-07-15', amount: 300, tax_deductible: true }),
      ded({ ded_date: '2026-07-16', amount: 40, category: 'Meals (per diem covered)', tax_deductible: false }),
    ];
    const trend = buildWeeklyTrueProfitTrend(settlements, deductions);
    expect(trend).toEqual([{ weekEnding: '2026-07-18', gross: 3000, net: 2700 }]);
  });

  it('scopes deductions to each settlement week\'s 7-day window, not a different week', () => {
    const settlements = [sett({ week_ending: '2026-07-18', gross: 1000 }), sett({ id: 's2', week_ending: '2026-07-25', gross: 2000 })];
    const deductions = [
      ded({ ded_date: '2026-07-16', amount: 100 }), // in week 1's window (07-12..07-18)
      ded({ ded_date: '2026-07-23', amount: 200 }), // in week 2's window (07-19..07-25)
    ];
    const trend = buildWeeklyTrueProfitTrend(settlements, deductions);
    expect(trend).toEqual([
      { weekEnding: '2026-07-18', gross: 1000, net: 900 },
      { weekEnding: '2026-07-25', gross: 2000, net: 1800 },
    ]);
  });

  it('scopes standalone fuel/maintenance/tolls to each settlement week\'s window too (owner decision 2026-08-05, FULL PARITY pass item C.2)', () => {
    const settlements = [sett({ week_ending: '2026-07-18', gross: 3000 })];
    const fuel = [
      { purchase_date: '2026-07-16', amount: 200, discount: 0, settlement_id: null }, // in window
      { purchase_date: '2026-07-01', amount: 999, discount: 0, settlement_id: null }, // outside window
      { purchase_date: '2026-07-17', amount: 300, discount: 0, settlement_id: 'sett-x' }, // settlement-linked, excluded regardless of window
    ];
    const maintenance = [{ service_date: '2026-07-15', cost: 150 }];
    const tolls = [{ toll_date: '2026-07-14', amount: 25 }];
    const trend = buildWeeklyTrueProfitTrend(settlements, [], fuel, maintenance, tolls);
    // 3000 - 200(fuel, in-window standalone only) - 150(maint) - 25(toll) = 2625
    expect(trend).toEqual([{ weekEnding: '2026-07-18', gross: 3000, net: 2625 }]);
  });

  it('sorts ascending by week_ending', () => {
    const settlements = [sett({ week_ending: '2026-07-25', gross: 100 }), sett({ id: 's2', week_ending: '2026-07-18', gross: 200 })];
    const trend = buildWeeklyTrueProfitTrend(settlements, []);
    expect(trend.map((p) => p.weekEnding)).toEqual(['2026-07-18', '2026-07-25']);
  });

  it('returns an empty array for no settlements', () => {
    expect(buildWeeklyTrueProfitTrend([], [])).toEqual([]);
  });
});
