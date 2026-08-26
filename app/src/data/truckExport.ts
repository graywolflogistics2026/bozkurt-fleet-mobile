import { supabase } from '@/src/lib/supabase';

// EXPORT THIS TRUCK'S DATA FIRST (owner decision, Delete A Truck pass) —
// a truck-scoped counterpart to Settings' own `fetchAllUserData()`
// (`app/src/data/exportAllData.ts`) — same "one row per table, full raw
// dump" spirit, just filtered to one truck instead of the whole account.
// `loads`/`documents` have no `truck_id` column of their own (same gap
// `exportAllData.ts`'s own EXPORT_TABLES doesn't have to solve, since
// that export is unscoped) — `loads` is reached via each of this truck's
// own `settlements.id`; `documents` via the `document_id` every
// settlement/maintenance_records/deductions row here may carry (the SAME
// 3-table check `app/src/data/truckDeletion.ts` and
// `cleanupOrphanedDocument()` already use).
export type TruckExportData = {
  truck: Record<string, unknown> | null;
  settlements: Record<string, unknown>[];
  loads: Record<string, unknown>[];
  fuel_purchases: Record<string, unknown>[];
  maintenance_records: Record<string, unknown>[];
  tolls: Record<string, unknown>[];
  deductions: Record<string, unknown>[];
  documents: Record<string, unknown>[];
};

export async function fetchTruckExportData(truckId: string): Promise<TruckExportData> {
  const [truckRes, settlementsRes, fuelRes, maintenanceRes, tollsRes, deductionsRes] = await Promise.all([
    supabase.from('trucks').select('*').eq('id', truckId).maybeSingle(),
    supabase.from('settlements').select('*').eq('truck_id', truckId),
    supabase.from('fuel_purchases').select('*').eq('truck_id', truckId),
    supabase.from('maintenance_records').select('*').eq('truck_id', truckId),
    supabase.from('tolls').select('*').eq('truck_id', truckId),
    supabase.from('deductions').select('*').eq('truck_id', truckId),
  ]);
  if (truckRes.error) throw truckRes.error;
  if (settlementsRes.error) throw settlementsRes.error;
  if (fuelRes.error) throw fuelRes.error;
  if (maintenanceRes.error) throw maintenanceRes.error;
  if (tollsRes.error) throw tollsRes.error;
  if (deductionsRes.error) throw deductionsRes.error;

  const settlements = settlementsRes.data ?? [];
  const maintenance = maintenanceRes.data ?? [];
  const deductions = deductionsRes.data ?? [];

  const settlementIds = settlements.map((s) => (s as { id: string }).id);
  const loadsRes = settlementIds.length > 0 ? await supabase.from('loads').select('*').in('settlement_id', settlementIds) : { data: [], error: null };
  if (loadsRes.error) throw loadsRes.error;

  const documentIds = new Set<string>();
  for (const row of settlements) {
    const id = (row as { document_id: string | null }).document_id;
    if (id) documentIds.add(id);
  }
  for (const row of maintenance) {
    const id = (row as { document_id: string | null }).document_id;
    if (id) documentIds.add(id);
  }
  for (const row of deductions) {
    const id = (row as { document_id: string | null }).document_id;
    if (id) documentIds.add(id);
  }
  const documentsRes =
    documentIds.size > 0 ? await supabase.from('documents').select('*').in('id', [...documentIds]) : { data: [], error: null };
  if (documentsRes.error) throw documentsRes.error;

  return {
    truck: truckRes.data ?? null,
    settlements,
    loads: loadsRes.data ?? [],
    fuel_purchases: fuelRes.data ?? [],
    maintenance_records: maintenance,
    tolls: tollsRes.data ?? [],
    deductions,
    documents: documentsRes.data ?? [],
  };
}
