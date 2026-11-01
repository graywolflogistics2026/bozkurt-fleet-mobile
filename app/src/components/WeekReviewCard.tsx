import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { HeadlineRows } from '@/src/components/SettlementImportCards';
import { EstimateBanner } from '@/src/components/EstimateBanner';
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';
import { getBuildInfo } from '@/src/lib/buildInfo';
import { certifyUpdate } from '@/src/import/weekReview';
import type { GateHeadline } from '@/src/import/settlementGate';
import { certifyWeek, WeekReviewNotInstalledError } from '@/src/data/weekReviewMutations';

// CERTIFIED STATUS (owner decision 2026-10-31, batch D2 2.3): the ONLY
// status a settlement week shows anywhere — "Certified on <date>", or a
// quiet "Not certified [Certify]" on a week saved earlier. Certify opens the
// same headline card as the import, built from the stored numbers. The
// earlier "Things to check (N)" list and its "Looks right" marks are gone
// from the screen (the data stays: review_acknowledged, statement reasons).

export function appVersionLabel(): string {
  const info = getBuildInfo();
  return info.updateIdShort ? `${info.version}+${info.updateIdShort}` : info.version;
}

type CertifiableWeek = { id: string; certified_at?: string | null };

export function CertifiedChip({ settlement }: { settlement: CertifiableWeek }) {
  const { t } = useTranslation();
  const { date } = useFormatters();
  return settlement.certified_at ? (
    <Text style={{ color: colors.green, fontSize: typography.size.xs, fontWeight: '700', marginTop: 2 }}>
      {t('certify.certifiedOn', { date: date(settlement.certified_at) })}
    </Text>
  ) : (
    <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginTop: 2 }}>{t('certify.notCertified')}</Text>
  );
}

export function WeekCertification({
  settlement,
  documentId,
  headline,
  onChanged,
}: {
  settlement: CertifiableWeek;
  documentId: string | null;
  headline: GateHeadline;
  onChanged: (patch: ReturnType<typeof certifyUpdate>) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { date, money } = useFormatters();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function certify() {
    setBusy(true);
    const now = new Date().toISOString();
    const version = appVersionLabel();
    try {
      await certifyWeek({ id: settlement.id, document_id: documentId }, version, now);
      await onChanged(certifyUpdate(now, version));
      setOpen(false);
    } catch (err) {
      Alert.alert(
        t('weekReview.saveFailedTitle'),
        err instanceof WeekReviewNotInstalledError ? t('weekReview.needsDb') : err instanceof Error ? err.message : t('common.tryAgain')
      );
    } finally {
      setBusy(false);
    }
  }

  if (settlement.certified_at) {
    return (
      <MutedText style={{ color: colors.green, fontWeight: '700', marginVertical: spacing.xs }}>
        {t('certify.certifiedOn', { date: date(settlement.certified_at) })}
      </MutedText>
    );
  }

  if (!open) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xs }}>
        <MutedText>{t('certify.notCertified')} </MutedText>
        <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontWeight: '700' }}>{t('certify.certify')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Card style={{ marginVertical: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md, marginBottom: spacing.xs }}>{t('importFlow.certifyTitle')}</Text>
      <HeadlineRows headline={headline} />
      <EstimateBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
        <MutedText>{t('importFlow.perDiemDays')}</MutedText>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{headline.perDiemDays}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
        <MutedText>{t('importFlow.estimatedProfit')}</MutedText>
        <Text style={{ color: colors.text, fontWeight: '600' }}>~{money(headline.estimatedProfit, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <PrimaryButton title={t('certify.certify')} onPress={() => void certify()} loading={busy} />
        <MutedText style={{ fontSize: typography.size.xs, marginTop: spacing.xs, marginBottom: spacing.sm }}>{t('importFlow.certifyLine')}</MutedText>
        <SecondaryButton title={t('common.cancel')} onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}
