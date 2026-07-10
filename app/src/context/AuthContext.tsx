import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';
import { TOS_VERSION } from '@/src/config/termsOfUse';
import { withTimeout } from '@/src/lib/withTimeout';
import { isSupportedLocale } from '@/src/i18n/config';
import { setAppLocale } from '@/src/i18n';
import { applyLocaleDirection } from '@/src/i18n/rtl';

const STARTUP_TIMEOUT_MS = 8000;

type Profile = {
  user_id: string;
  company_name: string | null;
  owner_name: string | null;
  locale: string | null;
  tos_accepted_at: string | null;
  tos_version: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  needsTos: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  acceptTos: () => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string) {
    const result = await withTimeout(
      supabase
        .from('profiles')
        .select('user_id, company_name, owner_name, locale, tos_accepted_at, tos_version')
        .eq('user_id', userId)
        .maybeSingle(),
      STARTUP_TIMEOUT_MS,
      'fetchProfile'
    );
    setProfile(result?.data ?? null);
    // Cross-device sync (owner decision 2026-07-09): a manual language choice
    // in Settings is written to profiles.locale, and always wins over this
    // device's own cache/OS language on every subsequent sign-in.
    const remoteLocale = result?.data?.locale;
    if (isSupportedLocale(remoteLocale)) {
      await setAppLocale(remoteLocale);
      applyLocaleDirection(remoteLocale);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const result = await withTimeout(supabase.auth.getSession(), STARTUP_TIMEOUT_MS, 'auth.getSession');
        if (!mounted) return;
        setSession(result?.data.session ?? null);
        if (result?.data.session) await fetchProfile(result.data.session.user.id);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        await fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function acceptTos() {
    if (!session) return { error: 'Not signed in.' };
    const { error } = await supabase
      .from('profiles')
      .update({ tos_accepted_at: new Date().toISOString(), tos_version: TOS_VERSION })
      .eq('user_id', session.user.id);
    if (!error) await fetchProfile(session.user.id);
    return { error: error?.message ?? null };
  }

  async function refreshProfile() {
    if (session) await fetchProfile(session.user.id);
  }

  const needsTos = useMemo(() => {
    if (!session) return false;
    if (!profile) return true; // profile row not yet loaded/created — block until confirmed
    return profile.tos_accepted_at === null || profile.tos_version !== TOS_VERSION;
  }, [session, profile]);

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    needsTos,
    signUp,
    signIn,
    signOut,
    acceptTos,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
