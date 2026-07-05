import { createEntityHooks } from '@/src/data/entityHooks';
import type { MaintenanceRecord, MaintenanceRecordInsert, MaintenanceRecordUpdate } from '@/src/types/db';

const hooks = createEntityHooks<MaintenanceRecord, MaintenanceRecordInsert, MaintenanceRecordUpdate>(
  'maintenance_records'
);
export const useMaintenanceRecords = hooks.useEntityList;
export const useInsertMaintenanceRecord = hooks.useEntityInsert;
export const useUpdateMaintenanceRecord = hooks.useEntityUpdate;
export const useDeleteMaintenanceRecord = hooks.useEntityDelete;
