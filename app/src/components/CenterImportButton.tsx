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
// Where bottom-tabs 7.18 places a below-icon label: padding 5 + icon slot 28.
const LABEL_TOP = 33;

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
  // Import is 2nd of 4 tabs (owner 2026-11-23): accent + bold label.
  // TAB LABEL BASELINE FIX (owner device report 2026-11-23, Android 3-button
  // nav): the label sat lower than Home/Reports/Menu and touched the system
  // nav bar. Cause: it flowed under the circle (top 36) and d56e1e8 raised
  // it to 11 pt, so it ran past the 49 px bar into the bottom inset. Now it
  // sits where @react-navigation/bottom-tabs 7.18 puts every other label:
  // 5 px tab padding + 28 px icon slot = top 33, at the library's 10 pt
  // (BottomTabItem.tsx styles.tabVerticalUiKit / labelBeneath,
  // TabBarIcon.tsx ICON_SIZE_TALL). The circle is unchanged (56 px, top -22).
  label: {
    position: 'absolute',
    top: LABEL_TOP,
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
  },
});
