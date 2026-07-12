import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { Profile, ProfileUpdate } from '@/src/types/db';

// Full profiles row (unlike AuthContext's own narrower Profile type, which
// only carries the fields the app-shell gate logic needs) — used by
// screens that need fields like weekly_goal/business_balance/dot_number
// that AuthContext doesn't fetch. Same pattern as taxConfig.ts's
// useTaxConfig/useUpdateTaxConfig pair.
export function useProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<Profile | null>({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId as string).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    enabled: !!userId,
  });
}

// profiles always has a row by the time a screen can call this — the
// handle_new_user DB trigger creates it at sign-up (see AuthContext.tsx's
// fetchProfile comment) — so a plain update suffices, unlike tax_config's
// useUpdateTaxConfig upsert. Used by the onboarding wizard (each step
// saves progressively) and, later, Settings > Business Profile editing the
// same company_name/home_state/dot_number/mc_number fields.
export function useUpdateProfile() {
  const { session, refreshProfile } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: ProfileUpdate) => {
      const { error } = await supabase.from('profiles').update(values).eq('user_id', userId as string);
      if (error) throw error;
      return values;
    },
    onSuccess: async () => {
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['dashboard-layout', userId] });
      queryClient.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
}
