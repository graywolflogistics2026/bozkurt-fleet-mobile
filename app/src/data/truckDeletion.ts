import { supabase } from '@/src/lib/supabase';
import { cleanupOrphanedDocument } from '@/src/data/deductionMutations';

// DELETE A TRUCK (owner decision, docs/PENDING_SQL.md §64) — a real,
// permanent delete, distinct from Retire (`trucks.is_active = false`,
// which keeps every record — CLAUDE.md invariant #7). Two functions:
// `fetchTruckDeletionImpact()` (read-only, drives the confirmation
// screen's real counts/dollar totals) and `deleteTruckCompletely()` (the
// actual delete). Both are plain client-side Supabase calls, scoped by
// RLS to the caller's own rows — no Edge Function/RPC is needed for
// either: §64's FK fix makes `delete from trucks where id = $1` a single,
// genuinely atomic statement (Postgres cascades every settlement/load/
// fuel_purchase/maintenance_record/deduction/toll/maintenance_interval/
// truck_health_config row, and — a second hop — any capital_transactions
// row LINKED to one of those cascaded deductions, all inside the ONE
// transaction that statement runs in; it either all commits or none of
// it does). Document/Storage cleanup is a deliberately SEPARATE,
// best-effort pass run AFTER that delete has already succeeded — Storage
// deletion is a non-transactional API call that can't be rolled back
// together with a SQL statement, the same honest limitation
// delete-account/reset-data already document for the identical reason.

export type TruckDeletionImpact = {
  settlementsCount: number;
  loadsCount: number;
  fuelPurchasesCount: number;
  maintenanceRecordsCount: number;
  tollsCount: number;
  deductionsCount: number;
  documentsCount: number;
  // Total dollar VOLUME of what's being deleted — sum of every
  // settlement's own gross (real money the carrier paid) plus every
  // fuel/maintenance/toll/deduction amount (real money spent) — a
  // measure of "how much financial activity" this truck's records
  // represent, deliberately NOT a net-profit figure and NOT summing
  // `loads.revenue` (that's already counted once, inside its own
  // settlement's `gross`, and summing both would double it).
  totalDollarValue: number;
};

async function collectTruckDocumentIds(truckId: string): Promise<Set<string>> {
  // Same 3 tables `cleanupOrphanedDocument()` itself checks for
  // reference (fuel_purchases/tolls have no document_id column at all,
  // confirmed against docs/SCHEMA.sql — CLAUDE.md's own CASCADE DELETE
  // entry already established this).
  const [settlementsRes, maintenanceRes, deductionsRes] = await Promise.all([
    supabase.from('settlements').select('document_id').eq('truck_id', truckId),
    supabase.from('maintenance_records').select('document_id').eq('truck_id', truckId),
    supabase.from('deductions').select('document_id').eq('truck_id', truckId),
  ]);
  if (settlementsRes.error) throw settlementsRes.error;
  if (maintenanceRes.error) throw maintenanceRes.error;
  if (deductionsRes.error) throw deductionsRes.error;

  const documentIds = new Set<string>();
  for (const row of settlementsRes.data ?? []) if (row.document_id) documentIds.add(row.document_id);
  for (const row of maintenanceRes.data ?? []) if (row.document_id) documentIds.add(row.document_id);
  for (const row of deductionsRes.data ?? []) if (row.document_id) documentIds.add(row.document_id);
  return documentIds;
}

export async function fetchTruckDeletionImpact(truckId: string): Promise<TruckDeletionImpact> {
  const [settlementsRes, fuelRes, maintenanceRes, tollsRes, deductionsRes] = await Promise.all([
    supabase.from('settlements').select('id, gross, document_id').eq('truck_id', truckId),
    supabase.from('fuel_purchases').select('id, amount').eq('truck_id', truckId),
    supabase.from('maintenance_records').select('id, cost, document_id').eq('truck_id', truckId),
    supabase.from('tolls').select('id, amount').eq('truck_id', truckId),
    supabase.from('deductions').select('id, amount, document_id').eq('truck_id', truckId),
  ]);
  if (settlementsRes.error) throw settlementsRes.error;
  if (fuelRes.error) throw fuelRes.error;
  if (maintenanceRes.error) throw maintenanceRes.error;
  if (tollsRes.error) throw tollsRes.error;
  if (deductionsRes.error) throw deductionsRes.error;

  const settlements = settlementsRes.data ?? [];
  const fuel = fuelRes.data ?? [];
  const maintenance = maintenanceRes.data ?? [];
  const tolls = tollsRes.data ?? [];
  const deductions = deductionsRes.data ?? [];

  const settlementIds = settlements.map((s) => s.id);
  let loadsCount = 0;
  if (settlementIds.length > 0) {
    const { count, error } = await supabase
      .from('loads')
      .select('id', { count: 'exact', head: true })
      .in('settlement_id', settlementIds);
    if (error) throw error;
    loadsCount = count ?? 0;
  }

  const documentIds = new Set<string>();
  for (const row of settlements) if (row.document_id) documentIds.add(row.document_id);
  for (const row of maintenance) if (row.document_id) documentIds.add(row.document_id);
  for (const row of deductions) if (row.document_id) documentIds.add(row.document_id);

  const totalDollarValue =
    settlements.reduce((sum, s) => sum + Number(s.gross ?? 0), 0) +
    fuel.reduce((sum, f) => sum + Number(f.amount ?? 0), 0) +
    maintenance.reduce((sum, m) => sum + Number(m.cost ?? 0), 0) +
    tolls.reduce((sum, t) => sum + Number(t.amount ?? 0), 0) +
    deductions.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  return {
    settlementsCount: settlements.length,
    loadsCount,
    fuelPurchasesCount: fuel.length,
    maintenanceRecordsCount: maintenance.length,
    tollsCount: tolls.length,
    deductionsCount: deductions.length,
    documentsCount: documentIds.size,
    totalDollarValue,
  };
}

export type TruckDeletionResult = {
  // Document ids that survived the truck's own row deletion (the ATOMIC
  // part, already fully committed by the time this ever runs) but failed
  // their best-effort Storage/row cleanup — never means the truck or any
  // of its financial records survived, only that a leftover orphaned
  // document/file may remain, sweepable later (same tier as every other
  // "harmless orphan" this app already tolerates, e.g.
  // cleanupOrphanedDocument()'s own precedent).
  documentCleanupFailures: string[];
};

export async function deleteTruckCompletely(truckId: string): Promise<TruckDeletionResult> {
  // Collected BEFORE the delete — once the truck (and its cascaded rows)
  // is gone, there is no more join path left to find them.
  const documentIds = await collectTruckDocumentIds(truckId);

  // THE ATOMIC STEP — a single statement; docs/PENDING_SQL.md §64 is what
  // makes this legal at all (previously this failed with a foreign-key
  // violation the instant any settlement/fuel/maintenance/deduction/toll
  // row still pointed at this truck).
  const { error: deleteError } = await supabase.from('trucks').delete().eq('id', truckId);
  if (deleteError) throw deleteError;

  // BEST-EFFORT, run only after the atomic delete above has already
  // succeeded — reuses the EXISTING cleanupOrphanedDocument() (same
  // function every other per-record delete flow in this app already
  // calls), which re-checks genuine orphan status itself before removing
  // anything, so a document somehow still referenced elsewhere is left
  // alone rather than guessed away.
  const outcomes = await Promise.allSettled([...documentIds].map((id) => cleanupOrphanedDocument(id)));
  const documentCleanupFailures: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      const id = [...documentIds][i];
      console.warn('deleteTruckCompletely: failed to clean up document', id, outcome.reason);
      documentCleanupFailures.push(id);
    }
  });

  return { documentCleanupFailures };
}
