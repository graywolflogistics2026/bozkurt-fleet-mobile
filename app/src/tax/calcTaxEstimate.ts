import { calcFederalTax } from '@/src/tax/federalTax';
import { calcSeTax } from '@/src/tax/seTax';
import { calcStateTax } from '@/src/tax/stateTax';
import type { TaxEstimateInputs, TaxEstimateResult } from '@/src/tax/types';

// Orchestrates the whole estimate. Federal/SE math is a verbatim port of
// legacy calcTax() (legacy/index.html:2360):
//   const np=Math.max(0,rev-exp), seb=np*.9235, set=seb*.153, sed=set*.5;
//   const agi=Math.max(0,np+spouse-sed-sep-hlt);
//   const std=... ; const tax=Math.max(0,agi-std); ...bracket loop...
//   const tot=set+fed, qtr=tot/4;
// with additions per PROMPTS.md Session 5 (state-tax line — legacy had none
// at all) and the entity_type branch (D8, extended 2026-07-10 for
// multi_member_llc/employer payroll tax): 'sole_prop'/'smllc' are the exact
// legacy computation; 'scorp' applies SE tax only to scorp_salary, with the
// remainder flowing through as SE-tax-free distributions, and (new)
// estimates the employer-side FICA cost of that salary as a real business
// expense reducing ownerShareOfProfit — unless scorpPayrollTaxHandled says
// a payroll provider already accounts for it; 'multi_member_llc' scopes
// ownerShareOfProfit to just this member's ownershipPct (K-1 share).
// Federal/state brackets apply to ownerShareOfProfit either way — only the
// SE-tax base and the profit scoping differ per entity_type.
export function calcTaxEstimate(inputs: TaxEstimateInputs): TaxEstimateResult {
  const {
    taxYearData,
    filingStatus,
    state,
    includeStateTax,
    entityType,
    scorpSalary,
    scorpPayrollTaxHandled = false,
    ownershipPct,
    netProfit,
    spouseIncome = 0,
    sepContribution = 0,
    healthInsurancePremiums = 0,
  } = inputs;

  const np = Math.max(0, netProfit);

  const employerPayrollTax =
    entityType === 'scorp' && !scorpPayrollTaxHandled && taxYearData.se_tax.employer_fica
      ? Math.min(Math.max(0, scorpSalary ?? 0), np) * taxYearData.se_tax.employer_fica
      : 0;

  const ownerShareOfProfit =
    entityType === 'multi_member_llc'
      ? np * (Math.max(0, Math.min(100, ownershipPct ?? 100)) / 100)
      : Math.max(0, np - employerPayrollTax);

  const seTaxBase = entityType === 'scorp' ? Math.min(Math.max(0, scorpSalary ?? 0), np) : ownerShareOfProfit;
  const { seTax, seTaxDeduction } = calcSeTax(seTaxBase, taxYearData.se_tax);

  const agi = Math.max(0, ownerShareOfProfit + spouseIncome - seTaxDeduction - sepContribution - healthInsurancePremiums);
  const standardDeduction = taxYearData.standard_deduction[filingStatus];
  const taxableIncome = Math.max(0, agi - standardDeduction);

  const federalTax = calcFederalTax(taxableIncome, filingStatus, taxYearData.federal_brackets);
  const stateTax = calcStateTax(taxableIncome, state, includeStateTax, taxYearData.state_tax, filingStatus);

  const totalTax = seTax + federalTax + stateTax.amount;

  return {
    netProfit: np,
    ownerShareOfProfit,
    employerPayrollTax,
    seTaxBase,
    seTax,
    seTaxDeduction,
    agi,
    standardDeduction,
    taxableIncome,
    federalTax,
    stateTax,
    totalTax,
    quarterlyPayment: totalTax / 4,
    weeklyTaxReserve: totalTax / 52,
    effectiveRate: ownerShareOfProfit > 0 ? (totalTax / ownerShareOfProfit) * 100 : null,
  };
}
