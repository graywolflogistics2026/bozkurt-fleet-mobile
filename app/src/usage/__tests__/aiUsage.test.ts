import {
  calcMonthlyAllowance,
  calcUsageStatus,
  shouldCountAiImportUsage,
  monthStartUtc,
  canUseAi,
  sumAvailableCredits,
  planCreditConsumption,
  isCreditPackExpired,
  calcCatchUpPackExpiry,
  detectBackfillSession,
  bypassesUsageLimit,
  CATCH_UP_PACK_VALID_DAYS,
  DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH,
} from '@/src/usage/aiUsage';

// OWNER/DEV ACCOUNT FLAG (owner decision) — the client-side mirror of
// ai-import/index.ts's own inline owner-plan bypass. This is a display-
// layer helper only (Settings hides the usage UI entirely for an owner
// account) — the actual monthly-allowance ENFORCEMENT is server-side and
// Deno-only, hand-reviewed rather than unit-tested here, same limitation
// every prior ai-import pass in this codebase has had (no Deno runtime
// available in this environment).
describe('bypassesUsageLimit (owner decision, OWNER/DEV ACCOUNT FLAG pass)', () => {
  test('true only for the owner plan', () => {
    expect(bypassesUsageLimit('owner')).toBe(true);
  });

  test('false for every other plan value — a normal account is unaffected', () => {
    expect(bypassesUsageLimit('free_trial')).toBe(false);
    expect(bypassesUsageLimit('paid')).toBe(false);
    expect(bypassesUsageLimit('lifetime')).toBe(false);
    expect(bypassesUsageLimit('complimentary')).toBe(false);
    expect(bypassesUsageLimit(null)).toBe(false);
    expect(bypassesUsageLimit(undefined)).toBe(false);
  });
});

// "allowance recomputes when a truck is added/retired" (spec item 8)
describe('calcMonthlyAllowance', () => {
  test('1 truck = 60, 3 = 180, 8 = 480', () => {
    expect(calcMonthlyAllowance(1)).toBe(60);
    expect(calcMonthlyAllowance(3)).toBe(180);
    expect(calcMonthlyAllowance(8)).toBe(480);
  });

  test('0 active trucks still gets at least one truck worth (n=1 default spirit)', () => {
    expect(calcMonthlyAllowance(0)).toBe(60);
  });

  test('a server-set account ceiling caps the raw per-truck total', () => {
    expect(calcMonthlyAllowance(8, DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH, 300)).toBe(300);
    expect(calcMonthlyAllowance(2, DEFAULT_IMPORTS_PER_TRUCK_PER_MONTH, 300)).toBe(120); // under the ceiling, unaffected
  });
});

describe('calcUsageStatus', () => {
  test('under 80% — neither limit reached', () => {
    const result = calcUsageStatus(40, 60);
    expect(result.softLimitReached).toBe(false);
    expect(result.hardLimitReached).toBe(false);
  });

  test('at exactly 80% — soft limit reached, not hard', () => {
    const result = calcUsageStatus(48, 60);
    expect(result.softLimitReached).toBe(true);
    expect(result.hardLimitReached).toBe(false);
  });

  test('at or past 100% — both reached', () => {
    expect(calcUsageStatus(60, 60).hardLimitReached).toBe(true);
    expect(calcUsageStatus(65, 60).hardLimitReached).toBe(true);
  });
});

// "a multi-page settlement counts once; failed calls don't count" (spec item 8)
describe('shouldCountAiImportUsage', () => {
  test('a terminal, successful response counts', () => {
    expect(shouldCountAiImportUsage(false, false)).toBe(true);
  });

  test('a continuation round (more pages to go) never counts on its own', () => {
    expect(shouldCountAiImportUsage(true, false)).toBe(false);
  });

  test('a failed round never counts, terminal or not', () => {
    expect(shouldCountAiImportUsage(false, true)).toBe(false);
    expect(shouldCountAiImportUsage(true, true)).toBe(false);
  });
});

// "counters reset monthly" (spec item 8)
describe('monthStartUtc', () => {
  test('returns the 1st of the given month at UTC midnight', () => {
    expect(monthStartUtc(new Date('2026-08-24T15:30:00Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  test('a usage_log row from last month falls before this month\'s start (never counted this month)', () => {
    const lastMonthRow = new Date('2026-07-30T23:00:00Z');
    expect(lastMonthRow.getTime() < monthStartUtc(new Date('2026-08-24T00:00:00Z')).getTime()).toBe(true);
  });
});

// "allowance is consumed before credits" (spec item 8)
describe('canUseAi / credit consumption order', () => {
  test('under the monthly allowance — always allowed regardless of credits', () => {
    expect(canUseAi(calcUsageStatus(30, 60), 0)).toBe(true);
  });

  test('over the monthly allowance, no credits — blocked', () => {
    expect(canUseAi(calcUsageStatus(60, 60), 0)).toBe(false);
  });

  test('over the monthly allowance, real credits available — allowed', () => {
    expect(canUseAi(calcUsageStatus(60, 60), 5)).toBe(true);
  });
});

describe('sumAvailableCredits / planCreditConsumption', () => {
  const packs = [
    { id: 'a', creditsRemaining: 10, expiresAt: null },
    { id: 'b', creditsRemaining: 5, expiresAt: '2026-09-01T00:00:00Z' },
    { id: 'c', creditsRemaining: 3, expiresAt: '2026-08-01T00:00:00Z' }, // already expired
  ];
  const now = new Date('2026-08-15T00:00:00Z');

  test('sums only non-expired packs', () => {
    expect(sumAvailableCredits(packs, now)).toBe(15); // 10 + 5, not the expired 3
  });

  test('consumes from the soonest-expiring usable pack first', () => {
    expect(planCreditConsumption(packs, now)).toEqual({ packId: 'b' });
  });

  test('an empty/expired-only balance has nothing to consume', () => {
    expect(planCreditConsumption([{ id: 'c', creditsRemaining: 3, expiresAt: '2026-08-01T00:00:00Z' }], now)).toBeNull();
    expect(planCreditConsumption([], now)).toBeNull();
  });
});

// "the Catch-Up pack expires after 90 days" (spec item 8)
describe('calcCatchUpPackExpiry / isCreditPackExpired', () => {
  test('expires exactly 90 days after being granted', () => {
    const grantedAt = new Date('2026-08-24T00:00:00Z');
    const expiry = calcCatchUpPackExpiry(grantedAt);
    expect(expiry.toISOString()).toBe('2026-11-22T00:00:00.000Z');
    expect(CATCH_UP_PACK_VALID_DAYS).toBe(90);
  });

  test('isCreditPackExpired is false right up to the expiry moment, true after', () => {
    const expiry = calcCatchUpPackExpiry(new Date('2026-08-24T00:00:00Z')).toISOString();
    expect(isCreditPackExpired(expiry, new Date('2026-11-21T23:59:59Z'))).toBe(false);
    expect(isCreditPackExpired(expiry, new Date('2026-11-22T00:00:01Z'))).toBe(true);
  });

  test('a null expiry (the 3 fixed packs) never expires', () => {
    expect(isCreditPackExpired(null, new Date('2099-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('detectBackfillSession', () => {
  const now = new Date('2026-08-24T00:00:00Z');

  test('fewer than 3 past-month dates — not a backfill session', () => {
    expect(detectBackfillSession(['2026-08-20', '2026-07-01', '2026-06-15'], now)).toBe(false);
  });

  test('3+ dates from a prior month — a real backfill session', () => {
    expect(detectBackfillSession(['2026-07-01', '2026-06-15', '2026-05-10'], now)).toBe(true);
  });

  test('current-month dates never count toward the backfill signal', () => {
    expect(detectBackfillSession(['2026-08-20', '2026-08-21', '2026-08-22'], now)).toBe(false);
  });
});
