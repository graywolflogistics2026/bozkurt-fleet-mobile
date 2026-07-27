import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { ActiveTruckProvider } from '@/src/context/ActiveTruckContext';
import { queryClient, asyncStoragePersister } from '@/src/lib/queryClient';
import { colors } from '@/src/theme';
import { initI18n } from '@/src/i18n';
import { getIntroSeen } from '@/src/onboarding/introStorage';

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
              <StatusBar style="light" />
              <RootLayoutNav />
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
  const { session, loading, needsTos, needsOnboarding } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // Session 9e-B9: brand intro slides, shown once per device before the
  // very first sign-in/sign-up — null means "not resolved yet" (same
  // pattern i18nReady above uses), so the redirect effect waits for it
  // rather than flashing sign-in first.
  const [introSeen, setIntroSeenState] = useState<boolean | null>(null);

  useEffect(() => {
    getIntroSeen().then(setIntroSeenState);
  }, []);

  useEffect(() => {
    if (loading) return;
    // Auth bootstrap is done (success or timeout-fallback) — safe to reveal
    // the app now. finally-equivalent: this fires no matter which path
    // AuthContext's loading=false came from.
    SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  useEffect(() => {
    if (loading || introSeen === null) return;

    // "intro" (app/intro.tsx, added this pass) isn't in the last generated
    // .expo/types/router.d.ts yet — same typed-routes regen lag as
    // _layout.tsx (tabs)'s ALERTS_ROUTE, hence the (string) cast/Href cast
    // rather than a general-purpose `any`.
    const currentSegment = segments[0] as string;
    const inAuthGroup = currentSegment === '(auth)';
    const onTosScreen = currentSegment === 'tos';
    const onOnboardingScreen = currentSegment === 'onboarding';
    const onIntroScreen = currentSegment === 'intro';

    if (!session && !introSeen && !onIntroScreen) {
      router.replace('/intro' as Href);
    } else if (!session && !inAuthGroup && !onIntroScreen) {
      router.replace('/(auth)/sign-in');
    } else if (session && needsTos && !onTosScreen) {
      router.replace('/tos');
    } else if (session && !needsTos && needsOnboarding && !onOnboardingScreen) {
      router.replace('/onboarding');
    } else if (session && !needsTos && !needsOnboarding && (inAuthGroup || onTosScreen || onOnboardingScreen || onIntroScreen)) {
      router.replace('/(tabs)');
    }
  }, [session, loading, needsTos, needsOnboarding, introSeen, segments, router]);

  if (loading || introSeen === null) return <LoadingScreen />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="intro" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="tos" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
