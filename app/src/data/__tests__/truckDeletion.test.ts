// DELETE A TRUCK (owner decision, docs/PENDING_SQL.md §64) — exercises
// the REAL exported functions (fetchTruckDeletionImpact/
// deleteTruckCompletely) against fakeSupabase.ts's in-memory client,
// which now simulates the app's documented `on delete cascade` FK graph
// (see fakeSupabase.ts's own CASCADE_RULES) — so "deleting a truck
// removes every settlement/load/fuel/maintenance/deduction/toll/linked-
// contribution row tied to it, and nothing else" is proven against real
// code paths, not asserted by hand.
//
// HONEST BOUNDARY: this proves the app's OWN delete flow (which rows it
// asks the database to remove, in what order, and how it handles
// failure) is correct — it cannot prove the LIVE Postgres FK constraints
// are actually configured as `on delete cascade` (no Postgres runtime in
// this environment, the same limitation this codebase has flagged at
// every prior SQL-touching pass); docs/PENDING_SQL.md §64 must actually
// be run for the real cascade to exist.

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';
import { fetchTruckDeletionImpact, deleteTruckCompletely } from '@/src/data/truckDeletion';

const USER_ID = 'user-1';
const TRUCK_A = 'truck-a';
const TRUCK_B = 'truck-b'; // a DIFFERENT truck — must never be touched

function seedTwoTruckFleet() {
  return {
    trucks: [
      { id: TRUCK_A, user_id: USER_ID, unit_number: '100' },
      { id: TRUCK_B, user_id: USER_ID, unit_number: '200' },
    ],
    settlements: [
      { id: 's1', user_id: USER_ID, truck_id: TRUCK_A, week_ending: '2026-06-06', gross: 1000, document_id: 'doc-sett-a' },
      { id: 's2', user_id: USER_ID, truck_id: TRUCK_A, week_ending: '2026-06-13', gross: 1200, document_id: null },
      { id: 's3', user_id: USER_ID, truck_id: TRUCK_B, week_ending: '2026-06-06', gross: 900, document_id: 'doc-sett-b' },
    ],
    loads: [
      { id: 'l1', user_id: USER_ID, settlement_id: 's1', revenue: 500 },
      { id: 'l2', user_id: USER_ID, settlement_id: 's1', revenue: 500 },
      { id: 'l3', user_id: USER_ID, settlement_id: 's3', revenue: 900 }, // truck B's own — must survive
    ],
    fuel_purchases: [
      { id: 'f1', user_id: USER_ID, truck_id: TRUCK_A, amount: 300 },
      { id: 'f2', user_id: USER_ID, truck_id: TRUCK_B, amount: 250 }, // truck B's own
    ],
    maintenance_records: [
      { id: 'm1', user_id: USER_ID, truck_id: TRUCK_A, cost: 150, document_id: 'doc-maint-a' },
      { id: 'm2', user_id: USER_ID, truck_id: TRUCK_B, cost: 80, document_id: null }, // truck B's own
    ],
    tolls: [
      { id: 't1', user_id: USER_ID, truck_id: TRUCK_A, amount: 25 },
      { id: 't2', user_id: USER_ID, truck_id: TRUCK_B, amount: 10 }, // truck B's own
    ],
    deductions: [
      { id: 'd1', user_id: USER_ID, truck_id: TRUCK_A, amount: 200, document_id: 'doc-ded-a', source: 'manual' },
      { id: 'd2', user_id: USER_ID, truck_id: TRUCK_B, amount: 60, document_id: null, source: 'manual' }, // truck B's own
      { id: 'd3', user_id: USER_ID, truck_id: null, amount: 500, document_id: null, source: 'manual' }, // fleet-level — must survive
    ],
    capital_transactions: [
      // Linked to d1 (truck A's own deduction) — must cascade away with it.
      { id: 'ct1', user_id: USER_ID, tx_type: 'contribution', amount: 200, linked_deduction_id: 'd1' },
      // A plain manual contribution, no truck link at all — must survive.
      { id: 'ct2', user_id: USER_ID, tx_type: 'contribution', amount: 1000, linked_deduction_id: null },
    ],
    maintenance_intervals: [
      { id: 'mi1', user_id: USER_ID, truck_id: TRUCK_A, category: 'oil' },
      { id: 'mi2', user_id: USER_ID, truck_id: TRUCK_B, category: 'oil' },
    ],
    truck_health_config: [{ truck_id: TRUCK_A, user_id: USER_ID, overrides: {} }],
    documents: [
      { id: 'doc-sett-a', user_id: USER_ID, storage_path: `${USER_ID}/settlement-a.pdf` },
      { id: 'doc-maint-a', user_id: USER_ID, storage_path: `${USER_ID}/maint-a.jpg` },
      { id: 'doc-ded-a', user_id: USER_ID, storage_path: `${USER_ID}/ded-a.jpg` },
      { id: 'doc-sett-b', user_id: USER_ID, storage_path: `${USER_ID}/settlement-b.pdf` },
    ],
  };
}

describe('fetchTruckDeletionImpact', () => {
  it('returns real counts and a dollar total scoped to exactly ONE truck', async () => {
    mockClient = createFakeSupabase(seedTwoTruckFleet());
    const impact = await fetchTruckDeletionImpact(TRUCK_A);

    expect(impact.settlementsCount).toBe(2);
    expect(impact.loadsCount).toBe(2); // l1, l2 — via s1/s2's own settlement_id join
    expect(impact.fuelPurchasesCount).toBe(1);
    expect(impact.maintenanceRecordsCount).toBe(1);
    expect(impact.tollsCount).toBe(1);
    expect(impact.deductionsCount).toBe(1); // d1 only — d2 is truck B's, d3 is fleet-level
    expect(impact.documentsCount).toBe(3); // doc-sett-a, doc-maint-a, doc-ded-a

    // 1000 + 1200 (settlements) + 300 (fuel) + 150 (maintenance) + 25 (tolls) + 200 (deductions)
    expect(impact.totalDollarValue).toBe(2875);
  });

  it('returns all zeros for a truck with no records at all — never throws on an empty result set', async () => {
    mockClient = createFakeSupabase({ trucks: [{ id: 'truck-empty', user_id: USER_ID, unit_number: '999' }] });
    const impact = await fetchTruckDeletionImpact('truck-empty');
    expect(impact).toEqual({
      settlementsCount: 0,
      loadsCount: 0,
      fuelPurchasesCount: 0,
      maintenanceRecordsCount: 0,
      tollsCount: 0,
      deductionsCount: 0,
      documentsCount: 0,
      totalDollarValue: 0,
    });
  });
});

describe('deleteTruckCompletely — cascade completeness', () => {
  it('removes every settlement/load/fuel/maintenance/toll/deduction row tied to the truck, plus its own linked capital contribution and per-truck settings', async () => {
    mockClient = createFakeSupabase(seedTwoTruckFleet());
    await deleteTruckCompletely(TRUCK_A);

    expect(mockClient.__store.trucks.find((t) => t.id === TRUCK_A)).toBeUndefined();
    expect(mockClient.__store.settlements.filter((s) => s.truck_id === TRUCK_A)).toHaveLength(0);
    expect(mockClient.__store.loads.some((l) => l.id === 'l1' || l.id === 'l2')).toBe(false);
    expect(mockClient.__store.fuel_purchases.find((f) => f.id === 'f1')).toBeUndefined();
    expect(mockClient.__store.maintenance_records.find((m) => m.id === 'm1')).toBeUndefined();
    expect(mockClient.__store.tolls.find((tl) => tl.id === 't1')).toBeUndefined();
    expect(mockClient.__store.deductions.find((d) => d.id === 'd1')).toBeUndefined();
    expect(mockClient.__store.maintenance_intervals.find((mi) => mi.id === 'mi1')).toBeUndefined();
    expect(mockClient.__store.truck_health_config.find((c) => c.truck_id === TRUCK_A)).toBeUndefined();
    // Linked capital contribution cascades away with its own deduction.
    expect(mockClient.__store.capital_transactions.find((c) => c.id === 'ct1')).toBeUndefined();
  });

  it('NEVER touches a different truck\'s own data', async () => {
    mockClient = createFakeSupabase(seedTwoTruckFleet());
    await deleteTruckCompletely(TRUCK_A);

    expect(mockClient.__store.trucks.find((t) => t.id === TRUCK_B)).toBeDefined();
    expect(mockClient.__store.settlements.find((s) => s.id === 's3')).toBeDefined();
    expect(mockClient.__store.loads.find((l) => l.id === 'l3')).toBeDefined();
    expect(mockClient.__store.fuel_purchases.find((f) => f.id === 'f2')).toBeDefined();
    expect(mockClient.__store.maintenance_records.find((m) => m.id === 'm2')).toBeDefined();
    expect(mockClient.__store.tolls.find((tl) => tl.id === 't2')).toBeDefined();
    expect(mockClient.__store.deductions.find((d) => d.id === 'd2')).toBeDefined();
    expect(mockClient.__store.maintenance_intervals.find((mi) => mi.id === 'mi2')).toBeDefined();
  });

  it('leaves a FLEET-LEVEL deduction (no truck_id) and a manual capital contribution (no linked_deduction_id) completely untouched', async () => {
    mockClient = createFakeSupabase(seedTwoTruckFleet());
    await deleteTruckCompletely(TRUCK_A);

    expect(mockClient.__store.deductions.find((d) => d.id === 'd3')).toBeDefined();
    expect(mockClient.__store.capital_transactions.find((c) => c.id === 'ct2')).toBeDefined();
  });

  it('cleans up documents that become orphaned (Storage object + row), but leaves a document still referenced by a DIFFERENT truck alone', async () => {
    mockClient = createFakeSupabase(seedTwoTruckFleet());
    const result = await deleteTruckCompletely(TRUCK_A);

    expect(mockClient.__store.documents.find((d) => d.id === 'doc-sett-a')).toBeUndefined();
    expect(mockClient.__store.documents.find((d) => d.id === 'doc-maint-a')).toBeUndefined();
    expect(mockClient.__store.documents.find((d) => d.id === 'doc-ded-a')).toBeUndefined();
    expect(mockClient.__removedStoragePaths.sort()).toEqual(
      [`${USER_ID}/settlement-a.pdf`, `${USER_ID}/maint-a.jpg`, `${USER_ID}/ded-a.jpg`].sort()
    );
    // Truck B's own document survives untouched.
    expect(mockClient.__store.documents.find((d) => d.id === 'doc-sett-b')).toBeDefined();
    expect(result.documentCleanupFailures).toEqual([]);
  });
});

describe('deleteTruckCompletely — atomicity', () => {
  it('when the truck delete itself fails, throws and performs ZERO document cleanup — nothing partially removed', async () => {
    const seed = seedTwoTruckFleet();
    mockClient = createFakeSupabase(seed, { failures: [{ table: 'trucks', mode: 'delete', error: { message: 'db unavailable' } }] });

    await expect(deleteTruckCompletely(TRUCK_A)).rejects.toBeTruthy();

    // Nothing was touched — the truck row, its settlements, and its
    // documents are all still exactly as seeded.
    expect(mockClient.__store.trucks.find((t) => t.id === TRUCK_A)).toBeDefined();
    expect(mockClient.__store.settlements.filter((s) => s.truck_id === TRUCK_A)).toHaveLength(2);
    expect(mockClient.__store.documents.find((d) => d.id === 'doc-sett-a')).toBeDefined();
    expect(mockClient.__removedStoragePaths).toEqual([]);
  });

  it('a failed document cleanup is reported, not thrown — the truck deletion itself already succeeded and must not be undone by a later Storage failure', async () => {
    const seed = seedTwoTruckFleet();
    // documents.select fails (the read inside cleanupOrphanedDocument's
    // own orphan-check) — this must not throw all the way up, and must
    // not affect the already-committed truck deletion.
    mockClient = createFakeSupabase(seed, { failures: [{ table: 'documents', mode: 'select', error: { message: 'storage down' } }] });

    const result = await deleteTruckCompletely(TRUCK_A);

    expect(mockClient.__store.trucks.find((t) => t.id === TRUCK_A)).toBeUndefined();
    expect(result.documentCleanupFailures.sort()).toEqual(['doc-ded-a', 'doc-maint-a', 'doc-sett-a'].sort());
  });
});
