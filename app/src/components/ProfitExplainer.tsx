import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/src/i18n/format';
import { Card, MutedText } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { OwnExpenseRow, PossibleDuplicate, ProfitExplanation } from '@/src/stats/profitExplainer';
import { explanationSentence, type ExplainerWhen } from '@/src/stats/profitExplainerText';
import type { LedgerTable } from '@/src/stats/auditLedger';
import { DuplicateKeepNotInstalledError, keepPossibleDuplicate, type KeepableTable } from '@/src/data/profitExplainerMutations';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useDeleteDeduction } from '@/src/data/deductions';
import { useDeleteFuelPurchase } from '@/src/data/fuelPurchases';
import { useDeleteMaintenanceRecord } from '@/src/data/maintenanceRecords';
import { useDeleteToll } from '@/src/data/tolls';

// PROFIT EXPLAINER (owner decision 2026-10-30, batch D item 8) — the UI
// for src/stats/profitExplainer.ts. `ProfitExplainerLine` is the one-line
// caption (Home, Settlements banner, AI Coach review); `ProfitExplainerCard`
// is the full three-layer view (bridge sheet, settlement detail). Own
// expenses are neutral information; amber only for a real mismatch with
// the carrier's printed numbers or an unexplained difference.

const toneColor = (e: ProfitExplanation) => (e.tone === 'warning' ? colors.orange : colors.text);

export function ProfitExplainerLine({ explanation, when, onPress }: { explanation: ProfitExplanation | null | undefined; when: ExplainerWhen; onPress?: () => void }) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  if (!explanation) return null;
  const text = explanationSentence(explanation, (k, o) => t(k, o) as string, money, when);
  if (!text) return null;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'}>
      <Text style={{ color: explanation.tone === 'warning' ? colors.orange : colors.text, fontSize: typography.size.md, lineHeight: 19, marginBottom: spacing.sm }}>
        {explanation.tone === 'warning' ? '⚠ ' : 'ⓘ '}
        {text}
      </Text>
    </Pressable>
  );
}

const EDIT_ROUTE: Partial<Record<LedgerTable, string>> = {
  deductions: '/(tabs)/deductions',
  maintenance_records: '/(tabs)/more/maintenance',
  fuel_purchases: '/(tabs)/more/fuel',
  tolls: '/(tabs)/more/tolls',
  reimbursements: '/(tabs)/more/reimbursements',
};

export function ProfitExplainerCard({
  explanation,
  when,
  onNavigate,
}: {
  explanation: ProfitExplanation | null | undefined;
  when: ExplainerWhen;
  // Called before leaving the screen (e.g. to close the sheet this sits in).
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showRows, setShowRows] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const deleteDeduction = useDeleteDeduction();
  const deleteFuel = useDeleteFuelPurchase();
  const deleteMaintenance = useDeleteMaintenanceRecord();
  const deleteToll = useDeleteToll();
  if (!explanation) return null;
  const e = explanation;
  const sentence = explanationSentence(e, (k, o) => t(k, o) as string, money, when);

  function openRow(row: OwnExpenseRow) {
    const pathname = EDIT_ROUTE[row.table];
    if (!pathname) return;
    onNavigate?.();
    router.push({ pathname, params: row.rowId ? { openId: row.rowId } : {} } as unknown as Href);
  }

  async function keep(d: PossibleDuplicate) {
    if (!d.own.rowId) return;
    setBusy(d.own.key);
    try {
      await keepPossibleDuplicate(d.own.table as KeepableTable, d.own.rowId);
      await invalidateFinancialData(queryClient, { entities: [d.own.table] });
    } catch (err) {
      Alert.alert(t('profitExplainer.keepFailed'), err instanceof DuplicateKeepNotInstalledError ? t('profitExplainer.needsDb') : err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setBusy(null);
    }
  }

  function remove(d: PossibleDuplicate) {
    const id = d.own.rowId;
    if (!id) return;
    Alert.alert(t('profitExplainer.removeConfirmTitle'), t('profitExplainer.removeConfirmBody', { label: d.own.label || d.own.category || '—', amount: money(d.own.amount) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profitExplainer.remove'),
        style: 'destructive',
        onPress: async () => {
          setBusy(d.own.key);
          try {
            if (d.own.table === 'deductions') await deleteDeduction.mutateAsync(id);
            else if (d.own.table === 'fuel_purchases') await deleteFuel.mutateAsync(id);
            else if (d.own.table === 'maintenance_records') await deleteMaintenance.mutateAsync(id);
            else if (d.own.table === 'tolls') await deleteToll.mutateAsync(id);
            await invalidateFinancialData(queryClient, { entities: [d.own.table] });
          } catch (err) {
            Alert.alert(t('profitExplainer.removeFailed'), err instanceof Error ? err.message : t('common.tryAgain'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <Card style={{ marginBottom: spacing.sm, borderColor: e.tone === 'warning' ? colors.orange : colors.border }}>
      <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>{t('profitExplainer.title')}</Text>
      {!!sentence && <Text style={{ color: toneColor(e), lineHeight: 19, marginBottom: spacing.sm }}>{sentence}</Text>}

      <Row
        label={t('profitExplainer.settlements')}
        badge={e.settlementsLabel ? t(`profitExplainer.label.${e.settlementsLabel}`) : null}
        value={money(e.settlementsProfit)}
      />
      <Pressable onPress={() => setShowRows((v) => !v)} disabled={e.ownExpenses.count === 0} accessibilityRole="button">
        <Row
          label={`− ${t('profitExplainer.own')}`}
          badge={t('profitExplainer.ownCount', { count: e.ownExpenses.count })}
          value={money(e.ownExpenses.total)}
          hint={e.ownExpenses.count > 0 ? (showRows ? t('profitExplainer.hideRows') : t('profitExplainer.showRows')) : null}
        />
      </Pressable>
      {showRows &&
        e.ownExpenses.rows.map((r) => (
          <Pressable key={r.key} onPress={() => openRow(r)} accessibilityRole="button" style={{ paddingStart: spacing.md, paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                {r.date ? `${date(r.date)} · ` : ''}
                {r.label || r.category || '—'}
              </Text>
              <Text style={{ color: colors.text }}>{money(r.amount)} ›</Text>
            </View>
          </Pressable>
        ))}
      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs }}>
        <Row label={`= ${t('profitExplainer.result')}`} value={money(e.profit)} strong />
      </View>
      {e.residual !== 0 && (
        <Text style={{ color: colors.orange, fontWeight: '700', marginTop: spacing.xs }}>
          ⚠ {t('profitExplainer.unexplained', { amount: money(Math.abs(e.residual)) })}
        </Text>
      )}

      {e.possibleDuplicates.map((d) => (
        <View key={d.own.key} style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.orange }}>
          <Text style={{ color: colors.orange, fontWeight: '700' }}>{t('profitExplainer.duplicateTitle')}</Text>
          <Text style={{ color: colors.text, marginVertical: 4 }}>
            {t('profitExplainer.duplicateBody', { amount: money(d.own.amount), date: d.own.date ? date(d.own.date) : '—', label: d.withheld.label || d.withheld.category || '—' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <SmallButton title={t('profitExplainer.keep')} onPress={() => void keep(d)} disabled={busy === d.own.key} />
            <SmallButton title={t('profitExplainer.remove')} onPress={() => remove(d)} disabled={busy === d.own.key} danger />
          </View>
        </View>
      ))}

      {e.notCounted.length > 0 && (
        <View style={{ marginTop: spacing.sm }}>
          <MutedText style={{ fontWeight: '700' }}>{t('profitExplainer.notCountedTitle')}</MutedText>
          {e.notCounted.map((r) => (
            <MutedText key={r.key}>
              {r.label || r.category || '—'} · {money(r.amount)} — {t(`profitExplainer.reason.${r.reason}`, { defaultValue: t('profitExplainer.reason.non_deductible') })}
            </MutedText>
          ))}
        </View>
      )}
      <MutedText style={{ marginTop: spacing.sm }}>{t('profitExplainer.depositLine')}</MutedText>
    </Card>
  );
}

function Row({ label, value, badge, hint, strong }: { label: string; value: string; badge?: string | null; hint?: string | null; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: strong ? '800' : '600' }}>{label}</Text>
        {(!!badge || !!hint) && (
          <MutedText style={{ fontSize: typography.size.xs }}>{[badge, hint].filter(Boolean).join(' · ')}</MutedText>
        )}
      </View>
      <Text style={{ color: colors.text, fontWeight: strong ? '800' : '600' }}>{value}</Text>
    </View>
  );
}

function SmallButton({ title, onPress, disabled, danger }: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: danger ? colors.red : colors.border, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: danger ? colors.red : colors.text, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}
