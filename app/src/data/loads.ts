import { createEntityHooks } from '@/src/data/entityHooks';
import type { Load, LoadInsert, LoadUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Load, LoadInsert, LoadUpdate>('loads');
export const useLoads = hooks.useEntityList;
export const useInsertLoad = hooks.useEntityInsert;
export const useUpdateLoad = hooks.useEntityUpdate;
export const useDeleteLoad = hooks.useEntityDelete;
