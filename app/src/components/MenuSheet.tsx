// Phone hamburger-menu slide-up sheet (device feedback round 2, owner
// decision 2026-07-13) — replaces the "More" tab's plain navigation with
// a slide-up sheet showing the full section list grouped exactly like
// the wide-screen sidebar (same GROUPS array, WideSidebar.tsx, one
// source of truth). Tapping an item navigates then closes the sheet;
// the underlying more/(tabs) route tree is unchanged — every screen
// here is reached the same way it always was, just through a different
// front door.
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GROUPS, isActiveRoute } from '@/src/components/WideSidebar';
import { colors, radii, spacing, typography } from '@/src/theme';

export function MenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav.menu')}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
          {GROUPS.map((group) => (
            <View key={group.titleKey} style={{ marginBottom: spacing.sm }}>
              <Text style={styles.sectionLabel}>{t(group.titleKey)}</Text>
              {group.items.map((item) => {
                const active = isActiveRoute(pathname, item.href as string);
                return (
                  <Pressable
                    key={item.href as string}
                    onPress={() => {
                      onClose();
                      router.push(item.href);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      active && styles.rowActive,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={{ fontSize: 18, marginEnd: spacing.md }}>{item.emoji}</Text>
                    <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{t(item.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute' as const,
    bottom: 0,
    start: 0,
    end: 0,
    maxHeight: '85%' as const,
    backgroundColor: colors.side,
    borderTopStartRadius: radii.lg,
    borderTopEndRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  handleRow: {
    alignItems: 'center' as const,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: typography.size.xl,
    fontWeight: '700' as const,
  },
  closeGlyph: {
    color: colors.muted,
    fontSize: 20,
    padding: spacing.xs,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  rowActive: {
    backgroundColor: colors.card2,
  },
  rowPressed: {
    backgroundColor: colors.card,
  },
  rowLabel: {
    color: colors.muted,
    fontSize: typography.size.md,
    fontWeight: '500' as const,
  },
  rowLabelActive: {
    color: colors.text,
    fontWeight: '700' as const,
  },
};
