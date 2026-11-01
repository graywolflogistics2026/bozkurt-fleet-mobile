import { Share, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing } from '@/src/theme';
import { formatNumber } from '@/src/i18n/format';
import { buildImportAuditText } from '@/src/import/importAudit';
import type { ReconciliationIssue } from '@/src/import/settlementReconciliation';
import type { ReviewInputs } from '@/src/import/reviewVerdict';
import type { Extraction } from '@/src/import/types';

// The details under "Show details" on the CHECK AND CERTIFY card (batch
// D2): every check result, per-group difference and statement line the AI
// read, the AI note, and Share audit. Nothing here blocks or labels a week.

export function reconciliationIssueText(issue: ReconciliationIssue, t: TFunction, money: (n: number) => string): string {
  switch (issue.type) {
    case 'deductionsMismatch':
      return t('importScreen.reconciliationDeductionsMismatch', { stated: money(issue.stated), summed: money(issue.summed) });
    case 'revenueLinesMismatch':
      return t('importScreen.reconciliationRevenueLinesMismatch', { stated: money(issue.stated), summed: money(issue.summed) });
    case 'reimbursementLinesMismatch':
      return t('importScreen.reconciliationReimbursementLinesMismatch', { stated: money(issue.stated), summed: money(issue.summed) });
    case 'netDueMismatch':
      return t('importScreen.reconciliationNetDueMismatch', { stated: money(issue.stated), computed: money(issue.computed) });
    case 'depositMismatch':
      return t('importScreen.reconciliationDepositMismatch', { stated: money(issue.stated), computed: money(issue.computed) });
    case 'zeroNetNonzeroGross':
      return t('importScreen.reconciliationZeroNet', { zero: money(0), gross: money(issue.grossRevenue) });
  }
}

export function ReviewDetails({ extraction, inputs, money }: { extraction: Extraction; inputs: ReviewInputs; money: (n: number) => string }) {
  const { t, i18n } = useTranslation();
  const { check, issues, groups } = inputs;
  const heading = (key: string) => (
    <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.sm }}>{t(key)}</Text>
  );
  return (
    <View style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginTop: spacing.xs }}>
      {heading('importScreen.verdict.detailsChecks')}
      {check?.checks.map((c, i) => (
        <MutedText key={`c-${i}`} style={!c.passed ? { color: colors.red } : undefined}>
          {c.passed ? '✓' : '✗'} {t(`importScreen.primeCheck.${c.id}`)} —{' '}
          {t('importScreen.primeCheckNumbers', {
            printed: c.expectedText ?? (c.id === 'milesMatch' ? formatNumber(c.expected, i18n.language) : money(c.expected)),
            read: c.actualText ?? (c.id === 'milesMatch' ? formatNumber(c.actual, i18n.language) : money(c.actual)),
          })}
        </MutedText>
      ))}
      {(check?.gateMissing?.length ?? 0) > 0 && (
        <MutedText style={{ color: colors.red }}>
          ✗ {t('importScreen.verdict.reason.statementNotRead', { checks: check!.gateMissing!.map((m) => t(`importScreen.gateMissing.${m}`)).join(', ') })}
        </MutedText>
      )}
      {issues.map((issue, i) => (
        <MutedText key={`i-${i}`} style={{ color: colors.orange }}>
          ✗ {reconciliationIssueText(issue, t, money)}
        </MutedText>
      ))}
      {!check && issues.length === 0 && <MutedText>✓ {t('importScreen.verdict.lineTotalsTie')}</MutedText>}

      {groups && groups.length > 0 && (
        <>
          {heading('importScreen.verdict.detailsGroups')}
          {groups.map((g) => (
            <MutedText key={g.group} style={!g.passed ? { color: colors.orange } : undefined}>
              {g.passed ? '✓' : '✗'}{' '}
              {t('importScreen.groupLine', {
                group: t(`importScreen.group.${g.group}`),
                settlement: money(g.settlement),
                statement: money(g.statement),
                difference: money(Math.abs(g.difference)),
              })}
            </MutedText>
          ))}
        </>
      )}

      {check && check.lines.length > 0 && (
        <>
          {heading('importScreen.verdict.detailsLines')}
          {check.lines.map((l, i) => (
            <View key={`${l.section}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <MutedText style={{ flex: 1, marginEnd: spacing.sm }}>
                {t(`importScreen.primeSection.${l.section}`)} · {l.label}
              </MutedText>
              <Text style={{ color: colors.text }}>
                {formatNumber(Math.abs(l.amount), i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {l.amount < 0 ? '-' : ''}
              </Text>
            </View>
          ))}
        </>
      )}

      {!!extraction.summary && (
        <>
          {heading('importScreen.verdict.detailsNote')}
          <MutedText>{extraction.summary}</MutedText>
        </>
      )}

      <SecondaryButton
        title={t('audit.shareAudit')}
        onPress={() => {
          void Share.share({ message: buildImportAuditText(extraction, inputs, (k, o) => t(k, o) as string) });
        }}
      />
    </View>
  );
}
