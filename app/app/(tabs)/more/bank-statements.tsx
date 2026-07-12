import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useBankStatements, useBankTransactions, useDeleteBankStatement } from '@/src/data/bankStatements';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { BankStatement, BankTransaction } from '@/src/types/db';

// View-only (PROMPTS.md Session 9a, "no double-count — same invariant as
// web"): a bank/card statement's transactions are ai-import-derived
// reference data only, never hand-edited and never a second place a user
// re-enters an expense that's already tracked as a deduction elsewhere —
// there is deliberately no manual-add form here (docs/PENDING_SQL.md §22).
function TransactionRow({ x }: { x: BankTransaction }) {
  const { money, date } = useFormatters();
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.description ?? '—'}
        </Text>
        <MutedText>
          {x.tx_date ? date(x.tx_date) : '—'}
          {x.category ? ` · ${x.category}` : ''}
          {x.deductible ? ` · ${t('bankStatements.deductibleTag')}` : ''}
        </MutedText>
      </View>
      <Text
        style={{
          fontWeight: '700',
          fontSize: typography.size.md,
          color: x.tx_type === 'deposit' || x.tx_type === 'payment' ? colors.green : colors.text,
        }}
      >
        {money(x.amount ?? 0)}
      </Text>
    </View>
  );
}

export default function BankStatements() {
  const { t } = useTranslation();
  const statementsQuery = useBankStatements();
  const allTransactionsQuery = useBankTransactions();
  const deleteStatement = useDeleteBankStatement();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [viewing, setViewing] = useState<BankStatement | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const statements = useMemo(() => {
    const list = statementsQuery.data ?? [];
    return [...list].sort((a, b) => (b.statement_month ?? '').localeCompare(a.statement_month ?? ''));
  }, [statementsQuery.data]);

  const cardStatements = statements.filter((s) => s.account_type === 'card');
  const checkingStatements = statements.filter((s) => s.account_type === 'checking');

  const viewingTransactions = useMemo(() => {
    if (!viewing) return [];
    return (allTransactionsQuery.data ?? [])
      .filter((x) => x.statement_id === viewing.id)
      .sort((a, b) => (b.tx_date ?? '').localeCompare(a.tx_date ?? ''));
  }, [viewing, allTransactionsQuery.data]);

  function handleDelete(x: BankStatement) {
    Alert.alert(t('bankStatements.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteStatement.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
            setViewing(null);
          } catch (err) {
            Alert.alert(t('bankStatements.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  function StatementSection({ title, list }: { title: string; list: BankStatement[] }) {
    return (
      <>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Card>
          {list.length === 0 ? (
            <MutedText>{t('bankStatements.empty')}</MutedText>
          ) : (
            list.map((s, i) => (
              <Pressable key={s.id} onPress={() => setViewing(s)} style={[styles.row, i > 0 && styles.rowBorder]}>
                <Text style={styles.desc}>{s.statement_month ?? '—'}</Text>
                <Text style={{ color: colors.muted, fontSize: 20, fontWeight: '300' }}>›</Text>
              </Pressable>
            ))
          )}
        </Card>
      </>
    );
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ScreenTitle>{t('bankStatements.title')}</ScreenTitle>
        <MutedText>{t('bankStatements.subtitle')}</MutedText>

        {statementsQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <StatementSection title={t('bankStatements.checkingTitle')} list={checkingStatements} />
            <StatementSection title={t('bankStatements.cardTitle')} list={cardStatements} />
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!viewing} onClose={() => setViewing(null)}>
        <SheetTitle>{viewing?.statement_month ?? ''}</SheetTitle>
        <ScrollView style={{ maxHeight: 360 }}>
          {viewingTransactions.length === 0 ? (
            <MutedText>{t('bankStatements.noTransactions')}</MutedText>
          ) : (
            viewingTransactions.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <TransactionRow x={x} />
              </View>
            ))
          )}
        </ScrollView>
        {viewing && (
          <Pressable onPress={() => handleDelete(viewing)} hitSlop={8} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>
              {t('bankStatements.deleteStatement')}
            </Text>
          </Pressable>
        )}
        <SecondaryButton title={t('common.close')} onPress={() => setViewing(null)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  desc: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '600' as const,
  },
};
