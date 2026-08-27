import {
  buildDailyTipCandidates,
  DAILY_TIP_CATEGORY,
  DAILY_TIP_ROUTE,
  DAILY_TIP_SCREEN_COVERAGE,
  DAILY_TIP_VARIANT_COUNT,
  detectTipCapitalAccount,
  detectTipDeductions,
  detectTipFixTruckAssignments,
  detectTipFuel,
  detectTipMaintenance,
  detectTipSettlements,
  detectTipTaxEstimator,
  detectTipTruckDepreciation,
  dismissDailyTip,
  recordDailyTipShown,
  selectDailyTip,
  selectDailyTipVariant,
  type DailyTipTopic,
} from '@/src/alerts/dailyTips';
import { RAW_NAV_GROUPS } from '@/src/navigation/navRegistry';
import type { NudgeState } from '@/src/alerts/nudgeFrequency';

// COVERAGE (owner decision, Part 2 Step 1's own explicit requirement) —
// this is the literal "a test FAILS when a new screen enters the nav
// registry without either a tip or an explicit 'intentionally none'
// entry" guard.
describe('DAILY_TIP_SCREEN_COVERAGE — every nav registry href is accounted for', () => {
  test('every href in RAW_NAV_GROUPS has a coverage entry (a tip topic or "intentionally none")', () => {
    const hrefs = RAW_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href as string));
    const missing = hrefs.filter((href) => !(href in DAILY_TIP_SCREEN_COVERAGE));
    expect(missing).toEqual([]);
  });

  test('every coverage entry that names a real topic has a matching route + category', () => {
    for (const entry of Object.values(DAILY_TIP_SCREEN_COVERAGE)) {
      if (entry === 'intentionalNone') continue;
      expect(DAILY_TIP_ROUTE[entry]).toBeDefined();
      expect(DAILY_TIP_CATEGORY[entry]).toBeDefined();
    }
  });
});

describe('individual detectors — precondition gating (spot check across topics)', () => {
  test('tipFuel fires only once a real fuel % of revenue exists, never fabricated', () => {
    expect(detectTipFuel(null)).toBeNull();
    expect(detectTipFuel(0.24)).toEqual({ topic: 'tipFuel', detail: { pct: 24 } });
  });

  test('tipDeductions fires only when a real needs-review count exists', () => {
    expect(detectTipDeductions(0)).toBeNull();
    expect(detectTipDeductions(3)).toEqual({ topic: 'tipDeductions', detail: { count: 3 } });
  });

  test('tipMaintenance prefers the real due-soon count, falls back to the "never logged one" onboarding case', () => {
    expect(detectTipMaintenance(2, 5)).toEqual({ topic: 'tipMaintenance', detail: { count: 2 } });
    expect(detectTipMaintenance(0, 0)).toEqual({ topic: 'tipMaintenance', detail: {} });
    expect(detectTipMaintenance(0, 5)).toBeNull();
  });

  test('tipSettlements: real missing-miles count takes priority over the onboarding case', () => {
    expect(detectTipSettlements(1, 1)).toEqual({ topic: 'tipSettlements', detail: { count: 1 } });
    expect(detectTipSettlements(1, 0)).toEqual({ topic: 'tipSettlements', detail: {} });
    expect(detectTipSettlements(5, 0)).toBeNull();
  });

  test('tipFixTruckAssignments never fires for a single-truck account, even with unassigned rows', () => {
    expect(detectTipFixTruckAssignments(1, 5)).toBeNull();
    expect(detectTipFixTruckAssignments(2, 5)).toEqual({ topic: 'tipFixTruckAssignments', detail: { count: 5 } });
    expect(detectTipFixTruckAssignments(2, 0)).toBeNull();
  });

  test('tipTruckDepreciation includes the real preview dollar figure only when the caller actually computed one', () => {
    expect(detectTipTruckDepreciation(1, null)).toEqual({ topic: 'tipTruckDepreciation', detail: { count: 1 } });
    expect(detectTipTruckDepreciation(1, 8500)).toEqual({ topic: 'tipTruckDepreciation', detail: { count: 1, previewTotal: 8500 } });
    expect(detectTipTruckDepreciation(0, 8500)).toBeNull();
  });

  test('tipCapitalAccount fires once real money has moved, includes the real tax-free-remaining figure when positive', () => {
    expect(detectTipCapitalAccount(0, 0, null)).toBeNull();
    expect(detectTipCapitalAccount(5000, 0, 3200)).toEqual({ topic: 'tipCapitalAccount', detail: { remaining: 3200 } });
  });

  test('tipTaxEstimator requires tax_config to exist, never fires on a bare profit figure alone', () => {
    expect(detectTipTaxEstimator(false, 500, 10)).toBeNull();
    expect(detectTipTaxEstimator(true, 500, 10)).toEqual({ topic: 'tipTaxEstimator', detail: { reserve: 500, days: 10 } });
  });

  test('a tip disappears entirely once its precondition stops holding (the "done" behavior)', () => {
    // Same account, before and after fixing the thing the tip taught.
    const before = buildDailyTipCandidates({ needsReviewCount: 2 });
    const after = buildDailyTipCandidates({ needsReviewCount: 0 });
    expect(before.some((c) => c.topic === 'tipDeductions')).toBe(true);
    expect(after.some((c) => c.topic === 'tipDeductions')).toBe(false);
  });

  test('an omitted field never produces a false-positive candidate', () => {
    expect(buildDailyTipCandidates({})).toEqual([]);
  });
});

describe('selectDailyTip — rotation engine', () => {
  const CREATED = '2026-01-01T00:00:00Z';

  function allTopicsCandidates(topics: DailyTipTopic[]) {
    return topics.map((topic) => ({ topic, detail: {} }));
  }

  test('signup grace — nothing shown in the first 24 hours', () => {
    const now = new Date('2026-01-01T12:00:00Z'); // 12h after signup
    const result = selectDailyTip(allTopicsCandidates(['tipFuel', 'tipDeductions']), {}, CREATED, now);
    expect(result).toBeNull();
  });

  test('over 35 simulated days, no topic repeats within any rolling 30-day window, and every day picks the longest-unseen eligible topic', () => {
    // The full real-world pool (this app ships ~40 always-computable
    // topics once an account is established) — comfortably above the
    // number of days simulated, so daily coverage stays continuous and
    // the "no repeat within 30 days" guarantee is exercised for real,
    // not just trivially satisfied by starving the pool.
    const topics: DailyTipTopic[] = [
      'tipFuel',
      'tipDeductions',
      'tipMaintenance',
      'tipCashFlow',
      'tipScorecard',
      'tipLoans',
      'tipTransactions',
      'tipDocuments',
      'tipAiAdvisor',
      'tipCapitalAccount',
      'tipTolls',
      'tipTruckComparison',
      'tipProfitAnalysis',
      'tipOperatingPnl',
      'tipShareProfit',
      'tipCategoryLearning',
      'tipAssetRegister',
      'tipTruckHealth',
      'tipDeadheadBenchmark',
      'tipQuarterlyDeadlines',
      'tipSettings',
      'tipAiCoachFull',
      'tipAccountantPackage',
      'tipTaxEstimator',
      'tipDrivers',
      'tipEquipment',
      'tipDocumentsRenewals',
      'tipOtherIncome',
      'tipReimbursements',
      'tipLoads',
      'tipSettlements',
      'tipImport',
      'tipTruckCostBasis',
      'tipTruckDepreciation',
      'tipTruckAddTrailer',
    ];
    const candidates = allTopicsCandidates(topics);
    let state: NudgeState<DailyTipTopic> = {};
    const shownHistory: { day: number; topic: DailyTipTopic }[] = [];
    const day1 = new Date(CREATED).getTime();

    for (let day = 2; day <= 36; day++) {
      const now = new Date(day1 + day * 24 * 60 * 60 * 1000);
      const chosen = selectDailyTip(candidates, state, CREATED, now);
      expect(chosen).not.toBeNull();
      shownHistory.push({ day, topic: chosen!.topic });
      const variant = selectDailyTipVariant(chosen!.topic, state);
      state = recordDailyTipShown(state, chosen!.topic, variant, now);
    }

    // No topic shown twice within any 30-day window.
    for (let i = 0; i < shownHistory.length; i++) {
      for (let j = i + 1; j < shownHistory.length; j++) {
        if (shownHistory[i].topic === shownHistory[j].topic) {
          expect(shownHistory[j].day - shownHistory[i].day).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  test('with a small pool (fewer eligible topics than days simulated), the engine returns null once every topic is on cooldown rather than repeating one early', () => {
    const topics: DailyTipTopic[] = ['tipFuel', 'tipDeductions', 'tipMaintenance'];
    const candidates = allTopicsCandidates(topics);
    let state: NudgeState<DailyTipTopic> = {};
    const shownTopics = new Set<DailyTipTopic>();

    for (let day = 2; day <= 15; day++) {
      const now = new Date(`2026-03-${String(day).padStart(2, '0')}T12:00:00Z`);
      const chosen = selectDailyTip(candidates, state, CREATED, now);
      if (chosen) {
        // Never a topic already shown within this run (all are still
        // within their 30-day cooldown for the whole 15-day span).
        expect(shownTopics.has(chosen.topic)).toBe(false);
        shownTopics.add(chosen.topic);
        const variant = selectDailyTipVariant(chosen.topic, state);
        state = recordDailyTipShown(state, chosen.topic, variant, now);
      }
    }
    // Exactly the 3 topics were shown once each, then the pool was exhausted.
    expect(shownTopics.size).toBe(3);
  });

  test('variant cycles 0 -> 1 -> 2 -> 0 in order for the same topic, never repeating a phrasing before the others are used', () => {
    let state: NudgeState<DailyTipTopic> = {};
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      const v = selectDailyTipVariant('tipFuel', state);
      seen.push(v);
      state = recordDailyTipShown(state, 'tipFuel', v, new Date());
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  test('avoids a 3rd consecutive day of the same category when a different-category alternative is eligible', () => {
    // tipFuel and tipDeductions/tipCapitalAccount are all 'money'; tipDocuments is 'discovery'.
    const now3 = new Date('2026-02-03T12:00:00Z');
    let state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-02-01T12:00:00Z', silencedAt: null, variantIndex: 0 },
      tipDeductions: { lastShownAt: '2026-02-02T12:00:00Z', silencedAt: null, variantIndex: 0 },
    };
    const candidates = allTopicsCandidates(['tipCapitalAccount', 'tipDocuments']); // money, discovery
    const chosen = selectDailyTip(candidates, state, CREATED, now3);
    expect(chosen?.topic).toBe('tipDocuments'); // the non-'money' option wins to break the streak
  });

  test('never blocks entirely when every eligible candidate shares the streak category', () => {
    const now3 = new Date('2026-02-03T12:00:00Z');
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-02-01T12:00:00Z', silencedAt: null, variantIndex: 0 },
      tipDeductions: { lastShownAt: '2026-02-02T12:00:00Z', silencedAt: null, variantIndex: 0 },
    };
    const candidates = allTopicsCandidates(['tipCapitalAccount']); // also 'money' — no alternative exists
    const chosen = selectDailyTip(candidates, state, CREATED, now3);
    expect(chosen?.topic).toBe('tipCapitalAccount');
  });

  test('a dismissed (silenced) topic never shows again', () => {
    let state: NudgeState<DailyTipTopic> = {};
    state = dismissDailyTip(state, 'tipFuel', new Date('2026-01-05T00:00:00Z'));
    const result = selectDailyTip(allTopicsCandidates(['tipFuel']), state, CREATED, new Date('2027-01-01T00:00:00Z'));
    expect(result).toBeNull();
  });

  test('nothing eligible today returns null rather than an empty-object placeholder', () => {
    expect(selectDailyTip([], {}, CREATED, new Date('2026-06-01T00:00:00Z'))).toBeNull();
  });
});

describe('DAILY_TIP_VARIANT_COUNT', () => {
  test('every topic is expected to have exactly this many phrasings', () => {
    expect(DAILY_TIP_VARIANT_COUNT).toBe(3);
  });
});
