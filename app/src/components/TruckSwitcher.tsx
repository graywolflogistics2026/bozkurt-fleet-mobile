import { Alert, Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { colors } from '@/src/theme';

// MULTI-TRUCK MODEL (owner decision, SELECTOR PLACEMENT pass) — the
// interactive scope picker now lives in exactly ONE place: the dedicated
// strip on Home (FleetScopeSelectorStrip.tsx). This component is the
// read-only counterpart shown in every other tab's top bar (via
// app/(tabs)/_layout.tsx's screenOptions.headerRight) — a plain badge
// naming the current scope, never its own separate Alert-picker, so
// there is never a second interactive control that could read
// differently from Home's strip (they already share the same
// ActiveTruckContext value; this is about UX consistency, not just data
// consistency — one door to change the scope, not two). `interactive`
// defaults to true only for any future caller that still wants the old
// tap-to-switch Alert picker (none remain in this app after this pass,
// kept as an escape hatch rather than deleting the capability outright).
export function TruckSwitcher({ interactive = false }: { interactive?: boolean }) {
  const { t } = useTranslation();
  const { trucks, activeTruck, isAllTrucks, showPicker, setActiveTruckId } = useActiveTruck();

  if (!showPicker) return null;

  const label = isAllTrucks ? `🚛 ${t('truckSwitcher.allTrucks')}` : `🚚 ${activeTruck?.unit_number ?? t('truckSwitcher.selectTruck')}`;

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

  const badgeStyle = {
    backgroundColor: colors.card2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginEnd: 12,
  } as const;

  if (!interactive) {
    return (
      <Pressable disabled style={badgeStyle}>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={openPicker} style={badgeStyle}>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
