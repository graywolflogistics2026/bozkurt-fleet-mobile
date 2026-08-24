import { parseAuthDeepLink } from '@/src/auth/deepLink';

describe('parseAuthDeepLink', () => {
  test('null/undefined/empty — null', () => {
    expect(parseAuthDeepLink(null)).toBeNull();
    expect(parseAuthDeepLink(undefined)).toBeNull();
    expect(parseAuthDeepLink('')).toBeNull();
  });

  test('a plain path with no auth params — null', () => {
    expect(parseAuthDeepLink('bozkurtfleetos://reset-password')).toBeNull();
  });

  test('implicit-flow recovery link (hash fragment)', () => {
    const url = 'bozkurtfleetos://reset-password#access_token=abc123&refresh_token=def456&type=recovery&expires_in=3600';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'tokens', type: 'recovery', accessToken: 'abc123', refreshToken: 'def456' });
  });

  test('implicit-flow signup-confirmation link (hash fragment)', () => {
    const url = 'bozkurtfleetos://confirm-email#access_token=abc&refresh_token=def&type=signup';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'tokens', type: 'signup', accessToken: 'abc', refreshToken: 'def' });
  });

  test('tokens with an unrecognized/missing type still parse, tagged unknown', () => {
    const url = 'bozkurtfleetos://confirm-email#access_token=abc&refresh_token=def';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'tokens', type: 'unknown', accessToken: 'abc', refreshToken: 'def' });
  });

  test('PKCE-flow code (query param, fallback path)', () => {
    expect(parseAuthDeepLink('bozkurtfleetos://reset-password?code=xyz789')).toEqual({ kind: 'code', code: 'xyz789' });
  });

  test('expired/invalid link error, as a query param', () => {
    const url = 'bozkurtfleetos://reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
  });

  test('expired/invalid link error, as a hash fragment', () => {
    const url = 'bozkurtfleetos://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
  });

  test('error takes priority over any tokens present in the same link', () => {
    const url = 'bozkurtfleetos://reset-password#error_description=Something+went+wrong&access_token=abc&refresh_token=def';
    expect(parseAuthDeepLink(url)).toEqual({ kind: 'error', message: 'Something went wrong' });
  });

  test('a query-only URL with a fragment-less "?" does not bleed into the fragment parser', () => {
    const url = 'bozkurtfleetos://reset-password?code=abc';
    const result = parseAuthDeepLink(url);
    expect(result).toEqual({ kind: 'code', code: 'abc' });
  });
});
