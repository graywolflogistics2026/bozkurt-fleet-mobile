import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { TOS_BODY, TOS_TITLE } from '@/src/config/termsOfUse';
import { PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// PROMPTS.md Session 3 / CLAUDE.md invariant #8: this screen is a hard gate —
// no navigation away except by accepting. Scrolling to the bottom is
// required before Accept enables. CLAUDE.md item 4 (multi-language, owner
// decision 2026-07-09): legal documents are NOT translated — TOS_TITLE/
// TOS_BODY stay English-only until attorney review; only the screen's own
// chrome (hint, buttons) is localized.
export default function Tos() {
  const { t } = useTranslation();
  const { acceptTos, signOut } = useAuth();
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) {
      setScrolledToEnd(true);
    }
  }

  async function onAccept() {
    setError(null);
    setLoading(true);
    const { error } = await acceptTos();
    setLoading(false);
    if (error) setError(error);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700', marginBottom: spacing.sm }}>
        {TOS_TITLE}
      </Text>
      <MutedText>{t('tos.scrollHint')}</MutedText>
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
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Text style={{ color: colors.text, fontSize: typography.size.sm, lineHeight: 20 }}>{TOS_BODY}</Text>
      </ScrollView>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('tos.accept')} onPress={onAccept} loading={loading} disabled={!scrolledToEnd} />
      <Text
        onPress={() => signOut()}
        style={{ color: colors.muted, marginTop: spacing.md, textAlign: 'center', fontSize: typography.size.sm }}
      >
        {t('tos.signOutInstead')}
      </Text>
    </View>
  );
}
