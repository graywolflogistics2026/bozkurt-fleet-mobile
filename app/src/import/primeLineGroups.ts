import type { Extraction, ExtractedSettlementDeduction } from './types';
import { parseAmount } from './amount';
import { isPrimeCarrier } from './primeOperatingStatement';
import { normalizeStatementLabel } from './primeStatementLines';
import { settlementWagesOf, summedSettlementDeductions } from './settlementReconciliation';
import { printedInterestNetOf } from './settlementStatement';

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
  | 'advance_family'
  | 'meals'
  | 'performance_bond'
  | 'total';

export type AdvanceClass = 'weight' | 'lumper' | 'fuel' | 'late' | 'plain';

export type AdvanceFamilyReason =
  | 'advance_unrecognized'
  | 'advance_fuel_unparsable'
  | 'late_fee_not_reimbursed'
  | `advance_fee_out_of_range:${AdvanceClass}`
  | 'fees_differ';

export type PrimeGroupCheck = {
  group: PrimeLineGroup;
  settlement: number;
  statement: number;
  difference: number;
  passed: boolean;
  // advance_family only: every named reason it failed for (empty = passed).
  reasons?: AdvanceFamilyReason[];
};

type GroupDef = {
  group: Exclude<PrimeLineGroup, 'total' | 'advance_family'>;
  codes: string[];
  // Reimbursement lines netted against the group (by printed code, else
  // by description).
  reimbursement?: { codes: string[]; desc: RegExp };
  statementLabels: string[];
  // Compared by size (round 2 item I(c), 2026-11-13): the performance bond
  // is always withheld; a scan can drop the statement row's trailing minus
  // and showed "lines $100.00, statement -$100.00". Both sides as a charge.
  bySize?: boolean;
  // tractor_fuel / reefer_fuel: the fuel an "ADV FOR UF- x RF- y" advance
  // paid for (advance_family, stage 3a) — the statement books it here.
  advancePrincipal?: 'uf' | 'rf';
};

const GROUPS: GroupDef[] = [
  { group: 'tractor_fuel', codes: ['UF'], statementLabels: ['TRACTOR FUEL'], advancePrincipal: 'uf' },
  { group: 'tractor_def', codes: ['UE'], statementLabels: ['TRACTOR DEF'] },
  {
    group: 'reefer_fuel',
    codes: ['RF'],
    reimbursement: { codes: ['RF'], desc: /\bREEFER FUEL\b/i },
    statementLabels: ['REEFER FUEL'],
    advancePrincipal: 'rf',
  },
  { group: 'tractor_fuel_discount', codes: ['UD'], statementLabels: ['TRACTOR FUEL DISCOUNT'] },
  { group: 'reefer_fuel_discount', codes: ['RD'], statementLabels: ['REEFER FUEL DISCOUNT'] },
  { group: 'def_discount', codes: ['ED'], statementLabels: ['DEF DISCOUNT'] },
  { group: 'state_fuel_tax', codes: ['SF'], reimbursement: { codes: ['SF'], desc: /\bFUEL TAX\b/i }, statementLabels: ['STATE FUEL TAX'] },
  { group: 'repair', codes: ['UR', 'SH'], statementLabels: ['UNIT REPAIR EXPENSE', 'RO PARTS REPAIR'] },
  // WA lines: the advance_family check below (stage 3a, 2026-11-25). It
  // replaced the 'advances' group (WA lines without weight tickets vs
  // ADVANCES, $1 tolerance).
  { group: 'meals', codes: ['PO'], statementLabels: ['PRIME POINT OF SALE'] },
  { group: 'performance_bond', codes: ['PB'], statementLabels: ['ACCRUAL PERFORMANCE BOND'], bySize: true },
];

const TOLERANCE = 1.0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (v: unknown) => {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : 0;
};
const codeOf = (d: { code?: string | null }) => (d.code ?? '').trim().toUpperCase();

// =====================================================================
// ADVANCE FAMILY (owner decisions 2026-11-25,
// docs/decisions/advance-family-rule-proposal.md sections 2-3). Prime pays
// each WA advance and books it under its PURPOSE row, never as one
// ADVANCES row; every advance line carries its wire fee (0.00, 1.00 or
// 2.55), booked under WIRE CHARGE together with the FC fuel card charge.
//   WEIGHT  "ADV FOR WEIGHT TICKETS" (+ WT lines)  -> WEIGHT TICKETS
//   LUMPER  "ADV FOR OUTSIDE LUMPER" (+ LM lines)  -> LUMPERS
//   FUEL    "ADV FOR UF- x RF- y"                  -> TRACTOR / REEFER FUEL
//           (principal = the printed x + y; the fuel groups add it)
//   LATE    "ADV FOR LATE FEE"                     -> cancelled by LE "LATE FEE*"
//   PLAIN   "ADVANCE..." (net of WA advances taken) -> ADVANCES
// Fees are DERIVED (line amounts minus principal), never read, and must
// sum to WIRE CHARGE minus the FC lines EXACTLY — no tolerance. Anything
// not recognized is never absorbed: the group fails with a named reason.
// =====================================================================

// D3 (owner 2026-11-25): at most 2.55 of fee per advance line, per class.
export const MAX_FEE_PER_ADVANCE_LINE = 2.55;
const CENT = 0.005;

const WEIGHT_DESC = /^ADV FOR WEIGHT TICKETS?$/;
const LUMPER_DESC = /^ADV FOR OUTSIDE LUMPER$/;
const LATE_DESC = /^ADV FOR LATE FEE$/;
const PLAIN_DESC = /^ADVANCE\b/;
// Names a fuel advance: "ADV FOR UF-..." or "ADV FOR RF-...".
const FUEL_START = /^ADV FOR (UF|RF)\b/;
// The whole rest of the text must be UF-/RF- pairs with printed amounts.
const FUEL_REST = /^(?:(?:UF|RF)-\s*[0-9][0-9,]*\.[0-9]{2}\s*)+$/;
const FUEL_PAIR = /(UF|RF)-\s*([0-9][0-9,]*\.[0-9]{2})/g;
const LATE_FEE_REIMBURSEMENT = /\bLATE FEE\b/;

const normDesc = (desc: string | null | undefined) => (desc ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

export type AdvanceFamily = {
  // Derived fee per class (line amounts minus principal); only classes
  // with a line or a statement row.
  fees: Partial<Record<AdvanceClass, number>>;
  lineCount: Record<AdvanceClass, number>;
  // Parsed from "ADV FOR UF- x RF- y" lines that parsed in full.
  principal: { uf: number; rf: number };
  // Amounts of WA lines no class explains (unrecognized or unparsable).
  unexplained: number;
  feesTotal: number;
  // WIRE CHARGE minus the FC lines.
  wireFees: number;
  reasons: AdvanceFamilyReason[];
  passed: boolean;
};

// Null when the week has no WA deduction line (nothing to compare).
export function buildAdvanceFamily(extraction: Extraction | null | undefined): AdvanceFamily | null {
  const s = extraction?.settlement;
  if (!s || extraction?.docType !== 'settlement' || !isPrimeCarrier(s.carrier)) return null;
  const deductions: ExtractedSettlementDeduction[] = s.deductions ?? [];
  const wa = deductions.filter((d) => codeOf(d) === 'WA');
  if (wa.length === 0) return null;
  const statementLines = (s.operating?.lines ?? []).filter((l) => !!l.label && l.section !== 'revenue');
  const row = (label: string) => round2(-statementLines.filter((l) => normalizeStatementLabel(l.label ?? '') === label).reduce((sum, l) => sum + amountOf(l.amount), 0));
  const reimbursements = s.reimbursementItems ?? [];

  const sums: Record<AdvanceClass, number> = { weight: 0, lumper: 0, fuel: 0, late: 0, plain: 0 };
  const lineCount: Record<AdvanceClass, number> = { weight: 0, lumper: 0, fuel: 0, late: 0, plain: 0 };
  const principal = { uf: 0, rf: 0 };
  let fuelPrincipal = 0;
  let unexplained = 0;
  const reasons = new Set<AdvanceFamilyReason>();
  const add = (cls: AdvanceClass, amount: number) => {
    sums[cls] += amount;
    lineCount[cls] += 1;
  };

  for (const d of wa) {
    const desc = normDesc(d.desc);
    const amount = amountOf(d.amount);
    if (WEIGHT_DESC.test(desc)) add('weight', amount);
    else if (LUMPER_DESC.test(desc)) add('lumper', amount);
    else if (LATE_DESC.test(desc)) add('late', amount);
    else if (FUEL_START.test(desc)) {
      const rest = desc.replace(/^ADV FOR /, '');
      const pairs = FUEL_REST.test(rest) ? [...rest.matchAll(FUEL_PAIR)] : [];
      const parsed = pairs.map((m) => ({ type: m[1], amount: parseAmount(m[2]) }));
      if (parsed.length === 0 || parsed.some((p) => !Number.isFinite(p.amount))) {
        reasons.add('advance_fuel_unparsable');
        unexplained += amount;
        continue;
      }
      for (const p of parsed) {
        if (p.type === 'UF') principal.uf += p.amount;
        else principal.rf += p.amount;
        fuelPrincipal += p.amount;
      }
      add('fuel', amount);
    } else if (PLAIN_DESC.test(desc)) add('plain', amount);
    else {
      reasons.add('advance_unrecognized');
      unexplained += amount;
    }
  }
  // D2 (owner 2026-11-25): the same statement rows carry these codes.
  for (const d of deductions) {
    const code = codeOf(d);
    if (code === 'LM') add('lumper', amountOf(d.amount));
    else if (code === 'WT') add('weight', amountOf(d.amount));
  }
  const fc = deductions.filter((d) => codeOf(d) === 'FC').reduce((sum, d) => sum + amountOf(d.amount), 0);

  // WA advances TAKEN are printed in the reimbursement section (07/17:
  // 3,999.00 + 460.59); the statement's ADVANCES nets them against the
  // weekly repayment (550.00 − 4,459.59 = +3,909.59 credit). Same netting
  // as the 'advances' group it replaces.
  const advancesTaken = reimbursements
    .filter((r) => (codeOf(r) ? codeOf(r) === 'WA' : /\bADVANCE\b/i.test(r.desc ?? '')))
    .reduce((sum, r) => sum + amountOf(r.amount), 0);
  const lateFeeReimbursements = reimbursements.filter((r) => codeOf(r) === 'LE' && LATE_FEE_REIMBURSEMENT.test(normDesc(r.desc)));
  if (lineCount.late > 0 && lateFeeReimbursements.length === 0) reasons.add('late_fee_not_reimbursed');
  const lateReimbursed = lateFeeReimbursements.reduce((sum, r) => sum + amountOf(r.amount), 0);

  const rows = { weight: row('WEIGHT TICKETS'), lumper: row('LUMPERS'), plain: row('ADVANCES') };
  const fees: Partial<Record<AdvanceClass, number>> = {};
  if (lineCount.weight > 0 || rows.weight !== 0) fees.weight = round2(sums.weight - rows.weight);
  if (lineCount.lumper > 0 || rows.lumper !== 0) fees.lumper = round2(sums.lumper - rows.lumper);
  if (lineCount.fuel > 0) fees.fuel = round2(sums.fuel - fuelPrincipal);
  if (lineCount.late > 0) fees.late = round2(sums.late - lateReimbursed);
  if (lineCount.plain > 0 || rows.plain !== 0 || advancesTaken !== 0) fees.plain = round2(sums.plain - advancesTaken - rows.plain);

  for (const cls of Object.keys(fees) as AdvanceClass[]) {
    const fee = fees[cls]!;
    if (fee < -CENT || fee > MAX_FEE_PER_ADVANCE_LINE * lineCount[cls] + CENT) reasons.add(`advance_fee_out_of_range:${cls}`);
  }
  const feesTotal = round2(Object.values(fees).reduce((sum, f) => sum + (f ?? 0), 0));
  const wireFees = round2(row('WIRE CHARGE') - fc);
  if (Math.abs(feesTotal + unexplained - wireFees) >= CENT) reasons.add('fees_differ');
  const list = [...reasons];
  return {
    fees,
    lineCount,
    principal: { uf: round2(principal.uf), rf: round2(principal.rf) },
    unexplained: round2(unexplained),
    feesTotal,
    wireFees,
    reasons: list,
    passed: list.length === 0,
  };
}

// Null when the carrier is not Prime or no statement lines were read.
export function buildPrimeGroupChecks(extraction: Extraction | null | undefined): PrimeGroupCheck[] | null {
  const s = extraction?.settlement;
  if (!s || extraction?.docType !== 'settlement' || !isPrimeCarrier(s.carrier)) return null;
  const statementLines = (s.operating?.lines ?? []).filter((l) => !!l.label && l.section !== 'revenue');
  if (statementLines.length === 0) return null;
  const deductions: ExtractedSettlementDeduction[] = s.deductions ?? [];
  const reimbursements = s.reimbursementItems ?? [];
  const byLabel = (labels: string[]) => statementLines.filter((l) => labels.includes(normalizeStatementLabel(l.label ?? '')));
  const family = buildAdvanceFamily(extraction);

  const checks: PrimeGroupCheck[] = [];
  // Exact to the cent: settlement = the derived fees (plus any WA line no
  // class explains), statement = WIRE CHARGE − FC lines. Listed where the
  // 'advances' group was (after repair).
  const pushFamily = () => {
    if (!family) return;
    const settlement = round2(family.feesTotal + family.unexplained);
    checks.push({
      group: 'advance_family',
      settlement,
      statement: family.wireFees,
      difference: round2(settlement - family.wireFees),
      passed: family.passed,
      reasons: family.reasons,
    });
  };
  for (const def of GROUPS) {
    if (def.group === 'meals') pushFamily();
    const lines = deductions.filter((d) => def.codes.includes(codeOf(d)));
    const statement = byLabel(def.statementLabels);
    const principal = def.advancePrincipal && family ? family.principal[def.advancePrincipal] : 0;
    // Nothing on either side: nothing to compare. Only the statement side:
    // the lines were read without codes (or the fuel only in the fuel
    // lists) — unknown, never a guessed mismatch.
    if (lines.length === 0 && principal === 0) continue;
    const reimbursed = def.reimbursement
      ? reimbursements
          .filter((r) => {
            const code = (r.code ?? '').trim().toUpperCase();
            return code ? def.reimbursement!.codes.includes(code) : def.reimbursement!.desc.test(r.desc ?? '');
          })
          .reduce((sum, r) => sum + amountOf(r.amount), 0)
      : 0;
    let settlement = round2(lines.reduce((sum, d) => sum + amountOf(d.amount), 0) - reimbursed + principal);
    let statementSide = round2(-statement.reduce((sum, l) => sum + amountOf(l.amount), 0));
    if (def.bySize) {
      settlement = Math.abs(settlement);
      statementSide = Math.abs(statementSide);
    }
    const difference = round2(settlement - statementSide);
    checks.push({ group: def.group, settlement, statement: statementSide, difference, passed: Math.abs(difference) <= TOLERANCE });
  }

  // Everything else at total level: all deduction lines (plus fuel-list
  // rows no line covers, as the profit engine counts them) − all
  // reimbursements vs TOTAL OPERATING EXPENSES. Interest (income or
  // expense) exists only on the statement: its printed lines are taken out
  // of the comparison (round 2, 2026-11-13: 11/06 1.14, 11/13 1.40 and
  // 10/30 1.23 were above the $1 tolerance and showed a false line-details
  // difference, so the week saved without its line rows).
  const opex = s.operating?.weekTotalOperatingExpenses;
  if (deductions.length > 0 && opex != null && opex !== '' && amountOf(opex) !== 0) {
    // Wage lines (round 2 item G) are charges the statement books too.
    const settlement = round2(
      summedSettlementDeductions(s) + settlementWagesOf(s) - reimbursements.reduce((sum, r) => sum + amountOf(r.amount), 0) - printedInterestNetOf(extraction!)
    );
    const statementSide = round2(-amountOf(opex));
    const difference = round2(settlement - statementSide);
    checks.push({ group: 'total', settlement, statement: statementSide, difference, passed: Math.abs(difference) <= TOLERANCE });
  }
  return checks;
}
