import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CategoryPickerSheet } from '@/src/components/CategoryPicker';
import { MutedText } from '@/src/components/ui';
import { formatMoney } from '@/src/i18n/format';
import { effectiveDeductible, expenseDecisionPath, type ExpenseChoiceState } from '@/src/import/expenseDecision';
import { mapFinancialDocDeduction, mapGenericDeduction, mapPurchase } from '@/src/import/mapExtraction';
import type { Extraction } from '@/src/import/types';
import { colors, radii, spacing, typography } from '@/src/theme';

// USER DECIDES DEDUCTIBILITY (owner decision 2026-11-24). The import card's
// required Yes / No for a receipt or expense document: empty by default,
// one answer for the whole document ("apply to all items") plus a per-item
// override, and an editable category for every Yes row. The AI's own
// taxDeductible value is never shown or used.
// CATEGORY POP-UP (owner 2026-11-24, after the phone test): Yes on one item
// opens the full category list right away (CategoryPickerSheet), in the
// app's normal order with nothing suggested. "Yes to all" opens nothing; each item shows a big
// "Category: X · Change" row that opens the same pop-up. Closing the pop-up
// keeps the item's current category. Saving is unchanged.

type Row = { label: string; amount: number; category: string };

function choiceRows(d: Extraction, userId: string, categoryOverride: string): Row[] {
  const path = expenseDecisionPath(d);
  if (path === 'purchase') {
    return mapPurchase(d, userId).map((line) => ({
      label: String(line.insert.description ?? '').split(' — ')[0] || String(line.insert.category ?? ''),
      amount: Number(line.insert.amount ?? 0),
      category: String(line.insert.category ?? ''),
    }));
  }
  if (path === 'financial') {
    const row = mapFinancialDocDeduction(d, userId);
    return [{ label: d.vendor ?? String(row.category ?? ''), amount: Number(row.amount ?? 0), category: String(row.category ?? '') }];
  }
  if (path === 'generic') {
    const row = mapGenericDeduction(d, userId, categoryOverride || null);
    return [{ label: d.vendor ?? d.summary ?? String(row.category ?? ''), amount: Number(row.amount ?? 0), category: String(row.category ?? '') }];
  }
  return [];
}

function ChoicePill({ label, selected, tone, onPress }: { label: string; selected: boolean; tone: 'yes' | 'no'; onPress: () => void }) {
  const on = tone === 'yes' ? colors.green : colors.red;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingHorizontal: 16,
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: radii.sm,
        borderWidth: 1,
        borderColor: selected ? on : colors.border,
        backgroundColor: selected ? on : colors.card2,
        marginEnd: spacing.xs,
        marginBottom: spacing.xs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function ExpenseDeductibleChoice({
  extraction,
  userId,
  value,
  onChange,
  categoryOverride,
  onCategoryOverride,
}: {
  extraction: Extraction;
  userId: string;
  value: ExpenseChoiceState;
  onChange: (next: ExpenseChoiceState) => void;
  // The 'other' docType keeps its existing category state (categoryOverride).
  categoryOverride: string;
  onCategoryOverride: (category: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const rows = useMemo(() => choiceRows(extraction, userId, categoryOverride), [extraction, userId, categoryOverride]);
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  if (rows.length === 0) return null;
  const multi = rows.length > 1;
  const usesOverride = extraction.docType === 'other';

  function setAll(deductible: boolean) {
    onChange({ ...value, all: deductible, perRow: {} });
    // One item: Yes opens the category pop-up at once. "Yes to all" on
    // several items opens nothing (each keeps its suggested category).
    if (deductible && rows.length === 1) setSheetFor(0);
  }
  function setRow(i: number, deductible: boolean) {
    onChange({ ...value, perRow: { ...value.perRow, [i]: deductible } });
    if (deductible) setSheetFor(i);
  }
  function categoryOf(i: number): string {
    if (usesOverride) return categoryOverride || rows[i].category;
    return value.categories[i] ?? rows[i].category;
  }
  function setCategory(i: number, category: string) {
    if (usesOverride) onCategoryOverride(category);
    else onChange({ ...value, categories: { ...value.categories, [i]: category } });
    setSheetFor(null);
  }

  function categoryLine(i: number) {
    return (
      <Pressable
        onPress={() => setSheetFor(i)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: spacing.xs,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radii.sm,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card2,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ flex: 1, color: colors.text, fontSize: typography.size.md, fontWeight: '600' }}>
          {t('importScreen.deductChoice.categoryLabel', { category: categoryOf(i) })}
        </Text>
        <Text style={{ color: colors.accent, fontSize: typography.size.md, fontWeight: '700', marginStart: spacing.sm }}>
          {t('importScreen.deductChoice.changeCategory')}
        </Text>
      </Pressable>
    );
  }

  const answered = rows.map((_, i) => effectiveDeductible(value, i));
  const allNo = answered.every((a) => a === false);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: answered.some((a) => a === null) ? colors.orange : colors.border,
        borderRadius: radii.sm,
        padding: spacing.sm,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }}>{t('importScreen.deductChoice.title')}</Text>
      <MutedText style={{ marginBottom: spacing.xs }}>{t('importScreen.deductChoice.hint')}</MutedText>
      {multi && <MutedText>{t('importScreen.deductChoice.applyAll')}</MutedText>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
        <ChoicePill label={t('importScreen.deductChoice.yes')} tone="yes" selected={value.all === true && Object.keys(value.perRow).length === 0} onPress={() => setAll(true)} />
        <ChoicePill label={t('importScreen.deductChoice.no')} tone="no" selected={value.all === false && Object.keys(value.perRow).length === 0} onPress={() => setAll(false)} />
      </View>

      {!multi && answered[0] === true && categoryLine(0)}

      {multi &&
        rows.map((row, i) => (
          <View key={i} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs, marginTop: spacing.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={2}>
                {row.label}
              </Text>
              <Text style={{ color: colors.text, fontWeight: '600', marginStart: spacing.sm }}>{formatMoney(row.amount, i18n.language)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs }}>
              <ChoicePill label={t('importScreen.deductChoice.yes')} tone="yes" selected={answered[i] === true} onPress={() => setRow(i, true)} />
              <ChoicePill label={t('importScreen.deductChoice.no')} tone="no" selected={answered[i] === false} onPress={() => setRow(i, false)} />
            </View>
            {answered[i] === true && categoryLine(i)}
          </View>
        ))}

      {answered.some((a) => a === null) ? (
        <MutedText style={{ color: colors.orange, marginTop: spacing.xs }}>{t('importScreen.deductChoice.required')}</MutedText>
      ) : allNo ? (
        <MutedText style={{ marginTop: spacing.xs }}>{t('importScreen.deductChoice.noHint')}</MutedText>
      ) : null}

      <CategoryPickerSheet
        visible={sheetFor !== null && answered[sheetFor] === true}
        kind="expense"
        value={sheetFor !== null ? categoryOf(sheetFor) : ''}
        title={t('importScreen.deductChoice.pickTitle')}
        onSelect={(c) => sheetFor !== null && setCategory(sheetFor, c)}
        onClose={() => setSheetFor(null)}
      />
    </View>
  );
}
