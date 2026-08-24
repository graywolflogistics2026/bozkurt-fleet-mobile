import {
  ActivityIndicator,
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
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

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// BINDING UX DECISION (owner, 2026-07-04) — Dashboard is the hub: every
// stat card/section navigates somewhere, with a visible chevron affordance
// so it reads as tappable rather than purely informational (PROMPTS.md
// Session 5).
export function TappableCard({
  onPress,
  children,
  style,
}: {
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.tappableCard, style, pressed && styles.buttonPressed]}
    >
      <View style={{ flex: 1 }}>{children}</View>
      <Text style={styles.chevron}>{I18nManager.isRTL ? '‹' : '›'}</Text>
    </Pressable>
  );
}

export function MutedText({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  return (
    <Text style={[styles.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
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

export function SecondaryButton({
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
        styles.secondaryButton,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>{title}</Text>}
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
//
// UX MEGA-PASS item B (owner decision 2026-07-31, device evidence:
// "deduction edit has no save/cancel/close and doesn't scroll and doesn't
// save"). Root cause: modalCard had no height cap and children were never
// wrapped in a ScrollView — on a sheet with enough content (category
// picker + tax-deductible pills + amount field + all 9 payment-method
// pills), the card grew taller than the viewport and the overlay's
// centered, non-scrolling layout simply clipped the overflow, so the Save/
// Cancel buttons at the bottom were rendered but physically unreachable —
// "doesn't save" was a symptom of "can't reach the Save button," not a
// mutation bug. Every ModalSheet now gets this fix for free, with zero
// call-site changes required: (1) content is capped to 85% of the window
// height and wrapped in a ScrollView, so it always scrolls instead of
// silently overflowing; (2) a consistent ✕ close button in the top-right
// corner, wired to the same onClose every call site already passes, so
// "every modal/sheet gets a consistent header: title + X close" holds
// without each screen adding its own; (3) KeyboardAvoidingView so an open
// keyboard (editing the amount/description field) never covers the Save
// button either.
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
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.modalCloseButton}
          >
            <Text style={styles.modalCloseButtonText}>✕</Text>
          </Pressable>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalScroll}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
    width: '100%',
    maxWidth: 400,
    maxHeight: '85%',
    position: 'relative',
  },
  modalScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + spacing.md,
    paddingBottom: spacing.lg,
  },
  modalCloseButton: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
    zIndex: 1,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card2,
  },
  modalCloseButtonText: {
    color: colors.muted,
    fontSize: typography.size.md,
    fontWeight: '700',
  },
  sheetTitle: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
});
