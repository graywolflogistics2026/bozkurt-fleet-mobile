import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useDeductions, useInsertDeduction, useUpdateDeduction } from '@/src/data/deductions';
import { applyContributionSync, fetchLinkedContributionId } from '@/src/data/deductionMutations';
import { planContributionSync } from '@/src/stats/contributionSync';
import { isPersonalPayment, normalizePaymentMethod, PAYMENT_METHODS, type PaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import {
  buildAssetRegister,
  activeWarranties,
  buildAssetCategoryBreakdown,
  thisMonthTotal,
  ASSET_CATEGORIES,
  type AssetRow,
} from '@/src/stats/assetRegister';
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

function AssetCard({ x, onPress }: { x: AssetRow; onPress?: () => void }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const d = x.deduction;
  return (
    <Pressable onPress={onPress} style={[styles.row, x.needsReview && styles.needsReviewRow]}>
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
    </Pressable>
  );
}

type AssetFormValues = {
  name: string;
  category: string;
  store: string;
  payment: PaymentMethod;
  date: string;
  cost: string;
  businessUsePct: string;
  warrantyYears: string;
  notes: string;
};

function AssetFormFields({ values, onChange }: { values: AssetFormValues; onChange: (v: AssetFormValues) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <MutedText>{t('assetRegister.itemNameLabel')}</MutedText>
      <Field value={values.name} onChangeText={(v) => onChange({ ...values, name: v })} placeholder={t('assetRegister.itemNamePlaceholder')} />

      <MutedText>{t('assetRegister.categoryLabel')}</MutedText>
      <CategoryPicker kind="expense" value={values.category} onChange={(v) => onChange({ ...values, category: v })} />

      <View style={{ marginTop: spacing.sm }}>
        <MutedText>{t('assetRegister.storeLabel')}</MutedText>
      </View>
      <Field value={values.store} onChangeText={(v) => onChange({ ...values, store: v })} placeholder={t('assetRegister.storePlaceholder')} />

      <MutedText>{t('assetRegister.dateLabel')}</MutedText>
      <Field value={values.date} onChangeText={(v) => onChange({ ...values, date: v })} placeholder="YYYY-MM-DD" />

      <MutedText>{t('assetRegister.costLabel')}</MutedText>
      <Field keyboardType="numeric" value={values.cost} onChangeText={(v) => onChange({ ...values, cost: v })} placeholder="0.00" />

      <MutedText>{t('assetRegister.paymentMethodLabel')}</MutedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {PAYMENT_METHODS.map((p) => (
          <Pill key={p} label={p} selected={values.payment === p} onPress={() => onChange({ ...values, payment: p })} />
        ))}
      </View>

      {isPersonalPayment(values.payment) && (
        <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: 'rgba(245,158,11,0.12)' }}>
          <Text style={{ color: colors.orange, fontSize: typography.size.xs }}>{t('deductions.personalPaymentNote')}</Text>
        </View>
      )}

      <View style={{ marginTop: spacing.sm }}>
        <MutedText>{t('assetRegister.businessUsePctLabel')}</MutedText>
      </View>
      <Field keyboardType="numeric" value={values.businessUsePct} onChangeText={(v) => onChange({ ...values, businessUsePct: v })} placeholder="100" />

      <MutedText>{t('assetRegister.warrantyYearsLabel')}</MutedText>
      <Field
        keyboardType="numeric"
        value={values.warrantyYears}
        onChangeText={(v) => onChange({ ...values, warrantyYears: v })}
        placeholder={t('assetRegister.warrantyYearsPlaceholder')}
      />

      <MutedText>{t('assetRegister.notesLabel')}</MutedText>
      <Field value={values.notes} onChangeText={(v) => onChange({ ...values, notes: v })} placeholder={t('assetRegister.notesPlaceholder')} />
    </>
  );
}

const CATEGORY_FILTER_ALL = 'all';

export default function AssetRegister() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const dedQuery = useDeductions();
  const insertDeduction = useInsertDeduction();
  const updateDeduction = useUpdateDeduction();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>(CATEGORY_FILTER_ALL);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<AssetFormValues>({
    name: '',
    category: ASSET_CATEGORIES[0],
    store: '',
    payment: PAYMENT_METHODS[0],
    date: '',
    cost: '',
    businessUsePct: '',
    warrantyYears: '',
    notes: '',
  });
  const [addSaving, setAddSaving] = useState(false);

  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [editForm, setEditForm] = useState<AssetFormValues>({
    name: '',
    category: ASSET_CATEGORIES[0],
    store: '',
    payment: PAYMENT_METHODS[0],
    date: '',
    cost: '',
    businessUsePct: '',
    warrantyYears: '',
    notes: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthKey = useMemo(() => todayIso.slice(0, 7), [todayIso]);
  const assets = useMemo(() => buildAssetRegister(dedQuery.data ?? [], todayIso), [dedQuery.data, todayIso]);
  const active = useMemo(() => activeWarranties(assets), [assets]);
  const totalValue = useMemo(() => assets.reduce((sum, a) => sum + Number(a.deduction.amount ?? 0), 0), [assets]);
  const avgPerItem = assets.length > 0 ? totalValue / assets.length : 0;
  const monthTotal = useMemo(() => thisMonthTotal(assets, currentMonthKey), [assets, currentMonthKey]);
  const categoryBreakdown = useMemo(() => buildAssetCategoryBreakdown(assets), [assets]);
  const filteredAssets = useMemo(
    () => (filterCategory === CATEGORY_FILTER_ALL ? assets : assets.filter((a) => a.deduction.category === filterCategory)),
    [assets, filterCategory]
  );

  // Folds business-use% + free notes into `tags` — no business_use_pct
  // schema column exists (CLAUDE.md invariant #20), and it's
  // informational-only in legacy too (captured but never affects the
  // booked amount).
  function buildTags(notes: string, businessUsePctStr: string): string | null {
    const tagParts: string[] = [];
    if (notes.trim()) tagParts.push(notes.trim());
    const businessUsePct = businessUsePctStr.trim() ? Number(businessUsePctStr) : null;
    if (businessUsePct != null && businessUsePct !== 100) tagParts.push(`Business use: ${businessUsePct}%`);
    return tagParts.length ? tagParts.join(' | ') : null;
  }

  function openAdd() {
    setAddForm({
      name: '',
      category: ASSET_CATEGORIES[0],
      store: '',
      payment: PAYMENT_METHODS[0],
      date: todayIso,
      cost: '',
      businessUsePct: '',
      warrantyYears: '',
      notes: '',
    });
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amount = Number(addForm.cost) || 0;
    const personal = isPersonalPayment(addForm.payment);

    // CLAUDE.md invariant #2: same personal-payment confirmation gate as
    // the Deductions manual-add form — asked once per save.
    if (personal && amount > 0) {
      const confirmed = await confirmOwnerContribution(addForm.payment);
      if (!confirmed) return;
    }

    setAddSaving(true);
    try {
      const newDed = await insertDeduction.mutateAsync({
        user_id: userId,
        description: addForm.name || null,
        category: addForm.category,
        store: addForm.store || null,
        payment_method: addForm.payment,
        amount,
        ded_date: addForm.date || null,
        warranty_years: addForm.warrantyYears.trim() ? Number(addForm.warrantyYears) : null,
        tags: buildTags(addForm.notes, addForm.businessUsePct),
        source: 'manual',
      });

      if (personal && amount > 0) {
        const plan = planContributionSync({
          isPersonal: true,
          amount,
          date: addForm.date || null,
          description: addForm.name || null,
          paymentMethod: addForm.payment,
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

  function openEdit(x: AssetRow) {
    const d = x.deduction;
    setEditing(x);
    setEditForm({
      name: d.description ?? '',
      category: d.category || ASSET_CATEGORIES[0],
      store: d.store ?? '',
      payment: normalizePaymentMethod(d.payment_method),
      date: d.ded_date ?? '',
      cost: String(d.amount ?? 0),
      businessUsePct: '',
      warrantyYears: d.warranty_years != null ? String(d.warranty_years) : '',
      notes: d.tags ?? '',
    });
  }

  function closeEdit() {
    setEditing(null);
  }

  async function handleSaveEdit() {
    if (!editing || !userId) return;
    const amount = Number(editForm.cost) || 0;
    const personal = isPersonalPayment(editForm.payment);

    setEditSaving(true);
    try {
      // Same create-vs-sync contribution logic as the main Deductions
      // edit flow (CLAUDE.md invariant #2): a NEW contribution only after
      // explicit confirmation; updating/removing an already-linked one is
      // unconditional.
      const existingContributionId = await fetchLinkedContributionId(userId, editing.deduction.id);
      let plan = planContributionSync({
        isPersonal: personal,
        amount,
        date: editForm.date || null,
        description: editForm.name || null,
        paymentMethod: editForm.payment,
        existingContributionId,
      });
      if (plan.action === 'create') {
        const confirmed = await confirmOwnerContribution(editForm.payment);
        if (!confirmed) plan = { action: 'noop' };
      }

      await updateDeduction.mutateAsync({
        id: editing.deduction.id,
        values: {
          description: editForm.name || null,
          category: editForm.category,
          store: editForm.store || null,
          payment_method: editForm.payment,
          amount,
          ded_date: editForm.date || null,
          warranty_years: editForm.warrantyYears.trim() ? Number(editForm.warrantyYears) : null,
          tags: buildTags(editForm.notes, editForm.businessUsePct),
        },
      });
      await applyContributionSync(userId, editing.deduction.id, plan);
      await invalidateFinancialData(queryClient);
      setEditing(null);
    } catch (err) {
      Alert.alert(t('assetRegister.saveFailedTitle'), err instanceof Error ? err.message : t('common.tryAgain'));
    } finally {
      setEditSaving(false);
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
          </View>
          <View style={[styles.statRow, { marginTop: spacing.sm }]}>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.thisMonth')}</MutedText>
              <Text style={styles.statValue}>{money(monthTotal, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.avgPerItem')}</MutedText>
              <Text style={styles.statValue}>{money(avgPerItem, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.statCell}>
              <MutedText>{t('assetRegister.activeWarranties')}</MutedText>
              <Text style={styles.statValue}>{active.length}</Text>
            </View>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>{t('assetRegister.categoryBreakdownTitle')}</Text>
        <Card>
          {categoryBreakdown.map((row, i) => (
            <View key={row.category} style={[styles.categoryRow, i > 0 && styles.rowBorder, row.category === 'Total' && styles.categoryTotalRow]}>
              <Text style={{ color: colors.text, fontWeight: row.category === 'Total' ? '700' : '500' }}>
                {row.category === 'Total' ? t('assetRegister.total') : row.category}
              </Text>
              <MutedText>{row.count}</MutedText>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{money(row.total, { maximumFractionDigits: 0 })}</Text>
            </View>
          ))}
        </Card>

        {active.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('assetRegister.activeWarrantiesTitle')}</Text>
            <Card>
              {active.map((x, i) => (
                <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                  <AssetCard x={x} onPress={() => openEdit(x)} />
                </View>
              ))}
            </Card>
          </>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
          <Text style={styles.sectionTitle}>{t('assetRegister.allAssetsTitle')}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Pill label={t('assetRegister.allCategories')} selected={filterCategory === CATEGORY_FILTER_ALL} onPress={() => setFilterCategory(CATEGORY_FILTER_ALL)} />
          {ASSET_CATEGORIES.map((c) => (
            <Pill key={c} label={c} selected={filterCategory === c} onPress={() => setFilterCategory(c)} />
          ))}
        </View>
        <Card>
          {dedQuery.isLoading ? (
            <MutedText>{t('common.loading')}</MutedText>
          ) : filteredAssets.length === 0 ? (
            <MutedText>{t('assetRegister.empty')}</MutedText>
          ) : (
            filteredAssets.map((x, i) => (
              <View key={x.deduction.id} style={i > 0 ? styles.rowBorder : undefined}>
                <AssetCard x={x} onPress={() => openEdit(x)} />
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ModalSheet visible={adding} onClose={closeAdd}>
        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          <SheetTitle>{t('assetRegister.addTitle')}</SheetTitle>
          <AssetFormFields values={addForm} onChange={setAddForm} />
          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={addSaving} />
          <SecondaryButton title={t('common.cancel')} onPress={closeAdd} />
        </ScrollView>
      </ModalSheet>

      <ModalSheet visible={!!editing} onClose={closeEdit}>
        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          <SheetTitle>{t('assetRegister.editTitle')}</SheetTitle>
          <AssetFormFields values={editForm} onChange={setEditForm} />
          <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={editSaving} />
          <SecondaryButton title={t('common.cancel')} onPress={closeEdit} />
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
  categoryRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
  },
  categoryTotalRow: {
    borderTopWidth: 2,
    borderTopColor: colors.border,
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
