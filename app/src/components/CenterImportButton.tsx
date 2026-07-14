import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/theme';

// Raised center tab button (owner decision 2026-07-04): importing
// receipts/documents is the highest-frequency action, so it gets its own
// prominent circular button instead of a plain tab slot. Phone-only — the
// wide-screen sidebar (PROMPTS.md Session 9) has no equivalent raised
// button, Import is just a normal item there.
//
// Session 9d item 11 ("Dashboard 2.0"): the + button now opens a
// two-action sheet (Import / Ask AI) instead of navigating straight to
// the import tab — same "custom tabBarButton intercepts the press,
// deliberately never calls the default onPress" pattern MenuTabButton
// already uses for the hamburger Menu tab.
export function CenterImportButton({ onOpenActionSheet, accessibilityState }: BottomTabBarButtonProps & { onOpenActionSheet: () => void }) {
  const { t } = useTranslation();
  const selected = accessibilityState?.selected;
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <Pressable
        onPress={onOpenActionSheet}
        style={({ pressed }) => [
          styles.button,
          selected && styles.buttonSelected,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.icon}>+</Text>
      </Pressable>
      <Text style={styles.label}>{t('nav.import')}</Text>
    </View>
  );
}

const SIZE = 56;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    borderWidth: 3,
    borderColor: colors.side,
  },
  buttonSelected: {
    backgroundColor: colors.green,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  icon: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    marginTop: -2,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
});
