import { createEntityHooks } from '@/src/data/entityHooks';
import type { DriverPayment, DriverPaymentInsert, DriverPaymentUpdate } from '@/src/types/db';

// docs/PENDING_SQL.md §16 (driver compensation types, owner decision
// 2026-07-10) — what the owner actually paid a driver. Used both by the
// import preview's team_split/trainee settlement-split entry and, later,
// the driver-management screen (PROMPTS.md Session 8).
const hooks = createEntityHooks<DriverPayment, DriverPaymentInsert, DriverPaymentUpdate>('driver_payments');
export const useDriverPayments = hooks.useEntityList;
export const useInsertDriverPayment = hooks.useEntityInsert;
export const useUpdateDriverPayment = hooks.useEntityUpdate;
export const useDeleteDriverPayment = hooks.useEntityDelete;
