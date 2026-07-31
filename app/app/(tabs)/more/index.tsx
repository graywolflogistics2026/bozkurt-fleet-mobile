import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { moreTabItems } from '@/src/navigation/navRegistry';
import { Screen } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

// NAV PARITY FIX (owner decision 2026-07-30): this used to be its own,
// separately hand-maintained item list — Equipment and Documents were
// each added here but never to WideSidebar.tsx's GROUPS (which
// WideSidebar AND MenuSheet.tsx both render directly), so they silently
// never appeared on the wide-screen sidebar or the phone hamburger menu
// despite being reachable from this screen. Now derived from the same
// shared registry (src/navigation/navRegistry.ts) every other nav
// surface uses — this class of bug is structurally impossible going
// forward, since there's only one list left to add a route to.
const MENU_ITEMS = moreTabItems();

export default function More() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.href as string}
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
