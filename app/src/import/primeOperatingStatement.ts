import type { Extraction } from './types';
import { normalizeCarrierKey } from './carrierCodes';
import { printedTotal } from './amount';

// USE PRIME'S "STATEMENT OF INCOME AND EXPENSE" AS THE VERIFICATION
// SOURCE OF TRUTH (owner decision, 2026-08-28) — Prime Inc's own
// settlement statements include a Perryman & Associates operating-
// statement page (docs/CARRIER_CODES.md's "AS/ACCOUNTING SERVICE"
// chargeback row is literally the cost of this page) with the carrier's
// OWN weekly/YTD/LTD figures. This module cross-checks this app's own
// extraction/YTD totals against it — never the reverse; Prime's own
// figures are informational and NEVER silently substituted for this
// app's own stored numbers.
//
// CARRIER ISOLATION — HARD INVARIANT, same as carrierCodes.ts's own rule
// (CLAUDE.md, CARRIER-SCOPED PAYROLL/SETTLEMENT CODES): every exported
// function here re-checks the carrier ITSELF via normalizeCarrierKey()
// against the literal 'PRIME INC' key. A non-Prime or unrecognized
// carrier makes every function in this file a silent no-op.
//
// PRIME STATEMENT AS SOURCE (owner decision 2026-10-13): the weekly
// Statement of Income and Expense is now the source of truth for a Prime
// settlement week — see src/import/settlementStatement.ts (self-check,
// stored figures), src/import/primeStatementLines.ts (line table) and
// docs/decisions/prime-statement-source.md. This module keeps the carrier
// gate, the standing YTD check and the Prime sub-ledger filter.

const PRIME_CARRIER_KEY = 'PRIME INC';

export function isPrimeCarrier(carrier: string | null | undefined): boolean {
  return normalizeCarrierKey(carrier) === PRIME_CARRIER_KEY;
}

// The WEEKLY check of the Prime statement page (every line, every printed
// subtotal, the deposit) lives in src/import/settlementStatement.ts
// (buildPrimeStatementCheck()).

// ---------------------------------------------------------------------
// STANDING YTD RECONCILIATION — a Prime account's own running YTD totals
// vs. the YTD figures Prime's most recent operating statement reported.
// Account-level, so the caller (Settlements screen) supplies both sides.
// Compared: TOTAL REVENUE, MILES and TOTAL STATEMENT (what Prime paid
// out = this app's summed net due, plus Prime's interest, which the YTD
// tolerance absorbs).
// ---------------------------------------------------------------------

export type PrimeYtdSnapshot = {
  revenue: number;
  miles: number;
  totalStatement: number;
  // YTD SETTLEMENT TO OPERATOR — what Prime paid out this year, the
  // figure "Deposited" is compared with (0 when not printed).
  settlementToOperator: number;
  asOfWeekEnding: string;
};

// YTD tolerance is intentionally LOOSER than the single-week tolerance:
// a YTD figure accumulates many weeks' worth of benign rounding. 0.5% of
// Prime's own reported figure, floored at $25 / 25 miles.
const YTD_DOLLAR_TOLERANCE_PCT = 0.005;
const YTD_DOLLAR_TOLERANCE_FLOOR = 25;
const YTD_MILES_TOLERANCE_PCT = 0.005;
const YTD_MILES_TOLERANCE_FLOOR = 25;

function ytdDollarTolerance(primeReported: number): number {
  return Math.max(YTD_DOLLAR_TOLERANCE_FLOOR, Math.abs(primeReported) * YTD_DOLLAR_TOLERANCE_PCT);
}
function ytdMilesTolerance(primeReported: number): number {
  return Math.max(YTD_MILES_TOLERANCE_FLOOR, Math.abs(primeReported) * YTD_MILES_TOLERANCE_PCT);
}

// Deposits are NOT compared here (BANK DEPOSIT add-on, owner decision
// 2026-10-13): Prime's YTD statement total vs the imported weeks' deposits
// is informational only, never a warning — see
// src/stats/settlementWeek.ts primeDepositsYtd().
export type PrimeYtdMismatch = { field: 'revenue'; ours: number; prime: number } | { field: 'miles'; ours: number; prime: number };

// Pure comparison — returns [] (never a guess) when `primeYtd` is null.
// `ours` must come from this app's OWN canonical functions
// (computeKpis() over the Prime sub-ledger) — never re-derived here.
export function checkPrimeYtdReconciliation(
  ours: { revenue: number; miles: number },
  primeYtd: PrimeYtdSnapshot | null
): PrimeYtdMismatch[] {
  if (!primeYtd) return [];
  const issues: PrimeYtdMismatch[] = [];

  if (primeYtd.revenue && Math.abs(ours.revenue - primeYtd.revenue) > ytdDollarTolerance(primeYtd.revenue)) {
    issues.push({ field: 'revenue', ours: ours.revenue, prime: primeYtd.revenue });
  }
  if (primeYtd.miles && Math.abs(ours.miles - primeYtd.miles) > ytdMilesTolerance(primeYtd.miles)) {
    issues.push({ field: 'miles', ours: ours.miles, prime: primeYtd.miles });
  }
  return issues;
}

// Reads a Prime YTD snapshot out of a settlement's own linked document's
// `parsed_json` (the FULL raw extraction, CLAUDE.md's D3 audit trail).
// Defense in depth: re-checks the carrier embedded INSIDE parsed_json
// itself. Settlements imported before 2026-10-13 stored the old assumed
// keys (ytdRevenue / ytdNet) — read as a fallback; the old ytdExpenses
// key never matched a real Prime figure and is ignored.
export function readPrimeYtdSnapshotFromParsedJson(
  parsedJson: Record<string, unknown> | null | undefined,
  weekEnding: string
): PrimeYtdSnapshot | null {
  if (!parsedJson) return null;
  const settlement = parsedJson['settlement'] as Record<string, unknown> | undefined;
  if (!settlement) return null;
  if (!isPrimeCarrier(settlement['carrier'] as string | undefined)) return null;
  const op = settlement['operating'] as Record<string, unknown> | undefined;
  if (!op) return null;

  const revenue = printedTotal(op['ytdTotalRevenue']) ?? printedTotal(op['ytdRevenue']) ?? 0;
  const miles = printedTotal(op['ytdMiles']) ?? 0;
  const totalStatement = printedTotal(op['ytdTotalStatement']) ?? printedTotal(op['ytdNet']) ?? 0;
  const settlementToOperator = printedTotal(op['ytdSettlementToOperator']) ?? 0;
  if (!revenue && !miles && !totalStatement && !settlementToOperator) return null;

  return { revenue, miles, totalStatement, settlementToOperator, asOfWeekEnding: weekEnding };
}

// ACCOUNTING MODEL — TWO LAYERS, NEVER CONFLATED (owner decision,
// 2026-08-28). The Prime sub-ledger is verified against Prime's own
// statement and NEVER against the user's own manually-added receipts —
// Prime has no visibility into those. This reduces an account-wide
// dataset to ONLY the rows that trace back to a confirmed-Prime
// settlement (by `settlement_id`); a manually-added row has
// `settlement_id: null` by construction and is excluded.
export function filterToPrimeSettlementSubledger<
  S extends { id: string; carrier: string | null },
  D extends { settlement_id?: string | null },
  F extends { settlement_id?: string | null },
  M extends { settlement_id?: string | null },
  T extends { settlement_id?: string | null },
  R extends { settlement_id?: string | null },
>(
  settlements: S[],
  deductions: D[],
  fuelPurchases: F[],
  maintenanceRecords: M[],
  tolls: T[],
  reimbursements: R[]
): { settlements: S[]; deductions: D[]; fuelPurchases: F[]; maintenanceRecords: M[]; tolls: T[]; reimbursements: R[] } {
  const primeSettlements = settlements.filter((s) => isPrimeCarrier(s.carrier));
  const primeIds = new Set(primeSettlements.map((s) => s.id));
  const belongsToPrime = (row: { settlement_id?: string | null }) => row.settlement_id != null && primeIds.has(row.settlement_id);
  return {
    settlements: primeSettlements,
    deductions: deductions.filter(belongsToPrime),
    fuelPurchases: fuelPurchases.filter(belongsToPrime),
    maintenanceRecords: maintenanceRecords.filter(belongsToPrime),
    tolls: tolls.filter(belongsToPrime),
    reimbursements: reimbursements.filter(belongsToPrime),
  };
}

// Finds the standing-check input across a whole account's settlements —
// the settlement with the LATEST week_ending that is confirmed Prime by
// its own `carrier` column and has a linked document whose parsed_json
// carried real operating-statement YTD data. Null when nothing qualifies.
export function findMostRecentPrimeYtdSnapshot(
  settlements: { carrier: string | null; week_ending: string; document_id: string | null }[],
  documentsById: Map<string, { parsed_json: Record<string, unknown> | null }>
): PrimeYtdSnapshot | null {
  const primeSettlements = settlements
    .filter((s) => isPrimeCarrier(s.carrier) && s.document_id)
    .sort((a, b) => (a.week_ending < b.week_ending ? 1 : a.week_ending > b.week_ending ? -1 : 0));

  for (const s of primeSettlements) {
    const doc = documentsById.get(s.document_id as string);
    const snapshot = readPrimeYtdSnapshotFromParsedJson(doc?.parsed_json ?? null, s.week_ending);
    if (snapshot) return snapshot;
  }
  return null;
}
