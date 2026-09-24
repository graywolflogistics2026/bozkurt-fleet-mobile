import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocTypeMeta } from '@/src/import/docTypes';
import { useFormatters } from '@/src/i18n/format';
import type { TitleContext } from '@/src/data/documentTitle';
import type { DocType } from '@/src/import/types';

// DOCUMENT TITLES (owner decision 2026-09-23) — every word a generated
// title uses, in the user's own language.
export function useDocumentTitleContext(): TitleContext {
  const { t } = useTranslation();
  const docTypeMeta = useDocTypeMeta();
  const { date } = useFormatters();
  return useMemo(
    () => ({
      kindLabel: (docType: string) => docTypeMeta(docType as DocType).label,
      weekEnding: (shortDate: string) => t('documentTitles.weekEnding', { date: shortDate }),
      receiptFor: (category: string) => t('documentTitles.receiptFor', { category }),
      shortDate: (isoDate: string) => date(isoDate, { month: 'numeric', day: 'numeric' }),
    }),
    [t, docTypeMeta, date]
  );
}
