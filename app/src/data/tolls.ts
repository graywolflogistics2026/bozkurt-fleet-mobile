import { createEntityHooks } from '@/src/data/entityHooks';
import type { Toll, TollInsert, TollUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Toll, TollInsert, TollUpdate>('tolls');
export const useTolls = hooks.useEntityList;
export const useInsertToll = hooks.useEntityInsert;
export const useUpdateToll = hooks.useEntityUpdate;
export const useDeleteToll = hooks.useEntityDelete;
