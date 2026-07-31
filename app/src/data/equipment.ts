import { createEntityHooks } from '@/src/data/entityHooks';
import type { Equipment, EquipmentInsert, EquipmentUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Equipment, EquipmentInsert, EquipmentUpdate>('equipment');
export const useEquipment = hooks.useEntityList;
export const useInsertEquipment = hooks.useEntityInsert;
export const useUpdateEquipment = hooks.useEntityUpdate;
export const useDeleteEquipment = hooks.useEntityDelete;
