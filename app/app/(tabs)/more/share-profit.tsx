import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useSettlements } from '@/src/data/settlements';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

type MetricKey = 'revenue' | 'profit' | 'mpg';
const METRICS: MetricKey[] = ['revenue', 'profit', 'mpg'];

// Share destinations (PROMPTS.md Session 9a device-feedback pass). Only
// Instagram/Facebook publicly document a no-SDK way to receive shared media
// via the pasteboard (their Stories share intents read whatever image is
// currently on the system clipboard) — TikTok/X/LinkedIn have no equivalent
// public URL scheme, so for those three (and whenever the target app isn't
// installed) this still copies the branded image to the clipboard and opens
// the app so the user can paste it manually, then falls back to the system
// share sheet if the app can't be opened at all. No target-app native SDKs
// are added here (would need per-platform linking this pass can't verify on
// a device).
const DESTINATIONS: { key: string; monogram: string; bg: string; fg: string; scheme: string }[] = [
  { key: 'tiktok', monogram: 'TT', bg: '#000000', fg: '#ffffff', scheme: 'tiktok://' },
  { key: 'instagram', monogram: 'IG', bg: '#E1306C', fg: '#ffffff', scheme: 'instagram://app' },
  { key: 'facebook', monogram: 'f', bg: '#1877F2', fg: '#ffffff', scheme: 'fb://' },
  { key: 'twitter', monogram: 'X', bg: '#ffffff', fg: '#000000', scheme: 'twitter://' },
  { key: 'linkedin', monogram: 'in', bg: '#0A66C2', fg: '#ffffff', scheme: 'linkedin://' },
];

function DestinationButton({
  label,
  monogram,
  bg,
  fg,
  disabled,
  onPress,
}: {
  label: string;
  monogram: string;
  bg: string;
  fg: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ alignItems: 'center', opacity: disabled ? 0.5 : 1 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: fg, fontWeight: '700', fontSize: typography.size.sm }}>{monogram}</Text>
      </View>
      <MutedText style={{ marginTop: 4, fontSize: typography.size.xs }}>{label}</MutedText>
    </Pressable>
  );
}

// Share Weekly Profit v1 (PROMPTS.md Session 9a item 10, owner decision
// 2026-07-10 — AI feature package, PRODUCT DECISION): the user picks which
// metrics go on the card (never forced to share all three, for privacy) —
// reads the most recent settlement + active truck's fleet_mpg, the same
// data other screens already show, no new backend/calculation engine.
export default function ShareProfit() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const { profile } = useAuth();
  const settlementsQuery = useSettlements();
  const { activeTruck } = useActiveTruck();
  const shotRef = useRef<ViewShot>(null);
  const [included, setIncluded] = useState<Record<MetricKey, boolean>>({ revenue: true, profit: true, mpg: false });
  const [sharing, setSharing] = useState(false);

  const latest = [...(settlementsQuery.data ?? [])].sort((a, b) => (b.week_ending ?? '').localeCompare(a.week_ending ?? ''))[0];
  const companyLabel = profile?.company_name?.trim() || t('auth.brand');

  function toggle(key: MetricKey) {
    setIncluded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function shareViaSystemSheet(uri: string) {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert(t('shareProfit.notAvailableTitle'));
      return;
    }
    await Sharing.shareAsync(uri);
  }

  async function handleShareTo(dest: { key: string; label: string; scheme?: string }) {
    if (!shotRef.current?.capture || sharing) return;
    setSharing(true);
    try {
      const uri = await shotRef.current.capture();

      if (dest.scheme) {
        let installed = false;
        try {
          installed = await Linking.canOpenURL(dest.scheme);
        } catch {
          installed = false;
        }
        if (installed) {
          try {
            const base64 = await new File(uri).base64();
            await Clipboard.setImageAsync(base64);
            await Linking.openURL(dest.scheme);
            Alert.alert(t('shareProfit.imageCopiedTitle'), t('shareProfit.imageCopiedBody', { app: dest.label }));
            return;
          } catch {
            // Best-effort only — fall through to the system share sheet.
          }
        }
      }

      await shareViaSystemSheet(uri);
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
                  <Text style={styles.shareBrand}>🐺 {companyLabel}</Text>
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

            <MutedText style={{ marginBottom: spacing.xs }}>{t('shareProfit.shareTo')}</MutedText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              {DESTINATIONS.map((dest) => (
                <DestinationButton
                  key={dest.key}
                  label={t(`shareProfit.destinations.${dest.key}`)}
                  monogram={dest.monogram}
                  bg={dest.bg}
                  fg={dest.fg}
                  disabled={sharing || noneSelected}
                  onPress={() => handleShareTo({ key: dest.key, label: t(`shareProfit.destinations.${dest.key}`), scheme: dest.scheme })}
                />
              ))}
              <DestinationButton
                key="more"
                label={t('shareProfit.destinations.more')}
                monogram="•••"
                bg={colors.card2}
                fg={colors.text}
                disabled={sharing || noneSelected}
                onPress={() => handleShareTo({ key: 'more', label: t('shareProfit.destinations.more') })}
              />
            </View>
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
