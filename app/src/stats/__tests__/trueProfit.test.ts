import { calcTrueProfit, buildWeeklyTrueProfitTrend, isDeductibleExpense } from '@/src/stats/trueProfit';
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

  it('sums across multiple settlements and deductions', () => {
    const settlements = [sett({ id: 's1', gross: 1000 }), sett({ id: 's2', gross: 2000, week_ending: '2026-07-25' })];
    const deductions = [ded({ amount: 100 }), ded({ amount: 200 })];
    expect(calcTrueProfit(settlements, deductions)).toBe(2700);
  });

  it('is 0 with no settlements and no deductions', () => {
    expect(calcTrueProfit([], [])).toBe(0);
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

  it('sorts ascending by week_ending', () => {
    const settlements = [sett({ week_ending: '2026-07-25', gross: 100 }), sett({ id: 's2', week_ending: '2026-07-18', gross: 200 })];
    const trend = buildWeeklyTrueProfitTrend(settlements, []);
    expect(trend.map((p) => p.weekEnding)).toEqual(['2026-07-18', '2026-07-25']);
  });

  it('returns an empty array for no settlements', () => {
    expect(buildWeeklyTrueProfitTrend([], [])).toEqual([]);
  });
});
