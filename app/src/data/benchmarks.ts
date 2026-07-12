import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { Benchmark } from '@/src/types/db';

// docs/PENDING_SQL.md §25 (Profit Analysis v1) — benchmarks is NOT
// user-scoped, same "admin-seeded, published-gates-visibility" pattern as
// tax_year_data.ts. Until §25 has been run (or a metric's row is
// unpublished), this resolves to an empty array and Profit Analysis simply
// shows no comparison for that metric — never a silent default-zero range
// (CLAUDE.md invariant #6's "banner, not silent default" spirit).
export function useBenchmarks() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<Benchmark[]>({
    queryKey: ['benchmarks', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benchmarks')
        .select('*')
        .eq('published', true)
        .order('year', { ascending: false });
      if (error) throw error;
      // Latest published year wins per metric (mirrors tax_year_data's
      // "latest published row" fallback) — a future admin-added newer year
      // for one metric shouldn't require re-publishing every metric at once.
      const latestByMetric = new Map<string, Benchmark>();
      for (const row of (data ?? []) as Benchmark[]) {
        if (!latestByMetric.has(row.metric)) latestByMetric.set(row.metric, row);
      }
      return [...latestByMetric.values()];
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 60,
  });
}
