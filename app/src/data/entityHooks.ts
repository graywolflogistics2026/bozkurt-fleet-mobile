import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

type Filters = Record<string, string | number | boolean | null | undefined>;

// Shared shape for every user-scoped table's list/insert/update/delete hooks
// (PROMPTS.md Session 4: "typed query/mutation hooks per entity"). All 7
// entities the session calls for (settlements, deductions, maintenance,
// capital_transactions, fuel, loads, documents) share identical CRUD
// semantics over Supabase + react-query, so this factory is instantiated
// once per table instead of hand-duplicating the same hook 7 times.
export function createEntityHooks<Row extends { id: string }, Insert extends object, Update extends object>(
  table: string
) {
  function useEntityList(filters?: Filters) {
    const { session } = useAuth();
    const userId = session?.user.id;

    return useQuery({
      queryKey: [table, 'list', userId, filters ?? null],
      queryFn: async () => {
        let query = supabase.from(table).select('*').eq('user_id', userId as string);
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            if (value === undefined) continue;
            query = query.eq(key, value as string | number | boolean);
          }
        }
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as Row[];
      },
      enabled: !!userId,
    });
  }

  function useEntityInsert() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (values: Insert) => {
        const { data, error } = await supabase.from(table).insert(values).select().single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  function useEntityUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, values }: { id: string; values: Update }) => {
        const { data, error } = await supabase.from(table).update(values).eq('id', id).select().single();
        if (error) throw error;
        return data as Row;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  function useEntityDelete() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        return id;
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [table] }),
    });
  }

  return { useEntityList, useEntityInsert, useEntityUpdate, useEntityDelete };
}
