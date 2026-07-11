import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { TruckHealthConfig } from '@/src/types/db';

// Manual baseline overrides (docs/SCHEMA.sql DECISION D2) — read-only this
// pass. No editing UI ships yet (PROMPTS.md Session 8 scope decision: a
// fresh truck with no maintenance record shows a neutral "no records yet"
// state rather than a false overdue, which is the empty-state behavior the
// owner asked for without needing a baseline-entry screen). Reading it
// here still lets app/src/truck/health.ts honor an override if one is ever
// set directly (e.g. by a future admin/import path) without any calc
// change later.
export function useTruckHealthConfig(truckId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<TruckHealthConfig | null>({
    queryKey: ['truck_health_config', userId, truckId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('truck_health_config')
        .select('*')
        .eq('user_id', userId as string)
        .eq('truck_id', truckId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as TruckHealthConfig | null) ?? null;
    },
    enabled: !!userId && !!truckId,
  });
}
