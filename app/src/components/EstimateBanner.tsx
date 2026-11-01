import { useState } from 'react';
import { Pressable, Text, View, useColorScheme } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { BRAND_NAME } from '@/src/brand';
import { ModalSheet, SecondaryButton } from '@/src/components/ui';
import { estimateBannerTokens, radii, spacing } from '@/src/theme';

// ESTIMATES ONLY - NOT TAX ADVICE (owner decision 2026-10-30, batch D item
// 10). ONE shared, non-dismissible banner for every tax/estimate screen.
// Meaning never rides on color alone: a vector warning icon + an UPPERCASE
// headline say "warning" too. Font sizes are plain sp values, so Android
// font scaling (dynamic type) applies; nothing is fixed-height, so long
// translations wrap on a phone and a tablet alike. The small LegalFootnote
// (src/components/ui.tsx) stays for minor screens.

export function useEstimateTokens() {
  const scheme = useColorScheme();
  return scheme === 'light' ? estimateBannerTokens.light : estimateBannerTokens.dark;
}

export function WarningIcon({ size = 26, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M12 2.5 1.5 21h21L12 2.5Z" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M12 9v5.5" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M12 17.6v.2" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
    </Svg>
  );
}

// Full banner. `note` adds one screen-specific line (e.g. "Forecast.
// Estimate only."). There is deliberately no close button.
export function EstimateBanner({ note }: { note?: string | null }) {
  const { t } = useTranslation();
  const tok = useEstimateTokens();
  const headline = t('estimate.headline');
  const body = t('estimate.body', { brand: BRAND_NAME });
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={[headline, note, body].filter(Boolean).join(' ')}
      style={{
        backgroundColor: tok.bg,
        borderColor: tok.border,
        borderWidth: 3,
        borderRadius: radii.md,
        padding: spacing.md,
        marginVertical: spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <WarningIcon color={tok.icon} />
        <Text style={{ flex: 1, color: tok.headline, fontSize: 18, fontWeight: '800', textTransform: 'uppercase' }}>{headline}</Text>
      </View>
      {!!note && <Text style={{ color: tok.body, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs }}>{note}</Text>}
      <Text style={{ color: tok.body, fontSize: 14, fontWeight: '600', lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

// One-line form (Home tax strip, AI Coach answers, weekly review). Tapping
// it opens the full text in a sheet so Home stays uncluttered.
export function EstimateStrip() {
  const { t } = useTranslation();
  const tok = useEstimateTokens();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('estimate.strip')}
        accessibilityHint={t('estimate.stripHint')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          backgroundColor: tok.bg,
          borderColor: tok.border,
          borderWidth: 2,
          borderRadius: radii.sm,
          paddingVertical: 6,
          paddingHorizontal: spacing.sm,
          marginVertical: spacing.xs,
        }}
      >
        <WarningIcon size={18} color={tok.icon} />
        <Text style={{ flex: 1, color: tok.headline, fontSize: 14, fontWeight: '800', textTransform: 'uppercase' }}>{t('estimate.strip')}</Text>
        <Text style={{ color: tok.headline, fontSize: 14, fontWeight: '800' }}>›</Text>
      </Pressable>
      <ModalSheet visible={open} onClose={() => setOpen(false)}>
        <EstimateBanner />
        <SecondaryButton title={t('common.close')} onPress={() => setOpen(false)} />
      </ModalSheet>
    </>
  );
}

// "Before you start" (batch D item 10): the banner plus three plain
// bullets. Shown on the acknowledgment gate (app/tos.tsx) and, word for
// word, under Settings -> Legal.
export const ESTIMATE_ACK_BULLETS = ['estimate.ack.bullet1', 'estimate.ack.bullet2', 'estimate.ack.bullet3'] as const;

export function EstimateAcknowledgmentText({ textColor }: { textColor: string }) {
  const { t } = useTranslation();
  return (
    <View>
      <EstimateBanner />
      {ESTIMATE_ACK_BULLETS.map((key) => (
        <View key={key} style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          <Text style={{ color: textColor, fontSize: 15, fontWeight: '800' }}>•</Text>
          <Text style={{ flex: 1, color: textColor, fontSize: 15, fontWeight: '600', lineHeight: 21 }}>{t(key)}</Text>
        </View>
      ))}
    </View>
  );
}
