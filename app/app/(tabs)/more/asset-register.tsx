import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useDeductions, useInsertDeduction } from '@/src/data/deductions';
import { applyContributionSync } from '@/src/data/deductionMutations';
import { planContributionSync } from '@/src/stats/contributionSync';
import { isPersonalPayment, PAYMENT_METHODS, type PaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { buildAssetRegister, activeWarranties, ASSET_CATEGORIES, type AssetRow } from '@/src/stats/assetRegister';
import { useFormatters } from '@/src/i18n/format';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';

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

function AssetCard({ x }: { x: AssetRow }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const d = x.deduction;
  return (
    <View style={[styles.row, x.needsReview && styles.needsReviewRow]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.needsReview ? '⚠️ ' : ''}
          {d.description ?? '—'}
        </Text>
        <MutedText>
          {d.ded_date ? date(d.ded_date) : '—'} · {d.category ?? '—'}
        </MutedText>
        {x.warrantyStatus !== 'none' && x.warrantyExpires && (
          <Text style={{ color: x.warrantyStatus === 'active' ? colors.green : colors.muted, fontSize: typography.size.xs, marginTop: 2 }}>
            {x.warrantyStatus === 'active'
              ? t('assetRegister.warrantyActiveUntil', { date: date(x.warrantyExpires) })
              : t('assetRegister.warrantyExpired', { date: date(x.warrantyExpires) })}
          </Text>
        )}
      </View>
      <Text style={styles.amount}>{money(d.amount)}</Text>
    </View>
  );
}

export default function AssetRegister() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const dedQuery = useDeductions();
  const insertDeduction = useInsertDeduction();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCategory, setAddCategory] = useState<string>(ASSET_CATEGORIES[0]);
  const [addStore, setAddStore] = useState('');
  const [addPayment, setAddPayment] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  const [addDate, setAddDate] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addBusinessUsePct, setAddBusinessUsePct] = useState('');
  const [addWarrantyYears, setAddWarrantyYears] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const assets = useMemo(() => buildAssetRegister(dedQuery.data ?? [], todayIso), [dedQuery.data, todayIso]);
  const active = useMemo(() => activeWarranties(assets), [assets]);
  const totalValue = useMemo(() => assets.reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0), [assets]);

  function openAdd() {
    setAddName('');
    setAddCategory(ASSET_CATEGORIES[0]);
    setAddStore('');
    setAddPayment(PAYMENT_METHODS[0]);
    setAddDate(todayIso);
    setAddCost('');
    setAddBusinessUsePct('');
    setAddWarrantyYears('');
    setAddNotes('');
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amount = Number(addCost) || 0;
    const personal = isPersonalPayment(addPayment);

    // CLAUDE.md invariant #2: same personal-payment confirmation gate as
    // the Deductions manual-add form — asked once per save.
    if (personal && amount > 0) {
      const confirmed = await confirmOwnerContribution(addPayment);
      if (!confirmed) return;
    }

    // No business_use_pct schema column exists (CLAUDE.md invariant #20 —
    // no arbitrary user-defined columns); it's informational-only in legacy
    // too (captured but never affects the booked amount), so it folds into
    // the general-purpose `tags` field alongside free-text notes.
    const tagParts: string[] = [];
    if (addNotes.trim()) tagParts.push(addNotes.trim());
    const businessUsePct = addBusinessUsePct.trim() ? Number(addBusinessUsePct) : null;
    if (businessUsePct != null && businessUsePct !== 100) tagParts.push(`Business use: ${businessUsePct}%`);

    setAddSaving(true);
    try {
      const newDed = await insertDeduction.mutateAsync({
        user_id: userId,
        description: addName || null,
        category: addCategory,
        store: addStore || null,
        payment_method: addPayment,
        amount,
        ded_date: addDate || null,
        warranty_years: addWarrantyYears.trim() ? Number(addWarrantyYears) : null,
        tags: tagParts.length ? tagParts.join(' | ') : null,
        source: 'manual',
      });

      if (personal && amount > 0) {
        const plan = planContributionSync({
          isPersonal: true,
          amount,
          date: addDate || null,
          description: addName || null,
          paymentMethod: addPayment,
          existingContributionId: null,
        });
        await applyContributionSync(userId, newDed.id, plan);
      }

      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('assetRegister.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ScreenTitle>{t('assetRegister.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('assetRegister.add')}
            </Text>
          </Pressable>
        </View>

        <Card>
          <View style={styles.statRow}>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.totalAssets')}</MutedText>
              <Text style={styles.statValue}>{assets.length}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.totalValue')}</MutedText>
              <Text style={styles.statValue}>{money(totalValue, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.activeWarranties')}</MutedText>
              <Text style={styles.statValue}>{active.length}</Text>
            </View>
          </View>
        </Card>

        {active.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('assetRegister.activeWarrantiesTitle')}</Text>
            <Card>
              {active.map((x, i) => (
                <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                  <AssetCard x={x} />
                </View>
              ))}
            </Card>
          </>
        )}

        <Text style={styles.sectionTitle}>{t('assetRegister.allAssetsTitle')}</Text>
        <Card>
          {dedQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : assets.length === 0 ? (
            <MutedText>{t('assetRegister.empty')}</MutedText>
          ) : (
            assets.map((x, i) => (
              <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                <AssetCard x={x} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={closeAdd}>
        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          <SheetTitle>{t('assetRegister.addTitle')}</SheetTitle>

          <MutedText>{t('assetRegister.itemNameLabel')}</MutedText>
          <Field value={addName} onChangeText={setAddName} placeholder={t('assetRegister.itemNamePlaceholder')} />

          <MutedText>{t('assetRegister.categoryLabel')}</MutedText>
          <CategoryPicker kind="expense" value={addCategory} onChange={setAddCategory} />

          <View style={{ marginTop: spacing.sm }}>
            <MutedText>{t('assetRegister.storeLabel')}</MutedText>
          </View>
          <Field value={addStore} onChangeText={setAddStore} placeholder={t('assetRegister.storePlaceholder')} />

          <MutedText>{t('assetRegister.dateLabel')}</MutedText>
          <Field value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" />

          <MutedText>{t('assetRegister.costLabel')}</MutedText>
          <Field keyboardType="numeric" value={addCost} onChangeText={setAddCost} placeholder="0.00" />

          <MutedText>{t('assetRegister.paymentMethodLabel')}</MutedText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {PAYMENT_METHODS.map((p) => (
              <Pill key={p} label={p} selected={addPayment === p} onPress={() => setAddPayment(p)} />
            ))}
          </View>

          {isPersonalPayment(addPayment) && (
            <View
              style={{
                marginTop: spacing.sm,
                padding: spacing.sm,
                borderRadius: radii.sm,
                backgroundColor: 'rgba(245,158,11,0.12)',
              }}
            >
              <Text style={{ color: colors.orange, fontSize: typography.size.xs }}>
                {t('deductions.personalPaymentNote')}
              </Text>
            </View>
          )}

          <View style={{ marginTop: spacing.sm }}>
            <MutedText>{t('assetRegister.businessUsePctLabel')}</MutedText>
          </View>
          <Field keyboardType="numeric" value={addBusinessUsePct} onChangeText={setAddBusinessUsePct} placeholder="100" />

          <MutedText>{t('assetRegister.warrantyYearsLabel')}</MutedText>
          <Field keyboardType="numeric" value={addWarrantyYears} onChangeText={setAddWarrantyYears} placeholder={t('assetRegister.warrantyYearsPlaceholder')} />

          <MutedText>{t('assetRegister.notesLabel')}</MutedText>
          <Field value={addNotes} onChangeText={setAddNotes} placeholder={t('assetRegister.notesPlaceholder')} />

          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={addSaving} />
          <SecondaryButton title={t('common.cancel')} onPress={closeAdd} />
        </ScrollView>
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
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    paddingVertical: spacing.sm,
  },
  needsReviewRow: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
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
