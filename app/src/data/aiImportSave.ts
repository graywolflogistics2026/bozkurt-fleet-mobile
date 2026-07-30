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
  mapMaintenance,
  mapPurchase,
  mapSettlement,
} from '@/src/import/mapExtraction';
import type { ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';
import { getPrimaryExtractionDate } from '@/src/import/dateGuard';

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
  let query = supabase.from('settlements').select('id').eq('user_id', userId).eq('week_ending', weekEnding);
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
  netPayAdded: number | null;
  contributionTotal: number;
};

// Writes rows exactly like legacy saveImport() (legacy/index.html:2502) —
// see app/src/import/mapExtraction.ts for the per-docType field mapping,
// ported verbatim from that function. This is the impure orchestration
// layer: wires foreign keys from just-created parent rows (settlement id,
// document id) into the pure mapping output, then performs the actual
// Supabase writes.
export async function saveExtraction(params: SaveExtractionParams): Promise<SaveExtractionResult> {
  const { extraction: d, userId, truckId, driverId, driverShareAmount, fileUri, fileExt, mediaType, createContribution, categoryOverride } = params;

  // 1. Upload the original file to the documents bucket FIRST (CLAUDE.md
  // storage convention: {user_id}/{month}/...) so the documents row can
  // reference its real storage_path.
  let storagePath: string | null = null;
  if (fileUri) {
    storagePath = buildStoragePath(userId, d, fileExt);
    const bytes = await new File(fileUri).bytes();
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, bytes, { contentType: mediaType, upsert: true });
    if (uploadError) throw uploadError;
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
  if (docError) throw docError;
  const documentId = docRow.id as string;

  let netPayAdded: number | null = null;
  let contributionTotal = 0;

  if (d.docType === 'settlement' && d.settlement) {
    const mapping = mapSettlement(d, userId, truckId, driverId);

    // A week_ending we can't pin down must never silently fall back to an
    // empty-string match key — two different weeks that both failed to
    // extract a date would otherwise collide on '' and replace each other
    // (the exact "second import replaces the first" bug this guards
    // against). The import preview's date field (CLAUDE.md DATE HARDENING
    // round 2) already requires the user to see/edit this value, so an
    // empty one here means it was left blank, not a legitimate settlement.
    if (!mapping.settlement.week_ending) {
      throw new Error('This settlement has no week-ending date. Please set the document date before saving.');
    }

    // Web v2026.07.09-A re-import-replace: importing the same
    // (week_ending, truck) again REPLACES that week's batch-tagged rows
    // instead of duplicating them — scoped by truck_id too (bug fix
    // 2026-07-30) so two different trucks paid for the same week never
    // collide. Matched via findExistingSettlement(), the same helper the
    // import preview uses for its "already imported" banner, so the two
    // can never disagree. An explicit select-then-update-or-insert (not a
    // Postgres upsert/onConflict) — the match key includes a nullable
    // truck_id, which onConflict's column-list inference can't express.
    const existingSett = await findExistingSettlement(userId, mapping.settlement.week_ending, truckId);
    const isReimport = !!existingSett;

    let settlementId: string;
    if (isReimport) {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .update({ ...mapping.settlement, document_id: documentId })
        .eq('id', existingSett!.id)
        .select('id')
        .single();
      if (settError) throw settError;
      settlementId = settRow.id as string;
    } else {
      const { data: settRow, error: settError } = await supabase
        .from('settlements')
        .insert({ ...mapping.settlement, document_id: documentId })
        .select('id')
        .single();
      if (settError) throw settError;
      settlementId = settRow.id as string;
    }

    if (isReimport) {
      // Clear this week's previously-imported batch-tagged rows first —
      // settlement, loads, fuel, reimbursements, withheld deductions
      // (CLAUDE.md invariant #10). Maintenance/tolls/loans are NOT part of
      // this replace — they're left as-is, matching the web app's scope.
      const { error: delLoadsErr } = await supabase.from('loads').delete().eq('settlement_id', settlementId);
      if (delLoadsErr) throw delLoadsErr;
      const { error: delFuelErr } = await supabase.from('fuel_purchases').delete().eq('settlement_id', settlementId);
      if (delFuelErr) throw delFuelErr;
      const { error: delReimbErr } = await supabase.from('reimbursements').delete().eq('settlement_id', settlementId);
      if (delReimbErr) throw delReimbErr;
      const { error: delDedErr } = await supabase
        .from('deductions')
        .delete()
        .eq('settlement_id', settlementId)
        .eq('source', 'settlement');
      if (delDedErr) throw delDedErr;
      // Driver compensation types (owner decision 2026-07-10): a re-import
      // replaces the prior split payment for this settlement same as every
      // other batch-tagged row (CLAUDE.md invariant #10) — otherwise
      // re-confirming a changed split would duplicate the payment record.
      const { error: delPayErr } = await supabase.from('driver_payments').delete().eq('settlement_id', settlementId);
      if (delPayErr) throw delPayErr;
    }

    if (mapping.loads.length > 0) {
      const { error } = await supabase
        .from('loads')
        .insert(mapping.loads.map((l) => ({ ...l, settlement_id: settlementId })));
      if (error) throw error;
    }
    if (mapping.fuel.length > 0) {
      const { error } = await supabase
        .from('fuel_purchases')
        .insert(mapping.fuel.map((f) => ({ ...f, settlement_id: settlementId })));
      if (error) throw error;
    }
    if (mapping.deductions.length > 0) {
      const { error } = await supabase
        .from('deductions')
        .insert(mapping.deductions.map((x) => ({ ...x, settlement_id: settlementId, document_id: documentId })));
      if (error) throw error;
    }
    if (mapping.reimbursements.length > 0) {
      const { error } = await supabase
        .from('reimbursements')
        .insert(mapping.reimbursements.map((r) => ({ ...r, settlement_id: settlementId })));
      if (error) throw error;
    }
    if (mapping.maintenance.length > 0) {
      const { error } = await supabase
        .from('maintenance_records')
        .insert(mapping.maintenance.map((m) => ({ ...m, document_id: documentId })));
      if (error) throw error;
    }
    if (mapping.tolls.length > 0) {
      const { error } = await supabase.from('tolls').insert(mapping.tolls);
      if (error) throw error;
    }
    for (const loan of mapping.loans) {
      if (!loan.name) continue;
      const { data: existingLoan } = await supabase
        .from('loans')
        .select('id')
        .eq('user_id', userId)
        .eq('name', loan.name)
        .maybeSingle();
      if (existingLoan) {
        await supabase.from('loans').update(loan).eq('id', existingLoan.id);
      } else {
        await supabase.from('loans').insert(loan);
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
      if (payErr) throw payErr;
    }
    // Net pay only credits business_balance once per settlement week — a
    // replace-import must not re-credit it a second time.
    if (mapping.netPay > 0 && !isReimport) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_balance')
        .eq('user_id', userId)
        .maybeSingle();
      const newBalance = Number(profile?.business_balance ?? 0) + mapping.netPay;
      await supabase.from('profiles').update({ business_balance: newBalance }).eq('user_id', userId);
      netPayAdded = mapping.netPay;
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const row = mapFuel(d, userId, truckId);
    const { error } = await supabase.from('fuel_purchases').insert(row);
    if (error) throw error;
  } else if (d.docType === 'driver_payment') {
    // Universal AI capture (owner decision 2026-07-10): driver_payments.
    // driver_id is NOT NULL — the import screen forces a driver pick for
    // this docType before Save is even enabled (needsDriverPicker), so
    // driverId being null here would be a UI bug, not a legitimate state.
    if (!driverId) throw new Error('A driver must be selected to save a driver payment.');
    const row = mapDriverPayment(d, userId, driverId);
    const { error } = await supabase.from('driver_payments').insert(row);
    if (error) throw error;
  } else if ((FINANCIAL_DOC_TYPES as readonly string[]).includes(d.docType) && d.financialDoc) {
    // insurance/lease_rent/factoring_statement/utility_subscription — real
    // out-of-pocket business expenses, routed like any other deduction.
    const row = mapFinancialDocDeduction(d, userId);
    const { error } = await supabase.from('deductions').insert({ ...row, document_id: documentId });
    if (error) throw error;
  } else if ((COMPLIANCE_DOC_TYPES as readonly string[]).includes(d.docType)) {
    // AI feature package (owner decision 2026-07-10) — find-or-update by
    // (user_id, type): a re-scanned renewal replaces the old due date on
    // the SAME row rather than piling up duplicate compliance items.
    const row = mapCompliance(d, userId);
    if (row) {
      const { data: existing } = await supabase
        .from('compliance_items')
        .select('id')
        .eq('user_id', userId)
        .eq('type', row.type)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from('compliance_items')
          .update({ label: row.label, due_date: row.due_date, source_document_id: documentId })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('compliance_items')
          .insert({ ...row, source_document_id: documentId });
        if (error) throw error;
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
    if (error) throw error;
    if (reimbursement) {
      await supabase.from('reimbursements').insert(reimbursement);
    }
  } else if ((d.docType === 'amazon' || d.docType === 'store') && d.purchase) {
    const lines = mapPurchase(d, userId);
    for (const line of lines) {
      const { data: dedRow, error } = await supabase
        .from('deductions')
        .insert({ ...line.insert, document_id: documentId })
        .select('id')
        .single();
      if (error) throw error;
      // CLAUDE.md invariant #2: a personal-payment purchase only becomes an
      // id-linked capital contribution once the caller has confirmed it
      // with the user (once per receipt) — see confirmOwnerContribution()
      // in app/(tabs)/import/index.tsx.
      if (line.isPersonalPayment && createContribution) {
        const contributionNote = `${(line.insert.description ?? 'Deduction').split(' — ')[0]} — paid personally (${line.insert.payment_method ?? ''})`;
        await supabase.from('capital_transactions').insert({
          user_id: userId,
          tx_type: 'contribution',
          amount: line.insert.amount,
          tx_date: d.date ?? new Date().toISOString().slice(0, 10),
          note: contributionNote,
          linked_deduction_id: dedRow.id,
        });
        contributionTotal += line.insert.amount;
      }
    }
  } else if (d.docType !== 'w2' && d.docType !== 'government_or_misc_income') {
    // Generic fallback (toll/loan/other) — legacy's actual saveImport()
    // else-branch behavior, not the richer routing DTYPES hints at.
    const row = mapGenericDeduction(d, userId, categoryOverride);
    const { error } = await supabase.from('deductions').insert({ ...row, document_id: documentId });
    if (error) throw error;
  }
  // d.docType === 'w2' / 'government_or_misc_income': document saved above,
  // no financial row created — both are INCOME with no dedicated ledger yet
  // (see mapExtraction.ts's mapGenericDeduction comment; universal AI
  // capture, owner decision 2026-07-10 — v1.x backlog, PROMPTS.md).

  return { documentId, storagePath, netPayAdded, contributionTotal };
}
