import { createEntityHooks } from '@/src/data/entityHooks';
import type { ComplianceItem, ComplianceItemInsert, ComplianceItemUpdate } from '@/src/types/db';

// docs/PENDING_SQL.md §23 (AI feature package — compliance tracker, owner
// decision 2026-07-10, PRODUCT DECISION). Entirely optional/additive, same
// entityHooks factory pattern as trucks.ts/drivers.ts. ai-import writes to
// this table directly via raw supabase calls (app/src/data/aiImportSave.ts
// — find-or-update by (user_id, type)), not through these hooks; this file
// is for the Session 9b compliance-tracker screen (countdown chips,
// manual add/edit for ifta_filing/cdl/drug_consortium, notifications).
const hooks = createEntityHooks<ComplianceItem, ComplianceItemInsert, ComplianceItemUpdate>('compliance_items');
export const useComplianceItems = hooks.useEntityList;
export const useInsertComplianceItem = hooks.useEntityInsert;
export const useUpdateComplianceItem = hooks.useEntityUpdate;
export const useDeleteComplianceItem = hooks.useEntityDelete;
