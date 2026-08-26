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
    deductions: [{ id: 'd1', user_id: USER_ID, amount: 300, source: 'manual', tax_deductible: true, category: 'Misc' }],
  });
});

describe('fetchFleetStats deductions shortcut', () => {
  test('uses the passed-in deductions array and never queries the deductions table', async () => {
    const fromSpy = jest.spyOn(mockClient, 'from');
    const preloaded = [{ amount: 999, source: 'manual', tax_deductible: true, category: 'Misc' }];

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
    const viaPassed = await fetchFleetStats(USER_ID, 'truck-A', [{ amount: 300, source: 'manual', tax_deductible: true, category: 'Misc' }]);
    expect(viaFetch).toEqual(viaPassed);
    expect(viaFetch.grossRevenue).toBe(2000);
    expect(viaFetch.netRevenue).toBe(1600);
  });

  // TWO DISAGREEING "does this reduce income" RULES (P1 fix, FULL SYSTEM
  // AUDIT): outOfPocketDeductions used to check only source/tax_deductible,
  // silently disagreeing with the canonical reducesTrueProfit() (which ALSO
  // excludes Meals/Advance Repayment/Escrow & Deposits by category) —
  // exactly the reported scenario: a row re-categorized to Meals with
  // tax_deductible still true (never touched) must now be excluded from
  // outOfPocketDeductions (which feeds the tax estimate's net profit),
  // matching how it's already excluded from true profit.
  test('a Meals row with tax_deductible still TRUE is excluded from outOfPocketDeductions (matches reducesTrueProfit)', async () => {
    const preloaded = [
      { amount: 300, source: 'manual', tax_deductible: true, category: 'Misc' },
      // The exact bug: re-categorized to Meals, but tax_deductible was
      // never flipped to false — the OLD code would have still counted
      // this $80 as a real deductible expense.
      { amount: 80, source: 'manual', tax_deductible: true, category: 'Meals (per diem covered)' },
    ];
    const stats = await fetchFleetStats(USER_ID, 'truck-A', preloaded);
    expect(stats.outOfPocketDeductions).toBe(300); // the $80 Meals row is excluded
    expect(stats.totalDeductions).toBe(380); // totalDeductions (Operating P&L parity) is UNCHANGED — still counts everything
  });

  test('Advance Repayment and Escrow & Deposits are also excluded from outOfPocketDeductions, same as reducesTrueProfit', async () => {
    const preloaded = [
      { amount: 100, source: 'manual', tax_deductible: true, category: 'Misc' },
      { amount: 550, source: 'manual', tax_deductible: true, category: 'Advance Repayment' },
      { amount: 100, source: 'manual', tax_deductible: true, category: 'Escrow & Deposits' },
    ];
    const stats = await fetchFleetStats(USER_ID, 'truck-A', preloaded);
    expect(stats.outOfPocketDeductions).toBe(100);
  });

  test('a withheld (settlement) row is still excluded from outOfPocketDeductions regardless of category (net-pay model, CLAUDE.md invariant #1)', async () => {
    const preloaded = [
      { amount: 300, source: 'manual', tax_deductible: true, category: 'Misc' },
      { amount: 500, source: 'settlement', tax_deductible: false, category: 'Insurance—Truck' },
    ];
    const stats = await fetchFleetStats(USER_ID, 'truck-A', preloaded);
    expect(stats.outOfPocketDeductions).toBe(300); // withheld rows never counted here — already baked into netRevenue
  });
});

describe('fetchFleetStats canonical miles (owner decision 2026-08-05, FULL PARITY follow-up item B.1-2)', () => {
  test('uses the passed-in loads array and never queries the loads table', async () => {
    const fromSpy = jest.spyOn(mockClient, 'from');
    const preloadedLoads = [{ settlement_id: 's1', loaded_miles: 900, empty_miles: 200 }];

    const stats = await fetchFleetStats(USER_ID, 'truck-A', undefined, preloadedLoads);

    expect(fromSpy.mock.calls.some((call) => call[0] === 'loads')).toBe(false);
    expect(stats.loadedMiles).toBe(900);
    expect(stats.emptyMiles).toBe(200);
  });

  test('falls back to fetching loads itself when none is passed', async () => {
    // No loads seeded in the fake store — falls back to the settlement's
    // own printed `miles` figure via calcMiles()'s max() reconciliation.
    const stats = await fetchFleetStats(USER_ID, 'truck-A');
    expect(stats.totalMiles).toBe(1000);
    expect(stats.loadedMiles).toBe(0);
    expect(stats.duplicateWeeksIgnored).toBe(0);
  });

  test('CPM divides by the canonical (deduped) totalMiles, not a raw sum', async () => {
    mockClient = createFakeSupabase({
      settlements: [
        { id: 's1', user_id: USER_ID, truck_id: 'truck-A', driver_id: 'driver-A', week_ending: '2026-07-05', gross: 2000, net: 1600, miles: 1000, per_diem_days: 7 },
        // A genuine duplicate — same truck, same week — must be deduped,
        // never double-counted into totalMiles/CPM.
        { id: 's1-dup', user_id: USER_ID, truck_id: 'truck-A', driver_id: 'driver-A', week_ending: '2026-07-05', gross: 0, net: 0, miles: 500, per_diem_days: 0 },
      ],
      deductions: [{ id: 'd1', user_id: USER_ID, amount: 300, source: 'manual', tax_deductible: true, category: 'Misc' }],
    });
    const stats = await fetchFleetStats(USER_ID, 'truck-A');
    expect(stats.totalMiles).toBe(1000); // the higher-total duplicate wins, never 1500
    expect(stats.duplicateWeeksIgnored).toBe(1);
    expect(stats.cpm.costPerMile).toBeCloseTo(300 / 1000, 5);
  });
});

describe('fetchDriverStats deductions shortcut', () => {
  test('uses the passed-in deductions array and never queries the deductions table', async () => {
    const fromSpy = jest.spyOn(mockClient, 'from');
    const preloaded = [{ amount: 777, source: 'manual', tax_deductible: true, category: 'Misc' }];

    const stats = await fetchDriverStats(USER_ID, 'driver-A', preloaded);

    expect(fromSpy.mock.calls.some((call) => call[0] === 'deductions')).toBe(false);
    expect(stats.totalDeductions).toBe(777);
  });

  test('falls back to fetching deductions itself when none is passed', async () => {
    const stats = await fetchDriverStats(USER_ID, 'driver-A');
    expect(stats.totalDeductions).toBe(300);
  });
});
