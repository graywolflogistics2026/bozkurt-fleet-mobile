import { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TUTORIAL_SLIDES } from '@/src/onboarding/tutorialSlides';
import { SLIDE_VISUALS } from '@/src/onboarding/slideVisuals';
import { PrimaryButton, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// FIRST-RUN TUTORIAL PAGER (owner decision 2026-08-05, FULL PARITY
// follow-up item I) — the ONE shared pager used both for the gated
// first-run flow (app/tutorial.tsx) and every replay entry point
// (Settings > "How it works", Import's empty state "See how" link, ...),
// so the walkthrough content/behavior can never drift between them.
//
// A plain horizontal ScrollView with pagingEnabled — swipe support comes
// for free from the native scroll view, no gesture library needed. NO
// autoplay/Animated/Reanimated usage anywhere in this component, which
// is what makes it reduced-motion-safe by construction: every page
// transition is 100% user-driven (a swipe or a tap on Next/a dot),
// there is no auto-advancing motion to respect a "reduce motion" OS
// setting for. Width comes from onLayout (not a hardcoded pixel value),
// so this scales cleanly from a phone to a tablet.
export type TutorialPagerProps = {
  onFinish: () => void;
};

export function TutorialPager({ onFinish }: TutorialPagerProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const isLast = index === TUTORIAL_SLIDES.length - 1;

  function goToIndex(next: number) {
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
    setIndex(next);
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!width) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(TUTORIAL_SLIDES.length - 1, next)));
  }

  function handleNext() {
    if (isLast) {
      onFinish();
      return;
    }
    goToIndex(index + 1);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Pressable
        onPress={onFinish}
        hitSlop={8}
        style={{ position: 'absolute', top: spacing.lg, right: spacing.lg, zIndex: 1, padding: spacing.xs }}
      >
        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: typography.size.sm }}>{t('tutorial.skip')}</Text>
      </Pressable>

      {width > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={{ flex: 1 }}
        >
          {TUTORIAL_SLIDES.map((slide) => {
            const Visual = SLIDE_VISUALS[slide.id];
            const visualSize = Math.min(220, width * 0.55);
            return (
              <View key={slide.id} style={{ width, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
                <Visual size={visualSize} />
                <Text
                  style={{
                    color: colors.text,
                    fontSize: typography.size.xl,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginTop: spacing.xl,
                    marginBottom: spacing.sm,
                  }}
                >
                  {t(slide.titleKey)}
                </Text>
                <MutedText style={{ textAlign: 'center', fontSize: typography.size.md, maxWidth: 440 }}>
                  {t(slide.bodyKey)}
                </MutedText>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: spacing.lg }}>
        {TUTORIAL_SLIDES.map((slide, i) => (
          <Pressable key={slide.id} onPress={() => goToIndex(i)} hitSlop={8} style={{ padding: spacing.xs }}>
            <View
              style={{
                width: i === index ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === index ? colors.accent : colors.border,
              }}
            />
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}>
        <PrimaryButton title={isLast ? t('tutorial.done') : t('tutorial.next')} onPress={handleNext} />
      </View>
    </View>
  );
}
