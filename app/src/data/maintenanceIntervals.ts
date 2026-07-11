import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { MaintenanceInterval, MaintenanceIntervalUpdate } from '@/src/types/db';

// Per-truck, user-editable settings (owner decision 2026-07-03, CLAUDE.md
// invariant #4) — rows only ever come from the seed_maintenance_intervals
// DB trigger (fired on truck creation) or truck deletion cascade, never a
// manual insert/delete from the app, hence no useEntityInsert/Delete here
// (unlike the createEntityHooks factory other data/ files use).
export function useMaintenanceIntervals(truckId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<MaintenanceInterval[]>({
    queryKey: ['maintenance_intervals', 'list', userId, truckId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maintenance_intervals')
        .select('*')
        .eq('user_id', userId as string)
        .eq('truck_id', truckId as string)
        .order('category', { ascending: true });
      if (error) throw error;
      return (data ?? []) as MaintenanceInterval[];
    },
    enabled: !!userId && !!truckId,
  });
}

export function useUpdateMaintenanceInterval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: MaintenanceIntervalUpdate }) => {
      const { data, error } = await supabase
        .from('maintenance_intervals')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as MaintenanceInterval;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maintenance_intervals'] }),
  });
}
