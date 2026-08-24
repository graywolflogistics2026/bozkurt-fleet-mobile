import { hasFullAccess, isOwnerGrantedPlan } from '@/src/entitlement/hasFullAccess';

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

  test('free_trial/null are not owner-granted', () => {
    expect(isOwnerGrantedPlan({ plan: 'free_trial' })).toBe(false);
    expect(isOwnerGrantedPlan(null)).toBe(false);
  });
});
