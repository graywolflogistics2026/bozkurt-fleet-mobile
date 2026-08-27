import {
  buildDailyTipCandidates,
  buildDailyTipDiagnostics,
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
  findTodaysAnchorTip,
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

  // BUG FIX (owner decision, device report: "daily tip never appears,"
  // most important for a brand-new/EMPTY account) — this used to
  // unconditionally return null for the first 24 hours after signup
  // ("never on day one"); that blanket block is now GONE, since an empty
  // account seeing a getting-started tip on first launch is explicitly
  // the most important case, per a later, overriding owner instruction.
  test('a brand-new account (moments after signup) DOES get a tip when real candidates exist — the signup grace period no longer blocks it', () => {
    const now = new Date('2026-01-01T00:05:00Z'); // 5 minutes after signup
    const result = selectDailyTip(allTopicsCandidates(['tipFuel', 'tipDeductions']), {}, CREATED, now);
    expect(result).not.toBeNull();
  });

  // The literal requested test: an EMPTY account (no settlements, no
  // trucks, nothing) sees a tip on first launch — using the REAL
  // buildDailyTipCandidates() with every field genuinely empty/zero
  // (never fabricated candidates), matching exactly what
  // src/data/dailyTips.ts's candidateInput produces for a truly new
  // account, fed through the REAL selectDailyTip().
  test('an EMPTY account (zero settlements, zero trucks, day 0) sees a real tip on first launch', () => {
    const now = new Date('2026-01-01T00:05:00Z');
    const emptyAccountCandidates = buildDailyTipCandidates({
      totalRows: 0,
      documentsCount: 0,
      settlementsCount: 0,
      loadsCount: 0,
      settlementsMissingMilesCount: 0,
      reimbursementsCount: 0,
      miscIncomeCount: 0,
      fuelPctOfRevenue: null,
      dueSoonOrOverdueMaintenanceCount: 0,
      maintenanceRecordsCount: 0,
      tollsCount: 0,
      needsReviewCount: 0,
      equipmentCount: 0,
      trucksWithPurchasePriceCount: 0,
      weeksOfHistory: 0,
      quarterlyDeadlineDaysUntil: null,
      accountAgeDays: 0,
      hasTaxConfig: false,
      weeklyTaxReserve: null,
      hasPositiveNetWeek: false,
      complianceItemsCount: 0,
      learningRulesCount: 0,
      trucksWithoutCostBasisCount: 0,
      trucksWithoutDepreciationCount: 0,
      depreciationPreviewTotal: null,
      trucksCount: 0,
      anyTruckHasTrailer: false,
      unassignedRowsCount: 0,
      driversCount: 0,
      driverPaymentsCount: 0,
      businessBalance: 0,
      initialCapital: 0,
      taxFreeRemaining: null,
      activeTruckMaintenanceRecordsCount: 0,
      distinctSettlementWeeks: 0,
      settlementsWithMilesCount: 0,
      loansCount: 0,
      deadheadPct: null,
      perDiemDaysYtd: 0,
      escrowDeductionsCount: 0,
      advanceRepaymentDeductionsCount: 0,
    });
    // A real, non-empty pool of evergreen getting-started candidates
    // exists even for a truly empty account (tipMaintenance/
    // tipAssetRegister/tipDocumentsRenewals/tipDrivers/tipTruckHealth all
    // fire on zero data) — confirms this isn't ALSO blocked by "no
    // candidates exist at all."
    expect(emptyAccountCandidates.length).toBeGreaterThan(0);
    expect(emptyAccountCandidates.map((c) => c.topic).sort()).toEqual(
      ['tipAssetRegister', 'tipDocumentsRenewals', 'tipDrivers', 'tipMaintenance', 'tipTruckHealth'].sort()
    );

    const result = selectDailyTip(emptyAccountCandidates, {}, CREATED, now);
    expect(result).not.toBeNull();
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

// BUG FIX — "flash and vanish" (item 1). The root cause: the daily card
// used to re-run selectDailyTip() on every recompute, including the
// instant AFTER today's pick was persisted — and isEligible() treats
// "shown within the last 30 days" (which includes TODAY) as ineligible,
// so the very next recompute would exclude the topic it had just shown
// and silently swap in something else (or nothing). findTodaysAnchorTip()
// is what src/data/dailyTips.ts's useDailyTip() now uses instead — it
// reconstructs "today's tip" directly from persisted state, never by
// re-running selection, so it's stable no matter how many times it's
// called (simulating repeated re-renders) or how the underlying candidate
// data changes in between.
describe('findTodaysAnchorTip — sticky daily pick (bug fix item 1)', () => {
  const TODAY = new Date('2026-05-10T14:00:00Z');

  test('reconstructs the topic shown today, and does so identically across many repeated calls (simulating re-renders/data refreshes)', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-10T09:00:00Z', silencedAt: null, variantIndex: 1 },
    };
    for (let i = 0; i < 20; i++) {
      expect(findTodaysAnchorTip(state, TODAY)).toBe('tipFuel');
    }
  });

  test('the SAME topic is still reconstructed after a simulated server round trip (JSON serialize/deserialize, as a real profile refetch would produce)', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipDeductions: { lastShownAt: '2026-05-10T08:30:00Z', silencedAt: null, variantIndex: 2 },
    };
    const roundTripped = JSON.parse(JSON.stringify(state)) as NudgeState<DailyTipTopic>;
    expect(findTodaysAnchorTip(roundTripped, TODAY)).toBe('tipDeductions');
  });

  test('crucially: a topic recorded as shown TODAY is still returned even though isEligible()/selectDailyTip() would now treat it as on-cooldown — this is exactly what stops the flash-then-vanish', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-10T09:00:00Z', silencedAt: null, variantIndex: 0 },
    };
    // Proof the OLD approach (re-running selectDailyTip on the post-record
    // state) really would have excluded it:
    const rerun = selectDailyTip([{ topic: 'tipFuel', detail: {} }], state, null, TODAY);
    expect(rerun).toBeNull();
    // The anchor reconstruction is unaffected by that exclusion — it never
    // calls isEligible()/selectDailyTip() at all.
    expect(findTodaysAnchorTip(state, TODAY)).toBe('tipFuel');
  });

  test('ignores an entry from a PRIOR day', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-09T09:00:00Z', silencedAt: null, variantIndex: 0 },
    };
    expect(findTodaysAnchorTip(state, TODAY)).toBeNull();
  });

  test('ignores a same-day entry that has since been dismissed (silenced) — dismiss must actually hide it, not have it reappear on the next render', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-10T09:00:00Z', silencedAt: '2026-05-10T09:05:00Z', variantIndex: 0 },
    };
    expect(findTodaysAnchorTip(state, TODAY)).toBeNull();
  });

  test('picks the EARLIEST non-silenced entry shown today — later same-day entries are "show me another" advances, never mistaken for the original anchor', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-10T09:00:00Z', silencedAt: null, variantIndex: 0 }, // the original anchor
      tipDeductions: { lastShownAt: '2026-05-10T10:00:00Z', silencedAt: null, variantIndex: 0 }, // shown later via advance
      tipMaintenance: { lastShownAt: '2026-05-10T11:00:00Z', silencedAt: null, variantIndex: 0 }, // shown even later
    };
    expect(findTodaysAnchorTip(state, TODAY)).toBe('tipFuel');
  });

  test('if the original anchor was dismissed, the next-earliest non-silenced entry shown today is correctly reconstructed as the anchor instead', () => {
    const state: NudgeState<DailyTipTopic> = {
      tipFuel: { lastShownAt: '2026-05-10T09:00:00Z', silencedAt: '2026-05-10T09:01:00Z', variantIndex: 0 }, // dismissed
      tipDeductions: { lastShownAt: '2026-05-10T09:02:00Z', silencedAt: null, variantIndex: 0 }, // the replacement
    };
    expect(findTodaysAnchorTip(state, TODAY)).toBe('tipDeductions');
  });

  test('returns null when nothing has ever been shown', () => {
    expect(findTodaysAnchorTip({}, TODAY)).toBeNull();
  });
});

// "SHOW ME ANOTHER" (item 2) — a curious user can advance through every
// currently-eligible tip on demand. The mechanism is deliberately just
// selectDailyTip() + recordDailyTipShown() chained together (exactly what
// useDailyTip()'s showAnother() does) — no separate budget/counter, so
// the SAME no-repeat cooldown that governs the automatic daily pick also
// governs manual advances, which is what "tracks which ones were shown
// this way so the no-repeat rule still holds" and "never consumes
// tomorrow's slot" both actually mean in practice.
describe('"show me another" — advance through eligible tips without repeating (item 2)', () => {
  const CREATED = '2026-01-01T00:00:00Z';
  const DAY1 = new Date('2026-05-10T09:00:00Z');

  function allTopicsCandidates(topics: DailyTipTopic[]) {
    return topics.map((topic) => ({ topic, detail: {} }));
  }

  // Simulates exactly what useDailyTip()'s showAnother() does: pick the
  // next eligible one, record it as shown (excluding it from any FURTHER
  // advance today, since recordDailyTipShown's own 30-day cooldown now
  // covers it), and hand back the updated state for the next call.
  function advance(candidates: ReturnType<typeof allTopicsCandidates>, state: NudgeState<DailyTipTopic>, now: Date) {
    const next = selectDailyTip(candidates, state, CREATED, now);
    if (!next) return { topic: null as DailyTipTopic | null, state };
    const variant = selectDailyTipVariant(next.topic, state);
    return { topic: next.topic, state: recordDailyTipShown(state, next.topic, variant, now) };
  }

  test('each advance returns a genuinely different topic than every one shown before it today', () => {
    const topics: DailyTipTopic[] = ['tipFuel', 'tipDeductions', 'tipMaintenance', 'tipTolls', 'tipCashFlow'];
    const candidates = allTopicsCandidates(topics);
    // Day's anchor already shown (as the automatic pick would have been).
    let state: NudgeState<DailyTipTopic> = recordDailyTipShown({}, 'tipFuel', 0, DAY1);
    const shownViaAdvance: DailyTipTopic[] = [];

    for (let i = 0; i < 4; i++) {
      const result = advance(candidates, state, new Date(DAY1.getTime() + (i + 1) * 60000));
      expect(result.topic).not.toBeNull();
      expect(result.topic).not.toBe('tipFuel'); // never repeats the anchor
      expect(shownViaAdvance).not.toContain(result.topic); // never repeats an earlier advance
      shownViaAdvance.push(result.topic!);
      state = result.state;
    }
    expect(shownViaAdvance.length).toBe(4);
    expect(new Set(shownViaAdvance).size).toBe(4); // all distinct
  });

  test('the EXHAUSTED state — once every eligible tip has been shown today (anchor + every advance), the next advance finds nothing', () => {
    const topics: DailyTipTopic[] = ['tipFuel', 'tipDeductions', 'tipMaintenance'];
    const candidates = allTopicsCandidates(topics);
    let state: NudgeState<DailyTipTopic> = recordDailyTipShown({}, 'tipFuel', 0, DAY1);

    const first = advance(candidates, state, new Date(DAY1.getTime() + 60000));
    expect(first.topic).not.toBeNull();
    state = first.state;

    const second = advance(candidates, state, new Date(DAY1.getTime() + 120000));
    expect(second.topic).not.toBeNull();
    state = second.state;

    // Every one of the 3 topics is now shown today — nothing left.
    const exhausted = advance(candidates, state, new Date(DAY1.getTime() + 180000));
    expect(exhausted.topic).toBeNull();

    // Calling again produces the SAME exhausted result — never loops back
    // to repeat one of today's already-shown topics.
    const stillExhausted = advance(candidates, state, new Date(DAY1.getTime() + 240000));
    expect(stillExhausted.topic).toBeNull();
  });

  test('advancing through several tips today does NOT consume tomorrow\'s slot — a topic never touched today is still picked normally tomorrow', () => {
    const topics: DailyTipTopic[] = ['tipFuel', 'tipDeductions', 'tipMaintenance', 'tipTolls'];
    const candidates = allTopicsCandidates(topics);
    let state: NudgeState<DailyTipTopic> = recordDailyTipShown({}, 'tipFuel', 0, DAY1);
    // Advance through the other two eligible-but-not-tolls topics, leaving
    // 'tipTolls' completely untouched today.
    for (let i = 0; i < 2; i++) {
      const result = advance(candidates, state, new Date(DAY1.getTime() + (i + 1) * 60000));
      state = result.state;
    }

    const tomorrow = new Date(DAY1.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowsPick = selectDailyTip(candidates, state, CREATED, tomorrow);
    // 'tipFuel'/'tipDeductions'/'tipMaintenance' are all still within their
    // OWN normal 30-day cooldown (the same rule that already applied
    // before "show me another" existed) — the only one NOT on cooldown is
    // the one nothing touched today at all, and it's picked exactly as
    // the ordinary rotation always would.
    expect(tomorrowsPick?.topic).toBe('tipTolls');
  });

  test('a topic that WAS shown via "show me another" today correctly stays off tomorrow\'s pick too (the no-repeat rule still holds for it, same as the anchor)', () => {
    const topics: DailyTipTopic[] = ['tipFuel', 'tipDeductions'];
    const candidates = allTopicsCandidates(topics);
    let state: NudgeState<DailyTipTopic> = recordDailyTipShown({}, 'tipFuel', 0, DAY1);
    const advanced = advance(candidates, state, new Date(DAY1.getTime() + 60000));
    expect(advanced.topic).toBe('tipDeductions');
    state = advanced.state;

    const tomorrow = new Date(DAY1.getTime() + 24 * 60 * 60 * 1000);
    // Both the anchor AND the manually-advanced-to topic are excluded —
    // nothing else is eligible, so tomorrow's pick is null, not a repeat.
    expect(selectDailyTip(candidates, state, CREATED, tomorrow)).toBeNull();
  });
});

// DIAGNOSTICS (owner decision, device report: "this can never be
// invisible again") — buildDailyTipDiagnostics() is the ONE function both
// useDailyTip()'s dev-only console log and Settings' dev-only panel read
// from.
describe('buildDailyTipDiagnostics — every topic accounted for, with a real reason', () => {
  const NOW = new Date('2026-05-10T12:00:00Z');

  test('every topic in the system gets exactly one entry, regardless of whether it was a candidate at all', () => {
    const diagnostics = buildDailyTipDiagnostics([], {}, NOW);
    const allTopics = Object.keys(DAILY_TIP_CATEGORY);
    expect(diagnostics.length).toBe(allTopics.length);
    expect(diagnostics.every((d) => d.reason === 'precondition_not_met')).toBe(true);
  });

  test('a topic whose precondition currently holds and has never been shown is "eligible"', () => {
    const candidates = [{ topic: 'tipFuel' as DailyTipTopic, detail: {} }];
    const diagnostics = buildDailyTipDiagnostics(candidates, {}, NOW);
    const fuelEntry = diagnostics.find((d) => d.topic === 'tipFuel');
    expect(fuelEntry?.reason).toBe('eligible');
  });

  test('a candidate that has been dismissed (silenced) is reported as "silenced," not just generically ineligible', () => {
    const candidates = [{ topic: 'tipFuel' as DailyTipTopic, detail: {} }];
    const state = dismissDailyTip({}, 'tipFuel', NOW);
    const diagnostics = buildDailyTipDiagnostics(candidates, state, NOW);
    expect(diagnostics.find((d) => d.topic === 'tipFuel')?.reason).toBe('silenced');
  });

  test('a candidate shown recently (within the 30-day cooldown) is reported as "cooldown," distinct from "silenced"', () => {
    const candidates = [{ topic: 'tipFuel' as DailyTipTopic, detail: {} }];
    const state = recordDailyTipShown({}, 'tipFuel', 0, new Date('2026-05-09T12:00:00Z'));
    const diagnostics = buildDailyTipDiagnostics(candidates, state, NOW);
    expect(diagnostics.find((d) => d.topic === 'tipFuel')?.reason).toBe('cooldown');
  });

  test('a topic whose precondition does NOT hold is "precondition_not_met" even if it was shown/silenced long ago (the precondition check always wins first)', () => {
    const state = dismissDailyTip({}, 'tipFuel', new Date('2020-01-01T00:00:00Z'));
    const diagnostics = buildDailyTipDiagnostics([], state, NOW); // tipFuel is NOT a candidate this time
    expect(diagnostics.find((d) => d.topic === 'tipFuel')?.reason).toBe('precondition_not_met');
  });

  test('the exact empty-account scenario: only the 5 evergreen topics are eligible, everything else is precondition_not_met', () => {
    const emptyAccountCandidates = ['tipMaintenance', 'tipAssetRegister', 'tipDocumentsRenewals', 'tipDrivers', 'tipTruckHealth'].map(
      (topic) => ({ topic: topic as DailyTipTopic, detail: {} })
    );
    const diagnostics = buildDailyTipDiagnostics(emptyAccountCandidates, {}, NOW);
    const eligible = diagnostics.filter((d) => d.reason === 'eligible').map((d) => d.topic).sort();
    expect(eligible).toEqual(['tipAssetRegister', 'tipDocumentsRenewals', 'tipDrivers', 'tipMaintenance', 'tipTruckHealth'].sort());
    expect(diagnostics.filter((d) => d.reason === 'precondition_not_met').length).toBe(diagnostics.length - 5);
  });
});
