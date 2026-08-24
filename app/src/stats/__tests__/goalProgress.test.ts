import {
  trailingAverageNet,
  calcGoalProgress,
  calcGoalStreak,
  suggestGoalAdjustment,
  RAISE_GOAL_STREAK_THRESHOLD,
  LOWER_GOAL_STREAK_THRESHOLD,
} from '@/src/stats/goalProgress';

describe('trailingAverageNet', () => {
  test('no weeks — null', () => {
    expect(trailingAverageNet([])).toBeNull();
  });

  test('fewer than N weeks — averages whatever exists', () => {
    expect(trailingAverageNet([{ weekEnding: '2026-08-01', net: 1000 }])).toBe(1000);
  });

  test('averages exactly the trailing N (default 4), ignoring older weeks', () => {
    const weeks = [
      { weekEnding: '2026-07-01', net: 100000 }, // way older, must be excluded
      { weekEnding: '2026-08-01', net: 1000 },
      { weekEnding: '2026-08-08', net: 2000 },
      { weekEnding: '2026-08-15', net: 3000 },
      { weekEnding: '2026-08-22', net: 4000 },
    ];
    expect(trailingAverageNet(weeks)).toBe(2500);
  });
});

describe('calcGoalProgress', () => {
  test('no goal — null', () => {
    expect(calcGoalProgress(null, 1000, 2, 500)).toBeNull();
  });

  test('goal met — 0 gap, no miles/loads needed', () => {
    const result = calcGoalProgress(1000, 1200, 2, 500);
    expect(result).toEqual({ progressDollars: 1200, progressPct: 120, metGoal: true, gapDollars: 0, milesToCloseGap: null, loadsToCloseGap: null });
  });

  test('goal short — real gap in $, miles at current RPM, and loads at avg revenue/load', () => {
    const result = calcGoalProgress(1000, 600, 2, 200);
    expect(result?.gapDollars).toBe(400);
    expect(result?.metGoal).toBe(false);
    expect(result?.milesToCloseGap).toBe(200); // 400 / 2
    expect(result?.loadsToCloseGap).toBe(2); // 400 / 200
  });

  test('short, but no real rpm/avg-revenue-per-load — never fabricates miles/loads', () => {
    const result = calcGoalProgress(1000, 600, null, null);
    expect(result?.milesToCloseGap).toBeNull();
    expect(result?.loadsToCloseGap).toBeNull();
  });
});

describe('calcGoalStreak', () => {
  test('no goal — 0', () => {
    expect(calcGoalStreak([{ weekEnding: '2026-08-01', net: 1000 }], null)).toBe(0);
  });

  test('no weeks — 0', () => {
    expect(calcGoalStreak([], 1000)).toBe(0);
  });

  test('3 consecutive weeks over goal — positive streak', () => {
    const weeks = [
      { weekEnding: '2026-07-25', net: 500 }, // under, breaks the streak going further back
      { weekEnding: '2026-08-01', net: 1200 },
      { weekEnding: '2026-08-08', net: 1300 },
      { weekEnding: '2026-08-15', net: 1100 },
    ];
    expect(calcGoalStreak(weeks, 1000)).toBe(3);
  });

  test('2 consecutive weeks under goal — negative streak', () => {
    const weeks = [
      { weekEnding: '2026-08-01', net: 1500 },
      { weekEnding: '2026-08-08', net: 800 },
      { weekEnding: '2026-08-15', net: 700 },
    ];
    expect(calcGoalStreak(weeks, 1000)).toBe(-2);
  });

  test('exactly meeting the goal counts as "met", not "missed"', () => {
    expect(calcGoalStreak([{ weekEnding: '2026-08-01', net: 1000 }], 1000)).toBe(1);
  });
});

describe('suggestGoalAdjustment', () => {
  test('below the raise threshold and above the lower threshold — no suggestion', () => {
    expect(suggestGoalAdjustment(2)).toBeNull();
    expect(suggestGoalAdjustment(-4)).toBeNull();
    expect(suggestGoalAdjustment(0)).toBeNull();
  });

  test('3+ consecutive beats — raise', () => {
    expect(suggestGoalAdjustment(RAISE_GOAL_STREAK_THRESHOLD)).toBe('raise');
    expect(suggestGoalAdjustment(RAISE_GOAL_STREAK_THRESHOLD + 2)).toBe('raise');
  });

  test('a long run of misses — lower', () => {
    expect(suggestGoalAdjustment(-LOWER_GOAL_STREAK_THRESHOLD)).toBe('lower');
    expect(suggestGoalAdjustment(-LOWER_GOAL_STREAK_THRESHOLD - 3)).toBe('lower');
  });
});
