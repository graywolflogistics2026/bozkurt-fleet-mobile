import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';

// CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision,
// docs/PENDING_SQL.md §52) — a small, global, admin-maintained reference
// table (same "everyone reads, only service_role writes" pattern as
// tax_year_data/ai_usage_config) — cached like any other react-query
// entity list. Used to forward the current set of seeded carriers' own
// code maps into the ai-import prompt (app/(tabs)/import/index.tsx),
// never to classify anything client-side directly (that's
// app/src/import/carrierCodes.ts's job, fed by aiImportSave.ts's own
// separate fetch at save time).
export type CarrierCodeMapRow = {
  carrier: string;
  code: string;
  subCode: string | null;
  label: string;
  description: string | null;
};

export function useCarrierCodeMaps() {
  return useQuery<CarrierCodeMapRow[]>({
    queryKey: ['carrier_code_maps'],
    queryFn: async () => {
      const { data, error } = await supabase.from('carrier_code_maps').select('carrier, code, sub_code, label, description');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        carrier: r.carrier as string,
        code: r.code as string,
        subCode: (r.sub_code as string | null) ?? null,
        label: r.label as string,
        description: (r.description as string | null) ?? null,
      }));
    },
    staleTime: 1000 * 60 * 60, // reference data, changes rarely — same staleTime spirit as tax_year_data
  });
}
