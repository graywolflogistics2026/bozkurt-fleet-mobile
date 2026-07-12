import { createEntityHooks } from '@/src/data/entityHooks';
import type { HouseholdMember, HouseholdMemberInsert, HouseholdMemberUpdate } from '@/src/types/db';

const hooks = createEntityHooks<HouseholdMember, HouseholdMemberInsert, HouseholdMemberUpdate>('household_members');
export const useHouseholdMembers = hooks.useEntityList;
export const useInsertHouseholdMember = hooks.useEntityInsert;
export const useUpdateHouseholdMember = hooks.useEntityUpdate;
export const useDeleteHouseholdMember = hooks.useEntityDelete;
