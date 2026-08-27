import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useCapitalAccountSummary } from '@/src/data/capitalAccount';
import { useSettlements } from '@/src/data/settlements';
import { reconcileBusinessBalance } from '@/src/stats/businessBalanceLedger';
import {
  useCapitalTransactions,
  useUpdateCapitalTransaction,
  useDeleteManualCapitalTransaction,
  useRecordManualCapitalTransaction,
  useUpdateManualCapitalTransaction,
} from '@/src/data/capitalTransactions';
import { useTaxConfig } from '@/src/data/taxConfig';
import { FleetScopeLabel } from '@/src/components/FleetScopeLabel';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import {
  findDuplicateTransactionIds,
  summarizeContributions,
  summarizeCapitalFlows,
  validateCapitalTransactionDate,
  isLinkedContribution,
  type CapitalTransactionDateValidation,
} from '@/src/stats/capitalAccount';
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

// CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 3
// "every row editable"): EVERY row (draw or contribution, linked or
// manual) is now tappable and opens the same edit sheet — the previous
// version only made a LINKED contribution tappable (navigating straight
// to Deductions) and only gave a MANUAL row an inline delete icon. The
// edit sheet itself is what now differentiates a linked row (amount
// locked, "view expense" link) from a manual one (everything editable,
// Delete offered) — see the ModalSheet below.
function HistoryRow({ tx, onTap }: { tx: CapitalTransaction; onTap: () => void }) {
  const { money } = useFormatters();
  const isDraw = tx.tx_type === 'draw';
  const linked = isLinkedContribution(tx);
  return (
    <Pressable
      onPress={onTap}
      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm }}
    >
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
        {linked && <Text style={{ color: colors.muted, fontSize: typography.size.md }}>🔗</Text>}
        <Text style={{ color: colors.muted, fontWeight: '700' }}>›</Text>
      </View>
    </Pressable>
  );
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
  const settlementsQuery = useSettlements();
  const taxConfigQuery = useTaxConfig();
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  // FULL PARITY pass (owner decision 2026-08-05, spec item E.3) — manual
  // draws/contributions from THIS screen apply a real business_balance
  // delta (useRecordManualCapitalTransaction/useDeleteManualCapitalTransaction);
  // a LINKED contribution never reaches this screen's own insert/delete
  // path (it's read-only here, auto-synced from deductionMutations.ts).
  const insertTx = useRecordManualCapitalTransaction();
  const deleteTx = useDeleteManualCapitalTransaction();
  // CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 3) —
  // updateManualTx adjusts business_balance by the delta (a manual, non-
  // linked row); updateTx is the plain entity-hook update (no balance
  // side effect at all) used for a LINKED contribution's date/note edit,
  // since a linked row never applies a balance delta in the first place.
  const updateManualTx = useUpdateManualCapitalTransaction();
  const updateTx = useUpdateCapitalTransaction();

  const todayIso = () => new Date().toISOString().slice(0, 10);

  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawDate, setDrawDate] = useState(todayIso());
  const [drawAmount, setDrawAmount] = useState('');
  const [drawNote, setDrawNote] = useState('');
  const [savingDraw, setSavingDraw] = useState(false);

  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [contributionDate, setContributionDate] = useState(todayIso());
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionNote, setContributionNote] = useState('');
  const [savingContribution, setSavingContribution] = useState(false);

  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [savingBalance, setSavingBalance] = useState(false);

  // CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 3) —
  // one shared edit sheet for every history row, linked or manual.
  const [editingTx, setEditingTx] = useState<CapitalTransaction | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // DOUBLE-SUBMIT GUARD (owner decision, device report: business_balance
  // grew by an unexplained ~$5,741) — every balance-moving handler below
  // (draw/contribution/edit/reconcile) used to guard ONLY with React state
  // (`savingDraw`/`savingContribution`/`savingEdit`/`savingBalance`,
  // checked via the button's own `disabled` prop) — a real gap, since a
  // state update is asynchronous: two taps in the same synchronous event
  // tick (a fast double-tap, or a tap that fires again before the next
  // render) can BOTH pass the "not currently saving" check before either
  // one's state update has actually applied. Unlike the settlement-import
  // RPC (idempotent by construction — re-applying the SAME credit nets to
  // a $0 second delta), `record_manual_capital_transaction()`/
  // `update_manual_capital_transaction()` insert/adjust a REAL new delta
  // on every call — nothing stops a double-submitted contribution/
  // reconcile from applying twice. One shared ref (not per-handler) is
  // deliberately conservative — these four sheets are mutually exclusive
  // in the UI, but sharing one guard also closes any hypothetical race
  // between two of them firing back to back, same synchronous check-and-
  // set pattern already used by the import screen's own `savingRef`.
  const savingRef = useRef(false);

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

  // BALANCE LEDGER RECONCILIATION (owner decision, device report:
  // business_balance grew by an unexplained ~$5,741) — reconstructs the
  // EXPECTED balance entirely from data this screen already has (every
  // currently-existing settlement's own business_balance_credit + every
  // manual capital_transactions row's own business_balance_applied) and
  // compares it to what's actually stored — "reconstruct it from the
  // ledger and show me the arithmetic," without needing direct database
  // access.
  const reconciliation = useMemo(
    () => reconcileBusinessBalance(settlementsQuery.data ?? [], rows, summary?.businessBalance ?? 0),
    [settlementsQuery.data, rows, summary?.businessBalance]
  );

  // CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 1) —
  // "no future dates beyond today, no obviously wrong years." Shared by
  // Add Draw, Add Contribution, AND the edit sheet so all three can never
  // disagree about what counts as a valid date.
  function dateValidationMessage(result: CapitalTransactionDateValidation): string | null {
    if (result.valid) return null;
    if (result.reason === 'future') return t('capitalAccount.dateFuture');
    if (result.reason === 'tooOld') return t('capitalAccount.dateTooOld');
    return t('capitalAccount.dateInvalid');
  }

  function openDraw() {
    setDrawDate(todayIso());
    setDrawAmount('');
    setDrawNote('');
    setDrawModalOpen(true);
  }

  function openContribution() {
    setContributionDate(todayIso());
    setContributionAmount('');
    setContributionNote('');
    setContributionModalOpen(true);
  }

  const drawDateError = dateValidationMessage(validateCapitalTransactionDate(drawDate));
  const contributionDateError = dateValidationMessage(validateCapitalTransactionDate(contributionDate));

  async function handleRecordDraw() {
    const amount = Number(drawAmount) || 0;
    if (amount <= 0 || !userId || drawDateError) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingDraw(true);
    try {
      await insertTx.mutateAsync({
        user_id: userId,
        tx_type: 'draw',
        amount,
        tx_date: drawDate,
        note: drawNote || null,
      });
      await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
      setDrawModalOpen(false);
      setDrawAmount('');
      setDrawNote('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingDraw(false);
      savingRef.current = false;
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
              await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
              setEditingTx(null);
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
    if (amount <= 0 || !userId || contributionDateError) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingContribution(true);
    try {
      await insertTx.mutateAsync({
        user_id: userId,
        tx_type: 'contribution',
        amount,
        tx_date: contributionDate,
        note: contributionNote || null,
      });
      await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
      setContributionModalOpen(false);
      setContributionAmount('');
      setContributionNote('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingContribution(false);
      savingRef.current = false;
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
              await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
              setEditingTx(null);
            } catch (err) {
              Alert.alert(t('capitalAccount.deleteFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
            }
          },
        },
      ]
    );
  }

  // CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item 3
  // "every row editable"). One shared edit sheet for every history row.
  function openEdit(tx: CapitalTransaction) {
    setEditingTx(tx);
    setEditDate(tx.tx_date);
    setEditAmount(String(tx.amount));
    setEditNote(tx.note ?? '');
  }

  function closeEdit() {
    setEditingTx(null);
  }

  const isEditingLinked = !!editingTx && isLinkedContribution(editingTx);
  const editDateError = editingTx ? dateValidationMessage(validateCapitalTransactionDate(editDate)) : null;

  async function handleSaveEdit() {
    if (!editingTx || !userId || editDateError) return;
    const amount = Number(editAmount) || 0;
    if (!isEditingLinked && amount <= 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingEdit(true);
    try {
      if (isEditingLinked) {
        // A linked contribution's AMOUNT stays whatever the source
        // deduction says — this never touches business_balance (the
        // plain entity-hook update, no delta math), same as
        // deductionMutations.ts's own applyContributionSync() 'update'
        // action, which is the actual owner of this row's amount.
        await updateTx.mutateAsync({ id: editingTx.id, values: { tx_date: editDate, note: editNote || null } });
      } else {
        // BALANCE LEDGER ATOMICITY FIX (docs/PENDING_SQL.md §60): the
        // adjustment is now computed server-side, inside
        // update_manual_capital_transaction() itself, from a FRESH
        // row-locked read of the row's own current business_balance_applied
        // — never from a value passed in here, which could theoretically
        // be stale if this screen's own local state hadn't refetched
        // between two edits.
        await updateManualTx.mutateAsync({
          id: editingTx.id,
          userId,
          txType: editingTx.tx_type,
          amount,
          txDate: editDate,
          note: editNote || null,
        });
      }
      await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
      setEditingTx(null);
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingEdit(false);
      savingRef.current = false;
    }
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
              await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
              Alert.alert(t('capitalAccount.removeDuplicates'), t('capitalAccount.duplicatesRemoved', { count: duplicates.length }));
            } catch (err) {
              Alert.alert(t('capitalAccount.deleteFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
            }
          },
        },
      ]
    );
  }

  // RECONCILE (owner decision, docs/PENDING_SQL.md §70, item 6 — "I enter
  // the true figure and the app records the difference as a labeled
  // adjustment row, visible in the equity list, never a silent
  // overwrite"). Replaces the old handleUpdateBalance()'s plain
  // `profiles.business_balance = X` write (useUpdateBusinessBalance() —
  // still exported from capitalAccount.ts, now unused, a genuine silent-
  // overwrite this pass deliberately retires from the UI) with a real,
  // atomic manual capital transaction: the SAME mechanism/RPC every other
  // contribution/draw on this screen already uses, so the adjustment
  // shows up in the history list like any other real entry, is reversible
  // by deleting it like any other manual row, and moves business_balance
  // correctly via record_manual_capital_transaction()'s own atomic delta.
  // A delta of exactly $0 records nothing — "reconciling" to the figure
  // already on file isn't a real adjustment.
  async function handleReconcileBalance() {
    const target = Number(balanceInput);
    if (!Number.isFinite(target) || !userId) return;
    if (savingRef.current) return;
    const current = summary?.businessBalance ?? 0;
    const delta = Math.round((target - current) * 100) / 100;
    if (delta === 0) {
      setBalanceModalOpen(false);
      setBalanceInput('');
      return;
    }
    savingRef.current = true;
    setSavingBalance(true);
    try {
      await insertTx.mutateAsync({
        user_id: userId,
        tx_type: delta > 0 ? 'contribution' : 'draw',
        amount: Math.abs(delta),
        tx_date: todayIso(),
        note: t('capitalAccount.reconcileNote', { from: money(current), to: money(target) }),
      });
      await invalidateFinancialData(queryClient, { entities: ['capital_transactions', 'profiles'] });
      setBalanceModalOpen(false);
      setBalanceInput('');
    } catch (err) {
      Alert.alert(t('capitalAccount.saveFailedTitle'), err instanceof Error ? err.message : t('capitalAccount.genericRetry'));
    } finally {
      setSavingBalance(false);
      savingRef.current = false;
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('capitalAccount.title')}</ScreenTitle>
        <FleetScopeLabel variant="fleetOnly" />

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

        {/* BALANCE LEDGER RECONCILIATION (owner decision, device report:
            business_balance grew by an unexplained amount) — a proactive,
            always-visible flag the instant the stored figure disagrees
            with what every currently-existing settlement/equity row adds
            up to, so a drift is never silently invisible again. */}
        {!reconciliation.matches && (
          <Pressable onPress={() => setVerifyModalOpen(true)}>
            <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>
              ⚠️ {t('capitalAccount.balanceDriftWarning', { amount: money(Math.abs(reconciliation.drift)) })}
            </MutedText>
          </Pressable>
        )}

        <MutedText style={{ marginTop: spacing.xs }}>{t('capitalAccount.cashMovesNotTaxNote')}</MutedText>

        <SecondaryButton title={t('capitalAccount.recordContribution')} onPress={openContribution} />
        <SecondaryButton
          title={isScorp ? t('capitalAccount.recordDistribution') : t('capitalAccount.recordDraw')}
          onPress={openDraw}
        />
        <SecondaryButton title={t('capitalAccount.reconcileBalance')} onPress={() => setBalanceModalOpen(true)} />
        <SecondaryButton title={t('capitalAccount.verifyBalance')} onPress={() => setVerifyModalOpen(true)} />
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
                <HistoryRow tx={tx} onTap={() => openEdit(tx)} />
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
        <MutedText>{t('capitalAccount.dateLabel')}</MutedText>
        <Field value={drawDate} onChangeText={setDrawDate} placeholder="YYYY-MM-DD" />
        {drawDateError && <Text style={styles.errorText}>{drawDateError}</Text>}
        <MutedText>{t('capitalAccount.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={drawAmount} onChangeText={setDrawAmount} placeholder="0.00" />
        <MutedText>{t('capitalAccount.noteLabel')}</MutedText>
        <Field value={drawNote} onChangeText={setDrawNote} placeholder={t('capitalAccount.notePlaceholder')} />
        <PrimaryButton
          title={`💾 ${t('common.save')}`}
          onPress={handleRecordDraw}
          loading={savingDraw}
          disabled={!drawAmount || !!drawDateError}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setDrawModalOpen(false)} />
      </ModalSheet>

      <ModalSheet visible={contributionModalOpen} onClose={() => setContributionModalOpen(false)}>
        <SheetTitle>{t('capitalAccount.recordContributionSheetTitle')}</SheetTitle>
        <MutedText>{t('capitalAccount.dateLabel')}</MutedText>
        <Field value={contributionDate} onChangeText={setContributionDate} placeholder="YYYY-MM-DD" />
        {contributionDateError && <Text style={styles.errorText}>{contributionDateError}</Text>}
        <MutedText>{t('capitalAccount.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={contributionAmount} onChangeText={setContributionAmount} placeholder="0.00" />
        <MutedText>{t('capitalAccount.noteLabel')}</MutedText>
        <Field value={contributionNote} onChangeText={setContributionNote} placeholder={t('capitalAccount.notePlaceholder')} />
        <PrimaryButton
          title={`💾 ${t('common.save')}`}
          onPress={handleRecordContribution}
          loading={savingContribution}
          disabled={!contributionAmount || !!contributionDateError}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setContributionModalOpen(false)} />
      </ModalSheet>

      <ModalSheet visible={balanceModalOpen} onClose={() => setBalanceModalOpen(false)}>
        <SheetTitle>{t('capitalAccount.reconcileSheetTitle')}</SheetTitle>
        <MutedText>{t('capitalAccount.reconcileLabel')}</MutedText>
        <MutedText style={{ marginBottom: spacing.sm }}>
          {t('capitalAccount.reconcileCurrentBalance', { amount: money(summary?.businessBalance ?? 0) })}
        </MutedText>
        <Field keyboardType="numeric" value={balanceInput} onChangeText={setBalanceInput} placeholder="0.00" />
        {!!balanceInput && Number.isFinite(Number(balanceInput)) && (
          <MutedText style={{ marginTop: spacing.xs }}>
            {(() => {
              const delta = Math.round((Number(balanceInput) - (summary?.businessBalance ?? 0)) * 100) / 100;
              if (delta === 0) return t('capitalAccount.reconcileNoChange');
              return delta > 0
                ? t('capitalAccount.reconcileWillAddContribution', { amount: money(delta) })
                : t('capitalAccount.reconcileWillAddDraw', { amount: money(Math.abs(delta)) });
            })()}
          </MutedText>
        )}
        <PrimaryButton
          title={`💾 ${t('common.save')}`}
          onPress={handleReconcileBalance}
          loading={savingBalance}
          disabled={!balanceInput || !Number.isFinite(Number(balanceInput))}
        />
        <SecondaryButton title={t('common.cancel')} onPress={() => setBalanceModalOpen(false)} />
      </ModalSheet>

      {/* BALANCE LEDGER RECONCILIATION (owner decision, device report:
          business_balance grew by an unexplained ~$5,741) — "reconstruct
          it from the ledger and show me the arithmetic." Entirely
          computed from data this screen already has (see
          reconcileBusinessBalance's own header comment for why the sum
          of every currently-existing settlement's own credit + every
          manual equity row's own applied delta should always equal the
          stored balance exactly). */}
      <ModalSheet visible={verifyModalOpen} onClose={() => setVerifyModalOpen(false)}>
        <SheetTitle>{t('capitalAccount.verifyBalance')}</SheetTitle>
        <MutedText style={{ marginBottom: spacing.sm }}>{t('capitalAccount.verifyBalanceExplain')}</MutedText>
        <View style={styles.verifyRow}>
          <MutedText>{t('capitalAccount.verifySettlementsTotal', { count: reconciliation.settlementCount })}</MutedText>
          <Text style={styles.verifyAmount}>{money(reconciliation.settlementsTotal)}</Text>
        </View>
        <View style={styles.verifyRow}>
          <MutedText>{t('capitalAccount.verifyManualTotal', { count: reconciliation.manualTransactionCount })}</MutedText>
          <Text style={styles.verifyAmount}>{money(reconciliation.manualTransactionsTotal)}</Text>
        </View>
        <View style={[styles.verifyRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: spacing.xs }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('capitalAccount.verifyExpected')}</Text>
          <Text style={[styles.verifyAmount, { fontWeight: '700' }]}>{money(reconciliation.expectedBalance)}</Text>
        </View>
        <View style={styles.verifyRow}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{t('capitalAccount.verifyStored')}</Text>
          <Text style={[styles.verifyAmount, { fontWeight: '700' }]}>{money(reconciliation.storedBalance)}</Text>
        </View>
        {reconciliation.matches ? (
          <MutedText style={{ color: colors.green, marginTop: spacing.sm }}>✓ {t('capitalAccount.verifyMatches')}</MutedText>
        ) : (
          <MutedText style={{ color: colors.orange, marginTop: spacing.sm }}>
            ⚠️ {t('capitalAccount.verifyMismatch', { amount: money(Math.abs(reconciliation.drift)) })}
          </MutedText>
        )}
        <SecondaryButton title={t('common.close')} onPress={() => setVerifyModalOpen(false)} />
      </ModalSheet>

      {/* CAPITAL ACCOUNT — THREE UI FIXES (owner decision 2026-08-24, item
          3 "every row editable") — one shared edit sheet for every
          history row, linked or manual. A linked contribution's amount is
          locked (its source deduction is the real owner of that value —
          deductionMutations.ts's applyContributionSync()) with a note +
          a link straight to the source expense; date/note stay editable
          either way. Delete is offered only for a manual row — deleting a
          linked contribution independently would desync it from its
          deduction (the deduction would silently re-create it on its own
          next save), so that still routes through Deductions, same as
          before. */}
      <ModalSheet visible={!!editingTx} onClose={closeEdit}>
        <SheetTitle>
          {editingTx?.tx_type === 'draw'
            ? isScorp
              ? t('capitalAccount.editDistributionSheetTitle')
              : t('capitalAccount.editDrawSheetTitle')
            : t('capitalAccount.editContributionSheetTitle')}
        </SheetTitle>
        <MutedText>{t('capitalAccount.dateLabel')}</MutedText>
        <Field value={editDate} onChangeText={setEditDate} placeholder="YYYY-MM-DD" />
        {editDateError && <Text style={styles.errorText}>{editDateError}</Text>}
        <MutedText>{t('capitalAccount.amountLabel')}</MutedText>
        {isEditingLinked ? (
          <>
            <Text style={styles.lockedAmount}>{money(editingTx?.amount ?? 0)}</Text>
            <MutedText style={{ marginBottom: spacing.xs }}>{t('capitalAccount.linkedAmountLocked')}</MutedText>
            <SecondaryButton
              title={t('capitalAccount.viewLinkedExpense')}
              onPress={() => {
                closeEdit();
                router.push('/(tabs)/deductions');
              }}
            />
          </>
        ) : (
          <Field keyboardType="numeric" value={editAmount} onChangeText={setEditAmount} placeholder="0.00" />
        )}
        <MutedText>{t('capitalAccount.noteLabel')}</MutedText>
        <Field value={editNote} onChangeText={setEditNote} placeholder={t('capitalAccount.notePlaceholder')} />
        <PrimaryButton
          title={`💾 ${t('common.save')}`}
          onPress={handleSaveEdit}
          loading={savingEdit}
          disabled={!!editDateError || (!isEditingLinked && !editAmount)}
        />
        {editingTx && !isEditingLinked && (
          <SecondaryButton
            title={`🗑 ${t('common.delete')}`}
            onPress={() => (editingTx.tx_type === 'draw' ? handleDeleteDraw(editingTx) : handleDeleteContribution(editingTx))}
          />
        )}
        <SecondaryButton title={t('common.cancel')} onPress={closeEdit} />
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
  errorText: {
    color: colors.red,
    fontSize: typography.size.xs,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  lockedAmount: {
    color: colors.muted,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
  },
  verifyRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  verifyAmount: {
    color: colors.text,
    fontWeight: '600' as const,
  },
};
