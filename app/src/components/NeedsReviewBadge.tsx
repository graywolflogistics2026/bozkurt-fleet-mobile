import type { ViewStyle } from 'react-native';
import { Text, View } from 'react-native';
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
