// Batch A item 2 (2026-10-30): trucks and drivers — edit, archive, delete.
// Runs the real fleetEdit.ts / truckDeletion.ts functions against the
// in-memory fake (fakeSupabase.ts models the documented FK cascade and set
// null rules). Honest boundary: proves the client flow, not the live
// Postgres constraints (the schema guard at the bottom checks the SQL text).
import * as fs from 'fs';
import * as path from 'path';

let mockClient: ReturnType<typeof import('./fakeSupabase').createFakeSupabase>;

jest.mock('@/src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

import { createFakeSupabase, type FakeSupabaseFailure } from './fakeSupabase';
import {
  NothingChangedError,
  OPTIONAL_TRUCK_COLUMNS,
  REMOVE_DRIVER_VALUES,
  RESTORE_DRIVER_VALUES,
  applyDriverAssignment,
  canArchiveTruck,
  deleteDriverWithoutHistory,
  fetchDriverHistory,
  insertTruckTolerant,
  isLastTruck,
  missingColumnIn,
  planDriverAssignment,
  selectableTrucks,
  truckLabel,
  updateRowTolerant,
} from '@/src/data/fleetEdit';
import { deleteTruckCompletely } from '@/src/data/truckDeletion';

const USER = 'user-1';

function seed() {
  return {
    trucks: [
      { id: 'tA', user_id: USER, unit_number: '100', is_active: true },
      { id: 'tB', user_id: USER, unit_number: '200', is_active: true },
    ],
    drivers: [
      { id: 'd1', user_id: USER, name: 'Sam', active: true, default_truck_id: 'tA' },
      { id: 'd2', user_id: USER, name: 'Lee', active: true, default_truck_id: null },
    ],
    settlements: [
      { id: 's1', user_id: USER, truck_id: 'tA', driver_id: 'd1', week_ending: '2026-08-21', gross: 4783.75, document_id: null },
      { id: 's2', user_id: USER, truck_id: 'tB', driver_id: null, week_ending: '2026-08-21', gross: 3000, document_id: null },
    ],
    loads: [{ id: 'l1', user_id: USER, settlement_id: 's1', driver_id: 'd1' }],
    fuel_purchases: [{ id: 'f1', user_id: USER, truck_id: 'tA', settlement_id: 's1', amount: 500, driver_id: null }],
    maintenance_records: [{ id: 'm1', user_id: USER, truck_id: 'tA', cost: 300, document_id: null }],
    deductions: [
      { id: 'x1', user_id: USER, truck_id: 'tA', amount: 85, document_id: null, driver_id: null },
      { id: 'x2', user_id: USER, truck_id: null, amount: 40, document_id: null, driver_id: null },
    ],
    tolls: [{ id: 'to1', user_id: USER, truck_id: 'tA', amount: 12 }],
    capital_transactions: [{ id: 'c1', user_id: USER, linked_deduction_id: 'x1', amount: 85 }],
    maintenance_intervals: [{ id: 'mi1', truck_id: 'tA' }, { id: 'mi2', truck_id: 'tB' }],
    truck_health_config: [{ id: 'hc1', truck_id: 'tA' }],
    compliance_items: [{ id: 'ci1', user_id: USER, truck_id: 'tA', driver_id: null }],
    driver_payments: [{ id: 'p1', user_id: USER, driver_id: 'd1', gross_pay: 900 }],
  };
}

const unknownColumn = (col: string): FakeSupabaseFailure => ({
  table: 'trucks',
  mode: 'update',
  count: 1,
  error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'trucks' in the schema cache` },
});

describe('add and edit a truck', () => {
  it('adds a truck with nickname and plate', async () => {
    mockClient = createFakeSupabase(seed());
    const r = await insertTruckTolerant({ user_id: USER, unit_number: '300', nickname: 'Blue', plate: 'MO 12345' });
    expect(r.skippedColumns).toEqual([]);
    expect(mockClient.__store.trucks.find((t) => t.id === r.id)).toMatchObject({ unit_number: '300', nickname: 'Blue', plate: 'MO 12345' });
  });

  it('edits unit, nickname, plate, VIN, year, make and model', async () => {
    mockClient = createFakeSupabase(seed());
    const values = { unit_number: '101', nickname: 'Big Red', plate: 'TX 9', vin: '1XKYD49X', year: 2023, make: 'International', model: 'LT' };
    await expect(updateRowTolerant('trucks', 'tA', values, OPTIONAL_TRUCK_COLUMNS)).resolves.toEqual({ skippedColumns: [] });
    expect(mockClient.__store.trucks.find((t) => t.id === 'tA')).toMatchObject(values);
  });

  it('before PENDING_SQL §79 runs: saves everything else and reports the skipped columns', async () => {
    mockClient = createFakeSupabase(seed(), { failures: [unknownColumn('nickname')] });
    const r = await updateRowTolerant('trucks', 'tA', { unit_number: '101', nickname: 'Big Red', plate: 'TX 9' }, OPTIONAL_TRUCK_COLUMNS);
    expect(r.skippedColumns).toEqual(['nickname', 'plate']);
    const row = mockClient.__store.trucks.find((t) => t.id === 'tA')!;
    expect(row.unit_number).toBe('101');
    expect(row.nickname).toBeUndefined();
  });

  it('a wrong id or another account is an error, never a silent no-op', async () => {
    mockClient = createFakeSupabase(seed());
    await expect(updateRowTolerant('trucks', 'not-mine', { unit_number: 'x' })).rejects.toBeInstanceOf(NothingChangedError);
  });

  it('a real write error is shown, not swallowed', async () => {
    mockClient = createFakeSupabase(seed(), {
      failures: [{ table: 'trucks', mode: 'update', error: { message: 'permission denied for table trucks', code: '42501' } }],
    });
    await expect(updateRowTolerant('trucks', 'tA', { is_active: false })).rejects.toMatchObject({ code: '42501' });
  });

  it('only a missing optional column triggers the retry', () => {
    expect(missingColumnIn({ code: 'PGRST204', message: "Could not find the 'plate' column of 'trucks'" }, OPTIONAL_TRUCK_COLUMNS)).toBe(true);
    expect(missingColumnIn({ code: 'PGRST204', message: "Could not find the 'vin' column of 'trucks'" }, OPTIONAL_TRUCK_COLUMNS)).toBe(false);
    expect(missingColumnIn({ code: '42501', message: 'permission denied' }, OPTIONAL_TRUCK_COLUMNS)).toBe(false);
    expect(missingColumnIn(null, OPTIONAL_TRUCK_COLUMNS)).toBe(false);
  });

  it('labels show the nickname next to the unit', () => {
    expect(truckLabel({ id: 'tA', unit_number: '100', nickname: 'Blue' })).toBe('100 · Blue');
    expect(truckLabel({ id: 'tA', unit_number: '100', nickname: '  ' })).toBe('100');
    expect(truckLabel({ id: 'tA', unit_number: null })).toBe('tA');
  });
});

describe('assigned driver (drivers.default_truck_id)', () => {
  it('plans exactly the changes needed and applies them', async () => {
    mockClient = createFakeSupabase(seed());
    const drivers = mockClient.__store.drivers as Array<{ id: string; default_truck_id: string | null }>;
    const plan = planDriverAssignment(drivers, 'tA', ['d2']);
    expect(plan).toEqual([
      { id: 'd1', default_truck_id: null },
      { id: 'd2', default_truck_id: 'tA' },
    ]);
    await applyDriverAssignment(plan);
    expect(mockClient.__store.drivers.map((d) => d.default_truck_id)).toEqual([null, 'tA']);
    expect(planDriverAssignment(mockClient.__store.drivers as typeof drivers, 'tA', ['d2'])).toEqual([]);
  });

  it('reassigning a driver to another truck moves them', async () => {
    mockClient = createFakeSupabase(seed());
    await applyDriverAssignment(planDriverAssignment(mockClient.__store.drivers as never, 'tB', ['d1']));
    expect(mockClient.__store.drivers.find((d) => d.id === 'd1')!.default_truck_id).toBe('tB');
  });
});

describe('archive and restore a truck', () => {
  it('archive keeps every record; restore brings it back', async () => {
    mockClient = createFakeSupabase(seed());
    const before = JSON.stringify({ ...mockClient.__store, trucks: [] });
    await updateRowTolerant('trucks', 'tA', { is_active: false });
    expect(mockClient.__store.trucks.find((t) => t.id === 'tA')!.is_active).toBe(false);
    expect(JSON.stringify({ ...mockClient.__store, trucks: [] })).toBe(before);
    await updateRowTolerant('trucks', 'tA', { is_active: true });
    expect(mockClient.__store.trucks.find((t) => t.id === 'tA')!.is_active).toBe(true);
  });

  it('pickers hide archived trucks but keep the one a row already uses', () => {
    const trucks = [
      { id: 'tA', is_active: false },
      { id: 'tB', is_active: true },
    ];
    expect(selectableTrucks(trucks).map((t) => t.id)).toEqual(['tB']);
    expect(selectableTrucks(trucks, 'tA').map((t) => t.id)).toEqual(['tA', 'tB']);
    expect(selectableTrucks(trucks, null).map((t) => t.id)).toEqual(['tB']);
  });

  it('last-truck rule: the last active truck cannot be archived', () => {
    expect(canArchiveTruck([{ id: 'tA', is_active: true }, { id: 'tB', is_active: true }], 'tA')).toBe(true);
    expect(canArchiveTruck([{ id: 'tA', is_active: true }, { id: 'tB', is_active: false }], 'tA')).toBe(false);
    expect(canArchiveTruck([{ id: 'tA', is_active: true }], 'tA')).toBe(false);
    expect(canArchiveTruck([{ id: 'tA', is_active: false }, { id: 'tB', is_active: true }], 'tA')).toBe(false);
    expect(isLastTruck([{ id: 'tA' }], 'tA')).toBe(true);
    expect(isLastTruck([{ id: 'tA' }, { id: 'tB' }], 'tA')).toBe(false);
  });
});

describe('delete a truck with data — no orphans in any table', () => {
  it('removes the truck and everything tied to it; the other truck and fleet rows stay', async () => {
    mockClient = createFakeSupabase(seed());
    await deleteTruckCompletely('tA');
    const s = mockClient.__store;
    expect(s.trucks.map((t) => t.id)).toEqual(['tB']);
    expect(s.settlements.map((r) => r.id)).toEqual(['s2']);
    expect(s.loads).toEqual([]);
    expect(s.fuel_purchases).toEqual([]);
    expect(s.maintenance_records).toEqual([]);
    expect(s.tolls).toEqual([]);
    expect(s.deductions.map((r) => r.id)).toEqual(['x2']);
    expect(s.capital_transactions).toEqual([]);
    expect(s.maintenance_intervals.map((r) => r.id)).toEqual(['mi2']);
    expect(s.truck_health_config).toEqual([]);
    // set null: the driver and the compliance item survive, unassigned.
    expect(s.drivers.find((d) => d.id === 'd1')).toMatchObject({ name: 'Sam', default_truck_id: null });
    expect(s.compliance_items[0]).toMatchObject({ id: 'ci1', truck_id: null });
    expect(s.driver_payments.map((r) => r.id)).toEqual(['p1']);

    // No row anywhere still points at the deleted truck or a deleted parent.
    const ids = new Set(Object.values(s).flat().map((r) => r.id));
    for (const [table, rows] of Object.entries(s)) {
      for (const row of rows) {
        expect([table, row.truck_id]).not.toEqual([table, 'tA']);
        expect([table, row.default_truck_id]).not.toEqual([table, 'tA']);
        for (const fk of ['settlement_id', 'linked_deduction_id']) {
          if (row[fk] != null) expect(ids.has(row[fk])).toBe(true);
        }
      }
    }
  });

  it('a delete that matched nothing is an error', async () => {
    mockClient = createFakeSupabase(seed());
    await expect(deleteTruckCompletely('not-mine')).rejects.toThrow(/No truck was deleted/);
  });
});

describe('drivers: edit, remove (former driver), restore, delete', () => {
  it('edit writes the fields', async () => {
    mockClient = createFakeSupabase(seed());
    await updateRowTolerant('drivers', 'd2', { name: 'Lee Park', phone: '555', default_truck_id: 'tB' });
    expect(mockClient.__store.drivers.find((d) => d.id === 'd2')).toMatchObject({ name: 'Lee Park', phone: '555', default_truck_id: 'tB' });
  });

  it('remove keeps all history and clears the assigned truck; restore re-activates', async () => {
    mockClient = createFakeSupabase(seed());
    await updateRowTolerant('drivers', 'd1', { ...REMOVE_DRIVER_VALUES });
    const s = mockClient.__store;
    expect(s.drivers.find((d) => d.id === 'd1')).toMatchObject({ active: false, default_truck_id: null, name: 'Sam' });
    expect(s.settlements.find((r) => r.id === 's1')!.driver_id).toBe('d1');
    expect(s.loads[0].driver_id).toBe('d1');
    expect(s.driver_payments).toHaveLength(1);
    await updateRowTolerant('drivers', 'd1', { ...RESTORE_DRIVER_VALUES });
    expect(s.drivers.find((d) => d.id === 'd1')!.active).toBe(true);
  });

  it('a driver with history cannot be deleted; one without history can', async () => {
    mockClient = createFakeSupabase(seed());
    expect(await fetchDriverHistory('d1')).toEqual({ settlements: 1, loads: 1, fuelPurchases: 0, deductions: 0, payments: 1, complianceItems: 0 });
    await expect(deleteDriverWithoutHistory('d1')).rejects.toThrow(/has history/);
    expect(mockClient.__store.drivers).toHaveLength(2);
    await deleteDriverWithoutHistory('d2');
    expect(mockClient.__store.drivers.map((d) => d.id)).toEqual(['d1']);
  });
});

// Schema guard: every FK to trucks in the SQL is either CASCADE (removed
// with the truck) or SET NULL (kept, unassigned). A new FK to trucks must be
// sorted into one of these lists, or a truck delete could fail or orphan rows.
describe('schema guard: every foreign key to trucks is accounted for', () => {
  const CASCADE = ['settlements', 'fuel_purchases', 'maintenance_records', 'deductions', 'tolls', 'maintenance_intervals', 'truck_health_config'];
  const SET_NULL = ['drivers', 'compliance_items'];
  const docs = path.resolve(__dirname, '../../../../docs');
  const sql = ['SCHEMA.sql', 'PENDING_SQL.md'].map((f) => fs.readFileSync(path.join(docs, f), 'utf8')).join('\n');

  it('finds no unknown table referencing trucks', () => {
    const tables = new Set<string>();
    const re = /references trucks\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const before = sql.slice(0, m.index);
      const owners = [...before.matchAll(/(?:create|alter) table (?:if not exists )?(\w+)/g)];
      const owner = owners[owners.length - 1]?.[1];
      if (owner) tables.add(owner);
    }
    expect(tables.size).toBeGreaterThan(0);
    for (const table of tables) expect([...CASCADE, ...SET_NULL]).toContain(table);
  });
});
