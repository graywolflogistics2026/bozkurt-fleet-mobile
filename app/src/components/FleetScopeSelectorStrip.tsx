import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { colors, radii, spacing, typography } from '@/src/theme';

// MULTI-TRUCK MODEL — SELECTOR PLACEMENT (owner decision) — the ONE
// interactive scope control in the whole app, a dedicated full-width
// strip on Home between the greeting and the rest of the dashboard.
// Every other screen's top bar shows TruckSwitcher's read-only badge
// instead (same ActiveTruckContext value, never a second interactive
// control that could diverge in UX even though the underlying value
// never could). Hidden entirely when the account has 0 or 1 truck
// (`showPicker` is false) — no clutter for a solo operator; appears the
// moment a 2nd truck exists.
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : colors.card2,
        marginEnd: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function FleetScopeSelectorStrip() {
  const { t } = useTranslation();
  const { trucks, activeTruckId, isAllTrucks, showPicker, setActiveTruckId } = useActiveTruck();

  if (!showPicker) return null;

  return (
    <View style={{ marginBottom: spacing.sm }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chip label={`🚛 ${t('truckSwitcher.allTrucks')}`} selected={isAllTrucks} onPress={() => setActiveTruckId('all')} />
        {trucks.map((truck) => (
          <Chip
            key={truck.id}
            label={`🚚 ${t('common.unit', { unit: truck.unit_number ?? truck.id })}`}
            selected={!isAllTrucks && activeTruckId === truck.id}
            onPress={() => setActiveTruckId(truck.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
