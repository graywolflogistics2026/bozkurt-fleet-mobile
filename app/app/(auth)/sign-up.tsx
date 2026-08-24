import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Link, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { validateSignUpInput } from '@/src/auth/signUpFlow';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';
import { BRAND_NAME } from '@/src/brand';

// 2026-07-30 bug fix: the button used to be silently `disabled` whenever
// the password was under 6 characters (React Native never fires onPress
// on a disabled Pressable), with no hint why — a tap did nothing,
// indistinguishable from a broken button. Validation now runs INSIDE
// onSubmit and always shows a visible error, so every tap gives feedback.
// See src/auth/signUpFlow.ts for the extracted, tested validation/outcome
// logic and its full writeup of the two legitimate Supabase outcomes
// (email-confirmation on vs. off).
export default function SignUp() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setInfo(null);

    const validationError = validateSignUpInput(email, password);
    if (validationError) {
      setError(
        validationError === 'missing_email' ? t('auth.errorMissingEmail') : t('auth.errorPasswordTooShort')
      );
      return;
    }

    setLoading(true);
    try {
      const result = await signUp(email.trim(), password);
      if (result.status === 'error') {
        setError(result.message);
      } else if (result.status === 'confirmation_required') {
        // AUTH COMPLETENESS (owner decision 2026-08-24): a dedicated
        // blocking screen (resend + change-address) instead of just an
        // inline message the user could tap past with nothing to do next.
        router.replace({ pathname: '/(auth)/check-email', params: { email: email.trim() } } as unknown as Href);
      } else {
        // 'signed_in' — Confirm email is OFF on this Supabase project, so
        // signUp() already returned a real session; onAuthStateChange
        // (AuthContext) picks it up and RootLayoutNav navigates away on
        // its own. This message is just a friendly beat before that happens.
        setInfo(t('auth.signUpWelcome'));
      }
    } catch (err) {
      // Belt-and-suspenders: AuthContext.signUp() already catches internally
      // and never throws, but a failure path must never be silent even if
      // that contract is ever broken by a future change.
      setError(err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <ScreenTitle>{t('auth.createAccount')}</ScreenTitle>
          <MutedText>{t('auth.signUpTagline', { brand: BRAND_NAME })}</MutedText>
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
            placeholder={t('auth.passwordMinPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <ErrorText>{error}</ErrorText>
          {info ? <Text style={{ color: colors.green, fontSize: 12, marginBottom: 8 }}>{info}</Text> : null}
          <PrimaryButton title={t('auth.signUpButton')} onPress={onSubmit} loading={loading} />
          <Link href="/(auth)/sign-in" asChild>
            <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
              {t('auth.haveAccount')}
            </Text>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
