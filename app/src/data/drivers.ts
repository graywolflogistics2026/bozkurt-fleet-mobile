import { createEntityHooks } from '@/src/data/entityHooks';
import type { Driver, DriverInsert, DriverUpdate } from '@/src/types/db';

// docs/PENDING_SQL.md §13 (multi-truck fleet + drivers + payroll
// auto-routing, PRODUCT DECISION 2026-07-09). useInsertDriver is used both
// by the import-time "create driver inline" flow (app/(tabs)/import/index.tsx)
// and, later, the Session 8 driver-management screen.
const hooks = createEntityHooks<Driver, DriverInsert, DriverUpdate>('drivers');
export const useDrivers = hooks.useEntityList;
export const useInsertDriver = hooks.useEntityInsert;
export const useUpdateDriver = hooks.useEntityUpdate;
export const useDeleteDriver = hooks.useEntityDelete;
