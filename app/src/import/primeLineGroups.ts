import type { Extraction, ExtractedSettlementDeduction } from './types';
import { parseAmount } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeStatementLabel } from './primeStatementLines';
import { summedSettlementDeductions } from './settlementReconciliation';

// PER-GROUP CHECKS (owner decision 2026-10-17, item 5). PRIME ONLY. The
// settlement's own deduction lines (pages 1-2), grouped by their printed
// code, against the matching lines of Prime's Statement of Income and
// Expense. WARNINGS ONLY — never blocking: Prime books some lines
// differently on the statement (the $1.00 fuel card under WIRE CHARGE,
// weight-ticket advances split across WEIGHT TICKETS and WIRE CHARGE), so
// everything outside these groups is compared at total level only.
//
// Sign convention: a settlement deduction is a charge (+), a credit line
// is negative (UD "317.37-"); a statement line is signed as printed (an
// expense is negative). Both sides are expressed as a charge:
//   settlement = Σ lines − Σ matching reimbursements
//   statement  = − Σ statement lines

export type PrimeLineGroup =
  | 'tractor_fuel'
  | 'tractor_def'
  | 'reefer_fuel'
  | 'tractor_fuel_discount'
  | 'reefer_fuel_discount'
  | 'def_discount'
  | 'state_fuel_tax'
  | 'repair'
  | 'advances'
  | 'meals'
  | 'performance_bond'
  | 'total';

export type PrimeGroupCheck = { group: PrimeLineGroup; settlement: number; statement: number; difference: number; passed: boolean };

type GroupDef = {
  group: Exclude<PrimeLineGroup, 'total'>;
  codes: string[];
  // A line of one of these codes whose description matches is left out
  // (WA "ADV FOR WEIGHT TICKETS" is a scale expense, not an advance).
  excludeDesc?: RegExp;
  // Reimbursement lines netted against the group (by printed code, else
  // by description).
  reimbursement?: { codes: string[]; desc: RegExp };
  statementLabels: string[];
};

const GROUPS: GroupDef[] = [
  { group: 'tractor_fuel', codes: ['UF'], statementLabels: ['TRACTOR FUEL'] },
  { group: 'tractor_def', codes: ['UE'], statementLabels: ['TRACTOR DEF'] },
  { group: 'reefer_fuel', codes: ['RF'], reimbursement: { codes: ['RF'], desc: /\bREEFER FUEL\b/i }, statementLabels: ['REEFER FUEL'] },
  { group: 'tractor_fuel_discount', codes: ['UD'], statementLabels: ['TRACTOR FUEL DISCOUNT'] },
  { group: 'reefer_fuel_discount', codes: ['RD'], statementLabels: ['REEFER FUEL DISCOUNT'] },
  { group: 'def_discount', codes: ['ED'], statementLabels: ['DEF DISCOUNT'] },
  { group: 'state_fuel_tax', codes: ['SF'], reimbursement: { codes: ['SF'], desc: /\bFUEL TAX\b/i }, statementLabels: ['STATE FUEL TAX'] },
  { group: 'repair', codes: ['UR', 'SH'], statementLabels: ['UNIT REPAIR EXPENSE', 'RO PARTS REPAIR'] },
  { group: 'advances', codes: ['WA'], excludeDesc: /\bWEIGHT\s+TICKETS?\b/i, statementLabels: ['ADVANCES'] },
  { group: 'meals', codes: ['PO'], statementLabels: ['PRIME POINT OF SALE'] },
  { group: 'performance_bond', codes: ['PB'], statementLabels: ['ACCRUAL PERFORMANCE BOND'] },
];

const TOLERANCE = 1.0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (v: unknown) => {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : 0;
};
const codeOf = (d: { code?: string }) => (d.code ?? '').trim().toUpperCase();

// Null when the carrier is not Prime or no statement lines were read.
export function buildPrimeGroupChecks(extraction: Extraction | null | undefined): PrimeGroupCheck[] | null {
  const s = extraction?.settlement;
  if (!s || extraction?.docType !== 'settlement' || !isPrimeCarrier(s.carrier)) return null;
  const statementLines = (s.operating?.lines ?? []).filter((l) => !!l.label && l.section !== 'revenue');
  if (statementLines.length === 0) return null;
  const deductions: ExtractedSettlementDeduction[] = s.deductions ?? [];
  const reimbursements = s.reimbursementItems ?? [];
  const byLabel = (labels: string[]) => statementLines.filter((l) => labels.includes(normalizeStatementLabel(l.label ?? '')));

  const checks: PrimeGroupCheck[] = [];
  for (const def of GROUPS) {
    const lines = deductions.filter((d) => def.codes.includes(codeOf(d)) && !(def.excludeDesc && def.excludeDesc.test(d.desc ?? '')));
    const statement = byLabel(def.statementLabels);
    // Nothing on either side: nothing to compare. Only the statement side:
    // the lines were read without codes (or the fuel only in the fuel
    // lists) — unknown, never a guessed mismatch.
    if (lines.length === 0) continue;
    const reimbursed = def.reimbursement
      ? reimbursements
          .filter((r) => {
            const code = (r.code ?? '').trim().toUpperCase();
            return code ? def.reimbursement!.codes.includes(code) : def.reimbursement!.desc.test(r.desc ?? '');
          })
          .reduce((sum, r) => sum + amountOf(r.amount), 0)
      : 0;
    const settlement = round2(lines.reduce((sum, d) => sum + amountOf(d.amount), 0) - reimbursed);
    const statementSide = round2(-statement.reduce((sum, l) => sum + amountOf(l.amount), 0));
    const difference = round2(settlement - statementSide);
    checks.push({ group: def.group, settlement, statement: statementSide, difference, passed: Math.abs(difference) <= TOLERANCE });
  }

  // Everything else at total level: all deduction lines (plus fuel-list
  // rows no line covers, as the profit engine counts them) − all
  // reimbursements vs TOTAL OPERATING EXPENSES. Interest (income or
  // expense) exists only on the statement and stays inside the tolerance
  // on a normal week (8/14: 0.59; 8/21: 0.37).
  const opex = s.operating?.weekTotalOperatingExpenses;
  if (deductions.length > 0 && opex != null && opex !== '' && amountOf(opex) !== 0) {
    const settlement = round2(summedSettlementDeductions(s) - reimbursements.reduce((sum, r) => sum + amountOf(r.amount), 0));
    const statementSide = round2(-amountOf(opex));
    const difference = round2(settlement - statementSide);
    checks.push({ group: 'total', settlement, statement: statementSide, difference, passed: Math.abs(difference) <= TOLERANCE });
  }
  return checks;
}
