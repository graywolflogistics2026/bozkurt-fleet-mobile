import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useDeductions } from '@/src/data/deductions';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';
import { groupDeductions } from '@/src/stats/deductionGroups';
import { isPersonalPayment } from '@/src/import/category';
import { Screen, ScreenTitle, Card, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';
import type { Deduction } from '@/src/types/db';

function money(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function DedRow({ x }: { x: Deduction }) {
  const personal = isPersonalPayment(x.payment_method);
  return (
    <View style={styles.row}>
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
      <Text style={styles.amount}>{money(x.amount)}</Text>
    </View>
  );
}

function DedSection({
  title,
  subtitle,
  rows,
  total,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  rows: Deduction[];
  total: number;
  emptyLabel: string;
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
                <DedRow x={x} />
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
  const dedQuery = useDeductions();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

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
            />
            <DedSection
              title="🏦 Withheld from Settlement"
              subtitle="Already reflected in net pay, NOT re-deducted (ELD, insurance, truck payment)"
              rows={withheld}
              total={withheldTotal}
              emptyLabel="None yet — import a settlement PDF."
            />
          </>
        )}
      </ScrollView>
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
