import { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MutedText, SecondaryButton } from '@/src/components/ui';
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';
import type { KpiResult } from '@/src/stats/kpi';
import { ledgerTotals, type LedgerRow, type LedgerStatus } from '@/src/stats/auditLedger';
import { buildAuditText, type AuditSettlement } from '@/src/stats/auditShare';

// PRIME STATEMENT AS SOURCE + SOURCE LABELS + PROFIT IS NEVER THE DEPOSIT
// (owner decision 2026-10-13, docs/decisions/prime-statement-source.md).
// Shared by Home (bridge + Expenses explainer) and the Settlements detail.

// Batch D2 2.3: no Verified / Totals match / Unverified badge anywhere —
// the only week status is "Certified on <date>" (WeekReviewCard.tsx).

const STATUS_ORDER: LedgerStatus[] = ['counted', 'offset', 'excluded'];

// Every row, grouped COUNTED / OFFSET / EXCLUDED, each with its reason.
// `onDeleteDeduction` (optional) shows a delete button on real deductions rows.
export function LedgerList({
  rows,
  onDeleteDeduction,
  deletingId,
}: {
  rows: LedgerRow[];
  onDeleteDeduction?: (id: string) => void;
  deletingId?: string | null;
}) {
  const { t } = useTranslation();
  const { money: moneyFmt } = useFormatters();
  const money = (n: number) => moneyFmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (rows.length === 0) return <MutedText>{t('audit.empty')}</MutedText>;
  return (
    <View>
      {STATUS_ORDER.map((status) => {
        const group = rows.filter((r) => r.status === status).sort((a, b) => b.amount - a.amount);
        if (group.length === 0) return null;
        const total = group.reduce((s, r) => s + r.amount, 0);
        return (
          <View key={status} style={{ marginTop: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{t(`audit.statusTitle.${status}`)}</Text>
              <Text style={{ color: colors.text, fontWeight: '700' }}>
                {status === 'offset' ? '− ' : ''}
                {money(total)}
              </Text>
            </View>
            {group.map((r) => (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flex: 1, marginEnd: spacing.sm }}>
                  <Text style={{ color: colors.text }} numberOfLines={2}>
                    {r.label || r.category || '—'}
                  </Text>
                  <MutedText style={{ fontSize: typography.size.xs }}>
                    {t(`audit.source.${r.source}`)} · {t(`audit.reason.${r.reason}`)}
                  </MutedText>
                </View>
                <Text style={{ color: colors.text, fontWeight: '600', marginEnd: onDeleteDeduction && r.deductionId ? spacing.sm : 0 }}>{money(r.amount)}</Text>
                {onDeleteDeduction && r.deductionId && (
                  <Pressable onPress={() => onDeleteDeduction(r.deductionId!)} hitSlop={8} disabled={deletingId === r.deductionId}>
                    <Text style={{ color: colors.red, fontWeight: '700' }}>{deletingId === r.deductionId ? '…' : '🗑️'}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function ShareAuditButton({ kpi, settlements }: { kpi: KpiResult; settlements: AuditSettlement[] }) {
  const { t } = useTranslation();
  const { money: moneyFmt, dateTime } = useFormatters();
  const money = (n: number) => moneyFmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <SecondaryButton
      title={t('audit.shareAudit')}
      onPress={() => {
        void Share.share({ message: buildAuditText({ kpi, settlements, t: (k, o) => t(k, o), money, dateTime }) });
      }}
    />
  );
}

// PROFIT BRIDGE — how profit follows from what reached the bank:
// statement-backed Prime weeks start from the actual deposit, every other
// week from its net due; then every non-expense line added back, interest
// income as its own line, the owner's own expenses outside settlements,
// and any difference the saved lines can't explain (shown, never hidden).
export function ProfitBridgeView({
  kpi,
  settlements,
  truckExtrasNeedCostBasis,
}: {
  kpi: KpiResult;
  settlements: AuditSettlement[];
  // D6: OPERATOR TRK EXTRAS was excluded and the truck has no cost basis
  // or warranty entered — show the existing unlock nudge.
  truckExtrasNeedCostBasis: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { money: moneyFmt, date } = useFormatters();
  const money = (n: number) => moneyFmt(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [showRows, setShowRows] = useState(false);
  const bridge = kpi.bridge;

  type Row = { key: string; label: string; why: string; amount: number; sign: '' | '+' | '−'; tone?: string };
  const rows: Row[] = [];
  if (Math.abs(bridge.depositStart) >= 0.005) {
    rows.push({ key: 'deposit', label: t('dashboard.profitBridge.deposit'), why: t('dashboard.profitBridge.depositWhy'), amount: bridge.depositStart, sign: '' });
  }
  if (Math.abs(bridge.netPay) >= 0.005 || rows.length === 0) {
    rows.push({ key: 'net', label: t('dashboard.profitBridge.netPay'), why: t('dashboard.profitBridge.netPayWhy'), amount: bridge.netPay, sign: rows.length ? '+' : '' });
  }
  if (Math.abs(bridge.balanceForward) >= 0.005) {
    rows.push({
      key: 'balanceForward',
      label: t('dashboard.profitBridge.balanceForward'),
      why: t('dashboard.profitBridge.balanceForwardWhy'),
      amount: Math.abs(bridge.balanceForward),
      sign: bridge.balanceForward >= 0 ? '+' : '−',
    });
  }
  const whyFor = (reason: string) => t(`audit.reason.${reason}`);
  bridge.statementAddBacks.forEach((a, i) =>
    rows.push({ key: `sa-${i}`, label: a.label, why: whyFor(a.reason), amount: Math.abs(a.amount), sign: a.amount >= 0 ? '+' : '−' })
  );
  bridge.nonExpenseLines.forEach((l, i) =>
    rows.push({
      key: `ne-${i}`,
      label: l.description,
      why:
        l.category === 'Escrow & Deposits'
          ? t('dashboard.profitBridge.whyEscrow')
          : l.category === 'Meals (per diem covered)'
            ? t('dashboard.profitBridge.whyMeal')
            : t('dashboard.profitBridge.whyAdvance'),
      amount: l.amount,
      sign: '+',
    })
  );
  if (Math.abs(bridge.interestIncome) >= 0.005) {
    rows.push({ key: 'interest', label: t('dashboard.profitBridge.interestIncome'), why: t('dashboard.profitBridge.interestIncomeWhy'), amount: bridge.interestIncome, sign: '−' });
  }
  const optional: [string, number, '+' | '−', string, string][] = [
    ['oop', bridge.outOfPocketDeductions, '−', t('dashboard.profitBridge.outOfPocket'), t('dashboard.profitBridge.outOfPocketWhy')],
    ['fuel', bridge.standaloneFuel, '−', t('dashboard.profitBridge.standaloneFuel'), t('dashboard.profitBridge.standaloneFuelWhy')],
    ['maint', bridge.maintenance, '−', t('dashboard.profitBridge.maintenance'), t('dashboard.profitBridge.maintenanceWhy')],
    ['tolls', bridge.tolls, '−', t('dashboard.profitBridge.tolls'), t('dashboard.profitBridge.tollsWhy')],
    ['reimb', bridge.reimbursementsNotOnSettlement, '+', t('dashboard.profitBridge.reimbursements'), t('dashboard.profitBridge.reimbursementsWhy')],
  ];
  for (const [key, amount, sign, label, why] of optional) {
    if (Math.abs(amount) >= 0.005) rows.push({ key, label, why, amount, sign });
  }
  if (bridge.difference !== 0) {
    rows.push({
      key: 'diff',
      label: t('dashboard.profitBridge.difference'),
      why: t('dashboard.profitBridge.differenceWhy'),
      amount: Math.abs(bridge.difference),
      sign: bridge.difference > 0 ? '+' : '−',
      tone: colors.orange,
    });
  }

  return (
    <View>
      {bridge.weeks.length > 0 && (
        <View style={{ marginBottom: spacing.sm }}>
          {bridge.weeks.map((w) => (
            <View key={w.settlementId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <MutedText>{w.weekEnding ? t('settlementsScreen.weekOf', { date: date(w.weekEnding) }) : '—'}</MutedText>
            </View>
          ))}
        </View>
      )}
      {rows.map((r, i) => (
        <View key={r.key} style={[{ paddingVertical: spacing.xs }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: r.tone ?? colors.text, fontWeight: '600', flex: 1, marginEnd: spacing.sm }}>{r.label}</Text>
            <Text style={{ color: r.tone ?? colors.text, fontWeight: '700' }}>
              {r.sign ? `${r.sign} ` : ''}
              {money(r.amount)}
            </Text>
          </View>
          <MutedText style={{ fontSize: typography.size.xs }}>{r.why}</MutedText>
        </View>
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: colors.text, paddingTop: spacing.xs, marginTop: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>
          {bridge.estimateFromLineItems ? t('dashboard.profitBridge.profitEstimate') : t('dashboard.profitBridge.profit')}
        </Text>
        <Text style={{ color: bridge.profit < 0 ? colors.red : colors.green, fontWeight: '700' }}>{money(bridge.profit)}</Text>
      </View>
      {bridge.crossChecks.map((c) => (
        <MutedText key={c.settlementId} style={{ marginTop: spacing.xs, color: colors.orange }}>
          {t('dashboard.profitBridge.crossCheck', { amount: money(Math.abs(c.difference)), date: c.weekEnding ? date(c.weekEnding) : '—' })}
        </MutedText>
      ))}
      <MutedText style={{ marginTop: spacing.sm, fontSize: typography.size.xs }}>{t('dashboard.profitBridge.reimbursementNote')}</MutedText>
      {bridge.fixedCostEstimateInCpm > 0 && (
        <MutedText style={{ marginTop: spacing.xs, fontSize: typography.size.xs }}>
          {t('dashboard.profitBridge.fixedCostNote', { amount: money(bridge.fixedCostEstimateInCpm) })}
        </MutedText>
      )}
      {truckExtrasNeedCostBasis && (
        <Pressable onPress={() => router.push('/(tabs)/more/trucks')}>
          <MutedText style={{ marginTop: spacing.xs, color: colors.accent }}>{t('scorecard.whyFixedSpreadNotSet')}</MutedText>
        </Pressable>
      )}
      <SecondaryButton title={showRows ? t('audit.hideRows') : t('audit.showEveryRow')} onPress={() => setShowRows((v) => !v)} />
      {showRows && (
        <View>
          <LedgerList rows={kpi.ledger} />
          <MutedText style={{ marginTop: spacing.xs }}>
            {t('audit.totalsLine', {
              counted: money(ledgerTotals(kpi.ledger).counted),
              offset: money(ledgerTotals(kpi.ledger).offset),
              expenses: money(kpi.expenses.total),
            })}
          </MutedText>
        </View>
      )}
      <ShareAuditButton kpi={kpi} settlements={settlements} />
    </View>
  );
}

// D6 helper: was OPERATOR TRK EXTRAS excluded in this period?
export function hasExcludedTruckExtras(kpi: KpiResult | null | undefined): boolean {
  return !!kpi?.ledger.some((r) => r.reason === 'truck_extras' && r.amount > 0);
}
