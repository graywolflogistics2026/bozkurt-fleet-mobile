// CASH FLOW FORECAST — PERIODIC/ANNUAL LAYER (owner decision, "build it
// from the user's own data" pass). Bucket 3 of the classifier: a big,
// infrequent bill (HVUT 2290, IRP/plates renewal, an insurance policy
// renewal, an annual DOT inspection) is real, dated, and KNOWN in advance
// — it should land in the exact week it's due, not get smeared into a
// "recurring fixed" weekly average (which would either wildly overstate
// every other week or, worse, get excluded as a one-off and vanish from
// the forecast entirely even though its date is sitting right there in
// Documents & Renewals).
import type { ComplianceItem, DocumentRow } from '@/src/types/db';

// Only these four compliance types are genuinely periodic BILLS with a
// real cash-flow impact on a predictable date — CLAUDE.md invariant #4's
// medical_card/CDL/drug_consortium are personal compliance items with no
// comparable lump-sum business cost, and ifta_filing/'other' have no
// reliable amount signal at all; ANY of the four below is still shown
// even with no dollar figure on file (see `amount: null` below) — never
// silently dropped for lack of a number.
const PERIODIC_TYPES: ComplianceItem['type'][] = ['hvut_2290', 'irp_registration', 'insurance_policy', 'annual_inspection'];

export type PeriodicForecastItem = {
  id: string;
  type: ComplianceItem['type'];
  label: string;
  dueDate: string;
  // The real amount from the document that created/last updated this
  // compliance item (documents.amount, an AI-extracted or manually-typed
  // figure) when one exists — NEVER a guessed/estimated figure. `null`
  // means genuinely unknown; the UI must offer to enter it, not invent
  // one (HONESTY requirement — never show a number with no basis).
  amount: number | null;
  amountSource: 'document' | null;
};

// `documentAmounts`: a lookup the caller builds once from whatever
// documents are already loaded (documents.id -> documents.amount) — this
// module has no data-fetching of its own, same "pure function over
// already-fetched data" convention as every other stats module in this
// app.
export function buildPeriodicForecastItems(
  complianceItems: Pick<ComplianceItem, 'id' | 'type' | 'label' | 'due_date' | 'source_document_id'>[],
  documentAmounts: Map<string, number>,
  today: Date,
  windowDays = 30
): PeriodicForecastItem[] {
  const todayIso = today.toISOString().slice(0, 10);
  const endIso = new Date(today.getTime() + windowDays * 86400000).toISOString().slice(0, 10);

  return complianceItems
    .filter((c) => PERIODIC_TYPES.includes(c.type) && c.due_date >= todayIso && c.due_date <= endIso)
    .map((c) => {
      const amount = c.source_document_id ? documentAmounts.get(c.source_document_id) ?? null : null;
      return {
        id: c.id,
        type: c.type,
        label: c.label,
        dueDate: c.due_date,
        amount,
        amountSource: amount != null ? ('document' as const) : null,
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// The one shared builder for the documentAmounts lookup, so every caller
// (the screen, tests) constructs it the exact same way — only documents
// with a real, positive amount are included, matching the "never invent
// a number" rule (a $0 or missing amount is the same as "unknown" here).
export function buildDocumentAmountLookup(documents: Pick<DocumentRow, 'id' | 'amount'>[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of documents) {
    if (d.amount) map.set(d.id, Number(d.amount));
  }
  return map;
}
