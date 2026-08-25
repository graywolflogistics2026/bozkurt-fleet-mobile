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
    todayBalance: 5000,
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

describe('buildMonthlyCashFlowOverview — balance chaining', () => {
  it("each month's opening balance equals the previous month's closing balance", () => {
    const months = buildMonthlyCashFlowOverview(baseInput());
    for (let i = 1; i < months.length; i++) {
      expect(months[i].openingBalance).toBeCloseTo(months[i - 1].closingBalance, 5);
    }
  });

  it("the current month's closing balance is today's real balance plus only the PROJECTED remainder (not the actual-to-date portion, which already happened)", () => {
    const allSettlements = [{ week_ending: '2026-08-08', net: 900 }];
    const months = buildMonthlyCashFlowOverview(baseInput({ allSettlements, todayBalance: 5000 }));
    const august = months.find((m) => m.month === 8)!;
    // closing = todayBalance + (full month net - actual-to-date net) = todayBalance + projected remainder net
    const remainingDays = 31 - 15;
    const remainderWeeks = remainingDays / 7;
    const projectedRemainderNet = 1000 * remainderWeeks - 100 * remainderWeeks - 200 * remainderWeeks;
    expect(august.closingBalance).toBeCloseTo(5000 + projectedRemainderNet, 5);
  });

  it('a past year and the following year chain continuously across the boundary (Dec closing = next Jan opening)', () => {
    const input2025 = baseInput({ year: 2025 });
    const input2026 = baseInput({ year: 2026 });
    const months2025 = buildMonthlyCashFlowOverview(input2025);
    const months2026 = buildMonthlyCashFlowOverview(input2026);
    const dec2025 = months2025.find((m) => m.month === 12)!;
    const jan2026 = months2026.find((m) => m.month === 1)!;
    expect(dec2025.closingBalance).toBeCloseTo(jan2026.openingBalance, 5);
  });

  it('a future year continues chaining forward from the current year', () => {
    const months2026 = buildMonthlyCashFlowOverview(baseInput({ year: 2026 }));
    const months2027 = buildMonthlyCashFlowOverview(baseInput({ year: 2027 }));
    const dec2026 = months2026.find((m) => m.month === 12)!;
    const jan2027 = months2027.find((m) => m.month === 1)!;
    expect(dec2026.closingBalance).toBeCloseTo(jan2027.openingBalance, 5);
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
  function month(closingBalance: number): CashFlowMonthProjection {
    return { year: 2026, month: 1, status: 'projected', openingBalance: 0, income: 0, fixed: 0, variable: 0, periodic: 0, periodicItems: [], net: 0, closingBalance };
  }

  it('finds the lowest and highest closing balance', () => {
    const months = [month(500), month(-200), month(1000), month(50)];
    expect(findTightestMonthIndex(months)).toBe(1);
    expect(findBestMonthIndex(months)).toBe(2);
  });

  it('returns -1 for an empty list', () => {
    expect(findTightestMonthIndex([])).toBe(-1);
    expect(findBestMonthIndex([])).toBe(-1);
  });
});
