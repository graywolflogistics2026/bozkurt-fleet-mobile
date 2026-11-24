// ROW DELETE MARK (owner 2026-11-24): the red ✕ that deletes one list
// row, placed in the row's TOP-RIGHT corner with a 44x44 dp touch target
// and an accessibility label. Purely presentational: it calls the
// screen's own onDelete, so every existing delete confirmation stays
// exactly as it was. Put it as the LAST child of a row whose style is
// flexDirection 'row' + alignItems 'flex-start'; the negative margins
// pull the target into the corner without making the row taller.
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '@/src/theme';

export function RowDeleteButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('common.delete')}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: -spacing.sm,
        marginEnd: -spacing.sm,
        marginStart: spacing.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: colors.red, fontSize: typography.size.lg, fontWeight: '700' }}>✕</Text>
    </Pressable>
  );
}
