import { createEntityHooks } from '@/src/data/entityHooks';
import type { CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate } from '@/src/types/db';

const hooks = createEntityHooks<CapitalTransaction, CapitalTransactionInsert, CapitalTransactionUpdate>(
  'capital_transactions'
);
export const useCapitalTransactions = hooks.useEntityList;
export const useInsertCapitalTransaction = hooks.useEntityInsert;
export const useUpdateCapitalTransaction = hooks.useEntityUpdate;
export const useDeleteCapitalTransaction = hooks.useEntityDelete;
