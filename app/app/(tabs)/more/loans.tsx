import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useLoanRows, useInsertLoanRow, useUpdateLoanRow, useDeleteLoanRow } from '@/src/data/loans';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { LoanRow } from '@/src/types/db';

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accent : colors.card2,
        marginEnd: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function LoanCard({ x, onEdit, onDelete }: { x: LoanRow; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const paidPct = x.original_amount ? Math.max(0, Math.min(1, 1 - (x.balance ?? 0) / x.original_amount)) : null;
  return (
    <Pressable onPress={onEdit} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.name ?? t('loans.unnamed')}
        </Text>
        <MutedText>
          {x.lender ?? '—'}
          {x.frequency ? ` · ${t(`loans.frequencies.${x.frequency}`, x.frequency)}` : ''}
          {x.apr != null ? ` · ${x.apr}% APR` : ''}
        </MutedText>
        {x.next_due && <MutedText>{t('loans.nextDue', { date: date(x.next_due) })}</MutedText>}
        {paidPct != null && <MutedText>{t('loans.paidOffPct', { pct: Math.round(paidPct * 100) })}</MutedText>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.balance ?? 0)}</Text>
        {x.payment != null && <MutedText>{t('loans.paymentAmount', { amount: money(x.payment) })}</MutedText>}
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

type FormState = {
  name: string;
  lender: string;
  originalAmount: string;
  balance: string;
  payment: string;
  frequency: Frequency;
  apr: string;
  nextDue: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  lender: '',
  originalAmount: '',
  balance: '',
  payment: '',
  frequency: 'monthly',
  apr: '',
  nextDue: '',
};

export default function LoanCenter() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const loansQuery = useLoanRows();
  const insertLoan = useInsertLoanRow();
  const updateLoan = useUpdateLoanRow();
  const deleteLoan = useDeleteLoanRow();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<LoanRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient, { entities: ['loans'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = loansQuery.data ?? [];
    return [...list].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  }, [loansQuery.data]);

  const totals = useMemo(() => {
    const balance = rows.reduce((sum, x) => sum + Number(x.balance ?? 0), 0);
    const monthlyPayment = rows.reduce((sum, x) => {
      const p = Number(x.payment ?? 0);
      if (x.frequency === 'weekly') return sum + p * 4.33;
      if (x.frequency === 'biweekly') return sum + p * 2.17;
      return sum + p;
    }, 0);
    return { balance, monthlyPayment };
  }, [rows]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setAdding(true);
  }

  function openEdit(x: LoanRow) {
    setEditing(x);
    setForm({
      name: x.name ?? '',
      lender: x.lender ?? '',
      originalAmount: x.original_amount != null ? String(x.original_amount) : '',
      balance: x.balance != null ? String(x.balance) : '',
      payment: x.payment != null ? String(x.payment) : '',
      frequency: (x.frequency as Frequency) ?? 'monthly',
      apr: x.apr != null ? String(x.apr) : '',
      nextDue: x.next_due ?? '',
    });
  }

  function closeSheets() {
    setAdding(false);
    setEditing(null);
  }

  function toValues(userIdValue: string) {
    return {
      user_id: userIdValue,
      name: form.name || null,
      lender: form.lender || null,
      original_amount: form.originalAmount ? Number(form.originalAmount) : null,
      balance: form.balance ? Number(form.balance) : null,
      payment: form.payment ? Number(form.payment) : null,
      frequency: form.frequency,
      apr: form.apr ? Number(form.apr) : null,
      next_due: form.nextDue || null,
    };
  }

  async function handleSaveAdd() {
    if (!userId) return;
    setSaving(true);
    try {
      await insertLoan.mutateAsync(toValues(userId));
      await invalidateFinancialData(queryClient, { entities: ['loans'] });
      closeSheets();
    } catch (err) {
      Alert.alert(t('loans.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing || !userId) return;
    setSaving(true);
    try {
      const { user_id: _uid, ...values } = toValues(userId);
      await updateLoan.mutateAsync({ id: editing.id, values });
      await invalidateFinancialData(queryClient, { entities: ['loans'] });
      closeSheets();
    } catch (err) {
      Alert.alert(t('loans.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: LoanRow) {
    Alert.alert(t('loans.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLoan.mutateAsync(x.id);
            await invalidateFinancialData(queryClient, { entities: ['loans'] });
            closeSheets();
          } catch (err) {
            Alert.alert(t('loans.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  const formFields = (
    <>
      <MutedText>{t('loans.nameLabel')}</MutedText>
      <Field value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder={t('loans.namePlaceholder')} />
      <MutedText>{t('loans.lenderLabel')}</MutedText>
      <Field value={form.lender} onChangeText={(v) => setForm((f) => ({ ...f, lender: v }))} placeholder={t('loans.lenderPlaceholder')} />
      <MutedText>{t('loans.originalAmountLabel')}</MutedText>
      <Field
        keyboardType="numeric"
        value={form.originalAmount}
        onChangeText={(v) => setForm((f) => ({ ...f, originalAmount: v }))}
        placeholder="0.00"
      />
      <MutedText>{t('loans.balanceLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.balance} onChangeText={(v) => setForm((f) => ({ ...f, balance: v }))} placeholder="0.00" />
      <MutedText>{t('loans.paymentLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.payment} onChangeText={(v) => setForm((f) => ({ ...f, payment: v }))} placeholder="0.00" />
      <MutedText>{t('loans.frequencyLabel')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {FREQUENCIES.map((f) => (
          <Pill
            key={f}
            label={t(`loans.frequencies.${f}`)}
            selected={form.frequency === f}
            onPress={() => setForm((s) => ({ ...s, frequency: f }))}
          />
        ))}
      </View>
      <MutedText>{t('loans.aprLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.apr} onChangeText={(v) => setForm((f) => ({ ...f, apr: v }))} placeholder="0.0" />
      <MutedText>{t('loans.nextDueLabel')}</MutedText>
      <Field value={form.nextDue} onChangeText={(v) => setForm((f) => ({ ...f, nextDue: v }))} placeholder="YYYY-MM-DD" />
    </>
  );

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('loans.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>+ {t('loans.add')}</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('loans.totalBalance')}</MutedText>
              <Text style={styles.statValue}>{money(totals.balance)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('loans.estMonthlyPayments')}</MutedText>
              <Text style={styles.statValue}>{money(totals.monthlyPayment)}</Text>
            </View>
          </View>
        </Card>

        <Card>
          {loansQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('loans.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <LoanCard x={x} onEdit={() => openEdit(x)} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={closeSheets}>
        <SheetTitle>{t('loans.addTitle')}</SheetTitle>
        {formFields}
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={closeSheets} />
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={closeSheets}>
        <SheetTitle>{t('loans.editTitle')}</SheetTitle>
        {formFields}
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={closeSheets} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  statRow: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
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
  amount: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginStart: spacing.sm,
  },
};
