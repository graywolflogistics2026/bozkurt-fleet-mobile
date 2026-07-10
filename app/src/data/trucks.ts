import { createEntityHooks } from '@/src/data/entityHooks';
import type { Truck, TruckInsert, TruckUpdate } from '@/src/types/db';

// Trucks were previously read-only (ActiveTruckContext's own fetch, no
// mutation hooks) — useInsertTruck is new, for the import preview's
// "+ New Truck" inline-create (payroll auto-routing, owner decision
// 2026-07-09) and, later, the Session 8 truck-management screen. Creating
// a truck seeds its maintenance_intervals via the DB trigger (CLAUDE.md
// invariant #4) same as any other truck creation path.
const hooks = createEntityHooks<Truck, TruckInsert, TruckUpdate>('trucks');
export const useTrucksList = hooks.useEntityList;
export const useInsertTruck = hooks.useEntityInsert;
export const useUpdateTruck = hooks.useEntityUpdate;
export const useDeleteTruck = hooks.useEntityDelete;
