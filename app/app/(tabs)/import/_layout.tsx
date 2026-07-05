import { Stack } from 'expo-router';
import { colors } from '@/src/theme';

export default function ImportLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Import', headerShown: false }} />
      <Stack.Screen name="camera" options={{ title: 'Take Photo', presentation: 'modal' }} />
    </Stack>
  );
}
