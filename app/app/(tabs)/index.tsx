import { Text } from 'react-native';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

export default function Dashboard() {
  const { session, profile, signOut } = useAuth();
  const { trucks, activeTruck, loading } = useActiveTruck();

  return (
    <Screen>
      <ScreenTitle>Dashboard</ScreenTitle>
      <Card>
        <Text style={{ color: colors.text, fontSize: typography.size.md, marginBottom: 4 }}>
          Signed in as {session?.user.email}
        </Text>
        {profile?.company_name ? <MutedText>{profile.company_name}</MutedText> : null}
      </Card>
      <Card>
        {loading ? (
          <MutedText>Loading trucks…</MutedText>
        ) : trucks.length === 0 ? (
          <MutedText>No trucks yet. Add one in Settings to get started.</MutedText>
        ) : (
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>
            Active truck: {activeTruck?.unit_number ?? activeTruck?.id ?? '—'} ({trucks.length} total)
          </Text>
        )}
      </Card>
      <MutedText>
        Stat cards, tax estimator, and Capital Account strip land in a later session (see PROMPTS.md Session 5).
      </MutedText>
      <SecondaryButton title="Sign Out" onPress={signOut} />
    </Screen>
  );
}
