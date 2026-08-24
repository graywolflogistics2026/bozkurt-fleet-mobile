import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlertsData } from '@/src/data/alerts';
import { COMPLIANCE_TYPE_ICON } from '@/src/compliance/status';
import { HEALTH_CATEGORY_ICON, type HealthCategory } from '@/src/truck/categories';
import type { NudgeTopic } from '@/src/alerts/missingDataNudges';
import type { ProfileRole } from '@/src/alerts/roleFilter';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { Screen, ScreenTitle, Card, TappableCard, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

function urgencyColor(urgency: 'overdue' | 'due_soon'): string {
  return urgency === 'overdue' ? colors.red : colors.orange;
}

const NUDGE_ICON: Record<NudgeTopic, string> = {
  noRecentSettlement: '📥',
  settlementMissingMiles: '🛣️',
  truckCostBasisNotSet: '🚚',
  depreciationNotSet: '📉',
  needsReviewReceipts: '🧾',
};

// Owner decision 2026-08-24: same "less aggressive, never forced" spirit
// as every other picker in this app — 5 options, reuses the EXACT same
// onboarding.roles.* i18n labels the onboarding wizard already has, no
// duplicate copy to keep in sync.
const ROLE_OPTIONS: Exclude<ProfileRole, null>[] = ['owner_operator', 'lease_operator', 'company_driver_w2', 'contractor_1099', 'trainee'];

function nudgeRoute(topic: NudgeTopic): Href {
  switch (topic) {
    case 'noRecentSettlement':
      return '/(tabs)/import' as Href;
    case 'settlementMissingMiles':
      return '/(tabs)/more/settlements' as Href;
    case 'truckCostBasisNotSet':
    case 'depreciationNotSet':
      return '/(tabs)/more/trucks' as Href;
    case 'needsReviewReceipts':
      return { pathname: '/(tabs)/deductions', params: { filter: 'needsReview' } } as unknown as Href;
  }
}

// Session 9e-B1: the screen the Dashboard top-bar bell opens — a simple,
// read-only rollup of everything already overdue/due-soon (Truck Health +
// Compliance Tracker), each row tapping through to the screen that owns it.
// SMART ALERTS + PROACTIVE NUDGES (owner decision 2026-08-24, NEXT PASS
// item D) extends this same screen with a role-aware "what's your role?"
// one-time prompt and a frequency-disciplined "Worth a look" section — all
// still reading from the ONE useAlertsData() hook (src/data/alerts.ts).
export default function Alerts() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { dueMaintenance, dueCompliance, nudges, silenceNudge, rolePromptNeeded, setRole, dismissRolePrompt, isLoading } = useAlertsData();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await invalidateFinancialData(queryClient);
    setRefreshing(false);
  }

  const isEmpty = !isLoading && dueMaintenance.length === 0 && dueCompliance.length === 0 && nudges.length === 0;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('alerts.title')}</ScreenTitle>

        {rolePromptNeeded && (
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>{t('alerts.rolePromptTitle')}</Text>
            <MutedText style={{ marginBottom: spacing.sm }}>{t('alerts.rolePromptBody')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {ROLE_OPTIONS.map((r) => (
                <RolePillButton key={r} label={t(`onboarding.roles.${r}`)} onPress={() => setRole(r)} />
              ))}
            </View>
            <Text onPress={dismissRolePrompt} style={{ color: colors.muted, marginTop: spacing.sm, fontSize: typography.size.xs }}>
              {t('alerts.rolePromptNotNow')}
            </Text>
          </Card>
        )}

        {isEmpty && !rolePromptNeeded && (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <Text style={{ fontSize: 32, marginBottom: spacing.sm }}>✅</Text>
            <MutedText>{t('alerts.empty')}</MutedText>
          </View>
        )}

        {nudges.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.sectionTitle}>{t('alerts.nudgesSection')}</Text>
            {nudges.map((n) => (
              <TappableCard key={n.topic} onPress={() => router.push(nudgeRoute(n.topic))}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                  <Text style={{ fontSize: 20 }}>{NUDGE_ICON[n.topic]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text }}>
                      {t(`alerts.nudges.${n.topic}`, { count: n.detail.count ?? 0, days: n.detail.days ?? 0 })}
                    </Text>
                    <Text
                      onPress={(e) => {
                        e.stopPropagation();
                        silenceNudge(n.topic);
                      }}
                      style={{ color: colors.muted, fontSize: typography.size.xs, marginTop: spacing.xs }}
                    >
                      🔕 {t('alerts.silence')}
                    </Text>
                  </View>
                </View>
              </TappableCard>
            ))}
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

function RolePillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        color: colors.accent,
        borderColor: colors.accent,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
        fontSize: typography.size.sm,
        fontWeight: '600',
        overflow: 'hidden',
      }}
    >
      {label}
    </Text>
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
