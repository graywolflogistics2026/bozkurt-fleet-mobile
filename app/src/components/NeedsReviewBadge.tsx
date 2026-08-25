import type { ViewStyle } from 'react-native';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, typography } from '@/src/theme';

// BETA FEEDBACK ROUND 2 (owner decision 2026-07-31): the one shared
// "needs review" visual treatment every row/screen uses — a row wrapper
// with an amber left border (`needsReviewRowStyle`) plus a small "Needs
// review" chip (`NeedsReviewChip`). Amber/orange (not red) on purpose:
// red already means "expense/cost/negative" everywhere else in this app
// (deduction amounts, cost-per-mile, etc.) — reusing it here would read
// as an error rather than "please confirm this." `borderStartWidth`/
// `borderStartColor` (logical, not `borderLeftWidth`) per CLAUDE.md
// invariant #11's RTL rule — Arabic renders this as a trailing (right)
// border automatically, no separate RTL branch needed.
export function needsReviewRowStyle(needsReview: boolean): ViewStyle | undefined {
  if (!needsReview) return undefined;
  return {
    borderStartWidth: 3,
    borderStartColor: colors.orange,
    paddingStart: spacing.sm,
  };
}

export function NeedsReviewChip() {
  const { t } = useTranslation();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: radii.sm,
        backgroundColor: 'rgba(245,158,11,0.15)',
        borderWidth: 1,
        borderColor: colors.orange,
        marginTop: 2,
      }}
    >
      <Text style={{ color: colors.orange, fontSize: typography.size.xs, fontWeight: '700' }}>
        {t('needsReview.badge')}
      </Text>
    </View>
  );
}

// NEEDS REVIEW WON'T CLEAR — THE FIX (owner decision 2026-08-24, device
// testing round): the one explicit "Mark reviewed" control every screen's
// row/detail-view uses — src/data/needsReviewMutations.ts is the only
// thing that ever writes `reviewed_at`. `isPending` shows a brief
// "Reviewed ✓" confirmation state while the mutation is in flight; once it
// resolves and the row's own needsReview flag flips false, the caller
// stops rendering this control (and the chip/border above it) entirely —
// there is no separate persistent "already reviewed" visual, since a
// reviewed row simply stops looking flagged at all.
export function MarkReviewedButton({ onPress, isPending }: { onPress: () => void; isPending?: boolean }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={isPending}
      hitSlop={8}
      style={{
        alignSelf: 'flex-start',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radii.sm,
        backgroundColor: isPending ? 'rgba(34,197,94,0.15)' : 'rgba(37,99,235,0.15)',
        borderWidth: 1,
        borderColor: isPending ? colors.green : colors.accent,
        marginTop: 4,
      }}
    >
      <Text style={{ color: isPending ? colors.green : colors.accent, fontSize: typography.size.xs, fontWeight: '700' }}>
        {isPending ? t('needsReview.reviewedConfirm') : t('needsReview.markReviewedButton')}
      </Text>
    </Pressable>
  );
}
