// REFERRAL PROGRAM — REWARD (owner decision 2026-08-24): every 3 qualified
// referrals grants 60 days of credit to the referrer; the invited user
// gets 14 days on qualifying (one-sided sharing would be a weaker
// incentive, per the spec's own reasoning). "The counter resets after
// each grant" is implemented WITHOUT separate mutable counter state —
// computeNewRewardGrants() derives it from the raw qualified COUNT via
// floor division, which is naturally idempotent and correct even if
// qualification events are evaluated in a batch (not strictly one at a
// time) rather than needing a fragile "increment then check == 3, reset
// to 0" counter that could drift out of sync with the real row data.
export const REFERRALS_PER_REWARD = 3;
export const REFERRER_REWARD_DAYS = 60;
export const REFERRED_WELCOME_CREDIT_DAYS = 14;

// Returns how many NEW 60-day grants should be created as a result of the
// referrer's reward-eligible qualified count moving from `before` to
// `after`. Handles both the normal +1-at-a-time flow and a batch jump
// (e.g. a backlog sync evaluating several qualifications in one pass)
// identically and correctly — every multiple-of-3 boundary strictly
// between `before` (exclusive) and `after` (inclusive) is counted once.
export function computeNewRewardGrants(qualifiedCountBefore: number, qualifiedCountAfter: number): number {
  if (qualifiedCountAfter <= qualifiedCountBefore) return 0;
  return Math.floor(qualifiedCountAfter / REFERRALS_PER_REWARD) - Math.floor(qualifiedCountBefore / REFERRALS_PER_REWARD);
}

// How many of the referrer's oldest still-"qualified" (not yet
// "rewarded") referral rows should be flipped to "rewarded" for a given
// number of new grants — always REFERRALS_PER_REWARD per grant, oldest
// first (qualified_at ascending), so the reward always attaches to the
// longest-waiting referrals rather than an arbitrary subset.
export function countReferralsToMarkRewarded(newGrantCount: number): number {
  return newGrantCount * REFERRALS_PER_REWARD;
}

// Referral screen's "2 of 3 qualified — 1 more for 2 free months"
// progress line — derived purely from the reward-eligible qualified
// count (rows with status 'qualified' OR 'rewarded', excluding any
// flagged-for-review row — same population the Edge Function's own cap/
// grant math reads), never a separately-tracked counter.
export function computeReferralProgress(rewardEligibleQualifiedCount: number): { inCurrentCycle: number; remaining: number } {
  const inCurrentCycle = rewardEligibleQualifiedCount % REFERRALS_PER_REWARD;
  return { inCurrentCycle, remaining: REFERRALS_PER_REWARD - inCurrentCycle };
}
