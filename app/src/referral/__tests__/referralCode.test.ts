import { isValidReferralCodeFormat, normalizeReferralCode, generateReferralCode } from '@/src/referral/referralCode';

describe('isValidReferralCodeFormat', () => {
  test('a well-formed code is valid', () => {
    expect(isValidReferralCodeFormat('BOZKA-7F2K')).toBe(true);
  });

  test('lowercase input is still valid (case-insensitive)', () => {
    expect(isValidReferralCodeFormat('bozka-7f2k')).toBe(true);
  });

  test('surrounding whitespace is tolerated', () => {
    expect(isValidReferralCodeFormat('  BOZKA-7F2K  ')).toBe(true);
  });

  test('wrong prefix is invalid', () => {
    expect(isValidReferralCodeFormat('OTHER-7F2K')).toBe(false);
  });

  test('wrong suffix length is invalid', () => {
    expect(isValidReferralCodeFormat('BOZKA-7F2')).toBe(false);
    expect(isValidReferralCodeFormat('BOZKA-7F2KK')).toBe(false);
  });

  test('ambiguous characters (0/O/1/I) are never valid', () => {
    expect(isValidReferralCodeFormat('BOZKA-0O1I')).toBe(false);
  });

  test('empty string is invalid', () => {
    expect(isValidReferralCodeFormat('')).toBe(false);
  });
});

describe('normalizeReferralCode', () => {
  test('uppercases and trims', () => {
    expect(normalizeReferralCode('  bozka-7f2k ')).toBe('BOZKA-7F2K');
  });
});

describe('generateReferralCode', () => {
  test('always produces a validly-formatted code', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidReferralCodeFormat(generateReferralCode())).toBe(true);
    }
  });

  test('is deterministic given a fixed random source (always picks the first char)', () => {
    expect(generateReferralCode(() => 0)).toBe('BOZKA-AAAA');
  });
});
