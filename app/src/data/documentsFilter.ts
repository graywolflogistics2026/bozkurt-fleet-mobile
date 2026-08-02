import type {
  BankStatement,
  ComplianceItem,
  Deduction,
  DocumentRow,
  HouseholdIncome,
  MaintenanceRecord,
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
  | 'household_income';

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
};

// "View linked records" (item 2 of the Documents Archive spec) — every
// table a document can route to via document_id/source_document_id
// (CLAUDE.md's D3 audit trail note lists exactly these). Deliberately does
// NOT include fuel_purchases/loads/reimbursements/driver_payments/tolls/
// loans, none of which carry a document_id column of their own (a
// settlement's fuel/loads are reached by first jumping to ITS settlement).
export function findLinkedRecords(documentId: string, sources: LinkedRecordSources): LinkedRecordRef[] {
  const refs: LinkedRecordRef[] = [];

  for (const s of sources.settlements ?? []) {
    if (s.document_id === documentId) refs.push({ kind: 'settlement', id: s.id, label: `Settlement — W/E ${s.week_ending}` });
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

  return refs;
}
