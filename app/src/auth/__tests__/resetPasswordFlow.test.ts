import { validateNewPassword, nextCooldownValue, RESEND_COOLDOWN_SECONDS } from '@/src/auth/resetPasswordFlow';

describe('validateNewPassword', () => {
  test('too short', () => {
    expect(validateNewPassword('abc', 'abc')).toBe('too_short');
  });

  test('mismatch', () => {
    expect(validateNewPassword('abcdef', 'abcdeg')).toBe('mismatch');
  });

  test('valid and matching', () => {
    expect(validateNewPassword('abcdef', 'abcdef')).toBeNull();
  });

  test('too-short check runs before the mismatch check', () => {
    expect(validateNewPassword('ab', 'cd')).toBe('too_short');
  });
});

describe('nextCooldownValue', () => {
  test('counts down by 1', () => {
    expect(nextCooldownValue(5)).toBe(4);
  });

  test('never goes negative', () => {
    expect(nextCooldownValue(0)).toBe(0);
  });

  test('RESEND_COOLDOWN_SECONDS is a sane positive default', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});
