// 08/28 DEVICE TEST, finding 4 (owner 2026-11-13): AI Coach printed "Cost
// per mile $19.77/mi" for a week with 0 miles, and "short of your $5,000
// weekly goal" although no goal was set on purpose. The review cites a cost
// per mile only for a week with miles, and a goal only when one is set.
import { buildWeeklyReviewFallbackText, buildWeeklyReviewPrompt, weeklyReviewCpm, type WeeklyReviewInputs } from '../weeklyReview';

const t = (key: string, opts: Record<string, unknown> = {}) => `${key}${JSON.stringify(opts)}`;
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const zeroMileWeek: WeeklyReviewInputs = {
  weekEnding: '2026-08-28',
  gross: 191.4,
  net: 436.04,
  rpm: null,
  trailingAvgRpm: null,
  cpm: weeklyReviewCpm(null, 19.77),
  deadheadPct: null,
  fuelPctOfRevenue: null,
  biggestChargebacks: [],
  perDiemDays: 0,
  ytdProfitBefore: 0,
  ytdProfitAfter: 436.04,
  settlementCountYtd: 1,
};

test('weeklyReviewCpm: only for a week with its own rate per mile', () => {
  expect(weeklyReviewCpm(null, 19.77)).toBeNull();
  expect(weeklyReviewCpm(2.1, 1.65)).toBe(1.65);
  expect(weeklyReviewCpm(2.1, null)).toBeNull();
});

test('a 0-mile week: no cost or rate per mile, no goal line, in the fallback and the AI prompt', () => {
  const text = buildWeeklyReviewFallbackText(zeroMileWeek, t, money, pct);
  expect(text).not.toContain('weeklyReviewFallback.cpm');
  expect(text).not.toContain('weeklyReviewFallback.rpm');
  expect(text).not.toContain('goalShort');
  expect(text).not.toContain('19.77');
  const prompt = buildWeeklyReviewPrompt(zeroMileWeek);
  expect(prompt).not.toMatch(/cost per mile/i);
  expect(prompt).not.toMatch(/weekly profit goal/i);
});
