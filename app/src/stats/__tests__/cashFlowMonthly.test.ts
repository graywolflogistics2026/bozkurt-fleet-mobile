import { buildMonthlyCashFlowOverview, findTightestMonthIndex, findBestMonthIndex, type CashFlowMonthProjection } from '../cashFlowMonthly';
import { EMPTY_CASH_FLOW_OVERRIDES, type CashFlowOverrides } from '../cashFlowForecast';
import type { CashFlowClassification, SpendEvent } from '../cashFlowClassification';

const TODAY = new Date('2026-08-15T12:00:00Z'); // current month = Aug 2026

function classification(overrides: Partial<CashFlowClassification> = {}): CashFlowClassification {
  return {
    fixed: [],
    variable: [{ category: 'Fuel & DEF', ratePerMile: 0.5, totalAmount: 1000 }],
    oneOffs: [],
    weeklyFixedTotal: 100,
    weeksObserved: 12,
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof buildMonthlyCashFlowOverview>[0]> = {}) {
  return {
    year: 2026,
    weeklyIncome: 1000,
    weeklyFixed: 100,
    weeklyVariable: 200,
    classification: classification(),
    allEvents: [] as SpendEvent[],
    allSettlements: [] as { week_ending: string | null; net: number | null }[],
    periodicItems: [],
    overrides: EMPTY_CASH_FLOW_OVERRIDES,
    today: TODAY,
    ...overrides,
  };
}

describe('buildMonthlyCashFlowOverview — status classification', () => {
  it('a month fully before today is "actual"', () => {
    const months = buildMonthlyCashFlowOverview(baseInput());
    const june = months.find((m) => m.month === 6)!;
    expect(june.status).toBe('actual');
  });

  it('the month today falls in is "current"', () => {
    const months = buildMonthlyCashFlowOverview(baseInput());
    const august = months.find((m) => m.month === 8)!;
    expect(august.status).toBe('current');
  });

  it('a month after today is "projected"', () => {
    const months = buildMonthlyCashFlowOverview(baseInput());
    const december = months.find((m) => m.month === 12)!;
    expect(december.status).toBe('projected');
  });

  it('returns exactly 12 months in Jan-Dec order', () => {
    const months = buildMonthlyCashFlowOverview(baseInput());
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('buildMonthlyCashFlowOverview — ACTUAL months compute from real data, not projections', () => {
  it('sums real settlement net + real spend events for a fully-past month', () => {
    const allSettlements = [
      { week_ending: '2026-06-05', net: 3000 },
      { week_ending: '2026-06-19', net: 3200 },
    ];
    const allEvents: SpendEvent[] = [
      { category: 'Insurance—Truck', description: 'Insurance', amount: 200, date: '2026-06-10' },
      { category: 'Fuel & DEF', description: 'Fuel', amount: 400, date: '2026-06-12' },
    ];
    const months = buildMonthlyCashFlowOverview(baseInput({ allSettlements, allEvents }));
    const june = months.find((m) => m.month === 6)!;
    expect(june.income).toBe(6200);
    expect(june.variable).toBe(400); // Fuel & DEF is in the classification's variable set
    expect(june.fixed).toBe(200); // Insurance—Truck is NOT in the variable set -> folds into fixed
    expect(june.net).toBe(6200 - 200 - 400);
  });

  it('an unclassified one-off category still counts toward the actual month\'s fixed bucket (never vanishes)', () => {
    const allEvents: SpendEvent[] = [
      { category: 'Major Repairs & Overhauls', description: 'Transmission rebuild', amount: 4800, date: '2026-03-10' },
    ];
    const months = buildMonthlyCashFlowOverview(baseInput({ allEvents }));
    const march = months.find((m) => m.month === 3)!;
    expect(march.fixed).toBe(4800);
  });

  it('events/settlements outside the month are excluded', () => {
    const allSettlements = [{ week_ending: '2026-05-30', net: 1000 }];
    const months = buildMonthlyCashFlowOverview(baseInput({ allSettlements }));
    const june = months.find((m) => m.month === 6)!;
    expect(june.income).toBe(0);
  });
});

describe('buildMonthlyCashFlowOverview — PROJECTED months use the steady-state weekly figures', () => {
  it('scales weekly income/fixed/variable to the month\'s own day count', () => {
    const months = buildMonthlyCashFlowOverview(baseInput({ weeklyIncome: 1000, weeklyFixed: 100, weeklyVariable: 200 }));
    const december = months.find((m) => m.month === 12)!;
    const decWeeks = 31 / 7;
    expect(december.income).toBeCloseTo(1000 * decWeeks, 5);
    expect(december.fixed).toBeCloseTo(100 * decWeeks, 5);
    expect(december.variable).toBeCloseTo(200 * decWeeks, 5);
  });

  it('includes a periodic item due in that projected month', () => {
    const periodicItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2290', dueDate: '2026-11-15', amount: 550, amountSource: 'document' as const }];
    const months = buildMonthlyCashFlowOverview(baseInput({ periodicItems }));
    const november = months.find((m) => m.month === 11)!;
    expect(november.periodic).toBe(550);
    expect(november.periodicItems.map((p) => p.id)).toEqual(['c1']);
  });
});

describe('buildMonthlyCashFlowOverview — CURRENT month blends actual-to-date + projected remainder', () => {
  it('never guesses days that have not happened, never stales days that have', () => {
    const allSettlements = [{ week_ending: '2026-08-08', net: 900 }];
    const allEvents: SpendEvent[] = [{ category: 'Insurance—Truck', description: 'Insurance', amount: 50, date: '2026-08-05' }];
    const months = buildMonthlyCashFlowOverview(baseInput({ allSettlements, allEvents, weeklyIncome: 1000, weeklyFixed: 100, weeklyVariable: 200 }));
    const august = months.find((m) => m.month === 8)!;

    const remainingDays = 31 - 15; // TODAY = Aug 15
    const remainderWeeks = remainingDays / 7;
    expect(august.income).toBeCloseTo(900 + 1000 * remainderWeeks, 5);
    expect(august.fixed).toBeCloseTo(50 + 100 * remainderWeeks, 5);
    expect(august.variable).toBeCloseTo(0 + 200 * remainderWeeks, 5);
  });
});

describe('buildMonthlyCashFlowOverview — REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27): months are independent, no more balance chain', () => {
  it("a requested year's own months never depend on ANOTHER call's result — each buildMonthlyCashFlowOverview() call is self-contained", () => {
    // Both 2027 and 2028 are fully FUTURE relative to TODAY (Aug 2026),
    // so December is 'projected' in both — same steady-state inputs must
    // produce byte-identical figures either way, proving neither call's
    // result leaks into or depends on the other's (no shared chain).
    const months2027 = buildMonthlyCashFlowOverview(baseInput({ year: 2027 }));
    const months2028 = buildMonthlyCashFlowOverview(baseInput({ year: 2028 }));
    const dec2027 = months2027.find((m) => m.month === 12)!;
    const dec2028 = months2028.find((m) => m.month === 12)!;
    expect(dec2027.status).toBe('projected');
    expect(dec2028.status).toBe('projected');
    expect(dec2027.income).toBeCloseTo(dec2028.income, 5);
    expect(dec2027.net).toBeCloseTo(dec2028.net, 5);
  });

  it('a fully-past requested year (all 12 months "actual") still resolves without error', () => {
    const months = buildMonthlyCashFlowOverview(baseInput({ year: 2024 }));
    expect(months).toHaveLength(12);
    expect(months.every((m) => m.status === 'actual')).toBe(true);
  });

  it('a fully-future requested year (all 12 months "projected") still resolves without error', () => {
    const months = buildMonthlyCashFlowOverview(baseInput({ year: 2028 }));
    expect(months).toHaveLength(12);
    expect(months.every((m) => m.status === 'projected')).toBe(true);
  });
});

describe('buildMonthlyCashFlowOverview — overrides apply the same way as the 30-day forecast', () => {
  it('a periodic override wins over the document-sourced amount, in both actual and projected months', () => {
    const periodicItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2290', dueDate: '2026-11-15', amount: 550, amountSource: 'document' as const }];
    const overrides: CashFlowOverrides = { ...EMPTY_CASH_FLOW_OVERRIDES, periodicAmounts: { c1: 620 } };
    const months = buildMonthlyCashFlowOverview(baseInput({ periodicItems, overrides }));
    const november = months.find((m) => m.month === 11)!;
    expect(november.periodic).toBe(620);
  });

  it('an income/fixed/variable override changes every projected month\'s figures', () => {
    const overrides: CashFlowOverrides = { ...EMPTY_CASH_FLOW_OVERRIDES, incomeWeekly: 5000 };
    const months = buildMonthlyCashFlowOverview(baseInput({ overrides, weeklyIncome: 5000 }));
    const december = months.find((m) => m.month === 12)!;
    expect(december.income).toBeCloseTo(5000 * (31 / 7), 5);
  });
});

describe('findTightestMonthIndex / findBestMonthIndex', () => {
  function month(net: number): CashFlowMonthProjection {
    return { year: 2026, month: 1, status: 'projected', income: 0, fixed: 0, variable: 0, periodic: 0, periodicItems: [], net };
  }

  it('finds the lowest and highest NET month (never a balance — REMOVE BUSINESS BALANCE TRACKING, owner decision 2026-08-27)', () => {
    const months = [month(500), month(-200), month(1000), month(50)];
    expect(findTightestMonthIndex(months)).toBe(1);
    expect(findBestMonthIndex(months)).toBe(2);
  });

  it('returns -1 for an empty list', () => {
    expect(findTightestMonthIndex([])).toBe(-1);
    expect(findBestMonthIndex([])).toBe(-1);
  });
});
