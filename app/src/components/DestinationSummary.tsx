import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LinkedRecordKind, LinkedRecordRef } from '@/src/data/documentsFilter';
import { summarizeLinkedRecordCounts } from '@/src/data/documentsFilter';
import { CategoryPicker } from '@/src/components/CategoryPicker';
import { PAYMENT_METHODS, isPersonalPayment, type PaymentMethod } from '@/src/import/paymentMethods';
import { colors, radii, spacing, typography } from '@/src/theme';

// PAYMENT + DESTINATION SUMMARY (owner decision 2026-08-24, device testing
// round, item 2): the ONE shared block shown at the bottom of both the
// Settlement detail sheet and the Document viewer — "how it was paid" +
// "where it landed," every part editable in place. Deliberately does NOT
// duplicate this rendering per screen (a settlement's own summary and a
// receipt's own summary must always look and behave identically).
const KIND_ORDER: LinkedRecordKind[] = [
  'settlement',
  'deduction',
  'fuel',
  'load',
  'reimbursement',
  'maintenance',
  'bank_statement',
  'compliance_item',
  'household_income',
];

const KIND_LABEL_KEY: Record<LinkedRecordKind, string> = {
  settlement: 'destinationSummary.kindSettlement',
  deduction: 'destinationSummary.kindDeduction',
  fuel: 'destinationSummary.kindFuel',
  load: 'destinationSummary.kindLoad',
  reimbursement: 'destinationSummary.kindReimbursement',
  maintenance: 'destinationSummary.kindMaintenance',
  bank_statement: 'destinationSummary.kindBankStatement',
  compliance_item: 'destinationSummary.kindComplianceItem',
  household_income: 'destinationSummary.kindHouseholdIncome',
};

export type PaymentSummaryContext = {
  method: string | null;
  onChangeMethod: (method: PaymentMethod) => Promise<void> | void;
  saving?: boolean;
};

export function DestinationSummary({
  refs,
  onOpenRef,
  payment,
  onChangeDeductionCategory,
}: {
  refs: LinkedRecordRef[];
  onOpenRef: (ref: LinkedRecordRef) => void;
  // Omitted entirely (no row rendered) whenever there's no single coherent
  // payment method to show — e.g. a settlement's own net pay isn't a
  // "payment method" concept anywhere in this schema (Settlement has no
  // such column at all), so the caller passes null/undefined there rather
  // than this component guessing or fabricating one.
  payment?: PaymentSummaryContext | null;
  // Inline "change a row's category" (item 2's own explicit ask) for a
  // deduction-kind ref — omitted (falls back to "open the row itself"
  // only) when the caller doesn't supply it.
  onChangeDeductionCategory?: (deductionId: string, category: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [editingCategoryFor, setEditingCategoryFor] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  const counts = summarizeLinkedRecordCounts(refs);
  const countParts = KIND_ORDER.filter((k) => counts[k]).map((k) => t(KIND_LABEL_KEY[k], { count: counts[k] }));

  async function handleSaveCategory(deductionId: string) {
    if (!onChangeDeductionCategory) return;
    setSavingCategory(true);
    try {
      await onChangeDeductionCategory(deductionId, categoryDraft);
      setEditingCategoryFor(null);
    } finally {
      setSavingCategory(false);
    }
  }

  if (refs.length === 0 && !payment) return null;

  return (
    <View style={{ marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ color: colors.text, fontWeight: '700', marginBottom: spacing.xs }}>
        {t('destinationSummary.title')}
      </Text>

      {payment && (
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: 4 }}>
            {t('destinationSummary.paidVia')}
            {payment.method ? isPersonalPayment(payment.method) ? ` · ${t('deductions.personalContributionTag')}` : '' : ''}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {PAYMENT_METHODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => payment.onChangeMethod(p)}
                disabled={payment.saving}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: radii.sm,
                  borderWidth: 1,
                  borderColor: payment.method === p ? colors.accent : colors.border,
                  backgroundColor: payment.method === p ? colors.accent : colors.card2,
                  marginEnd: spacing.xs,
                  marginBottom: spacing.xs,
                }}
              >
                <Text style={{ color: colors.text, fontSize: typography.size.xs, fontWeight: '600' }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {refs.length > 0 && (
        <>
          <Text style={{ color: colors.muted, fontSize: typography.size.xs, marginBottom: spacing.xs }}>
            {t('destinationSummary.landedAs')} {countParts.join(' · ')}
          </Text>
          {refs.map((ref) => (
            <View
              key={`${ref.kind}-${ref.id}`}
              style={{
                paddingVertical: spacing.xs,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Pressable onPress={() => onOpenRef(ref)} style={{ flex: 1 }}>
                  <Text style={{ color: colors.text }}>{ref.label}</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {ref.kind === 'deduction' && onChangeDeductionCategory && (
                    <Pressable
                      onPress={() => {
                        setEditingCategoryFor(ref.id);
                        setCategoryDraft('');
                      }}
                      hitSlop={8}
                      style={{ marginEnd: spacing.sm }}
                    >
                      <Text style={{ color: colors.accent, fontSize: typography.size.sm }}>✏️</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => onOpenRef(ref)} hitSlop={8}>
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>›</Text>
                  </Pressable>
                </View>
              </View>
              {editingCategoryFor === ref.id && (
                <View style={{ marginTop: spacing.xs, marginBottom: spacing.xs }}>
                  <CategoryPicker kind="expense" value={categoryDraft} onChange={setCategoryDraft} />
                  <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
                    <Pressable
                      onPress={() => handleSaveCategory(ref.id)}
                      disabled={savingCategory || !categoryDraft}
                      style={{ marginEnd: spacing.md }}
                    >
                      <Text style={{ color: colors.accent, fontWeight: '700' }}>
                        {savingCategory ? t('common.saving') : t('common.save')}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => setEditingCategoryFor(null)}>
                      <Text style={{ color: colors.muted }}>{t('common.cancel')}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}
