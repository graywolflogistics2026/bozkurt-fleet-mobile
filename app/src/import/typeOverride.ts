import type { DocType, Extraction } from '@/src/import/types';

// DOCUMENT TYPE CONFIRMATION AT REVIEW (owner decision) — the AI's own
// `docType` classification (one of 17 internal values, `types.ts`) is
// simplified here to the 7 buckets a user can actually reason about and
// choose between in the import preview: Settlement / Expense receipt /
// Fuel / Maintenance / Toll / Bank statement / Other. Every OTHER raw
// docType (loan/w2/driver_payment/insurance/lease_rent/
// factoring_statement/government_or_misc_income/utility_subscription/
// medical_card/inspection_report/registration_cab_card/
// irs_2290_schedule1/insurance_policy/loan_agreement) is deliberately
// folded into "Other" for this SIMPLIFIED selector's purposes — a full
// 17-way picker would defeat the point of a "clear selector," and every
// one of those types already saves correctly through its own existing
// path when the AI's OWN classification is accepted unchanged (this
// override only ever RUNS when the user actively picks a different
// bucket than the one already showing).
export type SimpleDocType = 'settlement' | 'expense_receipt' | 'fuel' | 'maintenance' | 'toll' | 'bank_statement' | 'other';

export const SIMPLE_DOC_TYPES: SimpleDocType[] = ['settlement', 'expense_receipt', 'fuel', 'maintenance', 'toll', 'bank_statement', 'other'];

// Where each simple bucket actually saves — TOLL and BANK STATEMENT are
// deliberately honest about a real, pre-existing gap: neither has a
// dedicated extraction shape or DB destination anywhere in the ai-import
// pipeline today ('toll' was already, silently, falling through to the
// generic-deduction save path before this feature existed — confirmed by
// reading aiImportSave.ts's own dispatch chain; there has never been a
// standalone `tolls`-table save path for an ai-import doc, only for a
// settlement's own itemized toll section). Bank/credit-card statements
// have NO ai-import docType at all (CLAUDE.md's own NAV SIMPLIFICATION /
// FEATURE FLAGS entry: the ONLY import path for those two entities is the
// separate legacy-backup JSON importer). Building either a real toll
// ledger destination or a real bank-statement extraction shape is a much
// larger, unrequested feature — out of scope here. Selecting either of
// these two options routes through docType 'other' (archived, saved as a
// NEEDS-REVIEW deduction, CLAUDE.md invariant #14) — exactly what already
// happens for 'toll' today, now visible and user-controlled instead of a
// silent fallback.
const SIMPLE_TO_DOC_TYPE: Record<SimpleDocType, DocType> = {
  settlement: 'settlement',
  expense_receipt: 'store',
  fuel: 'fuel',
  maintenance: 'maintenance',
  toll: 'other',
  bank_statement: 'other',
  other: 'other',
};

export function simpleDocTypeToDocType(simple: SimpleDocType): DocType {
  return SIMPLE_TO_DOC_TYPE[simple];
}

// The selector's PREFILLED starting value — the AI's own raw classification,
// collapsed into the closest of the 7 buckets. Never itself a save-time
// decision; purely a display default the user can immediately override.
export function docTypeToSimpleDocType(docType: DocType): SimpleDocType {
  switch (docType) {
    case 'settlement':
      return 'settlement';
    case 'fuel':
      return 'fuel';
    case 'maintenance':
      return 'maintenance';
    case 'amazon':
    case 'store':
      return 'expense_receipt';
    default:
      return 'other';
  }
}

// Best-available value for a common field, checked across every sub-object
// a prior classification might have populated — never just the top-level
// field alone, since a settlement/maintenance/fuel extraction routinely
// carries its own amount/date/vendor nested one level down rather than at
// the top. This is the literal mechanism behind "keeping what applies":
// nothing here is invented, only relocated to where the NEW target type's
// own mapper (mapExtraction.ts) actually reads from.
function bestVendor(d: Extraction): string | undefined {
  return d.vendor || d.settlement?.carrier || d.maintenance?.shop || d.fuel?.station || undefined;
}
function bestDate(d: Extraction): string | undefined {
  return d.date || d.settlement?.weekEnding || undefined;
}
function bestTotalAmount(d: Extraction): number | undefined {
  return (
    d.totalAmount ??
    d.settlement?.netPay ??
    d.settlement?.grossRevenue ??
    d.maintenance?.total ??
    d.fuel?.gross ??
    d.purchase?.total ??
    d.financialDoc?.amount ??
    undefined
  );
}
function bestSummary(d: Extraction): string | undefined {
  return d.summary || d.maintenance?.description || undefined;
}

// Re-maps `extraction` to `target`'s shape LIVE — called every time the
// user changes the type selector in the import preview, so the preview
// itself always reflects exactly what Save would do. Deliberately does
// NOT delete/clear the original sub-object the AI populated (settlement/
// fuel/maintenance/purchase/financialDoc) — only the target's own
// sub-object is ensured to exist (as at least `{}`, satisfying
// aiImportSave.ts's own truthy dispatch gates, e.g. `docType === 'fuel'
// && d.fuel`) and top-level vendor/date/totalAmount/summary are filled
// from whichever original field actually had the value, WITHOUT
// overwriting one that's already correct. Leaving the old sub-object in
// place is what makes switching the selector back and forth lossless —
// nothing is destroyed by trying a different type and changing your mind.
export function remapExtractionToSimpleType(extraction: Extraction, target: SimpleDocType): Extraction {
  const vendor = extraction.vendor ?? bestVendor(extraction);
  const date = extraction.date ?? bestDate(extraction);
  const totalAmount = extraction.totalAmount ?? bestTotalAmount(extraction);
  const summary = extraction.summary ?? bestSummary(extraction);

  const next: Extraction = {
    ...extraction,
    docType: simpleDocTypeToDocType(target),
    vendor,
    date,
    totalAmount,
    summary,
  };

  switch (target) {
    case 'fuel':
      next.fuel = extraction.fuel ?? { gross: totalAmount, station: vendor };
      break;
    case 'maintenance':
      next.maintenance = extraction.maintenance ?? { total: totalAmount, shop: vendor, description: summary };
      break;
    case 'expense_receipt':
      next.purchase = extraction.purchase ?? {};
      break;
    case 'settlement':
    case 'toll':
    case 'bank_statement':
    case 'other':
      // No new sub-object needed: settlement is only ever meaningful when
      // the extraction already carries real settlement data (never
      // synthesized from a receipt — there is no sane way to invent
      // week_ending/gross/net from unrelated fields); toll/bank_statement/
      // other all route through the SAME generic-deduction fallback
      // (mapGenericDeduction), which reads only the top-level fields
      // already populated above.
      break;
  }

  return next;
}
