import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/data/profile';
import { supabase } from '@/src/lib/supabase';
import { callReferralSync } from '@/src/data/referralSyncCall';

// REFERRAL PROGRAM (owner decision 2026-08-24, PART 1) — client-side data
// hooks. `referrals`/`account_credits` are SELECT-only from the client by
// design (docs/PENDING_SQL.md §50's own RLS — no insert/update/delete
// policy exists for regular users at all) — every write happens via
// handle_new_user() (signup trigger) or the referral-sync Edge Function
// (service_role), never a direct client mutation. There is deliberately
// NO useInsertReferral()/useUpdateReferral() here, unlike this app's usual
// entity-hooks pattern — that CRUD surface simply doesn't exist for this
// table, on purpose.
export type ReferralRow = {
  id: string;
  status: 'pending' | 'qualified' | 'rewarded';
  referred_label: string | null;
  created_at: string;
  qualified_at: string | null;
};

export function useMyReferralCode() {
  const profileQuery = useProfile();
  return profileQuery.data?.referral_code ?? null;
}

// The referrer's OWN outgoing invite list — masked labels only, see
// docs/PENDING_SQL.md §50 / app/src/referral/maskLabel.ts for why this
// app never even HAS the referred person's real identity to leak here.
export function useMyReferrals() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<ReferralRow[]>({
    queryKey: ['referrals', 'as-referrer', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referrals')
        .select('id, status, referred_label, created_at, qualified_at')
        .eq('referrer_id', userId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReferralRow[];
    },
    enabled: !!userId,
  });
}

export type AccountCreditRow = {
  id: string;
  days: number;
  reason: string;
  granted_at: string;
  expires_at: string | null;
};

export function useMyAccountCredits() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<AccountCreditRow[]>({
    queryKey: ['account_credits', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_credits')
        .select('id, days, reason, granted_at, expires_at')
        .eq('user_id', userId as string)
        .order('granted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountCreditRow[];
    },
    enabled: !!userId,
  });
}

// Opportunistic sync trigger (see referral-sync/index.ts's own header
// comment on the lazy, non-cron trigger model) — fires once per mounted
// lifetime of whichever screen calls this (a module-level ref, same
// "guard against re-firing on every re-render" pattern as
// src/data/alerts.ts's own recordedKeyRef), then invalidates the queries
// above so a freshly-granted credit/newly-qualified status shows up
// without the user needing to manually refresh.
let syncedThisSession = false;

export function useReferralSyncOnce() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!session?.user.id || firedRef.current || syncedThisSession) return;
    firedRef.current = true;
    syncedThisSession = true;
    callReferralSync().then((result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['referrals'] });
        queryClient.invalidateQueries({ queryKey: ['account_credits'] });
        queryClient.invalidateQueries({ queryKey: ['profile'] });
      }
    });
  }, [session?.user.id, queryClient]);
}
