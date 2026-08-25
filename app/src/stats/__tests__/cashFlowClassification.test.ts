import { classifyCashFlowSpending, isoWeekKey, trailingWeeklyAverage, type SpendEvent } from '../cashFlowClassification';

describe('isoWeekKey', () => {
  it('returns null for a null/empty date', () => {
    expect(isoWeekKey(null)).toBeNull();
    expect(isoWeekKey(undefined)).toBeNull();
    expect(isoWeekKey('')).toBeNull();
  });

  it('groups two dates in the same Mon-Sun week to the same key', () => {
    // 2026-08-03 is a Monday, 2026-08-09 is the following Sunday.
    expect(isoWeekKey('2026-08-03')).toBe(isoWeekKey('2026-08-09'));
  });

  it('a date the following Monday gets a different key', () => {
    expect(isoWeekKey('2026-08-03')).not.toBe(isoWeekKey('2026-08-10'));
  });
});

describe('trailingWeeklyAverage', () => {
  it('returns 0/0 for no rows', () => {
    expect(trailingWeeklyAverage([], () => null, () => 0, 4)).toEqual({ average: 0, weeksFound: 0, total: 0 });
  });

  it('divides by the actual number of distinct weeks found, never a fixed denominator', () => {
    const rows = [
      { week: '2026-W01', amount: 1000 },
      { week: '2026-W02', amount: 1000 },
      { week: '2026-W03', amount: 1000 },
    ];
    // Only 3 distinct weeks exist even though we ask for the trailing 4 —
    // the average must be 1000, not 750 (which a fixed /4 would produce).
    const result = trailingWeeklyAverage(rows, (r) => r.week, (r) => r.amount, 4);
    expect(result.weeksFound).toBe(3);
    expect(result.average).toBe(1000);
    expect(result.total).toBe(3000);
  });

  it('a genuinely low/zero week that DID land still counts as one of the weeks (correctly pulls the average down)', () => {
    const rows = [
      { week: '2026-W01', amount: 2000 },
      { week: '2026-W02', amount: 0 }, // a real $0 home week, still a real settlement
      { week: '2026-W03', amount: 2000 },
      { week: '2026-W04', amount: 2000 },
    ];
    const result = trailingWeeklyAverage(rows, (r) => r.week, (r) => r.amount, 4);
    expect(result.weeksFound).toBe(4);
    expect(result.average).toBe(1500); // (2000+0+2000+2000)/4, not /3
  });
});

function event(overrides: Partial<SpendEvent>): SpendEvent {
  return { category: 'Misc', description: 'item', amount: 0, date: null, ...overrides };
}

// Builds N consecutive weekly events for a category, one per Monday
// starting from a fixed anchor date, so tests are deterministic.
function weeklyEvents(category: string, amounts: number[], startIso = '2026-06-01'): SpendEvent[] {
  const start = new Date(`${startIso}T00:00:00Z`);
  return amounts.map((amount, i) => {
    const d = new Date(start.getTime() + i * 7 * 86400000);
    return event({ category, amount, date: d.toISOString().slice(0, 10), description: category });
  });
}

describe('classifyCashFlowSpending — RECURRING FIXED (frequency + low variance, no hardcoded list)', () => {
  it('a charge appearing every week at a stable amount is classified fixed', () => {
    const events = weeklyEvents('Insurance—Truck', [210, 205, 212, 208, 210, 207, 209, 211]);
    const result = classifyCashFlowSpending(events, 0);
    expect(result.fixed.some((f) => f.category === 'Insurance—Truck')).toBe(true);
    const insurance = result.fixed.find((f) => f.category === 'Insurance—Truck')!;
    expect(insurance.occurrences).toBe(8);
    expect(insurance.weeklyAmount).toBeGreaterThan(200);
    expect(insurance.weeklyAmount).toBeLessThan(220);
  });

  it('detects a fixed charge by frequency+variance alone — an unrecognized/custom category still qualifies', () => {
    // Proves this isn't a hardcoded category list — "Dispatch Software"
    // isn't a canonical category at all, but still gets classified fixed
    // purely from its own frequency/variance behavior.
    const events = weeklyEvents('Dispatch Software', [50, 50, 50, 50, 50, 50]);
    const result = classifyCashFlowSpending(events, 0);
    expect(result.fixed.some((f) => f.category === 'Dispatch Software')).toBe(true);
  });

  it('a charge with wildly inconsistent amounts is NOT classified fixed even if frequent', () => {
    const events = weeklyEvents('Misc Fees', [10, 400, 25, 900, 15, 600, 5, 300]);
    const result = classifyCashFlowSpending(events, 0);
    expect(result.fixed.some((f) => f.category === 'Misc Fees')).toBe(false);
  });

  it('a charge seen only once is never called recurring, regardless of the window', () => {
    const events = [event({ category: 'Random Fee', amount: 100, date: '2026-06-01' })];
    const result = classifyCashFlowSpending(events, 0);
    expect(result.fixed).toHaveLength(0);
    expect(result.oneOffs.some((o) => o.category === 'Random Fee')).toBe(true);
  });
});

describe('classifyCashFlowSpending — VARIABLE PER MILE (fuel/maintenance/tolls/additives)', () => {
  it('computes the user\'s own $/mile rate for each variable category', () => {
    const events = [
      ...weeklyEvents('Fuel & DEF', [500, 520, 480, 510]),
      ...weeklyEvents('Maintenance & Repairs', [80, 0, 150, 20]).filter((e) => e.amount > 0),
      ...weeklyEvents('Tolls & Scales', [30, 35, 28, 32]),
    ];
    const totalMiles = 10000;
    const result = classifyCashFlowSpending(events, totalMiles);
    const fuel = result.variable.find((v) => v.category === 'Fuel & DEF')!;
    expect(fuel.totalAmount).toBe(500 + 520 + 480 + 510);
    expect(fuel.ratePerMile).toBeCloseTo(fuel.totalAmount / totalMiles, 5);
    expect(result.variable.some((v) => v.category === 'Tolls & Scales')).toBe(true);
    // Variable categories never leak into fixed/one-off, regardless of
    // how frequent or stable they are.
    expect(result.fixed.some((f) => f.category === 'Fuel & DEF')).toBe(false);
    expect(result.oneOffs.some((o) => o.category === 'Fuel & DEF')).toBe(false);
  });

  it('a rate is 0 (never divides by zero) when there are no miles on file', () => {
    const events = weeklyEvents('Fuel & DEF', [500]);
    const result = classifyCashFlowSpending(events, 0);
    expect(result.variable[0].ratePerMile).toBe(0);
  });
});

describe('classifyCashFlowSpending — ONE-OFFS excluded from the projection', () => {
  it('a large one-time purchase is excluded from fixed and never inflates the weekly total', () => {
    const events = [
      ...weeklyEvents('Insurance—Truck', [200, 200, 200, 200, 200, 200]),
      event({ category: 'Warranty & Service Contracts', description: 'Extended engine warranty', amount: 7200, date: '2026-06-15' }),
    ];
    const result = classifyCashFlowSpending(events, 0);
    expect(result.oneOffs.some((o) => o.amount === 7200)).toBe(true);
    expect(result.fixed.some((f) => f.category === 'Warranty & Service Contracts')).toBe(false);
    // The $7,200 must never leak into the weekly fixed total.
    expect(result.weeklyFixedTotal).toBeLessThan(1000);
  });
});

describe('classifyCashFlowSpending — a realistic mixed dataset separates all three buckets correctly', () => {
  it('classifies fixed/variable/one-off together in one 12-week dataset', () => {
    const events: SpendEvent[] = [
      ...weeklyEvents('Insurance—Truck', [210, 205, 208, 212, 209, 207, 210, 211, 206, 213, 208, 210]),
      ...weeklyEvents('Permits, Licenses & Road Taxes', [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15]),
      ...weeklyEvents('Fuel & DEF', [480, 510, 495, 470, 520, 500, 490, 505, 515, 475, 500, 490]),
      ...weeklyEvents('Maintenance & Repairs', [60, 90, 40, 0, 120, 0, 55, 0, 200, 30, 0, 75]).filter((e) => e.amount > 0),
      event({ category: 'Major Repairs & Overhauls', description: 'Transmission rebuild', amount: 4800, date: '2026-07-20' }),
    ];
    const result = classifyCashFlowSpending(events, 15000);

    expect(result.fixed.map((f) => f.category).sort()).toEqual(['Insurance—Truck', 'Permits, Licenses & Road Taxes']);
    expect(result.variable.map((v) => v.category).sort()).toEqual(['Fuel & DEF', 'Maintenance & Repairs']);
    expect(result.oneOffs.some((o) => o.description === 'Transmission rebuild')).toBe(true);
    expect(result.weeksObserved).toBeGreaterThanOrEqual(12);
  });
});
