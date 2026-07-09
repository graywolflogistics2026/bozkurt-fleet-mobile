import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { calcCapitalAccount } from '@/src/stats/capitalAccount';

export type CapitalAccountSummaryResult = {
  effectiveContribution: number;
  totalDraws: number;
  taxFreeRemaining: number;
  businessBalance: number;
  contributionCount: number;
  latestContributionNote: string | null;
  latestContributionDate: string | null;
};

// Verbatim port of legacy rCapital() (legacy/index.html:1380-1402).
export function useCapitalAccountSummary() {
  const { session } = useAuth();
  const userId = session?.user.id;

  return useQuery<CapitalAccountSummaryResult>({
    queryKey: ['capital-account-summary', userId],
    queryFn: async () => {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('initial_capital, business_balance')
        .eq('user_id', userId as string)
        .maybeSingle();
      if (profileError) throw profileError;

      const { data: txs, error: txError } = await supabase
        .from('capital_transactions')
        .select('tx_type, amount, tx_date, note')
        .eq('user_id', userId as string);
      if (txError) throw txError;

      const rows = txs ?? [];
      const contributions = rows.filter((t) => t.tx_type === 'contribution');
      const draws = rows.filter((t) => t.tx_type === 'draw');
      const totalContributions = contributions.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
      const totalDraws = draws.reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
      const latest = [...contributions].sort(
        (a, b) => new Date(b.tx_date).getTime() - new Date(a.tx_date).getTime()
      )[0];

      const summary = calcCapitalAccount(Number(profile?.initial_capital ?? 60000), totalContributions, totalDraws);

      return {
        ...summary,
        businessBalance: Number(profile?.business_balance ?? 60000),
        contributionCount: contributions.length,
        latestContributionNote: latest?.note ?? null,
        latestContributionDate: latest?.tx_date ?? null,
      };
    },
    enabled: !!userId,
  });
}

// Legacy updateBizBalance() (legacy/index.html:1034-1041) — a manual
// correction to the checking-account figure shown on the Dashboard/Capital
// Account screens (business_balance is otherwise only ever incremented by
// settlement net-pay on import, aiImportSave.ts).
export function useUpdateBusinessBalance() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (balance: number) => {
      const { error } = await supabase
        .from('profiles')
        .update({ business_balance: balance })
        .eq('user_id', userId as string);
      if (error) throw error;
      return balance;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capital-account-summary'] }),
  });
}
