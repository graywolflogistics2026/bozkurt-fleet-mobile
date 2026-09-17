import { createEntityHooks } from '@/src/data/entityHooks';
import type { PrimeDriverExpense, PrimeDriverExpenseInsert, PrimeDriverExpenseUpdate } from '@/src/types/db';

// "FOR PRIME INC DRIVERS" OUT-OF-POCKET EXPENSE TRACKER (owner decision
// 2026-09-17) — plain createEntityHooks() wiring, same convention as
// every other simple entity table (tolls.ts, reimbursements.ts, ...).
// `src/data/entityHooks.ts`'s `ORDER_COLUMN` map has no entry for this
// table, so it falls back to `DEFAULT_ORDER_COLUMN` ('created_at') —
// harmless here since the screen's own useMemo groups rows by exp_date
// itself (src/stats/primeDriverExpenses.ts's buildPrimeDriverExpenseMonth())
// and never depends on query order.
const hooks = createEntityHooks<PrimeDriverExpense, PrimeDriverExpenseInsert, PrimeDriverExpenseUpdate>('prime_driver_expenses');
export const usePrimeDriverExpenses = hooks.useEntityList;
export const useInsertPrimeDriverExpense = hooks.useEntityInsert;
export const useUpdatePrimeDriverExpense = hooks.useEntityUpdate;
export const useDeletePrimeDriverExpense = hooks.useEntityDelete;
