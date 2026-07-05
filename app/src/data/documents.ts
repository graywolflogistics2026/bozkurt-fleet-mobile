import { createEntityHooks } from '@/src/data/entityHooks';
import type { DocumentRow, DocumentInsert, DocumentUpdate } from '@/src/types/db';

const hooks = createEntityHooks<DocumentRow, DocumentInsert, DocumentUpdate>('documents');
export const useDocuments = hooks.useEntityList;
export const useInsertDocument = hooks.useEntityInsert;
export const useUpdateDocument = hooks.useEntityUpdate;
export const useDeleteDocument = hooks.useEntityDelete;
