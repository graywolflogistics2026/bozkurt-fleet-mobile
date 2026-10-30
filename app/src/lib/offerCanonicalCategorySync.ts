import { Alert } from 'react-native';
import i18n from '@/src/i18n';
import { canonicalSyncTarget } from '@/src/primeDriverExpenses/categoryMapping';

// After the owner picks an accountant category on the "For Prime Inc
// Drivers" screen (batch A item 1, 2026-10-30): when that row's Deductions
// category is Misc/Other/empty, ask ONCE "Also set Deductions category to
// X?" and offer Undo afterwards. A specific Deductions category is never
// offered, so it is never overwritten.
export function offerCanonicalCategorySync(
  row: { id: string; category: string | null },
  accountantCategory: string,
  setCategory: (id: string, category: string | null) => Promise<void>
): void {
  const target = canonicalSyncTarget({ category: row.category, accountant_category: accountantCategory });
  if (!target) return;
  const previous = row.category;
  const t = i18n.t.bind(i18n);
  const fail = (err: unknown) =>
    Alert.alert(t('deductions.saveFailedTitle'), err instanceof Error ? err.message : t('deductions.genericRetry'));
  Alert.alert(t('categorySync.offerTitle'), t('categorySync.offerBody', { category: target }), [
    { text: t('categorySync.no'), style: 'cancel' },
    {
      text: t('categorySync.yes'),
      onPress: () => {
        setCategory(row.id, target)
          .then(() =>
            Alert.alert(t('categorySync.doneTitle'), t('categorySync.doneBody', { category: target }), [
              { text: t('categorySync.undo'), onPress: () => setCategory(row.id, previous).catch(fail) },
              { text: t('categorySync.ok') },
            ])
          )
          .catch(fail);
      },
    },
  ]);
}
