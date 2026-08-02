import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { groupByMonth, currentMonthKey, UNKNOWN_MONTH_KEY } from '@/src/stats/monthGroups';
import { useMonthCollapse } from '@/src/components/monthGroups/useMonthCollapse';
import { useFormatters } from '@/src/i18n/format';
import { Card, MutedText } from '@/src/components/ui';
import { colors, spacing, typography } from '@/src/theme';

// BETA FEEDBACK ROUND (owner decision 2026-07-31, device tester report):
// the ONE shared list-with-collapsible-month-sections component every
// long chronological screen (Settlements, Reimbursements, Deductions,
// Fuel, Tolls, Loads, Other Income, Documents, ...) renders through —
// "implement once as a shared component/hook so every list uses it." This
// owns the actual shared logic: month bucketing (src/stats/
// monthGroups.ts), collapse state (useMonthCollapse — session-scoped, per
// screenKey), and the header row (month label + item count + $ total, tap
// to expand/collapse — current month expanded by default, every older
// month collapsed). Row-list rendering is deliberately left to the caller
// via `renderRows(rows)` rather than a single per-row renderer + an
// imposed container — screens in this app render a month's worth of rows
// two different ways today (Settlements/Loads/Documents: one TappableCard
// per row; Reimbursements/Deductions/Fuel/Tolls/Other Income: bordered
// rows inside one shared Card) and forcing a single container style here
// would mean restructuring visuals the ticket didn't ask to change. Every
// screen still gets the identical grouping/collapse/header behavior;
// `renderRows` just keeps each screen's own existing row markup.
export function MonthGroupedList<T>({
  screenKey,
  rows,
  getDate,
  getAmount,
  renderRows,
  loading,
  loadingLabel,
  emptyLabel,
}: {
  // Distinguishes one screen's collapse memory from another's — pass the
  // screen name (e.g. 'settlements', 'deductions').
  screenKey: string;
  rows: T[];
  getDate: (row: T) => string | null | undefined;
  getAmount: (row: T) => number;
  renderRows: (rows: T[]) => ReactNode;
  loading?: boolean;
  loadingLabel: string;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  const groups = groupByMonth(rows, getDate, getAmount);
  const thisMonth = currentMonthKey();
  // CRITICAL BUG FIX (device feedback 2026-07-31): a row with no parseable
  // date lands in the 'unknown' bucket (monthGroups.ts never drops rows),
  // but this bucket used to collapse by default like any other past month
  // — since it also always sorts LAST, a settlement-derived row with a
  // null date (see mapExtraction.ts's date-fallback fix) rendered as a
  // single collapsed header at the bottom of the list, which reads as
  // "completely empty" to a user skimming the screen. The current month
  // and the unknown bucket both start expanded; only real past months
  // default to collapsed.
  const { isCollapsed, toggle } = useMonthCollapse(
    screenKey,
    (monthKey) => monthKey !== thisMonth && monthKey !== UNKNOWN_MONTH_KEY
  );

  if (loading) {
    return (
      <Card>
        <MutedText>{loadingLabel}</MutedText>
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <MutedText>{emptyLabel}</MutedText>
      </Card>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const collapsed = isCollapsed(group.monthKey);
        const label =
          group.monthKey === 'unknown'
            ? t('monthGroups.unknownMonth')
            : date(`${group.monthKey}-01T12:00:00`, { month: 'long', year: 'numeric' });
        return (
          <View key={group.monthKey} style={{ marginBottom: spacing.sm }}>
            <Pressable
              onPress={() => toggle(group.monthKey)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: typography.size.sm, marginEnd: spacing.xs }}>
                  {collapsed ? '▸' : '▾'}
                </Text>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: typography.size.md }} numberOfLines={1}>
                  {label}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <MutedText>{t('monthGroups.itemCount', { count: group.count })}</MutedText>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{money(group.total)}</Text>
              </View>
            </Pressable>
            {!collapsed && renderRows(group.rows)}
          </View>
        );
      })}
    </>
  );
}
