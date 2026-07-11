import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useTolls, useInsertToll, useDeleteToll } from '@/src/data/tolls';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Toll } from '@/src/types/db';

const NETWORKS = ['ezpass', 'drivewyze', 'other'] as const;
type Network = (typeof NETWORKS)[number];

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

function TollRow({ x, networkLabel, onDelete }: { x: Toll; networkLabel: string; onDelete: () => void }) {
  const { money, date } = useFormatters();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.plaza ?? networkLabel}
        </Text>
        <MutedText>
          {x.toll_date ? date(x.toll_date) : '—'} · {networkLabel}
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

export default function Tolls() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const tollsQuery = useTolls();
  const insertToll = useInsertToll();
  const deleteToll = useDeleteToll();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [network, setNetwork] = useState<Network>('ezpass');
  const [plaza, setPlaza] = useState('');
  const [amount, setAmount] = useState('');
  const [tollDate, setTollDate] = useState('');

  const networkLabel = useCallback((n: string | null) => t(`tolls.networks.${n ?? 'other'}`), [t]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = tollsQuery.data ?? [];
    return [...list].sort((a, b) => (b.toll_date ?? '').localeCompare(a.toll_date ?? ''));
  }, [tollsQuery.data]);

  const stats = useMemo(() => {
    const ezpass = rows.filter((x) => x.network === 'ezpass').reduce((sum, x) => sum + Number(x.amount ?? 0), 0);
    const drivewyze = rows.filter((x) => x.network === 'drivewyze').reduce((sum, x) => sum + Number(x.amount ?? 0), 0);
    const total = rows.reduce((sum, x) => sum + Number(x.amount ?? 0), 0);
    return { ezpass, drivewyze, total };
  }, [rows]);

  function openAdd() {
    setNetwork('ezpass');
    setPlaza('');
    setAmount('');
    setTollDate(new Date().toISOString().slice(0, 10));
    setAdding(true);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amt = Number(amount) || 0;
    setSaving(true);
    try {
      await insertToll.mutateAsync({
        user_id: userId,
        network,
        plaza: plaza || null,
        amount: amt,
        toll_date: tollDate || null,
      });
      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('tolls.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: Toll) {
    Alert.alert(t('tolls.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteToll.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('tolls.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
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
          <ScreenTitle>{t('tolls.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('tolls.add')}
            </Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.networks.ezpass')}</MutedText>
              <Text style={styles.statValue}>{money(stats.ezpass)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.networks.drivewyze')}</MutedText>
              <Text style={styles.statValue}>{money(stats.drivewyze)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('tolls.total')}</MutedText>
              <Text style={styles.statValue}>{money(stats.total)}</Text>
            </View>
          </View>
        </Card>

        <Card>
          {tollsQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : rows.length === 0 ? (
            <MutedText>{t('tolls.empty')}</MutedText>
          ) : (
            rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <TollRow x={x} networkLabel={networkLabel(x.network)} onDelete={() => handleDelete(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('tolls.addTitle')}</SheetTitle>
        <MutedText>{t('tolls.networkLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {NETWORKS.map((n) => (
            <Pill key={n} label={t(`tolls.networks.${n}`)} selected={network === n} onPress={() => setNetwork(n)} />
          ))}
        </View>
        <MutedText>{t('tolls.plazaLabel')}</MutedText>
        <Field value={plaza} onChangeText={setPlaza} placeholder={t('tolls.plazaPlaceholder')} />
        <MutedText>{t('tolls.dateLabel')}</MutedText>
        <Field value={tollDate} onChangeText={setTollDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('tolls.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="0.00" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
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
    fontSize: typography.size.md,
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
