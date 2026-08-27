import {
  classifyCashFlowSpending,
  isoWeekKey,
  trailingWeeklyAverage,
  requiredOccurrencesFor,
  mergeRecurringCharges,
  type SpendEvent,
} from '../cashFlowClassification';

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

describe('requiredOccurrencesFor — THRESHOLDS TOO STRICT FOR A YOUNG ACCOUNT (owner decision)', () => {
  it('requires only 3 occurrences (never fewer than the absolute floor of 2) for a young account (<= 6 weeks observed)', () => {
    expect(requiredOccurrencesFor(6)).toBe(3);
    expect(requiredOccurrencesFor(5)).toBe(3);
    expect(requiredOccurrencesFor(4)).toBe(3);
  });

  it('never allows a single occurrence to qualify, even with only 1-2 weeks of history', () => {
    expect(requiredOccurrencesFor(1)).toBe(2);
    expect(requiredOccurrencesFor(2)).toBe(2);
  });

  it('scales back toward the original 60%-of-weeks ratio once an account has real, established history', () => {
    expect(requiredOccurrencesFor(12)).toBe(Math.max(3, Math.ceil(12 * 0.6))); // 8
    expect(requiredOccurrencesFor(20)).toBe(Math.max(3, Math.ceil(20 * 0.6))); // 12
  });
});

// THE REPORTED BUG, REPRODUCED AND FIXED (owner decision, device report:
// "Fixed expenses $0 · 0 recurring charges detected" despite weekly
// Insurance/Permits/ELD lines in nearly every settlement). A realistic
// 6-settlement account where each charge resolves correctly in only 4 of
// 6 weeks (the real-world "nearly every week," not literally every week,
// framing from the report) — this is exactly the shape that failed under
// the OLD 60%-of-weeks-observed + 2-occurrence thresholds (4/6 = 66.7%
// would have actually passed the OLD ratio too — the real failure mode
// instrumented in this pass was 3-of-6, below the old 60% floor) and now
// passes under the young-account-scaled requirement.
describe('classifyCashFlowSpending — YOUNG ACCOUNT, 6-settlement dataset (owner decision, the reported bug)', () => {
  const weekEndings = ['2026-07-17', '2026-07-24', '2026-07-31', '2026-08-07', '2026-08-14', '2026-08-21'];

  function settlementEvents(): SpendEvent[] {
    const events: SpendEvent[] = [];
    // Insurance resolves correctly in all 6 weeks, with real-world minor
    // variation (the report's own explicit example: $30.43/$30.43/$29.99
    // must still qualify).
    const insuranceAmounts = [30.43, 30.43, 29.99, 30.43, 30.43, 29.99];
    weekEndings.forEach((we, i) => events.push(event({ category: 'Insurance—Truck', description: 'BT/DH INS', amount: insuranceAmounts[i], date: we })));
    // Permits resolves correctly in only 4 of 6 weeks (the other 2 weeks
    // it was extracted under a slightly different raw code text and
    // landed as an unrelated one-off) — must STILL be detected as
    // recurring under the young-account floor of 3.
    [0, 1, 3, 5].forEach((i) => events.push(event({ category: 'Permits, Licenses & Road Taxes', description: 'IRP', amount: 100, date: weekEndings[i] })));
    // ELD resolves correctly in exactly 3 of 6 weeks — the literal floor
    // this pass's own "allow classification from 3 occurrences" ask.
    [0, 2, 4].forEach((i) => events.push(event({ category: 'ELD & Communications', description: 'ELD FEE', amount: 18, date: weekEndings[i] })));
    // A one-off extended warranty — must be excluded regardless.
    events.push(event({ category: 'Warranty & Service Contracts', description: 'Extended engine warranty', amount: 6500, date: '2026-08-07' }));
    return events;
  }

  it('detects all three recurring charges (Insurance, Permits, ELD) despite partial per-week noise, and excludes the one-off warranty', () => {
    const result = classifyCashFlowSpending(settlementEvents(), 7200);
    const categories = result.fixed.map((f) => f.category).sort();
    expect(categories).toEqual(['ELD & Communications', 'Insurance—Truck', 'Permits, Licenses & Road Taxes']);

    const insurance = result.fixed.find((f) => f.category === 'Insurance—Truck')!;
    expect(insurance.occurrences).toBe(6);
    expect(insurance.weeklyAmount).toBeCloseTo((30.43 * 4 + 29.99 * 2) / 6, 2);
    expect(insurance.source).toBe('auto');

    const permits = result.fixed.find((f) => f.category === 'Permits, Licenses & Road Taxes')!;
    expect(permits.occurrences).toBe(4);
    expect(permits.weeklyAmount).toBe(100);

    const eld = result.fixed.find((f) => f.category === 'ELD & Communications')!;
    expect(eld.occurrences).toBe(3);
    expect(eld.weeklyAmount).toBe(18);

    // The one-off warranty must never be classified fixed, and must
    // never inflate the weekly fixed total.
    expect(result.fixed.some((f) => f.category === 'Warranty & Service Contracts')).toBe(false);
    expect(result.oneOffs.some((o) => o.amount === 6500)).toBe(true);
    expect(result.weeklyFixedTotal).toBeCloseTo(insurance.weeklyAmount + 100 + 18, 2);
  });
});

describe('mergeRecurringCharges — SHOW AND LET ME CORRECT IT (owner decision, "detection is a convenience, not a cage")', () => {
  const detected = [
    { category: 'Insurance—Truck', weeklyAmount: 36, occurrences: 6, source: 'auto' as const },
    { category: 'Permits, Licenses & Road Taxes', weeklyAmount: 100, occurrences: 4, source: 'auto' as const },
  ];

  it('with no overrides, passes the detected list through unchanged', () => {
    const merged = mergeRecurringCharges(detected, {});
    expect(merged.map((f) => f.category).sort()).toEqual(['Insurance—Truck', 'Permits, Licenses & Road Taxes']);
  });

  it('an edited amount overrides a detected category\'s own computed amount, keeping it tagged "auto"', () => {
    const merged = mergeRecurringCharges(detected, { 'Insurance—Truck': { weeklyAmount: 42 } });
    const insurance = merged.find((f) => f.category === 'Insurance—Truck')!;
    expect(insurance.weeklyAmount).toBe(42);
    expect(insurance.source).toBe('auto');
    expect(insurance.occurrences).toBe(6); // detection itself is still real
  });

  it('a removal excludes an otherwise-detected category entirely', () => {
    const merged = mergeRecurringCharges(detected, { 'Permits, Licenses & Road Taxes': { weeklyAmount: 100, removed: true } });
    expect(merged.some((f) => f.category === 'Permits, Licenses & Road Taxes')).toBe(false);
    expect(merged.some((f) => f.category === 'Insurance—Truck')).toBe(true);
  });

  it('a brand-new manual charge (a category the classifier never detected) is added, tagged "manual"', () => {
    const merged = mergeRecurringCharges(detected, { 'ELD & Communications': { weeklyAmount: 18 } });
    const eld = merged.find((f) => f.category === 'ELD & Communications')!;
    expect(eld.weeklyAmount).toBe(18);
    expect(eld.source).toBe('manual');
    expect(eld.occurrences).toBe(0);
  });

  it('A MANUALLY ADDED RECURRING CHARGE SURVIVES A NEW IMPORT (owner decision, item 5) — the same override object still applies after the classifier\'s own detected list changes shape', () => {
    const beforeImport = mergeRecurringCharges(detected, { 'Fuel Surcharge Admin Fee': { weeklyAmount: 12 } });
    expect(beforeImport.some((f) => f.category === 'Fuel Surcharge Admin Fee' && f.source === 'manual')).toBe(true);

    // Simulate a NEW settlement import changing what the classifier itself
    // detects (a new category appears, an old one's amount shifts) — the
    // SAME manual override must still apply, untouched.
    const afterImport = [
      { category: 'Insurance—Truck', weeklyAmount: 40, occurrences: 8, source: 'auto' as const }, // amount changed
      { category: 'Insurance—Truck', weeklyAmount: 100, occurrences: 4, source: 'auto' as const }, // (kept for shape realism)
    ].slice(0, 1);
    const merged = mergeRecurringCharges(afterImport, { 'Fuel Surcharge Admin Fee': { weeklyAmount: 12 } });
    const manual = merged.find((f) => f.category === 'Fuel Surcharge Admin Fee')!;
    expect(manual).toBeDefined();
    expect(manual.weeklyAmount).toBe(12);
    expect(manual.source).toBe('manual');
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
