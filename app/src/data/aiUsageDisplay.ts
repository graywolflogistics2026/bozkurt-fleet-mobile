import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveTruck } from '@/src/context/ActiveTruckContext';
import { supabase } from '@/src/lib/supabase';
import { calcMonthlyAllowance, calcUsageStatus, sumAvailableCredits, monthStartUtc, type CreditPack } from '@/src/usage/aiUsage';

// USAGE LIMITS BY FLEET SIZE + CREDIT PACKS (owner decision 2026-08-24,
// FIVE ADDITIONS pass, PART 5 item 4) — "Show both plainly in Settings."
// Reads the SAME two tables the server-side gate in ai-import/index.ts
// reads (ai_usage_log, ai_credit_purchases) via the user's own RLS-scoped
// client — this is a DISPLAY-ONLY read, the server remains the sole
// enforcement point (CLAUDE.md's own "counters live server-side" rule).
// `isOwner` (owner decision, OWNER/DEV ACCOUNT FLAG pass) — an owner
// account never has a real allowance to report, so both queries are
// skipped entirely (`enabled: false`) rather than fetched and then hidden
// — settings.tsx doesn't render this section at all for that account, but
// this hook staying query-free for it too avoids two pointless DB round
// trips on every Settings visit.
export function useAiUsageDisplay(isOwner = false) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { trucks } = useActiveTruck();
  const activeTruckCount = trucks.filter((t) => t.is_active).length;

  const usageQuery = useQuery<number>({
    queryKey: ['ai_usage_log', 'count', userId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId as string)
        .eq('call_type', 'ai_import')
        .eq('success', true)
        .gte('created_at', monthStartUtc().toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId && !isOwner,
  });

  const creditsQuery = useQuery<CreditPack[]>({
    queryKey: ['ai_credit_purchases', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_credit_purchases')
        .select('id, credits_remaining, expires_at')
        .eq('user_id', userId as string)
        .gt('credits_remaining', 0);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id as string, creditsRemaining: r.credits_remaining as number, expiresAt: r.expires_at as string | null }));
    },
    enabled: !!userId && !isOwner,
  });

  const allowance = calcMonthlyAllowance(activeTruckCount);
  const usageStatus = calcUsageStatus(usageQuery.data ?? 0, allowance);
  const availableCredits = useMemo(() => sumAvailableCredits(creditsQuery.data ?? []), [creditsQuery.data]);

  const now = new Date();
  const resetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    isLoading: usageQuery.isLoading || creditsQuery.isLoading,
    activeTruckCount,
    usageStatus,
    availableCredits,
    resetDate,
  };
}
