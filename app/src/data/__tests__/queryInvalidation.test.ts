import { QueryClient } from '@tanstack/react-query';
import { invalidateFinancialData } from '@/src/data/queryInvalidation';

// 2026-07-30 tablet-testing fix: Reset All Data correctly nulled
// weekly_goal/cf_* on profiles server-side, but the Cash Flow forecast
// screen and CEO Mode kept showing stale cached values because 'profile'
// (useProfile(), src/data/profile.ts) was never in this invalidation
// list — only AuthContext's own narrower profile fetch got refreshed.
describe('invalidateFinancialData', () => {
  it('invalidates the "profile" query key (the full profiles row useProfile() reads)', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    const invalidatedKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain('profile');
    expect(invalidatedKeys).toContain('dashboard-layout');
  });

  it('always forces an eager refetch (refetchType "all"), not just marking queries stale', async () => {
    const queryClient = new QueryClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    await invalidateFinancialData(queryClient);

    expect(spy.mock.calls.every((call) => (call[0] as { refetchType?: string }).refetchType === 'all')).toBe(true);
  });
});
