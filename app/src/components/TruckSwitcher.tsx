import { Alert, Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { colors } from '@/src/theme';

// MULTI-TRUCK MODEL (owner decision) — this IS the "global scope
// selector" requirement: only rendered when trucks.length > 1 (CLAUDE.md
// invariant #7: a single-truck account never sees this, the one truck is
// auto-selected with no ambiguity to show). "All Trucks" is the first
// option and the default scope for a fresh multi-truck account
// (ActiveTruckContext's own new default). Every screen must read this
// SAME context (never a screen-local truck filter) so the label here and
// what a screen actually shows can never disagree — see CLAUDE.md's
// MULTI-TRUCK MODEL entry for the full per-screen scope rules.
export function TruckSwitcher() {
  const { t } = useTranslation();
  const { trucks, activeTruck, isAllTrucks, showPicker, setActiveTruckId } = useActiveTruck();

  if (!showPicker) return null;

  function openPicker() {
    Alert.alert(
      t('truckSwitcher.switchTruck'),
      undefined,
      [
        { text: `🚛 ${t('truckSwitcher.allTrucks')}`, onPress: () => setActiveTruckId('all') },
        ...trucks.map((truck) => ({
          text: truck.unit_number ?? truck.id,
          onPress: () => setActiveTruckId(truck.id),
        })),
        { text: t('truckSwitcher.cancel'), style: 'cancel' } as any,
      ]
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
        marginEnd: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
        {isAllTrucks ? `🚛 ${t('truckSwitcher.allTrucks')}` : `🚚 ${activeTruck?.unit_number ?? t('truckSwitcher.selectTruck')}`}
      </Text>
    </Pressable>
  );
}
