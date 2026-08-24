import { shouldGenerateWeeklyReview, buildWeeklyReviewPrompt, type WeeklyReviewInputs } from '@/src/stats/weeklyReview';

const NOW = new Date('2026-08-24T12:00:00Z');

describe('shouldGenerateWeeklyReview', () => {
  test('no settlements imported yet — never generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, null, NOW)).toBe(false);
  });

  test('never generated before, a real latest week exists — generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, '2026-08-22', NOW)).toBe(true);
  });

  test('cached review already covers the latest week — skip (same week, no new settlement)', () => {
    expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), '2026-08-22', NOW)).toBe(false);
  });

  test('a new settlement week arrived, but under 7 days since the last generation — respects the weekly cap', () => {
    const generated3DaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated3DaysAgo, '2026-08-22', NOW)).toBe(false);
  });

  test('a new settlement week arrived AND 7+ days since the last generation — generate', () => {
    const generated8DaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated8DaysAgo, '2026-08-22', NOW)).toBe(true);
  });
});

function inputs(overrides: Partial<WeeklyReviewInputs> = {}): WeeklyReviewInputs {
  return {
    weekEnding: '2026-08-22',
    gross: 3500,
    net: 2800,
    rpm: 2.1,
    trailingAvgRpm: 1.95,
    deadheadPct: 0.08,
    fuelPctOfRevenue: 0.22,
    biggestChargebacks: [],
    perDiemDays: 7,
    ytdProfitBefore: 40000,
    ytdProfitAfter: 42800,
    ...overrides,
  };
}

describe('buildWeeklyReviewPrompt', () => {
  test('includes every real figure given', () => {
    const prompt = buildWeeklyReviewPrompt(inputs());
    expect(prompt).toContain('2026-08-22');
    expect(prompt).toContain('$3500.00');
    expect(prompt).toContain('$2800.00');
    expect(prompt).toContain('$2.10/mi');
    expect(prompt).toContain('$1.95/mi');
    expect(prompt).toContain('8.0%');
    expect(prompt).toContain('22.0%');
    expect(prompt).toContain('Per diem days this week: 7');
    expect(prompt).toContain('$40000.00');
    expect(prompt).toContain('$42800.00');
  });

  test('never invents a number for a null figure — omits that sentence entirely', () => {
    const prompt = buildWeeklyReviewPrompt(inputs({ rpm: null, deadheadPct: null, fuelPctOfRevenue: null }));
    expect(prompt).not.toContain('Rate per mile');
    expect(prompt).not.toContain('Deadhead');
    expect(prompt).not.toContain('Fuel was');
  });

  test('lists real chargebacks by name and amount when present', () => {
    const prompt = buildWeeklyReviewPrompt(inputs({ biggestChargebacks: [{ description: 'Fuel Advance', amount: 450 }] }));
    expect(prompt).toContain('Fuel Advance ($450.00)');
  });

  test('says "no large chargebacks" when none exist, rather than an empty list', () => {
    const prompt = buildWeeklyReviewPrompt(inputs({ biggestChargebacks: [] }));
    expect(prompt).toContain('No large settlement chargebacks this week.');
  });

  test('always ends with the never-invent-a-number instruction', () => {
    const prompt = buildWeeklyReviewPrompt(inputs());
    expect(prompt).toContain('Never invent a figure that was not given here.');
  });
});
