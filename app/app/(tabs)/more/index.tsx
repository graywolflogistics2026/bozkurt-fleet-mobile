import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

const MENU_ITEMS = [
  { href: '/(tabs)/more/loads', labelKey: 'more.loads', emoji: '🚛' },
  { href: '/(tabs)/more/settlements', labelKey: 'more.settlements', emoji: '📋' },
  { href: '/(tabs)/more/reimbursements', labelKey: 'more.reimbursements', emoji: '↩️' },
  { href: '/(tabs)/more/other-income', labelKey: 'more.otherIncome', emoji: '💵' },
  { href: '/(tabs)/more/fuel', labelKey: 'more.fuel', emoji: '⛽' },
  { href: '/(tabs)/more/tolls', labelKey: 'more.tolls', emoji: '🛣️' },
  { href: '/(tabs)/more/asset-register', labelKey: 'more.assetRegister', emoji: '🗄️' },
  { href: '/(tabs)/more/capital-account', labelKey: 'more.capitalAccount', emoji: '💰' },
  { href: '/(tabs)/more/operating-pnl', labelKey: 'more.operatingPnl', emoji: '📊' },
  { href: '/(tabs)/more/profit-analysis', labelKey: 'more.profitAnalysis', emoji: '📈' },
  { href: '/(tabs)/more/ceo-mode', labelKey: 'more.ceoMode', emoji: '🐺' },
  { href: '/(tabs)/more/ai-advisor', labelKey: 'more.aiAdvisor', emoji: '🤖' },
  { href: '/(tabs)/more/share-profit', labelKey: 'more.shareProfit', emoji: '📤' },
  { href: '/(tabs)/more/tax-estimator', labelKey: 'more.taxEstimator', emoji: '🧮' },
  { href: '/(tabs)/more/cash-flow', labelKey: 'more.cashFlow', emoji: '🏦' },
  { href: '/(tabs)/more/maintenance', labelKey: 'more.maintenance', emoji: '🔧' },
  { href: '/(tabs)/more/trucks', labelKey: 'more.trucks', emoji: '🚚' },
  { href: '/(tabs)/more/drivers', labelKey: 'more.drivers', emoji: '🧑‍✈️' },
  { href: '/(tabs)/more/loans', labelKey: 'more.loans', emoji: '📄' },
  { href: '/(tabs)/more/credit-cards', labelKey: 'more.creditCards', emoji: '💳' },
  { href: '/(tabs)/more/bank-statements', labelKey: 'more.bankStatements', emoji: '🏛️' },
  { href: '/(tabs)/more/dashboard-customize', labelKey: 'more.dashboardCustomize', emoji: '🧩' },
  { href: '/(tabs)/more/compliance', labelKey: 'more.compliance', emoji: '🪪' },
  { href: '/(tabs)/more/accountant-package', labelKey: 'more.accountantPackage', emoji: '📁' },
  { href: '/(tabs)/more/settings', labelKey: 'more.settings', emoji: '⚙️' },
] as const;

export default function More() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href)}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radii.md,
              padding: spacing.md,
              flexDirection: 'row',
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 18, marginEnd: spacing.md }}>{item.emoji}</Text>
            <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>
              {t(item.labelKey)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
