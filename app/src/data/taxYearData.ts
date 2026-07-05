import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { resolveTaxYearData, type YearFallbackResult } from '@/src/tax/yearFallback';
import type { TaxYearData } from '@/src/types/db';

export type TaxYearDataResult = YearFallbackResult;

// D10 (docs/SCHEMA.sql, CLAUDE.md invariant #6): tax_year_data is NOT
// user-scoped and holds every tax constant server-side. This hook is the
// ONLY place any screen may read tax constants from — no component may
// fetch tax_year_data directly or hardcode a bracket/rate. Persisted to
// AsyncStorage via the shared react-query cache (src/lib/queryClient.ts) so
// the tax estimator still works out of coverage. The actual fallback
// decision lives in src/tax/yearFallback.ts (pure, unit-tested) — this hook
// just fetches the two candidate rows and hands them to it.
export function useTaxYearData() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<TaxYearDataResult>({
    queryKey: ['tax_year_data', userId],
    queryFn: async () => {
      const { data: cfg, error: cfgError } = await supabase
        .from('tax_config')
        .select('tax_year')
        .eq('user_id', userId as string)
        .maybeSingle();
      if (cfgError) throw cfgError;

      const requestedYear = cfg?.tax_year ?? new Date().getFullYear();

      const { data: row, error: rowError } = await supabase
        .from('tax_year_data')
        .select('*')
        .eq('tax_year', requestedYear)
        .eq('published', true)
        .maybeSingle();
      if (rowError) throw rowError;

      let latest: TaxYearData | null = null;
      if (!row) {
        const { data: latestRow, error: latestError } = await supabase
          .from('tax_year_data')
          .select('*')
          .eq('published', true)
          .order('tax_year', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) throw latestError;
        latest = (latestRow as TaxYearData) ?? null;
      }

      return resolveTaxYearData(requestedYear, (row as TaxYearData) ?? null, latest);
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 60,
  });
}
