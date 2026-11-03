import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/src/theme';
import type { TruckOwnership } from '@/src/import/lineClass';

// trucks.ownership (docs/PENDING_SQL.md §84, owner decision D10 2026-11-03):
// decides how the carrier's truck payment (Prime NP) counts. Leased = rent
// (an expense); financed = loan repayment (not an expense); paid for =
// owned outright. Shared by the truck form, the add-vehicle flow and the
// import review card's one-time question.
export const TRUCK_OWNERSHIP_VALUES: TruckOwnership[] = ['leased', 'financed', 'owned_cash'];

export function TruckOwnershipPicker({
  value,
  onChange,
}: {
  value: TruckOwnership | null;
  onChange: (v: TruckOwnership | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
      {TRUCK_OWNERSHIP_VALUES.map((v) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(on ? null : v)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: on ? colors.accent : colors.border,
              backgroundColor: on ? colors.accent : colors.card2,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>{t(`truckOwnership.${v}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
