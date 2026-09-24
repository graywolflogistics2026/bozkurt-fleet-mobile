// UX MEGA-PASS item E (owner decision 2026-07-31, device evidence: a
// document's title/label must reflect the actual store or document
// subject, e.g. "Walmart", not the raw docType label "Store/Amazon
// Purchase"). `documents.parsed_json` always holds the FULL raw
// Extraction (CLAUDE.md's D3 audit trail, aiImportSave.ts) regardless of
// docType, and `Extraction.vendor` is populated by the AI-import prompt
// for any document that names a vendor/store/shop on its face — not just
// purchase receipts. Falls back to the docType's own i18n label
// (docTypeMeta) whenever no vendor was extracted, which is the previous
// (and still correct) behavior for docTypes that never carry a vendor
// name at all (e.g. a bank statement).
export function deriveDocumentTitle(parsedJson: Record<string, unknown> | null | undefined, fallbackLabel: string): string {
  const vendor = parsedJson?.vendor;
  if (typeof vendor === 'string' && vendor.trim().length > 0) return vendor.trim();
  return fallbackLabel;
}

// DOCUMENT TITLES (owner decision 2026-09-23, docs/PENDING_SQL.md §76).
// A document gets a real stored `title`:
//   - on import: the AI's own suggested `title` (ai-import prompt), or, if
//     it didn't return one, one built from what it extracted
//     (buildTitleFromExtraction) — title_source 'ai'
//   - for a historical document, from the "Needs a title" review queue:
//     a linked record's own confirmed data FIRST (buildTitleFromLinkedRecords,
//     title_source 'record'), then the extraction — only when the user
//     accepts it
//   - a user rename — title_source 'user' — which NO automatic pass ever
//     overwrites (shouldApplyAutoTitle)
// Every user-facing word comes in through TitleContext (i18n), so nothing
// here hardcodes a language.

export type TitleSource = 'ai' | 'record' | 'user';

export type TitleContext = {
  // docTypes.<docType>.label, e.g. "Fuel Receipt", "Settlement"
  kindLabel: (docType: string) => string;
  // e.g. "W/E 7/17"
  weekEnding: (shortDate: string) => string;
  // e.g. "Fuel Additives receipt"
  receiptFor: (category: string) => string;
  // e.g. "7/14" (locale-aware month/day)
  shortDate: (isoDate: string) => string;
};

type TitledDocument = {
  title?: string | null;
  title_source?: TitleSource | null;
  parsed_json: Record<string, unknown> | null;
  doc_date: string | null;
  imported_at: string;
};

const MAX_TITLE_LENGTH = 80;

export function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_TITLE_LENGTH ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : collapsed;
}

// "PRIME INC" -> "Prime Inc"; leaves already mixed-case text alone.
function tidyName(value: string): string {
  const trimmed = value.trim();
  if (trimmed !== trimmed.toUpperCase() || !/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isIsoDate(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function joinTitle(kind: string, subject: string | null, when: string | null): string {
  if (subject && when) return `${kind} — ${subject}, ${when}`;
  if (subject) return `${kind} — ${subject}`;
  if (when) return `${kind} — ${when}`;
  return kind;
}

// Title from an extraction (a fresh import, or a stored parsed_json).
// Returns null when there is nothing more specific than the bare docType
// label — that's still "generic".
export function buildTitleFromExtraction(parsed: Record<string, unknown> | null | undefined, ctx: TitleContext): string | null {
  if (!parsed) return null;
  const aiTitle = cleanTitle(parsed.title);
  if (aiTitle) return aiTitle;

  const docType = str(parsed.docType) ?? 'other';
  const kind = ctx.kindLabel(docType);

  if (docType === 'settlement') {
    const settlement = (parsed.settlement ?? {}) as Record<string, unknown>;
    const weekEnding = str(settlement.weekEnding) ?? str(parsed.date);
    const carrier = str(settlement.carrier);
    if (!isIsoDate(weekEnding) && !carrier) return null;
    const head = carrier ? `${tidyName(carrier)} ${kind}` : kind;
    return cleanTitle(isIsoDate(weekEnding) ? `${head} — ${ctx.weekEnding(ctx.shortDate(weekEnding))}` : head);
  }

  const fuel = (parsed.fuel ?? {}) as Record<string, unknown>;
  const maintenance = (parsed.maintenance ?? {}) as Record<string, unknown>;
  const purchase = (parsed.purchase ?? {}) as Record<string, unknown>;
  const firstItem = Array.isArray(purchase.items) ? ((purchase.items[0] ?? {}) as Record<string, unknown>) : {};
  const rawSubject =
    str(parsed.vendor) ?? str(fuel.station) ?? str(maintenance.shop) ?? str(maintenance.description) ?? str(firstItem.name);
  const subject = rawSubject && rawSubject !== 'Unknown Store' ? tidyName(rawSubject) : null;
  const date = str(parsed.date);
  const when = isIsoDate(date) ? ctx.shortDate(date) : null;
  if (!subject && !when) return null;
  return cleanTitle(joinTitle(kind, subject, when));
}

// A linked record's own, already-confirmed data (owner item 4) — preferred
// over re-reading the document. Only unambiguous links produce a title: a
// document tied to several deductions (a multi-item store receipt) says
// little per row, so that case falls through to the extraction.
export type LinkedTitleInputs = {
  settlement?: { week_ending: string | null; carrier?: string | null } | null;
  deductions?: Array<{ category: string | null; description: string | null; ded_date: string | null }>;
  maintenance?: { description: string | null; service_type?: string | null; service_date: string | null } | null;
  complianceLabel?: string | null;
  // A receipt attached on the "For Prime Inc Drivers" screen.
  primeDriverExpense?: { category: string | null; exp_date: string | null } | null;
};

export function buildTitleFromLinkedRecords(linked: LinkedTitleInputs, ctx: TitleContext): string | null {
  if (linked.settlement) {
    const { week_ending, carrier } = linked.settlement;
    const kind = ctx.kindLabel('settlement');
    const head = carrier ? `${tidyName(carrier)} ${kind}` : kind;
    return cleanTitle(isIsoDate(week_ending) ? `${head} — ${ctx.weekEnding(ctx.shortDate(week_ending))}` : head);
  }
  if (linked.maintenance) {
    const m = linked.maintenance;
    const subject = str(m.description) ?? str(m.service_type);
    return cleanTitle(joinTitle(ctx.kindLabel('maintenance'), subject, isIsoDate(m.service_date) ? ctx.shortDate(m.service_date) : null));
  }
  if (linked.deductions && linked.deductions.length === 1) {
    const d = linked.deductions[0];
    const category = str(d.category);
    const when = isIsoDate(d.ded_date) ? ctx.shortDate(d.ded_date) : null;
    if (category) return cleanTitle(when ? `${ctx.receiptFor(category)} — ${when}` : ctx.receiptFor(category));
    const description = str(d.description);
    if (description) return cleanTitle(joinTitle(ctx.kindLabel('other'), description, when));
  }
  const compliance = cleanTitle(linked.complianceLabel);
  if (compliance) return compliance;
  if (linked.primeDriverExpense) {
    const p = linked.primeDriverExpense;
    const category = str(p.category);
    const when = isIsoDate(p.exp_date) ? ctx.shortDate(p.exp_date) : null;
    if (category) return cleanTitle(when ? `${ctx.receiptFor(category)} — ${when}` : ctx.receiptFor(category));
  }
  return null;
}

// Gathers a document's linked records (by document_id — same links the
// Documents viewer's own findLinkedRecords() uses) into title inputs.
export type LinkedTitleSources = {
  settlements?: Array<{ document_id: string | null; week_ending: string | null; carrier?: string | null }>;
  deductions?: Array<{ document_id: string | null; category: string | null; description: string | null; ded_date: string | null }>;
  maintenanceRecords?: Array<{ document_id: string | null; description: string | null; service_type?: string | null; service_date: string | null }>;
  complianceItems?: Array<{ source_document_id: string | null; label: string }>;
  primeDriverExpenses?: Array<{ document_id: string | null; category: string | null; exp_date: string | null }>;
};

export function linkedTitleInputsFor(documentId: string, sources: LinkedTitleSources): LinkedTitleInputs {
  return {
    settlement: (sources.settlements ?? []).find((s) => s.document_id === documentId) ?? null,
    deductions: (sources.deductions ?? []).filter((d) => d.document_id === documentId),
    maintenance: (sources.maintenanceRecords ?? []).find((m) => m.document_id === documentId) ?? null,
    complianceLabel: (sources.complianceItems ?? []).find((c) => c.source_document_id === documentId)?.label ?? null,
    primeDriverExpense: (sources.primeDriverExpenses ?? []).find((p) => p.document_id === documentId) ?? null,
  };
}

// Record first (item 4), then the extraction.
export function suggestDocumentTitle(
  doc: Pick<TitledDocument, 'parsed_json'>,
  linked: LinkedTitleInputs,
  ctx: TitleContext
): { title: string; source: TitleSource } | null {
  const fromRecord = buildTitleFromLinkedRecords(linked, ctx);
  if (fromRecord) return { title: fromRecord, source: 'record' };
  const fromExtraction = buildTitleFromExtraction(doc.parsed_json, ctx);
  if (fromExtraction) return { title: fromExtraction, source: 'ai' };
  return null;
}

// The ONE place any screen gets a document's display title.
export function displayDocumentTitle(doc: Pick<TitledDocument, 'title' | 'parsed_json'>, fallbackLabel: string): string {
  return cleanTitle(doc.title) ?? deriveDocumentTitle(doc.parsed_json, fallbackLabel);
}

// THE TITLE A DOCUMENT SHOWS — on its list row AND at the top of its detail
// view (owner decision 2026-09-23, "the list itself must show the meaningful
// title immediately"). Computed at render time, nothing is written:
//   1. the saved title (the user's rename, or the one saved at import)
//   2. a linked record's own confirmed data (settlement, single deduction,
//      maintenance, compliance item, For Prime Inc Drivers expense)
//   3. the stored extraction (the AI's title, or one built from it)
//   4. the vendor, 5. the docType label ("Document")
// Before this, only (1), (4) and (5) were ever shown, so every document
// imported before §76 was applied, and every receipt attached from
// Deductions/Compliance/For Prime Inc Drivers (never titled at upload),
// showed "Document" or a bare vendor in the list.
export function resolveDocumentTitle(
  doc: Pick<TitledDocument, 'title' | 'parsed_json'>,
  linked: LinkedTitleInputs,
  ctx: TitleContext,
  fallbackLabel: string
): string {
  const saved = cleanTitle(doc.title);
  if (saved) return saved;
  const suggestion = suggestDocumentTitle(doc, linked, ctx);
  if (suggestion) return suggestion.title;
  return deriveDocumentTitle(doc.parsed_json, fallbackLabel);
}

// A user's own rename is never overwritten by an automatic pass.
export function shouldApplyAutoTitle(doc: Pick<TitledDocument, 'title_source'>): boolean {
  return doc.title_source !== 'user';
}

// "Needs a title" review: every document with no SAVED title, newest first.
// Its list row may already show a computed title (resolveDocumentTitle());
// the review is where the user confirms it (saved) or types their own.
export function isGenericallyTitled(doc: Pick<TitledDocument, 'title'>): boolean {
  return !cleanTitle(doc.title);
}

export function findDocumentsNeedingTitle<T extends TitledDocument>(docs: T[]): T[] {
  const sortKey = (d: T) => d.doc_date ?? (d.imported_at ?? '').slice(0, 10);
  return docs
    .filter(isGenericallyTitled)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || (b.imported_at ?? '').localeCompare(a.imported_at ?? ''));
}
