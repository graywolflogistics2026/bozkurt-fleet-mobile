import { ActivityIndicator, I18nManager, Modal, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '@/src/theme';

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.screenInner}>{children}</View>
    </SafeAreaView>
  );
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

// BINDING UX DECISION (owner, 2026-07-04) — Dashboard is the hub: every
// stat card/section navigates somewhere, with a visible chevron affordance
// so it reads as tappable rather than purely informational (PROMPTS.md
// Session 5).
export function TappableCard({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.tappableCard, pressed && styles.buttonPressed]}
    >
      <View style={{ flex: 1 }}>{children}</View>
      <Text style={styles.chevron}>{I18nManager.isRTL ? '‹' : '›'}</Text>
    </Pressable>
  );
}

export function MutedText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function LegalFootnote({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return <Text style={styles.footnote}>{children ?? t('common.legalFootnote')}</Text>;
}

export function Field({ style, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      {...props}
      style={[styles.field, style]}
    />
  );
}

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
    >
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

// Reusable centered edit-sheet overlay (Session 7 Deductions edit sheet,
// Capital Account's record-draw/update-balance sheets, and future forms) —
// a lightweight equivalent of legacy's fixed-overlay modal pattern
// (legacy/index.html editDedItem()). Tapping outside the card closes it.
export function ModalSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sheetTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenInner: {
    flex: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.size.xl,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tappableCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevron: {
    color: colors.muted,
    fontSize: 22,
    marginStart: spacing.sm,
    fontWeight: '300',
  },
  muted: {
    color: colors.muted,
    fontSize: typography.size.sm,
  },
  footnote: {
    color: colors.muted,
    fontSize: typography.size.xs,
    marginTop: spacing.sm,
  },
  field: {
    backgroundColor: colors.card2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: typography.size.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  secondaryButton: {
    backgroundColor: colors.card2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: typography.size.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: typography.size.md,
  },
  error: {
    color: colors.red,
    fontSize: typography.size.sm,
    marginBottom: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
});
