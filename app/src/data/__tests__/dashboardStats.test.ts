// PRE-LAUNCH HARDENING (owner decision 2026-08-02, independent code
// review item — second tier): fetchFleetStats()/fetchDriverStats() used
// to each issue their OWN full-table `deductions` query, even though
// deductions are always user-wide (never truck/driver-scoped) — an
// N-truck fleet's Dashboard "Fleet Overview" ranking issued N identical
// deductions fetches. Both functions now accept an optional pre-fetched
// `deductions` array and skip the internal query entirely when provided.
let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));
// dashboardStats.ts also imports useAuth (for its own useFleetStats hook,
// not exercised here) — AuthContext.tsx is a .tsx module Jest can't parse
// outside a component test context, so stub it out.
jest.mock('@/src/context/AuthContext', () => ({ useAuth: () => ({ session: null }) }));

import { createFakeSupabase } from './fakeSupabase';
import { fetchFleetStats, fetchDriverStats } from '@/src/data/dashboardStats';

const USER_ID = 'user-1';

beforeEach(() => {
  mockClient = createFakeSupabase({
    settlements: [
      { id: 's1', user_id: USER_ID, truck_id: 'truck-A', driver_id: 'driver-A', week_ending: '2026-07-05', gross: 2000, net: 1600, miles: 1000, per_diem_days: 7 },
    ],
    deductions: [{ id: 'd1', user_id: USER_ID, amount: 300, source: 'manual', tax_deductible: true }],
  });
});

describe('fetchFleetStats deductions shortcut', () => {
  test('uses the passed-in deductions array and never queries the deductions table', async () => {
    const fromSpy = jest.spyOn(mockClient, 'from');
    const preloaded = [{ amount: 999, source: 'manual', tax_deductible: true }];

    const stats = await fetchFleetStats(USER_ID, 'truck-A', preloaded);

    expect(fromSpy.mock.calls.some((call) => call[0] === 'deductions')).toBe(false);
    expect(stats.totalDeductions).toBe(999); // from the preloaded array, not the seeded store row (300)
  });

  test('falls back to fetching deductions itself when none is passed', async () => {
    const stats = await fetchFleetStats(USER_ID, 'truck-A');
    expect(stats.totalDeductions).toBe(300); // from the seeded store
  });

  test('matches a hand-computed aggregate regardless of which path supplied deductions', async () => {
    const viaFetch = await fetchFleetStats(USER_ID, 'truck-A');
    const viaPassed = await fetchFleetStats(USER_ID, 'truck-A', [{ amount: 300, source: 'manual', tax_deductible: true }]);
    expect(viaFetch).toEqual(viaPassed);
    expect(viaFetch.grossRevenue).toBe(2000);
    expect(viaFetch.netRevenue).toBe(1600);
  });
});

describe('fetchDriverStats deductions shortcut', () => {
  test('uses the passed-in deductions array and never queries the deductions table', async () => {
    const fromSpy = jest.spyOn(mockClient, 'from');
    const preloaded = [{ amount: 777, source: 'manual', tax_deductible: true }];

    const stats = await fetchDriverStats(USER_ID, 'driver-A', preloaded);

    expect(fromSpy.mock.calls.some((call) => call[0] === 'deductions')).toBe(false);
    expect(stats.totalDeductions).toBe(777);
  });

  test('falls back to fetching deductions itself when none is passed', async () => {
    const stats = await fetchDriverStats(USER_ID, 'driver-A');
    expect(stats.totalDeductions).toBe(300);
  });
});
