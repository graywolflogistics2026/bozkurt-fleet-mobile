// ORIGIN RULE, OWN-EXPENSE LAYER (owner 2026-11-13). ONE definition, used by
// computeKpis() (Home, Settlements explainer, Profit, Accountant Package
// profit note) AND by the "For Prime Inc Drivers" sheet, so the two can
// never disagree about what is "your own expense".
//
// A row a settlement import created (source 'settlement') belongs to that
// settlement. One that has lost its settlement link is an orphan of an
// import: its settlement (statement or lines) already counts it, so it
// never enters the own-expense layer. A row is from a settlement import
// when its source is 'settlement', or when its document is a settlement's
// own document (the same import saved it, whatever its source says).
// Zero React/Supabase imports: pure, unit-testable.

export type OriginRow = { source?: string | null; settlement_id?: string | null; document_id?: string | null };

export function isOrphanSettlementRow(r: OriginRow, settlementDocIds?: ReadonlySet<string>): boolean {
  if (r.settlement_id) return false;
  if (r.source === 'settlement') return true;
  return !!r.document_id && !!settlementDocIds?.has(r.document_id);
}

// The own-expense layer: not linked to a settlement and not an orphan of a
// settlement import. Exactly the rows computeKpis() lists as "your own
// expenses".
export function isOwnExpenseRow(r: OriginRow, settlementDocIds?: ReadonlySet<string>): boolean {
  return !r.settlement_id && !isOrphanSettlementRow(r, settlementDocIds);
}

export function settlementDocumentIds(settlements: ReadonlyArray<{ document_id?: string | null }>): Set<string> {
  return new Set(settlements.map((s) => s.document_id).filter((id): id is string => !!id));
}
