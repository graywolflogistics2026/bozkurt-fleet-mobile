import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';

// COST CONTROL & GRACEFUL DEGRADATION (owner decision 2026-08-24, FIVE
// ADDITIONS pass, PART 4 item 3) — `service_status` (docs/PENDING_SQL.md)
// is a tiny, everyone-reads/service-role-writes table so a real outage can
// be posted from the Supabase Dashboard SQL Editor (docs/ADMIN_RUNBOOK.md's
// own recipe) without an app release.
export type ServiceStatusRow = { service: 'ai_import' | 'ai_advisor'; status: 'ok' | 'degraded' | 'down'; message: string | null };

export function useServiceStatus() {
  return useQuery<ServiceStatusRow[]>({
    queryKey: ['service_status'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_status').select('service, status, message');
      if (error) throw error;
      return (data ?? []) as ServiceStatusRow[];
    },
    staleTime: 1000 * 60 * 5,
  });
}

// The single worst non-ok row, if any — 'down' takes priority over
// 'degraded' when both happen to be flagged at once.
export function worstServiceStatus(rows: ServiceStatusRow[]): ServiceStatusRow | null {
  const bad = rows.filter((r) => r.status !== 'ok');
  if (bad.length === 0) return null;
  return bad.find((r) => r.status === 'down') ?? bad[0];
}

// AUTOMATIC CLIENT-SIDE FALLBACK — "after N consecutive failures, clears
// on success" (spec item 4.3). The counter is stored in AsyncStorage
// (survives app restart) but mirrored into the react-query cache under a
// fixed key so every screen that calls this hook shares the SAME live
// count (a failure recorded on the Import screen is immediately visible
// to Home's own banner, no extra plumbing needed).
const FAILURE_COUNT_KEY = ['ai-import-consecutive-failures'];
const STORAGE_KEY = 'ai_import_consecutive_failures';
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export function useAiFailureTracker() {
  const queryClient = useQueryClient();
  const { data: count = 0 } = useQuery<number>({
    queryKey: FAILURE_COUNT_KEY,
    queryFn: async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      return raw ? Number(raw) : 0;
    },
    staleTime: Infinity,
  });

  const recordFailure = useCallback(async () => {
    const next = (queryClient.getQueryData<number>(FAILURE_COUNT_KEY) ?? 0) + 1;
    queryClient.setQueryData(FAILURE_COUNT_KEY, next);
    await AsyncStorage.setItem(STORAGE_KEY, String(next));
  }, [queryClient]);

  const recordSuccess = useCallback(async () => {
    queryClient.setQueryData(FAILURE_COUNT_KEY, 0);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, [queryClient]);

  return { consecutiveFailures: count, recordFailure, recordSuccess, showFallbackBanner: count >= CONSECUTIVE_FAILURE_THRESHOLD };
}
