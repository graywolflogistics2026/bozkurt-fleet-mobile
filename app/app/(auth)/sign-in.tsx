import { useState } from 'react';
import { Text } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function SignIn() {
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
      <ScreenTitle>Bozkurt Fleet OS</ScreenTitle>
      <MutedText>Sign in to continue</MutedText>
      <Field
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        style={{ marginTop: 16 }}
      />
      <Field
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title="Sign In" onPress={onSubmit} loading={loading} disabled={!email || !password} />
      <Link href="/(auth)/sign-up" asChild>
        <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
          Don't have an account? Sign up
        </Text>
      </Link>
    </Screen>
  );
}
