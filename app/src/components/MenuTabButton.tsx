import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/theme';

// Hamburger Menu tab (device feedback round 2, owner decision 2026-07-13)
// — replaces plain tab navigation with opening MenuSheet.tsx's slide-up
// sheet (onOpenMenu, supplied by (tabs)/_layout.tsx), same "custom
// tabBarButton intercepts the press" pattern CenterImportButton already
// uses for the raised Import button. Deliberately never calls the
// default `onPress` prop (which would navigate to the more/ stack) —
// this tab no longer navigates anywhere on phones, it only opens the
// sheet.
export function MenuTabButton({ onOpenMenu, accessibilityState }: BottomTabBarButtonProps & { onOpenMenu: () => void }) {
  const { t } = useTranslation();
  const selected = accessibilityState?.selected;
  return (
    <Pressable onPress={onOpenMenu} style={styles.wrapper}>
      <Text style={[styles.icon, selected && styles.iconSelected]}>☰</Text>
      <Text style={[styles.label, selected && styles.labelSelected]}>{t('nav.menu')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    color: colors.muted,
  },
  iconSelected: {
    color: colors.accent,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
    color: colors.muted,
  },
  labelSelected: {
    color: colors.accent,
  },
});
