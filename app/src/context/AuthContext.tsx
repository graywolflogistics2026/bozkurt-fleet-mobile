import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/src/lib/supabase';
import { queryClient, asyncStoragePersister } from '@/src/lib/queryClient';
import { TOS_VERSION } from '@/src/config/termsOfUse';
import { withTimeout } from '@/src/lib/withTimeout';
import { isSupportedLocale, LANGUAGE_PICKER_ENABLED } from '@/src/i18n/config';
import { setAppLocale } from '@/src/i18n';
import { applyLocaleDirection } from '@/src/i18n/rtl';
import { resolveSignUpOutcome, type SignUpOutcome } from '@/src/auth/signUpFlow';

// A network/runtime failure that never reaches Supabase's own {error}
// contract (e.g. the device is offline) throws instead of resolving —
// every auth entry point below catches that and surfaces it the same way
// as a normal AuthError, so a thrown exception can never look like a
// silently-dead button (2026-07-30 bug fix).
function messageFromUnknownError(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

const STARTUP_TIMEOUT_MS = 8000;

type Profile = {
  user_id: string;
  company_name: string | null;
  owner_name: string | null;
  locale: string | null;
  tos_accepted_at: string | null;
  tos_version: string | null;
  // onboarding_completed_at: docs/PENDING_SQL.md §28 (Session 9b onboarding
  // wizard) — null means the wizard has never been completed/skipped, same
  // "null = never done" pattern as tos_accepted_at.
  onboarding_completed_at: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  needsTos: boolean;
  needsOnboarding: boolean;
  signUp: (email: string, password: string) => Promise<SignUpOutcome>;
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
        .select('user_id, company_name, owner_name, locale, tos_accepted_at, tos_version, onboarding_completed_at')
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
    if (LANGUAGE_PICKER_ENABLED && isSupportedLocale(remoteLocale)) {
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

  async function signUp(email: string, password: string): Promise<SignUpOutcome> {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      return resolveSignUpOutcome({ errorMessage: error?.message ?? null, hasSession: !!data?.session });
    } catch (err) {
      return { status: 'error', message: messageFromUnknownError(err) };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: messageFromUnknownError(err) };
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    // PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
    // review item — second tier): the query cache is persisted to
    // AsyncStorage (src/lib/queryClient.ts, kept up to 7 days). Signing
    // out used to leave it completely untouched — the NEXT person who
    // signs in on this device (a different user, or the same one) would
    // see the previous session's stale financial data flash on screen
    // before each individual query happened to refetch, since nothing
    // ever invalidated the whole cache at once. queryClient.clear() drops
    // every query/mutation from memory immediately; removeClient() also
    // deletes the persisted AsyncStorage blob directly rather than
    // relying on the persister's own throttled save cycle to notice the
    // clear before the app is closed.
    queryClient.clear();
    await asyncStoragePersister.removeClient();
  }

  async function acceptTos() {
    if (!session) return { error: 'Not signed in.' };
    try {
      // upsert, not update (2026-07-30 tablet bug fix): a brand-new user
      // can reach this screen before trg_handle_new_user's profiles-row
      // insert has actually landed (a real race, not hypothetical — see
      // CLAUDE.md invariant #24-adjacent notes). A plain .update() on a
      // row that doesn't exist yet matches ZERO rows and Postgres/
      // PostgREST report that as SUCCESS with no error — so the write
      // silently no-opped, fetchProfile() below re-read the still-
      // missing row, profile stayed null, needsTos stayed true, and the
      // user was stuck on this screen with no visible error and no
      // navigation. onConflict: 'user_id' (the primary key) means this
      // creates the row if the trigger hasn't fired yet, or updates it
      // normally if it already has — either way it actually lands. Safe
      // against the trigger's own `on conflict (user_id) do nothing`
      // insert firing on either side of this call (0001_init.sql).
      const { error } = await supabase
        .from('profiles')
        .upsert({ user_id: session.user.id, tos_accepted_at: new Date().toISOString(), tos_version: TOS_VERSION }, { onConflict: 'user_id' });
      if (!error) await fetchProfile(session.user.id);
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: messageFromUnknownError(err) };
    }
  }

  async function refreshProfile() {
    if (session) await fetchProfile(session.user.id);
  }

  const needsTos = useMemo(() => {
    if (!session) return false;
    if (!profile) return true; // profile row not yet loaded/created — block until confirmed
    return profile.tos_accepted_at === null || profile.tos_version !== TOS_VERSION;
  }, [session, profile]);

  // Runs AFTER ToS acceptance (PROMPTS.md Session 9b — "after sign-up +
  // ToS acceptance, walk the user through..."), so this only ever
  // evaluates true once needsTos is already false.
  const needsOnboarding = useMemo(() => {
    if (!session || needsTos) return false;
    if (!profile) return false;
    return profile.onboarding_completed_at === null;
  }, [session, needsTos, profile]);

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    needsTos,
    needsOnboarding,
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
