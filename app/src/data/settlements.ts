import { createEntityHooks } from '@/src/data/entityHooks';
import type { Settlement, SettlementInsert, SettlementUpdate } from '@/src/types/db';

const hooks = createEntityHooks<Settlement, SettlementInsert, SettlementUpdate>('settlements');
export const useSettlements = hooks.useEntityList;
export const useInsertSettlement = hooks.useEntityInsert;
export const useUpdateSettlement = hooks.useEntityUpdate;
export const useDeleteSettlement = hooks.useEntityDelete;
