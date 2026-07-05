import { createEntityHooks } from '@/src/data/entityHooks';
import type { FuelPurchase, FuelPurchaseInsert, FuelPurchaseUpdate } from '@/src/types/db';

const hooks = createEntityHooks<FuelPurchase, FuelPurchaseInsert, FuelPurchaseUpdate>('fuel_purchases');
export const useFuelPurchases = hooks.useEntityList;
export const useInsertFuelPurchase = hooks.useEntityInsert;
export const useUpdateFuelPurchase = hooks.useEntityUpdate;
export const useDeleteFuelPurchase = hooks.useEntityDelete;
