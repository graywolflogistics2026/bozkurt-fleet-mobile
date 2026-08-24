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

  // WEEKLY GOAL DRIVES THE COACH (2026-08-24 FIVE ADDITIONS pass, PART 3
  // item 1) — no goal set at all -> no goal sentence, never a fabricated
  // "$0 goal."
  test('no goal set — omits the goal sentence entirely', () => {
    const prompt = buildWeeklyReviewPrompt(inputs({ goalProgress: null }));
    expect(prompt).not.toContain('Weekly profit goal');
  });

  test('goal met — states progress, no gap-closing terms', () => {
    const prompt = buildWeeklyReviewPrompt(
      inputs({
        goalProgress: {
          weeklyGoal: 2000,
          progressDollars: 2800,
          progressPct: 140,
          metGoal: true,
          gapDollars: 0,
          milesToCloseGap: null,
          loadsToCloseGap: null,
        },
      })
    );
    expect(prompt).toContain('Weekly profit goal: $2000.00');
    expect(prompt).toContain('140% of goal');
    expect(prompt).toContain('met or beaten');
    expect(prompt).not.toContain('Short of the goal');
  });

  test('goal missed — states the real $ gap and the user\'s own miles/loads terms', () => {
    const prompt = buildWeeklyReviewPrompt(
      inputs({
        goalProgress: {
          weeklyGoal: 3000,
          progressDollars: 2800,
          progressPct: 93,
          metGoal: false,
          gapDollars: 200,
          milesToCloseGap: 95.2,
          loadsToCloseGap: 1.3,
        },
      })
    );
    expect(prompt).toContain('Short of the goal by $200.00');
    expect(prompt).toContain('about 95 more miles');
    expect(prompt).toContain('roughly 2 more load(s)');
  });

  test('goal missed but no real rpm/avg-revenue-per-load — never fabricates the gap-closing terms', () => {
    const prompt = buildWeeklyReviewPrompt(
      inputs({
        goalProgress: {
          weeklyGoal: 3000,
          progressDollars: 2800,
          progressPct: 93,
          metGoal: false,
          gapDollars: 200,
          milesToCloseGap: null,
          loadsToCloseGap: null,
        },
      })
    );
    expect(prompt).toContain('Short of the goal by $200.00');
    expect(prompt).not.toContain('more miles');
    expect(prompt).not.toContain('more load(s)');
  });
});
