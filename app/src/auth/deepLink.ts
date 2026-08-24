// AUTH COMPLETENESS (owner decision 2026-08-24) — password reset and email
// confirmation both work via a link Supabase emails to the user, which
// opens back into this app via its custom URL `scheme` (app.config.js).
// Deliberately does NOT add expo-linking as a new dependency: the app's
// scheme already round-trips through React Native's own built-in `Linking`
// API (Linking.getInitialURL/addEventListener/openURL — see
// reset-password.tsx/confirm-email.tsx) with zero native-module change.
//
// This file stays 100% free of `expo-constants`/`react-native` imports on
// purpose — jest.config.js runs this test suite under plain ts-jest/Node
// with NO Expo/RN mocking (see its own header comment), same reason
// buildInfo.ts/buildInfoFormat.ts are split into a native-touching half
// and a pure, tested half. The OUTBOUND URL builder
// (`buildAuthRedirectUrl`, which reads `Constants.expoConfig.scheme`)
// lives in the separate, untested `deepLinkRedirect.ts` for exactly this
// reason — importing it here would break every test in this file.

export type AuthDeepLinkResult =
  | { kind: 'tokens'; type: 'recovery' | 'signup' | 'unknown'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | null;

// The Supabase client here uses the default `flowType: 'implicit'` (see
// src/lib/supabase.ts) — recovery/confirmation links carry their tokens as
// a URL HASH FRAGMENT (`#access_token=...&refresh_token=...&type=recovery`),
// not a `?code=` query param. `code` is still parsed as a fallback/
// future-proofing in case the project's flowType is ever switched to PKCE
// — both shapes are handled by the same caller (deepLinkExchange.ts)
// without either screen needing to know which one actually applies.
// A malformed/expired link (Supabase appends
// `#error=access_denied&error_code=otp_expired&error_description=...`) is
// surfaced as its own `kind: 'error'` result rather than falling through
// to a generic "invalid link" message with no detail.
export function parseAuthDeepLink(url: string | null | undefined): AuthDeepLinkResult {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const queryEnd = hashIndex >= 0 ? hashIndex : url.length;
  const query = queryIndex >= 0 && queryIndex < queryEnd ? url.slice(queryIndex + 1, queryEnd) : '';

  const fragParams = new URLSearchParams(fragment);
  const queryParams = new URLSearchParams(query);

  const errorDescription = fragParams.get('error_description') || queryParams.get('error_description');
  if (errorDescription) {
    return { kind: 'error', message: errorDescription };
  }

  const accessToken = fragParams.get('access_token');
  const refreshToken = fragParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const rawType = fragParams.get('type');
    const type = rawType === 'recovery' ? 'recovery' : rawType === 'signup' ? 'signup' : 'unknown';
    return { kind: 'tokens', type, accessToken, refreshToken };
  }

  const code = queryParams.get('code');
  if (code) return { kind: 'code', code };

  return null;
}
