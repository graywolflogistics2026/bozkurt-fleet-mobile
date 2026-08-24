import {
  computeNewRewardGrants,
  countReferralsToMarkRewarded,
  computeReferralProgress,
  REFERRALS_PER_REWARD,
  REFERRER_REWARD_DAYS,
  REFERRED_WELCOME_CREDIT_DAYS,
} from '@/src/referral/reward';

describe('computeNewRewardGrants — reward at exactly 3', () => {
  test('going from 2 to 3 qualified — exactly one grant', () => {
    expect(computeNewRewardGrants(2, 3)).toBe(1);
  });

  test('going from 0 to 1 or 0 to 2 — no grant yet', () => {
    expect(computeNewRewardGrants(0, 1)).toBe(0);
    expect(computeNewRewardGrants(0, 2)).toBe(0);
  });

  test('going from 3 to 4, 4 to 5 — the counter has "reset", no new grant until the next multiple of 3', () => {
    expect(computeNewRewardGrants(3, 4)).toBe(0);
    expect(computeNewRewardGrants(4, 5)).toBe(0);
  });

  test('going from 5 to 6 — a second grant', () => {
    expect(computeNewRewardGrants(5, 6)).toBe(1);
  });

  test('no change — no grant', () => {
    expect(computeNewRewardGrants(3, 3)).toBe(0);
  });

  test('going backwards (should never happen, but must never grant) — no grant', () => {
    expect(computeNewRewardGrants(5, 3)).toBe(0);
  });

  test('a batch jump crossing exactly one boundary (2 -> 5) grants exactly once, not twice', () => {
    expect(computeNewRewardGrants(2, 5)).toBe(1);
  });

  test('a batch jump crossing two boundaries (2 -> 7) grants exactly twice', () => {
    expect(computeNewRewardGrants(2, 7)).toBe(2);
  });

  test('starting from zero straight to a multiple of 3 (0 -> 3) grants once', () => {
    expect(computeNewRewardGrants(0, 3)).toBe(1);
  });

  test('starting from zero straight to 6 grants twice', () => {
    expect(computeNewRewardGrants(0, 6)).toBe(2);
  });
});

describe('countReferralsToMarkRewarded', () => {
  test('one grant marks exactly 3 referrals', () => {
    expect(countReferralsToMarkRewarded(1)).toBe(REFERRALS_PER_REWARD);
  });

  test('two grants marks exactly 6', () => {
    expect(countReferralsToMarkRewarded(2)).toBe(6);
  });

  test('zero grants marks none', () => {
    expect(countReferralsToMarkRewarded(0)).toBe(0);
  });
});

describe('computeReferralProgress', () => {
  test('0 qualified — 0 of 3, 3 remaining', () => {
    expect(computeReferralProgress(0)).toEqual({ inCurrentCycle: 0, remaining: 3 });
  });

  test('2 qualified — 2 of 3, 1 remaining (matches the spec\'s own example)', () => {
    expect(computeReferralProgress(2)).toEqual({ inCurrentCycle: 2, remaining: 1 });
  });

  test('exactly 3 (just rewarded) — the cycle has reset to 0 of 3', () => {
    expect(computeReferralProgress(3)).toEqual({ inCurrentCycle: 0, remaining: 3 });
  });

  test('5 qualified (one reward already granted at 3) — 2 of 3 into the next cycle', () => {
    expect(computeReferralProgress(5)).toEqual({ inCurrentCycle: 2, remaining: 1 });
  });
});

describe('reward constants', () => {
  test('sane, documented values', () => {
    expect(REFERRALS_PER_REWARD).toBe(3);
    expect(REFERRER_REWARD_DAYS).toBe(60);
    expect(REFERRED_WELCOME_CREDIT_DAYS).toBe(14);
  });
});
