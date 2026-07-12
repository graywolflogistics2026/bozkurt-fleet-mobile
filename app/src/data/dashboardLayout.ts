import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { mergeDashboardLayout, isDefaultLayout, type DashboardCardConfig } from '@/src/stats/dashboardLayout';

export type DashboardLayoutResult = { layout: DashboardCardConfig[]; isCustomized: boolean };

// profiles.dashboard_layout (docs/PENDING_SQL.md §19) — a dedicated
// query/mutation pair rather than threading this through AuthContext's
// already-narrow Profile type (same pattern as capitalAccount.ts/
// settings.tsx reading other profiles columns directly). Returns both the
// merged (always-complete) layout AND whether the user has actually
// customized anything — the Dashboard screen uses isCustomized to decide
// between its original fixed-section rendering (untouched, zero regression
// risk for the common case) and the flat customized rendering.
export function useDashboardLayout() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<DashboardLayoutResult>({
    queryKey: ['dashboard-layout', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('dashboard_layout')
        .eq('user_id', userId as string)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.dashboard_layout ?? null;
      return { layout: mergeDashboardLayout(raw), isCustomized: !isDefaultLayout(raw) };
    },
    enabled: !!userId,
  });
}

export function useUpdateDashboardLayout() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    // null resets to default (docs/PENDING_SQL.md §19 "Reset to default").
    mutationFn: async (layout: DashboardCardConfig[] | null) => {
      const { error } = await supabase
        .from('profiles')
        .update({ dashboard_layout: layout })
        .eq('user_id', userId as string);
      if (error) throw error;
      return layout;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard-layout', userId] }),
  });
}
