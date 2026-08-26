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
import { IntroProvider, useIntro } from '@/src/context/IntroContext';
import { LanguageGateProvider, useLanguageGate } from '@/src/context/LanguageGateContext';
import { queryClient, asyncStoragePersister } from '@/src/lib/queryClient';
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
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // Auth bootstrap is done (success or timeout-fallback) — safe to reveal
    // the app now. finally-equivalent: this fires no matter which path
    // AuthContext's loading=false came from.
    SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

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

  if (loading || introSeen === null || languageScreenSeen === null) return <LoadingScreen />;

  return (
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
  );
}
