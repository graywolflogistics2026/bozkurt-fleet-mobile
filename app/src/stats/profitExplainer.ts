import type { LedgerReason } from '@/src/stats/statementRoute';
import type { LedgerRow, LedgerTable } from '@/src/stats/auditLedger';
import type { SettlementVerification } from '@/src/import/settlementStatement';
import { daysBetweenDateOnly, isDateOnly } from '@/src/lib/dateOnly';

// PROFIT EXPLAINER (owner decision 2026-10-30, master plan batch D item 8):
// "my own expenses vs Prime's numbers", in three layers for the window and
// scope computeKpis() was given —
//   (A) profit per your settlements: computeKpis() over the settlement-
//       linked rows only, with the weakest week label in the window;
//   (B) your own expenses: every row with no settlement link that counts
//       (Σ counted − Σ offset of the audit ledger's unlinked rows), plus a
//       muted list of the unlinked rows NOT counted and why;
//   (C) the canonical profit (computeKpis().net).
// A − B must equal C to the cent; anything else is an "Unexplained
// difference" (needs review), never hidden. A gap caused only by own
// expenses is neutral information; amber is only for a real mismatch
// between Prime-derived figures and Prime's printed numbers (bridge
// crossChecks, which are built from settlement-linked rows only — own
// expenses can never raise one). ONE function, every screen.

export type ExplainerCase = 'none' | 'ownExpenses' | 'primeMatch' | 'extractionMismatch' | 'unexplained';
export type ExplainerTone = 'neutral' | 'info' | 'warning';
export type SettlementsLabel = SettlementVerification | null;

export type OwnExpenseRow = {
  key: string;
  table: LedgerTable;
  rowId: string | null;
  date: string | null;
  label: string;
  category: string | null;
  // + an expense, − an offset (discount credit, reimbursement).
  amount: number;
};

export type NotCountedRow = {
  key: string;
  table: LedgerTable;
  rowId: string | null;
  date: string | null;
  label: string;
  category: string | null;
  amount: number;
  reason: LedgerReason;
};

export type WithheldLine = {
  table: 'deductions' | 'fuel_purchases';
  id: string;
  date: string | null;
  amount: number;
  category: string | null;
  label: string;
  settlementId: string | null;
};

export type PossibleDuplicate = { own: OwnExpenseRow; withheld: WithheldLine };

export type ProfitExplanation = {
  case: ExplainerCase;
  tone: ExplainerTone;
  settlementsProfit: number;
  settlementsLabel: SettlementsLabel;
  ownExpenses: { total: number; count: number; rows: OwnExpenseRow[] };
  notCounted: NotCountedRow[];
  profit: number;
  // A − B − C, rounded to the cent; 0 when everything is explained.
  residual: number;
  possibleDuplicates: PossibleDuplicate[];
  mismatchWeeks: number;
};

const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
};

// The weakest label among the window's weeks (Unverified < Totals match <
// Verified); null with no settlement in the window.
export function weakestLabel(labels: SettlementVerification[]): SettlementsLabel {
  if (labels.length === 0) return null;
  if (labels.includes('unverified')) return 'unverified';
  if (labels.includes('totals_match')) return 'totals_match';
  return 'verified_prime';
}

const DUPLICATE_DAYS = 3;
const DUPLICATE_CENTS = 1;

function categoryGroup(table: LedgerTable | WithheldLine['table'], category: string | null): string {
  if (table === 'fuel_purchases') return 'fuel';
  if (table === 'maintenance_records') return 'maintenance';
  if (table === 'tolls') return 'tolls';
  const c = (category ?? '').toLowerCase();
  if (/fuel|\bdef\b/.test(c)) return 'fuel';
  if (/maint|repair/.test(c)) return 'maintenance';
  if (/toll|scale/.test(c)) return 'tolls';
  return c;
}

// "Possible duplicate: keep / remove" — an own row that looks like a
// settlement-withheld line: same amount (to the cent), within about 3 days,
// similar category. Flagged, never dropped; a row the owner already chose
// to keep (`keptKeys`, "<table>:<id>") is not flagged again.
export function findPossibleDuplicates(own: OwnExpenseRow[], withheld: WithheldLine[], keptKeys: ReadonlySet<string>): PossibleDuplicate[] {
  const out: PossibleDuplicate[] = [];
  for (const row of own) {
    if (row.amount <= 0 || row.table === 'reimbursements' || row.table === 'statement') continue;
    if (row.rowId && keptKeys.has(`${row.table}:${row.rowId}`)) continue;
    const group = categoryGroup(row.table, row.category);
    const match = withheld.find(
      (w) =>
        Math.abs(Math.round(w.amount * 100) - Math.round(row.amount * 100)) <= DUPLICATE_CENTS &&
        !!w.date &&
        !!row.date &&
        isDateOnly(w.date) &&
        isDateOnly(row.date) &&
        Math.abs(daysBetweenDateOnly(w.date, row.date)) <= DUPLICATE_DAYS &&
        group !== '' &&
        categoryGroup(w.table, w.category) === group
    );
    if (match) out.push({ own: row, withheld: match });
  }
  return out;
}

export function buildProfitExplanation(args: {
  settlementsProfit: number;
  labels: SettlementVerification[];
  ledger: LedgerRow[];
  profit: number;
  mismatchWeeks: number;
  withheld: WithheldLine[];
  keptKeys: ReadonlySet<string>;
}): ProfitExplanation {
  const unlinked = args.ledger.filter((r) => r.source !== 'prime_statement' && !r.settlementId);
  const ownRows: OwnExpenseRow[] = unlinked
    .filter((r) => r.status !== 'excluded')
    .map((r) => ({
      key: r.key,
      table: r.table,
      rowId: r.rowId,
      date: r.date,
      label: r.label,
      category: r.category,
      amount: r.status === 'offset' ? -r.amount : r.amount,
    }));
  const notCounted: NotCountedRow[] = unlinked
    .filter((r) => r.status === 'excluded')
    .map((r) => ({ key: r.key, table: r.table, rowId: r.rowId, date: r.date, label: r.label, category: r.category, amount: r.amount, reason: r.reason }));
  const ownTotal = round2(ownRows.reduce((sum, r) => sum + r.amount, 0));
  const settlementsProfit = round2(args.settlementsProfit);
  const profit = round2(args.profit);
  const residual = round2(settlementsProfit - ownTotal - profit);
  const settlementsLabel = weakestLabel(args.labels);
  const possibleDuplicates = findPossibleDuplicates(ownRows, args.withheld, args.keptKeys);

  let kase: ExplainerCase = 'none';
  if (residual !== 0) kase = 'unexplained';
  else if (args.mismatchWeeks > 0) kase = 'extractionMismatch';
  else if (ownRows.length > 0) kase = 'ownExpenses';
  else if (settlementsLabel === 'verified_prime') kase = 'primeMatch';

  return {
    case: kase,
    tone: kase === 'unexplained' || kase === 'extractionMismatch' ? 'warning' : kase === 'none' ? 'neutral' : 'info',
    settlementsProfit,
    settlementsLabel,
    ownExpenses: { total: ownTotal, count: ownRows.length, rows: ownRows },
    notCounted,
    profit,
    residual,
    possibleDuplicates,
    mismatchWeeks: args.mismatchWeeks,
  };
}
