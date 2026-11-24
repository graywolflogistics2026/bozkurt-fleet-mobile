// TOLL RULE IN THE PROFIT CORE (owner 2026-11-24,
// docs/decisions/toll-rule-profit-core-proposal.md): a tolls row under its
// settlement's toll line is that line's breakdown and never counts on top
// of it, for a settlement WITHOUT an approved statement too. Decided on the
// full lists, before any window or scope; in profit a line covers only when
// it reduces profit itself (owner decision T6(b)). T1 (the owner's own
// numbers) is tollRuleOwnerPin.test.ts.
import { computeKpis } from '@/src/stats/kpi';
import { buildPeriodScopedCpm } from '@/src/stats/periodScopedCpm';
import { buildTruckComparison } from '@/src/stats/truckComparison';
import { buildProfitAnalysis } from '@/src/stats/profitAnalysis';
import { buildWeeklyTrueProfitTrend, layeredExpenseBreakdown } from '@/src/stats/trueProfit';
import { buildTollsSummary, withoutCoveredTolls } from '@/src/stats/tollsSummary';
import { AFTER, BEFORE, NOW, TRUCK, deductions, insurance, ownToll, plaza, plazas, settlement, tollLine, tolls } from './fixtures/otherCarrierTolls';

const r2 = (n: number) => Math.round(n * 100) / 100;
type Rows = { settlements?: unknown[]; deductions?: unknown[]; tolls?: unknown[]; trucks?: unknown[] };

const kpi = (rows: Rows = {}, truckScope: string | null = null) =>
  computeKpis({
    trucks: (rows.trucks ?? [{ id: TRUCK, unit_number: '101' }]) as never,
    settlements: (rows.settlements ?? [settlement]) as never,
    loads: [],
    deductions: (rows.deductions ?? deductions) as never,
    fuelPurchases: [],
    maintenanceRecords: [],
    tolls: (rows.tolls ?? tolls) as never,
    reimbursements: [],
    truckScope,
    window: null,
  });

describe('T2: other carrier, no statement — the plazas under the toll line count once', () => {
  test('the old core summed the line and its plazas (the double count being removed)', () => {
    // layeredExpenseBreakdown() itself does not apply the rule (it gets
    // already-filtered rows); fed every row it shows the old figure.
    expect(r2(layeredExpenseBreakdown([settlement] as never, deductions as never, [], [], tolls as never, []).total)).toBe(BEFORE.expenses);
  });

  test('computeKpis: expenses 252.40, profit 2,747.60, Tolls bucket 52.40, bridge difference 0', () => {
    const k = kpi();
    expect([r2(k.gross), r2(k.expenses.total), r2(k.net)]).toEqual([3000, AFTER.expenses, AFTER.profit]);
    expect(k.buckets.find((b) => b.category === 'Tolls')?.amount).toBeCloseTo(52.4, 2);
    expect(k.bridge.difference).toBe(AFTER.bridgeDifference);
    expect(r2(k.bridge.profit)).toBe(AFTER.profit);
    // Audit ledger: the line and the own toll are counted; no plaza is.
    const counted = k.ledger.filter((l) => l.status === 'counted' && l.category === 'Tolls & Scales');
    expect(r2(counted.reduce((a, l) => a + l.amount, 0))).toBe(52.4);
    expect(k.ledger.some((l) => l.table === 'tolls' && l.status === 'counted' && l.settlementId === 's-acme')).toBe(false);
  });

  test('the Tolls & Fees screen is unchanged (52.40)', () => {
    expect(buildTollsSummary({ deductions: deductions as never, tolls: tolls as never, settlements: [settlement], period: 'all', now: NOW }).total).toBe(52.4);
  });
});

test('T3: the same week gives the same profit through every entry point', () => {
  const pa = buildProfitAnalysis([settlement] as never, [], [], deductions as never, [], null, NOW, tolls as never);
  const period = buildPeriodScopedCpm('yearly', ['2026-10-23'], [{ id: TRUCK, unit_number: '101' }] as never, [settlement] as never, [], deductions as never, [], [], tolls as never, [], TRUCK, null, NOW);
  const comparison = buildTruckComparison([{ id: TRUCK, unit_number: '101' }] as never, [settlement] as never, [], deductions as never, [], [], tolls as never, []);
  const weekly = buildWeeklyTrueProfitTrend([settlement] as never, deductions as never, [], [], tolls as never, []);
  expect([
    r2(kpi().net),
    r2(pa.netIncome),
    r2(period.kpi!.net),
    r2(period.comparison.rows[0].netProfit),
    r2(comparison.rows[0].netProfit),
    r2(weekly.find((w) => w.weekEnding === '2026-10-23')!.net),
  ]).toEqual(Array(6).fill(AFTER.profit));
});

test('T4: plazas dated in the previous week never charge that week (coverage is per settlement, not per date)', () => {
  const prev = { ...settlement, id: 's-prev', week_ending: '2026-10-16', gross: 1000, net: 1000 };
  const early = [plaza('e1', 'HCTRA', 15, '2026-10-14'), plaza('e2', 'NJTP', 15, '2026-10-15'), plaza('e3', 'HCTRA', 10, '2026-10-16')];
  const weekly = buildWeeklyTrueProfitTrend([prev, settlement] as never, deductions as never, [], [], [...early, ownToll] as never, []);
  expect(weekly.map((w) => [w.weekEnding, r2(w.net)])).toEqual([
    ['2026-10-16', 1000],
    ['2026-10-23', AFTER.profit],
  ]);
  // And a date window over the previous week alone: no toll cost there.
  const k = computeKpis({ trucks: [], settlements: [prev, settlement] as never, loads: [], deductions: deductions as never, fuelPurchases: [], maintenanceRecords: [], tolls: [...early, ownToll] as never, reimbursements: [], truckScope: null, window: { startIso: '2026-10-10', endIso: '2026-10-16' } });
  expect(r2(k.expenses.total)).toBe(0);
});

test('T5: a covered plaza on another truck counts for no truck; the fleet total is 2,747.60', () => {
  const trucks = [
    { id: TRUCK, unit_number: '101' },
    { id: 'T2', unit_number: '202' },
  ];
  const onT2 = [plaza('t1', 'HCTRA', 15, '2026-10-18', { truck_id: 'T2' }), ...plazas.slice(1), ownToll];
  const comparison = buildTruckComparison(trucks as never, [settlement] as never, [], deductions as never, [], [], onT2 as never, []);
  expect(r2(comparison.rows.find((r) => r.truckId === 'T2')!.totalExpenses)).toBe(0);
  expect(r2(comparison.rows.reduce((a, r) => a + r.netProfit, 0))).toBe(AFTER.profit);
  expect(r2(kpi({ tolls: onT2, trucks }).net)).toBe(AFTER.profit);
  // Scoped to T2: the fleet-level rows (truck null) count there too
  // (NULL-truck rule), the covered T2 plaza (15.00) never does.
  expect(r2(kpi({ tolls: onT2, trucks }, 'T2').expenses.total)).toBe(AFTER.expenses);
});

test('T6 (owner decision b): a toll line that does not reduce profit does not cover its plazas in profit; the screen keeps its own rule', () => {
  const informational = { ...tollLine, economic_class: 'INFORMATIONAL' };
  const ds = [informational, insurance];
  // The line is out of profit, so the plazas are the toll cost: 200 + 40 + 12.40.
  expect(r2(kpi({ deductions: ds }).expenses.total)).toBe(252.4);
  expect(r2(kpi({ deductions: ds }).net)).toBe(AFTER.profit);
  // Tolls & Fees screen: still the line + the own toll, plazas as its breakdown.
  expect(buildTollsSummary({ deductions: ds as never, tolls: tolls as never, settlements: [settlement], period: 'all', now: NOW }).total).toBe(52.4);
});

test('T7: a line smaller than its plazas — the line wins (40.00, never 55.00), as on the Tolls & Fees screen', () => {
  const more = [...plazas, plaza('t4', 'NJTP', 15, '2026-10-20'), ownToll];
  expect(r2(kpi({ tolls: more }).expenses.total)).toBe(AFTER.expenses);
});

test('T8: a scales-only line never covers EZ-Pass plazas — they count', () => {
  const scales = { ...tollLine, id: 'd-wt', description: 'WA ADV FOR WEIGHT TICKETS', amount: 17.5 };
  expect(r2(kpi({ deductions: [scales, insurance] }).expenses.total)).toBe(r2(17.5 + 200 + 40 + 12.4));
});

test('T9: withoutCoveredTolls twice, or again on a filtered subset, removes nothing more', () => {
  const once = withoutCoveredTolls(tolls, deductions);
  expect(once.map((t) => t.id)).toEqual(['t-own']);
  expect(withoutCoveredTolls(once, deductions)).toEqual(once);
  expect(withoutCoveredTolls(once, [insurance])).toEqual(once);
  expect(withoutCoveredTolls(once, [])).toEqual(once);
});

test('T10: NULL-truck rule — a fleet-level own toll still counts in a single-truck scope', () => {
  const k = kpi({}, TRUCK);
  expect([r2(k.expenses.total), r2(k.net)]).toEqual([AFTER.expenses, AFTER.profit]);
  expect(k.ledger.some((l) => l.table === 'tolls' && l.rowId === 't-own' && l.status === 'counted')).toBe(true);
});

test('Audit ledger: the 3 covered plazas show as excluded "toll_breakdown" (40.00), never counted; a statement-backed week shows none', () => {
  const k = kpi();
  const covered = k.ledger.filter((l) => l.reason === 'toll_breakdown');
  expect(covered.map((l) => [l.rowId, l.status, l.amount])).toEqual([
    ['t1', 'excluded', 15],
    ['t2', 'excluded', 15],
    ['t3', 'excluded', 10],
  ]);
  // Scoped to a window without the line's week: not shown.
  const other = computeKpis({ trucks: [], settlements: [settlement] as never, loads: [], deductions: deductions as never, fuelPurchases: [], maintenanceRecords: [], tolls: tolls as never, reimbursements: [], truckScope: null, window: { startIso: '2026-10-01', endIso: '2026-10-10' } });
  expect(other.ledger.some((l) => l.reason === 'toll_breakdown')).toBe(false);
});
