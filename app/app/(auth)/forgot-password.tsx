import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { RESEND_COOLDOWN_SECONDS, nextCooldownValue } from '@/src/auth/resetPasswordFlow';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { AuthBrandHeader } from '@/src/components/BrandLogo';

// FORGOT PASSWORD (owner decision 2026-08-24, AUTH COMPLETENESS item B1):
// email input -> sendPasswordResetEmail() -> "check your email" state.
// Supabase deliberately never reveals whether an email exists (security
// best practice, avoids account enumeration) — a success response here
// always means "the email was sent if that address has an account," never
// "that account exists." The 60s client-side cooldown is on top of (not
// instead of) Supabase's own server-side rate limiting, whose error still
// surfaces via `error` if the user mashes the button faster than that.
export default function ForgotPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const { sendPasswordResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => nextCooldownValue(c)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleSend() {
    if (!email.trim()) {
      setError(t('auth.errorMissingEmail'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error } = await sendPasswordResetEmail(email.trim());
      if (error) {
        setError(error);
      } else {
        setSent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <AuthBrandHeader />
          <ScreenTitle>{t('auth.forgotPasswordTitle')}</ScreenTitle>
          <MutedText>{t('auth.forgotPasswordSubtitle')}</MutedText>
          <Field
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            autoCorrect={false}
            editable={!sent}
            style={{ marginTop: 16 }}
          />
          <ErrorText>{error}</ErrorText>
          {sent && <Text style={{ color: colors.green, fontSize: 12, marginBottom: 8 }}>{t('auth.forgotPasswordCheckEmail')}</Text>}
          <PrimaryButton
            title={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : sent ? t('auth.resendLink') : t('auth.sendResetLink')}
            onPress={handleSend}
            loading={loading}
            disabled={!email || cooldown > 0}
          />
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>{t('auth.backToSignIn')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
