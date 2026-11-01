import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { TOS_BODY, TOS_TITLE } from '@/src/config/termsOfUse';
import { canAcceptTos, isScrolledNearBottom, isScrollGateSatisfied } from '@/src/legal/tosScrollGate';
import { EstimateAcknowledgmentText } from '@/src/components/EstimateBanner';
import { PrimaryButton, ErrorText, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// PROMPTS.md Session 3 / CLAUDE.md invariant #8: this screen is a hard gate —
// no navigation away except by accepting. Scrolling to the bottom is
// required before Accept enables. CLAUDE.md item 4 (multi-language, owner
// decision 2026-07-09): legal documents are NOT translated — TOS_TITLE/
// TOS_BODY stay English-only until attorney review; only the screen's own
// chrome (hint, buttons) is localized.
//
// 2026-07-30 tablet bug fix: Accept used to do nothing on a tablet with no
// visible error — see src/legal/tosScrollGate.ts's own comment for the
// scroll-gate root cause (content fitting the viewport with no scroll
// event ever firing) and AuthContext.acceptTos() for the write-side fix
// (upsert instead of update, so a not-yet-created profiles row — a real
// race with the sign-up trigger — no longer silently no-ops).
export default function Tos() {
  const { t } = useTranslation();
  const { acceptTos, signOut } = useAuth();
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Batch D item 10: required "I understand" checkbox (never pre-ticked).
  const [understood, setUnderstood] = useState(false);

  const gateSatisfied = isScrollGateSatisfied({ scrolledToEnd, containerHeight, contentHeight });
  const canContinue = canAcceptTos({ understood, scrollGateSatisfied: gateSatisfied });

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (isScrolledNearBottom({ layoutHeight: layoutMeasurement.height, contentOffsetY: contentOffset.y, contentHeight: contentSize.height })) {
      setScrolledToEnd(true);
    }
  }

  async function onAccept() {
    setError(null);
    setLoading(true);
    try {
      const { error } = await acceptTos();
      if (error) setError(error);
    } catch (err) {
      // Belt-and-suspenders (2026-07-30): acceptTos() already catches
      // internally and never throws, but a failure path must never be
      // silent even if that contract is ever broken by a future change.
      setError(err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '700', marginBottom: spacing.sm }}>
        {t('estimate.ack.title')}
      </Text>
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
        onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentHeight(h)}
      >
        <EstimateAcknowledgmentText textColor={colors.text} />
        <Text style={{ color: colors.text, fontSize: typography.size.lg, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.xs }}>{TOS_TITLE}</Text>
        <Text style={{ color: colors.text, fontSize: typography.size.sm, lineHeight: 20 }}>{TOS_BODY}</Text>
      </ScrollView>
      <Pressable
        onPress={() => setUnderstood((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: understood }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: understood ? colors.accent : colors.text,
            backgroundColor: understood ? colors.accent : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {understood && <Text style={{ color: colors.text, fontWeight: '900' }}>✓</Text>}
        </View>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{t('estimate.ack.checkbox')}</Text>
      </Pressable>
      {!canContinue && <MutedText style={{ marginBottom: spacing.xs }}>{gateSatisfied ? t('estimate.ack.checkFirst') : t('tos.scrollHint')}</MutedText>}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('estimate.ack.continue')} onPress={onAccept} loading={loading} disabled={!canContinue} />
      <Text
        onPress={() => signOut()}
        style={{ color: colors.muted, marginTop: spacing.md, textAlign: 'center', fontSize: typography.size.sm }}
      >
        {t('tos.signOutInstead')}
      </Text>
    </View>
  );
}
