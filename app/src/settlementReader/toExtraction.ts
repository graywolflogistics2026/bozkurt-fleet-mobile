// COPY -> CONTRACT (owner decision 2026-11-13, P2). Turns the model's
// printed copy (schema.ts ContentReading) into the one Extraction the app
// already reads (docs/decisions/settlement-data-contract.md), so the gate,
// the card, the save and the statement route stay exactly as they are.
// Every decision about what a printed figure means is made HERE, by label:
//   - settlement totals only from their own labeled summary row;
//   - statement block totals only from rows whose label starts with TOTAL;
//   - a statement row's block: its Prime template label, else the block of
//     the next TOTAL row printed after it (a new label such as DETENTION
//     stays in the block it is printed in);
//   - a blank WEEKS cell is not counted (never 0), whatever YTD says;
//   - MILES, WEEKS IN SERVICE, the balance forward, SETTLEMENT TO OPERATOR
//     and the payout row are information rows, never dollars of a block.
// Pure: no I/O.
import { parseAmount } from '@/src/import/amount';
import { PRIME_TEMPLATE } from '@/src/import/primeStatementTemplate';
import { canonicalStatementLabel, normalizeStatementLabel, statementInfoRow, type StatementSection } from '@/src/import/primeStatementLines';
import { totalFieldOfLabel, type StatementTotalField } from '@/src/import/statementTotalLabels';
import type { Extraction, ExtractedSettlement, ExtractionPageMapEntry } from '@/src/import/types';
import type { ContentReading, ReadSettlementLine, ReadStatementRow } from './schema';

type Operating = NonNullable<ExtractedSettlement['operating']>;

const r2 = (n: number) => Math.round(n * 100) / 100;
// A printed cell: its number, or null when blank / not a number.
export function cell(text: string | null | undefined): number | null {
  if (text == null || String(text).trim() === '') return null;
  const n = parseAmount(String(text));
  return Number.isFinite(n) ? r2(n) : null;
}

// ---- settlement side ------------------------------------------------------

export const SUMMARY_LABEL = {
  grossRevenue: /^TOTAL REV(ENUE)?\b/,
  reimbursements: /^TOTAL REIMB/,
  // Never the recap's TOTAL DEDUCTIONS FROM SETTLEMENTS (truck + wages).
  totalDeductions: /^TOTAL DEDUCTIONS?\b(?! FROM SETTLEMENT)/,
  netPay: /^NET AMOUNT DUE\b/,
} as const;
// Wage identity rows (round 2 item G).
export const WAGE_LABEL = {
  totalWageExpense: /^TOTAL WAGE\b/,
  subtotalPriorWage: /^SUBTOTAL PRIOR WAGE\b/,
  totalDeductionsFromSettlements: /^TOTAL DEDUCTIONS? FROM SETTLEMENT/,
} as const;
// A printed total that says there is nothing ("NO ENTRY FOR THIS RUN").
const NO_ENTRY = /\bNO ENTRY\b/i;
export const PAYOUT_LABEL = /\bDIRECT DEPOSIT\b|\bLOADED ON (A )?CARD\b|^AMOUNT LOADED\b/;

// The signed amount of a settlement line. The printed sign wins; an
// unsigned amount takes its sign from the printed direction: a deduction
// credit and a revenue/reimbursement charge are negative.
export function signedLineAmount(line: Pick<ReadSettlementLine, 'section' | 'amount' | 'direction'>): number | null {
  const v = cell(line.amount);
  if (v == null) return null;
  if (v < 0) return v;
  const negative = line.section === 'deduction' || line.section === 'wage' ? line.direction === 'credit' : line.direction === 'charge';
  return negative ? -v : v;
}

export function payoutMethodOf(label: string): 'bank' | 'card' | null {
  const l = normalizeStatementLabel(label);
  if (/\bCARD\b/.test(l)) return 'card';
  if (/\bDIRECT DEPOSIT\b|\bBANK\b|\bACH\b/.test(l)) return 'bank';
  return null;
}

// ---- statement side -------------------------------------------------------

const TEMPLATE_SECTION = new Map<string, StatementSection>(PRIME_TEMPLATE.flatMap((b) => b.labels.map((l) => [l, b.section] as const)));
const TOTAL_FIELD_SECTION: Partial<Record<StatementTotalField, StatementSection>> = {
  weekTotalFreightRevenue: 'revenue',
  weekTotalOtherRevenue: 'revenue',
  weekTotalRevenue: 'revenue',
  weekTotalFuelOilTax: 'fuel_oil_tax',
  weekTotalRepair: 'repair',
  weekTotalTires: 'tires',
  weekTotalMiscellaneous: 'misc',
  weekTotalOutOfPocket: 'out_of_pocket',
  weekTotalFixedCost: 'fixed',
  weekTotalOtherIncomeAndExpense: 'other',
};

export type PlacedRow = ReadStatementRow & {
  kind: 'line' | 'total' | 'info';
  section: StatementSection | null;
  weeksValue: number | null;
  ytdValue: number | null;
  ltdValue: number | null;
};

// Every statement row with its kind and block. Rows after TOTAL STATEMENT
// (and every info row) belong to no block.
export function placeStatementRows(rows: ReadStatementRow[]): PlacedRow[] {
  const placed: PlacedRow[] = rows.map((row) => {
    const label = normalizeStatementLabel(row.label ?? '');
    const values = { weeksValue: cell(row.weeks), ytdValue: cell(row.ytd), ltdValue: cell(row.ltd) };
    if (/^TOTAL\b/.test(label)) {
      const field = totalFieldOfLabel(row.label);
      return { ...row, ...values, kind: 'total', section: field ? (TOTAL_FIELD_SECTION[field] ?? null) : null };
    }
    if (statementInfoRow(row.label ?? '') || PAYOUT_LABEL.test(label)) return { ...row, ...values, kind: 'info', section: null };
    return { ...row, ...values, kind: 'line', section: TEMPLATE_SECTION.get(canonicalStatementLabel(label)) ?? null };
  });
  // An unknown label: the block of the next TOTAL row of a block printed
  // after it, as long as no "grand" total (variable, operating, statement)
  // comes first.
  let afterStatement = false;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (p.kind === 'total' && /^TOTAL STATEMENT\b/.test(normalizeStatementLabel(p.label))) afterStatement = true;
    if (p.kind !== 'line' || p.section) continue;
    if (afterStatement) {
      p.kind = 'info';
      continue;
    }
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j];
      if (q.kind !== 'total') continue;
      p.section = q.section;
      break;
    }
  }
  return placed;
}

const RECAP = {
  miles: /^(WEEK(LY)? )?MILES$/,
  balanceForward: /\bBALANCE FORWARD\b/,
  settlementToOperator: /^SETTLEMENT TO OPERATOR$/,
  weeksInService: /^WEEKS IN SERVICE$/,
  perfBond: /^PERF(ORMANCE)? (BD|BOND)\b/,
};

function operatingOf(reading: ContentReading, payout: { label: string; amount: number | null } | null): Operating {
  const placed = placeStatementRows(reading.statement?.rows ?? []);
  const lines = placed
    .filter((p) => p.kind === 'line' && p.section && p.weeksValue != null)
    .map((p) => ({ section: p.section as string, label: p.label.trim(), amount: p.weeksValue as number, weeks: p.weeksValue, ytd: p.ytdValue, ltd: p.ltdValue, page: p.page }));
  const totalLines = placed
    .filter((p) => p.kind === 'total' && p.weeksValue != null)
    .map((p) => ({ label: p.label.trim(), amount: p.weeksValue as number, weeks: p.weeksValue, ytd: p.ytdValue, ltd: p.ltdValue }));
  const recapLines = placed
    .filter((p) => p.kind === 'info')
    .map((p) => ({ label: p.label.trim(), weeks: p.weeksValue, ytd: p.ytdValue, ltd: p.ltdValue, page: p.page }));
  const find = (re: RegExp) => placed.find((p) => re.test(normalizeStatementLabel(p.label)));
  const total = (re: RegExp) => placed.find((p) => p.kind === 'total' && re.test(normalizeStatementLabel(p.label)));

  const op: Operating = { lines, totalLines, recapLines, weekEnding: '', weekEndingRaw: reading.statement?.weekEndingRaw ?? '' };
  const miles = find(RECAP.miles);
  if (miles?.weeksValue != null) op.weekMiles = miles.weeksValue;
  if (miles?.ytdValue != null) op.ytdMiles = miles.ytdValue;
  const bf = find(RECAP.balanceForward);
  if (bf?.weeksValue != null) op.priorWeekBalanceForward = bf.weeksValue;
  const sto = find(RECAP.settlementToOperator);
  if (sto?.weeksValue != null) op.settlementToOperator = sto.weeksValue;
  if (sto?.ytdValue != null) op.ytdSettlementToOperator = sto.ytdValue;
  op.settlementToOperatorLabel = sto ? sto.label.trim() : '';
  const statementPayout = placed.find((p) => p.kind === 'info' && PAYOUT_LABEL.test(normalizeStatementLabel(p.label)) && p.weeksValue != null);
  const pay = statementPayout ? { label: statementPayout.label.trim(), amount: statementPayout.weeksValue } : payout;
  if (pay?.amount != null) {
    op.directDeposit = pay.amount;
    op.directDepositLabel = pay.label;
    op.payoutMethod = payoutMethodOf(pay.label) ?? '';
  }
  const weeks = find(RECAP.weeksInService);
  if (weeks) {
    const v = weeks.weeksValue ?? weeks.ytdValue ?? weeks.ltdValue;
    if (v != null) op.weeksInService = v;
  }
  const bond = find(RECAP.perfBond);
  if (bond?.ytdValue != null) op.perfBondEmergencyFundYtd = bond.ytdValue;
  const revenue = total(/^TOTAL REVENUE$/);
  if (revenue?.ytdValue != null) op.ytdTotalRevenue = revenue.ytdValue;
  const statement = total(/^TOTAL STATEMENT\b/);
  if (statement?.ytdValue != null) op.ytdTotalStatement = statement.ytdValue;

  const escrow = (reading.accounts ?? []).find((a) => /\bPERF|\bBOND\b|\bESCROW\b|\bEMERG|\bEMGCY\b/.test(normalizeStatementLabel(a.account)));
  if (escrow) {
    const set = (key: 'escrowPriorBalance' | 'escrowThisWeek' | 'escrowBalance' | 'escrowInterestRatePct', text: string) => {
      const v = cell(text);
      if (v != null) op[key] = v;
    };
    set('escrowPriorBalance', escrow.priorBalance);
    set('escrowThisWeek', escrow.thisWeek);
    set('escrowBalance', escrow.balance);
    set('escrowInterestRatePct', escrow.ratePct.replace('%', ''));
  }
  return op;
}

export type ReadMeta = { pagesTotal: number; contentPages: number[]; attachmentPages: number[] };

export function readingToExtraction(reading: ContentReading, meta: ReadMeta): Extraction {
  const pageMap: ExtractionPageMapEntry[] = [
    ...meta.contentPages.map((page) => ({ page, kind: 'content', role: 'content' as const, status: 'read' as const })),
    ...meta.attachmentPages.map((page) => ({ page, kind: 'attachment', role: 'attachment' as const, status: 'pending' as const })),
  ];
  if (reading.docType !== 'settlement') return { docType: 'other', confidence: 'low', pageMap, pagesTotal: meta.pagesTotal };

  const summary = reading.summary ?? [];
  const summaryRow = (re: RegExp) => summary.find((r) => re.test(normalizeStatementLabel(r.label)) && cell(r.amount) != null);
  const s: ExtractedSettlement = {
    weekEnding: '',
    printDate: '',
    settlementDateRaw: reading.settlementDateRaw ?? '',
    printDateRaw: reading.printDateRaw ?? '',
    statementWeekEndingRaw: reading.statement?.weekEndingRaw ?? '',
    carrier: reading.carrier ?? '',
    unit: reading.unit ?? '',
    driverName: reading.driverName ?? '',
    totalLabels: {},
  };
  const totalLabels = s.totalLabels!;
  for (const field of Object.keys(SUMMARY_LABEL) as (keyof typeof SUMMARY_LABEL)[]) {
    const row = summaryRow(SUMMARY_LABEL[field]);
    if (!row) continue;
    s[field] = cell(row.amount) as number;
    totalLabels[field] = row.label.trim();
  }
  s.settlementTotalLines = summary.map((r) => ({ label: r.label.trim(), amount: cell(r.amount) ?? r.amount }));
  for (const field of Object.keys(WAGE_LABEL) as (keyof typeof WAGE_LABEL)[]) {
    const row = summary.find((r) => WAGE_LABEL[field].test(normalizeStatementLabel(r.label)));
    if (!row) continue;
    const v = cell(row.amount);
    if (v != null) s[field] = v;
    else if (field === 'totalWageExpense' && NO_ENTRY.test(row.amount ?? '')) s[field] = 0;
  }
  const payoutRow = summaryRow(PAYOUT_LABEL);
  if (payoutRow) {
    s.depositAmount = cell(payoutRow.amount) as number;
    totalLabels.depositAmount = payoutRow.label.trim();
    s.payoutMethod = payoutMethodOf(payoutRow.label) ?? '';
  }

  const lines = (reading.settlementLines ?? []).map((l) => ({ l, amount: signedLineAmount(l) })).filter((x) => x.amount != null);
  s.revenueItems = lines
    .filter((x) => x.l.section === 'revenue')
    .map(({ l, amount }) => ({ code: l.code.trim(), desc: l.description.trim(), order: l.reference.trim(), amount: amount as number }));
  s.reimbursementItems = lines
    .filter((x) => x.l.section === 'reimbursement')
    .map(({ l, amount }) => ({ code: l.code.trim(), desc: l.description.trim(), ref: l.reference.trim(), amount: amount as number }));
  s.deductions = lines.filter((x) => x.l.section === 'deduction').map(({ l, amount }) => ({ code: l.code.trim(), desc: l.description.trim(), amount: amount as number }));
  const wages = lines.filter((x) => x.l.section === 'wage').map(({ l, amount }) => ({ code: l.code.trim(), desc: l.description.trim(), amount: amount as number }));
  if (wages.length > 0) s.wageItems = wages;

  s.loads = (reading.loads ?? []).map((l) => ({
    order: l.order.trim(),
    from: l.origin.trim(),
    to: l.destination.trim(),
    loadedMiles: cell(l.loadedMiles) ?? 0,
    emptyMiles: cell(l.emptyMiles) ?? 0,
    revenue: cell(l.revenue) ?? 0,
  }));
  s.milesLines = (reading.milesLines ?? []).map((m) => ({ label: m.label.trim(), miles: cell(m.miles) }));
  const fuel = (type: 'tractor' | 'reefer') =>
    (reading.fuelPurchases ?? [])
      .filter((f) => f.type === type)
      .map((f) => ({
        date: f.date.trim(),
        location: f.location.trim(),
        state: f.state.trim(),
        gallons: cell(f.gallons) ?? 0,
        amount: cell(f.amount) ?? 0,
        discount: cell(f.discount) ?? 0,
      }));
  s.tractorFuel = fuel('tractor');
  s.reeferFuel = fuel('reefer');

  if (reading.statement?.printed && (reading.statement.rows ?? []).length > 0) {
    s.operating = operatingOf(reading, payoutRow ? { label: payoutRow.label.trim(), amount: cell(payoutRow.amount) } : null);
    if (s.operating.weekMiles != null) s.totalMiles = s.operating.weekMiles;
  }
  if (s.totalMiles == null) {
    const total = s.milesLines.find((m) => /^TOTAL\b/.test(normalizeStatementLabel(m.label ?? '')) && m.miles != null);
    if (total) s.totalMiles = total.miles as number;
  }

  return { docType: 'settlement', confidence: 'high', settlement: s, pageMap, pagesTotal: meta.pagesTotal };
}
