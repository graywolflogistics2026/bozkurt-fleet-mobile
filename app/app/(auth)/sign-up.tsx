import { useState } from 'react';
import { Text } from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Field, PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors } from '@/src/theme';

export default function SignUp() {
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
      setInfo('Account created. If email confirmation is required, check your inbox before signing in.');
    }
  }

  return (
    <Screen>
      <ScreenTitle>Create account</ScreenTitle>
      <MutedText>Graywolf Logistics LLC — Fleet OS</MutedText>
      <Field
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        autoCorrect={false}
        style={{ marginTop: 16 }}
      />
      <Field
        placeholder="Password (min 6 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <ErrorText>{error}</ErrorText>
      {info ? <Text style={{ color: colors.green, fontSize: 12, marginBottom: 8 }}>{info}</Text> : null}
      <PrimaryButton
        title="Create Account"
        onPress={onSubmit}
        loading={loading}
        disabled={!email || password.length < 6}
      />
      <Link href="/(auth)/sign-in" asChild>
        <Text style={{ color: colors.accent, marginTop: 16, textAlign: 'center' }}>
          Already have an account? Sign in
        </Text>
      </Link>
    </Screen>
  );
}
