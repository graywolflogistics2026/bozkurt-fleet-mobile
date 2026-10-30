import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, MutedText, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { useUpdateDeduction } from '@/src/data/deductions';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { findCategoriesOutOfSync } from '@/src/primeDriverExpenses/categoryMapping';
import { colors, spacing } from '@/src/theme';
import type { Deduction } from '@/src/types/db';

// "Categories out of sync (N)" (owner decision 2026-10-30, master plan batch
// A item 1): rows with an accountant category whose Deductions category is
// still Misc/Other/empty. A preview with a per-row Apply and Apply all;
// nothing changes on its own. Only `deductions.category` is written — the
// amount, tax flag and accountant category stay as they are, so totals,
// profit, CPM and tax do not move.
export function CategorySyncCard({ deductions }: { deductions: Deduction[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const updateDeduction = useUpdateDeduction();
  const rows = useMemo(() => findCategoriesOutOfSync(deductions), [deductions]);
  const byId = useMemo(() => new Map(deductions.map((d) => [d.id, d])), [deductions]);
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) return null;

  async function apply(ids: string[]) {
    setBusy(true);
    try {
      for (const row of rows.filter((r) => ids.includes(r.id))) {
        await updateDeduction.mutateAsync({ id: row.id, values: { category: row.to } });
      }
      await invalidateFinancialData(queryClient, { entities: ['deductions'] });
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: spacing.sm, borderColor: colors.accent, borderWidth: 2 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('categorySync.cardTitle', { count: rows.length })}</Text>
      <MutedText style={{ marginTop: spacing.xs }}>{t('categorySync.cardBody')}</MutedText>
      {rows.map((row) => {
        const d = byId.get(row.id);
        return (
          <View key={row.id} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
            <Text style={{ color: colors.text }} numberOfLines={1}>
              {d?.description || d?.store || row.accountantCategory} · {d?.ded_date ?? ''}
            </Text>
            <MutedText>{t('categorySync.rowLine', { from: row.from || '—', to: row.to, accountant: row.accountantCategory })}</MutedText>
            <SecondaryButton title={t('categorySync.apply')} onPress={() => apply([row.id])} disabled={busy} />
          </View>
        );
      })}
      <PrimaryButton title={t('categorySync.applyAll')} onPress={() => apply(rows.map((r) => r.id))} disabled={busy} />
    </Card>
  );
}
