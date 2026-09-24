import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/src/i18n/format';
import type { DescriptionFormat } from '@/src/lib/descriptionText';

// The locale-aware format every screen passes to describeDeduction() /
// resolveDescription(): month/day in the user's language, and the
// "Expense" label when there is no category at all.
export function useDescriptionFormat(): DescriptionFormat {
  const { t } = useTranslation();
  const { date } = useFormatters();
  return useMemo(
    () => ({
      shortDate: (iso: string) => date(iso, { month: 'numeric', day: 'numeric' }),
      fallbackLabel: t('transactions.expenseFallback'),
    }),
    [t, date]
  );
}
