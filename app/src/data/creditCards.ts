import { createEntityHooks } from '@/src/data/entityHooks';
import type { CreditCardRow, CreditCardInsert, CreditCardUpdate } from '@/src/types/db';

const hooks = createEntityHooks<CreditCardRow, CreditCardInsert, CreditCardUpdate>('credit_cards');
export const useCreditCards = hooks.useEntityList;
export const useInsertCreditCard = hooks.useEntityInsert;
export const useUpdateCreditCard = hooks.useEntityUpdate;
export const useDeleteCreditCard = hooks.useEntityDelete;
