import type { DocType } from '@/src/import/types';

// Verbatim port of legacy DTYPES (legacy/index.html:2364), plus a 'w2' entry
// (docType didn't exist in legacy — added 2026-07-03 for the household tax
// design, see supabase/functions/ai-import/index.ts).
export const DOC_TYPE_META: Record<DocType, { icon: string; label: string; route: string }> = {
  settlement: { icon: '💰', label: 'Prime Settlement', route: 'Settlements · Loads · Fuel · Deductions · Assets' },
  fuel: { icon: '⛽', label: 'Fuel Receipt', route: 'Fuel Log' },
  maintenance: { icon: '🔧', label: 'Repair Invoice', route: 'Maintenance' },
  amazon: { icon: '📦', label: 'Store/Amazon Purchase', route: 'Deductions (auto-categorized) · Capital Account' },
  store: { icon: '🛒', label: 'Store Receipt', route: 'Deductions · Capital Account' },
  toll: { icon: '🛣️', label: 'Toll Bill', route: 'Deductions' },
  loan: { icon: '🏦', label: 'Loan Statement', route: 'Deductions' },
  w2: { icon: '📋', label: 'W-2 Tax Form', route: 'Household Income (not yet wired to a screen)' },
  other: { icon: '📄', label: 'Document', route: 'Deductions' },
};
