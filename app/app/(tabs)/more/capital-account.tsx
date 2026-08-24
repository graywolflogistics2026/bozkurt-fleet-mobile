import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useCapitalAccountSummary, useUpdateBusinessBalance } from '@/src/data/capitalAccount';
import {
  useCapitalTransactions,
  useDeleteManualCapitalTransaction,
  useRecordManualCapitalTransaction,
} from '@/src/data/capitalTransactions';
import { useTaxConfig } from '@/src/data/taxConfig';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { findDuplicateTransactionIds, summarizeContributions, summarizeCapitalFlows } from '@/src/stats/capitalAccount';
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
import { useFormatters } from '@/src/i18n/format';
import { colors, spacing, typography } from '@/src/theme';
import type { CapitalTransaction } from '@/src/types/db';

function HistoryRow({
  tx,
  onDeleteDraw,
  onDeleteContribution,
  onTapContribution,
}: {
  tx: CapitalTransaction;
  onDeleteDraw: () => void;
  onDeleteContribution: () => void;
  onTapContribution: () => void;
}) {
  const { money } = useFormatters();
  const isDraw = tx.tx_type === 'draw';
  // FULL PARITY pass (owner decision 2026-08-05, spec item E.1) — a
  // LINKED contribution (auto-created from a personally-paid deduction)
  // stays read-only here (🔗, tap through to the deduction, "edit the
  // deduction instead"); a MANUAL cash contribution is a real row this
  // screen owns and must be deletable, same as a draw.
  const isLinkedContribution = !isDraw && !!tx.linked_deduction_id;
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
        {isLinkedContribution ? (
          <Text style={{ color: colors.muted, fontSize: typography.size.md }}>🔗</Text>
        ) : (
          <Pressable onPress={isDraw ? onDeleteDraw : onDeleteContribution} hitSlop={8}>
            <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700', paddingHorizontal: 4 }}>
              ✕
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  if (!isLinkedContribution) return content;
  return <Pressable onPress={onTapContribution}>{content}</Pressable>;
}

// One flow row: label + amount + a one-line explainer the owner can repeat
// to an accountant verbatim (owner decision 2026-08-24, FIVE ADDITIONS
// pass, PART 2 item 2).
function FlowRow({
  label,
  explainer,
  amount,
  color,
  bordered,
}: {
  label: string;
  explainer: string;
  amount: string;
  color: string;
  bordered?: boolean;
}) {
  return (
    <View style={[{ paddingVertical: spacing.sm }, bordered ? styles.rowBorder : undefined]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontWeight: '700' }}>{amount}</Text>
      </View>
      <MutedText style={{ marginTop: 2 }}>{explainer}</MutedText>
    </View>
  );
}

export default function CapitalAccount() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  const summaryQuery = useCapitalAccountSummary();
  const txQuery = useCapitalTransactions();
  const taxConfigQuery = useTaxConfig();
  // FULL PARITY pass (owner decision 2026-08-05, spec item E.3) — manual
  // draws/contributions from THIS screen apply a real business_balance
  // delta (useRecordManualCapitalTransaction/useDeleteManualCapitalTransaction);
  // a LINKED contribution never reaches this screen's own insert/delete
  // path (it's read-only here, auto-synced from deductionMutations.ts).
  const insertTx = useRecordManualCapitalTransaction();
  const deleteTx = useDeleteManualCapitalTransaction();
  const updateBalance = useUpdateBusinessBalance();

  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawAmount, setDrawAmount] = useState('');
  const [drawNote, setDrawNote] = useState('');
  const [savingDraw, setSavingDraw] = useState(false);

  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionNote, setContributionNote] = useState('');
  const [savingContribution, setSavingContribution] = useState(false);

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
  const contributionBreakdown = useMemo(
    () => summarizeContributions(rows.filter((t) => t.tx_type === 'contribution')),
    [rows]
  );
  // PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
  // ADDITIONS pass, PART 2 item 2) — the 4 distinct flows, each with its
  // own total, computed directly off the full transaction history.
  const capitalFlows = useMemo(() => summarizeCapitalFlows(rows), [rows]);
  const duplicateIds = useMemo(() => findDuplicateTransactionIds(rows), [rows]);
  const isPastCapital = !!summary && summary.effectiveContribution - summary.totalDraws < 0;

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

  function handleDeleteDraw(tx: CapitalTransaction) {
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
              await deleteTx.mutateAsync(tx);
              await invalidateFinancialData(queryClient);
            } catch (err) {
              Alert.alert(t('capitalAccount.deleteFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
            }
          },
        },
      ]
    );
  }

  async function handleRecordContribution() {
    const amount = Number(contributionAmount) || 0;
    if (amount <= 0 || !userId) return;
    setSavingContribution(true);
    try {
      await insertTx.mutateAsync({
        user_id: userId,
        tx_type: 'contribution',
        amount,
        tx_date: new Date().toISOString().slice(0, 10),
        note: contributionNote || null,
      });
      await invalidateFinancialData(queryClient);
      setContributionModalOpen(false);
      setContributionAmount('');
      setContributionNote('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingContribution(false);
    }
  }

  function handleDeleteContribution(tx: CapitalTransaction) {
    Alert.alert(
      t('capitalAccount.deleteContributionConfirmTitle'),
      t('capitalAccount.deleteContributionConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTx.mutateAsync(tx);
              await invalidateFinancialData(queryClient);
            } catch (err) {
              Alert.alert(t('capitalAccount.deleteFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
            }
          },
        },
      ]
    );
  }

  function handleRemoveDuplicates() {
    const duplicates = history.filter((tx) => duplicateIds.includes(tx.id));
    if (duplicates.length === 0) {
      Alert.alert(t('capitalAccount.removeDuplicates'), t('capitalAccount.noDuplicatesFound'));
      return;
    }
    Alert.alert(
      t('capitalAccount.removeDuplicatesConfirmTitle', { count: duplicates.length }),
      t('capitalAccount.removeDuplicatesConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(duplicates.map((tx) => deleteTx.mutateAsync(tx)));
              await invalidateFinancialData(queryClient);
              Alert.alert(t('capitalAccount.removeDuplicates'), t('capitalAccount.duplicatesRemoved', { count: duplicates.length }));
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
          {isPastCapital && (
            <MutedText style={{ color: colors.red, marginTop: spacing.sm }}>
              ⚠️ {t('capitalAccount.pastCapitalWarning')}
            </MutedText>
          )}
        </Card>

        <TappableCard onPress={() => router.push('/(tabs)/more/cash-flow')}>
          <MutedText>{t('capitalAccount.businessBalance')}</MutedText>
          <Text style={styles.statValue}>{money(summary?.businessBalance ?? 0)}</Text>
        </TappableCard>

        <MutedText style={{ marginTop: spacing.xs }}>{t('capitalAccount.cashMovesNotTaxNote')}</MutedText>

        <SecondaryButton title={t('capitalAccount.recordContribution')} onPress={() => setContributionModalOpen(true)} />
        <SecondaryButton
          title={isScorp ? t('capitalAccount.recordDistribution') : t('capitalAccount.recordDraw')}
          onPress={() => setDrawModalOpen(true)}
        />
        <SecondaryButton title={t('capitalAccount.updateBusinessBalance')} onPress={() => setBalanceModalOpen(true)} />
        {duplicateIds.length > 0 && (
          <SecondaryButton title={t('capitalAccount.removeDuplicates')} onPress={handleRemoveDuplicates} />
        )}

        {/* PAYMENT SOURCE & CAPITAL CLARITY (owner decision 2026-08-24, FIVE
            ADDITIONS pass, PART 2 item 2) — the 4 distinct flows, each with
            its own total AND a one-line explanation the owner can repeat to
            an accountant verbatim. */}
        <View style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
          <Text style={styles.sectionTitle}>{t('capitalAccount.flowsTitle')}</Text>
        </View>
        <Card>
          <FlowRow
            label={t('capitalAccount.flowCashContributed')}
            explainer={t('capitalAccount.flowCashContributedExplainer')}
            amount={money(capitalFlows.cashContributed)}
            color={colors.green}
          />
          <FlowRow
            label={t('capitalAccount.flowOutstanding')}
            explainer={t('capitalAccount.flowOutstandingExplainer')}
            amount={money(capitalFlows.expensesPaidPersonallyOutstanding)}
            color={colors.green}
            bordered
          />
          <FlowRow
            label={t('capitalAccount.flowReimbursements')}
            explainer={t('capitalAccount.flowReimbursementsExplainer')}
            amount={money(capitalFlows.reimbursementsTakenBack)}
            color={colors.red}
            bordered
          />
          <FlowRow
            label={drawsLabel}
            explainer={t('capitalAccount.flowDrawsExplainer')}
            amount={money(capitalFlows.ownerDraws)}
            color={colors.red}
            bordered
          />
          <View style={[styles.rowBorder, { paddingTop: spacing.sm, marginTop: spacing.xs }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{t('capitalAccount.flowNetPosition')}</Text>
              <Text style={{ color: capitalFlows.netPosition >= 0 ? colors.green : colors.red, fontWeight: '700' }}>
                {money(capitalFlows.netPosition)}
              </Text>
            </View>
          </View>
        </Card>

        {(contributionBreakdown.cashCount > 0 || contributionBreakdown.linkedCount > 0) && (
          <Card>
            <MutedText>
              {t('capitalAccount.contributionBreakdown', {
                cashAmount: money(contributionBreakdown.cashAmount),
                cashCount: contributionBreakdown.cashCount,
                linkedAmount: money(contributionBreakdown.linkedAmount),
                linkedCount: contributionBreakdown.linkedCount,
              })}
            </MutedText>
            {contributionBreakdown.cashCount === 0 && contributionBreakdown.linkedCount > 0 && (
              <MutedText style={{ marginTop: spacing.xs }}>{t('capitalAccount.noCashTransferNote')}</MutedText>
            )}
          </Card>
        )}

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
                  onDeleteDraw={() => handleDeleteDraw(tx)}
                  onDeleteContribution={() => handleDeleteContribution(tx)}
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

      <ModalSheet visible={contributionModalOpen} onClose={() => setContributionModalOpen(false)}>
        <SheetTitle>{t('capitalAccount.recordContributionSheetTitle')}</SheetTitle>
        <MutedText>{t('capitalAccount.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={contributionAmount} onChangeText={setContributionAmount} placeholder="0.00" />
        <MutedText>{t('capitalAccount.noteLabel')}</MutedText>
        <Field value={contributionNote} onChangeText={setContributionNote} placeholder={t('capitalAccount.notePlaceholder')} />
        <PrimaryButton
          title={`💾 ${t('common.save')}`}
          onPress={handleRecordContribution}
          loading={savingContribution}
          disabled={!contributionAmount}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setContributionModalOpen(false)} />
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
