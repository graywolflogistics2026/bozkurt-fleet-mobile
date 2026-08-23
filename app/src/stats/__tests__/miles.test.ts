import { calcMiles, resolveMilesTotal } from '@/src/stats/miles';

describe('calcMiles (owner decision 2026-08-05, FULL PARITY follow-up item B.1)', () => {
  it('total = MAX(statement total, sum of that week\'s loads), never the sum of both', () => {
    const settlements = [{ id: 's1', truck_id: 't1', week_ending: '2026-07-18', miles: 2200 }];
    const loads = [{ settlement_id: 's1', loaded_miles: 800, empty_miles: 100 }]; // sums to 900, less than statement's 2200
    const result = calcMiles(settlements, loads);
    expect(result.totalMiles).toBe(2200); // statement wins, not 2200+900
  });

  it('uses the loads sum when it EXCEEDS the settlement\'s own printed total', () => {
    const settlements = [{ id: 's1', truck_id: 't1', week_ending: '2026-07-18', miles: 500 }]; // under-reported
    const loads = [{ settlement_id: 's1', loaded_miles: 800, empty_miles: 200 }]; // sums to 1000
    const result = calcMiles(settlements, loads);
    expect(result.totalMiles).toBe(1000);
  });

  it('tracks loaded and empty miles separately from the loads table', () => {
    const settlements = [{ id: 's1', truck_id: 't1', week_ending: '2026-07-18', miles: 1000 }];
    const loads = [
      { settlement_id: 's1', loaded_miles: 600, empty_miles: 100 },
      { settlement_id: 's1', loaded_miles: 200, empty_miles: 50 },
    ];
    const result = calcMiles(settlements, loads);
    expect(result.loadedMiles).toBe(800);
    expect(result.emptyMiles).toBe(150);
  });

  it('deadhead % = empty / total, null when total is 0', () => {
    const settlements = [{ id: 's1', truck_id: 't1', week_ending: '2026-07-18', miles: 1000 }];
    const loads = [{ settlement_id: 's1', loaded_miles: 800, empty_miles: 200 }];
    const result = calcMiles(settlements, loads);
    expect(result.deadheadPct).toBeCloseTo(0.2, 5);

    const zeroResult = calcMiles([{ id: 's2', truck_id: 't1', week_ending: '2026-07-25', miles: 0 }], []);
    expect(zeroResult.deadheadPct).toBeNull();
  });

  it('does NOT dedupe different trucks sharing the same week (a legitimate multi-truck fleet)', () => {
    const settlements = [
      { id: 's1', truck_id: 'truck-a', week_ending: '2026-07-18', miles: 1000 },
      { id: 's2', truck_id: 'truck-b', week_ending: '2026-07-18', miles: 1200 },
    ];
    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(2200); // both count, summed
    expect(result.duplicateWeeksIgnored).toBe(0);
    expect(result.weeks).toHaveLength(2);
  });

  it('DOES dedupe the SAME truck appearing twice for the same week (a real duplicate) — keeps the more complete row', () => {
    const settlements = [
      { id: 's1', truck_id: 'truck-a', week_ending: '2026-07-18', miles: 1000 },
      { id: 's2', truck_id: 'truck-a', week_ending: '2026-07-18', miles: 2500 }, // more complete duplicate
    ];
    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(2500); // only the higher-total duplicate counts
    expect(result.duplicateWeeksIgnored).toBe(1);
    expect(result.weeks).toHaveLength(1);
  });

  it('a settlement with no week_ending is skipped entirely (never crashes, never double-counts under a shared "none" key)', () => {
    const settlements = [{ id: 's1', truck_id: 't1', week_ending: null, miles: 500 }];
    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(0);
    expect(result.weeks).toHaveLength(0);
  });

  it('sums correctly across many real weeks with no duplicates', () => {
    const settlements = [
      { id: 's1', truck_id: 't1', week_ending: '2026-07-04', miles: 2000 },
      { id: 's2', truck_id: 't1', week_ending: '2026-07-11', miles: 2100 },
      { id: 's3', truck_id: 't1', week_ending: '2026-07-18', miles: 1900 },
    ];
    const result = calcMiles(settlements, []);
    expect(result.totalMiles).toBe(6000);
    expect(result.duplicateWeeksIgnored).toBe(0);
  });
});

describe('resolveMilesTotal (manual TOTAL override, owner decision 2026-08-05, spec item B.3)', () => {
  const calculated = calcMiles([{ id: 's1', truck_id: 't1', week_ending: '2026-07-18', miles: 2000 }], []);

  it('uses the calculated total when no manual override is set', () => {
    expect(resolveMilesTotal(calculated, null)).toEqual({ totalMiles: 2000, source: 'settlements' });
    expect(resolveMilesTotal(calculated, undefined)).toEqual({ totalMiles: 2000, source: 'settlements' });
  });

  it('a manual override SUPERSEDES the calculated total entirely', () => {
    expect(resolveMilesTotal(calculated, 12345)).toEqual({ totalMiles: 12345, source: 'manual' });
  });

  it('a zero/negative manual override is treated as "not set" — falls back to the calculated total', () => {
    expect(resolveMilesTotal(calculated, 0)).toEqual({ totalMiles: 2000, source: 'settlements' });
    expect(resolveMilesTotal(calculated, -5)).toEqual({ totalMiles: 2000, source: 'settlements' });
  });
});
