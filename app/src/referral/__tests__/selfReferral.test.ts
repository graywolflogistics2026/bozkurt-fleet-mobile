import { isLikelySelfReferral } from '@/src/referral/selfReferral';

describe('isLikelySelfReferral', () => {
  test('identical emails — self-referral', () => {
    expect(isLikelySelfReferral('driver@example.com', 'driver@example.com')).toBe(true);
  });

  test('different case — still self-referral', () => {
    expect(isLikelySelfReferral('Driver@Example.com', 'driver@example.com')).toBe(true);
  });

  test('genuinely different emails — not self-referral', () => {
    expect(isLikelySelfReferral('driver@example.com', 'friend@example.com')).toBe(false);
  });

  test('gmail +tag trick is caught', () => {
    expect(isLikelySelfReferral('driver@gmail.com', 'driver+trucking@gmail.com')).toBe(true);
  });

  test('gmail dot trick is caught', () => {
    expect(isLikelySelfReferral('a.b.driver@gmail.com', 'abdriver@gmail.com')).toBe(true);
  });

  test('gmail dot+tag combined trick is caught', () => {
    expect(isLikelySelfReferral('a.b@gmail.com', 'ab+work@googlemail.com')).toBe(true);
  });

  test('+tag trick works on non-gmail domains too', () => {
    expect(isLikelySelfReferral('driver@yahoo.com', 'driver+work@yahoo.com')).toBe(true);
  });

  test('dot trick is NOT assumed for non-gmail domains (dots may be meaningful there)', () => {
    expect(isLikelySelfReferral('a.b@yahoo.com', 'ab@yahoo.com')).toBe(false);
  });

  test('two different real people at gmail with genuinely different names are not flagged', () => {
    expect(isLikelySelfReferral('john.smith@gmail.com', 'jane.doe@gmail.com')).toBe(false);
  });

  test('empty input never flags (nothing to compare)', () => {
    expect(isLikelySelfReferral('', 'driver@example.com')).toBe(false);
    expect(isLikelySelfReferral('driver@example.com', '')).toBe(false);
  });
});
