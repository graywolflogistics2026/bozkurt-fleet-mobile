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
import { resolveNeedsEmailConfirmation, resolveNeedsTos, resolveNeedsTutorial, resolveNeedsOnboarding } from '@/src/auth/profileGates';
import { buildAuthRedirectUrl } from '@/src/auth/deepLinkRedirect';

// A network/runtime failure that never reaches Supabase's own {error}
// contract (e.g. the device is offline) throws instead of resolving —
// every auth entry point below catches that and surfaces it the same way
// as a normal AuthError, so a thrown exception can never look like a
// silently-dead button (2026-07-30 bug fix).
function messageFromUnknownError(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

const STARTUP_TIMEOUT_MS = 8000;

const PROFILE_COLUMNS = 'user_id, company_name, owner_name, locale, tos_accepted_at, tos_version, onboarding_completed_at, tutorial_seen_at';
// Fallback select used only when the full list above 400s on a missing
// tutorial_seen_at column (see fetchProfile below) — same field list minus
// that one newest column.
const PROFILE_COLUMNS_WITHOUT_TUTORIAL = 'user_id, company_name, owner_name, locale, tos_accepted_at, tos_version, onboarding_completed_at';

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
  // docs/PENDING_SQL.md §48 (owner decision 2026-08-05, FULL PARITY
  // follow-up item I) — null means the first-run tutorial has never been
  // seen/skipped, same "null = never done" pattern.
  tutorial_seen_at: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  needsEmailConfirmation: boolean;
  needsTos: boolean;
  needsTutorial: boolean;
  needsOnboarding: boolean;
  signUp: (email: string, password: string) => Promise<SignUpOutcome>;
  signIn: (email: string, password: string) => Promise<{ error: string | null; needsEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  acceptTos: () => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  resendConfirmationEmail: (email: string) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string) {
    const result = await withTimeout(
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle(),
      STARTUP_TIMEOUT_MS,
      'fetchProfile'
    );
    let profileData: Profile | null = result?.data ?? null;
    // ROBUSTNESS (owner decision 2026-08-24, device report "tutorial never
    // appeared"): tutorial_seen_at (docs/PENDING_SQL.md §48) is newer than
    // the rest of this select list. If that migration hasn't actually run
    // against the live DB yet, PostgREST fails the WHOLE select (not just
    // that one field) — which would otherwise silently null out
    // tos_accepted_at/onboarding_completed_at too, not just
    // tutorial_seen_at, breaking every other profile-gated screen along
    // with it. Retry once without the column so a missing column degrades
    // to "tutorial state unknown" (which needsTutorial below now correctly
    // treats as SHOW, not "already seen") instead of nuking the whole
    // profile fetch.
    if (result?.error && profileData === null && /tutorial_seen_at/.test(result.error.message ?? '')) {
      const fallback = await withTimeout(
        supabase.from('profiles').select(PROFILE_COLUMNS_WITHOUT_TUTORIAL).eq('user_id', userId).maybeSingle(),
        STARTUP_TIMEOUT_MS,
        'fetchProfile-fallback'
      );
      profileData = fallback?.data ? { ...fallback.data, tutorial_seen_at: null } : null;
    }
    setProfile(profileData);
    // Cross-device sync (owner decision 2026-07-09): a manual language choice
    // in Settings is written to profiles.locale, and always wins over this
    // device's own cache/OS language on every subsequent sign-in.
    const remoteLocale = profileData?.locale;
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
      // AUTH COMPLETENESS (owner decision 2026-08-24): emailRedirectTo makes
      // the confirmation email's link open straight back into the app at
      // /confirm-email (via the custom `scheme`) instead of a generic
      // Supabase-hosted confirmation page — same redirect the resend button
      // (resendConfirmationEmail below) uses, so both paths land the user
      // in the same place.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: buildAuthRedirectUrl('confirm-email') },
      });
      return resolveSignUpOutcome({ errorMessage: error?.message ?? null, hasSession: !!data?.session });
    } catch (err) {
      return { status: 'error', message: messageFromUnknownError(err) };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      // AUTH COMPLETENESS (owner decision 2026-08-24): with "Confirm email"
      // on, Supabase rejects a sign-in for an unconfirmed account with this
      // specific error rather than granting a session at all — surfaced as
      // its own flag so sign-in.tsx can offer "resend confirmation" instead
      // of just showing the raw error text.
      const needsEmailConfirmation = !!error && /email not confirmed/i.test(error.message);
      return { error: error?.message ?? null, needsEmailConfirmation };
    } catch (err) {
      return { error: messageFromUnknownError(err) };
    }
  }

  async function sendPasswordResetEmail(email: string) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: buildAuthRedirectUrl('reset-password') });
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: messageFromUnknownError(err) };
    }
  }

  async function updatePassword(newPassword: string) {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: messageFromUnknownError(err) };
    }
  }

  async function resendConfirmationEmail(email: string) {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: buildAuthRedirectUrl('confirm-email') },
      });
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

  // needsEmailConfirmation/needsTos/needsTutorial/needsOnboarding are pure
  // functions in src/auth/profileGates.ts (extracted 2026-08-24, tutorial-
  // gate bug fix — see that file's header comment for the "unknown state
  // defaults to SHOW" rule the profile-loaded ones share and their own
  // regression tests). needsEmailConfirmation reads directly off the
  // Supabase session's own user object, no profile fetch involved.
  const needsEmailConfirmation = useMemo(
    () => resolveNeedsEmailConfirmation({ hasSession: !!session, emailConfirmedAt: session?.user?.email_confirmed_at }),
    [session]
  );

  const needsTos = useMemo(
    () =>
      resolveNeedsTos({
        hasSession: !!session,
        profileLoaded: !!profile,
        tosAcceptedAt: profile?.tos_accepted_at,
        tosVersion: profile?.tos_version,
        currentTosVersion: TOS_VERSION,
      }),
    [session, profile]
  );

  // FIRST-RUN TUTORIAL (owner decision 2026-08-05, FULL PARITY follow-up
  // item I) — runs after ToS acceptance and BEFORE the onboarding wizard
  // (spec's own explicit ordering), so this only ever evaluates true once
  // needsTos is already false, and needsOnboarding below additionally
  // waits for this to clear too.
  const needsTutorial = useMemo(
    () => resolveNeedsTutorial({ hasSession: !!session, needsTos, profileLoaded: !!profile, tutorialSeenAt: profile?.tutorial_seen_at }),
    [session, needsTos, profile]
  );

  // Runs AFTER ToS acceptance AND the first-run tutorial (PROMPTS.md
  // Session 9b — "after sign-up + ToS acceptance, walk the user
  // through..."; the tutorial slots in between per its own spec).
  const needsOnboarding = useMemo(
    () =>
      resolveNeedsOnboarding({
        hasSession: !!session,
        needsTos,
        needsTutorial,
        profileLoaded: !!profile,
        onboardingCompletedAt: profile?.onboarding_completed_at,
      }),
    [session, needsTos, needsTutorial, profile]
  );

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    needsEmailConfirmation,
    needsTos,
    needsTutorial,
    needsOnboarding,
    signUp,
    signIn,
    signOut,
    acceptTos,
    refreshProfile,
    sendPasswordResetEmail,
    updatePassword,
    resendConfirmationEmail,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
