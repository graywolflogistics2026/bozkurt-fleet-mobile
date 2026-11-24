import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { AiConsentText } from '@/src/components/AiConsentText';
import { ErrorText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// AI CONSENT GATE (owner decision 2026-11-23, App Store guideline 5.1.2(i);
// docs/decisions/ai-consent-proposal.md, §89). First launch, after the ToS
// gate and before the tutorial; every existing user sees it once. Both
// answers are recorded (src/ai/aiConsent.ts consentWrite), so it is not
// shown again until the consent text version changes. "Not now" never
// blocks the app: everything except AI keeps working, and each AI feature
// asks again with the just-in-time sheet (AiConsentProvider.tsx).
// The root redirect (src/navigation/rootRedirect.ts) leaves this screen as
// soon as needsAiConsent turns false.
export default function AiConsent() {
  const { t } = useTranslation();
  const { saveAiConsent, signOut } = useAuth();
  const [saving, setSaving] = useState<'allow' | 'notNow' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(allow: boolean) {
    setError(null);
    setSaving(allow ? 'allow' : 'notNow');
    const { error: saveError } = await saveAiConsent(allow);
    setSaving(null);
    if (saveError) setError(t('aiConsent.saveFailed'));
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700', marginBottom: spacing.sm }}>{t('aiConsent.title')}</Text>
      <ScrollView
        style={{
          flex: 1,
          marginVertical: spacing.md,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 10,
        }}
        contentContainerStyle={{ padding: spacing.md }}
      >
        <AiConsentText />
      </ScrollView>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('aiConsent.allow')} onPress={() => answer(true)} loading={saving === 'allow'} disabled={saving !== null} />
      <SecondaryButton title={t('aiConsent.notNow')} onPress={() => answer(false)} loading={saving === 'notNow'} disabled={saving !== null} />
      <Text onPress={() => signOut()} style={{ color: colors.muted, marginTop: spacing.md, textAlign: 'center', fontSize: typography.size.sm }}>
        {t('tos.signOutInstead')}
      </Text>
    </View>
  );
}
