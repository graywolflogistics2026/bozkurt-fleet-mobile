import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Field, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { EstimateBanner } from '@/src/components/EstimateBanner';
import { ReviewDetails } from '@/src/components/SettlementReview';
import { SettlementDateQuestion } from '@/src/components/SettlementDateQuestion';
import { useFormatters } from '@/src/i18n/format';
import { colors, radii, spacing, typography } from '@/src/theme';
import { GATE_FAIL_REASON_KEY, type GateFailReason, type GateHeadline, type SettlementGateResult } from '@/src/import/settlementGate';
import { reviewInputsOf } from '@/src/import/reviewVerdict';
import { couldNotReadReport } from '@/src/import/importAudit';
import type { Extraction } from '@/src/import/types';

// SIMPLE IMPORT FLOW (owner decision 2026-10-31, batch D2 2.1): a
// settlement shows exactly one of three states — READING, CHECK AND
// CERTIFY, COULD NOT READ. No page, step, pause or interruption wording,
// no Verified / Totals match / Unverified label, no "Save anyway".

export function ReadingCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={{ color: colors.text, textAlign: 'center', marginTop: spacing.md }}>{t('importFlow.reading')}</Text>
    </Card>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
      <MutedText style={{ flex: 1, marginEnd: spacing.sm }}>{label}</MutedText>
      <Text style={{ color: color ?? colors.text, fontWeight: bold ? '700' : '600', fontSize: bold ? typography.size.md : typography.size.sm }}>{value}</Text>
    </View>
  );
}

// The headline numbers as printed — the same card when a week is certified
// later from its stored numbers (settlement detail "Not certified [Certify]").
export function HeadlineRows({ headline }: { headline: GateHeadline }) {
  const { t } = useTranslation();
  const { money, number, date } = useFormatters();
  const m = (n: number) => money(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const miles =
    headline.loadedMiles != null || headline.emptyMiles != null
      ? t('importFlow.milesSplit', {
          total: headline.miles != null ? number(headline.miles) : '—',
          loaded: headline.loadedMiles != null ? number(headline.loadedMiles) : '—',
          empty: headline.emptyMiles != null ? number(headline.emptyMiles) : '—',
        })
      : headline.miles != null
        ? number(headline.miles)
        : '—';
  return (
    <>
      <Row label={t('importFlow.weekEnding')} value={headline.weekEnding ? date(headline.weekEnding) : '—'} />
      <Row label={t('importFlow.revenue')} value={m(headline.revenue)} />
      <Row label={t('importFlow.netDue')} value={headline.netDue != null ? m(headline.netDue) : '—'} />
      {headline.owedToCarrier > 0 ? (
        <Row label={t('importFlow.owedToCarrier')} value={m(headline.owedToCarrier)} color={colors.red} bold />
      ) : (
        <Row label={t('importFlow.deposited')} value={m(headline.deposited)} bold />
      )}
      <Row label={t('importFlow.miles')} value={miles} />
    </>
  );
}

export function CertifyCard({
  extraction,
  gate,
  perDiemDays,
  onPerDiemChange,
  onConfirmDate,
  onCertify,
  onDiscard,
  certifyDisabled,
  children,
}: {
  extraction: Extraction;
  gate: Extract<SettlementGateResult, { status: 'pass' | 'needs_date' }>;
  perDiemDays: number;
  onPerDiemChange: (days: number) => void;
  onConfirmDate: (weekEnding: string) => void;
  onCertify: () => void;
  onDiscard: () => void;
  certifyDisabled: boolean;
  // Truck / driver pickers, only when the unit or driver did not match.
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const [showDetails, setShowDetails] = useState(false);
  const m = (n: number) => money(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.lg, marginBottom: spacing.xs }}>{t('importFlow.certifyTitle')}</Text>
      <MutedText style={{ marginBottom: spacing.sm }}>{t('importFlow.certifySubtitle')}</MutedText>
      <HeadlineRows headline={gate.headline} />
      <EstimateBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
        <MutedText style={{ flex: 1, marginEnd: spacing.sm }}>{t('importFlow.perDiemDays')}</MutedText>
        <Field
          keyboardType="numeric"
          value={String(perDiemDays)}
          onChangeText={(v) => onPerDiemChange(Math.max(0, Math.min(7, Math.round(Number(v.replace(/[^0-9]/g, '')) || 0))))}
          placeholder="0-7"
          style={{ width: 64, textAlign: 'center', marginBottom: 0 }}
        />
      </View>
      <Row label={t('importFlow.estimatedProfit')} value={`~${m(gate.headline.estimatedProfit)}`} />
      {gate.lineDetails === 'mismatch' && <MutedText style={{ marginTop: spacing.xs }}>{t('importFlow.linesWillNotBeSaved')}</MutedText>}

      {gate.status === 'needs_date' && (
        <View style={{ marginTop: spacing.sm }}>
          <SettlementDateQuestion check={gate.dateCheck} onConfirm={onConfirmDate} />
        </View>
      )}

      {children}

      <View style={{ marginTop: spacing.md }}>
        <PrimaryButton title={t('importFlow.certifyAndAdd')} onPress={onCertify} disabled={certifyDisabled || gate.status === 'needs_date'} />
        <MutedText style={{ fontSize: typography.size.xs, marginTop: spacing.xs, marginBottom: spacing.sm }}>{t('importFlow.certifyLine')}</MutedText>
        <SecondaryButton title={t('importScreen.discard')} onPress={onDiscard} />
      </View>

      <Pressable onPress={() => setShowDetails((v) => !v)} hitSlop={8} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} accessibilityRole="button">
        <Text style={{ color: colors.accent, fontWeight: '600' }}>{showDetails ? t('importFlow.hideDetails') : t('importFlow.showDetails')}</Text>
      </Pressable>
      {showDetails && <ReviewDetails extraction={extraction} inputs={reviewInputsOf(extraction)} money={m} />}
    </Card>
  );
}

export function CouldNotReadCard({
  extraction,
  reason,
  onUploadAgain,
}: {
  extraction: Extraction | null;
  reason: GateFailReason | 'job_failed';
  onUploadAgain: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <View style={{ backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }}>{t('importFlow.couldNotReadTitle')}</Text>
        <MutedText style={{ marginTop: spacing.xs }}>{t(reason === 'job_failed' ? 'importFlow.reason.jobFailed' : GATE_FAIL_REASON_KEY[reason])}</MutedText>
      </View>
      <PrimaryButton title={t('importFlow.uploadAgain')} onPress={onUploadAgain} />
      <SecondaryButton
        title={t('importFlow.sendReport')}
        onPress={() => {
          void Share.share({ message: couldNotReadReport(extraction, reason, (k, o) => t(k, o) as string) });
        }}
      />
    </Card>
  );
}
