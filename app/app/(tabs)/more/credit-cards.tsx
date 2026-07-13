import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useCreditCards, useInsertCreditCard, useUpdateCreditCard, useDeleteCreditCard } from '@/src/data/creditCards';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { CreditCardRow } from '@/src/types/db';

function CardRow({ x, onEdit, onDelete }: { x: CreditCardRow; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const utilization = x.credit_limit ? Math.max(0, Math.min(1, (x.balance ?? 0) / x.credit_limit)) : null;
  return (
    <Pressable onPress={onEdit} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.name ?? t('creditCards.unnamed')}
          {x.last_four ? ` ••${x.last_four}` : ''}
        </Text>
        <MutedText>
          {x.apr != null ? `${x.apr}% APR` : '—'}
          {x.due_day != null ? ` · ${t('creditCards.dueDayShort', { day: x.due_day })}` : ''}
        </MutedText>
        {x.credit_limit != null && (
          <MutedText>{t('creditCards.limitOf', { limit: money(x.credit_limit) })}</MutedText>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.balance ?? 0)}</Text>
        {utilization != null && (
          // Legacy rCards(): utilization >30% shown orange.
          <MutedText style={utilization > 0.3 ? { color: colors.orange } : undefined}>
            {Math.round(utilization * 100)}% {t('creditCards.utilized')}
          </MutedText>
        )}
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

type FormState = {
  name: string;
  lastFour: string;
  creditLimit: string;
  balance: string;
  apr: string;
  dueDay: string;
};

const EMPTY_FORM: FormState = { name: '', lastFour: '', creditLimit: '', balance: '', apr: '', dueDay: '' };

export default function CreditCards() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const cardsQuery = useCreditCards();
  const insertCard = useInsertCreditCard();
  const updateCard = useUpdateCreditCard();
  const deleteCard = useDeleteCreditCard();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<CreditCardRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = cardsQuery.data ?? [];
    return [...list].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
  }, [cardsQuery.data]);

  const totals = useMemo(() => {
    const balance = rows.reduce((sum, x) => sum + Number(x.balance ?? 0), 0);
    const limit = rows.reduce((sum, x) => sum + Number(x.credit_limit ?? 0), 0);
    const utilization = limit > 0 ? Math.max(0, Math.min(1, balance / limit)) : null;
    return { balance, limit, utilization };
  }, [rows]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setAdding(true);
  }

  function openEdit(x: CreditCardRow) {
    setEditing(x);
    setForm({
      name: x.name ?? '',
      lastFour: x.last_four ?? '',
      creditLimit: x.credit_limit != null ? String(x.credit_limit) : '',
      balance: x.balance != null ? String(x.balance) : '',
      apr: x.apr != null ? String(x.apr) : '',
      dueDay: x.due_day != null ? String(x.due_day) : '',
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
      last_four: form.lastFour || null,
      credit_limit: form.creditLimit ? Number(form.creditLimit) : null,
      balance: form.balance ? Number(form.balance) : null,
      apr: form.apr ? Number(form.apr) : null,
      due_day: form.dueDay ? Number(form.dueDay) : null,
    };
  }

  async function handleSaveAdd() {
    if (!userId) return;
    setSaving(true);
    try {
      await insertCard.mutateAsync(toValues(userId));
      await invalidateFinancialData(queryClient);
      closeSheets();
    } catch (err) {
      Alert.alert(t('creditCards.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editing || !userId) return;
    setSaving(true);
    try {
      const { user_id: _uid, ...values } = toValues(userId);
      await updateCard.mutateAsync({ id: editing.id, values });
      await invalidateFinancialData(queryClient);
      closeSheets();
    } catch (err) {
      Alert.alert(t('creditCards.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: CreditCardRow) {
    Alert.alert(t('creditCards.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCard.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
            closeSheets();
          } catch (err) {
            Alert.alert(t('creditCards.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  const formFields = (
    <>
      <MutedText>{t('creditCards.nameLabel')}</MutedText>
      <Field value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder={t('creditCards.namePlaceholder')} />
      <MutedText>{t('creditCards.lastFourLabel')}</MutedText>
      <Field
        value={form.lastFour}
        onChangeText={(v) => setForm((f) => ({ ...f, lastFour: v.replace(/\D/g, '').slice(0, 4) }))}
        placeholder="1234"
        keyboardType="numeric"
        maxLength={4}
      />
      <MutedText>{t('creditCards.creditLimitLabel')}</MutedText>
      <Field
        keyboardType="numeric"
        value={form.creditLimit}
        onChangeText={(v) => setForm((f) => ({ ...f, creditLimit: v }))}
        placeholder="0.00"
      />
      <MutedText>{t('creditCards.balanceLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.balance} onChangeText={(v) => setForm((f) => ({ ...f, balance: v }))} placeholder="0.00" />
      <MutedText>{t('creditCards.aprLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.apr} onChangeText={(v) => setForm((f) => ({ ...f, apr: v }))} placeholder="0.0" />
      <MutedText>{t('creditCards.dueDayLabel')}</MutedText>
      <Field keyboardType="numeric" value={form.dueDay} onChangeText={(v) => setForm((f) => ({ ...f, dueDay: v }))} placeholder="15" />
    </>
  );

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('creditCards.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>+ {t('creditCards.add')}</Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('creditCards.totalBalance')}</MutedText>
              <Text style={styles.statValue}>{money(totals.balance)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('creditCards.totalLimit')}</MutedText>
              <Text style={styles.statValue}>{money(totals.limit)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('creditCards.totalUtilization')}</MutedText>
              <Text style={[styles.statValue, totals.utilization != null && totals.utilization > 0.3 ? { color: colors.orange } : undefined]}>
                {totals.utilization != null ? `${Math.round(totals.utilization * 100)}%` : t('common.dash')}
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          {cardsQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('creditCards.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <CardRow x={x} onEdit={() => openEdit(x)} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={closeSheets}>
        <SheetTitle>{t('creditCards.addTitle')}</SheetTitle>
        {formFields}
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={closeSheets} />
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={closeSheets}>
        <SheetTitle>{t('creditCards.editTitle')}</SheetTitle>
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
