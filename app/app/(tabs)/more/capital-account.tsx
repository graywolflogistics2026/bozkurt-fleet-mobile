import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useCapitalAccountSummary, useUpdateBusinessBalance } from '@/src/data/capitalAccount';
import { useCapitalTransactions, useInsertCapitalTransaction, useDeleteCapitalTransaction } from '@/src/data/capitalTransactions';
import { useTaxConfig } from '@/src/data/taxConfig';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import {
  Screen,
  ScreenTitle,
  Card,
  TappableCard,
  MutedText,
  ModalSheet,
  SheetTitle,
  Field,
  PrimaryButton,
  SecondaryButton,
} from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { CapitalTransaction } from '@/src/types/db';

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function HistoryRow({
  tx,
  onDeleteDraw,
  onTapContribution,
}: {
  tx: CapitalTransaction;
  onDeleteDraw: () => void;
  onTapContribution: () => void;
}) {
  const isDraw = tx.tx_type === 'draw';
  const content = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <MutedText>
          {tx.tx_date}
          {tx.note ? ` — ${tx.note}` : ''}
        </MutedText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ color: isDraw ? colors.red : colors.green, fontWeight: '700' }}>
          {isDraw ? '-' : '+'}
          {money(tx.amount)}
        </Text>
        {isDraw ? (
          <Pressable onPress={onDeleteDraw} hitSlop={8}>
            <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700', paddingHorizontal: 4 }}>
              ✕
            </Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.muted, fontSize: typography.size.md }}>🔗</Text>
        )}
      </View>
    </View>
  );

  if (isDraw) return content;
  return <Pressable onPress={onTapContribution}>{content}</Pressable>;
}

export default function CapitalAccount() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  const summaryQuery = useCapitalAccountSummary();
  const txQuery = useCapitalTransactions();
  const taxConfigQuery = useTaxConfig();
  const insertTx = useInsertCapitalTransaction();
  const deleteTx = useDeleteCapitalTransaction();
  const updateBalance = useUpdateBusinessBalance();

  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawAmount, setDrawAmount] = useState('');
  const [drawNote, setDrawNote] = useState('');
  const [savingDraw, setSavingDraw] = useState(false);

  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);

  const summary = summaryQuery.data;
  const isScorp = taxConfigQuery.data?.entity_type === 'scorp';
  const drawsLabel = isScorp ? t('capitalAccount.distributions') : t('capitalAccount.draws');

  const rows = txQuery.data ?? [];
  const history = useMemo(
    () => [...rows].sort((a, b) => new Date(b.tx_date).getTime() - new Date(a.tx_date).getTime()),
    [rows]
  );

  async function handleRecordDraw() {
    const amount = Number(drawAmount) || 0;
    if (amount <= 0 || !userId) return;
    setSavingDraw(true);
    try {
      await insertTx.mutateAsync({
        user_id: userId,
        tx_type: 'draw',
        amount,
        tx_date: new Date().toISOString().slice(0, 10),
        note: drawNote || null,
      });
      await invalidateFinancialData(queryClient);
      setDrawModalOpen(false);
      setDrawAmount('');
      setDrawNote('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingDraw(false);
    }
  }

  function handleDeleteDraw(id: string) {
    const drawSingular = isScorp ? t('capitalAccount.distributionSingular') : t('capitalAccount.drawSingular');
    Alert.alert(
      t('capitalAccount.deleteDrawConfirmTitle', { label: drawSingular }),
      t('capitalAccount.deleteDrawConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTx.mutateAsync(id);
              await invalidateFinancialData(queryClient);
            } catch (err) {
              Alert.alert(t('capitalAccount.deleteFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
            }
          },
        },
      ]
    );
  }

  async function handleUpdateBalance() {
    const bal = Number(balanceInput);
    if (!Number.isFinite(bal) || bal < 0 || !userId) return;
    setSavingBalance(true);
    try {
      await updateBalance.mutateAsync(bal);
      await invalidateFinancialData(queryClient);
      setBalanceModalOpen(false);
      setBalanceInput('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingBalance(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('capitalAccount.title')}</ScreenTitle>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <MutedText>{t('capitalAccount.contributed')}</MutedText>
              <Text style={styles.statValue}>{summary ? money(summary.effectiveContribution) : '—'}</Text>
            </View>
            <View>
              <MutedText>{drawsLabel}</MutedText>
              <Text style={styles.statValue}>{summary ? money(summary.totalDraws) : '—'}</Text>
            </View>
            <View>
              <MutedText>{t('capitalAccount.taxFreeLeft')}</MutedText>
              <Text
                style={[
                  styles.statValue,
                  {
                    color:
                      summary && summary.effectiveContribution - summary.totalDraws > 0 ? colors.green : colors.red,
                  },
                ]}
              >
                {summary ? money(summary.taxFreeRemaining) : '—'}
              </Text>
            </View>
          </View>
        </Card>

        <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
          <MutedText>{t('capitalAccount.businessBalance')}</MutedText>
          <Text style={styles.statValue}>{money(summary?.businessBalance ?? 0)}</Text>
        </TappableCard>

        <SecondaryButton
          title={isScorp ? t('capitalAccount.recordDistribution') : t('capitalAccount.recordDraw')}
          onPress={() => setDrawModalOpen(true)}
        />
        <SecondaryButton title={t('capitalAccount.updateBusinessBalance')} onPress={() => setBalanceModalOpen(true)} />

        <View style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
          <Text style={styles.sectionTitle}>{t('capitalAccount.historyTitle')}</Text>
        </View>
        <Card>
          {history.length === 0 ? (
            <MutedText>{t('capitalAccount.historyEmpty', { label: drawsLabel })}</MutedText>
          ) : (
            history.map((tx, i) => (
              <View key={tx.id} style={i > 0 ? styles.rowBorder : undefined}>
                <HistoryRow
                  tx={tx}
                  onDeleteDraw={() => handleDeleteDraw(tx.id)}
                  onTapContribution={() => router.push('/(tabs)/deductions')}
                />
              </View>
            ))
          )}
        </Card>
        {summary && summary.contributionCount > 0 && (
          <MutedText>{t('capitalAccount.linkedNote')}</MutedText>
        )}
      </ScrollView>

      <ModalSheet visible={drawModalOpen} onClose={() => setDrawModalOpen(false)}>
        <SheetTitle>{isScorp ? t('capitalAccount.recordDistributionSheetTitle') : t('capitalAccount.recordDrawSheetTitle')}</SheetTitle>
        <MutedText>{t('capitalAccount.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={drawAmount} onChangeText={setDrawAmount} placeholder="0.00" />
        <MutedText>{t('capitalAccount.noteLabel')}</MutedText>
        <Field value={drawNote} onChangeText={setDrawNote} placeholder={t('capitalAccount.notePlaceholder')} />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleRecordDraw} loading={savingDraw} disabled={!drawAmount} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setDrawModalOpen(false)} />
      </ModalSheet>

      <ModalSheet visible={balanceModalOpen} onClose={() => setBalanceModalOpen(false)}>
        <SheetTitle>{t('capitalAccount.updateBalanceSheetTitle')}</SheetTitle>
        <MutedText>{t('capitalAccount.updateBalanceLabel')}</MutedText>
        <Field keyboardType="numeric" value={balanceInput} onChangeText={setBalanceInput} placeholder="0.00" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleUpdateBalance} loading={savingBalance} disabled={!balanceInput} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setBalanceModalOpen(false)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  statValue: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
};
