import { useState } from 'react';
import { Text } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function SignUp() {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setInfo(null);
    setLoading(true);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      setError(error);
    } else {
      setInfo(t('auth.signUpSuccess'));
    }
  }

  return (
    <Screen>
      <ScreenTitle>{t('auth.createAccount')}</ScreenTitle>
      <MutedText>{t('auth.signUpTagline')}</MutedText>
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
      <PrimaryButton
        title={t('auth.signUpButton')}
        onPress={onSubmit}
        loading={loading}
        disabled={!email || password.length < 6}
      />
      <Link href="/(auth)/sign-in" asChild>
        <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
          {t('auth.haveAccount')}
        </Text>
      </Link>
    </Screen>
  );
}
