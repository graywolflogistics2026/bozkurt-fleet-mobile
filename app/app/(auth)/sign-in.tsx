import { useState } from 'react';
import { Text } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function SignIn() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) setError(error);
  }

  return (
    <Screen>
      <ScreenTitle>{t('auth.brand')}</ScreenTitle>
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
      <PrimaryButton title={t('auth.signIn')} onPress={onSubmit} loading={loading} disabled={!email || !password} />
      <Link href="/(auth)/sign-up" asChild>
        <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
          {t('auth.noAccount')}
        </Text>
      </Link>
    </Screen>
  );
}
