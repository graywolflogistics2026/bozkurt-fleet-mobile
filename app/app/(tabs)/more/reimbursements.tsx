import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useReimbursements, useInsertReimbursement, useDeleteReimbursement } from '@/src/data/reimbursements';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Reimbursement } from '@/src/types/db';

// legacy rReimb(): warranty credits from maintenance imports are tagged
// "Warranty — <description>"; anything mentioning fuel is fuel-related —
// both are informational tags on the flat list, not separate tables.
function tagFor(x: Reimbursement, t: (k: string) => string): string | null {
  const desc = x.description ?? '';
  if (/warranty/i.test(desc)) return t('reimbursements.warrantyTag');
  if (/fuel/i.test(desc)) return t('reimbursements.fuelTag');
  return null;
}

function ReimbRow({ x, onDelete }: { x: Reimbursement; onDelete: () => void }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const tag = tagFor(x, t);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.description ?? '—'}
        </Text>
        <MutedText>
          {x.reimb_date ? date(x.reimb_date) : '—'}
          {x.reference ? ` · ${x.reference}` : ''}
          {tag ? ` · ${tag}` : ''}
        </MutedText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.amount ?? 0)}</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Reimbursements() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const reimbQuery = useReimbursements();
  const insertReimbursement = useInsertReimbursement();
  const deleteReimbursement = useDeleteReimbursement();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [reimbDate, setReimbDate] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = reimbQuery.data ?? [];
    return [...list].sort((a, b) => (b.reimb_date ?? '').localeCompare(a.reimb_date ?? ''));
  }, [reimbQuery.data]);

  const total = useMemo(() => rows.reduce((sum, x) => sum + Number(x.amount ?? 0), 0), [rows]);

  function openAdd() {
    setDescription('');
    setReference('');
    setAmount('');
    setReimbDate(new Date().toISOString().slice(0, 10));
    setAdding(true);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amt = Number(amount) || 0;
    setSaving(true);
    try {
      await insertReimbursement.mutateAsync({
        user_id: userId,
        description: description || null,
        reference: reference || null,
        amount: amt,
        reimb_date: reimbDate || null,
      });
      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('reimbursements.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: Reimbursement) {
    Alert.alert(t('reimbursements.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReimbursement.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('reimbursements.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
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
          <ScreenTitle>{t('reimbursements.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('reimbursements.add')}
            </Text>
          </Pressable>
        </View>

        <Card>
          <MutedText>{t('reimbursements.totalReimbursed')}</MutedText>
          <Text style={styles.statValue}>{money(total)}</Text>
        </Card>

        <Card>
          {reimbQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('reimbursements.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <ReimbRow x={x} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('reimbursements.addTitle')}</SheetTitle>
        <MutedText>{t('reimbursements.descriptionLabel')}</MutedText>
        <Field value={description} onChangeText={setDescription} placeholder={t('reimbursements.descriptionPlaceholder')} />
        <MutedText>{t('reimbursements.referenceLabel')}</MutedText>
        <Field value={reference} onChangeText={setReference} placeholder={t('reimbursements.referencePlaceholder')} />
        <MutedText>{t('reimbursements.dateLabel')}</MutedText>
        <Field value={reimbDate} onChangeText={setReimbDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('reimbursements.amountLabel')}</MutedText>
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
