import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { exchangeAuthDeepLink } from '@/src/auth/deepLinkExchange';
import { RESEND_COOLDOWN_SECONDS, nextCooldownValue } from '@/src/auth/resetPasswordFlow';
import { Screen, ScreenTitle, Card, PrimaryButton, SecondaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { AuthBrandHeader } from '@/src/components/BrandLogo';

// EMAIL CONFIRMATION (owner decision 2026-08-24, AUTH COMPLETENESS item
// B2) — DUAL PURPOSE screen:
// (a) the root-gate destination (rootRedirect.ts) for a session whose
//     email_confirmed_at is still null — reached with NO url params, just
//     normal in-app navigation;
// (b) the deep-link TARGET when the user taps "Confirm your email" in
//     their inbox (AuthContext's signUp()/resendConfirmationEmail() both
//     set emailRedirectTo to this route) — reached with a real URL to
//     exchange, same Linking.getInitialURL()/'url'-event pattern as
//     reset-password.tsx.
// Once confirmed (either path), `session.user.email_confirmed_at` becomes
// non-null via the same onAuthStateChange listener AuthContext already
// has — needsEmailConfirmation recomputes on its own, but this screen
// still explicitly navigates on (same "faster, no extra render flash"
// pattern as tutorial.tsx/onboarding.tsx) rather than waiting on that.
export default function ConfirmEmail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, resendConfirmationEmail, signOut } = useAuth();
  const [exchanging, setExchanging] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function handle(url: string | null) {
      if (!url) {
        if (mounted) setExchanging(false);
        return;
      }
      const result = await exchangeAuthDeepLink(url);
      if (!mounted) return;
      setExchanging(false);
      if (result.status === 'error') {
        setError(result.message);
      } else if (result.status === 'success') {
        router.replace('/(tabs)');
      }
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => nextCooldownValue(c)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    if (!session?.user?.email) return;
    setError(null);
    setResending(true);
    try {
      const { error } = await resendConfirmationEmail(session.user.email);
      if (error) setError(error);
      else {
        setResent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } finally {
      setResending(false);
    }
  }

  if (exchanging) {
    return (
      <Screen>
        <MutedText>{t('common.loading')}</MutedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <AuthBrandHeader />
      <ScreenTitle>{t('auth.checkEmailTitle')}</ScreenTitle>
      <Card>
        <MutedText>{t('auth.checkEmailBody', { email: session?.user?.email ?? '' })}</MutedText>
        <ErrorText>{error}</ErrorText>
        {resent && !error && (
          <MutedText style={{ color: colors.green, marginTop: 8 }}>{t('auth.confirmationResent')}</MutedText>
        )}
        <PrimaryButton
          title={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resendConfirmation')}
          onPress={handleResend}
          loading={resending}
          disabled={cooldown > 0}
        />
        <SecondaryButton
          title={t('auth.signOutInstead')}
          onPress={async () => {
            // Actually signs out (not just a navigate) — with a session
            // still active and needsEmailConfirmation still true, the root
            // gate would otherwise immediately bounce any bare navigate
            // right back here. Lets someone who mistyped their address
            // during signup start over with a different account, same
            // "change address" spirit as check-email.tsx's own button for
            // the no-session signup path.
            await signOut();
            router.replace('/(auth)/sign-in');
          }}
        />
      </Card>
    </Screen>
  );
}
