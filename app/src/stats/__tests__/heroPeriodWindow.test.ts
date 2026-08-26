import { resolveHeroPeriodDateWindow, resolvePreviousHeroPeriodDateWindow, filterRowsByDateWindow, calcHeroRevenueExpenseTrio } from '@/src/stats/heroPeriodWindow';

const weekEndings = ['2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27'];

describe('resolveHeroPeriodDateWindow', () => {
  it('resolves "thisWeek" to the 7-day window ending at the LATEST week_ending', () => {
    const window = resolveHeroPeriodDateWindow('thisWeek', weekEndings);
    expect(window).toEqual({ startIso: '2026-06-21', endIso: '2026-06-27' });
  });

  it('resolves "lastWeek" to the window ending at the SECOND-latest week_ending', () => {
    const window = resolveHeroPeriodDateWindow('lastWeek', weekEndings);
    expect(window).toEqual({ startIso: '2026-06-14', endIso: '2026-06-20' });
  });

  it('returns null for "thisWeek"/"lastWeek" when there are no settlement weeks at all', () => {
    expect(resolveHeroPeriodDateWindow('thisWeek', [])).toBeNull();
    expect(resolveHeroPeriodDateWindow('lastWeek', [])).toBeNull();
  });

  it('returns null for "lastWeek" when only one settlement week exists (no prior week to resolve to)', () => {
    expect(resolveHeroPeriodDateWindow('lastWeek', ['2026-06-27'])).toBeNull();
  });

  it('resolves "1M"/"3M"/"6M"/"yearly" to rolling N-day windows ending "now", independent of week_ending data', () => {
    const now = new Date('2026-08-15T12:00:00');
    expect(resolveHeroPeriodDateWindow('1M', [], now)).toEqual({ startIso: '2026-07-16', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('3M', [], now)).toEqual({ startIso: '2026-05-17', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('6M', [], now)).toEqual({ startIso: '2026-02-16', endIso: '2026-08-15' });
    expect(resolveHeroPeriodDateWindow('yearly', [], now)).toEqual({ startIso: '2025-08-15', endIso: '2026-08-15' });
  });
});

describe('filterRowsByDateWindow', () => {
  const rows = [{ id: 'a', d: '2026-06-10' }, { id: 'b', d: '2026-06-20' }, { id: 'c', d: null }, { id: 'd', d: '2026-07-01' }];

  it('keeps only rows whose date falls within [startIso, endIso] inclusive', () => {
    const result = filterRowsByDateWindow(rows, (r) => r.d, { startIso: '2026-06-15', endIso: '2026-06-25' });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('returns an empty array (never all rows) when the window is null — "no data," never a silent fallback to unfiltered', () => {
    expect(filterRowsByDateWindow(rows, (r) => r.d, null)).toEqual([]);
  });

  it('excludes rows with no date at all', () => {
    const result = filterRowsByDateWindow(rows, (r) => r.d, { startIso: '2020-01-01', endIso: '2030-01-01' });
    expect(result.find((r) => r.id === 'c')).toBeUndefined();
  });
});

describe('resolvePreviousHeroPeriodDateWindow', () => {
  it('"thisWeek"\'s previous window is exactly the "lastWeek" window (the settlement week right before it)', () => {
    const previous = resolvePreviousHeroPeriodDateWindow('thisWeek', weekEndings);
    expect(previous).toEqual(resolveHeroPeriodDateWindow('lastWeek', weekEndings));
  });

  it('"lastWeek"\'s previous window is the settlement week before THAT', () => {
    const previous = resolvePreviousHeroPeriodDateWindow('lastWeek', weekEndings);
    expect(previous).toEqual({ startIso: '2026-06-07', endIso: '2026-06-13' });
  });

  it('returns null when there is no settlement that far back yet', () => {
    expect(resolvePreviousHeroPeriodDateWindow('thisWeek', ['2026-06-27'])).toBeNull();
    expect(resolvePreviousHeroPeriodDateWindow('lastWeek', ['2026-06-20', '2026-06-27'])).toBeNull();
  });

  it('a rolling period\'s previous window is the same-length window immediately before it, never overlapping', () => {
    const now = new Date('2026-08-15T12:00:00');
    const current = resolveHeroPeriodDateWindow('1M', [], now);
    const previous = resolvePreviousHeroPeriodDateWindow('1M', [], now);
    expect(current).toEqual({ startIso: '2026-07-16', endIso: '2026-08-15' });
    expect(previous).toEqual({ startIso: '2026-06-16', endIso: '2026-07-15' });
    // The day right before current's own start — no gap, no overlap.
    expect(previous!.endIso < current!.startIso).toBe(true);
  });
});

describe('calcHeroRevenueExpenseTrio', () => {
  const settlements = [
    { week_ending: '2026-06-06', gross: 1000 },
    { week_ending: '2026-06-13', gross: 1200 },
    { week_ending: '2026-06-20', gross: 1500 }, // lastWeek
    { week_ending: '2026-06-27', gross: 1400 }, // thisWeek
  ];
  const deductions = [
    { ded_date: '2026-06-16', amount: 300 }, // in lastWeek's window (06-14..06-20)
    { ded_date: '2026-06-23', amount: 200 }, // in thisWeek's window (06-21..06-27)
    { ded_date: '2026-06-25', amount: 50 }, // also in thisWeek's window
    { ded_date: '2026-05-01', amount: 999 }, // far outside — must never be counted
  ];

  it('"thisWeek": revenue/expenses come from the exact settlement-week window, delta compares to "lastWeek"', () => {
    const result = calcHeroRevenueExpenseTrio(settlements, deductions, 'thisWeek', weekEndings);
    expect(result.window).toEqual({ startIso: '2026-06-21', endIso: '2026-06-27' });
    expect(result.revenue).toBe(1400);
    expect(result.expenses).toBe(250); // 200 + 50
    expect(result.revenueChange.direction).toBe('down'); // 1400 vs 1500
    expect(result.expensesChange.direction).toBe('down'); // 250 vs 300
  });

  it('expenses reconciles EXACTLY with a direct filterRowsByDateWindow sum over the same rows — the Expense Explainer\'s own total can never disagree', () => {
    const result = calcHeroRevenueExpenseTrio(settlements, deductions, 'thisWeek', weekEndings);
    const window = resolveHeroPeriodDateWindow('thisWeek', weekEndings);
    const explainerTotal = filterRowsByDateWindow(deductions, (d) => d.ded_date, window).reduce((sum, d) => sum + d.amount, 0);
    expect(result.expenses).toBe(explainerTotal);
  });

  it('has no delta (pct: null) when the previous window has zero data — never a fabricated 0 baseline', () => {
    const oneSettlement = [{ week_ending: '2026-06-27', gross: 1400 }];
    const result = calcHeroRevenueExpenseTrio(oneSettlement, [], 'thisWeek', ['2026-06-27']);
    expect(result.revenueChange.pct).toBeNull();
    expect(result.expensesChange.pct).toBeNull();
  });

  it('returns revenue/expenses of 0 and a null window on a zero-settlement account — never an all-time fallback', () => {
    const result = calcHeroRevenueExpenseTrio([], [], 'thisWeek', []);
    expect(result.window).toBeNull();
    expect(result.revenue).toBe(0);
    expect(result.expenses).toBe(0);
  });

  it('rolling periods (1M) sum every settlement/deduction row in the window and compare to the immediately preceding equal-length window', () => {
    const now = new Date('2026-07-10T12:00:00');
    // Window: 2026-06-10..2026-07-10 -> covers 06-13/06-20/06-27 settlements.
    // Previous window: 2026-05-11..2026-06-09 -> covers 06-06 settlement.
    const result = calcHeroRevenueExpenseTrio(settlements, deductions, '1M', weekEndings, now);
    expect(result.revenue).toBe(1200 + 1500 + 1400);
    expect(result.revenueChange.pct).not.toBeNull();
  });
});
