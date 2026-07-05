import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

// Offline-tolerant reads (PROMPTS.md Session 4): a trucker is often out of
// coverage, so query results are persisted to AsyncStorage and served stale
// while a refetch happens in the background once connectivity returns.
// Writes are NOT queued offline — they still require connectivity.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24 * 7, // keep persisted cache for a week
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'bozkurt-fleet-os-query-cache',
});
