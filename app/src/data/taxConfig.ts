import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { TaxConfig, TaxConfigUpdate } from '@/src/types/db';

// tax_config has no auto-create trigger (unlike profiles' handle_new_user —
// see supabase/migrations/0001_init.sql) — docs/PENDING_SQL.md §1b only
// backfilled a row for users that existed at that migration's run time. A
// user created since then may have no row at all, so this falls back to
// the table's own declared column defaults (docs/SCHEMA.sql) rather than
// inventing new behavior.
export function useTaxConfig() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<TaxConfig>({
    queryKey: ['tax_config', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tax_config')
        .select('*')
        .eq('user_id', userId as string)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as TaxConfig;
      return {
        user_id: userId as string,
        tax_year: new Date().getFullYear(),
        filing_status: 'mfj',
        state: 'TX',
        include_state_tax: true,
        entity_type: 'sole_prop',
        scorp_salary: null,
        scorp_payroll_tax_handled: false,
        ownership_pct: null,
        sep_contribution: 0,
        health_insurance_premiums: 0,
      };
    },
    enabled: !!userId,
  });
}

// No auto-create trigger (see note above) means a user's first save is
// often an INSERT, not an UPDATE — upsert on the primary key (user_id)
// handles both without the caller needing to know which case it is.
export function useUpdateTaxConfig() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: TaxConfigUpdate) => {
      const { data, error } = await supabase
        .from('tax_config')
        .upsert({ user_id: userId as string, ...values }, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return data as TaxConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_config', userId] });
      queryClient.invalidateQueries({ queryKey: ['tax_year_data', userId] });
    },
  });
}
