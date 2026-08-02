import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSettlements } from '@/src/data/settlements';
import { useDeductions } from '@/src/data/deductions';
import { useDocuments } from '@/src/data/documents';
import { useFormatters } from '@/src/i18n/format';
import { Screen, ScreenTitle, TappableCard, MutedText } from '@/src/components/ui';
import { needsReviewRowStyle, NeedsReviewChip } from '@/src/components/NeedsReviewBadge';
import { isDeductionNeedsReview, isSettlementNeedsReview } from '@/src/import/needsReview';
import { colors, radii, spacing, typography } from '@/src/theme';

type TransactionType = 'income' | 'expense';
type TransactionRow = { id: string; date: string; type: TransactionType; label: string; amount: number; needsReview: boolean };
type FilterValue = 'all' | TransactionType;

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
      }}
    >
      <Text style={{ color: colors.text, fontSize: typography.size.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// Session 9e-B8: unified income+expense list (tab bar restructure to
// Home/Transactions/+/Reports/Menu) — a read-only rollup of the same
// settlements/deductions data the Deductions and Settlements screens
// already manage; tapping a row goes to the screen that owns it (this
// screen doesn't duplicate their add/edit/delete flows).
export default function Transactions() {
  const { t } = useTranslation();
  const router = useRouter();
  const { money: moneyFmt, date } = useFormatters();
  const money = (n: number) => moneyFmt(n, { maximumFractionDigits: 0 });
  const settlementsQuery = useSettlements();
  const deductionsQuery = useDeductions();
  const documentsQuery = useDocuments();
  const [filter, setFilter] = useState<FilterValue>('all');
  // BETA FEEDBACK ROUND 2: "Needs review only" filter toggle.
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  const documentsById = useMemo(
    () => new Map((documentsQuery.data ?? []).map((d) => [d.id, d])),
    [documentsQuery.data]
  );

  const rows = useMemo<TransactionRow[]>(() => {
    const income: TransactionRow[] = (settlementsQuery.data ?? []).map((s) => ({
      id: s.id,
      date: s.week_ending,
      type: 'income',
      label: t('transactions.settlementLabel', { date: date(s.week_ending) }),
      amount: s.net,
      needsReview: isSettlementNeedsReview(s, documentsById),
    }));
    const expenses: TransactionRow[] = (deductionsQuery.data ?? []).map((d) => ({
      id: d.id,
      date: d.ded_date ?? '',
      type: 'expense',
      label: d.description?.trim() || d.category?.trim() || t('transactions.expenseFallback'),
      amount: d.amount,
      needsReview: isDeductionNeedsReview(d),
    }));
    return [...income, ...expenses].sort((a, b) => b.date.localeCompare(a.date));
  }, [settlementsQuery.data, deductionsQuery.data, documentsById, t, date]);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => filter === 'all' || r.type === filter)
        .filter((r) => !needsReviewOnly || r.needsReview),
    [rows, filter, needsReviewOnly]
  );

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ScreenTitle>{t('transactions.title')}</ScreenTitle>

        <View style={{ flexDirection: 'row', marginTop: spacing.sm, marginBottom: spacing.sm }}>
          <Pill label={t('transactions.filterAll')} selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Pill label={t('transactions.filterIncome')} selected={filter === 'income'} onPress={() => setFilter('income')} />
          <Pill label={t('transactions.filterExpenses')} selected={filter === 'expense'} onPress={() => setFilter('expense')} />
        </View>
        <View style={{ flexDirection: 'row', marginBottom: spacing.md }}>
          <Pill
            label={t('needsReview.filterOnly')}
            selected={needsReviewOnly}
            onPress={() => setNeedsReviewOnly((v) => !v)}
          />
        </View>

        {filtered.length === 0 ? (
          <MutedText>{t('transactions.empty')}</MutedText>
        ) : (
          filtered.map((row) => (
            <TappableCard
              key={`${row.type}-${row.id}`}
              onPress={() => router.push(row.type === 'income' ? '/(tabs)/more/settlements' : '/(tabs)/deductions')}
              style={needsReviewRowStyle(row.needsReview)}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    {row.label}
                  </Text>
                  <MutedText>{date(row.date)}</MutedText>
                  {row.needsReview && <NeedsReviewChip />}
                </View>
                <Text style={{ color: row.type === 'income' ? colors.green : colors.red, fontWeight: '700' }}>
                  {row.type === 'income' ? '+' : '-'}
                  {money(Math.abs(row.amount))}
                </Text>
              </View>
            </TappableCard>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
