import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GROUPS } from '@/src/components/WideSidebar';
import { Screen, ScreenTitle, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

const REPORTS_SECTION_KEYS = ['sidebar.sections.intelligence', 'sidebar.sections.tools'];

// Session 9e-B8: Reports hub (tab bar restructure to Home/Transactions/+/
// Reports/Menu) — surfaces the same INTELLIGENCE + TOOLS groups the wide-
// screen sidebar/phone Menu sheet already show (WideSidebar.tsx's shared
// GROUPS constant, one source of truth), just as its own tab instead of
// requiring the hamburger. Truck Health lives in the intelligence group
// here too, so it stays prominently reachable even though it's no longer
// a direct bottom tab.
export default function Reports() {
  const { t } = useTranslation();
  const router = useRouter();
  const sections = GROUPS.filter((g) => REPORTS_SECTION_KEYS.includes(g.titleKey));

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('nav.reports')}</ScreenTitle>
        <MutedText style={{ marginBottom: spacing.md }}>{t('reports.subtitle')}</MutedText>

        {sections.map((section) => (
          <View key={section.titleKey} style={{ marginBottom: spacing.lg }}>
            <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
            {section.items.map((item) => (
              <Pressable key={item.href as string} onPress={() => router.push(item.href)} style={styles.row}>
                <Text style={{ fontSize: 20, marginEnd: spacing.md }}>{item.emoji}</Text>
                <Text style={{ color: colors.text, fontSize: typography.size.md, flex: 1 }}>{t(item.labelKey)}</Text>
                <Text style={{ color: colors.muted }}>›</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.muted,
    fontSize: typography.size.xs,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
};
