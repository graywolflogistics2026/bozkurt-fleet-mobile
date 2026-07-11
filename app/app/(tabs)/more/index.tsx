import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

const MENU_ITEMS = [
  { href: '/(tabs)/more/capital-account', labelKey: 'more.capitalAccount', emoji: '💰' },
  { href: '/(tabs)/more/tax-estimator', labelKey: 'more.taxEstimator', emoji: '🧮' },
  { href: '/(tabs)/more/cash-flow', labelKey: 'more.cashFlow', emoji: '🏦' },
  { href: '/(tabs)/more/maintenance', labelKey: 'more.maintenance', emoji: '🔧' },
  { href: '/(tabs)/more/trucks', labelKey: 'more.trucks', emoji: '🚚' },
  { href: '/(tabs)/more/drivers', labelKey: 'more.drivers', emoji: '🧑‍✈️' },
  { href: '/(tabs)/more/loans', labelKey: 'more.loans', emoji: '📄' },
  { href: '/(tabs)/more/settings', labelKey: 'more.settings', emoji: '⚙️' },
] as const;

export default function More() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ gap: spacing.sm }}>
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
      </View>
    </Screen>
  );
}
