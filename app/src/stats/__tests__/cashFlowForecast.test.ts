import {
  buildSpendEvents,
  trailingWeeklyNetIncomeAverage,
  trailingWeeklyMilesAverage,
  upcomingReimbursementsByWeek,
  buildCashFlowForecast,
  buildCashFlowForecastFromData,
  EMPTY_CASH_FLOW_OVERRIDES,
  type CashFlowOverrides,
} from '../cashFlowForecast';
import { classifyCashFlowSpending } from '../cashFlowClassification';

const TODAY = new Date('2026-08-15T12:00:00Z');

describe('buildSpendEvents', () => {
  it('excludes Meals/Advance Repayment/Escrow (never a real cash outflow to project)', () => {
    const deductions = [
      { ded_date: '2026-08-01', amount: 50, category: 'Meals (per diem covered)', description: 'Diner', source: 'settlement', tax_deductible: false },
      { ded_date: '2026-08-01', amount: 200, category: 'Insurance—Truck', description: 'Insurance', source: 'settlement', tax_deductible: true },
    ];
    const events = buildSpendEvents(deductions, [], [], [], '2020-01-01');
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('Insurance—Truck');
  });

  it('excludes a settlement-linked fuel_purchases row (already represented by the settlement\'s own withheld fuel deduction — never double-counted)', () => {
    const fuel = [
      { purchase_date: '2026-08-01', amount: 400, discount: 0, location: 'Pilot', settlement_id: 'settlement-1' },
      { purchase_date: '2026-08-02', amount: 150, discount: 10, location: 'Loves', settlement_id: null },
    ];
    const events = buildSpendEvents([], fuel, [], [], '2020-01-01');
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(140); // net of discount, standalone row only
  });

  it('skips rows before the window start', () => {
    const deductions = [{ ded_date: '2020-01-01', amount: 100, category: 'Insurance—Truck', description: 'old', source: 'settlement', tax_deductible: true }];
    const events = buildSpendEvents(deductions, [], [], [], '2026-01-01');
    expect(events).toHaveLength(0);
  });

  it('skips $0 rows', () => {
    const deductions = [{ ded_date: '2026-08-01', amount: 0, category: 'Insurance—Truck', description: 'x', source: 'settlement', tax_deductible: true }];
    const events = buildSpendEvents(deductions, [], [], [], '2020-01-01');
    expect(events).toHaveLength(0);
  });

  it('includes maintenance and tolls unconditionally (no settlement_id column to guard, same established precedent)', () => {
    const maintenance = [{ service_date: '2026-08-01', cost: 300, description: 'Oil change' }];
    const tolls = [{ toll_date: '2026-08-01', amount: 25, plaza: 'I-80' }];
    const events = buildSpendEvents([], [], maintenance, tolls, '2020-01-01');
    expect(events.map((e) => e.category).sort()).toEqual(['Maintenance & Repairs', 'Tolls & Scales']);
  });
});

describe('trailingWeeklyNetIncomeAverage — INCOME adjusted for how many settlements actually landed', () => {
  it('divides by distinct settlement weeks found, not a fixed 4 — a missing week is never assumed $0', () => {
    // Only 2 real settlements in the trailing window, not 4.
    const settlements = [
      { week_ending: '2026-08-01', gross: 5000, net: 3000, miles: 2000 },
      { week_ending: '2026-08-08', gross: 5200, net: 3200, miles: 2100 },
    ];
    const result = trailingWeeklyNetIncomeAverage(settlements);
    expect(result.weeksFound).toBe(2);
    expect(result.average).toBe((3000 + 3200) / 2); // not /4
  });

  it('a real $0-net "home week" settlement that DID land still counts as one of the weeks, correctly pulling the average down', () => {
    const settlements = [
      { week_ending: '2026-07-18', gross: 5000, net: 3000, miles: 2500 },
      { week_ending: '2026-07-25', gross: 0, net: 0, miles: 0 }, // real home week
      { week_ending: '2026-08-01', gross: 5000, net: 3000, miles: 2500 },
      { week_ending: '2026-08-08', gross: 5000, net: 3000, miles: 2500 },
    ];
    const income = trailingWeeklyNetIncomeAverage(settlements);
    const miles = trailingWeeklyMilesAverage(settlements);
    expect(income.weeksFound).toBe(4);
    expect(income.average).toBe((3000 + 0 + 3000 + 3000) / 4); // 2250, not silently halved
    expect(miles.average).toBe((2500 + 0 + 2500 + 2500) / 4);
  });
});

describe('upcomingReimbursementsByWeek', () => {
  it('places a reimbursement dated within the window into the correct week bucket', () => {
    const reimbursements = [
      { reimb_date: '2026-08-16', amount: 100 }, // day 1 -> week 0
      { reimb_date: '2026-08-30', amount: 200 }, // day 15 -> week 2
    ];
    const byWeek = upcomingReimbursementsByWeek(reimbursements, TODAY);
    expect(byWeek.get(0)).toBe(100);
    expect(byWeek.get(2)).toBe(200);
  });

  it('excludes a reimbursement dated in the past or beyond the window', () => {
    const reimbursements = [
      { reimb_date: '2026-08-01', amount: 100 }, // past
      { reimb_date: '2026-12-01', amount: 200 }, // far future
    ];
    const byWeek = upcomingReimbursementsByWeek(reimbursements, TODAY);
    expect(byWeek.size).toBe(0);
  });
});

describe('buildCashFlowForecast — week-by-week assembly', () => {
  it('chains opening/ending balances across 4 weeks and applies income/fixed/variable/periodic correctly', () => {
    // KPI CONSISTENCY / SHOW AND LET ME CORRECT IT (owner decision) —
    // buildCashFlowForecast() now derives weeklyFixed from
    // classification.fixed (via mergeRecurringCharges()), not the
    // pre-computed weeklyFixedTotal shortcut this fixture used to patch
    // directly — a real `fixed` entry is required for this to still mean
    // what the test says it means.
    const classification = { ...classifyCashFlowSpending([], 0), fixed: [{ category: 'Insurance—Truck', weeklyAmount: 300, occurrences: 6, source: 'auto' as const }] };
    const result = buildCashFlowForecast(
      1000,
      { average: 2000, weeksFound: 4 },
      classification,
      { average: 2500, weeksFound: 4 },
      [],
      new Map(),
      EMPTY_CASH_FLOW_OVERRIDES,
      TODAY
    );
    expect(result.weeks).toHaveLength(4);
    expect(result.weeks[0].openingBalance).toBe(1000);
    // net = income(2000) - fixed(300) - variable(computed rate * miles, 0
    // here since classification has no variable categories) = 1700
    expect(result.weeks[0].closingBalance).toBe(1000 + 2000 - 300 - 0);
    expect(result.weeks[1].openingBalance).toBe(result.weeks[0].closingBalance);
  });

  it('a periodic item lands in the exact week whose date range contains its due date', () => {
    const classification = classifyCashFlowSpending([], 0);
    const periodicItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2290', dueDate: '2026-08-25', amount: 550, amountSource: 'document' as const }];
    const result = buildCashFlowForecast(1000, { average: 1000, weeksFound: 4 }, classification, { average: 0, weeksFound: 0 }, periodicItems, new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    // TODAY=2026-08-15, week 0 = Aug15-21, week 1 = Aug22-28 -> due date Aug 25 lands in week 1.
    expect(result.weeks[0].periodicItems).toHaveLength(0);
    expect(result.weeks[1].periodicItems).toHaveLength(1);
    expect(result.weeks[1].periodic).toBe(550);
  });

  it('identifies the tightest (lowest ending balance) week', () => {
    const classification = classifyCashFlowSpending([], 0);
    const periodicItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2290', dueDate: '2026-08-25', amount: 5000, amountSource: 'document' as const }];
    const result = buildCashFlowForecast(2000, { average: 1000, weeksFound: 4 }, classification, { average: 0, weeksFound: 0 }, periodicItems, new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    expect(result.tightestWeekIndex).toBe(1);
  });

  it('reliability flag is false under 3 weeks of history, true at/above it', () => {
    const classification = classifyCashFlowSpending([], 0);
    const unreliable = buildCashFlowForecast(0, { average: 0, weeksFound: 2 }, { ...classification, weeksObserved: 2 }, { average: 0, weeksFound: 0 }, [], new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    expect(unreliable.reliable).toBe(false);
    expect(unreliable.weeksOfHistory).toBe(2);

    const reliable = buildCashFlowForecast(0, { average: 0, weeksFound: 3 }, { ...classification, weeksObserved: 3 }, { average: 0, weeksFound: 0 }, [], new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    expect(reliable.reliable).toBe(true);
  });
});

describe('buildCashFlowForecast — OVERRIDES survive a changed computed average (item 4 + item 6)', () => {
  it('an income override always wins over whatever the computed average recomputes to', () => {
    const classification = classifyCashFlowSpending([], 0);
    const overrides: CashFlowOverrides = { ...EMPTY_CASH_FLOW_OVERRIDES, incomeWeekly: 4000 };

    const before = buildCashFlowForecast(0, { average: 2000, weeksFound: 4 }, classification, { average: 0, weeksFound: 0 }, [], new Map(), overrides, TODAY);
    expect(before.weeklyIncome).toBe(4000);
    expect(before.incomeIsOverridden).toBe(true);

    // Simulate a NEW settlement import changing the underlying average —
    // the SAME override object must still win.
    const after = buildCashFlowForecast(0, { average: 2600, weeksFound: 5 }, classification, { average: 0, weeksFound: 0 }, [], new Map(), overrides, TODAY);
    expect(after.weeklyIncome).toBe(4000);
    expect(after.incomeIsOverridden).toBe(true);
  });

  it('a fixed/variable override each independently wins over their own computed figure', () => {
    const classification = { ...classifyCashFlowSpending([], 0), weeklyFixedTotal: 300 };
    const overrides: CashFlowOverrides = { ...EMPTY_CASH_FLOW_OVERRIDES, fixedWeekly: 500, variableWeekly: 900 };
    const result = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, classification, { average: 1000, weeksFound: 4 }, [], new Map(), overrides, TODAY);
    expect(result.weeklyFixed).toBe(500);
    expect(result.fixedIsOverridden).toBe(true);
    expect(result.weeklyVariable).toBe(900);
    expect(result.variableIsOverridden).toBe(true);
  });

  it('a periodic item override wins over the document-sourced amount', () => {
    const classification = classifyCashFlowSpending([], 0);
    const periodicItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2290', dueDate: '2026-08-20', amount: 550, amountSource: 'document' as const }];
    const overrides: CashFlowOverrides = { ...EMPTY_CASH_FLOW_OVERRIDES, periodicAmounts: { c1: 620 } };
    const result = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, classification, { average: 0, weeksFound: 0 }, periodicItems, new Map(), overrides, TODAY);
    expect(result.weeks[0].periodic).toBe(620);
  });

  it('no override (null) falls back cleanly to the computed value', () => {
    const classification = { ...classifyCashFlowSpending([], 0), fixed: [{ category: 'Insurance—Truck', weeklyAmount: 300, occurrences: 6, source: 'auto' as const }] };
    const result = buildCashFlowForecast(0, { average: 2000, weeksFound: 4 }, classification, { average: 0, weeksFound: 0 }, [], new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    expect(result.weeklyIncome).toBe(2000);
    expect(result.incomeIsOverridden).toBe(false);
    expect(result.weeklyFixed).toBe(300);
    expect(result.fixedIsOverridden).toBe(false);
  });
});

describe('buildCashFlowForecast — SHOW AND LET ME CORRECT IT (owner decision)', () => {
  it('forecast.fixedCharges reflects detected + manual corrections, and weeklyFixed sums them (never the stale classification.weeklyFixedTotal alone)', () => {
    const classification = {
      ...classifyCashFlowSpending([], 0),
      fixed: [{ category: 'Insurance—Truck', weeklyAmount: 36, occurrences: 6, source: 'auto' as const }],
    };
    const overrides: CashFlowOverrides = {
      ...EMPTY_CASH_FLOW_OVERRIDES,
      recurringCharges: { 'Permits, Licenses & Road Taxes': { weeklyAmount: 100 } },
    };
    const result = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, classification, { average: 0, weeksFound: 0 }, [], new Map(), overrides, TODAY);
    expect(result.fixedCharges.map((f) => f.category).sort()).toEqual(['Insurance—Truck', 'Permits, Licenses & Road Taxes']);
    expect(result.weeklyFixed).toBe(36 + 100);
    expect(result.fixedIsOverridden).toBe(false); // this is the per-charge lever, not the whole-total override
  });

  it('A MANUALLY ADDED RECURRING CHARGE SURVIVES A NEW IMPORT end to end — the SAME overrides object still contributes after the underlying classification changes', () => {
    const overrides: CashFlowOverrides = {
      ...EMPTY_CASH_FLOW_OVERRIDES,
      recurringCharges: { 'Roadside Assistance Plan': { weeklyAmount: 15 } },
    };
    const beforeImport = { ...classifyCashFlowSpending([], 0), fixed: [] as ReturnType<typeof classifyCashFlowSpending>['fixed'] };
    const before = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, beforeImport, { average: 0, weeksFound: 0 }, [], new Map(), overrides, TODAY);
    expect(before.weeklyFixed).toBe(15);

    // A new settlement import changes what the classifier itself detects.
    const afterImport = {
      ...classifyCashFlowSpending([], 0),
      fixed: [{ category: 'Insurance—Truck', weeklyAmount: 36, occurrences: 6, source: 'auto' as const }],
    };
    const after = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, afterImport, { average: 0, weeksFound: 0 }, [], new Map(), overrides, TODAY);
    expect(after.fixedCharges.some((f) => f.category === 'Roadside Assistance Plan' && f.source === 'manual')).toBe(true);
    expect(after.weeklyFixed).toBe(36 + 15);
  });

  it('NEVER PRESENTS "$0 FIXED" SILENTLY AS THE ONLY SIGNAL — fixedCharges is genuinely empty when nothing is detected and nothing was added, so the screen can show the "not enough history" message', () => {
    const classification = classifyCashFlowSpending([], 0);
    const result = buildCashFlowForecast(0, { average: 0, weeksFound: 0 }, classification, { average: 0, weeksFound: 0 }, [], new Map(), EMPTY_CASH_FLOW_OVERRIDES, TODAY);
    expect(result.fixedCharges).toHaveLength(0);
    expect(result.weeklyFixed).toBe(0);
  });
});

describe('buildCashFlowForecastFromData — end to end on a realistic dataset', () => {
  it('never shows a blank forecast when settlements exist — produces real weeks from raw query-shaped data', () => {
    const settlements = [
      { week_ending: '2026-07-18', gross: 5200, net: 3600, miles: 2500 },
      { week_ending: '2026-07-25', gross: 5100, net: 3500, miles: 2450 },
      { week_ending: '2026-08-01', gross: 5300, net: 3700, miles: 2600 },
      { week_ending: '2026-08-08', gross: 5250, net: 3650, miles: 2550 },
    ];
    const deductions = [
      { ded_date: '2026-07-18', amount: 210, category: 'Insurance—Truck', description: 'Insurance', source: 'settlement', tax_deductible: true },
      { ded_date: '2026-07-25', amount: 208, category: 'Insurance—Truck', description: 'Insurance', source: 'settlement', tax_deductible: true },
      { ded_date: '2026-08-01', amount: 212, category: 'Insurance—Truck', description: 'Insurance', source: 'settlement', tax_deductible: true },
      { ded_date: '2026-08-08', amount: 209, category: 'Insurance—Truck', description: 'Insurance', source: 'settlement', tax_deductible: true },
    ];
    const fuelPurchases = [
      { purchase_date: '2026-07-19', amount: 480, discount: 20, location: 'Pilot', settlement_id: null },
      { purchase_date: '2026-08-02', amount: 510, discount: 0, location: 'Loves', settlement_id: null },
    ];
    const complianceItems = [{ id: 'c1', type: 'hvut_2290' as const, label: '2026 HVUT 2290', due_date: '2026-08-25', source_document_id: null }];

    const result = buildCashFlowForecastFromData({
      bankBalance: 5000,
      settlements,
      deductions,
      fuelPurchases,
      maintenanceRecords: [],
      tolls: [],
      reimbursements: [],
      complianceItems,
      documents: [],
      overrides: EMPTY_CASH_FLOW_OVERRIDES,
      today: TODAY,
    });

    expect(result.weeks).toHaveLength(4);
    expect(result.weeklyIncome).toBeGreaterThan(0);
    expect(result.classification.fixed.some((f) => f.category === 'Insurance—Truck')).toBe(true);
    expect(result.classification.variable.some((v) => v.category === 'Fuel & DEF')).toBe(true);
    // The 2290 due Aug 25 lands somewhere in the 4-week window.
    expect(result.weeks.some((w) => w.periodicItems.some((p) => p.id === 'c1'))).toBe(true);
  });
});
