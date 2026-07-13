import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { mergeDashboardLayout, isDefaultLayout, type DashboardCardConfig, type SectionId } from '@/src/stats/dashboardLayout';

export type SectionsCollapsed = Partial<Record<SectionId, boolean>>;

export type DashboardLayoutResult = { layout: DashboardCardConfig[]; isCustomized: boolean; sectionsCollapsed: SectionsCollapsed };

// profiles.dashboard_layout (docs/PENDING_SQL.md §19) + profiles.
// dashboard_sections_collapsed (docs/PENDING_SQL.md §32, Dashboard
// sections addition) — one query, both columns, since they're always
// read together by the same screen. Dedicated hook rather than threading
// through AuthContext's already-narrow Profile type (same pattern as
// capitalAccount.ts/settings.tsx reading other profiles columns
// directly). Returns the merged (always-complete) layout, whether the
// user has actually customized anything, and the section-collapse map —
// the Dashboard screen uses isCustomized to decide between its zoned
// default rendering (untouched, zero regression risk for the common
// case) and the flat customized rendering, both now section-aware.
export function useDashboardLayout() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<DashboardLayoutResult>({
    queryKey: ['dashboard-layout', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('dashboard_layout, dashboard_sections_collapsed')
        .eq('user_id', userId as string)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.dashboard_layout ?? null;
      return {
        layout: mergeDashboardLayout(raw),
        isCustomized: !isDefaultLayout(raw),
        sectionsCollapsed: (data?.dashboard_sections_collapsed as SectionsCollapsed | null) ?? {},
      };
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

// Collapse/expand state, remembered per user (Dashboard sections
// addition) — a separate mutation from the layout one above since
// toggling a section's collapse state is unrelated to reordering/hiding/
// relabeling/re-sectioning cards.
export function useUpdateSectionsCollapsed() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sectionsCollapsed: SectionsCollapsed) => {
      const { error } = await supabase
        .from('profiles')
        .update({ dashboard_sections_collapsed: sectionsCollapsed })
        .eq('user_id', userId as string);
      if (error) throw error;
      return sectionsCollapsed;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard-layout', userId] }),
  });
}
