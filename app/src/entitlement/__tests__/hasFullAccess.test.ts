import { hasFullAccess, isOwnerGrantedPlan, isOwnerAccount } from '@/src/entitlement/hasFullAccess';

describe('hasFullAccess', () => {
  test('lifetime — always passes', () => {
    expect(hasFullAccess({ plan: 'lifetime' })).toBe(true);
  });

  test('complimentary — always passes', () => {
    expect(hasFullAccess({ plan: 'complimentary' })).toBe(true);
  });

  test('paid — passes (future billing plugs into this same helper)', () => {
    expect(hasFullAccess({ plan: 'paid' })).toBe(true);
  });

  // OWNER/DEV ACCOUNT FLAG (owner decision) — item 5: "behaves exactly
  // like a full-access account everywhere else — no hidden dev-only
  // behaviour that could mask a bug real users would hit." hasFullAccess()
  // is the ONE gate every other access-controlled feature reads, so this
  // single assertion is what guarantees that everywhere else in the app
  // (Capital Account, Schedule C reports, every full-access-gated screen)
  // an owner account is indistinguishable from a real paid one.
  test('owner — always passes', () => {
    expect(hasFullAccess({ plan: 'owner' })).toBe(true);
  });

  test('free_trial — does not pass', () => {
    expect(hasFullAccess({ plan: 'free_trial' })).toBe(false);
  });

  test('null/undefined plan or profile — does not pass (never defaults to full access)', () => {
    expect(hasFullAccess({ plan: null })).toBe(false);
    expect(hasFullAccess({})).toBe(false);
    expect(hasFullAccess(null)).toBe(false);
    expect(hasFullAccess(undefined)).toBe(false);
  });
});

describe('isOwnerGrantedPlan', () => {
  test('lifetime/complimentary are owner-granted', () => {
    expect(isOwnerGrantedPlan({ plan: 'lifetime' })).toBe(true);
    expect(isOwnerGrantedPlan({ plan: 'complimentary' })).toBe(true);
  });

  test('paid is NOT owner-granted (a real subscription, not a freebie)', () => {
    expect(isOwnerGrantedPlan({ plan: 'paid' })).toBe(false);
  });

  // 'owner' is a DIFFERENT concept from isOwnerGrantedPlan's own meaning
  // ("a plan the business owner granted to a CUSTOMER for free") — it
  // must never show the lifetime/complimentary badge wording.
  test('owner is NOT "owner-granted" in this function\'s sense — gets its own distinct badge instead', () => {
    expect(isOwnerGrantedPlan({ plan: 'owner' })).toBe(false);
  });

  test('free_trial/null are not owner-granted', () => {
    expect(isOwnerGrantedPlan({ plan: 'free_trial' })).toBe(false);
    expect(isOwnerGrantedPlan(null)).toBe(false);
  });
});

describe('isOwnerAccount (owner decision, OWNER/DEV ACCOUNT FLAG pass)', () => {
  test('true only for plan === "owner"', () => {
    expect(isOwnerAccount({ plan: 'owner' })).toBe(true);
  });

  test('false for every other plan value, including the other full-access ones — a normal account is unaffected', () => {
    expect(isOwnerAccount({ plan: 'lifetime' })).toBe(false);
    expect(isOwnerAccount({ plan: 'complimentary' })).toBe(false);
    expect(isOwnerAccount({ plan: 'paid' })).toBe(false);
    expect(isOwnerAccount({ plan: 'free_trial' })).toBe(false);
    expect(isOwnerAccount({ plan: null })).toBe(false);
    expect(isOwnerAccount({})).toBe(false);
    expect(isOwnerAccount(null)).toBe(false);
    expect(isOwnerAccount(undefined)).toBe(false);
  });
});
