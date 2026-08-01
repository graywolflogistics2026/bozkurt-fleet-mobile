import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useDashboardLayout, useUpdateDashboardLayout } from '@/src/data/dashboardLayout';
import { CARD_LABEL_KEYS, mergeDashboardLayout, type DashboardCardConfig } from '@/src/stats/dashboardLayout';
import { ModalSheet, SheetTitle, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// UX MEGA-PASS item C (owner decision 2026-07-31, device evidence:
// "Customize Dashboard still broken; also unreachable from the 'Good
// morning' header link" — the 4th report on this screen despite three
// prior rounds of fixes to app/(tabs)/more/dashboard-customize.tsx
// itself). Rather than a 5th attempt at hardening that screen (which
// depends on react-native-draggable-flatlist, a native module, and lives
// behind its own route — either of which is a fresh place for a device-
// specific failure to hide), this is a deliberately dumb, bulletproof
// PRIMARY path: pure local component state, zero external libraries, no
// separate route to fail to mount — it renders directly in a ModalSheet
// from the Dashboard's own "Customize" link, so there is nothing left
// that can make it "unreachable." Show/hide + up/down reordering only
// (no drag, no per-card label/section editing) — the fancy screen is
// still there for that, one tap away via "Advanced editor" below, kept
// intact behind this as the fallback-of-last-resort's fallback.
function moveBy<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function SimpleCustomizeDashboardModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const layoutQuery = useDashboardLayout();
  const updateLayout = useUpdateDashboardLayout();
  const [draft, setDraft] = useState<DashboardCardConfig[]>(() => mergeDashboardLayout(null));
  const [saving, setSaving] = useState(false);

  // Re-sync from the real saved layout whenever the modal opens (not just
  // once on mount) — this modal stays mounted for the lifetime of the
  // Dashboard screen (visible toggles), so a stale draft from a previous
  // open must never persist into the next one.
  useEffect(() => {
    if (visible && layoutQuery.data) setDraft(layoutQuery.data.layout);
  }, [visible, layoutQuery.data]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateLayout.mutateAsync(draft);
      onClose();
    } catch (err) {
      Alert.alert(t('dashboardCustomize.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleAdvanced() {
    onClose();
    router.push('/(tabs)/more/dashboard-customize');
  }

  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <SheetTitle>{t('dashboardCustomize.title')}</SheetTitle>
      <MutedText style={{ marginBottom: spacing.sm }}>{t('dashboardCustomize.simpleSubtitle')}</MutedText>

      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {draft.map((row, index) => {
          const defaultLabel = t(CARD_LABEL_KEYS[row.id as keyof typeof CARD_LABEL_KEYS] ?? row.id);
          return (
            <View key={row.id} style={styles.row}>
              <View style={styles.arrowColumn}>
                <Pressable
                  onPress={() => setDraft((cur) => moveBy(cur, index, -1))}
                  disabled={index === 0}
                  hitSlop={4}
                  style={styles.arrowButton}
                >
                  <Text style={[styles.arrowGlyph, index === 0 && styles.arrowGlyphDisabled]}>▲</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDraft((cur) => moveBy(cur, index, 1))}
                  disabled={index === draft.length - 1}
                  hitSlop={4}
                  style={styles.arrowButton}
                >
                  <Text style={[styles.arrowGlyph, index === draft.length - 1 && styles.arrowGlyphDisabled]}>▼</Text>
                </Pressable>
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {row.label || defaultLabel}
              </Text>
              <Pressable
                onPress={() => setDraft((cur) => cur.map((r) => (r.id === row.id ? { ...r, visible: !r.visible } : r)))}
                hitSlop={8}
                style={[styles.visibilityPill, row.visible ? styles.visibilityOn : styles.visibilityOff]}
              >
                <Text style={{ color: colors.text, fontSize: typography.size.xs, fontWeight: '700' }}>
                  {row.visible ? t('dashboardCustomize.visible') : t('dashboardCustomize.hidden')}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSave} loading={saving} />
      <SecondaryButton title={t('dashboardCustomize.advancedEditor')} onPress={handleAdvanced} />
      <SecondaryButton title={t('common.cancel')} onPress={onClose} />
    </ModalSheet>
  );
}

const styles = {
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  arrowColumn: {
    flexDirection: 'row' as const,
  },
  arrowButton: {
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  arrowGlyph: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  arrowGlyphDisabled: {
    color: colors.muted,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: typography.size.sm,
    marginStart: spacing.xs,
  },
  visibilityPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    marginStart: spacing.sm,
  },
  visibilityOn: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  visibilityOff: {
    backgroundColor: 'rgba(139,147,167,0.15)',
  },
};
