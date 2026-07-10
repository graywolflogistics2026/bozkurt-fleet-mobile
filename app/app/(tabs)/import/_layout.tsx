import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/theme';

export default function ImportLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.accent,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('nav.import'), headerShown: false }} />
      <Stack.Screen name="camera" options={{ title: t('nav.takePhoto'), presentation: 'modal' }} />
    </Stack>
  );
}
