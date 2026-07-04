import { Alert, Pressable, Text } from 'react-native';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { colors } from '@/src/theme';

// Only rendered when trucks.length > 1 — CLAUDE.md invariant #7: a
// single-truck account never sees this (the picker is hidden entirely, the
// one truck is auto-selected).
export function TruckSwitcher() {
  const { trucks, activeTruck, showPicker, setActiveTruckId } = useActiveTruck();

  if (!showPicker) return null;

  function openPicker() {
    Alert.alert(
      'Switch Truck',
      undefined,
      trucks
        .map((t) => ({
          text: t.unit_number ?? t.id,
          onPress: () => setActiveTruckId(t.id),
        }))
        .concat([{ text: 'Cancel', style: 'cancel' } as any])
    );
  }

  return (
    <Pressable
      onPress={openPicker}
      style={{
        backgroundColor: colors.card2,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginRight: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
        🚚 {activeTruck?.unit_number ?? 'Select truck'}
      </Text>
    </Pressable>
  );
}
