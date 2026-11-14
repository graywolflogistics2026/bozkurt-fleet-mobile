import { canonicalStatementLabel, type StatementLine } from '@/src/import/primeStatementLines';
import { isWithheldLumperAdvance } from '@/src/primeDriverExpenses/categoryMapping';

// LUMPERS THROUGH SETTLEMENT (owner 2026-11-13). The ONE thing from a Prime
// settlement that the "For Prime Inc Drivers" sheet and the Accountant
// Package show: per settlement, the lumper pay Prime paid in ("OUTSIDE
// LUMPER 1099 PAY", code LM) as +, the lumper advance Prime took back
// ("ADV FOR OUTSIDE LUMPER", code WA; statement line "LUMPERS") as −, and
// the difference (the wire fee). Grouped by the settlement's week-ending
// month. Shown in its own block, never added to a category subtotal or a
// grand total, so nothing counts twice: the owner's own lumper receipts
// stay in the own-expense rows, these stay here.
//
// Identified by the statement line table (canonicalStatementLabel — the
// existing Prime lumper rule) and by code + the existing withheld-lumper
// rule for saved rows; never by free text alone. Read-only: profit, the
// KPIs and the printed totals do not read this module.
//
// Sources, per settlement (null never beats a number):
//  - received: the statement's revenue line OUTSIDE LUMPER 1099 PAY. Lumper
//    revenue items are never saved as rows, so without a statement it is
//    null (unknown), never 0.
//  - deducted: the statement's LUMPERS line (printed with a minus) when the
//    statement has it; otherwise the settlement-linked withheld lumper
//    advance rows (code WA/LM). Null when neither exists.
// Carrier isolation: settlements whose recorded carrier is known and is not
// Prime are skipped. A re-import replaces the settlement row, so a week can
// never appear twice; a week saved once with a truck and once "not truck-
// specific" with identical lumper amounts is shown once.

export const LUMPER_PAY_LABEL = 'OUTSIDE LUMPER 1099 PAY';
export const LUMPER_ADVANCE_LABEL = 'LUMPERS';
const LUMPER_ADVANCE_CODES = new Set(['WA', 'LM']);

export type LumperSettlementSource = {
  id: string;
  week_ending: string | null;
  carrier?: string | null;
  truck_id?: string | null;
  statement?: { prime?: { lines?: StatementLine[] | null } | null } | null;
};

export type LumperDeductionSource = {
  settlement_id?: string | null;
  source: string | null;
  category?: string | null;
  description: string | null;
  amount: number | null;
  code?: string | null;
};

export type SettlementLumperLine = {
  settlementId: string;
  weekEnding: string;
  received: number | null;
  deducted: number | null;
  // received − deducted; null unless both are known.
  difference: number | null;
};

export type SettlementLumperMonth = {
  lines: SettlementLumperLine[];
  received: number;
  deducted: number;
  difference: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

function isPrimeOrUnknownCarrier(carrier: string | null | undefined): boolean {
  const c = (carrier ?? '').trim();
  return !c || /\bprime\b/i.test(c);
}

function statementSum(lines: StatementLine[] | null | undefined, label: string, section: StatementLine['section'] | null): number | null {
  if (!lines) return null;
  const hits = lines.filter((l) => (section == null || l.section === section) && canonicalStatementLabel(l.label) === label);
  if (hits.length === 0) return null;
  return cents(hits.reduce((s, l) => s + Number(l.amount ?? 0), 0));
}

export function isSettlementLumperAdvanceRow(d: LumperDeductionSource): boolean {
  if (!d.settlement_id) return false;
  const code = (d.code ?? '').trim().toUpperCase();
  if (code && !LUMPER_ADVANCE_CODES.has(code)) return false;
  return isWithheldLumperAdvance({ category: d.category ?? null, description: d.description, source: d.source });
}

export function buildSettlementLumperLines(
  settlements: LumperSettlementSource[],
  deductions: LumperDeductionSource[]
): SettlementLumperLine[] {
  const advanceRowsBySettlement = new Map<string, number>();
  for (const d of deductions) {
    if (!isSettlementLumperAdvanceRow(d)) continue;
    const id = d.settlement_id as string;
    advanceRowsBySettlement.set(id, cents((advanceRowsBySettlement.get(id) ?? 0) + Math.abs(Number(d.amount ?? 0))));
  }

  const out: (SettlementLumperLine & { truckId: string | null })[] = [];
  for (const s of settlements) {
    if (!s.week_ending || !isPrimeOrUnknownCarrier(s.carrier)) continue;
    const lines = s.statement?.prime?.lines ?? null;
    const received = statementSum(lines, LUMPER_PAY_LABEL, 'revenue');
    const printedAdvance = statementSum(lines, LUMPER_ADVANCE_LABEL, null);
    const deducted = printedAdvance != null ? cents(Math.abs(printedAdvance)) : advanceRowsBySettlement.get(s.id) ?? null;
    if (!received && !deducted) continue;
    out.push({
      settlementId: s.id,
      weekEnding: s.week_ending,
      received,
      deducted,
      difference: received != null && deducted != null ? cents(received - deducted) : null,
      truckId: s.truck_id ?? null,
    });
  }

  // A null-truck copy of a truck-assigned week with identical amounts is the
  // same document saved twice.
  const key = (l: SettlementLumperLine) => `${l.weekEnding}|${l.received ?? ''}|${l.deducted ?? ''}`;
  const truckAssigned = new Set(out.filter((l) => l.truckId != null).map(key));
  return out
    .filter((l) => l.truckId != null || !truckAssigned.has(key(l)))
    .map(({ truckId: _truckId, ...l }) => l)
    .sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
}

// month = null -> the whole year.
export function settlementLumpersFor(lines: SettlementLumperLine[], year: number, month: number | null): SettlementLumperMonth {
  const y = String(year);
  const m = month == null ? null : String(month).padStart(2, '0');
  const picked = lines.filter((l) => l.weekEnding.slice(0, 4) === y && (m == null || l.weekEnding.slice(5, 7) === m));
  const received = cents(picked.reduce((s, l) => s + (l.received ?? 0), 0));
  const deducted = cents(picked.reduce((s, l) => s + (l.deducted ?? 0), 0));
  return { lines: picked, received, deducted, difference: cents(received - deducted) };
}

// Shared by the sheet export and the Accountant Package export, so the two
// print the same block. Strings resolved by the caller (t()); pure.
export type SettlementLumperStrings = {
  title: string; // "Lumpers — through settlement"
  note: string; // "Paid and taken back by Prime. Not in the totals."
  received: string; // "Lumper pay received"
  deducted: string; // "Lumper advance deducted"
  difference: string; // "Difference (wire fee)"
  monthTotal: string; // "Total"
};

export function signedLumperAmounts(l: { received: number | null; deducted: number | null; difference: number | null }, money: (n: number) => string) {
  return {
    received: l.received == null ? '—' : `+${money(l.received)}`,
    deducted: l.deducted == null ? '—' : `−${money(l.deducted)}`,
    difference: l.difference == null ? '—' : money(l.difference),
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Three-column rows (date | label | amount) for an existing <table>.
export function settlementLumperRowsHtml(
  m: SettlementLumperMonth,
  strings: SettlementLumperStrings,
  fmt: { money: (n: number) => string; date: (iso: string) => string }
): string {
  if (m.lines.length === 0) return '';
  const row = (d: string, label: string, amt: string) => `<tr><td>${escHtml(d)}</td><td>${escHtml(label)}</td><td class="amt">${escHtml(amt)}</td></tr>`;
  const body = m.lines
    .map((l) => {
      const a = signedLumperAmounts(l, fmt.money);
      const d = fmt.date(l.weekEnding);
      return row(d, strings.received, a.received) + row(d, strings.deducted, a.deducted) + row(d, strings.difference, a.difference);
    })
    .join('');
  const total = signedLumperAmounts(m, fmt.money);
  return `<tr class="subtotal"><td colspan="3" class="cat-name">${escHtml(strings.title)}</td></tr>
    <tr><td colspan="3" class="empty">${escHtml(strings.note)}</td></tr>
    ${body}
    <tr class="subtotal"><td>${escHtml(strings.monthTotal)}</td><td>${escHtml(strings.received)} / ${escHtml(strings.deducted)} / ${escHtml(strings.difference)}</td><td class="amt">${escHtml(`${total.received} / ${total.deducted} / ${total.difference}`)}</td></tr>`;
}
