import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { TOS_BODY, TOS_TITLE } from '@/src/config/termsOfUse';
import { isScrolledNearBottom, isScrollGateSatisfied } from '@/src/legal/tosScrollGate';
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

  const gateSatisfied = isScrollGateSatisfied({ scrolledToEnd, containerHeight, contentHeight });

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
        {TOS_TITLE}
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
        <Text style={{ color: colors.text, fontSize: typography.size.sm, lineHeight: 20 }}>{TOS_BODY}</Text>
      </ScrollView>
      {!gateSatisfied && <MutedText style={{ marginBottom: spacing.xs }}>{t('tos.scrollHint')}</MutedText>}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton title={t('tos.accept')} onPress={onAccept} loading={loading} disabled={!gateSatisfied} />
      <Text
        onPress={() => signOut()}
        style={{ color: colors.muted, marginTop: spacing.md, textAlign: 'center', fontSize: typography.size.sm }}
      >
        {t('tos.signOutInstead')}
      </Text>
    </View>
  );
}
