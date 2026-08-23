import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useDeductions, useInsertDeduction, useUpdateDeduction, useDeleteDeduction } from '@/src/data/deductions';
import { fetchLinkedContributionId, applyContributionSync, cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { useLearnCategoryCorrection } from '@/src/data/categoryLearningRules';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { MonthGroupedList } from '@/src/components/monthGroups/MonthGroupedList';
import { needsReviewRowStyle, NeedsReviewChip } from '@/src/components/NeedsReviewBadge';
import { isDeductionNeedsReview } from '@/src/import/needsReview';
import { groupDeductions } from '@/src/stats/deductionGroups';
import { planContributionSync } from '@/src/stats/contributionSync';
import { defaultTaxDeductible } from '@/src/import/category';
import { findRowToAutoOpen } from '@/src/navigation/autoOpenParam';
import { isPersonalPayment, normalizePaymentMethod, PAYMENT_METHODS, type PaymentMethod } from '@/src/import/paymentMethods';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { useFormatters } from '@/src/i18n/format';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Deduction } from '@/src/types/db';

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

function DedRow({ x, onPress, onDelete }: { x: Deduction; onPress: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const personal = isPersonalPayment(x.payment_method);
  const needsReview = isDeductionNeedsReview(x);
  return (
    <Pressable onPress={onPress} style={[styles.row, needsReviewRowStyle(needsReview)]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.desc} numberOfLines={2}>
          {x.description ?? '—'}
        </Text>
        <MutedText>
          {x.ded_date ?? '—'} · {x.category ?? '—'}
          {x.store ? ` · ${x.store}` : ''}
        </MutedText>
        <Text style={{ color: personal ? colors.orange : colors.muted, fontSize: typography.size.xs, marginTop: 2 }}>
          {x.payment_method ?? '—'}
          {personal ? ` ${t('deductions.personalContributionTag')}` : ''}
        </Text>
        {x.tax_deductible === false && (
          <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginTop: 2, fontWeight: '700' }}>
            {t('deductions.nonDeductibleTag')}
          </Text>
        )}
        {needsReview && <NeedsReviewChip />}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.amount}>{money(x.amount)}</Text>
        <Pressable onPress={onDelete} hitSlop={8} style={{ marginTop: spacing.xs }}>
          <Text style={{ color: colors.red, fontSize: typography.size.sm, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function DedSection({
  screenKey,
  title,
  subtitle,
  rows,
  total,
  emptyLabel,
  onEdit,
  onDelete,
}: {
  screenKey: string;
  title: string;
  subtitle: string;
  rows: Deduction[];
  total: number;
  emptyLabel: string;
  onEdit: (x: Deduction) => void;
  onDelete: (x: Deduction) => void;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <>
      <View style={{ marginBottom: spacing.xs }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <MutedText>{subtitle}</MutedText>
      </View>
      {rows.length > 0 && (
        <View style={[styles.row, styles.totalRow, { marginBottom: spacing.xs }]}>
          <Text style={styles.totalLabel}>{t('deductions.total')}</Text>
          <Text style={styles.totalAmount}>{money(total)}</Text>
        </View>
      )}
      <MonthGroupedList
        screenKey={screenKey}
        rows={rows}
        getDate={(x) => x.ded_date}
        getAmount={(x) => x.amount}
        loadingLabel={t('common.loading')}
        emptyLabel={emptyLabel}
        renderRows={(monthRows) => (
          <Card>
            {monthRows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <DedRow x={x} onPress={() => onEdit(x)} onDelete={() => onDelete(x)} />
              </View>
            ))}
          </Card>
        )}
      />
    </>
  );
}

export default function Deductions() {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { session } = useAuth();
  const userId = session?.user.id;
  const router = useRouter();
  const { openId, filter } = useLocalSearchParams<{ openId?: string; filter?: string }>();
  // BETA FEEDBACK ROUND 2: Home's needs-review counter chip links here
  // with ?filter=needsReview to land with the toggle already on.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(filter === 'needsReview');
  // Segmented origin filter (owner decision 2026-08-05, FULL PARITY pass
  // item F.3) — the SAME origin rule Part B's Accountant Package screen
  // uses (a settlement-withheld row is never out-of-pocket): "All" keeps
  // showing both sections stacked (unchanged default behavior); the other
  // two options show ONLY that section, letting a user quickly answer
  // "what did I pay out of pocket this month" without scrolling past the
  // withheld section (or vice versa).
  const [originFilter, setOriginFilter] = useState<'all' | 'outOfPocket' | 'withheld'>('all');
  const autoOpenedRef = useRef(false);
  const dedQuery = useDeductions();
  const insertDeduction = useInsertDeduction();
  const updateDeduction = useUpdateDeduction();
  const learnCategoryCorrection = useLearnCategoryCorrection();
  const deleteDeduction = useDeleteDeduction();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<Deduction | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editPayment, setEditPayment] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editTaxDeductible, setEditTaxDeductible] = useState(true);
  const [saving, setSaving] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addDescription, setAddDescription] = useState('');
  const [addCategory, setAddCategory] = useState('Misc');
  const [addPayment, setAddPayment] = useState<PaymentMethod>(PAYMENT_METHODS[0]);
  const [addAmount, setAddAmount] = useState('');
  const [addDate, setAddDate] = useState('');
  const [addTaxDeductible, setAddTaxDeductible] = useState(true);
  const [addSaving, setAddSaving] = useState(false);

  // Meals & advance repayments (owner decision 2026-07-17): a smart default
  // from the picked category, recomputed only while the row is still being
  // composed (new "add" flow) — never re-applied to an EXISTING row just
  // because its category changed, so a user's own deliberate edit sticks.
  function handleAddCategoryChange(category: string) {
    setAddCategory(category);
    setAddTaxDeductible(defaultTaxDeductible(category));
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const allRows = dedQuery.data ?? [];
  const rows = useMemo(
    () => (needsReviewOnly ? allRows.filter(isDeductionNeedsReview) : allRows),
    [allRows, needsReviewOnly]
  );
  const { outOfPocket, withheld, outOfPocketTotal, withheldTotal } = useMemo(() => groupDeductions(rows), [rows]);

  function openEdit(x: Deduction) {
    setEditing(x);
    // Custom categories (CLAUDE.md invariant #19) are valid values here too
    // now — only an empty/never-set category falls back to "Misc".
    setEditCategory(x.category || 'Misc');
    setEditPayment(normalizePaymentMethod(x.payment_method));
    setEditAmount(String(x.amount ?? 0));
    setEditTaxDeductible(x.tax_deductible !== false);
  }

  function closeEdit() {
    setEditing(null);
  }

  // "View linked records" from the Documents Archive viewer (owner decision
  // 2026-07-30) jumps here with ?openId=<deductionId> — auto-opens it
  // exactly once (findRowToAutoOpen's "already opened" guard).
  useEffect(() => {
    const match = findRowToAutoOpen(allRows, openId, autoOpenedRef.current);
    if (match) {
      autoOpenedRef.current = true;
      openEdit(match);
    }
  }, [allRows, openId]);

  async function handleSaveEdit() {
    if (!editing || !userId) return;
    const amount = Number(editAmount) || 0;
    const personal = isPersonalPayment(editPayment);

    setSaving(true);
    try {
      const existingContributionId = await fetchLinkedContributionId(userId, editing.id);
      let plan = planContributionSync({
        isPersonal: personal,
        amount,
        date: editing.ded_date,
        description: editing.description,
        paymentMethod: editPayment,
        existingContributionId,
      });

      // CLAUDE.md invariant #2: a NEW contribution (none existed before)
      // only gets created after explicit confirmation. Updating/removing
      // an already-linked contribution is unconditional.
      if (plan.action === 'create') {
        const confirmed = await confirmOwnerContribution(editPayment);
        if (!confirmed) plan = { action: 'noop' };
      }

      await updateDeduction.mutateAsync({
        id: editing.id,
        values: { category: editCategory, payment_method: editPayment, amount, tax_deductible: editTaxDeductible },
      });
      await applyContributionSync(userId, editing.id, plan);
      // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
      // follow-up item G) — a genuine manual re-categorization (the user
      // picked something DIFFERENT from what was already there, not just
      // re-saving the same value) teaches a keyword->category rule for
      // next time. Best-effort: never blocks the save on failure.
      if (editCategory && editCategory !== (editing.category || 'Misc')) {
        learnCategoryCorrection.mutate({ userId, description: editing.description, category: editCategory });
      }
      await invalidateFinancialData(queryClient);
      setEditing(null);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setSaving(false);
    }
  }

  function openAdd() {
    setAddDescription('');
    setAddCategory('Misc');
    setAddPayment(PAYMENT_METHODS[0]);
    setAddAmount('');
    setAddDate(new Date().toISOString().slice(0, 10));
    setAddTaxDeductible(true);
    setAdding(true);
  }

  function closeAdd() {
    setAdding(false);
  }

  async function handleSaveAdd() {
    if (!userId) return;
    const amount = Number(addAmount) || 0;
    const personal = isPersonalPayment(addPayment);

    // CLAUDE.md invariant #2: a personal-payment purchase only creates a
    // linked capital contribution after explicit confirmation — same gate
    // as editing, asked once per save, not per line item.
    if (personal && amount > 0) {
      const confirmed = await confirmOwnerContribution(addPayment);
      if (!confirmed) return;
    }

    setAddSaving(true);
    try {
      const newDed = await insertDeduction.mutateAsync({
        user_id: userId,
        description: addDescription || null,
        category: addCategory,
        payment_method: addPayment,
        amount,
        ded_date: addDate || null,
        source: 'manual',
        tax_deductible: addTaxDeductible,
      });

      if (personal && amount > 0) {
        const plan = planContributionSync({
          isPersonal: true,
          amount,
          date: addDate || null,
          description: addDescription || null,
          paymentMethod: addPayment,
          existingContributionId: null,
        });
        await applyContributionSync(userId, newDed.id, plan);
      }

      await invalidateFinancialData(queryClient);
      setAdding(false);
    } catch (err) {
      Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
    } finally {
      setAddSaving(false);
    }
  }

  function handleDelete(x: Deduction) {
    Alert.alert(t('deductions.deleteConfirmTitle'), t('deductions.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            // Linked capital_transactions row cascades automatically
            // (docs/SCHEMA.sql: linked_deduction_id ... on delete cascade —
            // CLAUDE.md invariant #5).
            await deleteDeduction.mutateAsync(x.id);
            if (x.document_id) await cleanupOrphanedDocument(x.document_id);
            await invalidateFinancialData(queryClient);
          } catch (err) {
            Alert.alert(t('deductions.deleteFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
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
          <ScreenTitle>{t('deductions.title')}</ScreenTitle>
          <Pressable onPress={openAdd} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700' }}>
              + {t('deductions.add')}
            </Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
          <Pill
            label={t('needsReview.filterOnly')}
            selected={needsReviewOnly}
            onPress={() => setNeedsReviewOnly((v) => !v)}
          />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
          <Pill label={t('deductions.originFilterAll')} selected={originFilter === 'all'} onPress={() => setOriginFilter('all')} />
          <Pill
            label={t('deductions.originFilterOutOfPocket')}
            selected={originFilter === 'outOfPocket'}
            onPress={() => setOriginFilter('outOfPocket')}
          />
          <Pill
            label={t('deductions.originFilterWithheld')}
            selected={originFilter === 'withheld'}
            onPress={() => setOriginFilter('withheld')}
          />
        </View>

        {dedQuery.isLoading ? (
          <Card>
            <MutedText>{t('common.loading')}</MutedText>
          </Card>
        ) : (
          <>
            {originFilter !== 'withheld' && (
              <DedSection
                screenKey="deductions-outOfPocket"
                title={t('deductions.outOfPocketTitle')}
                subtitle={t('deductions.outOfPocketSubtitle')}
                rows={outOfPocket}
                total={outOfPocketTotal}
                emptyLabel={t('deductions.outOfPocketEmpty')}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            )}
            {originFilter !== 'outOfPocket' && (
              <DedSection
                screenKey="deductions-withheld"
                title={t('deductions.withheldTitle')}
                subtitle={t('deductions.withheldSubtitle')}
                rows={withheld}
                total={withheldTotal}
                emptyLabel={t('deductions.withheldEmpty')}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!editing} onClose={closeEdit}>
        <SheetTitle>{t('deductions.editTitle')}</SheetTitle>
        {editing && (
          <MutedText>
            {(editing.description ?? 'Deduction').split(' — ')[0]} — {money(editing.amount)}
          </MutedText>
        )}

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.categoryLabel')}</MutedText>
        </View>
        <CategoryPicker kind="expense" value={editCategory} onChange={setEditCategory} />

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.taxDeductibleLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Pill label={t('deductions.taxDeductibleYes')} selected={editTaxDeductible} onPress={() => setEditTaxDeductible(true)} />
          <Pill label={t('deductions.taxDeductibleNo')} selected={!editTaxDeductible} onPress={() => setEditTaxDeductible(false)} />
        </View>

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.amountLabel')}</MutedText>
        </View>
        <Field keyboardType="numeric" value={editAmount} onChangeText={setEditAmount} placeholder="0.00" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.paymentMethodLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map((p) => (
            <Pill key={p} label={p} selected={editPayment === p} onPress={() => setEditPayment(p)} />
          ))}
        </View>

        {isPersonalPayment(editPayment) && (
          <View
            style={{
              marginTop: spacing.md,
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

        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveEdit} loading={saving} />
        {editing?.document_id && (
          <SecondaryButton
            title={`📄 ${t('common.viewOriginalDocument')}`}
            onPress={() => {
              const documentId = editing.document_id as string;
              closeEdit();
              router.push({ pathname: '/(tabs)/more/documents', params: { openId: documentId } } as unknown as Href);
            }}
          />
        )}
        <SecondaryButton title={t('common.cancel')} onPress={closeEdit} />
      </ModalSheet>

      <ModalSheet visible={adding} onClose={closeAdd}>
        <SheetTitle>{t('deductions.addTitle')}</SheetTitle>

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.descriptionLabel')}</MutedText>
        </View>
        <Field value={addDescription} onChangeText={setAddDescription} placeholder={t('deductions.descriptionPlaceholder')} />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.categoryLabel')}</MutedText>
        </View>
        <CategoryPicker kind="expense" value={addCategory} onChange={handleAddCategoryChange} />

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.taxDeductibleLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Pill label={t('deductions.taxDeductibleYes')} selected={addTaxDeductible} onPress={() => setAddTaxDeductible(true)} />
          <Pill label={t('deductions.taxDeductibleNo')} selected={!addTaxDeductible} onPress={() => setAddTaxDeductible(false)} />
        </View>

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.dateLabel')}</MutedText>
        </View>
        <Field value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.amountLabel')}</MutedText>
        </View>
        <Field keyboardType="numeric" value={addAmount} onChangeText={setAddAmount} placeholder="0.00" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>{t('deductions.paymentMethodLabel')}</MutedText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PAYMENT_METHODS.map((p) => (
            <Pill key={p} label={p} selected={addPayment === p} onPress={() => setAddPayment(p)} />
          ))}
        </View>

        {isPersonalPayment(addPayment) && (
          <View
            style={{
              marginTop: spacing.md,
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

        <PrimaryButton title={`💾 ${t('common.save')}`} onPress={handleSaveAdd} loading={addSaving} />
        <SecondaryButton title={t('common.cancel')} onPress={closeAdd} />
      </ModalSheet>
    </Screen>
  );
}

const styles = {
  sectionTitle: {
    color: colors.text,
    fontSize: typography.size.md,
    fontWeight: '700' as const,
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
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: typography.size.sm,
    fontWeight: '700' as const,
  },
  totalAmount: {
    color: colors.text,
    fontSize: typography.size.lg,
    fontWeight: '700' as const,
  },
};
