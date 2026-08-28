import { File } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { buildStoragePath } from '@/src/import/storagePath';
import {
  COMPLIANCE_DOC_TYPES,
  FINANCIAL_DOC_TYPES,
  mapCompliance,
  mapDriverPayment,
  mapFinancialDocDeduction,
  mapFuel,
  mapGenericDeduction,
  mapLoanAgreement,
  mapMaintenance,
  mapPurchase,
  mapSettlement,
  numOrNull,
} from '@/src/import/mapExtraction';
import { resolveLoanAssetMatch } from '@/src/import/loanAssetMatch';
import { findMatchingLoan } from '@/src/import/loanMatch';
import { buildLinkedEquipmentInsert } from '@/src/import/equipmentLink';
import type { ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';
import { getPrimaryExtractionDate, toDateOrNull } from '@/src/import/dateGuard';
import { applyLearnedCategories, matchLearnedCategory, type LearningRule } from '@/src/import/categoryLearning';
import { applyCarrierCodeCategories, normalizeCarrierKey, type CarrierCode } from '@/src/import/carrierCodes';
import {
  SaveExtractionError,
  emptyPartialState,
  type SaveExtractionPartialState,
  type SaveExtractionStep,
} from '@/src/data/saveExtractionError';

// CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
// follow-up item G) — best-effort read, never blocks a save. Returns []
// (no learned overrides applied, identical to today's behavior) if the
// table doesn't exist yet (docs/PENDING_SQL.md §47 not yet run) or the
// fetch otherwise fails — this feature must never be able to break an
// import.
async function fetchLearningRules(userId: string): Promise<LearningRule[]> {
  try {
    const { data, error } = await supabase.from('category_learning_rules').select('keyword, category, carrier').eq('user_id', userId);
    if (error || !data) return [];
    return data as LearningRule[];
  } catch {
    return [];
  }
}

// CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision) — reads
// EVERY seeded carrier's own code map (a small, global reference table,
// docs/PENDING_SQL.md §52); the actual scoping to ONE carrier happens
// downstream in applyCarrierCodeCategories(), never here. Best-effort,
// same "must never be able to break an import" contract as
// fetchLearningRules() above — returns [] (identical to today's behavior)
// if the table doesn't exist yet or the fetch otherwise fails.
async function fetchCarrierCodeMaps(): Promise<CarrierCode[]> {
  try {
    const { data, error } = await supabase
      .from('carrier_code_maps')
      .select('carrier, code, sub_code, label, description, category, is_deductible, income_or_chargeback, notes');
    if (error || !data) return [];
    return data.map((r) => ({
      carrier: r.carrier as string,
      code: r.code as string,
      subCode: (r.sub_code as string | null) ?? null,
      label: r.label as string,
      description: (r.description as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      isDeductible: (r.is_deductible as boolean | null) ?? null,
      incomeOrChargeback: (r.income_or_chargeback as 'income' | 'chargeback' | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function fetchExistingDocsForDuplicateCheck(userId: string): Promise<ExistingDocSummary[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('filename, doc_date, doc_type, amount, imported_at')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as ExistingDocSummary[];
}

// Settlement match key (bug fix 2026-07-30): a settlement is uniquely
// identified by (user_id, week_ending, truck_id) — truck_id included so
// two DIFFERENT trucks' settlements for the SAME week never collide (a
// fleet with 2+ trucks commonly gets paid on the same week_ending for
// every truck). truck_id === null matches only other null-truck rows
// (.is, not .eq — Postgres/PostgREST treat these as distinct filters).
// Used both by the import preview (to show the "will replace" banner
// before saving) and by saveExtraction() itself, so the two can never
// disagree about what counts as "already imported."
export async function findExistingSettlement(
  userId: string,
  weekEnding: string,
  truckId: string | null
): Promise<{ id: string } | null> {
  if (!weekEnding) return null;
  let query = supabase
    .from('settlements')
    .select('id')
    .eq('user_id', userId)
    .eq('week_ending', weekEnding);
  query = truckId ? query.eq('truck_id', truckId) : query.is('truck_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

export type SaveExtractionParams = {
  extraction: Extraction;
  userId: string;
  truckId: string | null;
  // Payroll auto-routing (owner decision 2026-07-09, PRODUCT DECISION):
  // resolved by the caller (resolveDriverMatch()/a picked-or-created
  // driver) same as truckId. Only applied to settlement docType rows.
  driverId: string | null;
  // Driver compensation types (owner decision 2026-07-10, PRODUCT
  // DECISION): the owner's entered/confirmed split for a team_split/trainee
  // driver on this settlement — creates a driver_payment row linked to the
  // new settlement. Null/0 for every other compensation_type (the caller
  // only shows this input when the resolved driver is team_split/trainee).
  driverShareAmount: number | null;
  fileUri: string | null;
  fileExt: string;
  mediaType: string;
  // Owner decision 2026-07-07 (CLAUDE.md invariant #2): a personal-payment
  // purchase line only becomes a Capital Account contribution when the
  // caller has already confirmed it with the user (once per receipt) —
  // declining still saves the deduction, just with no linked contribution.
  createContribution: boolean;
  // Custom category picker (PROMPTS.md Session 9a item 9): the user's
  // edited/picked category for the (previously read-only) 'other' docType
  // preview line — null/undefined falls back to mapGenericDeduction()'s own
  // suggestedCategory/'Other' default, unchanged from before this existed.
  categoryOverride?: string | null;
};

export type SaveExtractionResult = {
  documentId: string;
  storagePath: string | null;
  contributionTotal: number;
  // Settlement week-ending confirmation (owner decision 2026-07-30): lets
  // the "Saved" screen tell the user plainly whether this was a brand-new
  // week or a replace of an existing one — null/false for every non-
  // settlement docType.
  settlementWeekEnding: string | null;
  isSettlementReimport: boolean;
  // IMPORT SAVE BUG FIX (owner decision 2026-08-05) — rows that failed to
  // save even after the per-row fallback (insertBatchResilient), so the
  // import screen can tell the user exactly which rows were skipped and
  // why instead of a silently-incomplete-looking success. Empty for the
  // common case (nothing skipped).
  skippedRows: SkippedImportRow[];
};

// RICH IMPORT ERROR REPORTING (owner decision 2026-08-02, device feedback:
// "settlement imports failing frequently"). Wraps a single Supabase
// call's `{ data, error }` result: throws a step-tagged SaveExtractionError
// on failure (carrying a snapshot of what's already durably saved so far —
// see saveExtractionError.ts), otherwise returns `data` unwrapped. Every
// write in this file goes through this instead of a bare
// `if (error) throw error` so NO step can silently swallow a failure or
// leave the caller unable to say which step broke.
function must<T>(step: SaveExtractionStep, data: T | null, error: unknown, partial: SaveExtractionPartialState): T {
  if (error) throw new SaveExtractionError(step, error, partial);
  if (data == null) throw new SaveExtractionError(step, new Error('Expected a saved row but none was returned.'), partial);
  return data;
}

// IMPORT SAVE BUG FIX (owner decision 2026-08-05, device report: "Failed
// while saving loads/fuel/deductions — invalid input syntax for type
// date: \"\""). A single malformed row (whatever the cause — the date/
// numeric sanitizers above should now prevent the reported bug class
// entirely, but this is the general-purpose safety net) should never take
// down an ENTIRE batch of otherwise-good rows. Tries the batch insert
// first (the fast, common-case path — one round trip); only on failure
// does it fall back to inserting rows ONE AT A TIME, so exactly the bad
// row(s) — never the good ones — end up skipped and reported.
type ResilientInsertTable = 'loads' | 'fuel_purchases' | 'deductions' | 'reimbursements' | 'maintenance_records' | 'tolls';

export type SkippedImportRow = { table: string; description: string; reason: string };

// EQUIPMENT AUTO-POPULATE (owner decision, SIMPLIFICATION PASS, item 7) —
// this used to return void; callers that need the real inserted row (its
// DB-generated `id`, for the deductions table specifically, so a linked
// Equipment row can be created afterward) now get it back via `.select()`.
// Every existing caller already ignored the return value, so this is a
// backward-compatible widening, not a breaking change.
async function insertBatchResilient<T extends Record<string, unknown>>(
  table: ResilientInsertTable,
  rows: T[],
  describe: (row: T) => string,
  step: SaveExtractionStep,
  isReimport: boolean,
  partial: SaveExtractionPartialState,
  skipped: SkippedImportRow[]
): Promise<(T & { id: string })[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from(table).insert(rows as never[]).select();
  if (!error) return (data ?? []) as (T & { id: string })[];

  let anyFailed = false;
  const inserted: (T & { id: string })[] = [];
  for (const row of rows) {
    const { data: rowData, error: rowError } = await supabase.from(table).insert(row as never).select().single();
    if (rowError) {
      anyFailed = true;
      skipped.push({ table, description: describe(row), reason: rowError.message });
    } else if (rowData) {
      inserted.push(rowData as T & { id: string });
    }
  }
  // A RE-IMPORT's old-row deletion (further down in saveExtraction())
  // only runs once every NEW row has actually saved — the exact same
  // "capture old ids, delete only after every insert succeeds" safety
  // invariant its own comment already documents. A partial save is only
  // safe to tolerate silently for a BRAND-NEW import, where there is no
  // prior week's data at risk of being deleted out from under an
  // incomplete replacement.
  if (anyFailed && isReimport) {
    throw new SaveExtractionError(
      step,
      new Error(`${skipped.filter((s) => s.table === table).length} row(s) in ${table} could not be saved — stopping before removing last week's data.`),
      partial
    );
  }
  return inserted;
}

// EQUIPMENT AUTO-POPULATE (owner decision, SIMPLIFICATION PASS, item 7) —
// the ONE place a saved deduction row (real id in hand) gets turned into a
// linked Equipment row, shared by every deduction-insert call site below
// (settlement-withheld, standalone purchase, generic fallback). A failure
// here THROWS (never silently swallowed) — same "never let a save look
// complete when it wasn't" principle as every other write in this file —
// since a missing linked Equipment row would otherwise look like a clean
// save while quietly failing to track a real asset.
async function maybeLinkEquipment(
  row: { id: string; category: string | null; description: string | null; amount: number; ded_date: string | null; store: string | null },
  userId: string,
  partial: SaveExtractionPartialState
): Promise<void> {
  const insert = buildLinkedEquipmentInsert(row, row.id, userId);
  if (!insert) return;
  const { error } = await supabase.from('equipment').insert(insert);
  if (error) throw new SaveExtractionError('equipment-link-insert', error, partial);
}

// Writes rows exactly like legacy saveImport() (legacy/index.html:2502) —
// see app/src/import/mapExtraction.ts for the per-docType field mapping,
// ported verbatim from that function. This is the impure orchestration
// layer: wires foreign keys from just-created parent rows (settlement id,
// document id) into the pure mapping output, then performs the actual
// Supabase writes.
export async function saveExtraction(params: SaveExtractionParams): Promise<SaveExtractionResult> {
  const { extraction: d, userId, truckId, driverId, driverShareAmount, fileUri, fileExt, mediaType, createContribution, categoryOverride } = params;

  const partial: SaveExtractionPartialState = emptyPartialState();
  // IMPORT SAVE BUG FIX (owner decision 2026-08-05) — rows that failed
  // even after the per-row fallback (insertBatchResilient), collected so
  // the caller can tell the user EXACTLY which rows were skipped and why
  // instead of the whole import silently looking complete.
  const skippedRows: SkippedImportRow[] = [];

  // 0. VALIDATE BEFORE WRITING (pre-launch hardening, owner decision
  // 2026-08-02, independent code review finding): every required-field
  // check that can throw now runs BEFORE the Storage upload and the
  // documents insert below — previously these ran after both, so a
  // rejected import (missing week_ending, missing driver) still left an
  // orphaned uploaded file and an orphaned documents row behind. Settlement
  // mapping is computed here once and reused by the settlement branch
  // further down (mapSettlement() is pure — no reason to call it twice).
  let settlementMapping: ReturnType<typeof mapSettlement> | null = null;
  if (d.docType === 'settlement' && d.settlement) {
    settlementMapping = mapSettlement(d, userId, truckId, driverId);
    // A week_ending we can't pin down must never silently fall back to an
    // empty-string match key — two different weeks that both failed to
    // extract a date would otherwise collide on '' and replace each other
    // (the exact "second import replaces the first" bug this guards
    // against). The import preview's date field (CLAUDE.md DATE HARDENING
    // round 2) already requires the user to see/edit this value, so an
    // empty one here means it was left blank, not a legitimate settlement.
    if (!settlementMapping.settlement.week_ending) {
      throw new SaveExtractionError(
        'validation',
        new Error('This settlement has no week-ending date. Please set the document date before saving.'),
        partial
      );
    }
  }
  if (d.docType === 'driver_payment' && !driverId) {
    // Universal AI capture (owner decision 2026-07-10): driver_payments.
    // driver_id is NOT NULL — the import screen forces a driver pick for
    // this docType before Save is even enabled (needsDriverPicker), so
    // driverId being null here would be a UI bug, not a legitimate state.
    throw new SaveExtractionError('validation', new Error('A driver must be selected to save a driver payment.'), partial);
  }

  // 1. Upload the original file to the documents bucket FIRST (CLAUDE.md
  // storage convention: {user_id}/{month}/...) so the documents row can
  // reference its real storage_path.
  let storagePath: string | null = null;
  if (fileUri) {
    storagePath = buildStoragePath(userId, d, fileExt);
    partial.storagePath = storagePath;
    let bytes: Uint8Array;
    try {
      bytes = await new File(fileUri).bytes();
    } catch (err) {
      throw new SaveExtractionError('storage-upload', err, partial);
    }
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: mediaType, upsert: true });
    if (uploadError) throw new SaveExtractionError('storage-upload', uploadError, partial);
  }

  // 2. documents row — D3 audit trail: parsed_json holds the FULL raw
  // extraction, re-processable later if logic improves.
  const { data: docRow, error: docError } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      filename: storagePath ? storagePath.split('/').pop() : null,
      doc_type: d.docType,
      // For a settlement, the real "when did this happen" date is
      // weekEnding, not the (often-empty) top-level date — same resolver
      // duplicateCheck.ts uses, so a settlement document's stored doc_date
      // and its duplicate-check comparison can never disagree (bug fixed
      // 2026-07-30).
      doc_date: getPrimaryExtractionDate(d) || null,
      amount: numOrNull(d.totalAmount),
      storage_path: storagePath,
      parsed_json: d as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();
  const documentId = must('documents-insert', docRow, docError, partial).id as string;
  partial.documentId = documentId;

  let contributionTotal = 0;
  let settlementWeekEnding: string | null = null;
  let isSettlementReimport = false;

  // CATEGORY LEARNING LAYER (owner decision 2026-08-05, FULL PARITY
  // follow-up item G) — checked BEFORE this deduction row is saved, same
  // "applied before the built-in guesser" priority as the spec's own
  // wording; a user's own repeated correction wins over whatever the
  // AI/built-in guesser already assigned.
  const learningRules = await fetchLearningRules(userId);
  // CARRIER-SCOPED PAYROLL/SETTLEMENT CODES pass (owner decision) —
  // fetched unconditionally (cheap, small, global reference data) but
  // only ever APPLIED when this extraction is actually a settlement with
  // a real, normalizable carrier — see mapSettlement()'s own
  // `carrier` field on the returned SettlementInsert for what gets
  // persisted.
  const carrierCodeMaps = await fetchCarrierCodeMaps();

  if (d.docType === 'settlement' && d.settlement) {
    const mapping = settlementMapping!;
    const carrierKey = normalizeCarrierKey(d.settlement.carrier);
    // Carrier-scoped classification runs FIRST — it's the most specific,
    // most authoritative signal available (an admin-curated code map for
    // the EXACT carrier that issued this exact statement) — ahead of both
    // mapSettlement()'s own classifySettlementLine() (already applied,
    // carrier-agnostic) and the user's own learned corrections below,
    // which still get the final say (a user's explicit, repeated
    // correction always wins over any automatic classification).
    mapping.deductions = applyCarrierCodeCategories(mapping.deductions, carrierKey, carrierCodeMaps);
    mapping.deductions = applyLearnedCategories(mapping.deductions, learningRules, carrierKey);

    // Web v2026.07.09-A re-import-replace: importing the same
    // (week_ending, truck) again REPLACES that week's batch-tagged rows
    // instead of duplicating them — scoped by truck_id too (bug fix
    // 2026-07-30) so two different trucks paid for the same week never
    // collide. Matched via findExistingSettlement(), the same helper the
    // import preview uses for its "already imported" banner, so the two
    // can never disagree. An explicit select-then-update-or-insert (not a
    // Postgres upsert/onConflict) — the match key includes a nullable
    // truck_id, which onConflict's column-list inference can't express.
    let existingSett: { id: string } | null;
    try {
      existingSett = await findExistingSettlement(userId, mapping.settlement.week_ending, truckId);
    } catch (err) {
      throw new SaveExtractionError('settlements-lookup', err, partial);
    }
    const isReimport = !!existingSett;
    settlementWeekEnding = mapping.settlement.week_ending;
    isSettlementReimport = isReimport;

    let settlementId: string;
    if (isReimport) {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .update({ ...mapping.settlement, document_id: documentId })
        .eq('id', existingSett!.id)
        .select('id')
        .single();
      settlementId = must('settlements-save', settRow, settError, partial).id as string;
    } else {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .insert({ ...mapping.settlement, document_id: documentId })
        .select('id')
        .single();
      settlementId = must('settlements-save', settRow, settError, partial).id as string;
    }
    partial.settlementId = settlementId;
    partial.settlementSaved = true;

    // RE-IMPORT ORDERING (pre-launch hardening, owner decision 2026-08-02):
    // capture the PREVIOUS batch's row ids now (read-only) but do not
    // delete them yet — the new rows are inserted FIRST, further down, and
    // only once every insert has succeeded do we delete these captured old
    // ids. This avoids the worst case of the old ordering (delete-then-
    // insert): if a new insert failed partway through, the previous week's
    // data was already gone. Deleting by explicit captured id (not by a
    // fresh `eq('settlement_id', settlementId)` match) is what makes this
    // safe — the newly-inserted rows share the same settlement_id and must
    // never be swept up in the same delete.
    let oldLoadIds: string[] = [];
    let oldFuelIds: string[] = [];
    let oldReimbIds: string[] = [];
    let oldDedIds: string[] = [];
    let oldPayIds: string[] = [];
    // SETTLEMENT RE-IMPORT DUPLICATES maintenance/toll rows (P1 fix,
    // docs/PENDING_SQL.md §61) — maintenance_records/tolls never had this
    // capture-old-ids step at all, because neither table had a
    // settlement_id column to scope "old rows for THIS settlement" by
    // (maintenance_records only had document_id, which is a FRESH id on
    // every re-import attempt, no help for finding the PREVIOUS attempt's
    // rows; tolls had no linking column at all). Now that both have
    // settlement_id, they follow the exact same pattern as loads/fuel/
    // reimbursements/deductions above.
    let oldMaintenanceIds: string[] = [];
    let oldTollIds: string[] = [];
    if (isReimport) {
      const [loadsOld, fuelOld, reimbOld, dedOld, payOld, maintOld, tollOld] = await Promise.all([
        supabase.from('loads').select('id').eq('settlement_id', settlementId),
        supabase.from('fuel_purchases').select('id').eq('settlement_id', settlementId),
        supabase.from('reimbursements').select('id').eq('settlement_id', settlementId),
        supabase.from('deductions').select('id').eq('settlement_id', settlementId).eq('source', 'settlement'),
        supabase.from('driver_payments').select('id').eq('settlement_id', settlementId),
        supabase.from('maintenance_records').select('id').eq('settlement_id', settlementId),
        supabase.from('tolls').select('id').eq('settlement_id', settlementId),
      ]);
      const firstError = [loadsOld, fuelOld, reimbOld, dedOld, payOld, maintOld, tollOld].find((r) => r.error)?.error;
      if (firstError) throw new SaveExtractionError('reimport-lookup', firstError, partial);
      oldLoadIds = (loadsOld.data ?? []).map((r) => r.id as string);
      oldFuelIds = (fuelOld.data ?? []).map((r) => r.id as string);
      oldReimbIds = (reimbOld.data ?? []).map((r) => r.id as string);
      oldDedIds = (dedOld.data ?? []).map((r) => r.id as string);
      oldPayIds = (payOld.data ?? []).map((r) => r.id as string);
      oldMaintenanceIds = (maintOld.data ?? []).map((r) => r.id as string);
      oldTollIds = (tollOld.data ?? []).map((r) => r.id as string);
    }

    // IMPORT SAVE BUG FIX (owner decision 2026-08-05) — each batch tries
    // the normal single-insert fast path first; a single bad row only
    // falls back to per-row insertion (and gets reported in
    // `skippedRows`) rather than aborting the whole settlement save. A
    // RE-IMPORT still throws if any row is unrecoverable (insertBatchResilient's
    // own safety gate), preserving the existing "never delete last
    // week's data unless the full replacement actually saved" invariant.
    await insertBatchResilient(
      'loads',
      mapping.loads.map((l) => ({ ...l, settlement_id: settlementId })),
      (l) => `Load ${l.order_number ?? ''} ${l.origin ?? ''}→${l.destination ?? ''}`.trim(),
      'loads-insert',
      isReimport,
      partial,
      skippedRows
    );
    await insertBatchResilient(
      'fuel_purchases',
      mapping.fuel.map((f) => ({ ...f, settlement_id: settlementId })),
      (f) => `Fuel ${f.purchase_date ?? ''} ${f.location ?? ''}`.trim(),
      'fuel-insert',
      isReimport,
      partial,
      skippedRows
    );
    const insertedDeductions = await insertBatchResilient(
      'deductions',
      mapping.deductions.map((x) => ({ ...x, settlement_id: settlementId, document_id: documentId })),
      (x) => x.description ?? x.category ?? 'Deduction',
      'deductions-insert',
      isReimport,
      partial,
      skippedRows
    );
    // EQUIPMENT AUTO-POPULATE (owner decision, SIMPLIFICATION PASS, item
    // 7) — a settlement's own withheld deduction line (e.g. a company-
    // store tools/gear purchase) can land in a durable-goods category just
    // like a standalone purchase can; maybeLinkEquipment() is the ONE
    // gate deciding whether that happens, shared with every other
    // deduction-insert call site below.
    for (const dedRow of insertedDeductions) {
      await maybeLinkEquipment(
        {
          id: dedRow.id,
          category: (dedRow.category as string | null) ?? null,
          description: (dedRow.description as string | null) ?? null,
          amount: Number(dedRow.amount ?? 0),
          ded_date: (dedRow.ded_date as string | null) ?? null,
          store: (dedRow.store as string | null) ?? null,
        },
        userId,
        partial
      );
    }
    await insertBatchResilient(
      'reimbursements',
      mapping.reimbursements.map((r) => ({ ...r, settlement_id: settlementId })),
      (r) => r.description ?? 'Reimbursement',
      'reimbursements-insert',
      isReimport,
      partial,
      skippedRows
    );
    await insertBatchResilient(
      'maintenance_records',
      mapping.maintenance.map((m) => ({ ...m, document_id: documentId, settlement_id: settlementId })),
      (m) => m.description ?? m.service_type ?? 'Maintenance',
      'maintenance-insert',
      isReimport,
      partial,
      skippedRows
    );
    await insertBatchResilient(
      'tolls',
      mapping.tolls.map((t) => ({ ...t, settlement_id: settlementId })),
      (t) => `Toll ${t.toll_date ?? ''} ${t.plaza ?? ''}`.trim(),
      'tolls-insert',
      isReimport,
      partial,
      skippedRows
    );
    // Loans upsert — PRE-LAUNCH ERROR-VISIBILITY FIX (owner decision
    // 2026-08-02): this loop previously never checked ANY of these three
    // calls' `error` field (including the lookup select), so a loan
    // save/update failure was completely silent — the import would report
    // success while a loan row silently failed to save/update.
    //
    // LOAN DEDUPE FIX (owner decision, device report: "the extended
    // warranty loan is re-created on every settlement import") — root
    // cause was this loop's match key: exact string equality on
    // `loans.name` (`.eq('name', loan.name)`). The settlement schema's
    // own loans[] section has no separate lender/original-amount field,
    // so `name` was the ONLY identifying value — and the AI's own
    // extracted wording for a recurring loan-recap line naturally varies
    // week to week (a trailing reference suffix, punctuation,
    // capitalization), so the exact match silently missed the existing
    // row on nearly every re-import and inserted a new one instead. Fixed
    // by fetching every existing loan ONCE (not per-line) and matching
    // via loanMatch.ts's findMatchingLoan() — normalized-name equality/
    // containment, the same "tolerate natural wording drift" approach
    // categoryLearning.ts's normalizeKeyword() already uses for
    // deduction descriptions, with a conservative balance-ratio guard so
    // a same-named-but-wildly-different-amount pair is never silently
    // merged. A newly-inserted loan is pushed into the local candidate
    // list so two loans[] lines in the SAME settlement that both
    // normalize to the same key match each other too, instead of both
    // inserting.
    if (mapping.loans.length > 0) {
      const { data: existingLoansAll, error: loansListError } = await supabase
        .from('loans')
        .select('id, name, lender, balance, original_amount')
        .eq('user_id', userId);
      if (loansListError) throw new SaveExtractionError('loans-upsert', loansListError, partial);
      const candidates = (existingLoansAll ?? []) as Array<{
        id: string;
        name: string | null;
        lender: string | null;
        balance: number | null;
        original_amount: number | null;
      }>;
      for (const loan of mapping.loans) {
        if (!loan.name) continue;
        // SETTLEMENT DELETE ORPHANS (owner decision, docs/PENDING_SQL.md
        // §70) — every upsert (new or existing loan) is stamped with the
        // REAL settlement id now that one exists, so this loan is always
        // linked to the MOST RECENT settlement that touched it (an
        // `on delete set null` FK, never cascade — see the migration's
        // own header comment for why a standing loan must never be
        // deleted just because one settlement mentioning it was).
        const loanWithSettlement = { ...loan, settlement_id: settlementId };
        const match = findMatchingLoan(loan, candidates);
        if (match) {
          const { error } = await supabase.from('loans').update(loanWithSettlement).eq('id', match.id);
          if (error) throw new SaveExtractionError('loans-upsert', error, partial);
          match.balance = loan.balance ?? match.balance;
        } else {
          const { data: inserted, error } = await supabase
            .from('loans')
            .insert(loanWithSettlement)
            .select('id, name, lender, balance, original_amount')
            .single();
          if (error) throw new SaveExtractionError('loans-upsert', error, partial);
          if (inserted) candidates.push(inserted as (typeof candidates)[number]);
        }
      }
    }
    // Driver compensation types (owner decision 2026-07-10): the owner's
    // entered/confirmed team_split/trainee share for this settlement.
    if (driverId && driverShareAmount && driverShareAmount > 0) {
      const { error: payErr } = await supabase.from('driver_payments').insert({
        user_id: userId,
        driver_id: driverId,
        settlement_id: settlementId,
        date: mapping.settlement.week_ending,
        gross_pay: driverShareAmount,
        notes: 'Settlement split (entered at import)',
      });
      if (payErr) throw new SaveExtractionError('driver-payment-insert', payErr, partial);
    }
    partial.childRowsSaved = true;

    // Only now — every new insert above has already succeeded — delete the
    // previous batch's captured rows, by explicit id.
    if (oldLoadIds.length > 0) {
      const { error } = await supabase.from('loads').delete().in('id', oldLoadIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldFuelIds.length > 0) {
      const { error } = await supabase.from('fuel_purchases').delete().in('id', oldFuelIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldReimbIds.length > 0) {
      const { error } = await supabase.from('reimbursements').delete().in('id', oldReimbIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldDedIds.length > 0) {
      const { error } = await supabase.from('deductions').delete().in('id', oldDedIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldPayIds.length > 0) {
      const { error } = await supabase.from('driver_payments').delete().in('id', oldPayIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldMaintenanceIds.length > 0) {
      const { error } = await supabase.from('maintenance_records').delete().in('id', oldMaintenanceIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    if (oldTollIds.length > 0) {
      const { error } = await supabase.from('tolls').delete().in('id', oldTollIds);
      if (error) throw new SaveExtractionError('reimport-cleanup', error, partial);
    }
    partial.oldRowsCleanedUp = true;

    // REMOVE BUSINESS BALANCE TRACKING (owner decision 2026-08-27) — a
    // settlement import no longer computes or applies any balance delta
    // at all. `apply_settlement_business_balance_credit()` (§60) and
    // `settlements.business_balance_credit` are both left in place,
    // inert (reversible later, docs/PENDING_SQL.md §72), but nothing in
    // this file calls the RPC or writes that column anymore.
  } else if (d.docType === 'fuel' && d.fuel) {
    const row = mapFuel(d, userId, truckId);
    const { error } = await supabase.from('fuel_purchases').insert(row);
    if (error) throw new SaveExtractionError('fuel-standalone-insert', error, partial);
  } else if (d.docType === 'driver_payment') {
    // driverId is validated non-null at the top of this function (step 0)
    // before any Storage/DB write ever happens.
    const row = mapDriverPayment(d, userId, driverId as string);
    const { error } = await supabase.from('driver_payments').insert(row);
    if (error) throw new SaveExtractionError('driver-payment-insert', error, partial);
  } else if ((FINANCIAL_DOC_TYPES as readonly string[]).includes(d.docType) && d.financialDoc) {
    // insurance/lease_rent/factoring_statement/utility_subscription — real
    // out-of-pocket business expenses, routed like any other deduction.
    const row = mapFinancialDocDeduction(d, userId);
    const { error } = await supabase.from('deductions').insert({ ...row, document_id: documentId });
    if (error) throw new SaveExtractionError('financial-doc-insert', error, partial);
  } else if ((COMPLIANCE_DOC_TYPES as readonly string[]).includes(d.docType)) {
    // AI feature package (owner decision 2026-07-10) — find-or-update by
    // (user_id, type): a re-scanned renewal replaces the old due date on
    // the SAME row rather than piling up duplicate compliance items.
    const row = mapCompliance(d, userId);
    if (row) {
      const { data: existing, error: lookupError } = await supabase
        .from('compliance_items')
        .select('id')
        .eq('user_id', userId)
        .eq('type', row.type)
        .maybeSingle();
      if (lookupError) throw new SaveExtractionError('compliance-lookup', lookupError, partial);
      if (existing) {
        const { error } = await supabase
          .from('compliance_items')
          .update({ label: row.label, due_date: row.due_date, source_document_id: documentId })
          .eq('id', existing.id);
        if (error) throw new SaveExtractionError('compliance-save', error, partial);
      } else {
        const { error } = await supabase
          .from('compliance_items')
          .insert({ ...row, source_document_id: documentId });
        if (error) throw new SaveExtractionError('compliance-save', error, partial);
      }
    }
    // row === null: no due date was extracted — the document is still
    // archived above (documents row + parsed_json), just nothing to track
    // yet, same "never guess" spirit as every other extraction rule.
  } else if (d.docType === 'maintenance' && d.maintenance) {
    const { maintenance, reimbursement } = mapMaintenance(d, userId, truckId);
    const { error } = await supabase
      .from('maintenance_records')
      .insert({ ...maintenance, document_id: documentId });
    if (error) throw new SaveExtractionError('maintenance-standalone-insert', error, partial);
    if (reimbursement) {
      const { error: reimbError } = await supabase.from('reimbursements').insert(reimbursement);
      if (reimbError) throw new SaveExtractionError('maintenance-warranty-reimbursement-insert', reimbError, partial);
    }
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const lines = mapPurchase(d, userId);
    for (const line of lines) {
      const learned = matchLearnedCategory(line.insert.description, learningRules);
      if (learned) line.insert = { ...line.insert, category: learned };
    }
    for (const line of lines) {
      const { data: dedRow, error: dedError } = await supabase
        .from('deductions')
        .insert({ ...line.insert, document_id: documentId })
        .select('id')
        .single();
      const savedDed = must('purchase-deduction-insert', dedRow, dedError, partial);
      // EQUIPMENT AUTO-POPULATE (owner decision, SIMPLIFICATION PASS, item
      // 7) — a store/Amazon purchase line item landing in a durable-goods
      // category (tools, electronics, sleeper comfort items, safety gear)
      // also gets a linked Equipment row, the same "one item, two views"
      // pattern as the settlement-deductions path above.
      await maybeLinkEquipment(
        {
          id: savedDed.id,
          category: (line.insert.category as string | null) ?? null,
          description: (line.insert.description as string | null) ?? null,
          amount: Number(line.insert.amount ?? 0),
          ded_date: (line.insert.ded_date as string | null) ?? null,
          store: (line.insert.store as string | null) ?? null,
        },
        userId,
        partial
      );
      // CLAUDE.md invariant #2: a personal-payment purchase only becomes an
      // id-linked capital contribution once the caller has confirmed it
      // with the user (once per receipt) — see confirmOwnerContribution()
      // in app/(tabs)/import/index.tsx.
      if (line.isPersonalPayment && createContribution) {
        const contributionNote = `${(line.insert.description ?? 'Deduction').split(' — ')[0]} — paid personally (${line.insert.payment_method ?? ''})`;
        const { error: contribError } = await supabase.from('capital_transactions').insert({
          user_id: userId,
          tx_type: 'contribution',
          amount: line.insert.amount,
          // IMPORT SAVE BUG FIX (owner decision 2026-08-05, device
          // report): `d.date` is optional/loosely-typed AI text — a
          // present-but-empty '' used to bypass `??` (which only treats
          // null/undefined as absent) straight into this NOT NULL date
          // column, reproducing Postgres's "invalid input syntax for
          // type date: \"\"". toDateOrNull() normalizes '' to null first
          // so the real fallback actually fires.
          tx_date: toDateOrNull(d.date) ?? new Date().toISOString().slice(0, 10),
          note: contributionNote,
          linked_deduction_id: savedDed.id,
        });
        if (contribError) throw new SaveExtractionError('capital-transaction-insert', contribError, partial);
        contributionTotal += line.insert.amount;
      }
    }
  } else if (d.docType === 'loan_agreement') {
    // ASSET PURCHASE & FINANCING (owner decision 2026-07-30, PRODUCT
    // DECISION): the loan is created in Loan Center unconditionally —
    // asset linking (truck/trailer/equipment.loan_id + financing='loan')
    // only happens when assetName cleanly matches exactly one existing
    // asset (resolveLoanAssetMatch() — never a forced picker, same "bonus,
    // not a blocker" spirit as the rest of this docType).
    const loanRow = mapLoanAgreement(d, userId);
    const { data: insertedLoanRow, error: loanInsertError } = await supabase.from('loans').insert(loanRow).select('id').single();
    const insertedLoan = must('loan-agreement-insert', insertedLoanRow, loanInsertError, partial);

    // STALE-REFERENCE AUDIT (owner decision) — a retired truck's
    // unit_number must not be matchable by a NEW loan-agreement document,
    // same "a retired/deleted entity must vanish from every auto-match"
    // rule fixed for drivers in the import screen. Equipment has no
    // active/retired concept of its own, so no equivalent filter applies
    // there.
    const [trucksRes, equipmentRes] = await Promise.all([
      supabase.from('trucks').select('id, unit_number, trailer_unit_number').eq('user_id', userId).eq('is_active', true),
      supabase.from('equipment').select('id, name').eq('user_id', userId),
    ]);
    const lookupError = trucksRes.error ?? equipmentRes.error;
    if (lookupError) throw new SaveExtractionError('asset-link-lookup', lookupError, partial);
    const match = resolveLoanAssetMatch(
      d.loanAgreement?.assetType,
      d.loanAgreement?.assetName,
      (trucksRes.data ?? []) as { id: string; unit_number: string | null; trailer_unit_number: string | null }[],
      (equipmentRes.data ?? []) as { id: string; name: string }[]
    );
    if (match.kind === 'truck') {
      const { error } = await supabase.from('trucks').update({ financing: 'loan', loan_id: insertedLoan.id }).eq('id', match.truckId);
      if (error) throw new SaveExtractionError('asset-link-update', error, partial);
    } else if (match.kind === 'trailer') {
      const { error } = await supabase
        .from('trucks')
        .update({ trailer_financing: 'loan', trailer_loan_id: insertedLoan.id })
        .eq('id', match.truckId);
      if (error) throw new SaveExtractionError('asset-link-update', error, partial);
    } else if (match.kind === 'equipment') {
      const { error } = await supabase.from('equipment').update({ financing: 'loan', loan_id: insertedLoan.id }).eq('id', match.equipmentId);
      if (error) throw new SaveExtractionError('asset-link-update', error, partial);
    }
  } else if (d.docType !== 'w2' && d.docType !== 'government_or_misc_income') {
    // Generic fallback (toll/loan/other) — legacy's actual saveImport()
    // else-branch behavior, not the richer routing DTYPES hints at.
    const row = mapGenericDeduction(d, userId, categoryOverride);
    // A learned rule never overrides an explicit categoryOverride (the
    // NEEDS-REVIEW confirm flow, CLAUDE.md invariant #14) — that's an
    // even more explicit, just-given signal than a past correction.
    if (!categoryOverride) {
      const learned = matchLearnedCategory(row.description, learningRules);
      if (learned) row.category = learned;
    }
    const { data: genericDedRow, error } = await supabase
      .from('deductions')
      .insert({ ...row, document_id: documentId })
      .select('id')
      .single();
    if (error) throw new SaveExtractionError('generic-deduction-insert', error, partial);
    // EQUIPMENT AUTO-POPULATE (owner decision, SIMPLIFICATION PASS, item
    // 7) — the generic fallback can still land in a durable-goods category
    // (guessCategory()'s own classification, or a user-confirmed
    // categoryOverride from the NEEDS-REVIEW flow), so it gets the same
    // treatment as every other deduction-insert call site.
    if (genericDedRow) {
      await maybeLinkEquipment(
        {
          id: genericDedRow.id as string,
          category: (row.category as string | null) ?? null,
          description: (row.description as string | null) ?? null,
          amount: Number(row.amount ?? 0),
          ded_date: (row.ded_date as string | null) ?? null,
          store: (row as { store?: string | null }).store ?? null,
        },
        userId,
        partial
      );
    }
  }
  // d.docType === 'w2' / 'government_or_misc_income': document saved above,
  // no financial row created — both are INCOME with no dedicated ledger yet
  // (see mapExtraction.ts's mapGenericDeduction comment; universal AI
  // capture, owner decision 2026-07-10 — v1.x backlog, PROMPTS.md).

  return { documentId, storagePath, contributionTotal, settlementWeekEnding, isSettlementReimport, skippedRows };
}
