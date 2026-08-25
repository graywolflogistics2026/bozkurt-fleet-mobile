import type {
  BankStatement,
  ComplianceItem,
  Deduction,
  DocumentRow,
  FuelPurchase,
  HouseholdIncome,
  Load,
  MaintenanceRecord,
  Reimbursement,
  Settlement,
} from '@/src/types/db';
import { isDocumentNeedsReview } from '@/src/import/needsReview';

// DOCUMENTS ARCHIVE (owner decision 2026-07-30): a chronological, user-
// facing view of every document ever imported (D3 audit trail —
// documents.parsed_json — made visible, not just stored). Pure list/
// filter logic lives here so it's unit-testable without any RN/Expo
// runtime, same split as every other src/<domain> pure module in this repo.

export type DocumentFilter = {
  search?: string;
  docType?: string | null; // null/undefined = all types
  dateFrom?: string | null; // YYYY-MM-DD, inclusive
  dateTo?: string | null; // YYYY-MM-DD, inclusive
  // BETA FEEDBACK ROUND 2: "Needs review only" toggle — a document whose
  // extraction confidence was low (src/import/needsReview.ts).
  needsReviewOnly?: boolean;
};

// A document's OWN date — doc_date when the AI extracted one, else the
// day it was imported (imported_at is always set, doc_date can be null
// for docTypes with no natural "document date", e.g. a loan/toll summary).
export function primaryDocumentDate(doc: DocumentRow): string {
  return doc.doc_date ?? doc.imported_at.slice(0, 10);
}

export function filterDocuments(docs: DocumentRow[], filter: DocumentFilter = {}): DocumentRow[] {
  const search = filter.search?.trim().toLowerCase();
  return docs
    .filter((doc) => {
      if (filter.docType && doc.doc_type !== filter.docType) return false;
      const docDate = primaryDocumentDate(doc);
      if (filter.dateFrom && docDate < filter.dateFrom) return false;
      if (filter.dateTo && docDate > filter.dateTo) return false;
      if (filter.needsReviewOnly && !isDocumentNeedsReview(doc)) return false;
      if (search) {
        const haystack = `${doc.filename ?? ''} ${doc.doc_type ?? ''} ${doc.amount ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => primaryDocumentDate(b).localeCompare(primaryDocumentDate(a)));
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

// Drives the viewer's "images inline, PDFs via the platform viewer" split
// (item 2 of the Documents Archive spec) — a plain extension check since
// storage_path/filename always carries the original extension (see
// storagePath.ts's buildStoragePath()), no MIME lookup needed.
export function isImageFilename(filename: string | null | undefined): boolean {
  return !!filename && IMAGE_EXT_RE.test(filename);
}

// Distinct doc_type values actually present, for building the filter pills —
// never a hardcoded list, so a document type nobody has imported yet doesn't
// clutter the filter row, and any new docType "just works" the moment one
// exists.
export function distinctDocTypes(docs: DocumentRow[]): string[] {
  return [...new Set(docs.map((d) => d.doc_type).filter((t): t is string => !!t))].sort();
}

export type LinkedRecordKind =
  | 'settlement'
  | 'deduction'
  | 'maintenance'
  | 'bank_statement'
  | 'compliance_item'
  | 'household_income'
  | 'fuel'
  | 'load'
  | 'reimbursement';

export type LinkedRecordRef = {
  kind: LinkedRecordKind;
  id: string;
  label: string;
};

export type LinkedRecordSources = {
  settlements?: Settlement[];
  deductions?: Deduction[];
  maintenanceRecords?: MaintenanceRecord[];
  bankStatements?: BankStatement[];
  complianceItems?: ComplianceItem[];
  householdIncome?: HouseholdIncome[];
  // PAYMENT + DESTINATION SUMMARY (owner decision 2026-08-24, device
  // testing round, item 2) — the 3 tables the prior version of this
  // function's own comment explicitly excluded, since none of them carries
  // a document_id of its own. Now traced via a two-hop lookup: find the
  // linked SETTLEMENT first (document_id, same as every other kind below),
  // then match these three by settlement_id — the only way to reach them
  // from a document at all (see aiImportSave.ts's own FK assignment
  // pattern). Optional/additive so every existing call site that doesn't
  // pass them keeps behaving exactly as before.
  fuelPurchases?: FuelPurchase[];
  loads?: Load[];
  reimbursements?: Reimbursement[];
};

// "View linked records" / destination summary (item 2 of the Documents
// Archive spec, extended 2026-08-24 for the PAYMENT + DESTINATION SUMMARY
// device-testing item) — every row a document's own import produced,
// across every table CLAUDE.md's D3 audit trail note covers. Tolls are
// the one remaining, honestly-flagged gap: the `tolls` table has neither
// a `document_id` NOR a `settlement_id` column in the current schema, so a
// settlement's own toll charges cannot be traced back to their source
// document at all yet — a future schema addition, not silently faked here.
//
// DOUBLE-COUNT GUARD: a settlement-withheld deduction already gets BOTH
// document_id AND settlement_id set at save time (aiImportSave.ts), so it
// is already fully captured by the plain document_id loop below — deductions
// are deliberately NOT re-matched by settlement_id a second time (unlike
// fuel/loads/reimbursements, which have no document_id of their own at all).
export function findLinkedRecords(documentId: string, sources: LinkedRecordSources): LinkedRecordRef[] {
  const refs: LinkedRecordRef[] = [];

  const linkedSettlementIds = new Set<string>();
  for (const s of sources.settlements ?? []) {
    if (s.document_id === documentId) {
      refs.push({ kind: 'settlement', id: s.id, label: `Settlement — W/E ${s.week_ending}` });
      linkedSettlementIds.add(s.id);
    }
  }
  for (const d of sources.deductions ?? []) {
    if (d.document_id === documentId) refs.push({ kind: 'deduction', id: d.id, label: d.description || d.category || 'Deduction' });
  }
  for (const m of sources.maintenanceRecords ?? []) {
    if (m.document_id === documentId) refs.push({ kind: 'maintenance', id: m.id, label: m.description || m.service_type || 'Maintenance record' });
  }
  for (const b of sources.bankStatements ?? []) {
    if (b.document_id === documentId) refs.push({ kind: 'bank_statement', id: b.id, label: b.statement_month || 'Bank statement' });
  }
  for (const c of sources.complianceItems ?? []) {
    if (c.source_document_id === documentId) refs.push({ kind: 'compliance_item', id: c.id, label: c.label });
  }
  for (const h of sources.householdIncome ?? []) {
    if (h.document_id === documentId) refs.push({ kind: 'household_income', id: h.id, label: `Household income — ${h.income_type.replace(/_/g, ' ')}` });
  }

  if (linkedSettlementIds.size > 0) {
    for (const f of sources.fuelPurchases ?? []) {
      if (f.settlement_id && linkedSettlementIds.has(f.settlement_id)) {
        refs.push({ kind: 'fuel', id: f.id, label: `Fuel — ${f.location || f.fuel_type}${f.amount != null ? ` — $${f.amount}` : ''}` });
      }
    }
    for (const l of sources.loads ?? []) {
      if (l.settlement_id && linkedSettlementIds.has(l.settlement_id)) {
        refs.push({ kind: 'load', id: l.id, label: `Load — ${l.origin ?? '?'} → ${l.destination ?? '?'}` });
      }
    }
    for (const r of sources.reimbursements ?? []) {
      if (r.settlement_id && linkedSettlementIds.has(r.settlement_id)) {
        refs.push({ kind: 'reimbursement', id: r.id, label: r.description || 'Reimbursement' });
      }
    }
  }

  return refs;
}

// PAYMENT + DESTINATION SUMMARY (item 2) — collapses findLinkedRecords()'s
// individual refs into the "3 fuel entries, 12 deductions, 2 loads, 1
// maintenance record" count summary shown at the bottom of a settlement/
// document detail view. Pure so it's directly testable against a fixed
// list of refs without needing the sources map again.
export function summarizeLinkedRecordCounts(refs: LinkedRecordRef[]): Partial<Record<LinkedRecordKind, number>> {
  const counts: Partial<Record<LinkedRecordKind, number>> = {};
  for (const ref of refs) {
    counts[ref.kind] = (counts[ref.kind] ?? 0) + 1;
  }
  return counts;
}
