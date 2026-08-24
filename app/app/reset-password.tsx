import { useEffect, useState } from 'react';
import { Linking, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { exchangeAuthDeepLink } from '@/src/auth/deepLinkExchange';
import { validateNewPassword } from '@/src/auth/resetPasswordFlow';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText, Card } from '@/src/components/ui';
import { AuthBrandHeader } from '@/src/components/BrandLogo';

// SET NEW PASSWORD (owner decision 2026-08-24, AUTH COMPLETENESS item B1)
// — reached ONLY via the password-reset email's deep link
// (rootRedirect.ts exempts this route from the normal "no session"
// bounce specifically so this screen can run). Linking.getInitialURL()
// covers a cold start (app wasn't running when the link was tapped);
// the 'url' event listener covers a warm start (app already running,
// backgrounded). Both hand the full URL (including the #access_token
// hash fragment — see deepLink.ts) to the same exchange, so the two
// entry paths can never disagree about how a link is processed.
type Phase = 'exchanging' | 'ready' | 'invalid' | 'saving' | 'done';

export default function ResetPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const { updatePassword } = useAuth();
  const [phase, setPhase] = useState<Phase>('exchanging');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function handle(url: string | null) {
      const result = await exchangeAuthDeepLink(url);
      if (!mounted) return;
      if (result.status === 'success') {
        setPhase('ready');
      } else if (result.status === 'error') {
        setLinkError(result.message);
        setPhase('invalid');
      } else {
        setLinkError(t('auth.resetLinkInvalid'));
        setPhase('invalid');
      }
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [t]);

  async function handleSubmit() {
    const validationError = validateNewPassword(password, confirmPassword);
    if (validationError) {
      setFormError(validationError === 'too_short' ? t('auth.errorPasswordTooShort') : t('auth.errorPasswordMismatch'));
      return;
    }
    setFormError(null);
    setPhase('saving');
    const { error } = await updatePassword(password);
    if (error) {
      setFormError(error);
      setPhase('ready');
      return;
    }
    setPhase('done');
    // Explicit navigate (same pattern as tutorial.tsx/onboarding.tsx) —
    // faster than waiting on the root-redirect effect, and this route is
    // deliberately never auto-redirected away on its own (see
    // rootRedirect.ts's own comment on why).
    setTimeout(() => router.replace('/(tabs)'), 1000);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <AuthBrandHeader />
          <ScreenTitle>{t('auth.resetPasswordTitle')}</ScreenTitle>

          {phase === 'exchanging' && <MutedText>{t('common.loading')}</MutedText>}

          {phase === 'invalid' && (
            <Card>
              <ErrorText>{linkError}</ErrorText>
              <MutedText>{t('auth.resetLinkInvalidBody')}</MutedText>
              <PrimaryButton title={t('auth.requestNewLink')} onPress={() => router.replace('/(auth)/forgot-password' as Href)} />
            </Card>
          )}

          {(phase === 'ready' || phase === 'saving' || phase === 'done') && (
            <>
              <MutedText>{t('auth.resetPasswordSubtitle')}</MutedText>
              <Field
                placeholder={t('auth.newPasswordPlaceholder')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                editable={phase === 'ready'}
                style={{ marginTop: 16 }}
              />
              <Field
                placeholder={t('auth.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoComplete="new-password"
                editable={phase === 'ready'}
              />
              <ErrorText>{formError}</ErrorText>
              {phase === 'done' ? (
                <MutedText>{t('auth.resetPasswordSuccess')}</MutedText>
              ) : (
                <PrimaryButton
                  title={t('auth.setNewPassword')}
                  onPress={handleSubmit}
                  loading={phase === 'saving'}
                  disabled={!password || !confirmPassword}
                />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
