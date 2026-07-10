import { Alert, Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { colors } from '@/src/theme';

// Only rendered when trucks.length > 1 — CLAUDE.md invariant #7: a
// single-truck account never sees this (the picker is hidden entirely, the
// one truck is auto-selected).
export function TruckSwitcher() {
  const { t } = useTranslation();
  const { trucks, activeTruck, showPicker, setActiveTruckId } = useActiveTruck();

  if (!showPicker) return null;

  function openPicker() {
    Alert.alert(
      t('truckSwitcher.switchTruck'),
      undefined,
      trucks
        .map((truck) => ({
          text: truck.unit_number ?? truck.id,
          onPress: () => setActiveTruckId(truck.id),
        }))
        .concat([{ text: t('truckSwitcher.cancel'), style: 'cancel' } as any])
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
        🚚 {activeTruck?.unit_number ?? t('truckSwitcher.selectTruck')}
      </Text>
    </Pressable>
  );
}
