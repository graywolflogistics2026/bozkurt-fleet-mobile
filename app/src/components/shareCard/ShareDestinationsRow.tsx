import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SHARE_DESTINATIONS, type ShareDestination } from '@/src/components/shareCard/shareDestinations';
import { colors, spacing, typography } from '@/src/theme';

function DestinationButton({
  label,
  monogram,
  bg,
  fg,
  disabled,
  onPress,
}: {
  label: string;
  monogram: string;
  bg: string;
  fg: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ alignItems: 'center', opacity: disabled ? 0.5 : 1 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: fg, fontWeight: '700', fontSize: typography.size.sm }}>{monogram}</Text>
      </View>
      <Text style={{ marginTop: 4, fontSize: typography.size.xs, color: colors.muted }}>{label}</Text>
    </Pressable>
  );
}

// UX MEGA-PASS item F: the shared destinations row for every share-card
// screen — extracted from share-profit.tsx so the AI Coach briefing and
// Scorecard screens render the identical row (including the 3 new
// destinations: WhatsApp, SMS/Messages, Copy Image) instead of each
// re-implementing it.
export function ShareDestinationsRow({
  disabled,
  onShare,
}: {
  disabled?: boolean;
  onShare: (dest: ShareDestination & { label: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {SHARE_DESTINATIONS.map((dest) => (
        <DestinationButton
          key={dest.key}
          label={t(`shareProfit.destinations.${dest.key}`)}
          monogram={dest.monogram}
          bg={dest.bg}
          fg={dest.fg}
          disabled={disabled}
          onPress={() => onShare({ ...dest, label: t(`shareProfit.destinations.${dest.key}`) })}
        />
      ))}
      <DestinationButton
        key="more"
        label={t('shareProfit.destinations.more')}
        monogram="•••"
        bg={colors.card2}
        fg={colors.text}
        disabled={disabled}
        onPress={() => onShare({ key: 'more', monogram: '•••', bg: colors.card2, fg: colors.text, label: t('shareProfit.destinations.more') })}
      />
    </View>
  );
}
