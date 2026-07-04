import { Text } from 'react-native';
import { useAuth } from '@/src/context/AuthContext';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

export default function Settings() {
  const { session, profile, signOut } = useAuth();

  return (
    <Screen>
      <ScreenTitle>Settings</ScreenTitle>
      <Card>
        <Text style={{ color: colors.text, fontSize: typography.size.md }}>{session?.user.email}</Text>
        <MutedText>
          Terms of Use accepted{' '}
          {profile?.tos_accepted_at ? new Date(profile.tos_accepted_at).toLocaleDateString() : '—'} (v
          {profile?.tos_version ?? '—'})
        </MutedText>
      </Card>
      <MutedText>
        Truck/company profile editing, and a Legal section (Terms + Privacy Policy, PROMPTS.md Session 10) land in a
        later session.
      </MutedText>
      <SecondaryButton title="Sign Out" onPress={signOut} />
    </Screen>
  );
}
