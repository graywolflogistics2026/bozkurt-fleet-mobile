import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useMiscIncome, useInsertMiscIncome, useDeleteMiscIncome } from '@/src/data/miscIncome';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { MiscIncome } from '@/src/types/db';

function IncomeRow({ x, onDelete }: { x: MiscIncome; onDelete: () => void }) {
  const { money, date } = useFormatters();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.description ?? '—'}
        </Text>
        <MutedText>
          {x.income_date ? date(x.income_date) : '—'}
          {x.source ? ` · ${x.source}` : ''}
        </MutedText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.amount)}</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function OtherIncome() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const incomeQuery = useMiscIncome();
  const insertIncome = useInsertMiscIncome();
  const deleteIncome = useDeleteMiscIncome();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [incomeDate, setIncomeDate] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = incomeQuery.data ?? [];
    return [...list].sort((a, b) => (b.income_date ?? '').localeCompare(a.income_date ?? ''));
  }, [incomeQuery.data]);

  const total = useMemo(() => rows.reduce((sum, x) => sum + Number(x.amount ?? 0), 0), [rows]);

  function openAdd() {
    setDescription('');
    setSource('');
    setAmount('');
    setIncomeDate(new Date().toISOString().slice(0, 10));
    setAdding(true);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amt = Number(amount) || 0;
    setSaving(true);
    try {
      await insertIncome.mutateAsync({
        user_id: userId,
        description: description || null,
        source: source || null,
        amount: amt,
        income_date: incomeDate || null,
      });
      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('otherIncome.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: MiscIncome) {
    Alert.alert(t('otherIncome.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteIncome.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('otherIncome.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('otherIncome.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>+ {t('otherIncome.add')}</Text>
          </Pressable>
        </View>
        <MutedText>{t('otherIncome.subtitle')}</MutedText>

        <Card>
          <MutedText>{t('otherIncome.totalOtherIncome')}</MutedText>
          <Text style={styles.statValue}>{money(total)}</Text>
        </Card>

        <Card>
          {incomeQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('otherIncome.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <IncomeRow x={x} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('otherIncome.addTitle')}</SheetTitle>
        <MutedText>{t('otherIncome.descriptionLabel')}</MutedText>
        <Field value={description} onChangeText={setDescription} placeholder={t('otherIncome.descriptionPlaceholder')} />
        <MutedText>{t('otherIncome.sourceLabel')}</MutedText>
        <Field value={source} onChangeText={setSource} placeholder={t('otherIncome.sourcePlaceholder')} />
        <MutedText>{t('otherIncome.dateLabel')}</MutedText>
        <Field value={incomeDate} onChangeText={setIncomeDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('otherIncome.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="0.00" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
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
