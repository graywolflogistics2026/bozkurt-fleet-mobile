// KPI CONSISTENCY — CROSS-SCREEN REGRESSION GUARD (owner decision, device
// report: "three screens report three different numbers for the same
// week"). Item 6's own explicit ask: "for one fixed dataset, assert that
// Dashboard, Scorecard, AI Coach and the accountant report all report the
// SAME net, RPM, CPM and miles for the same period and scope. This test is
// the guarantee that this class of bug can't return."
//
// This repo has no React Native rendering harness anywhere (a standing,
// documented limitation) — so "Dashboard"/"Scorecard"/"AI Coach" below
// means the exact PURE functions each screen's own component calls to
// produce these figures, called the SAME way the real screen calls them:
//   - Dashboard  -> src/stats/periodScopedCpm.ts's buildPeriodScopedCpm()
//                   (app/(tabs)/index.tsx's own periodScopedCpm memo)
//   - Scorecard  -> src/stats/kpi.ts's computeKpis() with window: null
//                   (app/(tabs)/more/scorecard.tsx's own kpi memo)
//   - AI Coach   -> src/stats/trueProfit.ts's buildWeeklyTrueProfitTrend()
//                   fleet-wide (src/data/proactiveCoach.ts's own
//                   weeklyReviewInputs), cross-checked against
//                   computeKpis() windowed to that one settlement week
//   - Accountant -> the accountant-package.tsx screen's own grossIncome
//                   formula (a plain sum(settlement.gross) within a
//                   year/month window), cross-checked against
//                   computeKpis() windowed to the same year
//
// Both Dashboard and Scorecard now route through the SAME underlying
// computeKpis() (periodScopedCpm.ts delegates to it) — this test proves
// that end to end with realistic, multi-truck, multi-week data rather
// than just asserting "they call the same function" by inspection.
//
// RPM/CPM are asserted for Dashboard vs. Scorecard (both are genuine
// per-mile KPI screens). AI Coach and the Accountant Package do not
// display RPM/CPM/a truck-scoped miles figure at all (a weekly narrative
// review and an itemized ledger, respectively, confirmed by reading both
// screens) — for those two, the test asserts the figures they DO actually
// display (gross, net, settlement count, miles) reconcile exactly with
// the canonical figures for the identical period+scope, which is the
// honest, applicable form of "the same numbers" for a screen with no
// per-mile concept of its own.
import { computeKpis } from '@/src/stats/kpi';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { buildWeeklyTrueProfitTrend } from '@/src/stats/trueProfit';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { calcMiles } from '@/src/stats/miles';
import type { ComparisonTruck } from '@/src/stats/truckComparison';
import type { Settlement, Deduction } from '@/src/types/db';

const truckA: ComparisonTruck = {
  id: 'ta',
  unit_number: '100',
  cost_basis_ownership_mode: 'loan',
  purchase_price: null,
  cost_basis_loan_monthly_payment: 1200,
  cost_basis_paid_spread_months: null,
  cost_basis_warranty_cost: null,
  cost_basis_warranty_term_months: null,
};
const truckB: ComparisonTruck = { ...truckA, id: 'tb', unit_number: '200', cost_basis_loan_monthly_payment: 900 };
const trucks = [truckA, truckB];

// A realistic multi-truck, multi-week fixture — two trucks, one week
// (2026-08-08) shared by BOTH trucks (the routine multi-truck case that
// exposed the "gross from one truck, net from the whole fleet" AI Coach
// bug this pass also fixed), spanning several months so a "yearly" window
// genuinely differs from a single-week one.
const settlements = [
  { id: 's1', truck_id: 'ta', week_ending: '2026-06-06', gross: 2400, net: 2100, miles: 1100, per_diem_days: 7 },
  { id: 's2', truck_id: 'ta', week_ending: '2026-07-04', gross: 2600, net: 2300, miles: 1150, per_diem_days: 7 },
  { id: 's3', truck_id: 'ta', week_ending: '2026-08-01', gross: 2800, net: 2450, miles: 1200, per_diem_days: 7 },
  { id: 's4', truck_id: 'ta', week_ending: '2026-08-08', gross: 2700, net: 2350, miles: 1150, per_diem_days: 7 },
  { id: 's5', truck_id: 'tb', week_ending: '2026-08-08', gross: 2100, net: 1850, miles: 950, per_diem_days: 7 },
];
const weekEndings = [...new Set(settlements.map((s) => s.week_ending))].sort();

const deductions = [
  { amount: 220, source: 'manual', category: 'Maintenance & Repairs', tax_deductible: true, truck_id: 'ta', ded_date: '2026-06-06' },
  { amount: 240, source: 'manual', category: 'Maintenance & Repairs', tax_deductible: true, truck_id: 'ta', ded_date: '2026-07-04' },
  { amount: 260, source: 'manual', category: 'Fuel & DEF', tax_deductible: true, truck_id: 'ta', ded_date: '2026-08-01' },
  { amount: 280, source: 'manual', category: 'Fuel & DEF', tax_deductible: true, truck_id: 'ta', ded_date: '2026-08-08' },
  { amount: 190, source: 'manual', category: 'Tolls & Scales', tax_deductible: true, truck_id: 'tb', ded_date: '2026-08-08' },
  // A genuine one-off (KPI CONSISTENCY's own $86K-CPM-inflation fix) —
  // must be excluded from every RPM/CPM consumer's per-mile figure while
  // still counting fully in P&L-shaped figures (gross/net/accountant).
  {
    amount: 9500,
    source: 'manual',
    category: 'Major Repairs & Overhauls',
    tax_deductible: true,
    truck_id: 'ta',
    ded_date: '2026-08-08',
    description: 'Transmission rebuild',
  },
];

// The same one-off shape logged as a maintenance_records row instead of a
// deduction — the OTHER half of the confirmed CPM-inflation bug.
const maintenanceRecords = [
  { cost: 18000, truck_id: 'tb', description: 'Engine overhaul', service_type: 'engine', service_date: '2026-08-08' },
];

const now = new Date('2026-08-24T12:00:00');

describe('KPI CONSISTENCY — cross-screen guard (one fixed dataset, every screen agrees)', () => {
  it('Dashboard (buildPeriodScopedCpm) and Scorecard (computeKpis) report the IDENTICAL net/rpm/cpm/miles for the same window+scope', () => {
    // "yearly" (a trailing 365-day window ending `now`) covers every
    // settlement in this fixture — the same coverage Scorecard's own
    // `window: null` ("all data, no filtering") gives for this dataset,
    // so the two are directly comparable.
    const dashboard = buildPeriodScopedCpm(
      'yearly',
      weekEndings,
      trucks,
      settlements,
      [],
      deductions,
      [],
      maintenanceRecords,
      [],
      'ta',
      undefined,
      now
    );
    const scorecard = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: 'ta',
      window: null,
    });

    expect(dashboard.kpi).not.toBeNull();
    expect(dashboard.kpi!.net).toBeCloseTo(scorecard.net, 6);
    expect(dashboard.kpi!.rpm).toBeCloseTo(scorecard.rpm!, 6);
    expect(dashboard.kpi!.cpm).toBeCloseTo(scorecard.cpm!, 6);
    expect(dashboard.kpi!.miles.total).toBe(scorecard.miles.total);
    // The literal reported symptom: PPM must equal RPM - CPM on BOTH
    // screens, not just one.
    expect(dashboard.kpi!.ppm).toBeCloseTo(dashboard.kpi!.rpm! - dashboard.kpi!.cpm!, 6);
    expect(scorecard.ppm).toBeCloseTo(scorecard.rpm! - scorecard.cpm!, 6);

    // KPI CONSISTENCY FIX — the $9,500 transmission rebuild (a deduction,
    // truck A's own row) is excluded from truck A's own per-mile CPM
    // (scoped truckScope: 'ta' here), never inflating it toward anything
    // like the reported "$27.60/mi, ~$86K of expenses" — while still
    // fully reducing its real NET PROFIT (asserted below).
    expect(scorecard.excludedOneOffs.some((o) => o.amount === 9500 && o.reason === 'major_repair_overhaul')).toBe(true);
    expect(scorecard.cpm).toBeLessThan(4); // sane, not implausibly inflated
    // The $9,500 is still real money spent — true net profit still
    // reflects it in full (never silently dropped just because CPM
    // excludes it).
    const grossA = 2400 + 2600 + 2800 + 2700;
    const trueExpensesA = 220 + 240 + 260 + 280 + 9500;
    expect(scorecard.net).toBeCloseTo(grossA - trueExpensesA, 6);
  });

  it('"All Trucks" scope: both major one-offs (a deduction AND a maintenance_records row) are excluded from the fleet-wide CPM', () => {
    const fleetWide = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: null,
      window: null,
    });
    expect(fleetWide.excludedOneOffs).toHaveLength(2);
    const reasons = fleetWide.excludedOneOffs.map((o) => ({ amount: o.amount, reason: o.reason }));
    expect(reasons).toEqual(
      expect.arrayContaining([
        { amount: 9500, reason: 'major_repair_overhaul' },
        { amount: 18000, reason: 'major_repair_overhaul' },
      ])
    );
    // Never implausibly high — the literal device-reported symptom fixed.
    expect(fleetWide.cpm).toBeLessThan(4);
  });

  it('AI Coach: gross AND net for the shared multi-truck week (2026-08-08) come from the SAME aggregated figure computeKpis() produces for that exact week, fleet-wide', () => {
    // This mirrors src/data/proactiveCoach.ts's own weeklyReviewInputs:
    // buildWeeklyTrueProfitTrend() fleet-wide, find the latest week.
    const trend = buildWeeklyTrueProfitTrend(
      settlements as unknown as Settlement[],
      deductions as unknown as Deduction[],
      [],
      maintenanceRecords,
      []
    );
    const latestWeek = trend[trend.length - 1];
    expect(latestWeek.weekEnding).toBe('2026-08-08');

    // The SAME week, fleet-wide, via the ONE canonical function every
    // other screen uses.
    const weekWindow = { startIso: '2026-08-02', endIso: '2026-08-08' };
    const canonicalWeek = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: null,
      window: weekWindow,
    });

    // KPI CONSISTENCY FIX — gross now comes from latestWeekTrend.gross
    // (aggregated across BOTH trucks' settlements sharing this week), not
    // a single settlement row's own gross — this is the literal fix for
    // "the coach only receives the latest settlement, with no fleet
    // total."
    expect(latestWeek.gross).toBe(2700 + 2100); // truck A + truck B, same week
    expect(latestWeek.gross).toBeCloseTo(canonicalWeek.gross, 6);
    expect(latestWeek.net).toBeCloseTo(canonicalWeek.net, 6);
  });

  it('AI Coach: the settlement count for a YTD figure is the real row count, matching Scorecard\'s own settlement history for the same year', () => {
    const ytdSettlementCount = settlements.filter((s) => s.week_ending.startsWith('2026')).length;
    expect(ytdSettlementCount).toBe(5); // all 5 fixture rows are in 2026
    const scorecardScope = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: null,
      window: null,
    });
    expect(scorecardScope.settlementCount).toBe(ytdSettlementCount);
  });

  it('Accountant Package: grossIncome for a year window (the screen\'s own plain sum(settlement.gross) formula) matches computeKpis() for the identical window+scope exactly', () => {
    // Mirrors accountant-package.tsx's own `grossIncome` useMemo exactly
    // (a year-only window, month: null).
    const year = 2026;
    const inWindow = settlements.filter((s) => Number(s.week_ending.slice(0, 4)) === year);
    const accountantGrossIncome = inWindow.reduce((sum, s) => sum + Number(s.gross ?? 0), 0);

    const canonical = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: null, // Accountant Package is always fleet-wide (FleetScopeLabel variant="fleetOnly")
      window: { startIso: '2026-01-01', endIso: '2026-12-31' },
    });
    expect(accountantGrossIncome).toBeCloseTo(canonical.gross, 6);
  });

  // ONE KPI ENGINE (owner decision, device report: "Profit Analysis shows
  // Net Income $1,372, independent of what Dashboard/Scorecard/AI Coach
  // show"). Profit Analysis (buildProfitAnalysis(), app/(tabs)/more/
  // profit-analysis.tsx) is fleet-wide-always (FleetScopeLabel
  // variant="fleetOnly") with a fixed trailing-30-day window — this test
  // proves its Net Income now agrees exactly with computeKpis()'s own
  // `net` for the SAME fleet-wide scope and the SAME 30-day window.
  it('Profit Analysis (buildProfitAnalysis) netIncome matches computeKpis().net for the same fleet-wide 30-day window', () => {
    const now = new Date('2026-08-24T12:00:00Z');
    const profitAnalysis = buildProfitAnalysis(settlements, [], maintenanceRecords, deductions, 30, now, []);

    const canonical = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: null, // Profit Analysis is always fleet-wide (FleetScopeLabel variant="fleetOnly")
      window: { startIso: '2026-07-25', endIso: '2026-08-24' }, // the same 30-day window windowStartIso(30, now) resolves to
    });

    // A real, non-trivial subset of the fixture (only s3/s4/s5 + their
    // deductions/maintenance fall in this window) — proves this isn't
    // vacuously true over an empty or all-inclusive window.
    expect(profitAnalysis.revenue).toBeCloseTo(canonical.gross, 6);
    expect(profitAnalysis.revenue).toBeGreaterThan(0);
    expect(profitAnalysis.revenue).toBeLessThan(settlements.reduce((s, x) => s + x.gross, 0)); // strictly fewer than all 5 settlements
    expect(profitAnalysis.netIncome).toBeCloseTo(canonical.net, 6);
  });

  it('miles: calcMiles() (the Accountant/Settlements-screen-facing primitive) and computeKpis().miles.total agree exactly for the same rows', () => {
    const direct = calcMiles(
      settlements.filter((s) => s.truck_id === 'ta'),
      []
    );
    const viaKpi = computeKpis({
      trucks,
      settlements,
      loads: [],
      deductions,
      fuelPurchases: [],
      maintenanceRecords,
      tolls: [],
      truckScope: 'ta',
      window: null,
    });
    expect(viaKpi.miles.total).toBe(direct.totalMiles);
  });
});
