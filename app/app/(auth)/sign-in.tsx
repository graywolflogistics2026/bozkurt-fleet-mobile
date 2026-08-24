import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Link, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Field, PrimaryButton, SecondaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn, resendConfirmationEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AUTH COMPLETENESS (owner decision 2026-08-24): "Email not confirmed" is
  // its own distinct sign-in failure — a raw error string with no action
  // is a dead end for the user, so this shows a resend button instead.
  const [showResend, setShowResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function onSubmit() {
    setError(null);
    setShowResend(false);
    setResent(false);
    setLoading(true);
    try {
      const { error, needsEmailConfirmation } = await signIn(email.trim(), password);
      if (error) {
        setError(error);
        setShowResend(!!needsEmailConfirmation);
      }
    } catch (err) {
      // AuthContext.signIn() already catches internally and never throws —
      // this is belt-and-suspenders so a failure path is never silent even
      // if that contract is ever broken by a future change (2026-07-30
      // sign-up audit, applied symmetrically here).
      setError(err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setResending(true);
    try {
      const { error } = await resendConfirmationEmail(email.trim());
      if (error) setError(error);
      else setResent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <ScreenTitle>{BRAND_NAME}</ScreenTitle>
          <MutedText>{t('auth.signInSubtitle')}</MutedText>
          <Field
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            autoCorrect={false}
            style={{ marginTop: 16 }}
          />
          <Field
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />
          <ErrorText>{error}</ErrorText>
          {showResend && !resent && (
            <SecondaryButton title={t('auth.resendConfirmation')} onPress={onResend} loading={resending} />
          )}
          {resent && <Text style={{ color: colors.green, fontSize: 12, marginBottom: 8 }}>{t('auth.confirmationResent')}</Text>}
          <PrimaryButton title={t('auth.signIn')} onPress={onSubmit} loading={loading} disabled={!email || !password} />
          <Link href={'/(auth)/forgot-password' as Href} asChild>
            <Text style={{ color: colors.accent, marginTop: 12, textAlign: 'center' }}>{t('auth.forgotPasswordLink')}</Text>
          </Link>
          <Link href="/(auth)/sign-up" asChild>
            <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
              {t('auth.noAccount')}
            </Text>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
