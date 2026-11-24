import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { hasAiConsent } from '@/src/ai/aiConsent';
import { registerAiConsentGate } from '@/src/ai/aiConsentGate';
import { AiConsentText } from '@/src/components/AiConsentText';
import { ErrorText, ModalSheet, PrimaryButton, SecondaryButton, SheetTitle } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// AI CONSENT — JUST-IN-TIME SHEET (owner decision 2026-11-23). Mounted once
// at the app root. Registers the consent gate (src/ai/aiConsentGate.ts):
// every AI call asks it first, and when consent is missing (Not now at the
// first-launch gate, or turned off in Settings > Privacy) this sheet asks
// again with the same text. Allow saves the consent; Cancel sends nothing
// and records nothing (the user already answered the gate).
export function AiConsentProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { aiConsent, saveAiConsent } = useAuth();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((allowed: boolean) => void) | null>(null);
  // Read through a ref so the registered gate always sees the latest state.
  const grantedRef = useRef(hasAiConsent(aiConsent));
  grantedRef.current = hasAiConsent(aiConsent);

  useEffect(
    () =>
      registerAiConsentGate({
        isGranted: () => grantedRef.current,
        prompt: () =>
          new Promise<boolean>((resolve) => {
            resolveRef.current = resolve;
            setError(null);
            setVisible(true);
          }),
      }),
    []
  );

  function finish(allowed: boolean) {
    setVisible(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(allowed);
  }

  async function onAllow() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await saveAiConsent(true);
    setSaving(false);
    if (saveError) {
      setError(t('aiConsent.saveFailed'));
      return;
    }
    finish(true);
  }

  return (
    <>
      {children}
      <ModalSheet visible={visible} onClose={() => finish(false)}>
        <SheetTitle>{t('aiConsent.title')}</SheetTitle>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md, marginBottom: spacing.sm }}>{t('aiConsent.sheetLead')}</Text>
        <ScrollView style={{ maxHeight: 360 }}>
          <AiConsentText />
        </ScrollView>
        <ErrorText>{error}</ErrorText>
        <PrimaryButton title={t('aiConsent.allow')} onPress={onAllow} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => finish(false)} disabled={saving} />
      </ModalSheet>
    </>
  );
}
