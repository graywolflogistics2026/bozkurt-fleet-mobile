import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServiceStatus, useAiFailureTracker, worstServiceStatus } from '@/src/data/serviceStatus';
import { Card, MutedText } from '@/src/components/ui';
import { colors, spacing } from '@/src/theme';

// COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 4 item 3) — shown on Home and Import whenever
// EITHER a real posted outage (service_status, admin-controlled) OR the
// automatic client-side fallback (3+ consecutive ai-import failures on
// this device) is active. Renders nothing in the normal case — cheap to
// mount everywhere.
export function ServiceStatusBanner() {
  const { t } = useTranslation();
  const statusQuery = useServiceStatus();
  const { showFallbackBanner } = useAiFailureTracker();
  const worst = statusQuery.data ? worstServiceStatus(statusQuery.data) : null;

  if (!worst && !showFallbackBanner) return null;

  return (
    <Card style={{ borderColor: colors.orange, borderWidth: 1, backgroundColor: 'rgba(245,158,11,0.08)' }}>
      <Text style={{ color: colors.orange, fontWeight: '700', marginBottom: spacing.xs }}>
        ⚠️ {t('serviceStatus.title')}
      </Text>
      <MutedText>{worst?.message || t('serviceStatus.autoFallbackMessage')}</MutedText>
    </Card>
  );
}
