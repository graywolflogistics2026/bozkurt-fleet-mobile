import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { buildAuthRedirectUrl } from '@/src/auth/deepLinkRedirect';
import { RESEND_COOLDOWN_SECONDS, nextCooldownValue } from '@/src/auth/resetPasswordFlow';
import { Screen, ScreenTitle, Card, PrimaryButton, SecondaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';

// EMAIL CONFIRMATION — NO-SESSION PATH (owner decision 2026-08-24, AUTH
// COMPLETENESS item B2): reached right after sign-up.tsx's signUp() call
// returns `confirmation_required` (Supabase's "Confirm email" is on, so no
// session was granted yet — there's nothing for AuthContext/the root gate
// to key off of here, unlike confirm-email.tsx's session-based case). This
// screen calls supabase.auth.resend() directly rather than going through
// AuthContext (no session exists to route the call through).
export default function CheckEmail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => nextCooldownValue(c)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    if (!email) return;
    setError(null);
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: buildAuthRedirectUrl('confirm-email') },
      });
      if (error) setError(error.message);
      else {
        setResent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <ScreenTitle>{t('auth.checkEmailTitle')}</ScreenTitle>
      <Card>
        <MutedText>{t('auth.checkEmailBody', { email: email ?? '' })}</MutedText>
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
        <SecondaryButton title={t('auth.changeEmailAddress')} onPress={() => router.replace('/(auth)/sign-up')} />
      </Card>
    </Screen>
  );
}
