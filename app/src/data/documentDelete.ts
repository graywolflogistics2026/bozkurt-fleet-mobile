import { supabase } from '@/src/lib/supabase';
import { computeKpis, type KpiInputs } from '@/src/stats/kpi';
import { weekStartFromEnding } from '@/src/stats/cashFlowTrend';
import { addDaysDateOnly, weekdayOf } from '@/src/lib/dateOnly';

// DELETE A DOCUMENT AND EVERYTHING LINKED (owner decision 2026-10-30, master
// plan batch A item 7). The trace behind this module:
// - Documents had no delete action at all (more/documents.tsx detail sheet;
//   useDeleteDocument was never used).
// - A plain delete would fail for any settlement document:
//   settlements.document_id has NO ON DELETE rule (docs/SCHEMA.sql), so
//   Postgres refuses to delete a document a settlement still points at.
//   Every other link is ON DELETE SET NULL (deductions, maintenance_records,
//   bank_statements, household_income, compliance_items.source_document_id,
//   misc_income, import_jobs, prime_driver_expenses).
// - The work runs in two server functions (docs/PENDING_SQL.md §80):
//   preview_document_delete() and delete_document_cascade(), one
//   transaction each, scoped to auth.uid(). The Storage file is removed
//   AFTER the database commit; a failed removal is queued and retried.

export type DeleteMode = 'all' | 'file_only';
export type LinkKind = 'derived' | 'attached' | 'kept';

export type DocumentDeleteTable = {
  table: string;
  kind: LinkKind;
  count: number;
  amount: number;
  ids: string[];
};

export type DocumentDeletePreview =
  | { status: 'not_found' }
  | {
      status: 'ok';
      document: { id: string; filename: string | null; doc_type: string | null; doc_date: string | null; amount: number | null; storage_path: string | null };
      settlements: Array<{ id: string; week_ending: string | null; gross: number | null; net: number | null; truck_id: string | null }>;
      tables: DocumentDeleteTable[];
    };

export type DocumentDeleteResult =
  | { status: 'not_found' }
  | { status: 'deleted'; mode: DeleteMode; storagePath: string | null; deleted: Record<string, number>; storageRemoved: boolean };

// The function names; a missing function (PENDING_SQL §80 not run yet) is
// reported plainly instead of a raw PostgREST message.
export const PREVIEW_RPC = 'preview_document_delete';
export const DELETE_RPC = 'delete_document_cascade';

export class DocumentDeleteNotInstalledError extends Error {
  constructor() {
    super('Document delete needs a database update (PENDING_SQL §80) that has not been run yet. Nothing was deleted.');
    this.name = 'DocumentDeleteNotInstalledError';
  }
}

type RpcError = { message: string; code?: string };

function isMissingFunction(error: RpcError): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message);
}

export async function previewDocumentDelete(documentId: string): Promise<DocumentDeletePreview> {
  const { data, error } = await supabase.rpc(PREVIEW_RPC, { p_doc_id: documentId });
  if (error) {
    if (isMissingFunction(error as RpcError)) throw new DocumentDeleteNotInstalledError();
    throw error;
  }
  return normalizePreview(data);
}

export function normalizePreview(raw: unknown): DocumentDeletePreview {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.status !== 'ok') return { status: 'not_found' };
  const tables = ((r.tables as unknown[]) ?? []).map((x) => {
    const t = x as Record<string, unknown>;
    return {
      table: String(t.table),
      kind: t.kind as LinkKind,
      count: Number(t.count ?? 0),
      amount: Number(t.amount ?? 0),
      ids: ((t.ids as unknown[]) ?? []).map(String),
    };
  });
  return {
    status: 'ok',
    document: r.document as Extract<DocumentDeletePreview, { status: 'ok' }>['document'],
    settlements: (r.settlements as Extract<DocumentDeletePreview, { status: 'ok' }>['settlements']) ?? [],
    tables,
  };
}

// ---- Storage removal after the commit, with a retry queue ----

export type KeyValueStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
export const PENDING_STORAGE_REMOVALS_KEY = 'pending-storage-removals';

async function readQueue(kv: KeyValueStore): Promise<string[]> {
  try {
    const raw = await kv.getItem(PENDING_STORAGE_REMOVALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function writeQueue(kv: KeyValueStore, paths: string[]): Promise<void> {
  try {
    await kv.setItem(PENDING_STORAGE_REMOVALS_KEY, JSON.stringify([...new Set(paths)]));
  } catch {
    // Device storage unavailable: the file stays; nothing financial depends on it.
  }
}

async function removeStorageObject(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from('documents').remove([path]);
  return !error;
}

// Retries every queued removal; keeps the ones that still fail.
export async function retryPendingStorageRemovals(kv: KeyValueStore): Promise<{ removed: number; remaining: number }> {
  const queue = await readQueue(kv);
  if (queue.length === 0) return { removed: 0, remaining: 0 };
  const remaining: string[] = [];
  for (const path of queue) if (!(await removeStorageObject(path))) remaining.push(path);
  await writeQueue(kv, remaining);
  return { removed: queue.length - remaining.length, remaining: remaining.length };
}

export async function deleteDocumentCascade(documentId: string, mode: DeleteMode, kv: KeyValueStore): Promise<DocumentDeleteResult> {
  const { data, error } = await supabase.rpc(DELETE_RPC, { p_doc_id: documentId, p_mode: mode });
  if (error) {
    if (isMissingFunction(error as RpcError)) throw new DocumentDeleteNotInstalledError();
    throw error;
  }
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.status !== 'deleted') return { status: 'not_found' };
  const storagePath = (r.storage_path as string | null) ?? null;
  let storageRemoved = true;
  if (storagePath) {
    storageRemoved = await removeStorageObject(storagePath);
    if (!storageRemoved) await writeQueue(kv, [...(await readQueue(kv)), storagePath]);
  }
  return {
    status: 'deleted',
    mode,
    storagePath,
    deleted: (r.deleted as Record<string, number>) ?? {},
    storageRemoved,
  };
}

// ---- What the sheet shows ----

export function linkedRowCount(preview: DocumentDeletePreview, kinds: LinkKind[] = ['derived', 'attached']): number {
  if (preview.status !== 'ok') return 0;
  return preview.tables.filter((t) => kinds.includes(t.kind)).reduce((n, t) => n + t.count, 0);
}

// A settlement document deletes the whole settlement: the owner types the
// week ending (as stored, YYYY-MM-DD) to confirm.
export function settlementWeekToConfirm(preview: DocumentDeletePreview): string | null {
  if (preview.status !== 'ok' || preview.settlements.length === 0) return null;
  return preview.settlements[0].week_ending ?? null;
}

export function typedConfirmationMatches(typed: string, expected: string | null): boolean {
  if (expected == null) return true;
  return typed.trim() === expected;
}

// The week the document belongs to: its settlement's week ending, else the
// Saturday-ending week around its own date. null = no date to show.
export function affectedWeekEnding(preview: DocumentDeletePreview): string | null {
  if (preview.status !== 'ok') return null;
  const settlementWeek = settlementWeekToConfirm(preview);
  if (settlementWeek) return settlementWeek;
  const d = preview.document.doc_date;
  if (!d) return null;
  return addDaysDateOnly(d, (6 - weekdayOf(d) + 7) % 7);
}

export type ProfitEffect = { weekEnding: string; before: number; after: number };

type IdRow = { id: string };

// "This week's profit changes from $A to $B": computeKpis() on the fleet
// for that week, once with every row and once without the rows the chosen
// mode deletes. No new formula — the canonical engine on two row sets.
export function documentDeleteProfitEffect(
  preview: DocumentDeletePreview,
  mode: DeleteMode,
  inputs: Omit<KpiInputs, 'window' | 'truckScope'>
): ProfitEffect | null {
  const weekEnding = affectedWeekEnding(preview);
  if (!weekEnding || preview.status !== 'ok') return null;
  const window = { startIso: weekStartFromEnding(weekEnding), endIso: weekEnding };
  const before = computeKpis({ ...inputs, truckScope: null, window }).net;
  if (mode === 'file_only') return { weekEnding, before, after: before };

  const removed = new Set(preview.tables.filter((t) => t.kind !== 'kept').flatMap((t) => t.ids));
  const removedSettlements = new Set(preview.settlements.map((s) => s.id));
  const keep = <R extends IdRow>(rows: R[]) =>
    rows.filter((r) => !removed.has(r.id) && !removedSettlements.has(String((r as { settlement_id?: string | null }).settlement_id ?? '')));
  const after = computeKpis({
    ...inputs,
    settlements: keep(inputs.settlements as Array<KpiInputs['settlements'][number] & IdRow>),
    loads: keep(inputs.loads as Array<KpiInputs['loads'][number] & IdRow>),
    deductions: keep(inputs.deductions as Array<KpiInputs['deductions'][number] & IdRow>),
    fuelPurchases: keep(inputs.fuelPurchases as Array<KpiInputs['fuelPurchases'][number] & IdRow>),
    maintenanceRecords: keep(inputs.maintenanceRecords as Array<KpiInputs['maintenanceRecords'][number] & IdRow>),
    tolls: keep(inputs.tolls as Array<KpiInputs['tolls'][number] & IdRow>),
    reimbursements: keep(inputs.reimbursements as Array<KpiInputs['reimbursements'][number] & IdRow>),
    truckScope: null,
    window,
  }).net;
  return { weekEnding, before, after };
}
