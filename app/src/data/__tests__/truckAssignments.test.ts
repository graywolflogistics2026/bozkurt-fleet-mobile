// TRUCK ASSIGNMENTS — CONFIRMED-DATA-LOSS AUDIT (owner decision, device
// report: "using this screen deletes rows instead of assigning them to a
// truck"). Full read of the reachable code (truck-assignments.tsx,
// truckAssignmentRepair.ts, entityHooks.ts) found NO `.delete()` call
// anywhere in this flow for any of the 4 tables it touches — every path
// was already a plain `update({truck_id}).eq('id', id)`. This suite
// proves that against the REAL exported handler (assignRowsToTruck(),
// truckAssignments.ts) rather than a reimplementation: seeding N rows
// with `truck_id: null`, calling the handler, and asserting the row COUNT
// is unchanged (nothing deleted) and every row now carries the correct
// truck_id — for 0 selected, all selected, an already-assigned row, and
// the bulk-select path specifically.
import { assignRowsToTruck } from '@/src/data/truckAssignments';
import type { UnassignedRow } from '@/src/import/truckAssignmentRepair';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase } from './fakeSupabase';

function row(kind: UnassignedRow['kind'], id: string): UnassignedRow {
  return { kind, id, date: '2026-08-01', label: 'x', amount: 100 };
}

describe('assignRowsToTruck — proves no row is ever removed, only truck_id changes', () => {
  test('0 rows selected is a no-op — nothing changes, no crash', async () => {
    mockClient = createFakeSupabase({
      settlements: [{ id: 's1', truck_id: null, week_ending: '2026-08-01' }],
    });
    const result = await assignRowsToTruck([], 'truck-A');
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(mockClient.__store.settlements).toHaveLength(1);
    expect(mockClient.__store.settlements[0].truck_id).toBeNull();
  });

  test('all rows selected across 2 tables: N rows in, N rows out, every one correctly assigned', async () => {
    mockClient = createFakeSupabase({
      settlements: [
        { id: 's1', truck_id: null, week_ending: '2026-08-01' },
        { id: 's2', truck_id: null, week_ending: '2026-08-08' },
      ],
      fuel_purchases: [
        { id: 'f1', truck_id: null },
        { id: 'f2', truck_id: null },
        { id: 'f3', truck_id: null },
      ],
    });
    const rows: UnassignedRow[] = [
      row('settlement', 's1'),
      row('settlement', 's2'),
      row('fuel', 'f1'),
      row('fuel', 'f2'),
      row('fuel', 'f3'),
    ];
    const result = await assignRowsToTruck(rows, 'truck-A');

    expect(result.succeeded).toHaveLength(5);
    expect(result.failed).toHaveLength(0);

    // Row COUNT is preserved — nothing deleted.
    expect(mockClient.__store.settlements).toHaveLength(2);
    expect(mockClient.__store.fuel_purchases).toHaveLength(3);

    // Every row now carries the correct truck_id, no other column touched.
    for (const s of mockClient.__store.settlements) expect(s.truck_id).toBe('truck-A');
    for (const f of mockClient.__store.fuel_purchases) expect(f.truck_id).toBe('truck-A');
    expect(mockClient.__store.settlements.find((s) => s.id === 's1')?.week_ending).toBe('2026-08-01');
    expect(mockClient.__store.settlements.find((s) => s.id === 's2')?.week_ending).toBe('2026-08-08');
  });

  test('a row already assigned to a DIFFERENT truck gets reassigned, not duplicated or dropped', async () => {
    mockClient = createFakeSupabase({
      maintenance_records: [{ id: 'm1', truck_id: 'truck-OLD', service_date: '2026-08-01' }],
    });
    const result = await assignRowsToTruck([row('maintenance', 'm1')], 'truck-NEW');
    expect(result.succeeded).toHaveLength(1);
    expect(mockClient.__store.maintenance_records).toHaveLength(1); // still exactly one row
    expect(mockClient.__store.maintenance_records[0].truck_id).toBe('truck-NEW');
  });

  test('bulk-select path: a mixed batch across all 4 tables leaves the same total row count, all correctly assigned', async () => {
    mockClient = createFakeSupabase({
      settlements: [{ id: 's1', truck_id: null }],
      fuel_purchases: [{ id: 'f1', truck_id: null }],
      maintenance_records: [{ id: 'm1', truck_id: null }],
      tolls: [{ id: 't1', truck_id: null }],
    });
    const rows: UnassignedRow[] = [row('settlement', 's1'), row('fuel', 'f1'), row('maintenance', 'm1'), row('toll', 't1')];
    const result = await assignRowsToTruck(rows, 'truck-Z');

    expect(result.succeeded).toHaveLength(4);
    expect(result.failed).toHaveLength(0);
    expect(mockClient.__store.settlements).toHaveLength(1);
    expect(mockClient.__store.fuel_purchases).toHaveLength(1);
    expect(mockClient.__store.maintenance_records).toHaveLength(1);
    expect(mockClient.__store.tolls).toHaveLength(1);
    expect(mockClient.__store.settlements[0].truck_id).toBe('truck-Z');
    expect(mockClient.__store.fuel_purchases[0].truck_id).toBe('truck-Z');
    expect(mockClient.__store.maintenance_records[0].truck_id).toBe('truck-Z');
    expect(mockClient.__store.tolls[0].truck_id).toBe('truck-Z');
  });

  // The one real gap found in the OLD inline handler (never a delete —
  // an availability/resilience gap): a single row's update failure used
  // to abort the WHOLE bulk batch via one shared try/catch, leaving every
  // row after the failing one unassigned with no report of what happened.
  // assignRowsToTruck() never aborts on one failure — every row is
  // attempted, and failures are reported without touching the rows that
  // succeeded either side of it.
  test('one row failing mid-batch does not stop the rest, and no row is ever removed on failure', async () => {
    mockClient = createFakeSupabase(
      {
        settlements: [
          { id: 's1', truck_id: null },
          { id: 's2', truck_id: null },
          { id: 's3', truck_id: null },
        ],
      },
      { failures: [{ table: 'settlements', mode: 'update', error: { message: 'unique_violation' }, count: 1 }] }
    );
    // The fake injects its failure on the FIRST matching update call.
    const rows: UnassignedRow[] = [row('settlement', 's1'), row('settlement', 's2'), row('settlement', 's3')];
    const result = await assignRowsToTruck(rows, 'truck-A');

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].row.id).toBe('s1');
    expect(result.succeeded).toHaveLength(2);
    expect(result.succeeded.map((r) => r.id).sort()).toEqual(['s2', 's3']);

    // Row count unchanged — the failed row still EXISTS, just unassigned.
    expect(mockClient.__store.settlements).toHaveLength(3);
    expect(mockClient.__store.settlements.find((s) => s.id === 's1')?.truck_id).toBeNull();
    expect(mockClient.__store.settlements.find((s) => s.id === 's2')?.truck_id).toBe('truck-A');
    expect(mockClient.__store.settlements.find((s) => s.id === 's3')?.truck_id).toBe('truck-A');
  });
});
