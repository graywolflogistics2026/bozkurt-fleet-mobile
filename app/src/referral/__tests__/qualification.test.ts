import { resolveQualification, isOverReferrerCap, MAX_REWARDED_REFERRALS_PER_REFERRER, type QualificationInput } from '@/src/referral/qualification';

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    emailConfirmed: true,
    onboardingCompleted: true,
    hasImportedDocument: true,
    daysSinceSignup: 10,
    ...overrides,
  };
}

describe('resolveQualification', () => {
  test('all four criteria met — qualifies', () => {
    expect(resolveQualification(input())).toEqual({ qualifies: true });
  });

  test('email not confirmed — does not qualify', () => {
    expect(resolveQualification(input({ emailConfirmed: false }))).toEqual({ qualifies: false, missing: ['emailConfirmed'] });
  });

  test('onboarding not completed — does not qualify', () => {
    expect(resolveQualification(input({ onboardingCompleted: false }))).toEqual({ qualifies: false, missing: ['onboardingCompleted'] });
  });

  test('no document imported — does not qualify', () => {
    expect(resolveQualification(input({ hasImportedDocument: false }))).toEqual({ qualifies: false, missing: ['hasImportedDocument'] });
  });

  test('under 7 days since signup — does not qualify', () => {
    expect(resolveQualification(input({ daysSinceSignup: 6 }))).toEqual({ qualifies: false, missing: ['daysSinceSignup'] });
  });

  test('exactly 7 days since signup — qualifies (boundary is inclusive)', () => {
    expect(resolveQualification(input({ daysSinceSignup: 7 }))).toEqual({ qualifies: true });
  });

  test('multiple criteria missing at once — all are reported', () => {
    expect(resolveQualification(input({ emailConfirmed: false, hasImportedDocument: false }))).toEqual({
      qualifies: false,
      missing: ['emailConfirmed', 'hasImportedDocument'],
    });
  });

  test('a signup alone (nothing else done) earns nothing', () => {
    expect(
      resolveQualification({ emailConfirmed: false, onboardingCompleted: false, hasImportedDocument: false, daysSinceSignup: 0 })
    ).toEqual({
      qualifies: false,
      missing: ['emailConfirmed', 'onboardingCompleted', 'hasImportedDocument', 'daysSinceSignup'],
    });
  });
});

describe('isOverReferrerCap', () => {
  test('under the cap — not over', () => {
    expect(isOverReferrerCap(MAX_REWARDED_REFERRALS_PER_REFERRER - 1)).toBe(false);
  });

  test('at the cap — over (the cap itself is the limit, not one past it)', () => {
    expect(isOverReferrerCap(MAX_REWARDED_REFERRALS_PER_REFERRER)).toBe(true);
  });

  test('well past the cap — over', () => {
    expect(isOverReferrerCap(MAX_REWARDED_REFERRALS_PER_REFERRER + 10)).toBe(true);
  });
});
