// Phone hamburger-menu slide-up sheet (device feedback round 2, owner
// decision 2026-07-13) — replaces the "More" tab's plain navigation with
// a slide-up sheet. Tapping an item navigates then closes the sheet;
// the underlying more/(tabs) route tree is unchanged — every screen
// here is reached the same way it always was, just through a different
// front door.
//
// FLAT MENU (owner decision 2026-11-23, docs/decisions/
// menu-simplification-proposal.md): one list, no headings, bigger rows,
// most-used first, Settings last (navRegistry.ts menuItems()). A gear next
// to the X opens Settings too. The bottom padding is the safe-area bottom
// inset, read by the caller OUTSIDE this Modal (inside an Android Modal the
// inset can read 0), plus a fixed extra, so the last row never sits near or
// under the Android navigation/back bar.
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isActiveRoute, menuItems } from '@/src/navigation/navRegistry';
import { colors, radii, spacing, typography } from '@/src/theme';

// Extra space below the last row, on top of the safe-area inset.
const BOTTOM_EXTRA = 48;

export function MenuSheet({ visible, onClose, bottomInset = 0 }: { visible: boolean; onClose: () => void; bottomInset?: number }) {
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
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                onClose();
                router.push('/(tabs)/more/settings');
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('nav.openSettings')}
              style={styles.headerButton}
            >
              <Text style={styles.gearGlyph}>⚙️</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('nav.closeMenu')}
              style={styles.headerButton}
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: bottomInset + BOTTOM_EXTRA }} showsVerticalScrollIndicator={false}>
          {menuItems().map((item) => {
            const active = isActiveRoute(pathname, item.href as string);
            return (
              <Pressable
                key={item.href as string}
                onPress={() => {
                  onClose();
                  router.push(item.href);
                }}
                style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && styles.rowPressed]}
              >
                <Text style={styles.rowEmoji}>{item.emoji}</Text>
                <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{t(item.labelKey)}</Text>
              </Pressable>
            );
          })}
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
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: typography.size.xl,
    fontWeight: '700' as const,
  },
  headerActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  gearGlyph: {
    fontSize: 22,
  },
  closeGlyph: {
    color: colors.muted,
    fontSize: 22,
  },
  // Bigger rows (owner 2026-11-23): at least 52 tall, 16 pt label.
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  rowEmoji: {
    fontSize: 22,
    marginEnd: spacing.md,
  },
  rowActive: {
    backgroundColor: colors.card2,
  },
  rowPressed: {
    backgroundColor: colors.card,
  },
  rowLabel: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '500' as const,
  },
  rowLabelActive: {
    fontWeight: '700' as const,
  },
};
