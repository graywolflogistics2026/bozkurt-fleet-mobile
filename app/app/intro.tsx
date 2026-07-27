import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { setIntroSeen } from '@/src/onboarding/introStorage';
import { BRAND_EMOJI } from '@/src/brand';
import { colors, radii, spacing, typography } from '@/src/theme';

const SLIDE_KEYS = ['slide1', 'slide2', 'slide3'] as const;

// Session 9e-B9: 2-3 brand intro slides shown once before sign-up (see
// app/_layout.tsx's RootLayoutNav — introSeen gates the redirect to here
// vs. straight to /(auth)/sign-in). The existing 10-step onboarding
// wizard (app/onboarding.tsx, post-signup) is untouched — this screen is
// purely a first-impression marketing intro, no account/data setup here.
export default function Intro() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  }

  async function goToAuth(path: '/(auth)/sign-up' | '/(auth)/sign-in') {
    await setIntroSeen();
    router.replace(path);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable onPress={() => goToAuth('/(auth)/sign-in')} style={{ alignSelf: 'flex-end', padding: spacing.lg }} hitSlop={8}>
        <Text style={{ color: colors.muted, fontSize: typography.size.sm, fontWeight: '600' }}>{t('introSlides.skip')}</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {SLIDE_KEYS.map((key) => (
          <View key={key} style={{ width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}>
            <Text style={{ fontSize: 64, marginBottom: spacing.xl }}>{BRAND_EMOJI}</Text>
            <Text style={{ color: colors.text, fontSize: typography.size.xl, fontWeight: '800', textAlign: 'center', marginBottom: spacing.sm }}>
              {t(`introSlides.${key}Title`)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: typography.size.md, textAlign: 'center' }}>{t(`introSlides.${key}Body`)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.lg }}>
        {SLIDE_KEYS.map((key, i) => (
          <View
            key={key}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i === index ? colors.accent : colors.border,
            }}
          />
        ))}
      </View>

      <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}>
        <Pressable
          onPress={() => goToAuth('/(auth)/sign-up')}
          style={{
            backgroundColor: colors.accent,
            borderRadius: radii.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: typography.size.md }}>{t('introSlides.getStarted')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
