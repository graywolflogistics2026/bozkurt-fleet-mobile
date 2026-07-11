import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useFuelPurchases, useInsertFuelPurchase, useDeleteFuelPurchase } from '@/src/data/fuelPurchases';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { FuelPurchase } from '@/src/types/db';

type FuelType = 'tractor' | 'reefer';
const FUEL_TYPES: FuelType[] = ['tractor', 'reefer'];

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

function FuelRow({ x, onDelete }: { x: FuelPurchase; onDelete: () => void }) {
  const { money, number, date } = useFormatters();
  const net = Number(x.amount ?? 0) - Number(x.discount ?? 0);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={1}>
          {x.location ?? '—'}
        </Text>
        <MutedText>
          {x.purchase_date ? date(x.purchase_date) : '—'}
          {x.state ? ` · ${x.state}` : ''} · {x.gallons ? `${number(x.gallons)} gal` : '—'}
        </MutedText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(net)}</Text>
        {x.discount ? <MutedText>-{money(x.discount)} disc.</MutedText> : null}
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Fuel() {
  const { t } = useTranslation();
  const { money, number } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const fuelQuery = useFuelPurchases();
  const insertFuel = useInsertFuelPurchase();
  const deleteFuel = useDeleteFuelPurchase();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fuelType, setFuelType] = useState<FuelType>('tractor');
  const [location, setLocation] = useState('');
  const [state, setState] = useState('');
  const [gallons, setGallons] = useState('');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = useMemo(() => {
    const list = fuelQuery.data ?? [];
    return [...list].sort((a, b) => (b.purchase_date ?? '').localeCompare(a.purchase_date ?? ''));
  }, [fuelQuery.data]);

  const tractorRows = useMemo(() => rows.filter((x) => x.fuel_type === 'tractor'), [rows]);
  const reeferRows = useMemo(() => rows.filter((x) => x.fuel_type === 'reefer'), [rows]);

  function summarize(list: FuelPurchase[]) {
    const gross = list.reduce((sum, x) => sum + Number(x.amount ?? 0), 0);
    const disc = list.reduce((sum, x) => sum + Number(x.discount ?? 0), 0);
    const gal = list.reduce((sum, x) => sum + Number(x.gallons ?? 0), 0);
    const net = gross - disc;
    return { gross, disc, net, gal, perGallon: gal > 0 ? net / gal : 0 };
  }

  const tractorStats = useMemo(() => summarize(tractorRows), [tractorRows]);
  const reeferStats = useMemo(() => summarize(reeferRows), [reeferRows]);
  const netCost = tractorStats.net + reeferStats.net;

  function openAdd() {
    setFuelType('tractor');
    setLocation('');
    setState('');
    setGallons('');
    setAmount('');
    setDiscount('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setAdding(true);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    setSaving(true);
    try {
      await insertFuel.mutateAsync({
        user_id: userId,
        fuel_type: fuelType,
        location: location || null,
        state: state ? state.toUpperCase() : null,
        gallons: gallons ? Number(gallons) : null,
        amount: amount ? Number(amount) : null,
        discount: Number(discount) || 0,
        purchase_date: purchaseDate || null,
      });
      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('fuel.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: FuelPurchase) {
    Alert.alert(t('fuel.deleteConfirmTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFuel.mutateAsync(x.id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('fuel.deleteFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
          }
        },
      },
    ]);
  }

  function FuelSection({ title, list, stats }: { title: string; list: FuelPurchase[]; stats: ReturnType<typeof summarize> }) {
    return (
      <>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('fuel.netCost')}</MutedText>
              <Text style={styles.statValue}>{money(stats.net)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('fuel.discounts')}</MutedText>
              <Text style={styles.statValue}>{money(stats.disc)}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('fuel.perGallon')}</MutedText>
              <Text style={styles.statValue}>{money(stats.perGallon, { maximumFractionDigits: 3 })}</Text>
            </View>
          </View>
        </Card>
        <Card>
          {list.length === 0 ? (
            <MutedText>{t('fuel.empty')}</MutedText>
          ) : (
            list.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <FuelRow x={x} onDelete={() => handleDelete(x)} />
              </View>
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('fuel.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('fuel.add')}
            </Text>
          </Pressable>
        </View>

        <Card>
          <MutedText>{t('fuel.totalNetCost')}</MutedText>
          <Text style={styles.totalValue}>{money(netCost)}</Text>
          <MutedText>{number(tractorStats.gal + reeferStats.gal)} gal</MutedText>
        </Card>

        {fuelQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            <FuelSection title={t('fuel.tractorFuel')} list={tractorRows} stats={tractorStats} />
            <FuelSection title={t('fuel.reeferFuel')} list={reeferRows} stats={reeferStats} />
          </>
        )}
      </ScrollView>

      <ModalSheet visible={adding} onClose={() => setAdding(false)}>
        <SheetTitle>{t('fuel.addTitle')}</SheetTitle>
        <MutedText>{t('fuel.fuelTypeLabel')}</MutedText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {FUEL_TYPES.map((ftype) => (
            <Pill key={ftype} label={t(`fuel.types.${ftype}`)} selected={fuelType === ftype} onPress={() => setFuelType(ftype)} />
          ))}
        </View>
        <MutedText>{t('fuel.locationLabel')}</MutedText>
        <Field value={location} onChangeText={setLocation} placeholder={t('fuel.locationPlaceholder')} />
        <MutedText>{t('fuel.stateLabel')}</MutedText>
        <Field value={state} onChangeText={setState} placeholder="TX" autoCapitalize="characters" maxLength={2} />
        <MutedText>{t('fuel.dateLabel')}</MutedText>
        <Field value={purchaseDate} onChangeText={setPurchaseDate} placeholder="YYYY-MM-DD" />
        <MutedText>{t('fuel.gallonsLabel')}</MutedText>
        <Field keyboardType="numeric" value={gallons} onChangeText={setGallons} placeholder="0.000" />
        <MutedText>{t('fuel.amountLabel')}</MutedText>
        <Field keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="0.00" />
        <MutedText>{t('fuel.discountLabel')}</MutedText>
        <Field keyboardType="numeric" value={discount} onChangeText={setDiscount} placeholder="0.00" />
        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={saving} />
        <SecondaryButton title={t('common.cancel')} onPress={() => setAdding(false)} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginBottom: spacing.xs,
  },
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
  totalValue: {
    color: colors.text,
    fontSize: typography.size.xl,
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
