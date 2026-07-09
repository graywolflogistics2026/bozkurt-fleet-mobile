import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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
  const drawsLabel = isScorp ? 'Distributions' : 'Draws';
  const drawSingular = isScorp ? 'distribution' : 'draw';

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
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSavingDraw(false);
    }
  }

  function handleDeleteDraw(id: string) {
    Alert.alert(`Delete this ${drawSingular}?`, 'Made a typo? This is how to fix it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTx.mutateAsync(id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert('Delete failed', err instanceof Error ? err.message : 'Please try again.');
          }
        },
      },
    ]);
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
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSavingBalance(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>Capital Account</ScreenTitle>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <MutedText>Contributed</MutedText>
              <Text style={styles.statValue}>{summary ? money(summary.effectiveContribution) : '—'}</Text>
            </View>
            <View>
              <MutedText>{drawsLabel}</MutedText>
              <Text style={styles.statValue}>{summary ? money(summary.totalDraws) : '—'}</Text>
            </View>
            <View>
              <MutedText>Tax-Free Left</MutedText>
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
          <MutedText>Business Balance</MutedText>
          <Text style={styles.statValue}>{money(summary?.businessBalance ?? 0)}</Text>
        </TappableCard>

        <SecondaryButton
          title={`➖ Record ${isScorp ? 'Distribution' : 'Draw'}`}
          onPress={() => setDrawModalOpen(true)}
        />
        <SecondaryButton title="🏦 Update Business Balance" onPress={() => setBalanceModalOpen(true)} />

        <View style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
          <Text style={styles.sectionTitle}>History</Text>
        </View>
        <Card>
          {history.length === 0 ? (
            <MutedText>No {drawsLabel.toLowerCase()} or contributions yet</MutedText>
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
          <MutedText>
            🔗 Contributions are linked to a source deduction — tap one, or edit its payment method on the
            Deductions tab, to change it.
          </MutedText>
        )}
      </ScrollView>

      <ModalSheet visible={drawModalOpen} onClose={() => setDrawModalOpen(false)}>
        <SheetTitle>➖ Record {isScorp ? 'Distribution' : 'Draw'}</SheetTitle>
        <MutedText>Amount ($)</MutedText>
        <Field keyboardType="numeric" value={drawAmount} onChangeText={setDrawAmount} placeholder="0.00" />
        <MutedText>Note (optional)</MutedText>
        <Field value={drawNote} onChangeText={setDrawNote} placeholder="e.g. Personal transfer" />
        <PrimaryButton title="💾 Save" onPress={handleRecordDraw} loading={savingDraw} disabled={!drawAmount} />
        <SecondaryButton title="Cancel" onPress={() => setDrawModalOpen(false)} />
      </ModalSheet>

      <ModalSheet visible={balanceModalOpen} onClose={() => setBalanceModalOpen(false)}>
        <SheetTitle>🏦 Update Business Balance</SheetTitle>
        <MutedText>Current business checking account balance ($)</MutedText>
        <Field keyboardType="numeric" value={balanceInput} onChangeText={setBalanceInput} placeholder="0.00" />
        <PrimaryButton title="💾 Save" onPress={handleUpdateBalance} loading={savingBalance} disabled={!balanceInput} />
        <SecondaryButton title="Cancel" onPress={() => setBalanceModalOpen(false)} />
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
