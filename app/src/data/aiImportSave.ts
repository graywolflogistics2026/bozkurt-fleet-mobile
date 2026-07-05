import { File } from 'expo-file-system';
import { supabase } from '@/src/lib/supabase';
import { buildStoragePath } from '@/src/import/storagePath';
import { mapFuel, mapGenericDeduction, mapMaintenance, mapPurchase, mapSettlement } from '@/src/import/mapExtraction';
import type { ExistingDocSummary } from '@/src/import/duplicateCheck';
import type { Extraction } from '@/src/import/types';

export async function fetchExistingDocsForDuplicateCheck(userId: string): Promise<ExistingDocSummary[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('filename, doc_date, doc_type, amount, imported_at')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as ExistingDocSummary[];
}

export type SaveExtractionParams = {
  extraction: Extraction;
  userId: string;
  truckId: string | null;
  fileUri: string | null;
  fileExt: string;
  mediaType: string;
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
  const { extraction: d, userId, truckId, fileUri, fileExt, mediaType } = params;

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
      doc_date: d.date ?? null,
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
    const mapping = mapSettlement(d, userId, truckId);

    const { data: settRow, error: settError } = await supabase
      .from('settlements')
      .upsert({ ...mapping.settlement, document_id: documentId }, { onConflict: 'user_id,week_ending' })
      .select('id')
      .single();
    if (settError) throw settError;
    const settlementId = settRow.id as string;

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
    if (mapping.netPay > 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_balance')
        .eq('user_id', userId)
        .maybeSingle();
      const newBalance = Number(profile?.business_balance ?? 60000) + mapping.netPay;
      await supabase.from('profiles').update({ business_balance: newBalance }).eq('user_id', userId);
      netPayAdded = mapping.netPay;
    }
  } else if (d.docType === 'fuel' && d.fuel) {
    const row = mapFuel(d, userId, truckId);
    const { error } = await supabase.from('fuel_purchases').insert(row);
    if (error) throw error;
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
      // CLAUDE.md invariant #2: personal-payment purchases always
      // create/update an id-linked capital contribution.
      if (line.isPersonalPayment) {
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
  } else if (d.docType !== 'w2') {
    // Generic fallback (toll/loan/other) — legacy's actual saveImport()
    // else-branch behavior, not the richer routing DTYPES hints at.
    const row = mapGenericDeduction(d, userId);
    const { error } = await supabase.from('deductions').insert({ ...row, document_id: documentId });
    if (error) throw error;
  }
  // d.docType === 'w2': document saved above, no financial row created
  // (see mapExtraction.ts's mapGenericDeduction comment — a W-2 is income,
  // not an expense, and there's no household_income UI yet to attach it to).

  return { documentId, storagePath, netPayAdded, contributionTotal };
}
