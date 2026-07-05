import { Text } from 'react-native';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useSettlements } from '@/src/data/settlements';
import { useMaintenanceRecords } from '@/src/data/maintenanceRecords';
import { Screen, ScreenTitle, Card, MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, typography } from '@/src/theme';

function fmtMoney(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function Dashboard() {
  const { session, profile, signOut } = useAuth();
  const { trucks, activeTruck, loading } = useActiveTruck();

  // Session 4 proof-of-import numbers only — full stat cards, tax row, and
  // Capital Account strip (all tappable, PROMPTS.md Session 5) land later.
  const settlementsQuery = useSettlements(activeTruck ? { truck_id: activeTruck.id } : undefined);
  const maintenanceQuery = useMaintenanceRecords(activeTruck ? { truck_id: activeTruck.id } : undefined);

  const settlements = settlementsQuery.data ?? [];
  const currentYear = new Date().getFullYear();
  const ytdNet = settlements
    .filter((s) => new Date(s.week_ending).getFullYear() === currentYear)
    .reduce((sum, s) => sum + Number(s.net ?? 0), 0);

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
          <MutedText>No trucks yet. Import a legacy backup or add one in Settings to get started.</MutedText>
        ) : (
          <Text style={{ color: colors.text, fontSize: typography.size.md }}>
            Active truck: {activeTruck?.unit_number ?? activeTruck?.id ?? '—'} ({trucks.length} total)
          </Text>
        )}
      </Card>
      {trucks.length > 0 && (
        <Card>
          <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '700', marginBottom: 6 }}>
            {settlementsQuery.isLoading ? 'Loading…' : `${settlements.length} settlement${settlements.length === 1 ? '' : 's'}`}
          </Text>
          <MutedText>YTD net ({currentYear}): {fmtMoney(ytdNet)}</MutedText>
          <MutedText>
            Maintenance records:{' '}
            {maintenanceQuery.isLoading ? '…' : (maintenanceQuery.data ?? []).length}
          </MutedText>
        </Card>
      )}
      <MutedText>
        Stat cards, tax estimator, and Capital Account strip land in a later session (see PROMPTS.md Session 5).
      </MutedText>
      <SecondaryButton title="Sign Out" onPress={signOut} />
    </Screen>
  );
}
