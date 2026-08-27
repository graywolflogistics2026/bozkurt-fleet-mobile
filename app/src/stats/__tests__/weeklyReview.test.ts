import {
  shouldGenerateWeeklyReview,
  buildWeeklyReviewPrompt,
  buildWeeklyReviewFallbackText,
  isCachedReviewUsable,
  looksLikeExpectedScript,
  type WeeklyReviewInputs,
} from '@/src/stats/weeklyReview';

const NOW = new Date('2026-08-24T12:00:00Z');

describe('shouldGenerateWeeklyReview', () => {
  test('no settlements imported yet — never generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, null, null, 'en', NOW)).toBe(false);
  });

  test('never generated before, a real latest week exists — generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, null, '2026-08-22', 'en', NOW)).toBe(true);
  });

  test('cached review already covers the latest week, same locale — skip (same week, no new settlement, no language change)', () => {
    expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), 'en', '2026-08-22', 'en', NOW)).toBe(false);
  });

  test('a new settlement week arrived, but under 7 days since the last generation — respects the weekly cap', () => {
    const generated3DaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated3DaysAgo, 'en', '2026-08-22', 'en', NOW)).toBe(false);
  });

  test('a new settlement week arrived AND 7+ days since the last generation — generate', () => {
    const generated8DaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated8DaysAgo, 'en', '2026-08-22', 'en', NOW)).toBe(true);
  });

  // AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
  describe('locale mismatch (owner decision, item 5 — invalidate/regenerate on language switch)', () => {
    test('same week, but the cached review was generated in a different language — regenerate immediately, ignoring the 7-day cooldown', () => {
      const generatedJustNow = new Date(NOW.getTime() - 60_000).toISOString(); // 1 minute ago
      expect(shouldGenerateWeeklyReview('2026-08-22', generatedJustNow, 'en', '2026-08-22', 'tr', NOW)).toBe(true);
    });

    test('new week AND a locale mismatch — still generate, cooldown never even checked', () => {
      const generatedJustNow = new Date(NOW.getTime() - 60_000).toISOString();
      expect(shouldGenerateWeeklyReview('2026-08-15', generatedJustNow, 'en', '2026-08-22', 'tr', NOW)).toBe(true);
    });

    test('cachedLocale is null (a review cached before this column existed) and current locale is non-English — treated as a mismatch, regenerate', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), null, '2026-08-22', 'tr', NOW)).toBe(true);
    });

    test('cachedLocale is null and current locale is English — also a mismatch by the same strict equality rule (regenerates once, then null stops recurring since the fresh write will tag "en")', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), null, '2026-08-22', 'en', NOW)).toBe(true);
    });
  });
});

describe('isCachedReviewUsable', () => {
  test('a real review whose locale matches the current one is usable', () => {
    expect(isCachedReviewUsable('some review text', 'tr', 'tr')).toBe(true);
  });
  test('null review is never usable, regardless of locale', () => {
    expect(isCachedReviewUsable(null, 'tr', 'tr')).toBe(false);
  });
  test('empty-string review is never usable', () => {
    expect(isCachedReviewUsable('', 'tr', 'tr')).toBe(false);
  });
  test('a review cached under a different locale than the current one is not usable — the exact bug this fix targets', () => {
    expect(isCachedReviewUsable('This is an English review.', 'en', 'tr')).toBe(false);
  });
  test('cachedLocale null (pre-migration row) is never usable once a real locale is active', () => {
    expect(isCachedReviewUsable('some review text', null, 'tr')).toBe(false);
  });
});

describe('looksLikeExpectedScript', () => {
  test('Russian text with real Cyrillic characters passes for locale "ru"', () => {
    expect(looksLikeExpectedScript('Ваша выручка на этой неделе составила $3500.', 'ru')).toBe(true);
  });
  test('pure English text fails the check for locale "ru" — the exact server-ignored-locale case', () => {
    expect(looksLikeExpectedScript('Your revenue this week was $3500.', 'ru')).toBe(false);
  });
  test('Hindi text with real Devanagari characters passes for locale "hi"', () => {
    expect(looksLikeExpectedScript('इस सप्ताह आपका राजस्व $3500 था।', 'hi')).toBe(true);
  });
  test('pure English text fails the check for locale "hi"', () => {
    expect(looksLikeExpectedScript('Your revenue this week was $3500.', 'hi')).toBe(false);
  });
  test('a locale with no defined script range (es, tr, en) always passes — no reliable check exists for Latin-script locales', () => {
    expect(looksLikeExpectedScript('Your revenue this week was $3500.', 'es')).toBe(true);
    expect(looksLikeExpectedScript('Your revenue this week was $3500.', 'tr')).toBe(true);
    expect(looksLikeExpectedScript('Your revenue this week was $3500.', 'en')).toBe(true);
  });
  test('mixed text with glossary terms in Latin script alongside real Cyrillic still passes for ru (glossary terms are expected to stay English)', () => {
    expect(looksLikeExpectedScript('Ваш per diem составил 7 дней на этой неделе.', 'ru')).toBe(true);
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

// AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — item 4's actual fallback:
// a fake t() records exactly which keys/params it was called with, so
// these tests prove real i18n keys are used (not a hardcoded English
// template reappearing under a different name) and that every real
// number given flows through untouched.
describe('buildWeeklyReviewFallbackText', () => {
  function fakeT(key: string, opts?: Record<string, unknown>): string {
    const paramsStr = opts ? JSON.stringify(opts) : '';
    return `[${key}${paramsStr ? ' ' + paramsStr : ''}]`;
  }
  const money = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  test('every t() call uses a ceoMode.weeklyReviewFallback.* key — never a hardcoded English sentence', () => {
    const text = buildWeeklyReviewFallbackText(inputs(), fakeT, money, pct);
    // Every bracketed segment must be one of this namespace's keys.
    const keysUsed = [...text.matchAll(/\[([a-zA-Z0-9.]+)/g)].map((m) => m[1]);
    expect(keysUsed.length).toBeGreaterThan(0);
    for (const key of keysUsed) {
      expect(key.startsWith('ceoMode.weeklyReviewFallback.')).toBe(true);
    }
  });

  test('real numbers reach the params — never re-derived, never invented', () => {
    const text = buildWeeklyReviewFallbackText(inputs(), fakeT, money, pct);
    expect(text).toContain('"gross":"$3500.00"');
    expect(text).toContain('"net":"$2800.00"');
    expect(text).toContain('"date":"2026-08-22"');
    expect(text).toContain('"rpm":"$2.10"');
    expect(text).toContain('"avg":"$1.95"');
    expect(text).toContain('"pct":"8.0%"'); // deadhead
    expect(text).toContain('"pct":"22.0%"'); // fuel
    expect(text).toContain('"count":7'); // per diem days
    expect(text).toContain('"amount":"$42800.00"'); // YTD after
  });

  test('a null figure omits that key entirely, same "never invent" discipline as the AI prompt version', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ rpm: null, deadheadPct: null, fuelPctOfRevenue: null }), fakeT, money, pct);
    expect(text).not.toContain('weeklyReviewFallback.rpm');
    expect(text).not.toContain('weeklyReviewFallback.deadhead');
    expect(text).not.toContain('weeklyReviewFallback.fuel');
  });

  test('rpm with no trailing average uses the plain rpm key, not the vs-average one', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ trailingAvgRpm: null }), fakeT, money, pct);
    expect(text).toContain('weeklyReviewFallback.rpm ');
    expect(text).not.toContain('weeklyReviewFallback.rpmVsAvg');
  });

  test('goal met uses the goalMet key with the goal amount, never the shortfall key', () => {
    const text = buildWeeklyReviewFallbackText(
      inputs({
        goalProgress: { weeklyGoal: 2000, progressDollars: 2800, progressPct: 140, metGoal: true, gapDollars: 0, milesToCloseGap: null, loadsToCloseGap: null },
      }),
      fakeT,
      money,
      pct
    );
    expect(text).toContain('weeklyReviewFallback.goalMet');
    expect(text).toContain('"goal":"$2000.00"');
    expect(text).not.toContain('weeklyReviewFallback.goalShort');
  });

  test('goal missed uses the goalShort key with the real gap amount', () => {
    const text = buildWeeklyReviewFallbackText(
      inputs({
        goalProgress: { weeklyGoal: 3000, progressDollars: 2800, progressPct: 93, metGoal: false, gapDollars: 200, milesToCloseGap: 95.2, loadsToCloseGap: 1.3 },
      }),
      fakeT,
      money,
      pct
    );
    expect(text).toContain('weeklyReviewFallback.goalShort');
    expect(text).toContain('"amount":"$200.00"');
  });

  test('no goal set — omits any goal key entirely', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ goalProgress: null }), fakeT, money, pct);
    expect(text).not.toContain('weeklyReviewFallback.goalMet');
    expect(text).not.toContain('weeklyReviewFallback.goalShort');
  });

  test('zero per diem days omits the per diem key (0 is falsy-meaningful here — a real home week, not worth a line)', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ perDiemDays: 0 }), fakeT, money, pct);
    expect(text).not.toContain('weeklyReviewFallback.perDiem');
  });
});
