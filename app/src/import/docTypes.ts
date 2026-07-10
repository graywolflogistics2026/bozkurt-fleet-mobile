import { useTranslation } from 'react-i18next';
import type { DocType } from '@/src/import/types';

// Verbatim port of legacy DTYPES (legacy/index.html:2364), plus a 'w2' entry
// (docType didn't exist in legacy — added 2026-07-03 for the household tax
// design, see supabase/functions/ai-import/index.ts). Icons are locale-
// independent; label/route text lives in src/i18n/locales/*.json under
// "docTypes" (multi-language support, owner decision 2026-07-09) — always go
// through useDocTypeMeta()'s human label, never a raw docType code.
export const DOC_TYPE_ICON: Record<DocType, string> = {
  settlement: '💰',
  fuel: '⛽',
  maintenance: '🔧',
  amazon: '📦',
  store: '🛒',
  toll: '🛣️',
  loan: '🏦',
  w2: '📋',
  // Universal AI capture (owner decision 2026-07-10, PRODUCT DECISION).
  driver_payment: '👤',
  insurance: '🛡️',
  lease_rent: '🏠',
  factoring_statement: '🧾',
  government_or_misc_income: '💵',
  utility_subscription: '🔌',
  other: '📄',
};

export function useDocTypeMeta() {
  const { t } = useTranslation();
  return (docType: DocType): { icon: string; label: string; route: string } => ({
    icon: DOC_TYPE_ICON[docType],
    label: t(`docTypes.${docType}.label`),
    route: t(`docTypes.${docType}.route`),
  });
}
