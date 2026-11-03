// PRINTED BLOCK TOTALS BY LABEL (owner decision 2026-11-03, week ending
// 2026-07-17 import loop). A block total is ONLY a line whose printed label
// starts with "TOTAL" (TOTAL MISCELLANEOUS, TOTAL FUEL,OIL,TAX, ...). A line
// labeled exactly "MISCELLANEOUS" inside the MISCELLANEOUS block is a
// regular line (Prime's NQ navigation charge, 6.50-), never the block total.
//
// The reading carries every printed TOTAL line in `operating.totalLines`
// ({label, amount}, signed as printed, from every page the statement spans —
// the page merge joins the lists). When that list is present, each
// `weekTotal*` value comes ONLY from the TOTAL line of its own name; a field
// with no TOTAL line is null (its check is skipped, never failed), whatever
// the model also put into the field. A reading from before this rule (no
// `totalLines`) keeps its fields, except a block total that is just a copy
// of the block's own same-named line (the 07/17 misread) — null.
import { normalizeStatementLabel, type StatementLine, type StatementSection } from './primeStatementLines';
import { parseAmount, printedTotal } from './amount';

export const STATEMENT_TOTAL_FIELDS = [
  'weekTotalFreightRevenue',
  'weekTotalOtherRevenue',
  'weekTotalRevenue',
  'weekTotalFuelOilTax',
  'weekTotalRepair',
  'weekTotalTires',
  'weekTotalMiscellaneous',
  'weekTotalVariableCosts',
  'weekTotalOutOfPocket',
  'weekTotalFixedCost',
  'weekTotalOtherIncomeAndExpense',
  'weekTotalOperatingExpenses',
  'weekTotalStatement',
  'weekTotalCashFlow',
] as const;
export type StatementTotalField = (typeof STATEMENT_TOTAL_FIELDS)[number];

// Normalized printed label (upper case, every non-letter/digit run one
// space) -> the field it fills. Every pattern starts with TOTAL.
const TOTAL_LABELS: [RegExp, StatementTotalField][] = [
  [/^TOTAL FREIGHT REVENUE$/, 'weekTotalFreightRevenue'],
  [/^TOTAL OTHER REVENUE$/, 'weekTotalOtherRevenue'],
  [/^TOTAL REVENUE$/, 'weekTotalRevenue'],
  [/^TOTAL FUEL OIL (AND )?TAX(ES)?$/, 'weekTotalFuelOilTax'],
  [/^TOTAL (EQUIPMENT )?REPAIR( AND MAINT(ENANCE)?)?$|^TOTAL EQUIPMENT REPAIR\b/, 'weekTotalRepair'],
  [/^TOTAL TIRES$/, 'weekTotalTires'],
  [/^TOTAL MISCELLANEOUS$/, 'weekTotalMiscellaneous'],
  [/^TOTAL VARIABLE COSTS?$/, 'weekTotalVariableCosts'],
  [/^TOTAL OUT OF POCKET( COSTS?)?$/, 'weekTotalOutOfPocket'],
  [/^TOTAL FIXED COSTS?$/, 'weekTotalFixedCost'],
  [/^TOTAL OTHER INCOME (AND )?EXPENSES?$/, 'weekTotalOtherIncomeAndExpense'],
  [/^TOTAL OPERATING EXPENSES?$/, 'weekTotalOperatingExpenses'],
  [/^TOTAL STATEMENT\b/, 'weekTotalStatement'],
  [/^TOTAL CASH FLOW$/, 'weekTotalCashFlow'],
];

export function totalFieldOfLabel(label: string | null | undefined): StatementTotalField | null {
  const l = normalizeStatementLabel(label ?? '');
  if (!/^TOTAL\b/.test(l)) return null;
  for (const [re, field] of TOTAL_LABELS) if (re.test(l)) return field;
  return null;
}

type TotalLine = { label?: string | null; amount?: number | string | null };
type OperatingTotals = Partial<Record<StatementTotalField, unknown>> & { totalLines?: TotalLine[] | null };

export type LabeledTotals = {
  // Per field: the printed value (a 0 counts as not printed, like every
  // other statement total), or null.
  values: Record<StatementTotalField, number | null>;
  // True when the reading carried TOTAL lines (the fields came from them).
  byLabel: boolean;
  // Two different amounts printed under the same TOTAL label.
  conflicts: { field: StatementTotalField; values: number[] }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const printed = (v: unknown): number | null => {
  const n = parseAmount(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

// The block whose own same-named line a legacy total may be a copy of.
const SAME_NAMED_LINE: Partial<Record<StatementTotalField, { section: StatementSection; label: string }>> = {
  weekTotalMiscellaneous: { section: 'misc', label: 'MISCELLANEOUS' },
  weekTotalTires: { section: 'tires', label: 'TIRES' },
  weekTotalOutOfPocket: { section: 'out_of_pocket', label: 'OUT OF POCKET COSTS' },
};

export function labeledStatementTotals(op: OperatingTotals | null | undefined, lines: StatementLine[]): LabeledTotals {
  const values = Object.fromEntries(STATEMENT_TOTAL_FIELDS.map((f) => [f, null])) as Record<StatementTotalField, number | null>;
  const conflicts: LabeledTotals['conflicts'] = [];
  const totalLines = Array.isArray(op?.totalLines) ? op!.totalLines! : null;
  if (totalLines && totalLines.length > 0) {
    const seen = new Map<StatementTotalField, number[]>();
    for (const t of totalLines) {
      const field = totalFieldOfLabel(t?.label);
      const amount = printed(t?.amount);
      if (!field || amount == null) continue;
      const list = seen.get(field) ?? [];
      if (!list.some((v) => Math.abs(v - amount) < 0.005)) list.push(r2(amount));
      seen.set(field, list);
    }
    for (const [field, list] of seen) {
      values[field] = list[0];
      if (list.length > 1) conflicts.push({ field, values: list });
    }
    return { values, byLabel: true, conflicts };
  }
  // Older reading: the fields as read, minus a copy of a same-named line.
  for (const field of STATEMENT_TOTAL_FIELDS) values[field] = printed(op?.[field]);
  for (const [field, own] of Object.entries(SAME_NAMED_LINE) as [StatementTotalField, { section: StatementSection; label: string }][]) {
    const v = values[field];
    if (v == null) continue;
    const block = lines.filter((l) => l.section === own.section);
    const copied = block.some((l) => normalizeStatementLabel(l.label) === own.label && Math.abs(l.amount - v) < 0.005);
    const sum = block.reduce((s, l) => s + l.amount, 0);
    if (copied && block.length > 1 && Math.abs(sum - v) >= 0.005) values[field] = null;
  }
  return { values, byLabel: false, conflicts };
}
