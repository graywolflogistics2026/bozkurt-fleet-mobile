import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/src/theme';

export default function MoreLayout() {
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
      <Stack.Screen name="index" options={{ title: t('nav.more') }} />
      <Stack.Screen name="capital-account" options={{ title: t('nav.capitalAccount') }} />
      <Stack.Screen name="cash-flow" options={{ title: t('nav.cashFlow') }} />
      <Stack.Screen name="maintenance" options={{ title: t('nav.maintenance') }} />
      <Stack.Screen name="loans" options={{ title: t('nav.loans') }} />
      <Stack.Screen name="tax-estimator" options={{ title: t('nav.taxEstimator') }} />
      <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
      <Stack.Screen name="import-legacy" options={{ title: t('nav.importLegacy') }} />
    </Stack>
  );
}
