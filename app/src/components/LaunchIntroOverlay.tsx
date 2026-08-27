import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { BrandLogo } from '@/src/components/BrandLogo';
import { BRAND_NAME, BRAND_TAGLINE } from '@/src/brand';
import { colors, spacing } from '@/src/theme';

// ANIMATED BRAND INTRO (owner decision) — a short (~1.5s, within the
// requested 1.2-1.8s window), one-time-per-cold-start sequence shown right
// after the native splash hands off (see app/_layout.tsx's own gating —
// this component only ever mounts once checkShouldShowLaunchIntro() has
// already resolved 'show', so every "should this even run" decision has
// already been made before this file is ever reached).
//
// HANDOFF CONTINUITY, an explicit design call (stated plainly, not
// glossed over): the native splash (assets/images/splash-icon.png) is a
// STATIC image showing the mark AND the wordmark already fully visible,
// together — there is no way for a static PNG to stage a reveal. Making
// the wordmark "rise beneath [the mark] with a soft fade" therefore can't
// be BOTH a genuine staged reveal AND bit-identical to the splash's own
// last frame at the same instant — those two asks are in real tension.
// This resolves it the way real apps commonly do: the MARK stays
// visually continuous across the handoff (starts already mostly opaque
// and full-size, only a very subtle scale-settle — background color and
// mark position/size never change, so there is no color flash and no
// jump), while the WORDMARK and TAGLINE perform the actual staged
// entrance the request describes — a deliberate "replay" flourish that
// reads as intentional motion, not a glitch, exactly because the
// background/position never move under it.
//
// REDUCED MOTION: `useReducedMotion()` (reanimated 3.5+, no extra
// dependency) — fade only, no scale and no translateY, on every element,
// same overall stage TIMING either way so the total duration stays
// consistent regardless of the setting.
export function LaunchIntroOverlay({ onFinish }: { onFinish: () => void }) {
  const reducedMotion = useReducedMotion();

  const markOpacity = useSharedValue(reducedMotion ? 0 : 0.6);
  const markScale = useSharedValue(reducedMotion ? 1 : 0.94);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkTranslateY = useSharedValue(reducedMotion ? 0 : 14);
  const taglineOpacity = useSharedValue(0);
  const containerOpacity = useSharedValue(1);
  const containerScale = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);

    markOpacity.value = withTiming(1, { duration: 420, easing: ease });
    markScale.value = withTiming(1, { duration: 460, easing: ease });

    wordmarkOpacity.value = withDelay(200, withTiming(1, { duration: 400, easing: ease }));
    wordmarkTranslateY.value = withDelay(200, withTiming(0, { duration: 400, easing: ease }));

    taglineOpacity.value = withDelay(520, withTiming(1, { duration: 340, easing: ease }));

    // Hold everything visible together briefly (520 + 340 = 860ms mark the
    // tagline's own finish; outro starts at 1100ms), then ease the whole
    // block out into the real app underneath. finishOnJs only fires once,
    // off the LAST animation to complete, so onFinish is called exactly
    // once regardless of how many shared values are animating.
    function finishOnJs(finished?: boolean) {
      'worklet';
      if (finished) runOnJS(onFinish)();
    }

    containerOpacity.value = withDelay(1100, withTiming(0, { duration: 400, easing: Easing.in(Easing.cubic) }, finishOnJs));
    if (!reducedMotion) {
      containerScale.value = withDelay(1100, withTiming(1.03, { duration: 400, easing: Easing.in(Easing.cubic) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ scale: containerScale.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkTranslateY.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  return (
    <Animated.View style={[styles.overlay, containerStyle]} pointerEvents="none">
      <Animated.View style={markStyle}>
        <BrandLogo size={96} />
      </Animated.View>
      <Animated.View style={[styles.wordmarkWrap, wordmarkStyle]}>
        <Text style={styles.wordmark}>{BRAND_NAME}</Text>
      </Animated.View>
      <Animated.View style={taglineStyle}>
        <Text style={styles.tagline}>{BRAND_TAGLINE}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  wordmarkWrap: {
    marginTop: spacing.md,
  },
  wordmark: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  tagline: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
