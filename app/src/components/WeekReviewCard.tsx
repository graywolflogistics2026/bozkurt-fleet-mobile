import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { EstimateBanner } from '@/src/components/EstimateBanner';
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';
import { getBuildInfo } from '@/src/lib/buildInfo';
import {
  CERTIFICATION_TEXT,
  acknowledgeUpdate,
  certifyUpdate,
  weekReviewState,
  type WeekCheckItem,
  type WeekReviewSettlement,
} from '@/src/import/weekReview';
import { acknowledgeWeekItem, certifyWeek, WeekReviewNotInstalledError } from '@/src/data/weekReviewMutations';
import { todayDateOnly } from '@/src/lib/dateOnly';

// REVIEW THIS WEEK + CERTIFY (batch C item 5): the ONE card that replaces
// the week's scattered warnings (src/import/weekReview.ts).

export function appVersionLabel(): string {
  const info = getBuildInfo();
  return info.updateIdShort ? `${info.version}+${info.updateIdShort}` : info.version;
}

export function WeekReviewChip({ settlement, documentLowConfidence }: { settlement: WeekReviewSettlement; documentLowConfidence: boolean }) {
  const { t } = useTranslation();
  const state = weekReviewState(settlement, { documentLowConfidence, today: todayDateOnly() });
  const [label, color] = state.certified
    ? [t('weekReview.chipCertified'), colors.green]
    : state.open.length > 0
      ? [t('weekReview.chipToCheck', { count: state.open.length }), colors.orange]
      : [t('weekReview.chipReady'), colors.muted];
  return <Text style={{ color, fontSize: typography.size.xs, fontWeight: '700', marginTop: 2 }}>{label}</Text>;
}

export function WeekReviewCard({
  settlement,
  documentId,
  documentLowConfidence,
  onChanged,
}: {
  settlement: WeekReviewSettlement;
  documentId: string | null;
  documentLowConfidence: boolean;
  onChanged: (patch: Partial<WeekReviewSettlement>) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { dateTime } = useFormatters();
  const [busy, setBusy] = useState<string | null>(null);
  const state = weekReviewState(settlement, { documentLowConfidence, today: todayDateOnly() });

  function fail(err: unknown) {
    Alert.alert(
      t('weekReview.saveFailedTitle'),
      err instanceof WeekReviewNotInstalledError ? t('weekReview.needsDb') : err instanceof Error ? err.message : t('common.tryAgain')
    );
  }

  async function looksRight(item: WeekCheckItem) {
    setBusy(item.id);
    try {
      await acknowledgeWeekItem(settlement, item.id);
      await onChanged(acknowledgeUpdate(settlement, item.id));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  function certify() {
    Alert.alert(t('weekReview.certifyTitle'), CERTIFICATION_TEXT, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('weekReview.certify'),
        onPress: async () => {
          setBusy('certify');
          const now = new Date().toISOString();
          const version = appVersionLabel();
          try {
            await certifyWeek({ id: settlement.id, document_id: documentId }, version, now);
            await onChanged(certifyUpdate(now, version));
          } catch (err) {
            fail(err);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <Card style={{ marginBottom: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }}>{t('weekReview.title')}</Text>
      <EstimateBanner />
      {state.certified ? (
        <>
          <MutedText style={{ color: colors.green, fontWeight: '700', marginTop: spacing.xs }}>
            {t('weekReview.certifiedOn', { date: dateTime(settlement.certified_at!) })}
          </MutedText>
          <MutedText style={{ marginTop: spacing.xs }}>{CERTIFICATION_TEXT}</MutedText>
        </>
      ) : (
        <>
          <MutedText style={{ marginTop: spacing.xs }}>
            {state.items.length === 0 ? t('weekReview.nothingToCheck') : t('weekReview.thingsToCheck', { count: state.open.length })}
          </MutedText>
          {state.items.map((item) => {
            const done = !state.open.includes(item);
            return (
              <View key={item.id} style={{ marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={{ color: done ? colors.muted : colors.orange, flex: 1 }}>
                  {done ? '✓ ' : '• '}
                  {itemText(item, t)}
                </Text>
                {!done && <SecondaryButton title={t('weekReview.looksRight')} onPress={() => looksRight(item)} loading={busy === item.id} />}
              </View>
            );
          })}
          <View style={{ marginTop: spacing.sm }}>
            <PrimaryButton title={t('weekReview.certify')} onPress={certify} loading={busy === 'certify'} disabled={!state.canCertify} />
            {!state.canCertify && <MutedText style={{ marginTop: 2 }}>{t('weekReview.certifyBlocked')}</MutedText>}
          </View>
        </>
      )}
    </Card>
  );
}

function itemText(item: WeekCheckItem, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (item.kind === 'statement_reason') {
    const base = t(`weekReview.reason.${item.reason}`);
    return item.detail ? `${base} (${item.detail})` : base;
  }
  return t(`weekReview.item.${item.kind}`);
}
