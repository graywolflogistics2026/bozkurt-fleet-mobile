import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PRIVACY_BODY, PRIVACY_TITLE } from '@/src/config/privacyPolicy';
import { colors, spacing, typography } from '@/src/theme';

// AI CONSENT TEXT (owner decision 2026-11-23, App Store 5.1.2(i)): what is
// sent, to whom, and how to turn it off. One component for the first-launch
// gate (app/ai-consent.tsx) and the just-in-time sheet
// (AiConsentProvider.tsx), so the two can never say different things.
// No "does not train" and no retention claim (owner decision 5) until the
// attorney confirms Anthropic's terms. The Privacy Policy opens inline: the
// gate screen cannot navigate to the tabs' policy screen while it is open.
export function AiConsentText() {
  const { t } = useTranslation();
  const [showPrivacy, setShowPrivacy] = useState(false);
  const line = { color: colors.text, fontSize: typography.size.md, lineHeight: 22 } as const;

  return (
    <View>
      <Text style={line}>{t('aiConsent.intro')}</Text>
      {(['bulletDocs', 'bulletNumbers', 'bulletQuestions'] as const).map((key) => (
        <Text key={key} style={[line, { marginTop: spacing.xs, paddingStart: spacing.sm }]}>
          • {t(`aiConsent.${key}`)}
        </Text>
      ))}
      <Text style={[line, { marginTop: spacing.md }]}>{t('aiConsent.processing')}</Text>
      <Text style={[line, { marginTop: spacing.xs, fontWeight: '700' }]}>{t('aiConsent.noSale')}</Text>
      <Text style={[line, { marginTop: spacing.xs }]}>{t('aiConsent.withdraw')}</Text>
      <Text
        onPress={() => setShowPrivacy((v) => !v)}
        accessibilityRole="button"
        style={{ color: colors.accent, fontWeight: '700', marginTop: spacing.md, fontSize: typography.size.md }}
      >
        {showPrivacy ? t('aiConsent.hidePrivacy') : t('aiConsent.readPrivacy')}
      </Text>
      {showPrivacy && (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{PRIVACY_TITLE}</Text>
          <Text style={{ color: colors.muted, fontSize: typography.size.sm, lineHeight: 20 }}>{PRIVACY_BODY}</Text>
        </View>
      )}
    </View>
  );
}
