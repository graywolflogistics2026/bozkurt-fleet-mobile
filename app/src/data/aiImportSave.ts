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
} from '@/src/import/mapExtraction';
import { resolveLoanAssetMatch } from '@/src/import/loanAssetMatch';
import type { ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';
import { getPrimaryExtractionDate } from '@/src/import/dateGuard';
import {
  SaveExtractionError,
  emptyPartialState,
  type SaveExtractionPartialState,
  type SaveExtractionStep,
} from '@/src/data/saveExtractionError';

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
): Promise<{ id: string; business_balance_credit: number | null } | null> {
  if (!weekEnding) return null;
  let query = supabase
    .from('settlements')
    .select('id, business_balance_credit')
    .eq('user_id', userId)
    .eq('week_ending', weekEnding);
  query = truckId ? query.eq('truck_id', truckId) : query.is('truck_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as { id: string; business_balance_credit: number | null } | null) ?? null;
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
  // The amount actually applied to profiles.business_balance by THIS save
  // — null when nothing changed (delta 0). For a brand-new settlement this
  // is always >= 0 (matches the old "netPayAdded" meaning exactly); for a
  // re-import with a CORRECTED net pay (owner decision 2026-08-02) this can
  // be negative (the corrected net pay was lower than what was originally
  // credited) — the UI must not assume a positive number.
  netPayAdded: number | null;
  contributionTotal: number;
  // Settlement week-ending confirmation (owner decision 2026-07-30): lets
  // the "Saved" screen tell the user plainly whether this was a brand-new
  // week or a replace of an existing one — null/false for every non-
  // settlement docType.
  settlementWeekEnding: string | null;
  isSettlementReimport: boolean;
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

// Writes rows exactly like legacy saveImport() (legacy/index.html:2502) —
// see app/src/import/mapExtraction.ts for the per-docType field mapping,
// ported verbatim from that function. This is the impure orchestration
// layer: wires foreign keys from just-created parent rows (settlement id,
// document id) into the pure mapping output, then performs the actual
// Supabase writes.
export async function saveExtraction(params: SaveExtractionParams): Promise<SaveExtractionResult> {
  const { extraction: d, userId, truckId, driverId, driverShareAmount, fileUri, fileExt, mediaType, createContribution, categoryOverride } = params;

  const partial: SaveExtractionPartialState = emptyPartialState();

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
      amount: d.totalAmount ?? null,
      storage_path: storagePath,
      parsed_json: d as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();
  const documentId = must('documents-insert', docRow, docError, partial).id as string;
  partial.documentId = documentId;

  let netPayAdded: number | null = null;
  let contributionTotal = 0;
  let settlementWeekEnding: string | null = null;
  let isSettlementReimport = false;

  if (d.docType === 'settlement' && d.settlement) {
    const mapping = settlementMapping!;

    // Web v2026.07.09-A re-import-replace: importing the same
    // (week_ending, truck) again REPLACES that week's batch-tagged rows
    // instead of duplicating them — scoped by truck_id too (bug fix
    // 2026-07-30) so two different trucks paid for the same week never
    // collide. Matched via findExistingSettlement(), the same helper the
    // import preview uses for its "already imported" banner, so the two
    // can never disagree. An explicit select-then-update-or-insert (not a
    // Postgres upsert/onConflict) — the match key includes a nullable
    // truck_id, which onConflict's column-list inference can't express.
    let existingSett: { id: string; business_balance_credit: number | null } | null;
    try {
      existingSett = await findExistingSettlement(userId, mapping.settlement.week_ending, truckId);
    } catch (err) {
      throw new SaveExtractionError('settlements-lookup', err, partial);
    }
    const isReimport = !!existingSett;
    settlementWeekEnding = mapping.settlement.week_ending;
    isSettlementReimport = isReimport;

    // BUSINESS BALANCE ON RE-IMPORT (pre-launch hardening, owner decision
    // 2026-08-02): a re-import used to credit nothing at all, leaving the
    // balance wrong after a corrected net pay. Every save now applies the
    // DELTA between what this settlement SHOULD have credited
    // (newCredit) and what it actually credited last time (previousCredit,
    // read from the row's own business_balance_credit — 0 for a brand-new
    // settlement, so this is one formula for both new and re-imports).
    //
    // NEGATIVE SETTLEMENTS (owner decision 2026-08-02, verified against a
    // real statement: W/E 2026-07-24, 0 miles, $5.16 revenue, $1,160.51
    // deductions, net -$1,155.35 — the owner OWES the carrier that week):
    // newCredit used to clamp a negative netPay to 0, so a losing week
    // silently left business_balance untouched instead of decreasing it
    // by what's actually owed. A losing week is real money leaving the
    // business the same as a positive week is real money entering it —
    // newCredit is now the SIGNED net pay, uncapped in either direction,
    // and business_balance is allowed to go negative (no DB check
    // constraint enforces >= 0 — see docs/SCHEMA.sql).
    const previousCredit = isReimport ? Number(existingSett!.business_balance_credit ?? 0) : 0;
    const newCredit = mapping.netPay;
    const balanceDelta = newCredit - previousCredit;

    let settlementId: string;
    if (isReimport) {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .update({ ...mapping.settlement, document_id: documentId, business_balance_credit: newCredit })
        .eq('id', existingSett!.id)
        .select('id')
        .single();
      settlementId = must('settlements-save', settRow, settError, partial).id as string;
    } else {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .insert({ ...mapping.settlement, document_id: documentId, business_balance_credit: newCredit })
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
    if (isReimport) {
      const [loadsOld, fuelOld, reimbOld, dedOld, payOld] = await Promise.all([
        supabase.from('loads').select('id').eq('settlement_id', settlementId),
        supabase.from('fuel_purchases').select('id').eq('settlement_id', settlementId),
        supabase.from('reimbursements').select('id').eq('settlement_id', settlementId),
        supabase.from('deductions').select('id').eq('settlement_id', settlementId).eq('source', 'settlement'),
        supabase.from('driver_payments').select('id').eq('settlement_id', settlementId),
      ]);
      const firstError = [loadsOld, fuelOld, reimbOld, dedOld, payOld].find((r) => r.error)?.error;
      if (firstError) throw new SaveExtractionError('reimport-lookup', firstError, partial);
      oldLoadIds = (loadsOld.data ?? []).map((r) => r.id as string);
      oldFuelIds = (fuelOld.data ?? []).map((r) => r.id as string);
      oldReimbIds = (reimbOld.data ?? []).map((r) => r.id as string);
      oldDedIds = (dedOld.data ?? []).map((r) => r.id as string);
      oldPayIds = (payOld.data ?? []).map((r) => r.id as string);
    }

    if (mapping.loads.length > 0) {
      const { error } = await supabase
        .from('loads')
        .insert(mapping.loads.map((l) => ({ ...l, settlement_id: settlementId })));
      if (error) throw new SaveExtractionError('loads-insert', error, partial);
    }
    if (mapping.fuel.length > 0) {
      const { error } = await supabase
        .from('fuel_purchases')
        .insert(mapping.fuel.map((f) => ({ ...f, settlement_id: settlementId })));
      if (error) throw new SaveExtractionError('fuel-insert', error, partial);
    }
    if (mapping.deductions.length > 0) {
      const { error } = await supabase
        .from('deductions')
        .insert(mapping.deductions.map((x) => ({ ...x, settlement_id: settlementId, document_id: documentId })));
      if (error) throw new SaveExtractionError('deductions-insert', error, partial);
    }
    if (mapping.reimbursements.length > 0) {
      const { error } = await supabase
        .from('reimbursements')
        .insert(mapping.reimbursements.map((r) => ({ ...r, settlement_id: settlementId })));
      if (error) throw new SaveExtractionError('reimbursements-insert', error, partial);
    }
    if (mapping.maintenance.length > 0) {
      const { error } = await supabase
        .from('maintenance_records')
        .insert(mapping.maintenance.map((m) => ({ ...m, document_id: documentId })));
      if (error) throw new SaveExtractionError('maintenance-insert', error, partial);
    }
    if (mapping.tolls.length > 0) {
      const { error } = await supabase.from('tolls').insert(mapping.tolls);
      if (error) throw new SaveExtractionError('tolls-insert', error, partial);
    }
    // Loans upsert — PRE-LAUNCH ERROR-VISIBILITY FIX (owner decision
    // 2026-08-02): this loop previously never checked ANY of these three
    // calls' `error` field (including the lookup select), so a loan
    // save/update failure was completely silent — the import would report
    // success while a loan row silently failed to save/update.
    for (const loan of mapping.loans) {
      if (!loan.name) continue;
      const { data: existingLoan, error: lookupError } = await supabase
        .from('loans')
        .select('id')
        .eq('user_id', userId)
        .eq('name', loan.name)
        .maybeSingle();
      if (lookupError) throw new SaveExtractionError('loans-upsert', lookupError, partial);
      if (existingLoan) {
        const { error } = await supabase.from('loans').update(loan).eq('id', existingLoan.id);
        if (error) throw new SaveExtractionError('loans-upsert', error, partial);
      } else {
        const { error } = await supabase.from('loans').insert(loan);
        if (error) throw new SaveExtractionError('loans-upsert', error, partial);
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
    partial.oldRowsCleanedUp = true;

    // Business balance: one atomic SQL increment (apply_business_balance_delta,
    // docs/SCHEMA.sql / PENDING_SQL.md §37/§38) instead of a client-side
    // select-then-update — never a race, and correct on both a brand-new
    // settlement (previousCredit 0) and a re-import (delta only). §38
    // (owner decision 2026-08-02) made the RPC itself raise a genuine
    // Postgres error if it ever updates ZERO rows (a mismatched
    // p_user_id/auth.uid(), or a missing profiles row) instead of silently
    // returning NULL — the old version would report "success" here while
    // never actually touching the balance.
    if (balanceDelta !== 0) {
      const { error: balErr } = await supabase.rpc('apply_business_balance_delta', {
        p_user_id: userId,
        p_delta: balanceDelta,
      });
      if (balErr) throw new SaveExtractionError('balance-update', balErr, partial);
      netPayAdded = balanceDelta;
    }
    partial.balanceUpdated = true;
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
      const { data: dedRow, error: dedError } = await supabase
        .from('deductions')
        .insert({ ...line.insert, document_id: documentId })
        .select('id')
        .single();
      const savedDed = must('purchase-deduction-insert', dedRow, dedError, partial);
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
          tx_date: d.date ?? new Date().toISOString().slice(0, 10),
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

    const [trucksRes, equipmentRes] = await Promise.all([
      supabase.from('trucks').select('id, unit_number, trailer_unit_number').eq('user_id', userId),
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
    const { error } = await supabase.from('deductions').insert({ ...row, document_id: documentId });
    if (error) throw new SaveExtractionError('generic-deduction-insert', error, partial);
  }
  // d.docType === 'w2' / 'government_or_misc_income': document saved above,
  // no financial row created — both are INCOME with no dedicated ledger yet
  // (see mapExtraction.ts's mapGenericDeduction comment; universal AI
  // capture, owner decision 2026-07-10 — v1.x backlog, PROMPTS.md).

  return { documentId, storagePath, netPayAdded, contributionTotal, settlementWeekEnding, isSettlementReimport };
}
