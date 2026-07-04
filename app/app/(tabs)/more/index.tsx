import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

const MENU_ITEMS = [
  { href: '/(tabs)/more/capital-account', label: 'Capital Account', emoji: '💰' },
  { href: '/(tabs)/more/cash-flow', label: 'Cash Flow', emoji: '🏦' },
  { href: '/(tabs)/more/maintenance', label: 'Maintenance', emoji: '🔧' },
  { href: '/(tabs)/more/loans', label: 'Loans', emoji: '📄' },
  { href: '/(tabs)/more/settings', label: 'Settings', emoji: '⚙️' },
] as const;

export default function More() {
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
            <Text style={{ fontSize: 18, marginRight: spacing.md }}>{item.emoji}</Text>
            <Text style={{ color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
