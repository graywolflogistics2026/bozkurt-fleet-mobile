// REFERRAL PROGRAM — QUALIFICATION (owner decision 2026-08-24): a signup
// alone earns nothing. A referral becomes "qualified" only once ALL four
// hold for the REFERRED person: (a) confirmed email, (b) completed
// onboarding, (c) imported at least one document, (d) the account is
// still around 7+ days after signup ("still active" — this schema has no
// richer per-session activity signal than account age + non-deletion, so
// that's the literal criterion; a future pass could tighten this with
// auth.users.last_sign_in_at if real abuse patterns ever call for it).
export type QualificationInput = {
  emailConfirmed: boolean;
  onboardingCompleted: boolean;
  hasImportedDocument: boolean;
  daysSinceSignup: number;
};

export type QualificationResult = { qualifies: true } | { qualifies: false; missing: string[] };

const MIN_DAYS_SINCE_SIGNUP = 7;

export function resolveQualification(input: QualificationInput): QualificationResult {
  const missing: string[] = [];
  if (!input.emailConfirmed) missing.push('emailConfirmed');
  if (!input.onboardingCompleted) missing.push('onboardingCompleted');
  if (!input.hasImportedDocument) missing.push('hasImportedDocument');
  if (input.daysSinceSignup < MIN_DAYS_SINCE_SIGNUP) missing.push('daysSinceSignup');
  return missing.length === 0 ? { qualifies: true } : { qualifies: false, missing };
}

// CAP (spec item D2's "cap qualified referrals per referrer, e.g. 25") —
// a referral that would otherwise qualify still counts for the REFERRED
// person's own welcome credit (they did nothing wrong), but stops
// contributing to the REFERRER's reward tally past this cap, and is
// flagged for manual review rather than silently capped with no trace.
export const MAX_REWARDED_REFERRALS_PER_REFERRER = 25;

export function isOverReferrerCap(rewardEligibleCountBeforeThisOne: number): boolean {
  return rewardEligibleCountBeforeThisOne >= MAX_REWARDED_REFERRALS_PER_REFERRER;
}
