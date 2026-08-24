import { supabase } from '@/src/lib/supabase';
import { parseAuthDeepLink } from '@/src/auth/deepLink';

export type ExchangeResult = { status: 'success'; type: 'recovery' | 'signup' | 'unknown' } | { status: 'error'; message: string } | { status: 'not_auth_link' };

// Thin async wrapper around the pure parseAuthDeepLink() — the ONE place
// both reset-password.tsx and confirm-email.tsx dispatch an incoming
// email-link URL to an actual Supabase session, so the two screens can
// never disagree about how a link is exchanged.
export async function exchangeAuthDeepLink(url: string | null | undefined): Promise<ExchangeResult> {
  const parsed = parseAuthDeepLink(url);
  if (!parsed) return { status: 'not_auth_link' };
  if (parsed.kind === 'error') return { status: 'error', message: parsed.message };

  if (parsed.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    return error ? { status: 'error', message: error.message } : { status: 'success', type: 'unknown' };
  }

  const { error } = await supabase.auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken });
  return error ? { status: 'error', message: error.message } : { status: 'success', type: parsed.type };
}
