import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, PrimaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

type MetricKey = 'revenue' | 'profit' | 'mpg';
const METRICS: MetricKey[] = ['revenue', 'profit', 'mpg'];

// Share Weekly Profit v1 (PROMPTS.md Session 9a item 10, owner decision
// 2026-07-10 — AI feature package, PRODUCT DECISION): the user picks which
// metrics go on the card (never forced to share all three, for privacy) —
// reads the most recent settlement + active truck's fleet_mpg, the same
// data other screens already show, no new backend/calculation engine.
export default function ShareProfit() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const settlementsQuery = useSettlements();
  const { activeTruck } = useActiveTruck();
  const shotRef = useRef<ViewShot>(null);
  const [included, setIncluded] = useState<Record<MetricKey, boolean>>({ revenue: true, profit: true, mpg: false });
  const [sharing, setSharing] = useState(false);

  const latest = [...(settlementsQuery.data ?? [])].sort((a, b) => (b.week_ending ?? '').localeCompare(a.week_ending ?? ''))[0];

  function toggle(key: MetricKey) {
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleShare() {
    if (!shotRef.current?.capture) return;
    setSharing(true);
    try {
      const uri = await shotRef.current.capture();
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('shareProfit.notAvailableTitle'));
        return;
      }
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert(t('shareProfit.shareFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSharing(false);
    }
  }

  const noneSelected = !included.revenue && !included.profit && !included.mpg;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('shareProfit.title')}</ScreenTitle>
        <MutedText>{t('shareProfit.subtitle')}</MutedText>

        {!latest ? (
          <Card>
            <MutedText>{t('shareProfit.noSettlements')}</MutedText>
          </Card>
        ) : (
          <>
            <Card>
              {METRICS.map((key) => (
                <Pressable key={key} onPress={() => toggle(key)} style={styles.metricRow}>
                  <Text style={{ color: colors.text, fontSize: typography.size.md }}>{t(`shareProfit.metrics.${key}`)}</Text>
                  <Text style={{ color: included[key] ? colors.accent : colors.muted, fontSize: typography.size.md, fontWeight: '700' }}>
                    {included[key] ? '☑' : '☐'}
                  </Text>
                </Pressable>
              ))}
            </Card>

            <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
              <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
                <View style={styles.shareCard}>
                  <Text style={styles.shareBrand}>🐺 {t('auth.brand')}</Text>
                  <Text style={styles.shareWeek}>{t('shareProfit.weekOf', { date: latest.week_ending })}</Text>
                  {included.revenue && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.revenue')}</Text>
                      <Text style={[styles.shareMetricValue, { color: colors.green }]}>{money(latest.gross)}</Text>
                    </View>
                  )}
                  {included.profit && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.profit')}</Text>
                      <Text style={[styles.shareMetricValue, { color: colors.green }]}>{money(latest.net)}</Text>
                    </View>
                  )}
                  {included.mpg && activeTruck?.fleet_mpg != null && (
                    <View style={styles.shareMetric}>
                      <Text style={styles.shareMetricLabel}>{t('shareProfit.metrics.mpg')}</Text>
                      <Text style={styles.shareMetricValue}>{number(activeTruck.fleet_mpg, { maximumFractionDigits: 1 })}</Text>
                    </View>
                  )}
                </View>
              </ViewShot>
            </View>

            <PrimaryButton
              title={`📤 ${t('shareProfit.share')}`}
              onPress={handleShare}
              loading={sharing}
              disabled={noneSelected}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = {
  metricRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  shareCard: {
    width: 320,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: 'center' as const,
  },
  shareBrand: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
  shareWeek: {
    color: colors.muted,
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  shareMetric: {
    alignItems: 'center' as const,
    marginBottom: spacing.sm,
  },
  shareMetricLabel: {
    color: colors.muted,
    fontSize: typography.size.sm,
  },
  shareMetricValue: {
    color: colors.text,
    fontSize: typography.size.xl,
    fontWeight: '700' as const,
    marginTop: 2,
  },
};
