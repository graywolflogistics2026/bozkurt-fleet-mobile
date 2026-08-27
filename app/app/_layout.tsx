import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments, usePathname, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { ActiveTruckProvider } from '@/src/context/ActiveTruckContext';
import { IntroProvider, useIntro } from '@/src/context/IntroContext';
import { LanguageGateProvider, useLanguageGate } from '@/src/context/LanguageGateContext';
import { queryClient, asyncStoragePersister } from '@/src/lib/queryClient';
import { useUsageTracking } from '@/src/data/usageTracking';
import { checkShouldShowLaunchIntro } from '@/src/launch/launchIntro';
import { LaunchIntroOverlay } from '@/src/components/LaunchIntroOverlay';
import { colors } from '@/src/theme';
import { initI18n } from '@/src/i18n';
import { resolveRootRedirect } from '@/src/navigation/rootRedirect';

// Startup diagnostics (2026-07-06): take manual control of the splash
// screen instead of relying on its default auto-hide, so a stuck startup
// promise can't leave the user staring at a native splash that already
// auto-hid into our OWN loading screen with no way to tell the two apart.
// AuthContext's getSession() bootstrap is now timeout-guarded (see
// withTimeout.ts) so `loading` is guaranteed to resolve within ~8s even if
// the storage layer hangs — hideAsync() below fires the moment it does.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    // Resolves the device/cached language and initializes i18next BEFORE any
    // screen renders, so no screen ever flashes the wrong language on boot
    // (owner decision 2026-07-09: device-language auto-detect with manual
    // override always winning afterwards).
    initI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) return <LoadingScreen />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister }}
      >
        <SafeAreaProvider>
          <AuthProvider>
            <ActiveTruckProvider>
              <LanguageGateProvider>
                <IntroProvider>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                </IntroProvider>
              </LanguageGateProvider>
            </ActiveTruckProvider>
          </AuthProvider>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

function RootLayoutNav() {
  const { session, loading, needsEmailConfirmation, needsTos, needsTutorial, needsOnboarding } = useAuth();
  const { introSeen } = useIntro();
  const { languageScreenSeen } = useLanguageGate();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const { trackScreenOpen } = useUsageTracking();
  const [launchIntroDecision, setLaunchIntroDecision] = useState<'pending' | 'show' | 'skip'>('pending');

  // ANIMATED BRAND INTRO — GATING (owner decision). Resolved exactly once
  // per component mount (which itself only ever happens once per cold
  // start, same as every other provider in this file) — never re-run on a
  // session change, language change, etc. See src/launch/launchIntro.ts's
  // own header comment for why a plain module-level flag (not
  // AsyncStorage) is what makes this correctly "cold start only, never on
  // return from background."
  useEffect(() => {
    let mounted = true;
    checkShouldShowLaunchIntro().then((show) => {
      if (mounted) setLaunchIntroDecision(show ? 'show' : 'skip');
    });
    return () => {
      mounted = false;
    };
  }, []);

  // USAGE ANALYTICS (owner decision, docs/PENDING_SQL.md §71) — ONE
  // navigation observer here covers every current and future screen
  // automatically ("which screens are actually used"), instead of
  // instrumenting each of the ~35 screen files by hand. Gated on
  // `!loading && session` so a signed-out visitor's pre-auth screens
  // (sign-in, sign-up, ...) are never attributed to a user id that
  // doesn't exist yet; `pathname` only changes on a REAL route change
  // (re-tapping the tab you're already on is a no-op), so this can never
  // double-fire for the same screen visit.
  useEffect(() => {
    if (loading || !session) return;
    trackScreenOpen(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, loading, session]);

  useEffect(() => {
    // ANIMATED BRAND INTRO: also wait for launchIntroDecision to resolve
    // (a fast native check, Linking/Notifications) before hiding the
    // native splash — this is what makes the handoff seamless: whichever
    // comes next (the intro overlay, matching the splash's own background/
    // mark position exactly, or the real app directly) is already known
    // and ready to render the INSTANT the splash disappears, never a gap
    // where stale/default content could flash underneath.
    if (loading || launchIntroDecision === 'pending') return;
    // Auth bootstrap is done (success or timeout-fallback) — safe to reveal
    // the app now. finally-equivalent: this fires no matter which path
    // AuthContext's loading=false came from.
    SplashScreen.hideAsync().catch(() => {});
  }, [loading, launchIntroDecision]);

  useEffect(() => {
    if (loading || introSeen === null || languageScreenSeen === null) return;
    const target = resolveRootRedirect({
      hasSession: !!session,
      languageScreenSeen,
      needsEmailConfirmation,
      needsTos,
      needsTutorial,
      needsOnboarding,
      introSeen,
      segment: segments[0] as string | undefined,
    });
    // "intro"/"tutorial"/"confirm-email"/"reset-password"/"language" aren't
    // in the last generated .expo/types/router.d.ts yet — same typed-routes
    // regen lag as _layout.tsx (tabs)'s ALERTS_ROUTE, hence the Href cast
    // rather than a general-purpose `any`.
    if (target) router.replace(target as Href);
  }, [session, loading, languageScreenSeen, needsEmailConfirmation, needsTos, needsTutorial, needsOnboarding, introSeen, segments, router]);

  if (loading || introSeen === null || languageScreenSeen === null || launchIntroDecision === 'pending') return <LoadingScreen />;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="language" />
        <Stack.Screen name="intro" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="confirm-email" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="tos" />
        <Stack.Screen name="tutorial" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      {/* ANIMATED BRAND INTRO — rendered as an OVERLAY on top of the
          already-mounted, already-navigating Stack (never in place of
          it) — this is what lets the existing redirect effect above keep
          working completely unchanged: the real destination screen is
          already rendering underneath by the time the overlay fades out
          a moment later, so there's no blank/loading flash at the
          handoff. */}
      {launchIntroDecision === 'show' && <LaunchIntroOverlay onFinish={() => setLaunchIntroDecision('skip')} />}
    </View>
  );
}
