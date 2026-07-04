import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { ActiveTruckProvider } from '@/src/context/ActiveTruckContext';
import { colors } from '@/src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ActiveTruckProvider>
          <StatusBar style="light" />
          <RootLayoutNav />
        </ActiveTruckProvider>
      </AuthProvider>
    </SafeAreaProvider>
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
  const { session, loading, needsTos } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onTosScreen = segments[0] === 'tos';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && needsTos && !onTosScreen) {
      router.replace('/tos');
    } else if (session && !needsTos && (inAuthGroup || onTosScreen)) {
      router.replace('/(tabs)');
    }
  }, [session, loading, needsTos, segments, router]);

  if (loading) return <LoadingScreen />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="tos" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
