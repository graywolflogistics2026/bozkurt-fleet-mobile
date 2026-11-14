// supabase/functions/ai-import/statementColumns.ts — one reply's operating
// statement columns {label, weeks, ytd, ltd} -> the WEEKS shape the app
// reads. Used by extractOnePass() (the direct path and the reader's
// general reading). Kept from chunking.ts, whose page-by-page merging went
// with the old reader (removed 2026-11-13, commit 6).
//
// ZERO Deno APIs and ZERO imports, so the app's Jest suite can load it
// (app/src/import/__tests__/statementColumns.test.ts).

// Amount-like strings ("1,884.73", "$.37-", "(12.50)") as numbers, for
// conflict comparison only — the merged value itself is kept as printed.
function amountOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /-\s*$/.test(t) || /^-/.test(t);
  const digits = t.replace(/[()$,\s-]/g, '');
  if (!/^\d*\.?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const normLabel = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() : '');

// STATEMENT COLUMNS (owner decision 2026-11-03, R2; device finding: values
// slipped from WEEKS TOTAL into the YTD/LTD columns). The model returns
// every statement line, TOTAL line and recap line as {label, weeks, ytd,
// ltd}, each column as printed or null (blank = null, a trailing minus =
// negative), and fills no weekTotal* / payout scalar itself. This turns
// one reply into the shape the app reads: a line's amount is its WEEKS
// figure; a line with a null WEEKS is not counted (dropped); every
// weekTotal* scalar is 0 (the app takes block totals from totalLines by
// label); the payout, balance forward, miles and YTD fields come only from
// the recap/TOTAL line of their own printed label. A reply in the older
// shape (lines with `amount`) is returned unchanged.
export type ColumnLine = { section?: string; label?: string; weeks?: unknown; ytd?: unknown; ltd?: unknown; page?: number };
const OLD_WEEK_SCALARS = [
  'weekMiles', 'weekTotalFreightRevenue', 'weekTotalOtherRevenue', 'weekTotalRevenue', 'weekTotalFuelOilTax', 'weekTotalRepair',
  'weekTotalTires', 'weekTotalMiscellaneous', 'weekTotalVariableCosts', 'weekTotalOutOfPocket', 'weekTotalFixedCost',
  'weekTotalOtherIncomeAndExpense', 'weekTotalOperatingExpenses', 'weekTotalStatement', 'priorWeekBalanceForward', 'weekTotalCashFlow',
  'settlementToOperator', 'directDeposit', 'ytdTotalRevenue', 'ytdMiles', 'ytdTotalStatement', 'ytdSettlementToOperator', 'perfBondEmergencyFundYtd',
] as const;
const RECAP_MILES = /^MILES$/;
const RECAP_BALANCE_FORWARD = /^PRIOR WEEK BALANCE FORWARD$/;
const RECAP_SETTLEMENT_TO_OPERATOR = /^SETTLEMENT TO OPERATOR$/;
const RECAP_PAYOUT = /\bDIRECT DEPOSIT\b|\bLOADED ON CARD\b|^AMOUNT LOADED\b|^SETTLEMENT GROSS DUE\b/;
const RECAP_PERF_BOND = /^PERF(ORMANCE)? BD\b|^PERF(ORMANCE)? BOND\b.*\bEM(ER|ERGENCY|GCY)\b/;

const columnOf = (v: unknown): number | null => amountOf(v);
const isColumnShape = (list: unknown) =>
  Array.isArray(list) && list.some((l) => l && typeof l === 'object' && ('weeks' in (l as object) || 'ytd' in (l as object)));

export function normalizeStatementColumns(extraction: unknown): unknown {
  const e = extraction as Record<string, unknown> | null;
  const s = e?.settlement as Record<string, unknown> | undefined;
  const op = s?.operating as Record<string, unknown> | undefined;
  if (!e || !s || !op || typeof op !== 'object') return extraction;
  if (!isColumnShape(op.lines) && !isColumnShape(op.totalLines) && !isColumnShape(op.recapLines)) return extraction;
  const columns = (l: ColumnLine) => ({ weeks: columnOf(l.weeks), ytd: columnOf(l.ytd), ltd: columnOf(l.ltd) });
  const counted = (list: unknown, withSection: boolean) =>
    (Array.isArray(list) ? (list as ColumnLine[]) : [])
      .filter((l) => l && typeof l === 'object')
      .map((l) => ({ ...l, ...columns(l) }))
      .filter((l) => l.weeks != null)
      .map((l) => ({ ...(withSection ? { section: l.section ?? '' } : {}), label: l.label ?? '', amount: l.weeks as number, weeks: l.weeks, ytd: l.ytd, ltd: l.ltd, ...(Number.isInteger(l.page) ? { page: l.page } : {}) }));
  const recap = (Array.isArray(op.recapLines) ? (op.recapLines as ColumnLine[]) : []).filter((l) => l && typeof l === 'object').map((l) => ({ ...l, ...columns(l) }));
  const totals = (Array.isArray(op.totalLines) ? (op.totalLines as ColumnLine[]) : []).filter((l) => l && typeof l === 'object').map((l) => ({ ...l, ...columns(l) }));
  const find = (list: (ColumnLine & { weeks: number | null; ytd: number | null })[], re: RegExp) => list.find((l) => re.test(normLabel(l.label)));
  const out: Record<string, unknown> = { ...op, lines: counted(op.lines, true), totalLines: counted(op.totalLines, false), recapLines: recap };
  for (const k of OLD_WEEK_SCALARS) out[k] = 0;
  const miles = find(recap, RECAP_MILES);
  if (miles?.weeks != null) out.weekMiles = miles.weeks;
  if (miles?.ytd != null) out.ytdMiles = miles.ytd;
  const bf = find(recap, RECAP_BALANCE_FORWARD);
  if (bf?.weeks != null) out.priorWeekBalanceForward = bf.weeks;
  const sto = find(recap, RECAP_SETTLEMENT_TO_OPERATOR);
  if (sto?.weeks != null) out.settlementToOperator = sto.weeks;
  if (sto?.ytd != null) out.ytdSettlementToOperator = sto.ytd;
  out.settlementToOperatorLabel = sto ? String(sto.label ?? '').trim() : '';
  const payout = find(recap, RECAP_PAYOUT);
  if (payout?.weeks != null) out.directDeposit = payout.weeks;
  out.directDepositLabel = payout ? String(payout.label ?? '').trim() : '';
  const bond = find(recap, RECAP_PERF_BOND);
  if (bond?.ytd != null) out.perfBondEmergencyFundYtd = bond.ytd;
  const revenue = find(totals, /^TOTAL REVENUE$/);
  if (revenue?.ytd != null) out.ytdTotalRevenue = revenue.ytd;
  const statement = find(totals, /^TOTAL STATEMENT\b/);
  if (statement?.ytd != null) out.ytdTotalStatement = statement.ytd;
  return { ...e, settlement: { ...s, operating: out } };
}
