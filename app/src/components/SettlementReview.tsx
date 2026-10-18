import { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MutedText, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import { formatMoney, formatNumber } from '@/src/i18n/format';
import { formatPageList } from '@/src/import/importJobs';
import { statementPagesOf } from '@/src/import/settlementStatement';
import { buildImportAuditText } from '@/src/import/importAudit';
import type { ReconciliationIssue } from '@/src/import/settlementReconciliation';
import type { ReviewInputs, ReviewVerdict, VerdictReason } from '@/src/import/reviewVerdict';
import type { Extraction } from '@/src/import/types';

// SIMPLE REVIEW SCREEN (owner decision 2026-10-17, item 7): one plain
// verdict and one reason for a settlement on the import preview; every
// check, the statement lines the AI read and the raw AI note sit under
// "Details". The actions (Save / Read again / Save as estimate / Discard)
// stay at the bottom of the preview with the rest of its fields.

const TONE = {
  green: { fg: colors.green, bg: 'rgba(34,197,94,0.12)' },
  amber: { fg: colors.orange, bg: 'rgba(245,158,11,0.12)' },
  red: { fg: colors.red, bg: 'rgba(239,68,68,0.12)' },
} as const;

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

function reasonText(reason: VerdictReason, t: TFunction, money: (n: number) => string): string {
  switch (reason.kind) {
    case 'line_details_differ':
      return t('importScreen.verdict.reason.lineDetailsDiffer', { amount: money(reason.amount) });
    case 'statement_warning':
      return t('importScreen.verdict.reason.statementWarning', { check: t(`importScreen.primeCheck.${reason.check.id}`) });
    case 'loads_revenue_mismatch':
      return t('importScreen.verdict.reason.loadsMismatch');
    case 'pages_incomplete':
      return t('importScreen.verdict.reason.pagesIncomplete', { pages: formatPageList(reason.pages) });
    case 'statement_check_failed': {
      const c = reason.check;
      return t('importScreen.verdict.reason.statementCheckFailed', {
        check: t(`importScreen.primeCheck.${c.id}`),
        printed: c.expectedText ?? money(c.expected),
        read: c.actualText ?? money(c.actual),
      });
    }
    case 'statement_not_read':
      return t('importScreen.verdict.reason.statementNotRead', {
        checks: reason.missing.map((m) => t(`importScreen.gateMissing.${m}`)).join(', '),
      });
    case 'line_check_failed':
      return reconciliationIssueText(reason.issue, t, money);
    case 'totals_not_printed':
      return t('importScreen.verdict.reason.totalsNotPrinted');
  }
}

export function SettlementReview({
  extraction,
  verdict,
  inputs,
  olderReading,
}: {
  extraction: Extraction;
  verdict: ReviewVerdict;
  inputs: ReviewInputs;
  olderReading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const money = (n: number) => formatMoney(n, i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tone = TONE[verdict.tone];
  const pages = statementPagesOf(extraction);
  const unreadAttachments = (pages?.unread ?? []).length;
  const stillReading = (extraction.pageMap ?? []).filter((p) => p.role === 'attachment' && p.status === 'pending').length;

  const title =
    verdict.kind === 'verified'
      ? t('importScreen.verdict.verified', { profit: money(verdict.profit), deposit: money(verdict.deposit) })
      : verdict.kind === 'totals_match'
        ? t('importScreen.verdict.totalsMatch', { profit: money(verdict.profit) })
        : verdict.kind === 'needs_look'
          ? t('importScreen.verdict.needsLook')
          : t('importScreen.verdict.notVerified');

  return (
    <View style={{ marginBottom: spacing.sm }}>
      {olderReading && (
        <View style={{ backgroundColor: TONE.amber.bg, borderColor: colors.orange, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('importScreen.verdict.olderTitle')}</Text>
          <MutedText>{t('importScreen.verdict.olderBody')}</MutedText>
        </View>
      )}

      <View style={{ backgroundColor: tone.bg, borderColor: tone.fg, borderWidth: 1, borderRadius: radii.sm, padding: spacing.sm }}>
        <Text style={{ color: tone.fg, fontWeight: '700', fontSize: typography.size.md }}>{title}</Text>
        {verdict.kind === 'needs_look' && (
          <MutedText>{t('importScreen.verdict.needsLookFigures', { profit: money(verdict.profit), deposit: money(verdict.deposit) })}</MutedText>
        )}
        {(verdict.kind === 'needs_look' || verdict.kind === 'not_verified') && (
          <MutedText style={{ color: colors.text, marginTop: spacing.xs }}>{reasonText(verdict.reason, t, money)}</MutedText>
        )}
        {unreadAttachments > 0 && (
          <MutedText style={{ marginTop: spacing.xs, fontSize: typography.size.xs }}>
            {t('importScreen.verdict.attachmentsSavedNotRead', { count: unreadAttachments })}
          </MutedText>
        )}
        {stillReading > 0 && (
          <MutedText style={{ marginTop: spacing.xs, fontSize: typography.size.xs }}>{t('importScreen.attachmentsStillReading', { count: stillReading })}</MutedText>
        )}
        <Pressable onPress={() => setShowDetails((v) => !v)} hitSlop={8} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>
            {showDetails ? t('importScreen.verdict.hideDetails') : t('importScreen.verdict.details')}
          </Text>
        </Pressable>
      </View>

      {showDetails && <ReviewDetails extraction={extraction} inputs={inputs} money={money} />}
    </View>
  );
}

function ReviewDetails({ extraction, inputs, money }: { extraction: Extraction; inputs: ReviewInputs; money: (n: number) => string }) {
  const { t, i18n } = useTranslation();
  const { check, issues, groups } = inputs;
  const pages = statementPagesOf(extraction);
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

      {pages && (pages.incomplete.length > 0 || pages.unread.length > 0) && (
        <>
          {heading('importScreen.verdict.detailsPages')}
          {pages.incomplete.length > 0 && (
            <MutedText>
              {t('importScreen.lineItemsIncompleteBody', { pages: formatPageList(pages.incomplete.map((p) => p.page)), total: pages.total })}
            </MutedText>
          )}
          {pages.unread.length > 0 && (
            <MutedText>{t('importScreen.unreadPagesBody', { pages: formatPageList(pages.unread.map((p) => p.page)), count: pages.unread.length })}</MutedText>
          )}
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
