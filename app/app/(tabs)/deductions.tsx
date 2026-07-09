import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { useDeductions, useUpdateDeduction, useDeleteDeduction } from '@/src/data/deductions';
import { fetchLinkedContributionId, applyContributionSync, cleanupOrphanedDocument } from '@/src/data/deductionMutations';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { groupDeductions } from '@/src/stats/deductionGroups';
import { planContributionSync } from '@/src/stats/contributionSync';
import { isPersonalPayment, normalizePaymentMethod, PAYMENT_METHODS } from '@/src/import/paymentMethods';
import { DED_CATEGORIES } from '@/src/import/category';
import { confirmOwnerContribution } from '@/src/lib/confirmOwnerContribution';
import { Screen, ScreenTitle, Card, MutedText, ModalSheet, SheetTitle, Field, PrimaryButton, SecondaryButton } from '@/src/components/ui';
import { colors, radii, spacing, typography } from '@/src/theme';
import type { Deduction } from '@/src/types/db';

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

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
        marginRight: spacing.xs,
        marginBottom: spacing.xs,
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function DedRow({ x, onPress, onDelete }: { x: Deduction; onPress: () => void; onDelete: () => void }) {
  const personal = isPersonalPayment(x.payment_method);
  return (
    <Pressable onPress={onPress} style={styles.row}>
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
          {personal ? ' 💰 → Capital Contribution' : ''}
        </Text>
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
  title,
  subtitle,
  rows,
  total,
  emptyLabel,
  onEdit,
  onDelete,
}: {
  title: string;
  subtitle: string;
  rows: Deduction[];
  total: number;
  emptyLabel: string;
  onEdit: (x: Deduction) => void;
  onDelete: (x: Deduction) => void;
}) {
  return (
    <>
      <View style={{ marginBottom: spacing.xs }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <MutedText>{subtitle}</MutedText>
      </View>
      <Card>
        {rows.length === 0 ? (
          <MutedText>{emptyLabel}</MutedText>
        ) : (
          <>
            {rows.map((x, i) => (
              <View key={x.id} style={i > 0 ? styles.rowBorder : undefined}>
                <DedRow x={x} onPress={() => onEdit(x)} onDelete={() => onDelete(x)} />
              </View>
            ))}
            <View style={[styles.row, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{money(total)}</Text>
            </View>
          </>
        )}
      </Card>
    </>
  );
}

export default function Deductions() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const dedQuery = useDeductions();
  const updateDeduction = useUpdateDeduction();
  const deleteDeduction = useDeleteDeduction();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const [editing, setEditing] = useState<Deduction | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editPayment, setEditPayment] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidateFinancialData(queryClient);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const rows = dedQuery.data ?? [];
  const { outOfPocket, withheld, outOfPocketTotal, withheldTotal } = useMemo(() => groupDeductions(rows), [rows]);

  function openEdit(x: Deduction) {
    setEditing(x);
    const knownCategories: readonly string[] = DED_CATEGORIES;
    setEditCategory(x.category && knownCategories.includes(x.category) ? x.category : 'Misc');
    setEditPayment(normalizePaymentMethod(x.payment_method));
    setEditAmount(String(x.amount ?? 0));
  }

  function closeEdit() {
    setEditing(null);
  }

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
        values: { category: editCategory, payment_method: editPayment, amount },
      });
      await applyContributionSync(userId, editing.id, plan);
      await invalidateFinancialData(queryClient);
      setEditing(null);
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(x: Deduction) {
    Alert.alert('Delete this deduction?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
            Alert.alert('Delete failed', err instanceof Error ? err.message : 'Please try again.');
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
        <ScreenTitle>Deductions</ScreenTitle>

        {dedQuery.isLoading ? (
          <Card>
            <MutedText>Loading…</MutedText>
          </Card>
        ) : (
          <>
            <DedSection
              title="💳 Out-of-Pocket"
              subtitle="Tax deductible — paid by you (business card, personal card, cash)"
              rows={outOfPocket}
              total={outOfPocketTotal}
              emptyLabel="None yet — import a receipt or invoice."
              onEdit={openEdit}
              onDelete={handleDelete}
            />
            <DedSection
              title="🏦 Withheld from Settlement"
              subtitle="Already reflected in net pay, NOT re-deducted (ELD, insurance, truck payment)"
              rows={withheld}
              total={withheldTotal}
              emptyLabel="None yet — import a settlement PDF."
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          </>
        )}
      </ScrollView>

      <ModalSheet visible={!!editing} onClose={closeEdit}>
        <SheetTitle>✏️ Edit Deduction</SheetTitle>
        {editing && (
          <MutedText>
            {(editing.description ?? 'Deduction').split(' — ')[0]} — {money(editing.amount)}
          </MutedText>
        )}

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>Category</MutedText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DED_CATEGORIES.map((c) => (
            <Pill key={c} label={c} selected={editCategory === c} onPress={() => setEditCategory(c)} />
          ))}
        </View>

        <View style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
          <MutedText>Amount ($)</MutedText>
        </View>
        <Field keyboardType="numeric" value={editAmount} onChangeText={setEditAmount} placeholder="0.00" />

        <View style={{ marginBottom: spacing.xs }}>
          <MutedText>Payment Method</MutedText>
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
              💰 A personal payment method means this was paid with the owner's own money — it will be recorded (or
              kept in sync) as a Capital Account contribution.
            </Text>
          </View>
        )}

        <PrimaryButton title="💾 Save" onPress={handleSaveEdit} loading={saving} />
        <SecondaryButton title="Cancel" onPress={closeEdit} />
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
    marginLeft: spacing.sm,
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
