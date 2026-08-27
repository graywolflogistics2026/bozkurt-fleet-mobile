import {
  shouldGenerateWeeklyReview,
  buildWeeklyReviewPrompt,
  buildWeeklyReviewFallbackText,
  computeWeeklyReviewFingerprint,
  isCachedReviewUsable,
  looksLikeExpectedScript,
  type WeeklyReviewInputs,
} from '@/src/stats/weeklyReview';

const NOW = new Date('2026-08-24T12:00:00Z');
const FP = 'fingerprint-A';
const FP2 = 'fingerprint-B';

describe('shouldGenerateWeeklyReview', () => {
  test('no settlements imported yet — never generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, null, null, null, 'en', null, NOW)).toBe(false);
  });

  test('never generated before, a real latest week exists — generate', () => {
    expect(shouldGenerateWeeklyReview(null, null, null, null, '2026-08-22', 'en', FP, NOW)).toBe(true);
  });

  test('cached review already covers the latest week, same locale, same data fingerprint — skip', () => {
    expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), 'en', FP, '2026-08-22', 'en', FP, NOW)).toBe(false);
  });

  test('a new settlement week arrived, but under 7 days since the last generation — respects the weekly cap', () => {
    const generated3DaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated3DaysAgo, 'en', FP, '2026-08-22', 'en', FP2, NOW)).toBe(false);
  });

  test('a new settlement week arrived AND 7+ days since the last generation — generate', () => {
    const generated8DaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldGenerateWeeklyReview('2026-08-15', generated8DaysAgo, 'en', FP, '2026-08-22', 'en', FP2, NOW)).toBe(true);
  });

  // AI COACH TEXT IS ENGLISH IN EVERY LANGUAGE — cache-locale bug fix
  describe('locale mismatch (owner decision, item 5 — invalidate/regenerate on language switch)', () => {
    test('same week, same data, but the cached review was generated in a different language — regenerate immediately, ignoring the 7-day cooldown', () => {
      const generatedJustNow = new Date(NOW.getTime() - 60_000).toISOString(); // 1 minute ago
      expect(shouldGenerateWeeklyReview('2026-08-22', generatedJustNow, 'en', FP, '2026-08-22', 'tr', FP, NOW)).toBe(true);
    });

    test('new week AND a locale mismatch — still generate, cooldown never even checked', () => {
      const generatedJustNow = new Date(NOW.getTime() - 60_000).toISOString();
      expect(shouldGenerateWeeklyReview('2026-08-15', generatedJustNow, 'en', FP, '2026-08-22', 'tr', FP2, NOW)).toBe(true);
    });

    test('cachedLocale is null (a review cached before this column existed) and current locale is non-English — treated as a mismatch, regenerate', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), null, FP, '2026-08-22', 'tr', FP, NOW)).toBe(true);
    });

    test('cachedLocale is null and current locale is English — also a mismatch by the same strict equality rule (regenerates once, then null stops recurring since the fresh write will tag "en")', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), null, FP, '2026-08-22', 'en', FP, NOW)).toBe(true);
    });
  });

  // AI COACH — FIX STALE CACHE (owner decision, docs/PENDING_SQL.md §68) —
  // any change to the underlying figures (a settlement/deduction/fuel/
  // maintenance/toll insert, update, or delete; a truck delete; a Reset
  // All Data) must force regeneration immediately, same treatment as a
  // locale mismatch already got, never throttled by the 7-day cooldown.
  describe('data fingerprint mismatch (owner decision, FIX STALE CACHE pass)', () => {
    test('same week, same locale, but the underlying figures changed (e.g. a correction to the current week\'s settlement) — regenerate immediately', () => {
      const generatedJustNow = new Date(NOW.getTime() - 60_000).toISOString();
      expect(shouldGenerateWeeklyReview('2026-08-22', generatedJustNow, 'en', FP, '2026-08-22', 'en', FP2, NOW)).toBe(true);
    });

    test('cachedFingerprint is null (a review cached before this column existed) — treated as a mismatch, regenerate', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), 'en', null, '2026-08-22', 'en', FP, NOW)).toBe(true);
    });

    test('every settlement was deleted — nothing to review, never regenerate (there is nothing to generate FROM)', () => {
      expect(shouldGenerateWeeklyReview('2026-08-22', NOW.toISOString(), 'en', FP, null, 'en', null, NOW)).toBe(false);
    });

    test('a genuinely NEW settlement week still respects the normal weekly cooldown, even though its fingerprint naturally differs too', () => {
      // Regression guard for a real design bug caught by this pass's own
      // test suite: the fingerprint includes weekEnding, so a brand-new
      // week ALWAYS produces a mismatch — that must NOT, on its own,
      // bypass the cooldown (which would defeat the "one call per week"
      // cap on every single new settlement). Only a fingerprint mismatch
      // for the SAME week (an edit/correction) bypasses it.
      const generated3DaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(shouldGenerateWeeklyReview('2026-08-15', generated3DaysAgo, 'en', FP, '2026-08-22', 'en', FP2, NOW)).toBe(false);
    });
  });
});

describe('computeWeeklyReviewFingerprint', () => {
  function fpInputs(overrides: Partial<WeeklyReviewInputs> = {}): WeeklyReviewInputs {
    return {
      weekEnding: '2026-08-22',
      gross: 3500,
      net: 2800,
      rpm: 2.1,
      trailingAvgRpm: 1.95,
      cpm: 1.62,
      deadheadPct: 0.08,
      fuelPctOfRevenue: 0.22,
      biggestChargebacks: [],
      perDiemDays: 7,
      ytdProfitBefore: 40000,
      ytdProfitAfter: 42800,
      settlementCountYtd: 6,
      ...overrides,
    };
  }

  test('identical inputs produce an identical fingerprint', () => {
    expect(computeWeeklyReviewFingerprint(fpInputs())).toBe(computeWeeklyReviewFingerprint(fpInputs()));
  });

  test('a changed gross/net figure (e.g. a settlement correction) changes the fingerprint', () => {
    expect(computeWeeklyReviewFingerprint(fpInputs())).not.toBe(computeWeeklyReviewFingerprint(fpInputs({ gross: 3600 })));
    expect(computeWeeklyReviewFingerprint(fpInputs())).not.toBe(computeWeeklyReviewFingerprint(fpInputs({ net: 2900 })));
  });

  test('a changed CPM (e.g. a truck cost-basis edit, or a fuel/maintenance/toll insert or delete) changes the fingerprint', () => {
    expect(computeWeeklyReviewFingerprint(fpInputs())).not.toBe(computeWeeklyReviewFingerprint(fpInputs({ cpm: 1.75 })));
  });

  test('a changed YTD figure (e.g. a different settlement was deleted elsewhere in the year) changes the fingerprint', () => {
    expect(computeWeeklyReviewFingerprint(fpInputs())).not.toBe(
      computeWeeklyReviewFingerprint(fpInputs({ ytdProfitAfter: 41000, settlementCountYtd: 5 }))
    );
  });

  test('a changed chargeback list changes the fingerprint', () => {
    expect(computeWeeklyReviewFingerprint(fpInputs())).not.toBe(
      computeWeeklyReviewFingerprint(fpInputs({ biggestChargebacks: [{ description: 'Escrow', amount: 100 }] }))
    );
  });

  test('a changed goal-progress figure changes the fingerprint', () => {
    const withGoal = fpInputs({
      goalProgress: { weeklyGoal: 2000, progressDollars: 2800, progressPct: 140, metGoal: true, gapDollars: 0, milesToCloseGap: null, loadsToCloseGap: null },
    });
    const withDifferentGoal = fpInputs({
      goalProgress: { weeklyGoal: 2000, progressDollars: 2900, progressPct: 145, metGoal: true, gapDollars: 0, milesToCloseGap: null, loadsToCloseGap: null },
    });
    expect(computeWeeklyReviewFingerprint(withGoal)).not.toBe(computeWeeklyReviewFingerprint(withDifferentGoal));
  });
});

describe('isCachedReviewUsable', () => {
  test('a real review whose locale AND fingerprint match the current ones is usable', () => {
    expect(isCachedReviewUsable('some review text', 'tr', 'tr', FP, FP)).toBe(true);
  });
  test('null review is never usable, regardless of locale/fingerprint', () => {
    expect(isCachedReviewUsable(null, 'tr', 'tr', FP, FP)).toBe(false);
  });
  test('empty-string review is never usable', () => {
    expect(isCachedReviewUsable('', 'tr', 'tr', FP, FP)).toBe(false);
  });
  test('a review cached under a different locale than the current one is not usable — the exact bug this fix targets', () => {
    expect(isCachedReviewUsable('This is an English review.', 'en', 'tr', FP, FP)).toBe(false);
  });
  test('cachedLocale null (pre-migration row) is never usable once a real locale is active', () => {
    expect(isCachedReviewUsable('some review text', null, 'tr', FP, FP)).toBe(false);
  });
  // AI COACH — FIX STALE CACHE (owner decision) — the actual reported bug:
  // every settlement deleted -> currentFingerprint is null -> the cached
  // review must never be shown again, no matter what its own text says.
  test('every settlement deleted (currentFingerprint null) — cached review is never usable, even with a real cached fingerprint', () => {
    expect(isCachedReviewUsable('This week you made $3500...', 'en', 'en', FP, null)).toBe(false);
  });
  test('the underlying figures changed since generation (fingerprint mismatch) — not usable', () => {
    expect(isCachedReviewUsable('This week you made $3500...', 'en', 'en', FP, FP2)).toBe(false);
  });
  test('cachedFingerprint null (pre-migration row) — not usable even with a matching current fingerprint', () => {
    expect(isCachedReviewUsable('This week you made $3500...', 'en', 'en', null, FP)).toBe(false);
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
    cpm: 1.62,
    deadheadPct: 0.08,
    fuelPctOfRevenue: 0.22,
    biggestChargebacks: [],
    perDiemDays: 7,
    ytdProfitBefore: 40000,
    ytdProfitAfter: 42800,
    settlementCountYtd: 6,
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
    expect(prompt).toContain('Cost per mile');
    expect(prompt).toContain('$1.62/mi');
    expect(prompt).toContain('8.0%');
    expect(prompt).toContain('22.0%');
    expect(prompt).toContain('Per diem days this week: 7');
    expect(prompt).toContain('$40000.00');
    expect(prompt).toContain('$42800.00');
    // KPI CONSISTENCY (owner decision, device report: "AI Coach says
    // 'after just one settlement' while Scorecard shows 6 settlements") —
    // the real settlement count must be explicit in the prompt so the
    // model can never imply a single-settlement history when there isn't
    // one.
    expect(prompt).toContain('across 6 settlement(s) recorded so far this year');
  });

  test('never invents a number for a null figure — omits that sentence entirely', () => {
    const prompt = buildWeeklyReviewPrompt(inputs({ rpm: null, cpm: null, deadheadPct: null, fuelPctOfRevenue: null }));
    expect(prompt).not.toContain('Rate per mile');
    expect(prompt).not.toContain('Cost per mile');
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
    expect(text).toContain('"cpm":"$1.62"');
    expect(text).toContain('"pct":"8.0%"'); // deadhead
    expect(text).toContain('"pct":"22.0%"'); // fuel
    expect(text).toContain('"count":7'); // per diem days
    expect(text).toContain('"amount":"$42800.00"'); // YTD after
  });

  test('the real settlement count reaches the YTD line params (KPI CONSISTENCY — never omitted, never invented)', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ settlementCountYtd: 6 }), fakeT, money, pct);
    expect(text).toContain('weeklyReviewFallback.ytd');
    expect(text).toMatch(/"count":6/);
  });

  test('a null figure omits that key entirely, same "never invent" discipline as the AI prompt version', () => {
    const text = buildWeeklyReviewFallbackText(inputs({ rpm: null, cpm: null, deadheadPct: null, fuelPctOfRevenue: null }), fakeT, money, pct);
    expect(text).not.toContain('weeklyReviewFallback.rpm');
    expect(text).not.toContain('weeklyReviewFallback.cpm');
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
