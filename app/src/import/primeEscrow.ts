// HELD BY CARRIER (owner decision 2026-10-29, ESCROW / HELD / DEPOSIT).
// What Prime holds of the operator's money (performance bond / emergency
// fund) is READ from the statement, never summed from weekly deductions:
//   held   = balance sheet PERF BD/EMGCY FD, YTD TOTAL column (p6), else
//            page 3's PERFORMANCE BOND/EMER FUND PAID ending balance
//   prior  = page 3's prior balance
//   week   = ACCRUAL PERFORMANCE BOND on the statement (p5), else page 3's
//            this-week amount
// Checks never block Save; a failed one marks only this week's held figure
// "unverified" and heldByCarrier() skips it. The interest check is
// information only. Real weeks: W/E 8/14 held 500.00 (prior 400 + 100),
// W/E 8/21 held 600.00 (prior 500 + 100).
import type { Extraction } from './types';
import { parseAmount, printedTotal } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeStatementLabel } from './primeStatementLines';

export type EscrowCheckId = 'heldChain' | 'pagesAgree' | 'weekDepositAgrees';
export type EscrowCheck = { id: EscrowCheckId; expected: number; actual: number; passed: boolean };

export type EscrowInterestCheck = {
  aprPct: number;
  // Escrow prior + PRIOR WEEK BALANCE FORWARD (signed; 400 − 1,202.92).
  net: number;
  kind: 'income' | 'expense';
  expected: number;
  printed: number;
  passed: boolean;
};

export type PrimeEscrow = {
  unit: string | null;
  held: number | null;
  prior: number | null;
  weekDeposit: number | null;
  checks: EscrowCheck[];
  // verified: every check that ran passed (at least one ran);
  // unchecked: printed, nothing to cross-check it with; unverified: a check failed.
  status: 'verified' | 'unchecked' | 'unverified';
  interest: EscrowInterestCheck | null;
};

const TOLERANCE = 0.01;
const round2 = (n: number) => Math.round(n * 100) / 100;
const unsigned = (v: unknown) => {
  const n = printedTotal(v);
  return n == null ? null : Math.abs(n);
};

export function readPrimeEscrow(extraction: Extraction | null | undefined): PrimeEscrow | null {
  const s = extraction?.settlement;
  if (!s || !isPrimeCarrier(s.carrier)) return null;
  const op = s.operating ?? {};
  const p6 = unsigned(op.perfBondEmergencyFundYtd);
  const p3Balance = unsigned(op.escrowBalance);
  const p3ThisWeek = unsigned(op.escrowThisWeek);
  const prior = unsigned(op.escrowPriorBalance);
  const accrual = (op.lines ?? []).find((l) => normalizeStatementLabel(l.label ?? '') === 'ACCRUAL PERFORMANCE BOND');
  const p5 = accrual ? unsigned(accrual.amount) : null;
  const held = p6 ?? p3Balance;
  const weekDeposit = p5 ?? p3ThisWeek;
  if (held == null && prior == null) return null;

  const checks: EscrowCheck[] = [];
  const add = (id: EscrowCheckId, expected: number | null, actual: number | null) => {
    if (expected == null || actual == null) return;
    checks.push({ id, expected: round2(expected), actual: round2(actual), passed: Math.abs(expected - actual) <= TOLERANCE });
  };
  add('heldChain', held, prior != null && weekDeposit != null ? prior + weekDeposit : null);
  add('pagesAgree', p6, p3Balance);
  add('weekDepositAgrees', p5, p3ThisWeek);
  const status = checks.some((c) => !c.passed) ? 'unverified' : checks.length > 0 ? 'verified' : 'unchecked';

  return { unit: s.unit?.trim() || null, held, prior, weekDeposit, checks, status, interest: escrowInterestCheck(extraction!, prior) };
}

// Informational: net = escrow prior + balance forward; net ≥ 0 earns
// net × APR / 52 (8/21: 500 × 3.83% / 52 = 0.37 income), net < 0 costs
// |net| × APR / 52 (8/14: −802.92 × 3.83% / 52 = 0.59 expense).
export function escrowInterestCheck(extraction: Extraction, prior: number | null): EscrowInterestCheck | null {
  const op = extraction.settlement?.operating ?? {};
  const aprPct = printedTotal(op.escrowInterestRatePct);
  if (aprPct == null || prior == null) return null;
  const balanceForward = printedTotal(op.priorWeekBalanceForward) ?? 0;
  const net = round2(prior + balanceForward);
  const expected = round2((Math.abs(net) * aprPct) / 100 / 52);
  const printed = round2(
    (op.lines ?? [])
      .filter((l) => /^INTEREST (INCOME|EXPENSE)\b/.test(normalizeStatementLabel(l.label ?? '')))
      .reduce((sum, l) => sum + (Number.isFinite(parseAmount(l.amount)) ? parseAmount(l.amount) : 0), 0)
  );
  const kind = net >= 0 ? 'income' : 'expense';
  const passed = Math.abs(printed - (kind === 'income' ? expected : -expected)) <= TOLERANCE;
  return { aprPct, net, kind, expected, printed, passed };
}
