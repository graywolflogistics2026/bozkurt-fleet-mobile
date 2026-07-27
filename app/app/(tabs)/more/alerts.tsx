import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlertsData } from '@/src/data/alerts';
import { COMPLIANCE_TYPE_ICON } from '@/src/compliance/status';
import { HEALTH_CATEGORY_ICON, type HealthCategory } from '@/src/truck/categories';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { Screen, ScreenTitle, TappableCard, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

function urgencyColor(urgency: 'overdue' | 'due_soon'): string {
  return urgency === 'overdue' ? colors.red : colors.orange;
}

// Session 9e-B1: the screen the Dashboard top-bar bell opens — a simple,
// read-only rollup of everything already overdue/due-soon (Truck Health +
// Compliance Tracker), each row tapping through to the screen that owns it.
// No new data model: reuses useAlertsData() (src/data/alerts.ts), the same
// hook the bell's badge count reads.
export default function Alerts() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { dueMaintenance, dueCompliance, isLoading } = useAlertsData();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await invalidateFinancialData(queryClient);
    setRefreshing(false);
  }

  const isEmpty = !isLoading && dueMaintenance.length === 0 && dueCompliance.length === 0;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('alerts.title')}</ScreenTitle>

        {isEmpty && (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <Text style={{ fontSize: 32, marginBottom: spacing.sm }}>✅</Text>
            <MutedText>{t('alerts.empty')}</MutedText>
          </View>
        )}

        {dueMaintenance.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.sectionTitle}>{t('alerts.maintenanceSection')}</Text>
            {dueMaintenance.map((r) => (
              <TappableCard key={r.category} onPress={() => router.push('/(tabs)/truck-health')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ fontSize: 20 }}>{HEALTH_CATEGORY_ICON[r.category as HealthCategory] ?? '🔧'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>{t(`truckHealth.categories.${r.category}`)}</Text>
                    <Text style={{ color: urgencyColor(r.status as 'overdue' | 'due_soon'), fontSize: typography.size.xs, fontWeight: '700' }}>
                      {t(`truckHealth.status.${r.status}`)}
                    </Text>
                  </View>
                </View>
              </TappableCard>
            ))}
          </View>
        )}

        {dueCompliance.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.sectionTitle}>{t('alerts.complianceSection')}</Text>
            {dueCompliance.map((row) => (
              <TappableCard key={row.item.id} onPress={() => router.push('/(tabs)/more/compliance')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={{ fontSize: 20 }}>{COMPLIANCE_TYPE_ICON[row.item.type]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '600' }}>
                      {row.item.label?.trim() || t(`compliance.types.${row.item.type}`)}
                    </Text>
                    <Text style={{ color: urgencyColor(row.status.urgency as 'overdue' | 'due_soon'), fontSize: typography.size.xs, fontWeight: '700' }}>
                      {row.status.urgency === 'overdue'
                        ? t('compliance.overdueBy', { count: Math.abs(row.status.daysUntil) })
                        : t('compliance.dueInDays', { count: row.status.daysUntil })}
                    </Text>
                  </View>
                </View>
              </TappableCard>
            ))}
          </View>
        )}
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
};
