import { selectNudgesToShow, recordNudgesShown, silenceNudgeTopic, unsilenceNudgeTopic, MAX_NUDGES_PER_DAY, type NudgeState } from '@/src/alerts/nudgeFrequency';
import type { NudgeCandidate, NudgeTopic } from '@/src/alerts/missingDataNudges';

const NOW = new Date('2026-08-24T12:00:00Z');

function candidate(topic: NudgeCandidate['topic']): NudgeCandidate {
  return { topic, detail: {} };
}

function state(obj: NudgeState<NudgeTopic>): NudgeState<NudgeTopic> {
  return obj;
}

describe('selectNudgesToShow', () => {
  test('nothing shows in the first 24 hours after signup', () => {
    const created = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], {}, created, NOW)).toEqual([]);
  });

  test('a 25-hour-old account is past the grace period', () => {
    const created = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], {}, created, NOW)).toHaveLength(1);
  });

  test('no accountCreatedAt at all — treated as past the grace period', () => {
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], {}, null, NOW)).toHaveLength(1);
  });

  test('a topic shown 3 days ago is still within the once-per-week cap — excluded', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), silencedAt: null } });
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], s, null, NOW)).toEqual([]);
  });

  test('a topic shown 8 days ago is past the weekly cap — included again', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), silencedAt: null } });
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], s, null, NOW)).toHaveLength(1);
  });

  test('a silenced topic never shows again, no matter how long ago', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: null, silencedAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() } });
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], s, null, NOW)).toEqual([]);
  });

  test(`never more than ${MAX_NUDGES_PER_DAY} candidates in one call`, () => {
    const candidates = [candidate('noRecentSettlement'), candidate('settlementMissingMiles'), candidate('needsReviewReceipts')];
    expect(selectNudgesToShow(candidates, state({}), null, NOW)).toHaveLength(MAX_NUDGES_PER_DAY);
  });

  test('the daily cap counts nudges already shown TODAY across other topics too', () => {
    const s = state({
      noRecentSettlement: { lastShownAt: NOW.toISOString(), silencedAt: null },
      settlementMissingMiles: { lastShownAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(), silencedAt: null },
    });
    // Both of the above were shown today already (2/2 of the daily cap) —
    // a third, brand-new topic must not show until tomorrow.
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], s, null, NOW)).toEqual([]);
  });

  test('nudges shown YESTERDAY do not count against today\'s cap', () => {
    const s = state({ noRecentSettlement: { lastShownAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString(), silencedAt: null } });
    expect(selectNudgesToShow([candidate('needsReviewReceipts')], s, null, NOW)).toHaveLength(1);
  });
});

describe('recordNudgesShown / silenceNudgeTopic / unsilenceNudgeTopic', () => {
  test('recordNudgesShown stamps lastShownAt for exactly the given topics, leaving others untouched', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: '2026-08-01T00:00:00.000Z', silencedAt: null } });
    const next = recordNudgesShown<NudgeTopic>(s, ['noRecentSettlement'], NOW);
    expect(next.noRecentSettlement).toEqual({ lastShownAt: NOW.toISOString(), silencedAt: null });
    expect(next.needsReviewReceipts).toEqual(s.needsReviewReceipts);
  });

  test('recordNudgesShown preserves an existing silencedAt for the same topic', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: null, silencedAt: '2026-08-01T00:00:00.000Z' } });
    // Recording a "shown" for an already-silenced topic shouldn't happen in
    // practice (selectNudgesToShow filters it out first), but the function
    // itself must still never accidentally un-silence it.
    const next = recordNudgesShown<NudgeTopic>(s, ['needsReviewReceipts'], NOW);
    expect(next.needsReviewReceipts?.silencedAt).toBe('2026-08-01T00:00:00.000Z');
  });

  test('silenceNudgeTopic sets silencedAt without touching lastShownAt', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: '2026-08-01T00:00:00.000Z', silencedAt: null } });
    const next = silenceNudgeTopic(s, 'needsReviewReceipts', NOW);
    expect(next.needsReviewReceipts).toEqual({ lastShownAt: '2026-08-01T00:00:00.000Z', silencedAt: NOW.toISOString() });
  });

  test('unsilenceNudgeTopic clears silencedAt only', () => {
    const s = state({ needsReviewReceipts: { lastShownAt: '2026-08-01T00:00:00.000Z', silencedAt: '2026-08-10T00:00:00.000Z' } });
    const next = unsilenceNudgeTopic(s, 'needsReviewReceipts');
    expect(next.needsReviewReceipts).toEqual({ lastShownAt: '2026-08-01T00:00:00.000Z', silencedAt: null });
  });

  test('unsilenceNudgeTopic on a topic with no existing entry is a no-op', () => {
    expect(unsilenceNudgeTopic(state({}), 'needsReviewReceipts')).toEqual({});
  });
});
