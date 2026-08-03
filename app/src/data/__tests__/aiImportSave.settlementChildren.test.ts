// CRITICAL DATA BUG (device feedback 2026-07-31): "settlement CHILD ROWS
// are missing or unreachable — Fuel and Reimbursements screens are
// completely EMPTY, Cash Flow shows only revenue/net-30d with none of the
// settlement's expenses subtracted, and Best/Worst Lanes is empty." This
// end-to-end test exercises the REAL saveExtraction() -> mapSettlement()
// path against an in-memory fake Supabase client, then feeds the actual
// saved rows through the actual screen-facing stat functions
// (groupByMonth, calcTrueProfit, cashFlowForecast's trailing averages) —
// proving the whole chain from import to what each screen would render,
// not just that a mapper function returns the right shape in isolation.
import type { Extraction } from '@/src/import/types';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    async bytes() {
      return new Uint8Array();
    }
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { saveExtraction } from '@/src/data/aiImportSave';
import { groupByMonth, UNKNOWN_MONTH_KEY } from '@/src/stats/monthGroups';
import { calcTrueProfit } from '@/src/stats/trueProfit';
import { trailingWeeklyFuelAverage, trailingWeeklyOtherExpenseAverage, trailingWeeklyInsuranceAverage } from '@/src/stats/cashFlowForecast';
import { rankLoadsByRpm } from '@/src/stats/cashFlowTrend';
import type { Deduction, FuelPurchase, Load, Reimbursement, Settlement } from '@/src/types/db';

const USER_ID = 'user-1';
const WEEK_ENDING = '2026-07-26';

// A realistic carrier settlement: the settlement itself prints a week-
// ending date, but individual fuel/reimbursement/withheld-deduction line
// items on the statement do NOT each print their own date (the common
// case) — this is exactly the shape that triggered the null-date bug.
function settlementExtraction(): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: WEEK_ENDING,
      grossRevenue: 4000,
      netPay: 3200,
      totalMiles: 2200,
      loads: [
        { order: 'L1', from: 'Dallas, TX', to: 'Atlanta, GA', loadedMiles: 800, revenue: 2000 },
        { order: 'L2', from: 'Atlanta, GA', to: 'Miami, FL', loadedMiles: 660, revenue: 2000 },
      ],
      tractorFuel: [{ location: 'Pilot #212', gallons: 120, amount: 480 }],
      reeferFuel: [{ location: 'Pilot #212', gallons: 40, amount: 160 }],
      reimbursementItems: [{ desc: 'Lumper fee', ref: 'L1', amount: 75 }],
      deductions: [{ code: 'INS', desc: 'Weekly insurance', amount: 200 }],
    },
  };
}

function baseParams(extraction: Extraction) {
  return {
    extraction,
    userId: USER_ID,
    truckId: null,
    driverId: null,
    driverShareAmount: null,
    fileUri: null,
    fileExt: 'jpg',
    mediaType: 'image/jpeg',
    createContribution: false,
  };
}

beforeEach(() => {
  mockClient = createFakeSupabase({
    profiles: [{ user_id: USER_ID, business_balance: 0 }],
  });
});

describe('settlement import end-to-end: child rows reach every dependent screen/calc', () => {
  test('fuel, reimbursements, loads, and withheld deductions are all inserted', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    expect(mockClient.__store.fuel_purchases).toHaveLength(2);
    expect(mockClient.__store.reimbursements).toHaveLength(1);
    expect(mockClient.__store.loads).toHaveLength(2);
    expect(mockClient.__store.deductions).toHaveLength(1);
  });

  test('child rows with no per-line date inherit the settlement week_ending, never null', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];
    const reimb = mockClient.__store.reimbursements as Reimbursement[];
    const ded = mockClient.__store.deductions as Deduction[];
    const loads = mockClient.__store.loads as Load[];

    for (const f of fuel) expect(f.purchase_date).toBe(WEEK_ENDING);
    for (const r of reimb) expect(r.reimb_date).toBe(WEEK_ENDING);
    for (const d of ded) expect(d.ded_date).toBe(WEEK_ENDING);
    for (const l of loads) expect(l.load_date).toBe(WEEK_ENDING);
  });

  test('Fuel/Reimbursements/Loads screens (MonthGroupedList) bucket these rows into a real month, expanded by default', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];
    const reimb = mockClient.__store.reimbursements as Reimbursement[];
    const loads = mockClient.__store.loads as Load[];

    const fuelGroups = groupByMonth(fuel, (x) => x.purchase_date, (x) => Number(x.amount ?? 0));
    const reimbGroups = groupByMonth(reimb, (x) => x.reimb_date, (x) => Number(x.amount ?? 0));
    const loadGroups = groupByMonth(loads, (x) => x.load_date, (x) => Number(x.revenue ?? 0));

    for (const groups of [fuelGroups, reimbGroups, loadGroups]) {
      expect(groups.some((g) => g.monthKey === UNKNOWN_MONTH_KEY)).toBe(false);
      expect(groups.some((g) => g.monthKey === WEEK_ENDING.slice(0, 7))).toBe(true);
    }
  });

  test('Cash Flow / Home / Scorecard: true profit subtracts the settlement-withheld deduction, not just out-of-pocket', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const settlements = mockClient.__store.settlements as Settlement[];
    const deductions = mockClient.__store.deductions as Deduction[];

    // gross 4000 - withheld insurance 200 = 3800 (regression guard for the
    // bug where withheld rows were silently excluded from true profit).
    expect(calcTrueProfit(settlements, deductions)).toBe(3800);
  });

  test('Cash Flow budget defaults: trailing fuel/insurance averages reflect the imported settlement', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];
    const deductions = mockClient.__store.deductions as Deduction[];
    const tolls: { toll_date: string | null; amount: number | null }[] = [];

    const today = new Date(`${WEEK_ENDING}T12:00:00`);
    const fuelAvg = trailingWeeklyFuelAverage(fuel, today);
    const insuranceAvg = trailingWeeklyInsuranceAverage(deductions);
    const otherAvg = trailingWeeklyOtherExpenseAverage(deductions, tolls, today);

    expect(fuelAvg).toBeGreaterThan(0); // (480 + 160) / 4 weeks
    // "Weekly insurance" (owner decision 2026-08-04, Cash Flow auto-fill
    // fix) is now correctly classified as Insurance—Truck via
    // isInsuranceChargeback()'s text fallback (this fixture's row has no
    // chargebackType/category set), so it counts toward the DEDICATED
    // Insurance average, not the generic "Other" bucket — proving the
    // fix end to end, not just in isolation.
    expect(insuranceAvg).toBeGreaterThan(0); // 200 / 4 weeks
    expect(otherAvg).toBe(0); // no longer double-counted here
  });

  test('Best/Worst Lanes: loads with origin/destination/loaded miles/revenue rank correctly', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const loads = mockClient.__store.loads as Load[];
    const { best, worst, avgRpm } = rankLoadsByRpm(loads);

    expect(avgRpm).not.toBeNull();
    expect(best.length).toBeGreaterThan(0);
    expect(worst.length).toBeGreaterThan(0);
    // Atlanta->Miami: 2000/660 ≈ $3.03/mi beats Dallas->Atlanta: 2000/800 = $2.50/mi.
    expect(best[0].origin).toBe('Atlanta, GA');
  });
});
