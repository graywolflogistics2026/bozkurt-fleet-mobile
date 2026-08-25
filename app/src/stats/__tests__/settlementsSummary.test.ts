import { buildSettlementsTotalsBar } from '../settlementsSummary';
import { filterByPeriod } from '../periodFilter';
import { buildWeeklyTrend } from '../cashFlowTrend';
import type { Settlement } from '@/src/types/db';

function sett(overrides: Partial<Settlement>): Settlement {
  return {
    id: 's1',
    user_id: 'u1',
    truck_id: null,
    driver_id: null,
    document_id: null,
    week_ending: '2026-01-01',
    gross: 3000,
    net: 2000,
    miles: 2000,
    per_diem_days: 7,
    business_balance_credit: 0,
    tags: null,
    carrier: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildSettlementsTotalsBar', () => {
  it('sums gross/net/miles the same plain way FleetStats already does, just over whatever subset is passed in', () => {
    const rows = [
      sett({ id: '1', gross: 3000, net: 2200, miles: 2000 }),
      sett({ id: '2', gross: 2500, net: 1800, miles: 1500 }),
    ];
    const bar = buildSettlementsTotalsBar(rows);
    expect(bar.gross).toBe(5500);
    expect(bar.net).toBe(4000);
    expect(bar.miles).toBe(3500);
    expect(bar.count).toBe(2);
    expect(bar.avgRpm).toBeCloseTo(5500 / 3500, 5);
  });

  it('avgRpm is null (never a divide-by-zero) when there are no miles', () => {
    const bar = buildSettlementsTotalsBar([sett({ gross: 100, miles: 0 })]);
    expect(bar.avgRpm).toBeNull();
  });

  it('handles an empty list', () => {
    expect(buildSettlementsTotalsBar([])).toEqual({ gross: 0, net: 0, miles: 0, count: 0, avgRpm: null });
  });
});

// PERIOD FILTERING + CANONICAL CHART (spec: "the same period tabs, a
// thin-line chart of gross revenue and net pay per settlement week") —
// the chart reuses the EXISTING buildWeeklyTrend() unchanged; period
// filtering only narrows which settlements are fed into it, never a
// second gross/net formula.
describe('settlements period filter + canonical weekly trend', () => {
  const NOW = new Date('2026-08-24T12:00:00Z');
  const rows = [
    sett({ id: '1', week_ending: '2026-01-10', gross: 1000, net: 700 }),
    sett({ id: '2', week_ending: '2026-06-06', gross: 2000, net: 1500 }),
    sett({ id: '3', week_ending: '2026-08-15', gross: 3000, net: 2200 }),
  ];

  it('"thisMonth" narrows to only the current month\'s settlement, then buildWeeklyTrend reflects just that one point', () => {
    const filtered = filterByPeriod(rows, (s) => s.week_ending, 'thisMonth', NOW);
    expect(filtered.map((s) => s.id)).toEqual(['3']);
    expect(buildWeeklyTrend(filtered)).toEqual([{ weekEnding: '2026-08-15', gross: 3000, net: 2200 }]);
  });

  it('"ytd" includes every settlement week in the current year, always at least as many as "thisMonth"', () => {
    const ytd = filterByPeriod(rows, (s) => s.week_ending, 'ytd', NOW);
    expect(ytd.map((s) => s.id)).toEqual(['1', '2', '3']);
    const trend = buildWeeklyTrend(ytd);
    expect(trend.map((p) => p.weekEnding)).toEqual(['2026-01-10', '2026-06-06', '2026-08-15']);
  });
});
