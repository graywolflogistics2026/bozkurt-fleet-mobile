import { createEntityHooks } from '@/src/data/entityHooks';
import type { BankStatement, BankStatementInsert, BankTransaction, BankTransactionInsert } from '@/src/types/db';

// View-only statements (PROMPTS.md Session 9a): the app never lets a user
// hand-edit a bank_transactions row — these are ai-import-derived (or, until
// that wiring exists, empty) so a stray edit can't silently diverge from the
// source document. Insert hooks are exposed only for the (future) ai-import
// save path, not for any manual-add UI (docs/PENDING_SQL.md §22 note).
const statementHooks = createEntityHooks<BankStatement, BankStatementInsert, never>('bank_statements');
export const useBankStatements = statementHooks.useEntityList;
export const useInsertBankStatement = statementHooks.useEntityInsert;
export const useDeleteBankStatement = statementHooks.useEntityDelete;

const transactionHooks = createEntityHooks<BankTransaction, BankTransactionInsert, never>('bank_transactions');
export const useBankTransactions = transactionHooks.useEntityList;
export const useInsertBankTransaction = transactionHooks.useEntityInsert;
