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
      <Stack.Screen name="trucks" options={{ title: t('nav.trucks') }} />
      <Stack.Screen name="drivers" options={{ title: t('nav.drivers') }} />
      <Stack.Screen name="loans" options={{ title: t('nav.loans') }} />
      <Stack.Screen name="credit-cards" options={{ title: t('nav.creditCards') }} />
      <Stack.Screen name="bank-statements" options={{ title: t('nav.bankStatements') }} />
      <Stack.Screen name="loads" options={{ title: t('nav.loads') }} />
      <Stack.Screen name="settlements" options={{ title: t('nav.settlements') }} />
      <Stack.Screen name="reimbursements" options={{ title: t('nav.reimbursements') }} />
      <Stack.Screen name="other-income" options={{ title: t('nav.otherIncome') }} />
      <Stack.Screen name="fuel" options={{ title: t('nav.fuel') }} />
      <Stack.Screen name="tolls" options={{ title: t('nav.tolls') }} />
      <Stack.Screen name="asset-register" options={{ title: t('nav.assetRegister') }} />
      <Stack.Screen name="operating-pnl" options={{ title: t('nav.operatingPnl') }} />
      <Stack.Screen name="profit-analysis" options={{ title: t('nav.profitAnalysis') }} />
      <Stack.Screen name="share-profit" options={{ title: t('nav.shareProfit') }} />
      <Stack.Screen name="dashboard-customize" options={{ title: t('nav.dashboardCustomize') }} />
      <Stack.Screen name="tax-estimator" options={{ title: t('nav.taxEstimator') }} />
      <Stack.Screen name="settings" options={{ title: t('nav.settings') }} />
      <Stack.Screen name="import-legacy" options={{ title: t('nav.importLegacy') }} />
    </Stack>
  );
}
