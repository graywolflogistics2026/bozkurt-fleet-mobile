import { Stack } from 'expo-router';
import { colors } from '@/src/theme';

export default function MoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'More' }} />
      <Stack.Screen name="capital-account" options={{ title: 'Capital Account' }} />
      <Stack.Screen name="cash-flow" options={{ title: 'Cash Flow' }} />
      <Stack.Screen name="maintenance" options={{ title: 'Maintenance' }} />
      <Stack.Screen name="loans" options={{ title: 'Loans' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
