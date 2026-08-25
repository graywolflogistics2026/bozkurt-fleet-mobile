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
import { buildSpendEvents } from '@/src/stats/cashFlowForecast';
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

  test('Cash Flow forecast: settlement-derived spend events reflect the imported settlement, and never double-count settlement-linked fuel', async () => {
    await saveExtraction(baseParams(settlementExtraction()));

    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];
    const deductions = mockClient.__store.deductions as Deduction[];
    const tolls: { toll_date: string | null; amount: number | null }[] = [];

    const events = buildSpendEvents(deductions, fuel, [], tolls, '2020-01-01');
    // "Weekly insurance" (owner decision 2026-08-04, Cash Flow auto-fill
    // fix) is still correctly classified as Insurance—Truck via
    // isInsuranceChargeback()'s text fallback (this fixture's row has no
    // chargebackType/category set) — buildSpendEvents() reads the SAME
    // saved `category` column, proving the fix still flows end to end
    // through the rebuilt cash-flow pipeline, not just in isolation.
    const insuranceEvents = events.filter((e) => e.category === 'Insurance—Truck');
    expect(insuranceEvents.reduce((sum, e) => sum + e.amount, 0)).toBeGreaterThan(0); // 200

    // This fixture's fuel rows (tractorFuel/reeferFuel, $480+$160) are
    // extracted directly from the settlement document, so both saved
    // fuel_purchases rows are SETTLEMENT-LINKED (settlement_id set).
    // buildSpendEvents() deliberately excludes settlement-linked fuel —
    // the SAME canonical-expense-engine double-count guard
    // trueProfit.ts's own sumCanonicalExpenses() already established (a
    // real carrier settlement typically ALSO withholds its own matching
    // fuel_advance deduction line representing that same cost; trusting
    // THAT line rather than the itemized fuel_purchases duplicate is what
    // avoids double-counting it — see trueProfit.ts's own header comment
    // for the regression test that settled this exact trade-off). This
    // minimal fixture has no such withheld fuel line, so the correct,
    // INTENDED result is zero Fuel & DEF spend events here — proving the
    // guard fires consistently with the rest of the app, not a data-loss
    // bug in this new module.
    expect(fuel.every((f) => f.settlement_id)).toBe(true);
    const fuelEvents = events.filter((e) => e.category === 'Fuel & DEF');
    expect(fuelEvents).toHaveLength(0);
  });

  test('SPREAD-ORDER AUDIT (owner decision 2026-08-05, FULL PARITY pass item D.3): an AI-extraction line item carrying its own source/settlement_id/document_id/id-shaped fields can never overwrite the app-controlled tags on the saved row', async () => {
    // Simulates a malformed/adversarial AI JSON response — TypeScript's
    // Extraction type has no source/settlement_id/document_id/id fields
    // at all (mapExtraction.ts's mappers only ever read specific NAMED
    // fields off the raw object and build brand-new literal insert
    // objects, never `{ ...aiRow }`), but the actual JSON returned by the
    // model at runtime is untyped — this proves the real saveExtraction()
    // pipeline is immune regardless.
    const extraction = settlementExtraction();
    const maliciousDeduction = {
      code: 'INS',
      desc: 'Weekly insurance',
      amount: 200,
      source: 'manual',
      settlement_id: 'attacker-settlement-id',
      document_id: 'attacker-document-id',
      id: 'attacker-row-id',
      tax_deductible: true,
    };
    (extraction.settlement as { deductions?: unknown[] })!.deductions = [maliciousDeduction];

    await saveExtraction(baseParams(extraction));

    const settlements = mockClient.__store.settlements as Settlement[];
    const deductions = mockClient.__store.deductions as Deduction[];
    const realSettlementId = settlements[0].id;

    expect(deductions).toHaveLength(1);
    const saved = deductions[0];
    expect(saved.source).toBe('settlement'); // never 'manual' from the payload
    expect(saved.settlement_id).toBe(realSettlementId); // never 'attacker-settlement-id'
    expect(saved.settlement_id).not.toBe('attacker-settlement-id');
    expect(saved.id).not.toBe('attacker-row-id'); // a fresh id, not the payload's
    expect(saved.tax_deductible).toBe(false); // settlement-withheld rows are always non-deductible, regardless of payload
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

// IMPORT SAVE BUG FIX (owner decision 2026-08-05, device report: "Failed
// while saving loads/fuel/deductions — invalid input syntax for type
// date: \"\""). Postgres rejects an empty string for a `date` column —
// only a real date or NULL is allowed. Every AI-extracted date/numeric
// field is optional/loosely-typed text (app/src/import/types.ts's own
// header comment: "never trust it hasn't dropped a key") — a field the
// model returned as PRESENT-BUT-EMPTY ('', whitespace, "N/A") used to
// slip past a `??` check (which only treats null/undefined as absent)
// straight into the database. This end-to-end test proves the real fix
// (toDateOrNull()/numOrNull(), routed through every mapper in
// mapExtraction.ts) against the REAL saveExtraction() — the import
// succeeds, nothing throws, and every child row lands with a sane
// fallback instead of a raw '' reaching Postgres.
function malformedDatesAndNumericsExtraction(): Extraction {
  return {
    docType: 'settlement',
    settlement: {
      weekEnding: WEEK_ENDING,
      grossRevenue: 4000,
      netPay: 3200,
      totalMiles: 2200,
      loads: [
        // pickupDate/deliveryDate/date all empty or malformed — must fall
        // back to the settlement's own week_ending, never reach the DB as ''.
        { order: 'L1', from: 'Dallas, TX', to: 'Atlanta, GA', loadedMiles: 800, revenue: 2000, pickupDate: '', deliveryDate: 'N/A' as unknown as string },
      ],
      tractorFuel: [{ location: 'Pilot #212', gallons: '' as unknown as number, amount: 'N/A' as unknown as number, date: '' }],
      reeferFuel: [{ location: 'Pilot #212', gallons: 40, amount: 160, date: '   ' }],
      reimbursementItems: [{ desc: 'Lumper fee', ref: 'L1', amount: 75 }],
      deductions: [{ code: 'INS', desc: 'Weekly insurance', amount: 200 }],
      loans: [{ name: 'Truck Note', balance: '' as unknown as number, payment: 'N/A' as unknown as number, nextDue: '' }],
    },
  };
}

describe('IMPORT SAVE BUG FIX — empty-string/malformed dates and numerics never reach the database', () => {
  test('the import succeeds without throwing', async () => {
    await expect(saveExtraction(baseParams(malformedDatesAndNumericsExtraction()))).resolves.toBeDefined();
  });

  test('every child row with a blank/malformed own date lands with the settlement week_ending, never an empty string', async () => {
    await saveExtraction(baseParams(malformedDatesAndNumericsExtraction()));

    const loads = mockClient.__store.loads as Load[];
    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];

    expect(loads[0].pickup_date).toBe(WEEK_ENDING);
    expect(loads[0].delivery_date).toBe(WEEK_ENDING);
    for (const f of fuel) {
      expect(f.purchase_date).toBe(WEEK_ENDING);
      expect(f.purchase_date).not.toBe('');
    }
  });

  test('empty-string/"N/A" numeric fields become null, never a raw empty string', async () => {
    await saveExtraction(baseParams(malformedDatesAndNumericsExtraction()));

    const fuel = mockClient.__store.fuel_purchases as FuelPurchase[];
    const loans = mockClient.__store.loans as { balance: number | null; payment: number | null; next_due: string | null }[];

    const tractorFuel = fuel.find((f) => f.fuel_type === 'tractor')!;
    expect(tractorFuel.gallons).toBeNull();
    expect(tractorFuel.amount).toBeNull();

    expect(loans[0].balance).toBeNull();
    expect(loans[0].payment).toBeNull();
    expect(loans[0].next_due).toBeNull();
  });

  test('the settlement row itself still saves correctly despite every child row having a bad date', async () => {
    await saveExtraction(baseParams(malformedDatesAndNumericsExtraction()));

    const settlements = mockClient.__store.settlements as Settlement[];
    expect(settlements).toHaveLength(1);
    expect(settlements[0].week_ending).toBe(WEEK_ENDING);
  });
});
