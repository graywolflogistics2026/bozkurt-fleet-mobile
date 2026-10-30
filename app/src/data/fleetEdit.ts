import { supabase } from '@/src/lib/supabase';
import type { Driver, Truck } from '@/src/types/db';

// TRUCKS AND DRIVERS: edit, archive, delete (owner decision 2026-10-30,
// master plan batch A item 2). The trace behind this module:
// - Retire/Reactivate on a truck and Deactivate on a driver had no
//   try/catch (trucks.tsx handleReactivate, drivers.tsx handleToggleActive),
//   so a failed write was silent — "nothing happens".
// - A plain `.delete().eq('id', X)` that RLS or a wrong id makes match zero
//   rows returns NO error; the app could not tell a delete that did nothing
//   from one that worked. Every write here checks the affected row count.
// - RLS is not the cause: `trucks_owner_all`/`drivers_owner_all` are FOR ALL
//   (supabase/migrations/0001_init.sql), so no RLS SQL is needed.
// - `nickname`/`plate` are new truck columns (docs/PENDING_SQL.md §79).
//   Until that SQL runs, a save that includes them retries without them
//   (CLAUDE.md PENDING_SQL rule 2: an unknown-column write must not crash).

export const OPTIONAL_TRUCK_COLUMNS = ['nickname', 'plate'] as const;

type WriteError = { message: string; code?: string };

// PostgREST answers PGRST204 ("Could not find the 'x' column of 'trucks' in
// the schema cache") for a column that does not exist yet.
export function missingColumnIn(error: WriteError | null, columns: readonly string[]): boolean {
  if (!error) return false;
  if (error.code !== 'PGRST204' && !/column/i.test(error.message)) return false;
  return columns.some((c) => error.message.includes(`'${c}'`));
}

export class NothingChangedError extends Error {
  constructor(table: string) {
    super(`No ${table} row was changed — it may already be gone, or it is not on this account.`);
    this.name = 'NothingChangedError';
  }
}

export type TolerantUpdateResult = { skippedColumns: string[] };

export async function updateRowTolerant(
  table: 'trucks' | 'drivers',
  id: string,
  values: Record<string, unknown>,
  optionalColumns: readonly string[] = []
): Promise<TolerantUpdateResult> {
  const first = await supabase.from(table).update(values).eq('id', id).select('id');
  let data = first.data;
  let error = first.error as WriteError | null;
  let skippedColumns: string[] = [];
  if (missingColumnIn(error, optionalColumns)) {
    skippedColumns = optionalColumns.filter((c) => c in values);
    const rest = Object.fromEntries(Object.entries(values).filter(([k]) => !optionalColumns.includes(k)));
    const retry = await supabase.from(table).update(rest).eq('id', id).select('id');
    data = retry.data;
    error = retry.error as WriteError | null;
  }
  if (error) throw error;
  if (!data || data.length === 0) throw new NothingChangedError(table);
  return { skippedColumns };
}

export async function insertTruckTolerant(values: Record<string, unknown>): Promise<TolerantUpdateResult & { id: string }> {
  const first = await supabase.from('trucks').insert(values).select('id');
  let data = first.data;
  let error = first.error as WriteError | null;
  let skippedColumns: string[] = [];
  if (missingColumnIn(error, OPTIONAL_TRUCK_COLUMNS)) {
    skippedColumns = OPTIONAL_TRUCK_COLUMNS.filter((c) => c in values);
    const rest = Object.fromEntries(Object.entries(values).filter(([k]) => !(OPTIONAL_TRUCK_COLUMNS as readonly string[]).includes(k)));
    const retry = await supabase.from('trucks').insert(rest).select('id');
    data = retry.data;
    error = retry.error as WriteError | null;
  }
  if (error) throw error;
  const id = data?.[0]?.id as string | undefined;
  if (!id) throw new NothingChangedError('trucks');
  return { id, skippedColumns };
}

// ---- Archive (is_active = false) and the last-truck rule ----

// The last active truck cannot be archived: the scope strip, Truck Health
// and every per-truck screen need one active truck. Delete stays possible
// (it is explicit and typed).
export function canArchiveTruck(trucks: Pick<Truck, 'id' | 'is_active'>[], truckId: string): boolean {
  const active = trucks.filter((t) => t.is_active);
  return active.some((t) => t.id === truckId) && active.length > 1;
}

export function isLastTruck(trucks: Pick<Truck, 'id'>[], truckId: string): boolean {
  return trucks.length === 1 && trucks[0].id === truckId;
}

// Pickers (assign a deduction / maintenance record / compliance item to a
// truck) offer active trucks only. A row already on an archived truck still
// shows that truck so its current value stays visible and selected.
export function selectableTrucks<T extends Pick<Truck, 'id' | 'is_active'>>(trucks: T[], keepId?: string | null): T[] {
  return trucks.filter((t) => t.is_active || (keepId != null && t.id === keepId));
}

export function truckLabel(t: Pick<Truck, 'id' | 'unit_number'> & { nickname?: string | null }): string {
  const unit = t.unit_number?.trim() || t.id;
  const nick = t.nickname?.trim();
  return nick ? `${unit} · ${nick}` : unit;
}

// ---- Assigned drivers (drivers.default_truck_id) ----

// The truck's "assigned driver" is stored on the driver
// (`drivers.default_truck_id`, on delete set null). Returns the driver
// updates needed so exactly `selectedDriverIds` point at this truck.
export function planDriverAssignment(
  drivers: Pick<Driver, 'id' | 'default_truck_id'>[],
  truckId: string,
  selectedDriverIds: string[]
): Array<{ id: string; default_truck_id: string | null }> {
  const selected = new Set(selectedDriverIds);
  const changes: Array<{ id: string; default_truck_id: string | null }> = [];
  for (const d of drivers) {
    const isOn = d.default_truck_id === truckId;
    if (selected.has(d.id) && !isOn) changes.push({ id: d.id, default_truck_id: truckId });
    if (!selected.has(d.id) && isOn) changes.push({ id: d.id, default_truck_id: null });
  }
  return changes;
}

export async function applyDriverAssignment(changes: Array<{ id: string; default_truck_id: string | null }>): Promise<void> {
  for (const c of changes) await updateRowTolerant('drivers', c.id, { default_truck_id: c.default_truck_id });
}

// ---- Drivers: remove (former driver) vs delete ----

// "Remove" keeps every settlement, load, fuel row, deduction and payment
// that names the driver; the driver just becomes a former driver (inactive,
// no assigned truck) and can be restored.
export const REMOVE_DRIVER_VALUES = { active: false, default_truck_id: null } as const;
export const RESTORE_DRIVER_VALUES = { active: true } as const;

export type DriverHistory = {
  settlements: number;
  loads: number;
  fuelPurchases: number;
  deductions: number;
  payments: number;
  complianceItems: number;
};

export function driverHistoryTotal(h: DriverHistory): number {
  return h.settlements + h.loads + h.fuelPurchases + h.deductions + h.payments + h.complianceItems;
}

export async function fetchDriverHistory(driverId: string): Promise<DriverHistory> {
  const count = async (table: string) => {
    const { count: n, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('driver_id', driverId);
    if (error) throw error;
    return n ?? 0;
  };
  const [settlements, loads, fuelPurchases, deductions, payments, complianceItems] = await Promise.all([
    count('settlements'),
    count('loads'),
    count('fuel_purchases'),
    count('deductions'),
    count('driver_payments'),
    count('compliance_items'),
  ]);
  return { settlements, loads, fuelPurchases, deductions, payments, complianceItems };
}

// A permanent delete is offered only for a driver with no history at all
// (deleting one with payments would cascade-delete those payments and
// change payroll tax figures). With history, Remove is the only option.
export async function deleteDriverWithoutHistory(driverId: string): Promise<void> {
  const history = await fetchDriverHistory(driverId);
  if (driverHistoryTotal(history) > 0) throw new Error('This driver has history. Use Remove instead — it keeps every record.');
  const { data, error } = await supabase.from('drivers').delete().eq('id', driverId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new NothingChangedError('drivers');
}
